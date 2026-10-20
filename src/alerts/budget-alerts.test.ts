import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectResolver } from '../domain/projects.js';
import { openDatabase, type Database } from '../db/database.js';
import { getRates, listProjects, loadMasterData } from '../db/master-data.js';
import { stageRecord } from '../db/records.js';
import {
  BUDGET_ALERT_POLICY, evaluateBudgetAlerts, listBudgetAlertAttempts, sendBudgetAlerts,
} from './budget-alerts.js';

describe('budget alerts', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    loadMasterData(db, 'data/master', []);
  });
  afterEach(() => db.close());

  function addCost(sourceRecordId: string, projectCode: string, amount: string) {
    expect(stageRecord(db, {
      source: 'manual', sourceRecordId, sourceFile: 'alert-fixture.xlsx',
      projectLabel: projectCode, vendor: 'Ops', amount, timestamp: '2026-09-01',
    }, createProjectResolver(listProjects(db), []), getRates(db)).status).toBe('accepted');
  }

  function completeImports() {
    for (const source of ['vendor_a', 'vendor_b', 'vendor_c', 'manual']) {
      db.prepare(`INSERT INTO import_runs (source, started_at, finished_at, status)
        VALUES (?, '2026-10-20T00:00:00.000Z', '2026-10-20T00:01:00.000Z', 'succeeded')`).run(source);
    }
  }

  it('T-12 only selects projects strictly above 80 percent', () => {
    addCost('below', 'GBX-01', '13599999');
    addCost('exact', 'KMD-02', '44800000');
    addCost('above', 'GLW-03', '26000001');
    completeImports();

    const evaluation = evaluateBudgetAlerts(db);
    expect(evaluation.ready).toBe(true);
    expect(evaluation.eligibleProjects.map(project => project.code)).toEqual(['GLW-03']);
    expect(evaluation.eligibleProjects[0]?.usagePercent).toBe('80');
  });

  it('T-13 sends once and skips the same project after a successful delivery', async () => {
    addCost('above', 'GLW-03', '30000000');
    completeImports();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const options = {
      webhookUrl: 'http://webhook.test/budget', fetchImpl, now: () => new Date('2026-10-20T01:00:00.000Z'),
    };

    const first = await sendBudgetAlerts(db, options);
    const second = await sendBudgetAlerts(db, options);

    expect(first.results).toEqual([{ projectCode: 'GLW-03', status: 'sent', attemptId: 1, responseStatus: 204 }]);
    expect(second.results).toEqual([{ projectCode: 'GLW-03', status: 'already_sent' }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({
      event: 'budget.threshold_exceeded', policy: BUDGET_ALERT_POLICY, thresholdPercent: '80',
      project: { code: 'GLW-03', name: 'Glowlab Serum Launch', client: 'Glowlab' },
      spendIdr: '30000000', budgetIdr: '32500000', usagePercent: '92.31', currency: 'IDR',
    });
    expect(listBudgetAlertAttempts(db)).toHaveLength(1);
    expect(listBudgetAlertAttempts(db)[0]).toMatchObject({ status: 'succeeded', responseStatus: 204, error: null });
  });

  it('T-14 records a failed response and succeeds when explicitly retried', async () => {
    addCost('above', 'GLW-03', '30000000');
    completeImports();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    const options = {
      webhookUrl: 'http://webhook.test/budget', fetchImpl, now: () => new Date('2026-10-20T01:00:00.000Z'),
    };

    expect((await sendBudgetAlerts(db, options)).results[0]).toMatchObject({
      projectCode: 'GLW-03', status: 'failed', responseStatus: 503, error: 'Webhook merespons HTTP 503.',
    });
    expect((await sendBudgetAlerts(db, options)).results[0]).toMatchObject({
      projectCode: 'GLW-03', status: 'sent', responseStatus: 202,
    });
    expect(listBudgetAlertAttempts(db).map(attempt => [attempt.status, attempt.responseStatus])).toEqual([
      ['failed', 503], ['succeeded', 202],
    ]);
  });

  it('does not send when any latest source import is incomplete', async () => {
    addCost('above', 'GLW-03', '30000000');
    completeImports();
    db.prepare(`INSERT INTO import_runs (source, started_at, finished_at, status, error)
      VALUES ('vendor_c', '2026-10-21T00:00:00.000Z', '2026-10-21T00:01:00.000Z', 'partial', 'timeout')`).run();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await sendBudgetAlerts(db, { webhookUrl: 'http://webhook.test/budget', fetchImpl });
    expect(result).toMatchObject({ status: 'blocked', incompleteSources: ['vendor_c'], results: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(listBudgetAlertAttempts(db)).toEqual([]);
  });

  it.each([
    ['file:///tmp/hook', 10_000, /HTTP atau HTTPS/],
    ['http://user:secret@webhook.test/hook', 10_000, /userinfo/],
    ['http://webhook.test/hook', 0, /integer positif/],
  ] as const)('rejects unsafe webhook configuration without creating an attempt', async (webhookUrl, timeoutMs, message) => {
    addCost('above', 'GLW-03', '30000000');
    completeImports();
    await expect(sendBudgetAlerts(db, { webhookUrl, timeoutMs })).rejects.toThrow(message);
    expect(listBudgetAlertAttempts(db)).toEqual([]);
  });
});
