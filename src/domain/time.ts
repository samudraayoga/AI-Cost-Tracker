import { DateTime } from 'luxon';

export type TimestampSource = 'vendor_a' | 'vendor_b' | 'vendor_c' | 'manual';
export type TimestampInput = string | number | Date;

export interface TimestampOptions {
  /** Override a timezone-less source. Vendor CSVs default to UTC; manual data to WIB. */
  sourceZone?: string;
  excelDateSystem?: '1900' | '1904';
}

export interface NormalizedTimestamp {
  occurredAtUtc: string;
  occurredAtWib: string;
  dateWib: string;
  weekStartWib: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const WIB = 'UTC+7';
const MILLISECONDS_PER_DAY = 86_400_000;
const CLOCK = '(\\d{1,2}):(\\d{2})(?::(\\d{2})(?:\\.(\\d{1,3}))?)?';
const OPTIONAL_CLOCK = `(?:[ T]${CLOCK})?`;
const MONTHS: Record<string, number> = {
  jan: 1, januari: 1, january: 1,
  feb: 2, februari: 2, february: 2,
  mar: 3, maret: 3, march: 3,
  apr: 4, april: 4,
  mei: 5, may: 5,
  jun: 6, juni: 6, june: 6,
  jul: 7, juli: 7, july: 7,
  agu: 8, agt: 8, agustus: 8, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};

function invalid(reason: string): never {
  throw new Error(`Invalid timestamp: ${reason}`);
}

function wallTime(parts: DateParts, zone: string): DateTime {
  if (
    parts.hour < 0 || parts.hour > 23 ||
    parts.minute < 0 || parts.minute > 59 ||
    parts.second < 0 || parts.second > 59 ||
    parts.millisecond < 0 || parts.millisecond > 999
  ) {
    invalid('clock is out of range');
  }
  const result = DateTime.fromObject(parts, { zone, locale: 'en' });
  if (!result.isValid) invalid(result.invalidExplanation ?? 'invalid calendar date or zone');
  // Luxon can move a nonexistent DST wall time forward. Reject that silent correction.
  for (const key of Object.keys(parts) as Array<keyof DateParts>) {
    if (result[key] !== parts[key]) invalid('wall time does not exist in the source zone');
  }
  if (result.getPossibleOffsets().length > 1) invalid('wall time is ambiguous in the source zone');
  return result;
}

function matchedParts(match: RegExpMatchArray, year: number, month: number, day: number): DateParts {
  return {
    year,
    month,
    day,
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
    millisecond: Number((match[7] ?? '0').padEnd(3, '0')),
  };
}

function parseVendorCsv(source: 'vendor_a' | 'vendor_b', value: string, zone: string): DateTime {
  const expression = source === 'vendor_a'
    ? new RegExp(`^(\\d{1,2})/(\\d{1,2})/(\\d{4}) ${CLOCK}$`)
    : new RegExp(`^(\\d{1,2})-(\\d{1,2})-(\\d{4}) ${CLOCK}$`);
  const match = value.match(expression);
  if (!match) invalid(`${source} requires ${source === 'vendor_a' ? 'MM/DD/YYYY' : 'DD-MM-YYYY'} HH:mm`);
  return wallTime(matchedParts(
    match,
    Number(match[3]),
    Number(match[source === 'vendor_a' ? 1 : 2]),
    Number(match[source === 'vendor_a' ? 2 : 1]),
  ), zone);
}

function parseVendorIso(value: string): DateTime {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/i,
  );
  if (!match) invalid('vendor_c requires an ISO timestamp with an explicit timezone');
  // Validate both calendar and clock before fromISO can normalize 24:00 to the next day.
  wallTime(matchedParts(match, Number(match[1]), Number(match[2]), Number(match[3])), 'UTC');
  const offset = match[8]!;
  if (offset.toUpperCase() !== 'Z') {
    const digits = offset.slice(1).replace(':', '');
    if (Number(digits.slice(0, 2)) > 23 || Number(digits.slice(2)) > 59) invalid('timezone offset is out of range');
  }
  const result = DateTime.fromISO(value, { setZone: true });
  if (!result.isValid) invalid(result.invalidExplanation ?? 'invalid ISO timestamp');
  return result;
}

function dateObjectParts(date: Date): DateParts {
  if (!Number.isFinite(date.getTime())) invalid('invalid Date object');
  // Excel readers can expose naive cells as Date objects. UTC components preserve the cell's wall time.
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
    millisecond: date.getUTCMilliseconds(),
  };
}

function parseExcelSerial(serial: number, dateSystem: '1900' | '1904', zone: string): DateTime {
  if (!Number.isFinite(serial) || serial < 0) invalid('Excel serial must be a finite non-negative number');
  const wholeDays = Math.floor(serial);
  if (dateSystem === '1900' && wholeDays === 60) invalid('Excel serial 60 represents nonexistent 1900-02-29');
  const epoch = dateSystem === '1904'
    ? DateTime.utc(1904, 1, 1)
    : DateTime.utc(1899, 12, 31);
  const adjustedDays = wholeDays - (dateSystem === '1900' && wholeDays > 60 ? 1 : 0);
  const clockMilliseconds = Math.round((serial - wholeDays) * MILLISECONDS_PER_DAY);
  const cell = epoch.plus({ days: adjustedDays, milliseconds: clockMilliseconds });
  if (!cell.isValid) invalid('Excel serial is outside the supported date range');
  return wallTime(dateObjectParts(cell.toJSDate()), zone);
}

function parseManualText(value: string, zone: string): DateTime {
  let match = value.match(new RegExp(`^(\\d{4})-(\\d{1,2})-(\\d{1,2})${OPTIONAL_CLOCK}$`));
  if (match) return wallTime(matchedParts(match, Number(match[1]), Number(match[2]), Number(match[3])), zone);

  match = value.match(new RegExp(`^(\\d{1,2})(?:/)(\\d{1,2})(?:/)(\\d{4})${OPTIONAL_CLOCK}$`))
    ?? value.match(new RegExp(`^(\\d{1,2})-(\\d{1,2})-(\\d{4})${OPTIONAL_CLOCK}$`));
  if (match) return wallTime(matchedParts(match, Number(match[3]), Number(match[2]), Number(match[1])), zone);

  match = value.match(new RegExp(`^(\\d{1,2})[ -]+([A-Za-z]+)\\.?[ -]+(\\d{4})${OPTIONAL_CLOCK}$`));
  if (match) {
    const month = MONTHS[match[2]!.toLowerCase()];
    if (typeof month !== 'number') invalid('unrecognized month name');
    return wallTime(matchedParts(match, Number(match[3]), month, Number(match[1])), zone);
  }
  return invalid('unrecognized manual date format');
}

/**
 * Normalize source timestamps without consulting the host timezone.
 * A's timestamp_utc and B's time_utc are UTC unless explicitly overridden.
 * Manual cells are WIB wall times; missing clocks mean midnight. C carries its own offset.
 * Numeric manual values are Excel serials, never Unix timestamps.
 */
export function normalizeTimestamp(
  source: TimestampSource,
  input: TimestampInput,
  options: TimestampOptions = {},
): NormalizedTimestamp {
  const zone = options.sourceZone ?? (source === 'manual' ? WIB : 'UTC');
  let date: DateTime;
  if (source === 'manual' && input instanceof Date) {
    date = wallTime(dateObjectParts(input), zone);
  } else if (source === 'manual' && typeof input === 'number') {
    date = parseExcelSerial(input, options.excelDateSystem ?? '1900', zone);
  } else {
    if (typeof input !== 'string' || input.trim() === '') invalid('expected a non-empty date string');
    const value = input.trim();
    switch (source) {
      case 'vendor_a':
      case 'vendor_b':
        date = parseVendorCsv(source, value, zone);
        break;
      case 'vendor_c':
        date = parseVendorIso(value);
        break;
      case 'manual':
        date = parseManualText(value, zone);
        break;
      default:
        return invalid('unknown timestamp source');
    }
  }
  // WIB is UTC+07:00, including when the input is an old Excel epoch date.
  const wib = date.setZone(WIB);
  return {
    occurredAtUtc: date.toUTC().toISO()!,
    occurredAtWib: wib.toISO()!,
    dateWib: wib.toISODate()!,
    weekStartWib: wib.minus({ days: wib.weekday - 1 }).toISODate()!,
  };
}
