import fc from 'fast-check';
import {
  MAX_AMOUNT_PAISE,
  divRoundHalfAwayFromZero,
  formatBps,
  formatINR,
  paiseToDecimal,
  parseRupees,
  ratioBps,
} from './money';

const ok = (input: string, opts?: Parameters<typeof parseRupees>[1]) => {
  const r = parseRupees(input, opts);
  if (!r.ok) throw new Error(`expected ${input} to parse, got ${r.code}`);
  return r.value;
};
const code = (input: string, opts?: Parameters<typeof parseRupees>[1]) => {
  const r = parseRupees(input, opts);
  return r.ok ? 'OK' : r.code;
};

describe('parseRupees (AC-LEDG-05, INV-ACC-01)', () => {
  it('parses plain and grouped rupee strings to exact paise', () => {
    expect(ok('123456.50')).toBe(12345650n);
    expect(ok('1,23,456.5')).toBe(12345650n); // lakh grouping from AC-LEDG-05
    expect(ok('1,234,567.89')).toBe(123456789n); // western grouping
    expect(ok('5')).toBe(500n);
    expect(ok('0.07')).toBe(7n);
    expect(ok('0.5')).toBe(50n);
    expect(ok(' 10.00 ')).toBe(1000n);
    expect(ok('1.5')).toBe(150n);
    expect(ok('1000')).toBe(100000n);
  });

  it('is exact where floating point is not (0.1 + 0.2 style traps)', () => {
    expect(ok('0.1') + ok('0.2')).toBe(ok('0.3'));
    expect(ok('4.35')).toBe(435n);
  });

  it('rejects more than two decimal places instead of rounding', () => {
    expect(code('1.234')).toBe('TOO_MANY_DECIMALS');
    expect(code('1.500')).toBe('TOO_MANY_DECIMALS');
  });

  it('rejects exponent notation, signs, symbols, and malformed text', () => {
    expect(code('1e3')).toBe('INVALID_FORMAT');
    expect(code('1E3')).toBe('INVALID_FORMAT');
    expect(code('₹')).toBe('INVALID_FORMAT');
    expect(code('₹5')).toBe('INVALID_FORMAT');
    expect(code('abc')).toBe('INVALID_FORMAT');
    expect(code('1,,2')).toBe('INVALID_FORMAT');
    expect(code(',100')).toBe('INVALID_FORMAT');
    expect(code('100,')).toBe('INVALID_FORMAT');
    expect(code('12,34')).toBe('INVALID_FORMAT'); // not a valid lakh or western grouping
    expect(code('1,23.4,5')).toBe('INVALID_FORMAT');
    expect(code('.5')).toBe('INVALID_FORMAT');
    expect(code('5.')).toBe('INVALID_FORMAT');
    expect(code('1 000')).toBe('INVALID_FORMAT');
    expect(code('１２')).toBe('INVALID_FORMAT'); // non-ASCII digits
    expect(code('+5')).toBe('INVALID_FORMAT');
    expect(code('Infinity')).toBe('INVALID_FORMAT');
    expect(code('NaN')).toBe('INVALID_FORMAT');
  });

  it('rejects empty input', () => {
    expect(code('')).toBe('EMPTY');
    expect(code('   ')).toBe('EMPTY');
  });

  it('rejects negatives (hyphen-minus and U+2212)', () => {
    expect(code('-5')).toBe('NEGATIVE');
    expect(code('−5')).toBe('NEGATIVE');
    expect(code('-0')).toBe('NEGATIVE');
    expect(code('-abc')).toBe('INVALID_FORMAT');
  });

  it('enforces 1 ≤ amount ≤ 10^12 paise by default', () => {
    expect(code('0')).toBe('ZERO_NOT_ALLOWED');
    expect(code('0.00')).toBe('ZERO_NOT_ALLOWED');
    expect(ok('0.01')).toBe(1n);
    expect(ok('10000000000')).toBe(MAX_AMOUNT_PAISE); // ₹10,000,000,000
    expect(ok('10,00,00,00,000')).toBe(MAX_AMOUNT_PAISE);
    expect(code('10000000000.01')).toBe('OUT_OF_RANGE');
    expect(code('99999999999999999999999999')).toBe('OUT_OF_RANGE');
  });

  it('allows zero when min is 0 (fees, opening and reported balances)', () => {
    expect(ok('0', { min: 0n })).toBe(0n);
    expect(ok('0.00', { min: 0n })).toBe(0n);
    expect(code('-1', { min: 0n })).toBe('NEGATIVE');
  });

  it('honours a custom max', () => {
    expect(code('5.01', { max: 500n })).toBe('OUT_OF_RANGE');
    expect(ok('5.00', { max: 500n })).toBe(500n);
  });

  it('round-trips any in-range paise through paiseToDecimal and formatINR digits', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_AMOUNT_PAISE }), (p) => {
        expect(ok(paiseToDecimal(p), { min: 0n })).toBe(p);
        const grouped = formatINR(p).replace('₹', '');
        expect(ok(grouped, { min: 0n })).toBe(p);
      }),
    );
  });
});

describe('formatting', () => {
  it('formats paise in en-IN grouping with rupee sign', () => {
    expect(formatINR(0n)).toBe('₹0.00');
    expect(formatINR(5n)).toBe('₹0.05');
    expect(formatINR(100n)).toBe('₹1.00');
    expect(formatINR(99999n)).toBe('₹999.99');
    expect(formatINR(100000n)).toBe('₹1,000.00');
    expect(formatINR(12345678n)).toBe('₹1,23,456.78');
    expect(formatINR(1_000_000_000_000n)).toBe('₹10,00,00,00,000.00');
  });

  it('puts a leading minus on negatives and supports explicit plus', () => {
    expect(formatINR(-12345678n)).toBe('-₹1,23,456.78');
    expect(formatINR(2000n, { sign: 'always' })).toBe('+₹20.00');
    expect(formatINR(-2000n, { sign: 'always' })).toBe('-₹20.00');
    expect(formatINR(0n, { sign: 'always' })).toBe('₹0.00');
  });

  it('produces a plain decimal string for exports', () => {
    expect(paiseToDecimal(12345650n)).toBe('123456.50');
    expect(paiseToDecimal(5n)).toBe('0.05');
    expect(paiseToDecimal(-1005n)).toBe('-10.05');
    expect(paiseToDecimal(0n)).toBe('0.00');
    expect(paiseToDecimal(10n ** 20n)).toBe('1000000000000000000.00'); // beyond 2^53, exact
  });
});

describe('rounding and ratios (02 §2, INV-ACC-15)', () => {
  it('rounds half away from zero for positive and negative numerators', () => {
    expect(divRoundHalfAwayFromZero(1n, 2n)).toBe(1n);
    expect(divRoundHalfAwayFromZero(-1n, 2n)).toBe(-1n);
    expect(divRoundHalfAwayFromZero(3n, 2n)).toBe(2n);
    expect(divRoundHalfAwayFromZero(-3n, 2n)).toBe(-2n);
    expect(divRoundHalfAwayFromZero(1n, 3n)).toBe(0n);
    expect(divRoundHalfAwayFromZero(2n, 3n)).toBe(1n);
    expect(divRoundHalfAwayFromZero(-2n, 3n)).toBe(-1n);
    expect(divRoundHalfAwayFromZero(7n, -2n)).toBe(-4n);
    expect(divRoundHalfAwayFromZero(-7n, -2n)).toBe(4n);
    expect(divRoundHalfAwayFromZero(0n, 5n)).toBe(0n);
    expect(divRoundHalfAwayFromZero(4n, 2n)).toBe(2n);
  });

  it('throws on a zero divisor for the raw helper', () => {
    expect(() => divRoundHalfAwayFromZero(1n, 0n)).toThrow(RangeError);
  });

  it('computes basis points and returns null for a zero denominator', () => {
    expect(ratioBps(25000n, 150000n)).toBe(1667n); // EX-10: 16.67 %
    expect(ratioBps(1n, 2n)).toBe(5000n);
    expect(ratioBps(-25000n, 150000n)).toBe(-1667n);
    expect(ratioBps(0n, 7n)).toBe(0n);
    expect(ratioBps(5n, 0n)).toBeNull();
    expect(ratioBps(0n, 0n)).toBeNull();
    expect(ratioBps(1n, 20000n)).toBe(1n); // 0.5 bps rounds away from zero
    expect(ratioBps(-1n, 20000n)).toBe(-1n);
  });

  it('is exact for values beyond 2^53', () => {
    const big = 9_007_199_254_740_993n; // 2^53 + 1
    expect(ratioBps(big, big)).toBe(10000n);
  });

  it('formats basis points as percent with two decimals', () => {
    expect(formatBps(1667n)).toBe('16.67%');
    expect(formatBps(-1667n)).toBe('-16.67%');
    expect(formatBps(5n)).toBe('0.05%');
    expect(formatBps(0n)).toBe('0.00%');
    expect(formatBps(10000n)).toBe('100.00%');
    expect(formatBps(null)).toBe('—');
  });
});
