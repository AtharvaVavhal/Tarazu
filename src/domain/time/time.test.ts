import { DateTime } from 'luxon';
import {
  MAX_INSTANT,
  MIN_INSTANT,
  dayWindow,
  inWindow,
  isValidTimeZone,
  lifetimeWindow,
  localDateOf,
  periodWindow,
  startOfLocalDay,
} from './time';

const utc = (iso: string): number => DateTime.fromISO(iso, { zone: 'utc' }).toMillis();
const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

describe('time zones (02 §9, DEC-011)', () => {
  it('validates IANA zone names', () => {
    expect(isValidTimeZone(IST)).toBe(true);
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });

  it('finds the local calendar date of an instant', () => {
    expect(localDateOf(utc('2026-01-31T18:29:59.999Z'), IST)).toBe('2026-01-31');
    expect(localDateOf(utc('2026-01-31T18:30:00.000Z'), IST)).toBe('2026-02-01');
    expect(localDateOf(utc('2026-03-09T03:59:59.999Z'), NY)).toBe('2026-03-08');
    expect(localDateOf(utc('2026-03-09T04:00:00.000Z'), NY)).toBe('2026-03-09');
  });

  it('computes local midnight for a calendar date', () => {
    expect(startOfLocalDay('2026-02-01', IST)).toBe(utc('2026-01-31T18:30:00Z'));
    expect(startOfLocalDay('2026-03-08', NY)).toBe(utc('2026-03-08T05:00:00Z')); // EST
    expect(startOfLocalDay('2026-03-09', NY)).toBe(utc('2026-03-09T04:00:00Z')); // EDT
  });

  it('rejects invalid dates and zones', () => {
    expect(() => startOfLocalDay('2026-02-30', IST)).toThrow();
    expect(() => startOfLocalDay('not-a-date', IST)).toThrow();
    expect(() => startOfLocalDay('2026-02-01', 'Mars/Phobos')).toThrow();
    expect(() => dayWindow('2026-02-30', IST)).toThrow();
    expect(() => dayWindow('2026-02-01', 'Mars/Phobos')).toThrow();
    expect(() => localDateOf(Number.NaN, IST)).toThrow();
    expect(() => localDateOf(0, 'Mars/Phobos')).toThrow();
  });
});

describe('windows are half-open [from, to)', () => {
  it('includes from and excludes to', () => {
    const w = { from: 10, to: 20 };
    expect(inWindow(9, w)).toBe(false);
    expect(inWindow(10, w)).toBe(true);
    expect(inWindow(19, w)).toBe(true);
    expect(inWindow(20, w)).toBe(false);
  });

  it('builds a day window in IST (24 h) and across US DST changes (23 h / 25 h)', () => {
    const ist = dayWindow('2026-01-31', IST);
    expect(ist).toEqual({ from: utc('2026-01-30T18:30:00Z'), to: utc('2026-01-31T18:30:00Z') });

    const spring = dayWindow('2026-03-08', NY); // clocks jump forward: 23-hour day
    expect(spring).toEqual({ from: utc('2026-03-08T05:00:00Z'), to: utc('2026-03-09T04:00:00Z') });
    expect((spring.to - spring.from) / 3_600_000).toBe(23);

    const fall = dayWindow('2026-11-01', NY); // clocks fall back: 25-hour day
    expect(fall).toEqual({ from: utc('2026-11-01T04:00:00Z'), to: utc('2026-11-02T05:00:00Z') });
    expect((fall.to - fall.from) / 3_600_000).toBe(25);
  });

  it('assigns the last millisecond of a day and the first of the next to different days', () => {
    const jan31 = dayWindow('2026-01-31', IST);
    expect(inWindow(utc('2026-01-31T18:29:59.999Z'), jan31)).toBe(true);
    expect(inWindow(utc('2026-01-31T18:30:00.000Z'), jan31)).toBe(false);
  });
});

describe('periodWindow (limit periods, 02 §6.5)', () => {
  const wed = utc('2026-01-21T06:30:00Z'); // Wednesday 12:00 IST

  it('DAY', () => {
    expect(periodWindow('DAY', wed, IST, 1)).toEqual(dayWindow('2026-01-21', IST));
  });

  it('WEEK honours the week start (ISO 1 = Monday … 7 = Sunday)', () => {
    expect(periodWindow('WEEK', wed, IST, 1)).toEqual({
      from: startOfLocalDay('2026-01-19', IST),
      to: startOfLocalDay('2026-01-26', IST),
    });
    expect(periodWindow('WEEK', wed, IST, 7)).toEqual({
      from: startOfLocalDay('2026-01-18', IST),
      to: startOfLocalDay('2026-01-25', IST),
    });
    expect(periodWindow('WEEK', wed, IST, 3)).toEqual({
      from: startOfLocalDay('2026-01-21', IST),
      to: startOfLocalDay('2026-01-28', IST),
    });
  });

  it('WEEK on the week-start day itself starts that day', () => {
    const monday = utc('2026-01-19T00:00:00Z');
    expect(periodWindow('WEEK', monday, IST, 1).from).toBe(startOfLocalDay('2026-01-19', IST));
  });

  it('MONTH runs from the first local midnight to the next month first local midnight', () => {
    expect(periodWindow('MONTH', utc('2026-02-15T00:00:00Z'), IST, 1)).toEqual({
      from: startOfLocalDay('2026-02-01', IST),
      to: startOfLocalDay('2026-03-01', IST),
    });
    expect(periodWindow('MONTH', utc('2026-12-31T10:00:00Z'), IST, 1).to).toBe(
      startOfLocalDay('2027-01-01', IST),
    );
  });

  it('rejects an out-of-range week start', () => {
    expect(() => periodWindow('WEEK', wed, IST, 0)).toThrow();
    expect(() => periodWindow('WEEK', wed, IST, 8)).toThrow();
  });
});

describe('lifetimeWindow', () => {
  it('starts at the minimum instant and ends at the given instant', () => {
    expect(lifetimeWindow(1000)).toEqual({ from: MIN_INSTANT, to: 1000 });
    expect(MIN_INSTANT).toBeLessThan(0);
    expect(MAX_INSTANT).toBeGreaterThan(utc('3000-01-01T00:00:00Z'));
  });
});
