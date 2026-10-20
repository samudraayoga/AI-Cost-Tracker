import { join } from 'node:path';
import { normalizeAmount, parseCredits, type CostSource, type Rates } from '../domain/money.js';
import { normalizeTimestamp } from '../domain/time.js';
import type { ProjectResolver } from '../domain/projects.js';
import type { Database } from '../db/database.js';
import {
  stageDuplicateRecord, stageRecord, stageReviewRecord, type RecordResult, type TransactionDraft,
} from '../db/records.js';
import { readVendorA, readVendorB } from './csv.js';
import { readManualSpreadsheet } from './manual.js';
import type { ImportCounts, ImportReport, ManualSourceRecord, SourceRecord } from './types.js';
import { fetchVendorC, type VendorCFetchOptions } from './vendor-c.js';

export interface ImportOptions {
  dataDir: string;
  vendorC: VendorCFetchOptions;
  sources?: CostSource[];
}

function emptyCounts(): ImportCounts { return { read: 0, accepted: 0, duplicate: 0, review: 0 }; }

function addResult(counts: ImportCounts, result: RecordResult) {
  if (result.status === 'accepted') counts.accepted += 1;
  else if (result.status === 'duplicate') counts.duplicate += 1;
  else counts.review += 1;
}

function startRun(db: Database, source: CostSource): number {
  return Number(db.prepare("INSERT INTO import_runs (source, started_at, status) VALUES (?, ?, 'running')")
    .run(source, new Date().toISOString()).lastInsertRowid);
}

function finishRun(db: Database, id: number, report: ImportReport) {
  db.prepare(`UPDATE import_runs SET finished_at = ?, status = ?, records_read = ?, records_accepted = ?,
    records_duplicate = ?, records_review = ?, error = ? WHERE id = ?`).run(
    new Date().toISOString(), report.status, report.read, report.accepted,
    report.duplicate, report.review, report.error ?? null, id,
  );
}

async function recordedImport(
  db: Database,
  source: CostSource,
  work: (counts: ImportCounts) => Promise<void>,
): Promise<ImportReport> {
  const id = startRun(db, source);
  const counts = emptyCounts();
  let report: ImportReport;
  try {
    await work(counts);
    report = { source, status: 'succeeded', ...counts };
  } catch (error) {
    const progressed = counts.accepted + counts.duplicate + counts.review > 0;
    report = { source, status: progressed ? 'partial' : 'failed', ...counts, error: error instanceof Error ? error.message : String(error) };
  }
  finishRun(db, id, report);
  return report;
}

async function importRecords(
  db: Database,
  source: CostSource,
  loader: () => Promise<SourceRecord[]>,
  resolveProject: ProjectResolver,
  rates: Rates,
): Promise<ImportReport> {
  return recordedImport(db, source, async counts => {
    const records = await loader();
    counts.read = records.length;
    for (const record of records) addResult(counts, stageRecord(db, record.draft, resolveProject, rates));
  });
}

function findCanonicalByRawId(db: Database, source: CostSource, sourceRecordId: string): number[] {
  return db.prepare(`SELECT t.id FROM transactions t JOIN raw_records r ON r.id = t.raw_record_id
    WHERE r.source = ? AND r.source_record_id = ? ORDER BY t.id`).all(source, sourceRecordId).map(row => Number(row.id));
}

function findManualInvoice(db: Database, invoice: string): number[] {
  return db.prepare(`SELECT t.id FROM transactions t JOIN raw_records r ON r.id = t.raw_record_id
    WHERE r.source = 'manual' AND t.reference = ? ORDER BY t.id`).all(invoice).map(row => Number(row.id));
}

function previewManual(record: TransactionDraft, resolveProject: ProjectResolver, rates: Rates) {
  try {
    const amount = normalizeAmount('manual', record.amount, rates);
    const timestamp = normalizeTimestamp('manual', record.timestamp, record.timestampOptions);
    const project = resolveProject(record.projectLabel);
    if (project.status === 'needs_review') return null;
    return { amountIdr: amount.amountIdr, dateWib: timestamp.dateWib, projectCode: project.projectCode };
  } catch { return null; }
}

function findVendorAMatch(db: Database, preview: NonNullable<ReturnType<typeof previewManual>>): number[] {
  return db.prepare(`SELECT t.id FROM transactions t JOIN raw_records r ON r.id = t.raw_record_id
    WHERE r.source = 'vendor_a' AND t.project_code = ? AND t.date_wib = ? AND t.amount_idr = ?
    ORDER BY t.id`).all(preview.projectCode, preview.dateWib, preview.amountIdr).map(row => Number(row.id));
}

function importManualRecord(
  db: Database,
  record: ManualSourceRecord,
  resolveProject: ProjectResolver,
  rates: Rates,
): RecordResult {
  const preview = previewManual(record.draft, resolveProject, rates);
  if (!preview) return stageRecord(db, record.draft, resolveProject, rates);

  if (record.explicitReference) {
    const matches = findCanonicalByRawId(db, 'vendor_a', record.explicitReference);
    if (matches.length === 1) return stageDuplicateRecord(db, record.draft, matches[0]!, 'manual_vendor_a_ref');
    return stageReviewRecord(db, record.draft, matches.length ? 'ambiguous_reference' : 'reference_not_found', JSON.stringify({
      reference: record.explicitReference, candidates: matches,
    }));
  }

  if (record.draft.vendor.trim().toLowerCase() === 'vendor a') {
    const matches = findVendorAMatch(db, preview);
    if (matches.length === 1) return stageDuplicateRecord(db, record.draft, matches[0]!, 'manual_vendor_a_match');
    if (matches.length > 1) return stageReviewRecord(db, record.draft, 'ambiguous_duplicate', JSON.stringify({ candidates: matches }));
  }

  if (record.invoice) {
    const matches = findManualInvoice(db, record.invoice);
    if (matches.length === 1) return stageDuplicateRecord(db, record.draft, matches[0]!, 'manual_invoice');
    if (matches.length > 1) return stageReviewRecord(db, record.draft, 'ambiguous_invoice', JSON.stringify({ invoice: record.invoice, candidates: matches }));
  }
  return stageRecord(db, record.draft, resolveProject, rates);
}

async function importManual(
  db: Database, path: string, resolveProject: ProjectResolver, rates: Rates,
): Promise<ImportReport> {
  return recordedImport(db, 'manual', async counts => {
    const records = await readManualSpreadsheet(path);
    counts.read = records.length;
    for (const record of records) addResult(counts, importManualRecord(db, record, resolveProject, rates));
  });
}

export async function runImports(
  db: Database,
  resolveProject: ProjectResolver,
  rates: Rates,
  options: ImportOptions,
): Promise<ImportReport[]> {
  const selected = new Set(options.sources ?? ['vendor_a', 'vendor_b', 'vendor_c', 'manual']);
  const reports: ImportReport[] = [];
  // A precedes manual so explicit Ref and unique cross-source matches can resolve deterministically.
  if (selected.has('vendor_a')) reports.push(await importRecords(db, 'vendor_a', async () => {
    const records = await readVendorA(join(options.dataDir, 'vendor_a.csv'));
    for (const { draft } of records) {
      const credits = parseCredits(draft.amount);
      const isRefund = draft.reference === 'refund';
      if (isRefund !== Boolean(draft.refundOfSourceId) || credits.startsWith('-') !== isRefund) {
        throw new Error(`Vendor A ${draft.sourceRecordId}: refund, nominal negatif, dan ref_transaction_id tidak konsisten.`);
      }
    }
    return records;
  }, resolveProject, rates));
  if (selected.has('vendor_b')) reports.push(await importRecords(db, 'vendor_b', () => readVendorB(join(options.dataDir, 'vendor_b.csv')), resolveProject, rates));
  if (selected.has('vendor_c')) reports.push(await importRecords(db, 'vendor_c', () => fetchVendorC(options.vendorC), resolveProject, rates));
  if (selected.has('manual')) reports.push(await importManual(db, join(options.dataDir, 'manual_ops.xlsx'), resolveProject, rates));
  return reports;
}
