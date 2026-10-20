import { describe, expect, it } from 'vitest';
import { normalizeTimestamp } from './time.js';

describe('normalizeTimestamp', () => {
  it('interprets the actual vendor UTC columns and their different date orders', () => {
    expect(normalizeTimestamp('vendor_a', '08/31/2026 12:13')).toEqual({
      occurredAtUtc: '2026-08-31T12:13:00.000Z',
      occurredAtWib: '2026-08-31T19:13:00.000+07:00',
      dateWib: '2026-08-31',
      weekStartWib: '2026-08-31',
    });
    expect(normalizeTimestamp('vendor_b', '30-08-2026 17:37')).toEqual({
      occurredAtUtc: '2026-08-30T17:37:00.000Z',
      occurredAtWib: '2026-08-31T00:37:00.000+07:00',
      dateWib: '2026-08-31',
      weekStartWib: '2026-08-31',
    });
    expect(normalizeTimestamp('vendor_a', '09/01/2026 10:00').dateWib).toBe('2026-09-01');
    expect(normalizeTimestamp('vendor_b', '09-01-2026 10:00').dateWib).toBe('2026-01-09');
    expect(() => normalizeTimestamp('vendor_a', '31/08/2026 10:00')).toThrow('Invalid timestamp');
    expect(() => normalizeTimestamp('vendor_b', '08/31/2026 10:00')).toThrow('Invalid timestamp');
  });

  it('assigns midnight and the Monday week boundary after conversion to WIB', () => {
    expect(normalizeTimestamp('vendor_c', '2026-08-30T16:59:59Z')).toEqual({
      occurredAtUtc: '2026-08-30T16:59:59.000Z',
      occurredAtWib: '2026-08-30T23:59:59.000+07:00',
      dateWib: '2026-08-30',
      weekStartWib: '2026-08-24',
    });
    expect(normalizeTimestamp('vendor_c', '2026-08-30T17:00:00Z')).toEqual({
      occurredAtUtc: '2026-08-30T17:00:00.000Z',
      occurredAtWib: '2026-08-31T00:00:00.000+07:00',
      dateWib: '2026-08-31',
      weekStartWib: '2026-08-31',
    });
  });

  it('honors explicit ISO offsets and preserves milliseconds', () => {
    expect(normalizeTimestamp('vendor_c', '2026-09-01T03:15:30.125-04:00')).toEqual({
      occurredAtUtc: '2026-09-01T07:15:30.125Z',
      occurredAtWib: '2026-09-01T14:15:30.125+07:00',
      dateWib: '2026-09-01',
      weekStartWib: '2026-08-31',
    });
    expect(normalizeTimestamp('vendor_c', '2026-09-01T07:00:00+0700').occurredAtUtc)
      .toBe('2026-09-01T00:00:00.000Z');
    expect(() => normalizeTimestamp('vendor_c', '2026-09-01T07:00:00')).toThrow('explicit timezone');
  });

  it.each([
    [46266, '2026-09-01'],
    ['1/9/2026', '2026-09-01'],
    ['2026-09-04', '2026-09-04'],
    ['14 Sep 2026', '2026-09-14'],
    ['01 Okt 2026', '2026-10-01'],
    ['4 oktober 2026', '2026-10-04'],
    ['05-10-2026', '2026-10-05'],
  ])('reads actual manual date form %s as midnight WIB', (input, date) => {
    const normalized = normalizeTimestamp('manual', input);
    expect(normalized.dateWib).toBe(date);
    expect(normalized.occurredAtWib).toBe(`${date}T00:00:00.000+07:00`);
  });

  it('interprets a manual Date using UTC components as spreadsheet wall time', () => {
    expect(normalizeTimestamp('manual', new Date(Date.UTC(2026, 8, 1, 9, 30, 12, 250)))).toEqual({
      occurredAtUtc: '2026-09-01T02:30:12.250Z',
      occurredAtWib: '2026-09-01T09:30:12.250+07:00',
      dateWib: '2026-09-01',
      weekStartWib: '2026-08-31',
    });
  });

  it('preserves fractional Excel time and handles both Excel epochs', () => {
    expect(normalizeTimestamp('manual', 46266.5).occurredAtWib)
      .toBe('2026-09-01T12:00:00.000+07:00');
    expect(normalizeTimestamp('manual', 46266 + 1 / 86_400).occurredAtWib)
      .toBe('2026-09-01T00:00:01.000+07:00');
    expect(normalizeTimestamp('manual', 44804, { excelDateSystem: '1904' }).dateWib)
      .toBe('2026-09-01');
    expect(normalizeTimestamp('manual', 0, { excelDateSystem: '1904', sourceZone: 'UTC' }).occurredAtUtc)
      .toBe('1904-01-01T00:00:00.000Z');
    expect(normalizeTimestamp('manual', 59, { sourceZone: 'UTC' }).dateWib).toBe('1900-02-28');
    expect(normalizeTimestamp('manual', 61, { sourceZone: 'UTC' }).dateWib).toBe('1900-03-01');
    expect(() => normalizeTimestamp('manual', 60)).toThrow('nonexistent 1900-02-29');
    expect(() => normalizeTimestamp('manual', 60.5)).toThrow('nonexistent 1900-02-29');
  });

  it('supports a configured source zone and rejects nonexistent DST wall times', () => {
    expect(normalizeTimestamp('vendor_a', '09/01/2026 01:00', { sourceZone: 'Asia/Jakarta' }).occurredAtUtc)
      .toBe('2026-08-31T18:00:00.000Z');
    expect(normalizeTimestamp('manual', '2026-09-01 09:15:30.25', { sourceZone: 'UTC' }).occurredAtWib)
      .toBe('2026-09-01T16:15:30.250+07:00');
    expect(() => normalizeTimestamp('manual', '2026-03-08 02:30', { sourceZone: 'America/New_York' }))
      .toThrow('wall time does not exist');
    expect(() => normalizeTimestamp('manual', '2026-11-01 01:30', { sourceZone: 'America/New_York' }))
      .toThrow('wall time is ambiguous');
    expect(() => normalizeTimestamp('manual', '2026-09-01', { sourceZone: 'Invalid/Zone' }))
      .toThrow('Invalid timestamp');
  });

  it('accepts real leap days and rejects impossible calendar dates', () => {
    expect(normalizeTimestamp('vendor_a', '02/29/2024 12:00').dateWib).toBe('2024-02-29');
    expect(normalizeTimestamp('manual', '29/02/2000').dateWib).toBe('2000-02-29');
    expect(() => normalizeTimestamp('manual', '29/02/1900')).toThrow('Invalid timestamp');
    expect(() => normalizeTimestamp('vendor_b', '29-02-2026 12:00')).toThrow('Invalid timestamp');
    expect(() => normalizeTimestamp('vendor_c', '2026-04-31T12:00:00Z')).toThrow('Invalid timestamp');
    expect(() => normalizeTimestamp('manual', '31 Sep 2026')).toThrow('Invalid timestamp');
  });

  it.each([
    '', 'tomorrow', '2026-13-01', '2026-09-00', '2026-09-01 24:00',
    '2026-09-01 12:60', '2026-09-01 12:00:60', '01 Unknown 2026', '01 constructor 2026',
  ])('rejects invalid manual input %s without Date.parse guessing', (input) => {
    expect(() => normalizeTimestamp('manual', input)).toThrow('Invalid timestamp');
  });

  it.each([
    '2026-09-01T24:00:00Z', '2026-09-01T00:00:00+25:00',
    '2026-09-01T00:00:00+07:60', '2026-09-01',
  ])('rejects invalid vendor ISO input %s', (input) => {
    expect(() => normalizeTimestamp('vendor_c', input)).toThrow('Invalid timestamp');
  });

  it('rejects invalid Excel values and non-string vendor values', () => {
    for (const input of [NaN, Infinity, -1, new Date(NaN)]) {
      expect(() => normalizeTimestamp('manual', input)).toThrow('Invalid timestamp');
    }
    expect(() => normalizeTimestamp('vendor_a', 46266)).toThrow('date string');
    expect(() => normalizeTimestamp('vendor_c', new Date())).toThrow('date string');
  });
});
