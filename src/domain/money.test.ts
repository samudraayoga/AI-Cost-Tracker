import { describe, expect, it } from 'vitest';
import {
  normalizeAmount,
  parseCredits,
  parseIdr,
  parseUsd,
  parseUsdCents,
  type CostSource,
  type MoneyInput,
  type Rates,
} from './money.js';

const rates: Rates = { creditsToIdr: '160', usdToIdr: '16250' };

describe('source-specific amount parsing', () => {
  it.each([
    ['Rp 1.850.000', '1850000'],
    ['47.040', '47040'],
    [47040, '47040'],
    [47.04, '47.04'],
    [' Rp 1.850.000,1250 ', '1850000.125'],
    ['47,040', '47.04'],
    ['-Rp 47.040,25', '-47040.25'],
    ['Rp -47.040,25', '-47040.25'],
    ['0000,00', '0'],
    [-0, '0'],
  ] as const)('parses IDR %j as %s', (input, expected) => {
    expect(parseIdr(input)).toBe(expected);
  });

  it.each([
    ['$2.00', '2'],
    [' 1,234.567 ', '1234.567'],
    ['-$ 2.50', '-2.5'],
    ['$ -2.50', '-2.5'],
    [0.1, '0.1'],
    [0.0000001, '0.0000001'],
  ] as const)('parses USD %j as %s', (input, expected) => {
    expect(parseUsd(input)).toBe(expected);
  });

  it('accepts fractional credits and whole signed cents', () => {
    expect(parseCredits('0001.2500')).toBe('1.25');
    expect(parseCredits(-0.25)).toBe('-0.25');
    expect(parseUsdCents('-250')).toBe('-250');
    expect(parseUsdCents(250)).toBe('250');
  });

  const invalidInputs: Array<[string, (input: MoneyInput) => string, MoneyInput[]]> = [
    ['IDR', parseIdr, ['1.85', '1,850,000', '1.850.00', '1,850.00', 'Rp', '--1', '-Rp -1', '1 000', '$ 10']],
    ['USD', parseUsd, ['1,23', '1.234,56', '$$', '--1', '-$ -1', '2.', '.5', 'Rp 10']],
    ['credits', parseCredits, ['1,000', '$1', '1e3', '1.2.3']],
    ['USD cents', parseUsdCents, ['2.5', '250.0', '1,000', 2.5, '$250']],
  ];
  it.each(invalidInputs)('rejects malformed or wrong-locale %s input', (_label, parse, inputs) => {
    for (const input of inputs) expect(() => parse(input), String(input)).toThrow();
  });

  it.each([parseIdr, parseUsd, parseCredits, parseUsdCents])('rejects nonvalues and unsafe numeric inputs', (parse) => {
    for (const input of ['', ' ', 'NaN', 'Infinity', '1e3', Number.NaN, Infinity, -Infinity]) {
      expect(() => parse(input)).toThrow();
    }
    expect(() => parse(Number.MAX_SAFE_INTEGER + 1)).toThrow(/safe integer/);
    expect(() => parse(null as unknown as MoneyInput)).toThrow();
    expect(() => parse(true as unknown as MoneyInput)).toThrow();
  });

  it('accepts exact strings beyond safe integer range and rejects unsupported precision', () => {
    expect(parseCredits('9007199254740993')).toBe('9007199254740993');
    expect(parseCredits('0.00000000000000000001')).toBe('0.00000000000000000001');
    expect(() => parseCredits('0.000000000000000000001')).toThrow(/20 decimal places/);
    expect(() => parseCredits('1'.repeat(41))).toThrow(/40 digits/);
    expect(() => parseCredits('1'.repeat(257))).toThrow();
  });
});

describe('IDR conversion using supplied rates', () => {
  it.each([
    ['vendor_a', '100', 'credits', '16000', '160'],
    ['vendor_b', '$2.00', 'USD', '32500', '16250'],
    ['vendor_c', 250, 'USD_cents', '40625', '162.5'],
    ['manual', 'Rp 47.040,125', 'IDR', '47040.125', '1'],
  ] as const)('converts %s without losing source units', (source, input, unit, amountIdr, rateToIdr) => {
    const result = normalizeAmount(source, input, rates);
    expect(result).toMatchObject({ originalUnit: unit, amountIdr, rateToIdr });
  });

  it('returns normalized original amount for tracing independent of display formatting', () => {
    expect(normalizeAmount('vendor_b', '$2.00', rates)).toEqual({
      originalAmount: '2', originalUnit: 'USD', amountIdr: '32500', rateToIdr: '16250',
    });
  });

  it.each([
    ['vendor_a', '-100', '-16000'],
    ['vendor_b', '-$2', '-32500'],
    ['vendor_c', -250, '-40625'],
    ['manual', '-47.040,125', '-47040.125'],
  ] as const)('keeps %s refunds negative', (source, input, expected) => {
    expect(normalizeAmount(source, input, rates).amountIdr).toBe(expected);
  });

  it('reads custom rates and preserves fractions smaller than one Rupiah', () => {
    const customRates = { creditsToIdr: '0.2', usdToIdr: '123.456' };
    expect(normalizeAmount('vendor_a', '0.1', customRates).amountIdr).toBe('0.02');
    expect(normalizeAmount('vendor_b', '0.01', customRates).amountIdr).toBe('1.23456');
    expect(normalizeAmount('vendor_c', 1, customRates).amountIdr).toBe('1.23456');
    expect(normalizeAmount('manual', '0,125', customRates).amountIdr).toBe('0.125');
  });

  it('retains every digit when multiplying maximum supported operands', () => {
    const operand = '9999999999999999999999999999999999999999';
    const expected = (BigInt(operand) * BigInt(operand)).toString();
    expect(normalizeAmount('vendor_a', operand, { ...rates, creditsToIdr: operand }).amountIdr).toBe(expected);
  });

  it('keeps sub-cent exchange rates exact', () => {
    expect(normalizeAmount('vendor_c', 1, { ...rates, usdToIdr: '0.00000000000000000001' })).toEqual({
      originalAmount: '1', originalUnit: 'USD_cents',
      amountIdr: '0.0000000000000000000001', rateToIdr: '0.0000000000000000000001',
    });
  });

  it.each(['0', '-1', 'NaN', 'Infinity', '16,250', '$16250', '1e3'])('rejects invalid conversion rate %s', (invalidRate) => {
    expect(() => normalizeAmount('vendor_a', 1, { ...rates, creditsToIdr: invalidRate })).toThrow();
    expect(() => normalizeAmount('vendor_b', 1, { ...rates, usdToIdr: invalidRate })).toThrow();
    expect(() => normalizeAmount('vendor_c', 1, { ...rates, usdToIdr: invalidRate })).toThrow();
  });

  it('rejects an unknown source instead of silently assuming IDR', () => {
    expect(() => normalizeAmount('other' as CostSource, '1', rates)).toThrow(/Unknown cost source/);
  });
});
