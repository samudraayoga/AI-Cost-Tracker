import { createHash } from 'node:crypto';
import { normalizeAmount, type CostSource, type MoneyInput, type Rates } from '../domain/money.js';
import { normalizeTimestamp, type TimestampInput, type TimestampOptions } from '../domain/time.js';
import type { ProjectResolver } from '../domain/projects.js';
import { inTransaction, type Database } from './database.js';

/** Contract for Sprint 2 source adapters. Manual IDs must be stable, not random. */
export interface TransactionDraft {
  source: CostSource;
  sourceRecordId: string;
  sourceFile: string;
  sourceRow?: number;
  projectLabel: unknown;
  vendor: string;
  amount: MoneyInput;
  timestamp: TimestampInput;
  timestampOptions?: TimestampOptions;
  reference?: string;
  refundOfSourceId?: string;
}

export type RecordResult = {
  rawRecordId: number;
  status: 'accepted' | 'duplicate' | 'needs_review';
  reason?: string;
};

// An envelope for every input type prevents raw objects from impersonating Date
// or non-finite-number markers when a record is retried.
function encodeInput(value: unknown) {
  if (value instanceof Date) return { type: 'date', value: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() };
  if (typeof value === 'number') return { type: 'number', value: Number.isFinite(value) ? value : String(value) };
  if (typeof value === 'string') return { type: 'string', value };
  return { type: 'other', value: value ?? null };
}

function decodeInput(input: { type: string; value: unknown }): unknown {
  if (input.type === 'date') return new Date(String(input.value));
  if (input.type === 'number') return Number(input.value);
  return input.value;
}

function serialize(record: TransactionDraft, includeLocation = true): string {
  return JSON.stringify({
    source: record.source, sourceRecordId: record.sourceRecordId,
    ...(includeLocation ? { sourceFile: record.sourceFile, sourceRow: record.sourceRow ?? null } : {}),
    projectLabel: encodeInput(record.projectLabel), vendor: record.vendor,
    amount: encodeInput(record.amount),
    timestamp: encodeInput(record.timestamp),
    timestampOptions: record.timestampOptions ?? {},
    reference: record.reference ?? null, refundOfSourceId: record.refundOfSourceId ?? null,
  });
}

function deserialize(payload: string): TransactionDraft {
  const value = JSON.parse(payload);
  for (const key of ['projectLabel', 'amount', 'timestamp']) value[key] = decodeInput(value[key]);
  for (const key of ['sourceRow', 'reference', 'refundOfSourceId']) {
    if (value[key] === null) delete value[key];
  }
  return value as TransactionDraft;
}

export function stageRecord(db: Database, record: TransactionDraft, resolveProject: ProjectResolver, rates: Rates): RecordResult {
  if (!record.sourceRecordId?.trim() || !record.sourceFile?.trim()) throw new Error('Record wajib memiliki identitas sumber dan nama sumber.');
  if (record.sourceRow !== undefined && (!Number.isSafeInteger(record.sourceRow) || record.sourceRow < 1)) throw new Error('Nomor baris sumber harus integer positif.');
  const payload = serialize(record);
  const hash = createHash('sha256').update(payload).digest('hex');
  const contentHash = createHash('sha256').update(serialize(record, false)).digest('hex');
  return inTransaction(db, () => {
    const existing = db.prepare('SELECT id, content_sha256, status FROM raw_records WHERE source = ? AND source_record_id = ?')
      .get(record.source, record.sourceRecordId);
    if (existing && existing.content_sha256 !== contentHash) {
      throw new Error(`Konflik identitas ${record.source}/${record.sourceRecordId}: isi sumber berubah; perlu peninjauan, bukan ditimpa otomatis.`);
    }
    if (existing?.status === 'accepted') return { rawRecordId: Number(existing.id), status: 'duplicate' };
    const now = new Date().toISOString();
    const id = existing ? Number(existing.id) : Number(db.prepare(`INSERT INTO raw_records
      (source, source_record_id, source_file, source_row, payload_json, payload_sha256, content_sha256, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?)`).run(
      record.source, record.sourceRecordId, record.sourceFile, record.sourceRow ?? null, payload, hash, contentHash, now, now,
    ).lastInsertRowid);

    function review(reason: string, detail: string): RecordResult {
      db.prepare("UPDATE raw_records SET status = 'needs_review', review_reason = ?, review_detail = ?, updated_at = ? WHERE id = ?")
        .run(reason, detail, now, id);
      return { rawRecordId: id, status: 'needs_review', reason };
    }
    if (typeof record.vendor !== 'string' || !record.vendor.trim()) return review('invalid_vendor', 'Vendor tidak boleh kosong.');
    let amount;
    try { amount = normalizeAmount(record.source, record.amount, rates); }
    catch (error) { return review('invalid_amount', error instanceof Error ? error.message : String(error)); }
    let timestamp;
    try { timestamp = normalizeTimestamp(record.source, record.timestamp, record.timestampOptions); }
    catch (error) { return review('invalid_timestamp', error instanceof Error ? error.message : String(error)); }
    const project = resolveProject(record.projectLabel);
    if (project.status === 'needs_review') return review(project.reason, JSON.stringify({ label: project.label, candidates: project.candidates }));

    db.prepare(`INSERT INTO transactions (raw_record_id, project_code, vendor, original_amount, original_unit,
      amount_idr, rate_to_idr, occurred_at_utc, occurred_at_wib, date_wib, week_start_wib, reference, refund_of_source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, project.projectCode, record.vendor.trim(), amount.originalAmount, amount.originalUnit,
      amount.amountIdr, amount.rateToIdr, timestamp.occurredAtUtc, timestamp.occurredAtWib,
      timestamp.dateWib, timestamp.weekStartWib, record.reference ?? null, record.refundOfSourceId ?? null, now,
    );
    db.prepare("UPDATE raw_records SET status = 'accepted', review_reason = NULL, review_detail = NULL, updated_at = ? WHERE id = ?")
      .run(now, id);
    return { rawRecordId: id, status: 'accepted' };
  });
}

export function listReviewRecords(db: Database) {
  return db.prepare(`SELECT id, source, source_record_id AS sourceRecordId, source_file AS sourceFile,
    source_row AS sourceRow, review_reason AS reason, review_detail AS detail, payload_json AS payload
    FROM raw_records WHERE status = 'needs_review' ORDER BY id`).all();
}

export function retryReviewRecords(db: Database, resolveProject: ProjectResolver, rates: Rates): RecordResult[] {
  const records = listReviewRecords(db);
  return records.map(record => stageRecord(db, deserialize(String(record.payload)), resolveProject, rates));
}
