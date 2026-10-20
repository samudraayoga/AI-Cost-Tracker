import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { SourceRecord } from './types.js';

function rows(text: string, expectedHeaders: string[], sourceName: string): string[][] {
  const parsed = parse(text, { bom: true, skip_empty_lines: true, trim: true }) as string[][];
  const headers = parsed.shift();
  if (!headers || headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) {
    throw new Error(`${sourceName}: header harus persis ${expectedHeaders.join(', ')}.`);
  }
  for (const [index, row] of parsed.entries()) {
    if (row.length !== expectedHeaders.length) throw new Error(`${sourceName} baris ${index + 2}: jumlah kolom tidak sesuai header.`);
  }
  return parsed;
}

export async function readVendorA(path: string): Promise<SourceRecord[]> {
  const sourceFile = basename(path);
  return rows(await readFile(path, 'utf8'), [
    'transaction_id', 'timestamp_utc', 'project_tag', 'model', 'job_type', 'credits', 'ref_transaction_id',
  ], sourceFile).map((row, index) => ({ draft: {
    source: 'vendor_a', sourceRecordId: row[0]!, sourceFile, sourceRow: index + 2,
    timestamp: row[1]!, projectLabel: row[2]!, vendor: 'Vendor A', amount: row[5]!,
    ...(row[4] ? { reference: row[4] } : {}), ...(row[6] ? { refundOfSourceId: row[6] } : {}),
  } }));
}

export async function readVendorB(path: string): Promise<SourceRecord[]> {
  const sourceFile = basename(path);
  return rows(await readFile(path, 'utf8'), [
    'line_id', 'time_utc', 'workspace', 'product', 'usd_amount',
  ], sourceFile).map((row, index) => ({ draft: {
    source: 'vendor_b', sourceRecordId: row[0]!, sourceFile, sourceRow: index + 2,
    timestamp: row[1]!, projectLabel: row[2]!, vendor: 'Vendor B', amount: row[4]!, ...(row[3] ? { reference: row[3] } : {}),
  } }));
}
