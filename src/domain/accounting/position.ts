// 02 §5: balance, open stake (at cost), and equity at an instant.
import { platformDelta } from './contribution';
import { isOpenAt, prepare, resolvePlatforms, type Prepared } from './prepare';
import type { LedgerData, PositionAmounts, PositionSnapshot } from './types';

export function positionFromPrepared(
  prep: Prepared,
  t: number,
  platformIds: readonly string[],
): PositionSnapshot {
  const slots = new Map<string, { balance: bigint; openStake: bigint }>();
  for (const id of platformIds) slots.set(id, { balance: 0n, openStake: 0n });
  for (const e of prep.data.entries) {
    const slot = slots.get(e.platformId);
    if (slot && e.occurredAt <= t) slot.balance += platformDelta(e);
  }
  for (const { bet, sums } of prep.betRows) {
    const slot = slots.get(bet.platformId);
    if (slot && isOpenAt(bet, t)) slot.openStake += sums.stake;
  }
  const byPlatform: Record<string, PositionAmounts> = {};
  let totalBalance = 0n;
  let totalOpen = 0n;
  for (const [id, slot] of slots) {
    byPlatform[id] = {
      balance: slot.balance,
      openStake: slot.openStake,
      equity: slot.balance + slot.openStake,
    };
    totalBalance += slot.balance;
    totalOpen += slot.openStake;
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
