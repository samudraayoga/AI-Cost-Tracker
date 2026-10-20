import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { Decimal } from 'decimal.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase, type Database } from '../db/database.js';
import { getRates, listProjects, loadMasterData, readAliases } from '../db/master-data.js';
import { createProjectResolver } from '../domain/projects.js';
import { runImports } from './runner.js';

const directories: string[] = [];
function directory() { const value = mkdtempSync(join(tmpdir(), 'cost-import-')); directories.push(value); return value; }
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('end-to-end import orchestration', () => {
  let db: Database;
  let dataDir: string;
  beforeEach(async () => {
    db = openDatabase(':memory:');
    loadMasterData(db, 'data/master', readAliases('config/project-aliases.json'));
    dataDir = directory();
    writeFileSync(join(dataDir, 'vendor_a.csv'), [
      'transaction_id,timestamp_utc,project_tag,model,job_type,credits,ref_transaction_id',
      'TX-1,09/01/2026 01:00,KMD-02,m,image,10,',
      'TX-2,09/02/2026 01:00,KMD-02,m,refund,-10,TX-1',
    ].join('\n'));
    writeFileSync(join(dataDir, 'vendor_b.csv'), [
      'line_id,time_utc,workspace,product,usd_amount',
      'L-1,01-09-2026 01:00,GLW-03,Voice,$2.00',
      'L-1,01-09-2026 01:00,GLW-03,Voice,$2.00',
      'L-2,01-09-2026 02:00,GLW-03,Voice,$2.00',
    ].join('\n'));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ops');
    sheet.addRow(['Rekap']);
    sheet.addRow(['Tanggal', 'Project', 'Tool / Vendor', 'Keterangan', 'Nominal', 'Ref']);
    sheet.addRow(['1/9/2026', 'KMD-02', 'Vendor A', 'copied cost', 1600, 'TX-1']);
    sheet.addRow(['2/9/2026', 'INT-00', 'Stock Music', 'License INV-10', 'Rp 1.000']);
    sheet.addRow(['2026-09-02', 'INT-00', 'Stock Music', 'License INV-10', 1000]);
    sheet.addRow(['3/9/2026', 'INT-00', 'Other', 'different one', 500]);
    sheet.addRow(['3/9/2026', 'INT-00', 'Other', 'different two', 500]);
    sheet.addRow([null, null, null, 'TOTAL', 4600]);
    await workbook.xlsx.writeFile(join(dataDir, 'manual_ops.xlsx'));
  });
  afterEach(() => { db.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

  const resolver = () => createProjectResolver(listProjects(db), readAliases('config/project-aliases.json'));
  const total = () => (db.prepare('SELECT amount_idr FROM transactions').all() as Array<{ amount_idr: string }>)
    .reduce((sum, row) => sum.plus(row.amount_idr), new Decimal(0)).toFixed();

  it('imports four sources, preserves refunds, deduplicates by identity/Ref/invoice, and is idempotent', async () => {
    const vendorC = vi.fn<typeof fetch>().mockImplementation(async () => response({
      data: [{ id: 'VC-1', created_at: '2026-09-01T00:00:00Z', project: 'SNJ-04', service: 'sfx', amount_usd_cents: 100 }],
      page: 1, per_page: 100, total: 1, has_more: false,
    }));
    const options = { dataDir, vendorC: { baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: vendorC } };
    const first = await runImports(db, resolver(), getRates(db), options);
    expect(first).toEqual([
      { source: 'vendor_a', status: 'succeeded', read: 2, accepted: 2, duplicate: 0, review: 0 },
      { source: 'vendor_b', status: 'succeeded', read: 3, accepted: 2, duplicate: 1, review: 0 },
      { source: 'vendor_c', status: 'succeeded', read: 1, accepted: 1, duplicate: 0, review: 0 },
      { source: 'manual', status: 'succeeded', read: 5, accepted: 3, duplicate: 2, review: 0 },
    ]);
    expect(db.prepare('SELECT amount_idr, refund_of_source_id FROM transactions WHERE refund_of_source_id IS NOT NULL').get())
      .toEqual({ amount_idr: '-1600', refund_of_source_id: 'TX-1' });
    expect(db.prepare('SELECT reason, count(*) count FROM record_deduplications GROUP BY reason ORDER BY reason').all())
      .toEqual([{ reason: 'manual_invoice', count: 1 }, { reason: 'manual_vendor_a_ref', count: 1 }]);
    expect(db.prepare('SELECT count(*) count FROM transactions').get()?.count).toBe(8);
    const firstTotal = total();
    expect(firstTotal).toBe('83250');

    const second = await runImports(db, resolver(), getRates(db), options);
    expect(second.map(report => [report.source, report.accepted, report.duplicate, report.review])).toEqual([
      ['vendor_a', 0, 2, 0], ['vendor_b', 0, 3, 0], ['vendor_c', 0, 1, 0], ['manual', 0, 5, 0],
    ]);
    expect(db.prepare('SELECT count(*) count FROM transactions').get()?.count).toBe(8);
    expect(total()).toBe(firstTotal);
  });

  it('records one failed source clearly without reporting it as succeeded', async () => {
    const vendorC = vi.fn<typeof fetch>().mockResolvedValue(response({ error: 'unauthorized' }, 401));
    const reports = await runImports(db, resolver(), getRates(db), {
      dataDir, sources: ['vendor_c'], vendorC: { baseUrl: 'http://vendor-c.test', apiKey: 'bad', fetchImpl: vendorC },
    });
    expect(reports[0]).toMatchObject({ source: 'vendor_c', status: 'failed', read: 0, error: expect.stringContaining('API key') });
    expect(db.prepare('SELECT status, error FROM import_runs').get()).toMatchObject({ status: 'failed', error: expect.stringContaining('API key') });
  });

  it('recovers safely after a partial source failure without duplicating accepted rows', async () => {
    writeFileSync(join(dataDir, 'vendor_b.csv'), [
      'line_id,time_utc,workspace,product,usd_amount',
      'L-1,01-09-2026 01:00,GLW-03,Voice,$2.00',
      'L-1,01-09-2026 02:00,GLW-03,Voice,$3.00',
    ].join('\n'));
    const options = {
      dataDir, sources: ['vendor_b' as const],
      vendorC: { baseUrl: 'http://unused.test', apiKey: 'unused' },
    };
    const failed = await runImports(db, resolver(), getRates(db), options);
    expect(failed[0]).toMatchObject({ status: 'partial', read: 2, accepted: 1, error: expect.stringContaining('Konflik identitas') });
    expect(db.prepare('SELECT count(*) count FROM transactions').get()?.count).toBe(1);

    writeFileSync(join(dataDir, 'vendor_b.csv'), [
      'line_id,time_utc,workspace,product,usd_amount',
      'L-1,01-09-2026 01:00,GLW-03,Voice,$2.00',
      'L-2,01-09-2026 02:00,GLW-03,Voice,$3.00',
    ].join('\n'));
    const recovered = await runImports(db, resolver(), getRates(db), options);
    expect(recovered[0]).toMatchObject({ status: 'succeeded', read: 2, accepted: 1, duplicate: 1, review: 0 });
    expect(db.prepare('SELECT count(*) count FROM transactions').get()?.count).toBe(2);
  });
});
