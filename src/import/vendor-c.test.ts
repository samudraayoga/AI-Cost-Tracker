import { describe, expect, it, vi } from 'vitest';
import { fetchVendorC, VendorCError } from './vendor-c.js';

const row = (id: number) => ({
  id: `vc_${id}`, created_at: '2026-09-01T00:00:00Z', project: 'KMD-02',
  service: 'music.generate', amount_usd_cents: id,
});
const json = (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' }, ...init,
});

describe('Vendor C HTTP pagination and retry', () => {
  it('fetches all 103 records before returning source drafts', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: Array.from({ length: 100 }, (_, index) => row(index + 1)), page: 1, per_page: 100, total: 103, has_more: true }))
      .mockResolvedValueOnce(json({ data: [row(101), row(102), row(103)], page: 2, per_page: 100, total: 103, has_more: false }));
    const records = await fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: request });
    expect(records).toHaveLength(103);
    expect(request).toHaveBeenCalledTimes(2);
    expect(String((request.mock.calls as unknown[][])[1]?.[0])).toContain('page=2');
    expect(records[102]?.draft).toMatchObject({ sourceRecordId: 'vc_103', amount: 103 });
  });

  it('honors Retry-After for 429 and retries 5xx with bounded backoff', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(json({}, { status: 500 }))
      .mockResolvedValueOnce(json({ data: [row(1)], page: 1, per_page: 100, total: 1, has_more: false }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    await expect(fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: request, sleep })).resolves.toHaveLength(1);
    expect(sleep.mock.calls.map(call => call[0])).toEqual([2000, 500]);
  });

  it('reports 401 immediately with a clear credential error', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'no' }, { status: 401 }));
    await expect(fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: 'bad', fetchImpl: request })).rejects.toThrow('API key');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports invalid API parameters without retrying', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ message: 'bad page' }, { status: 400 }));
    await expect(fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: request })).rejects.toThrow('Parameter Vendor C');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports the final error after the retry limit', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ error: 'temporary' }, { status: 500 }));
    await expect(fetchVendorC({
      baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: request,
      maxRetries: 2, sleep: async () => undefined,
    })).rejects.toMatchObject({ status: 500 } satisfies Partial<VendorCError>);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid credentials configuration and inconsistent pagination', async () => {
    await expect(fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: '' })).rejects.toThrow('belum diisi');
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ data: [row(1)], page: 1, per_page: 100, total: 2, has_more: false }));
    await expect(fetchVendorC({ baseUrl: 'http://vendor-c.test', apiKey: 'test', fetchImpl: request })).rejects.toThrow('melaporkan 2');
  });
});
