import { Decimal } from 'decimal.js';
import type { CostSource } from '../domain/money.js';
import type { Database } from '../db/database.js';
import { getDashboardData, type ProjectCostSummary } from '../db/dashboard.js';

const ExactDecimal = Decimal.clone({ precision: 100 });
export const BUDGET_ALERT_POLICY = 'budget-over-80-v1';
export const BUDGET_ALERT_THRESHOLD_PERCENT = '80';

export interface BudgetAlertPayload {
  event: 'budget.threshold_exceeded';
  policy: typeof BUDGET_ALERT_POLICY;
  thresholdPercent: typeof BUDGET_ALERT_THRESHOLD_PERCENT;
  project: { code: string; name: string; client: string };
  spendIdr: string;
  budgetIdr: string;
  usagePercent: string;
  currency: 'IDR';
  pendingReviewRecords: number;
  evaluatedAt: string;
}

export interface BudgetAlertEvaluation {
  ready: boolean;
  incompleteSources: CostSource[];
  reviewCount: number;
  eligibleProjects: ProjectCostSummary[];
}

export interface BudgetAlertResult {
  projectCode: string;
  status: 'sent' | 'already_sent' | 'failed';
  attemptId?: number;
  responseStatus?: number;
  error?: string;
}

export interface BudgetAlertRun {
  status: 'completed' | 'blocked';
  policy: typeof BUDGET_ALERT_POLICY;
  thresholdPercent: typeof BUDGET_ALERT_THRESHOLD_PERCENT;
  reviewCount: number;
  incompleteSources: CostSource[];
  results: BudgetAlertResult[];
}

export interface SendBudgetAlertOptions {
  webhookUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export interface BudgetAlertAttempt {
  id: number;
  policyKey: string;
  projectCode: string;
  status: 'sending' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  thresholdPercent: string;
  spendIdr: string;
  budgetIdr: string;
  usagePercent: string;
  responseStatus: number | null;
  error: string | null;
}

function isAboveThreshold(project: ProjectCostSummary): boolean {
  return new ExactDecimal(project.spendIdr).times(100)
    .greaterThan(new ExactDecimal(project.budgetIdr).times(BUDGET_ALERT_THRESHOLD_PERCENT));
}

export function evaluateBudgetAlerts(db: Database): BudgetAlertEvaluation {
  const dashboard = getDashboardData(db);
  return {
    ready: dashboard.dataQuality.importsComplete,
    incompleteSources: dashboard.dataQuality.incompleteSources,
    reviewCount: dashboard.dataQuality.reviewCount,
    eligibleProjects: dashboard.dataQuality.importsComplete
      ? dashboard.projects.filter(isAboveThreshold)
      : [],
  };
}

function validatedWebhookUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('WEBHOOK_URL harus berupa URL HTTP atau HTTPS yang valid.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('WEBHOOK_URL harus menggunakan protokol HTTP atau HTTPS.');
  if (url.username || url.password) throw new Error('WEBHOOK_URL tidak boleh memuat kredensial pada bagian userinfo.');
  return url.toString();
}

function payloadFor(project: ProjectCostSummary, reviewCount: number, evaluatedAt: string): BudgetAlertPayload {
  return {
    event: 'budget.threshold_exceeded',
    policy: BUDGET_ALERT_POLICY,
    thresholdPercent: BUDGET_ALERT_THRESHOLD_PERCENT,
    project: { code: project.code, name: project.name, client: project.client },
    spendIdr: project.spendIdr,
    budgetIdr: project.budgetIdr,
    usagePercent: project.usagePercent,
    currency: 'IDR',
    pendingReviewRecords: reviewCount,
    evaluatedAt,
  };
}

function alreadySucceeded(db: Database, projectCode: string): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM budget_alert_attempts
    WHERE project_code = ? AND policy_key = ? AND status = 'succeeded' LIMIT 1`)
    .get(projectCode, BUDGET_ALERT_POLICY));
}

function startAttempt(db: Database, payload: BudgetAlertPayload): number {
  return Number(db.prepare(`INSERT INTO budget_alert_attempts (
    policy_key, project_code, status, started_at, threshold_percent,
    spend_idr, budget_idr, usage_percent, payload_json
  ) VALUES (?, ?, 'sending', ?, ?, ?, ?, ?, ?)`).run(
    BUDGET_ALERT_POLICY, payload.project.code, payload.evaluatedAt, BUDGET_ALERT_THRESHOLD_PERCENT,
    payload.spendIdr, payload.budgetIdr, payload.usagePercent, JSON.stringify(payload),
  ).lastInsertRowid);
}

function finishAttempt(
  db: Database,
  id: number,
  status: 'succeeded' | 'failed',
  finishedAt: string,
  responseStatus: number | null,
  error: string | null,
) {
  db.prepare(`UPDATE budget_alert_attempts
    SET status = ?, finished_at = ?, response_status = ?, error = ? WHERE id = ?`)
    .run(status, finishedAt, responseStatus, error, id);
}

export async function sendBudgetAlerts(db: Database, options: SendBudgetAlertOptions): Promise<BudgetAlertRun> {
  const evaluation = evaluateBudgetAlerts(db);
  if (!evaluation.ready) return {
    status: 'blocked', policy: BUDGET_ALERT_POLICY, thresholdPercent: BUDGET_ALERT_THRESHOLD_PERCENT,
    reviewCount: evaluation.reviewCount, incompleteSources: evaluation.incompleteSources, results: [],
  };

  const webhookUrl = validatedWebhookUrl(options.webhookUrl);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Webhook timeout harus berupa integer positif.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const results: BudgetAlertResult[] = [];

  for (const project of evaluation.eligibleProjects) {
    if (alreadySucceeded(db, project.code)) {
      results.push({ projectCode: project.code, status: 'already_sent' });
      continue;
    }
    const evaluatedAt = now().toISOString();
    const payload = payloadFor(project, evaluation.reviewCount, evaluatedAt);
    const attemptId = startAttempt(db, payload);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = `Webhook merespons HTTP ${response.status}.`;
        finishAttempt(db, attemptId, 'failed', now().toISOString(), response.status, error);
        results.push({ projectCode: project.code, status: 'failed', attemptId, responseStatus: response.status, error });
        continue;
      }
      finishAttempt(db, attemptId, 'succeeded', now().toISOString(), response.status, null);
      results.push({ projectCode: project.code, status: 'sent', attemptId, responseStatus: response.status });
    } catch {
      const error = controller.signal.aborted
        ? `Webhook timeout setelah ${timeoutMs} ms.`
        : 'Webhook gagal karena gangguan jaringan atau koneksi ditolak.';
      finishAttempt(db, attemptId, 'failed', now().toISOString(), null, error);
      results.push({ projectCode: project.code, status: 'failed', attemptId, error });
    } finally {
      clearTimeout(timeout);
    }
  }
  return {
    status: 'completed', policy: BUDGET_ALERT_POLICY, thresholdPercent: BUDGET_ALERT_THRESHOLD_PERCENT,
    reviewCount: evaluation.reviewCount, incompleteSources: [], results,
  };
}

export function listBudgetAlertAttempts(db: Database): BudgetAlertAttempt[] {
  return db.prepare(`SELECT id, policy_key AS policyKey, project_code AS projectCode, status,
    started_at AS startedAt, finished_at AS finishedAt, threshold_percent AS thresholdPercent,
    spend_idr AS spendIdr, budget_idr AS budgetIdr, usage_percent AS usagePercent,
    response_status AS responseStatus, error
    FROM budget_alert_attempts ORDER BY id`).all() as unknown as BudgetAlertAttempt[];
}
