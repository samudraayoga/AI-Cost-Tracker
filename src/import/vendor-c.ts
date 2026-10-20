import type { SourceRecord } from './types.js';

export class VendorCError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

interface VendorCRecord {
  id: string;
  created_at: string;
  project: string;
  service: string;
  amount_usd_cents: number;
}

export interface VendorCFetchOptions {
  baseUrl: string;
  apiKey: string;
  perPage?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

function retryAfterMilliseconds(value: string | null, now = Date.now()): number {
  if (!value) return 1_000;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 1_000;
}

function validateRecord(value: unknown, page: number, index: number): VendorCRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new VendorCError(`Vendor C halaman ${page} record ${index + 1} bukan object.`);
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id || typeof row.created_at !== 'string' ||
      typeof row.project !== 'string' || typeof row.service !== 'string' ||
      typeof row.amount_usd_cents !== 'number' || !Number.isSafeInteger(row.amount_usd_cents)) {
    throw new VendorCError(`Vendor C halaman ${page} record ${index + 1} memiliki field tidak valid.`);
  }
  return row as unknown as VendorCRecord;
}

export async function fetchVendorC(options: VendorCFetchOptions): Promise<SourceRecord[]> {
  if (!options.apiKey) throw new VendorCError('VENDOR_C_API_KEY belum diisi.');
  const perPage = options.perPage ?? 100;
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new VendorCError('Vendor C perPage harus integer 1–100.');
  const request = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maxRetries = options.maxRetries ?? 4;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const all: VendorCRecord[] = [];
  let page = 1;
  let expectedTotal: number | undefined;
  while (true) {
    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      response = undefined;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL('/v1/usage', options.baseUrl);
        url.searchParams.set('page', String(page));
        url.searchParams.set('per_page', String(perPage));
        response = await request(url, { headers: { Authorization: `Bearer ${options.apiKey}` }, signal: controller.signal });
        if (response.status === 429 && attempt < maxRetries) {
          await sleep(retryAfterMilliseconds(response.headers.get('Retry-After')));
          continue;
        }
        if (response.status >= 500 && attempt < maxRetries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        break;
      } catch (error) {
        lastError = error;
        if (attempt >= maxRetries) break;
        await sleep(250 * 2 ** attempt);
      } finally {
        clearTimeout(timeout);
      }
    }
    if (!response) throw new VendorCError(`Vendor C tidak dapat dihubungi setelah ${maxRetries + 1} percobaan: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    if (!response.ok) {
      const body = await response.text();
      const message = response.status === 401 ? 'API key Vendor C ditolak (401).'
        : response.status === 400 ? `Parameter Vendor C ditolak (400): ${body}`
        : `Vendor C gagal setelah batas retry: HTTP ${response.status} ${body}`;
      throw new VendorCError(message, response.status);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new VendorCError(`Vendor C halaman ${page} bukan JSON valid.`); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new VendorCError(`Vendor C halaman ${page} memiliki bentuk respons tidak valid.`);
    const result = body as Record<string, unknown>;
    if (!Array.isArray(result.data) || result.page !== page || typeof result.total !== 'number' || !Number.isSafeInteger(result.total) ||
        typeof result.has_more !== 'boolean' || typeof result.per_page !== 'number') {
      throw new VendorCError(`Vendor C halaman ${page} kehilangan metadata pagination yang valid.`);
    }
    if (expectedTotal === undefined) expectedTotal = result.total;
    if (expectedTotal !== result.total) throw new VendorCError('Total Vendor C berubah selama pagination.');
    all.push(...result.data.map((value, index) => validateRecord(value, page, index)));
    if (!result.has_more) break;
    if (result.data.length === 0 || page > 10_000) throw new VendorCError('Pagination Vendor C tidak bergerak maju.');
    page += 1;
  }
  if (all.length !== expectedTotal) throw new VendorCError(`Vendor C melaporkan ${expectedTotal} record tetapi mengirim ${all.length}.`);
  return all.map((row, index) => ({ draft: {
    source: 'vendor_c', sourceRecordId: row.id, sourceFile: 'GET /v1/usage', sourceRow: index + 1,
    timestamp: row.created_at, projectLabel: row.project, vendor: 'Vendor C', amount: row.amount_usd_cents,
    reference: row.service,
  } }));
}
