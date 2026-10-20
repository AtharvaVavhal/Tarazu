// 02 §6: all metric families for a filter (platform set × half-open window).
import { divRoundHalfAwayFromZero, ratioBps } from '../money/money';
import { bankDelta, signedAmount, signedFee } from './contribution';
import { isOpenAt, prepare, resolvePlatforms } from './prepare';
import { positionFromPrepared } from './position';
import type { LedgerData, Metrics, MetricsFilter } from './types';

export function metricsFor(data: LedgerData, filter: MetricsFilter): Metrics {
  const { from, to } = filter;
  if (!Number.isFinite(from) || !Number.isFinite(to))
    throw new RangeError('window bounds must be finite');
  if (from >= to) throw new RangeError('window must satisfy from < to');
  const prep = prepare(data);
  const platformIds = resolvePlatforms(prep, filter.platformIds);
  const included = new Set(platformIds);
  const inWindow = (t: number) => t >= from && t < to;

  let deposited = 0n;
  let withdrawn = 0n;
  let feesOnDeposits = 0n;
  let feesOnWithdrawals = 0n;
  let netCash = 0n;
  let openings = 0n;
  let transfersNet = 0n;
  let betCommissions = 0n;
  let platformFees = 0n;
  let bonusesNet = 0n;
  let adjustmentsNet = 0n;

  for (const e of data.entries) {
    if (!included.has(e.platformId) || !inWindow(e.occurredAt)) continue;
    const s = signedAmount(e);
    netCash += bankDelta(e);
    switch (e.type) {
      case 'DEPOSIT':
        deposited += s;
        feesOnDeposits += signedFee(e);
        break;
      case 'WITHDRAWAL':
        withdrawn += s;
        feesOnWithdrawals += signedFee(e);
        break;
      case 'OPENING_BALANCE':
        openings += s;
        break;
      case 'TRANSFER_IN':
        transfersNet += s;
        break;
      case 'TRANSFER_OUT':
        transfersNet -= s;
        break;
      case 'FEE':
      case 'FEE_REFUND': {
        const cost = e.type === 'FEE' ? s : -s;
        if (e.feeKind === 'BET_COMMISSION') betCommissions += cost;
        else platformFees += cost;
        break;
      }
      case 'BONUS_CREDIT':
        bonusesNet += s;
        break;
      case 'BONUS_FORFEIT':
        bonusesNet -= s;
        break;
      case 'ADJUSTMENT_CREDIT':
        adjustmentsNet += s;
        break;
      case 'ADJUSTMENT_DEBIT':
        adjustmentsNet -= s;
        break;
      case 'BET_STAKE':
      case 'BET_PAYOUT':
      case 'BET_REFUND':
        break; // betting performance is derived per bet below
    }
  }

  let gross = 0n;
  let turnover = 0n;
  let betsPlaced = 0;
  let settledCount = 0;
  let voidCount = 0;
  let openCount = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  const asOfEnd = to - 1;
  for (const b of data.bets) {
    if (!included.has(b.platformId) || b.status === 'ANNULLED') continue;
    const sums = prep.betSums.get(b.id);
    if (!sums) continue;
    if (inWindow(b.placedAt)) betsPlaced += 1;
    if (isOpenAt(b, asOfEnd)) openCount += 1;
    if (b.settledAt === null || !inWindow(b.settledAt)) continue;
    if (b.status === 'VOID') {
      voidCount += 1;
    } else if (b.status === 'SETTLED') {
      settledCount += 1;
      gross += sums.payout + sums.refund - sums.stake;
      turnover += sums.stake;
      const r = sums.payout - sums.stake;
      if (r > 0n) wins += 1;
      else if (r < 0n) losses += 1;
      else pushes += 1;
    }
  }

  const frictionFees = feesOnDeposits + feesOnWithdrawals;
  const netBettingResult = gross - betCommissions;
  const allInTotal =
    gross - betCommissions - platformFees + bonusesNet + adjustmentsNet - frictionFees;

  return {
    window: { from, to },
    platformIds,
    external: {
      deposited,
      withdrawn,
      netDeposited: deposited - withdrawn,
      frictionFeesOnDeposits: feesOnDeposits,
      frictionFeesOnWithdrawals: feesOnWithdrawals,
      frictionFees,
      netCash,
    },
    neutral: { openings, transfersNet },
    betting: {
      grossBettingResult: gross,
      turnover,
      betCommissions,
      netBettingResult,
      betsPlaced,
      settledCount,
      voidCount,
      openCount,
      wins,
      losses,
      pushes,
      hitRateBps: ratioBps(BigInt(wins), BigInt(wins + losses)),
      yieldBps: ratioBps(netBettingResult, turnover),
      avgStake:
        settledCount === 0 ? null : divRoundHalfAwayFromZero(turnover, BigInt(settledCount)),
    },
    costs: { platformFees, bonusesNet, adjustmentsNet },
    position: {
      start: positionFromPrepared(prep, from - 1, platformIds),
      end: positionFromPrepared(prep, to - 1, platformIds),
    },
    allIn: {
      grossBettingResult: gross,
      betCommissions,
      platformFees,
      bonusesNet,
      adjustmentsNet,
      frictionFees,
      total: allInTotal,
    },
  };
}
