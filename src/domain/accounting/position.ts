// 02 §5: balance, open stake (at cost), and equity at an instant.
import { platformDelta } from './contribution';
import { isOpenAt, prepare, resolvePlatforms, type Prepared } from './prepare';
import type { LedgerData, PositionAmounts, PositionSnapshot } from './types';

export function positionFromPrepared(
  prep: Prepared,
  t: number,
  platformIds: readonly string[],
): PositionSnapshot {
  const included = new Set(platformIds);
  const balance = new Map<string, bigint>();
  const openStake = new Map<string, bigint>();
  for (const id of platformIds) {
    balance.set(id, 0n);
    openStake.set(id, 0n);
  }
  for (const e of prep.data.entries) {
    if (e.occurredAt <= t && included.has(e.platformId)) {
      balance.set(e.platformId, (balance.get(e.platformId) ?? 0n) + platformDelta(e));
    }
  }
  for (const b of prep.data.bets) {
    if (!included.has(b.platformId) || !isOpenAt(b, t)) continue;
    const stake = prep.betSums.get(b.id)?.stake ?? 0n;
    openStake.set(b.platformId, (openStake.get(b.platformId) ?? 0n) + stake);
  }
  const byPlatform: Record<string, PositionAmounts> = {};
  let totalBalance = 0n;
  let totalOpen = 0n;
  for (const id of platformIds) {
    const bal = balance.get(id) ?? 0n;
    const open = openStake.get(id) ?? 0n;
    byPlatform[id] = { balance: bal, openStake: open, equity: bal + open };
    totalBalance += bal;
    totalOpen += open;
  }
  return {
    at: t,
    total: { balance: totalBalance, openStake: totalOpen, equity: totalBalance + totalOpen },
    byPlatform,
  };
}

/** Position at instant `t` (inclusive) for the given platforms (default: all). */
export function positionAt(
  data: LedgerData,
  t: number,
  platformIds?: readonly string[],
): PositionSnapshot {
  if (!Number.isFinite(t)) throw new RangeError('t must be a finite instant');
  const prep = prepare(data);
  return positionFromPrepared(prep, t, resolvePlatforms(prep, platformIds));
}
