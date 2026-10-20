// Exact INR arithmetic in integer paise (02 §2, INV-ACC-01, INV-ACC-15). No floats anywhere in this file.

export type Paise = bigint;

/** ₹10,000,000,000 — the per-entry upper bound (DEC-002). */
export const MAX_AMOUNT_PAISE: Paise = 1_000_000_000_000n;

export type MoneyParseErrorCode =
  | 'EMPTY'
  | 'INVALID_FORMAT'
  | 'TOO_MANY_DECIMALS'
  | 'NEGATIVE'
  | 'ZERO_NOT_ALLOWED'
  | 'OUT_OF_RANGE';

export type MoneyParseResult =
  | { readonly ok: true; readonly value: Paise }
  | { readonly ok: false; readonly code: MoneyParseErrorCode };

export interface MoneyParseOptions {
  /** Inclusive lower bound in paise. Default 1n (amounts must be positive). Use 0n for fees/openings. */
  readonly min?: Paise;
  /** Inclusive upper bound in paise. Default MAX_AMOUNT_PAISE. */
  readonly max?: Paise;
}

// Digits with optional grouping: western (1,234,567) or Indian (12,34,567); at least one integer digit.
const INTEGER_PART = /^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})$/;
const FRACTION_PART = /^\d+$/;

/**
 * Parses a decimal rupee string to paise by string manipulation only.
 * Accepts: "123456.50", "1,23,456.5", "1,234,567.89", surrounding whitespace.
 * Rejects: more than two decimals (never rounds), exponents, signs other than a leading minus
 * (reported as NEGATIVE), currency symbols, empty, ".5", "5.", and malformed grouping.
 */
export function parseRupees(input: string, options: MoneyParseOptions = {}): MoneyParseResult {
  const min = options.min ?? 1n;
  const max = options.max ?? MAX_AMOUNT_PAISE;
  let text = input.trim();
  if (text === '') return { ok: false, code: 'EMPTY' };

  let negative = false;
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true;
    text = text.slice(1);
  }

  const [integerPart, fractionPart, ...rest] = text.split('.');
  if (rest.length > 0 || integerPart === undefined || !INTEGER_PART.test(integerPart)) {
    return { ok: false, code: 'INVALID_FORMAT' };
  }
  if (fractionPart !== undefined && !FRACTION_PART.test(fractionPart)) {
    return { ok: false, code: 'INVALID_FORMAT' };
  }
  if (negative) return { ok: false, code: 'NEGATIVE' };
  if (fractionPart !== undefined && fractionPart.length > 2) {
    return { ok: false, code: 'TOO_MANY_DECIMALS' };
  }

  const rupees = BigInt(integerPart.replaceAll(',', ''));
  const paise = BigInt((fractionPart ?? '').padEnd(2, '0') || '0');
  const value = rupees * 100n + paise;

  if (value === 0n && min > 0n) return { ok: false, code: 'ZERO_NOT_ALLOWED' };
  if (value < min || value > max) return { ok: false, code: 'OUT_OF_RANGE' };
  return { ok: true, value };
}

function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const head = digits.slice(0, -3);
  const tail = digits.slice(-3);
  return `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}`;
}

function splitPaise(value: Paise): { negative: boolean; rupees: string; paise: string } {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  return {
    negative,
    rupees: (abs / 100n).toString(),
    paise: (abs % 100n).toString().padStart(2, '0'),
  };
}

export interface FormatOptions {
  /** 'always' prefixes '+' to positive values (zero never gets a sign). Default 'auto'. */
  readonly sign?: 'auto' | 'always';
}

/** "₹1,23,456.78" (en-IN grouping); negatives get a leading minus: "-₹5.00". */
export function formatINR(value: Paise, options: FormatOptions = {}): string {
  const { negative, rupees, paise } = splitPaise(value);
  const body = `₹${groupIndian(rupees)}.${paise}`;
  if (negative) return `-${body}`;
  if (options.sign === 'always' && value > 0n) return `+${body}`;
  return body;
}

/** Plain decimal rupees for exports: "123456.50", "-10.05". Exact for any bigint. */
export function paiseToDecimal(value: Paise): string {
  const { negative, rupees, paise } = splitPaise(value);
  return `${negative ? '-' : ''}${rupees}.${paise}`;
}

/** Integer division rounding half away from zero. Throws RangeError if the divisor is zero. */
export function divRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (2n * n + d) / (2n * d);
  return negative ? -q : q;
}

/** numerator/denominator in basis points, half away from zero; null when the denominator is zero. */
export function ratioBps(numerator: bigint, denominator: bigint): bigint | null {
  if (denominator === 0n) return null;
  return divRoundHalfAwayFromZero(numerator * 10_000n, denominator);
}

/** 1667n → "16.67%"; null → "—" (P-3: unknown is never shown as zero). */
export function formatBps(bps: bigint | null): string {
  if (bps === null) return '—';
  const negative = bps < 0n;
  const abs = negative ? -bps : bps;
  return `${negative ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}%`;
}
