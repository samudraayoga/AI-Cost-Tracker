import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { createProjectResolver } from '../domain/projects.js';
import { openDatabase, type Database } from './database.js';
import { getDashboardData } from './dashboard.js';
import { getRates, listProjects, loadMasterData } from './master-data.js';
import { stageRecord, type TransactionDraft } from './records.js';

describe('dashboard aggregation', () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase(':memory:');
    loadMasterData(db, 'data/master', []);
  });
  afterEach(() => db.close());

  function add(changes: Partial<TransactionDraft>) {
    const record: TransactionDraft = {
      source: 'manual', sourceRecordId: 'manual-1', sourceFile: 'fixture', projectLabel: 'GBX-01',
      vendor: 'Stock Music', amount: '1000000', timestamp: '2026-09-01', ...changes,
    };
    const result = stageRecord(db, record, createProjectResolver(listProjects(db), []), getRates(db));
    expect(result.status).toBe('accepted');
  }

  function finishImports(status: 'succeeded' | 'failed' = 'succeeded') {
    for (const source of ['vendor_a', 'vendor_b', 'vendor_c', 'manual']) {
      db.prepare(`INSERT INTO import_runs (source, started_at, finished_at, status)
        VALUES (?, '2026-10-20T00:00:00.000Z', '2026-10-20T00:01:00.000Z', ?)`).run(source, status);
    }
  }

  it('shows every project and an explicit empty state before costs are imported', () => {
    const dashboard = getDashboardData(db);
    expect(dashboard.summary).toMatchObject({ totalSpendIdr: '0', transactionCount: 0, projectCount: 6 });
    expect(dashboard.projects).toHaveLength(6);
    expect(dashboard.projects.every(project => project.spendIdr === '0' && project.usagePercent === '0')).toBe(true);
    expect(dashboard.vendors).toEqual([]);
    expect(dashboard.weekly).toEqual([]);
    expect(dashboard.dataQuality).toEqual({
      reviewCount: 0,
      importsComplete: false,
      incompleteSources: ['vendor_a', 'vendor_b', 'vendor_c', 'manual'],
    });
  });

  it('keeps project, vendor, and weekly totals consistent with refunds and manual costs', () => {
    add({ sourceRecordId: 'manual-1', projectLabel: 'GBX-01', vendor: 'Stock Music', amount: '1000000', timestamp: '2026-09-01' });
    add({ source: 'vendor_b', sourceRecordId: 'vendor-b-1', projectLabel: 'GBX-01', vendor: 'Vendor B', amount: '100', timestamp: '06-09-2026 18:30' });
    add({ source: 'vendor_a', sourceRecordId: 'refund-1', projectLabel: 'GBX-01', vendor: 'Vendor A', amount: '-3125', timestamp: '09/06/2026 18:00', refundOfSourceId: 'original-1' });
    add({ sourceRecordId: 'manual-2', projectLabel: 'KMD-02', vendor: 'Freelance VO', amount: '60000000', timestamp: '2026-09-14' });
    finishImports();

    const dashboard = getDashboardData(db);
    expect(dashboard.summary).toEqual({
      totalSpendIdr: '62125000', totalBudgetIdr: '237750000', remainingBudgetIdr: '175625000',
      usagePercent: '26.13', projectCount: 6, transactionCount: 4,
    });
    expect(dashboard.projects.find(project => project.code === 'GBX-01')).toMatchObject({
      spendIdr: '2125000', remainingIdr: '14875000', usagePercent: '12.5', transactionCount: 3,
    });
    expect(dashboard.projects.find(project => project.code === 'KMD-02')).toMatchObject({
      spendIdr: '60000000', remainingIdr: '-4000000', usagePercent: '107.14', transactionCount: 1,
    });
    expect(dashboard.projects.find(project => project.code === 'BRK-05')).toMatchObject({ spendIdr: '0', usagePercent: '0' });
    expect(dashboard.vendors.map(vendor => [vendor.vendor, vendor.spendIdr])).toEqual([
      ['Freelance VO', '60000000'], ['Vendor B', '1625000'], ['Stock Music', '1000000'], ['Vendor A', '-500000'],
    ]);
    expect(dashboard.weekly.map(week => [week.weekStartWib, week.weekEndWib, week.spendIdr])).toEqual([
      ['2026-08-31', '2026-09-06', '1000000'],
      ['2026-09-07', '2026-09-13', '1125000'],
      ['2026-09-14', '2026-09-20', '60000000'],
    ]);
    const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed();
    expect(sum(dashboard.projects.map(project => project.spendIdr))).toBe('62125000');
    expect(sum(dashboard.vendors.map(vendor => vendor.spendIdr))).toBe('62125000');
    expect(sum(dashboard.weekly.map(week => week.spendIdr))).toBe('62125000');
    expect(dashboard.dataQuality).toEqual({ reviewCount: 0, importsComplete: true, incompleteSources: [] });
  });

  it('uses the latest run per source when reporting import completeness', () => {
    finishImports();
    db.prepare(`INSERT INTO import_runs (source, started_at, finished_at, status, error)
      VALUES ('vendor_c', '2026-10-21T00:00:00.000Z', '2026-10-21T00:01:00.000Z', 'failed', 'timeout')`).run();
    expect(getDashboardData(db).dataQuality).toEqual({
      reviewCount: 0, importsComplete: false, incompleteSources: ['vendor_c'],
    });
  });
});
