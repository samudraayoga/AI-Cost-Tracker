import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProjectResolver } from '../domain/projects.js';
import { openDatabase, type Database } from './database.js';
import { getRates, listProjects, loadMasterData } from './master-data.js';
import { listReviewRecords, retryReviewRecords, stageRecord, type TransactionDraft } from './records.js';

describe('transaction staging and review lifecycle', () => {
  let db: Database;
  beforeEach(() => { db = openDatabase(':memory:'); loadMasterData(db, 'data/master', []); });
  afterEach(() => db.close());
  const draft = (changes: Partial<TransactionDraft> = {}): TransactionDraft => ({
    source: 'vendor_a', sourceRecordId: 'test-001', sourceFile: 'vendor_a.csv', sourceRow: 2,
    projectLabel: 'KMD-02', vendor: 'Vendor A', amount: '100', timestamp: '09/06/2026 18:00',
    ...changes,
  });
  const resolver = () => createProjectResolver(listProjects(db), []);
  const count = () => db.prepare('SELECT count(*) AS count FROM transactions').get()?.count;

  it('keeps original provenance and exact normalized values with WIB week boundary', () => {
    expect(stageRecord(db, draft(), resolver(), getRates(db)).status).toBe('accepted');
    expect(db.prepare('SELECT * FROM transactions').get()).toMatchObject({
      project_code: 'KMD-02', original_amount: '100', original_unit: 'credits', amount_idr: '16000',
      rate_to_idr: '160', occurred_at_wib: '2026-09-07T01:00:00.000+07:00', week_start_wib: '2026-09-07',
    });
    const raw = db.prepare('SELECT * FROM raw_records').get();
    expect(raw).toMatchObject({ source: 'vendor_a', source_record_id: 'test-001', source_file: 'vendor_a.csv', source_row: 2 });
    expect(JSON.parse(String(raw?.payload_json))).toMatchObject({ amount: { type: 'string', value: '100' }, timestamp: { type: 'string', value: '09/06/2026 18:00' } });
  });

  it('retains an unknown project then accepts it once an explicit alias is configured, exactly once', () => {
    const record = draft({ projectLabel: 'verified-new-alias' });
    expect(stageRecord(db, record, resolver(), getRates(db))).toMatchObject({ status: 'needs_review', reason: 'unknown_project' });
    expect(count()).toBe(0);
    expect(listReviewRecords(db)).toHaveLength(1);
    const corrected = createProjectResolver(listProjects(db), [{ alias: 'verified-new-alias', projectCode: 'KMD-02' }]);
    expect(retryReviewRecords(db, corrected, getRates(db))).toEqual([{ rawRecordId: 1, status: 'accepted' }]);
    expect(retryReviewRecords(db, corrected, getRates(db))).toEqual([]);
    expect(stageRecord(db, record, corrected, getRates(db)).status).toBe('duplicate');
    expect(count()).toBe(1);
    expect(listReviewRecords(db)).toHaveLength(0);
  });

  it('does not guess for missing or conflicting project labels', () => {
    expect(stageRecord(db, draft({ projectLabel: '' }), resolver(), getRates(db))).toMatchObject({ status: 'needs_review', reason: 'missing_project' });
    const conflicting = createProjectResolver(listProjects(db), [{ alias: 'KMD-02', projectCode: 'GLW-03' }]);
    expect(stageRecord(db, draft({ sourceRecordId: 'test-002' }), conflicting, getRates(db))).toMatchObject({ status: 'needs_review', reason: 'ambiguous_project' });
    expect(count()).toBe(0);
  });

  it.each([
    [{ amount: 'not-a-number' }, 'invalid_amount'],
    [{ timestamp: '02/30/2026 09:00' }, 'invalid_timestamp'],
    [{ vendor: '' }, 'invalid_vendor'],
  ] as const)('stores invalid input with a review reason rather than silently dropping it: %j', (changes, reason) => {
    expect(stageRecord(db, draft(changes), resolver(), getRates(db))).toMatchObject({ status: 'needs_review', reason });
    expect(listReviewRecords(db)[0]?.reason).toBe(reason);
    expect(count()).toBe(0);
  });

  it('keeps negative refunds and their reference, without applying a second subtraction', () => {
    const refund = draft({ amount: '-12.5', refundOfSourceId: 'original-001' });
    stageRecord(db, refund, resolver(), getRates(db));
    stageRecord(db, refund, resolver(), getRates(db));
    expect(count()).toBe(1);
    expect(db.prepare('SELECT amount_idr, refund_of_source_id FROM transactions').get()).toMatchObject({ amount_idr: '-2000', refund_of_source_id: 'original-001' });
  });

  it('rejects a changed payload under an existing source ID without overwriting accepted evidence', () => {
    stageRecord(db, draft(), resolver(), getRates(db));
    expect(() => stageRecord(db, draft({ amount: '999' }), resolver(), getRates(db))).toThrow('Konflik identitas');
    expect(db.prepare('SELECT amount_idr FROM transactions').get()?.amount_idr).toBe('16000');
    expect(count()).toBe(1);
  });

  it('does not deduplicate distinct stable identities merely because the amount is equal', () => {
    stageRecord(db, draft(), resolver(), getRates(db));
    stageRecord(db, draft({ sourceRecordId: 'test-002' }), resolver(), getRates(db));
    expect(count()).toBe(2);
  });

  it('recognizes the same identity and content even at another source location', () => {
    stageRecord(db, draft(), resolver(), getRates(db));
    expect(stageRecord(db, draft({ sourceRow: 99, sourceFile: 'copied/vendor_a.csv' }), resolver(), getRates(db)).status).toBe('duplicate');
    expect(count()).toBe(1);
    expect(db.prepare('SELECT source_row FROM raw_records').get()?.source_row).toBe(2);
  });

  it('preserves non-finite raw values through review and repeated processing', () => {
    expect(stageRecord(db, draft({ amount: Number.NaN }), resolver(), getRates(db)).reason).toBe('invalid_amount');
    expect(JSON.parse(String(listReviewRecords(db)[0]?.payload))).toMatchObject({ amount: { type: 'number', value: 'NaN' } });
    expect(retryReviewRecords(db, resolver(), getRates(db))[0]?.reason).toBe('invalid_amount');
    expect(count()).toBe(0);
  });

  it('does not reinterpret malformed source objects as valid dates during a retry', () => {
    const timestamp = { kind: 'excel_date', value: '2026-09-01T00:00:00Z' } as unknown as Date;
    expect(stageRecord(db, draft({ timestamp }), resolver(), getRates(db)).reason).toBe('invalid_timestamp');
    expect(retryReviewRecords(db, resolver(), getRates(db))[0]?.reason).toBe('invalid_timestamp');
    expect(count()).toBe(0);
  });

  it('retains spreadsheet Date type when reprocessing a pending manual record', () => {
    stageRecord(db, draft({
      source: 'manual', sourceFile: 'manual_ops.xlsx', projectLabel: 'new-manual-label',
      amount: 'Rp 1.850.000', timestamp: new Date('2026-09-01T00:00:00Z'),
    }), resolver(), getRates(db));
    const corrected = createProjectResolver(listProjects(db), [{ alias: 'new-manual-label', projectCode: 'KMD-02' }]);
    retryReviewRecords(db, corrected, getRates(db));
    expect(db.prepare('SELECT amount_idr, occurred_at_wib FROM transactions').get()).toMatchObject({
      amount_idr: '1850000', occurred_at_wib: '2026-09-01T00:00:00.000+07:00',
    });
  });
});
