import { Decimal } from 'decimal.js';

export type MoneyInput = string | number;
export type CostSource = 'vendor_a' | 'vendor_b' | 'vendor_c' | 'manual';
export type OriginalUnit = 'credits' | 'USD' | 'USD_cents' | 'IDR';

export interface Rates {
  creditsToIdr: string;
  usdToIdr: string;
}

export interface NormalizedAmount {
  originalAmount: string;
  originalUnit: OriginalUnit;
  amountIdr: string;
  rateToIdr: string;
}

// Each accepted operand has at most 40 digits and 20 decimal places. Products
// therefore need at most 80 significant digits. Dividing the USD rate by 100
// only shifts its decimal point; precision 100 preserves every accepted digit.
// Clone rather than changing decimal.js settings for the rest of the app.
const ExactDecimal = Decimal.clone({ precision: 100 });
const MAX_DIGITS = 40;
const MAX_DECIMAL_PLACES = 20;

function invalid(label: string): never {
  throw new TypeError(`Invalid ${label} amount: use the source's documented numeric format.`);
}

function canonical(value: string, label: string): string {
  const decimal = new ExactDecimal(value);
  const result = decimal.isZero() ? '0' : decimal.toFixed();
  const digitCount = result.replace(/[-.]/g, '').replace(/^0+/, '').length;
  if (digitCount > MAX_DIGITS || decimal.decimalPlaces() > MAX_DECIMAL_PLACES) {
    throw new RangeError(`${label} amount exceeds 40 digits or 20 decimal places; pass an exact supported value.`);
  }
  return result;
}

function numeric(input: MoneyInput, label: string): string | undefined {
  if (typeof input !== 'number') return undefined;
  if (!Number.isFinite(input)) return invalid(label);
  if (Math.abs(input) > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} number exceeds the safe integer range; supply a decimal string.`);
  }
  // Number.toString() supplies the value received from a numeric spreadsheet
  // cell. No floating-point multiplication or division is performed here.
  return canonical(input.toString(), label);
}

function text(input: MoneyInput, label: string): string {
  if (typeof input !== 'string' || input.length > 256) return invalid(label);
  const value = input.trim();
  if (!value) return invalid(label);
  return value;
}

function removeCurrency(value: string, symbol: 'Rp' | '$', label: string): string {
  let negative = false;
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1).trimStart();
  }
  const hasSymbol = symbol === 'Rp' ? /^rp/i.test(value) : value.startsWith('$');
  if (hasSymbol) {
    value = value.slice(symbol.length).trimStart();
    if (value.startsWith('-')) {
      if (negative) return invalid(label);
      negative = true;
      value = value.slice(1).trimStart();
    }
  }
  return `${negative ? '-' : ''}${value}`;
}

/** IDR text uses Indonesian grouping/decimals; numeric cells keep their value. */
export function parseIdr(input: MoneyInput): string {
  const number = numeric(input, 'IDR');
  if (number !== undefined) return number;
  const value = removeCurrency(text(input, 'IDR'), 'Rp', 'IDR');
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(value)) return invalid('IDR');
  return canonical(value.replace(/\./g, '').replace(',', '.'), 'IDR');
}

/** USD text uses a decimal point and optional comma thousands separators. */
export function parseUsd(input: MoneyInput): string {
  const number = numeric(input, 'USD');
  if (number !== undefined) return number;
  const value = removeCurrency(text(input, 'USD'), '$', 'USD');
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return invalid('USD');
  return canonical(value.replace(/,/g, ''), 'USD');
}

/** Credits use ungrouped decimal-point notation, without a currency symbol. */
export function parseCredits(input: MoneyInput): string {
  const number = numeric(input, 'credits');
  if (number !== undefined) return number;
  const value = text(input, 'credits');
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return invalid('credits');
  return canonical(value, 'credits');
}

/** Vendor C reports a whole number of USD cents, including negative refunds. */
export function parseUsdCents(input: MoneyInput): string {
  const number = numeric(input, 'USD cents');
  if (number !== undefined) {
    if (!Number.isInteger(input)) return invalid('USD cents');
    return number;
  }
  const value = text(input, 'USD cents');
  if (!/^-?\d+$/.test(value)) return invalid('USD cents');
  return canonical(value, 'USD cents');
}

function rate(input: string, label: string): string {
  if (typeof input !== 'string' || input.length > 256 || !/^\d+(?:\.\d+)?$/.test(input)) {
    throw new TypeError(`Invalid ${label} rate: expected a positive ungrouped decimal string.`);
  }
  const value = canonical(input, label);
  if (!new ExactDecimal(value).isPositive() || value === '0') {
    throw new RangeError(`${label} rate must be greater than zero.`);
  }
  return value;
}

export function normalizeAmount(source: CostSource, input: MoneyInput, rates: Rates): NormalizedAmount {
  let originalAmount: string;
  let originalUnit: OriginalUnit;
  let rateToIdr: string;
  switch (source) {
    case 'vendor_a':
      originalAmount = parseCredits(input);
      originalUnit = 'credits';
      rateToIdr = rate(rates.creditsToIdr, 'credits/IDR');
      break;
    case 'vendor_b':
      originalAmount = parseUsd(input);
      originalUnit = 'USD';
      rateToIdr = rate(rates.usdToIdr, 'USD/IDR');
      break;
    case 'vendor_c':
      originalAmount = parseUsdCents(input);
      originalUnit = 'USD_cents';
      rateToIdr = new ExactDecimal(rate(rates.usdToIdr, 'USD/IDR')).dividedBy(100).toFixed();
      break;
    case 'manual':
      originalAmount = parseIdr(input);
      originalUnit = 'IDR';
      rateToIdr = '1';
      break;
    default:
      throw new TypeError(`Unknown cost source: ${String(source)}`);
  }
  const amount = new ExactDecimal(originalAmount).times(rateToIdr);
  return {
    originalAmount,
    originalUnit,
    amountIdr: amount.isZero() ? '0' : amount.toFixed(),
    rateToIdr,
  };
}
