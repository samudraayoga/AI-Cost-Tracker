import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';
import type { CostSource } from '../domain/money.js';
import type { Database } from './database.js';

const ExactDecimal = Decimal.clone({ precision: 100 });
const IMPORT_SOURCES: CostSource[] = ['vendor_a', 'vendor_b', 'vendor_c', 'manual'];

interface TransactionRow {
  project_code: string;
  vendor: string;
  amount_idr: string;
  week_start_wib: string;
}

interface ImportRunRow {
  source: CostSource;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
}

export interface ProjectCostSummary {
  code: string;
  name: string;
  client: string;
  budgetIdr: string;
  spendIdr: string;
  remainingIdr: string;
  usagePercent: string;
  transactionCount: number;
}

export interface VendorCostSummary {
  vendor: string;
  spendIdr: string;
  sharePercent: string;
  transactionCount: number;
}

export interface WeeklyCostSummary {
  weekStartWib: string;
  weekEndWib: string;
  spendIdr: string;
  transactionCount: number;
}

export interface DashboardData {
  summary: {
    totalSpendIdr: string;
    totalBudgetIdr: string;
    remainingBudgetIdr: string;
    usagePercent: string;
    projectCount: number;
    transactionCount: number;
  };
  projects: ProjectCostSummary[];
  vendors: VendorCostSummary[];
  weekly: WeeklyCostSummary[];
  dataQuality: {
    reviewCount: number;
    importsComplete: boolean;
    incompleteSources: CostSource[];
  };
}

function sum(values: Iterable<string>): InstanceType<typeof ExactDecimal> {
  let total = new ExactDecimal(0);
  for (const value of values) total = total.plus(value);
  return total;
}

function canonical(value: InstanceType<typeof ExactDecimal>): string {
  return value.isZero() ? '0' : value.toFixed();
}

function percent(numerator: InstanceType<typeof ExactDecimal>, denominator: InstanceType<typeof ExactDecimal>): string {
  if (denominator.isZero()) return '0';
  return canonical(numerator.times(100).dividedBy(denominator).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP));
}

function addToGroup<T extends string>(
  groups: Map<T, { amount: InstanceType<typeof ExactDecimal>; count: number }>,
  key: T,
  amount: string,
) {
  const current = groups.get(key) ?? { amount: new ExactDecimal(0), count: 0 };
  current.amount = current.amount.plus(amount);
  current.count += 1;
  groups.set(key, current);
}

function latestImportRuns(db: Database): Map<CostSource, ImportRunRow['status']> {
  const rows = db.prepare(`
    SELECT source, status FROM (
      SELECT source, status, row_number() OVER (PARTITION BY source ORDER BY id DESC) AS position
      FROM import_runs
    ) WHERE position = 1
  `).all() as unknown as ImportRunRow[];
  return new Map(rows.map(row => [row.source, row.status]));
}

/**
 * Read every effective transaction once, then derive all dashboard sections
 * from that same set. Values remain decimal strings at the API boundary.
 */
export function getDashboardData(db: Database): DashboardData {
  const projects = db.prepare(`
    SELECT code, name, client, budget_idr AS budgetIdr
    FROM projects ORDER BY code
  `).all() as unknown as Array<{ code: string; name: string; client: string; budgetIdr: string }>;
  const transactions = db.prepare(`
    SELECT project_code, vendor, amount_idr, week_start_wib
    FROM transactions ORDER BY id
  `).all() as unknown as TransactionRow[];

  const projectGroups = new Map<string, { amount: InstanceType<typeof ExactDecimal>; count: number }>();
  const vendorGroups = new Map<string, { amount: InstanceType<typeof ExactDecimal>; count: number }>();
  const weeklyGroups = new Map<string, { amount: InstanceType<typeof ExactDecimal>; count: number }>();
  for (const transaction of transactions) {
    addToGroup(projectGroups, transaction.project_code, transaction.amount_idr);
    addToGroup(vendorGroups, transaction.vendor, transaction.amount_idr);
    addToGroup(weeklyGroups, transaction.week_start_wib, transaction.amount_idr);
  }

  const totalSpend = sum(transactions.map(transaction => transaction.amount_idr));
  const totalBudget = sum(projects.map(project => project.budgetIdr));
  const projectSummaries = projects.map(project => {
    const grouped = projectGroups.get(project.code) ?? { amount: new ExactDecimal(0), count: 0 };
    const budget = new ExactDecimal(project.budgetIdr);
    return {
      ...project,
      spendIdr: canonical(grouped.amount),
      remainingIdr: canonical(budget.minus(grouped.amount)),
      usagePercent: percent(grouped.amount, budget),
      transactionCount: grouped.count,
    };
  });
  const vendorSummaries = [...vendorGroups.entries()]
    .map(([vendor, grouped]) => ({
      vendor,
      spendIdr: canonical(grouped.amount),
      sharePercent: percent(grouped.amount, totalSpend),
      transactionCount: grouped.count,
    }))
    .sort((left, right) => new ExactDecimal(right.spendIdr).comparedTo(left.spendIdr) || left.vendor.localeCompare(right.vendor));
  const weeklySummaries = [...weeklyGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStartWib, grouped]) => {
      const start = DateTime.fromISO(weekStartWib, { zone: 'UTC+7' });
      if (!start.isValid) throw new Error(`Tanggal minggu tidak valid di database: ${weekStartWib}`);
      return {
        weekStartWib,
        weekEndWib: start.plus({ days: 6 }).toISODate()!,
        spendIdr: canonical(grouped.amount),
        transactionCount: grouped.count,
      };
    });

  const imports = latestImportRuns(db);
  const incompleteSources = IMPORT_SOURCES.filter(source => imports.get(source) !== 'succeeded');
  return {
    summary: {
      totalSpendIdr: canonical(totalSpend),
      totalBudgetIdr: canonical(totalBudget),
      remainingBudgetIdr: canonical(totalBudget.minus(totalSpend)),
      usagePercent: percent(totalSpend, totalBudget),
      projectCount: projects.length,
      transactionCount: transactions.length,
    },
    projects: projectSummaries,
    vendors: vendorSummaries,
    weekly: weeklySummaries,
    dataQuality: {
      reviewCount: Number(db.prepare("SELECT count(*) AS count FROM raw_records WHERE status = 'needs_review'").get()?.count ?? 0),
      importsComplete: incompleteSources.length === 0,
      incompleteSources,
    },
  };
}
