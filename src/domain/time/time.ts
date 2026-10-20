// Instants and windows (02 §9, DEC-011). Instants are epoch milliseconds (UTC); windows are [from, to).
// Luxon is confined to this module (04 §3.1). Nothing here reads the clock.
import { DateTime } from 'luxon';

/** Milliseconds since the Unix epoch, UTC. */
export type Instant = number;

/** Half-open window: `from <= t < to`. */
export interface Window {
  readonly from: Instant;
  readonly to: Instant;
}

export type PeriodKind = 'DAY' | 'WEEK' | 'MONTH';

/** Bounds of the representable Date range; used for open-ended ("lifetime") windows. */
export const MIN_INSTANT: Instant = -8_640_000_000_000_000;
export const MAX_INSTANT: Instant = 8_640_000_000_000_000;

export function isValidTimeZone(zone: string): boolean {
  if (zone === '') return false;
  return DateTime.local({ zone }).isValid;
}

function zoned(instant: Instant, zone: string): DateTime {
  if (!Number.isFinite(instant)) throw new RangeError('Instant must be a finite number');
  const dt = DateTime.fromMillis(instant, { zone });
  if (!dt.isValid) throw new RangeError(`Invalid time zone or instant: ${zone}`);
  return dt;
}

export function inWindow(t: Instant, window: Window): boolean {
  return t >= window.from && t < window.to;
}

/** Window from the minimum instant up to (excluding) `to`. */
export function lifetimeWindow(to: Instant): Window {
  return { from: MIN_INSTANT, to };
}

/** Local calendar date ('YYYY-MM-DD') of an instant in the given IANA zone. */
export function localDateOf(instant: Instant, zone: string): string {
  return zoned(instant, zone).toFormat('yyyy-MM-dd');
}

/** Instant of local midnight at the start of a calendar date ('YYYY-MM-DD') in the zone. */
export function startOfLocalDay(date: string, zone: string): Instant {
  const dt = DateTime.fromISO(date, { zone }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !dt.isValid) {
    throw new RangeError(`Invalid date or time zone: ${date} ${zone}`);
  }
  return dt.toMillis();
}

/** The local calendar day as a window; 23 h or 25 h on DST-change days. */
export function dayWindow(date: string, zone: string): Window {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !start.isValid) {
    throw new RangeError(`Invalid date or time zone: ${date} ${zone}`);
  }
  return { from: start.toMillis(), to: start.plus({ days: 1 }).toMillis() };
}

/**
 * The limit period (day, week, month) containing `instant`, in the user's zone.
 * `weekStartsOn` is ISO: 1 = Monday … 7 = Sunday.
 */
export function periodWindow(
  kind: PeriodKind,
  instant: Instant,
  zone: string,
  weekStartsOn: number,
): Window {
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 1 || weekStartsOn > 7) {
    throw new RangeError('weekStartsOn must be an integer 1..7');
  }
  const dt = zoned(instant, zone);
  const day = dt.startOf('day');
  switch (kind) {
    case 'DAY':
      return { from: day.toMillis(), to: day.plus({ days: 1 }).toMillis() };
    case 'WEEK': {
      const back = (dt.weekday - weekStartsOn + 7) % 7;
      const start = day.minus({ days: back });
      return { from: start.toMillis(), to: start.plus({ days: 7 }).toMillis() };
    }
    case 'MONTH': {
      const start = dt.startOf('month');
      return { from: start.toMillis(), to: start.plus({ months: 1 }).toMillis() };
    }
  }
}
