import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import ExcelJS from 'exceljs';
import type { ManualSourceRecord } from './types.js';

const REQUIRED_HEADERS = ['Tanggal', 'Project', 'Tool / Vendor', 'Keterangan', 'Nominal', 'Ref'];

function primitive(value: ExcelJS.CellValue): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) return value;
  if (typeof value === 'object' && 'result' in value) return primitive(value.result as ExcelJS.CellValue);
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) {
    return value.richText.map(part => part.text).join('');
  }
  throw new Error('Spreadsheet memuat tipe sel yang tidak didukung.');
}

function text(value: string | number | Date | null): string {
  return value === null ? '' : String(value).trim();
}

function stableValue(value: string | number | Date | null): unknown {
  return value instanceof Date ? { type: 'date', value: value.toISOString() } : { type: typeof value, value };
}

export async function readManualSpreadsheet(path: string): Promise<ManualSourceRecord[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sourceFile = basename(path);
  const output: ManualSourceRecord[] = [];
  for (const sheet of workbook.worksheets) {
    let headerRow = 0;
    sheet.eachRow((row, rowNumber) => {
      const values = REQUIRED_HEADERS.map((_, index) => text(primitive(row.getCell(index + 1).value)));
      if (values.every((value, index) => value === REQUIRED_HEADERS[index])) headerRow = rowNumber;
    });
    if (!headerRow) throw new Error(`${sourceFile}/${sheet.name}: header transaksi tidak ditemukan.`);
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const values = REQUIRED_HEADERS.map((_, index) => primitive(row.getCell(index + 1).value));
      if (values.every(value => value === null || text(value) === '')) continue;
      const [date = null, project = null, tool = null, rawDescription = null, nominal = null, rawReference = null] = values;
      if (text(rawDescription).toUpperCase() === 'TOTAL' || text(date).toUpperCase() === 'TOTAL') continue;
      const description = text(rawDescription);
      const invoice = description.match(/\bINV-\d+\b/i)?.[0]?.toUpperCase() ?? null;
      const explicitReference = text(rawReference) || null;
      const sourceRecordId = `manual-${createHash('sha256').update(JSON.stringify(values.map(stableValue))).digest('hex')}`;
      output.push({
        invoice,
        explicitReference,
        draft: {
          source: 'manual', sourceRecordId, sourceFile, sourceRow: rowNumber,
          timestamp: date as string | number | Date,
          projectLabel: project, vendor: text(tool),
          amount: nominal as string | number,
          ...(explicitReference ?? invoice ? { reference: (explicitReference ?? invoice)! } : {}),
        },
      });
    }
  }
  return output;
}
