import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { readVendorA, readVendorB } from './csv.js';
import { readManualSpreadsheet } from './manual.js';

const directories: string[] = [];
function directory() { const value = mkdtempSync(join(tmpdir(), 'cost-sources-')); directories.push(value); return value; }
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('file source adapters', () => {
  it('reads source-specific CSV fields and refund references', async () => {
    const dir = directory();
    const a = join(dir, 'vendor_a.csv');
    const b = join(dir, 'vendor_b.csv');
    writeFileSync(a, 'transaction_id,timestamp_utc,project_tag,model,job_type,credits,ref_transaction_id\nTX-1,09/01/2026 00:00,KMD-02,m,image,10,\nTX-2,09/02/2026 00:00,KMD-02,m,refund,-10,TX-1\n');
    writeFileSync(b, 'line_id,time_utc,workspace,product,usd_amount\nL-1,01-09-2026 00:00,KMD-02,Voice,$2.00\n');
    expect((await readVendorA(a)).map(value => value.draft)).toMatchObject([
      { sourceRecordId: 'TX-1', amount: '10' },
      { sourceRecordId: 'TX-2', amount: '-10', refundOfSourceId: 'TX-1' },
    ]);
    expect((await readVendorB(b))[0]?.draft).toMatchObject({ sourceRecordId: 'L-1', amount: '$2.00', reference: 'Voice' });
  });

  it('rejects a CSV with a changed or incomplete header', async () => {
    const path = join(directory(), 'vendor_a.csv');
    writeFileSync(path, 'transaction_id,timestamp\nTX-1,now\n');
    await expect(readVendorA(path)).rejects.toThrow('header harus persis');
  });

  it('finds the spreadsheet header and ignores title, blanks and TOTAL', async () => {
    const path = join(directory(), 'manual_ops.xlsx');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rekap');
    sheet.addRow(['Judul']); sheet.addRow([]);
    sheet.addRow(['Tanggal', 'Project', 'Tool / Vendor', 'Keterangan', 'Nominal', 'Ref']);
    sheet.addRow([new Date('2026-09-01T00:00:00Z'), 'KMD-02', 'Stock Music', 'License INV-1', 'Rp 1.000']);
    sheet.addRow([]);
    sheet.addRow([null, null, null, 'TOTAL', 1000]);
    await workbook.xlsx.writeFile(path);
    const records = await readManualSpreadsheet(path);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ invoice: 'INV-1', explicitReference: null });
    expect(records[0]?.draft.timestamp).toBeInstanceOf(Date);
  });
});
