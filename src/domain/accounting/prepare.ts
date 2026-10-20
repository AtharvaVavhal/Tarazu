// Validated, indexed view of a dataset, cached per input object. Internal to the accounting module.
import { assertValidData } from './validate';
import { AccountingInputError, type Bet, type LedgerData, type LedgerEntry } from './types';
import { signedAmount } from './contribution';

export interface BetSums {
  /** Σ* BET_STAKE (live stake). */
  readonly stake: bigint;
  /** Σ* BET_PAYOUT. */
  readonly payout: bigint;
  /** Σ* BET_REFUND. */
  readonly refund: bigint;
  /** Σ* FEE(BET_COMMISSION) − Σ* FEE_REFUND(BET_COMMISSION). */
  readonly commission: bigint;
}

export interface Prepared {
  readonly data: LedgerData;
  readonly platformIds: readonly string[];
  readonly platformSet: ReadonlySet<string>;
  readonly entriesByBet: ReadonlyMap<string, readonly LedgerEntry[]>;
  /** Every bet with its ledger-derived sums, in input order. */
  readonly betRows: readonly { readonly bet: Bet; readonly sums: BetSums }[];
}

const cache = new WeakMap<LedgerData, Prepared>();

export function prepare(data: LedgerData): Prepared {
  const hit = cache.get(data);
  if (hit) return hit;
  assertValidData(data);
  const entriesByBet = new Map<string, LedgerEntry[]>();
  for (const e of data.entries) {
    if (e.betId === null) continue;
    const list = entriesByBet.get(e.betId);
    if (list) list.push(e);
    else entriesByBet.set(e.betId, [e]);
  }
  const betRows: { bet: Bet; sums: BetSums }[] = [];
  for (const b of data.bets) {
    let stake = 0n;
    let payout = 0n;
    let refund = 0n;
    let commission = 0n;
    for (const e of entriesByBet.get(b.id) ?? []) {
      const s = signedAmount(e);
      if (e.type === 'BET_STAKE') stake += s;
      else if (e.type === 'BET_PAYOUT') payout += s;
      else if (e.type === 'BET_REFUND') refund += s;
      else if (e.feeKind === 'BET_COMMISSION') commission += e.type === 'FEE' ? s : -s;
    }
    betRows.push({ bet: b, sums: { stake, payout, refund, commission } });
  }
  const prepared: Prepared = {
    data,
    platformIds: data.platforms.map((p) => p.id),
    platformSet: new Set(data.platforms.map((p) => p.id)),
    entriesByBet,
    betRows,
  };
  cache.set(data, prepared);
  return prepared;
}

/**
 * Resolves a platform filter: omitted = all platforms; duplicates collapse; unknown ids are an error.
 * The result is sorted so outputs do not depend on input order (INV-ACC-04).
 */
export function resolvePlatforms(prep: Prepared, ids: readonly string[] | undefined): string[] {
  return resolveUnsorted(prep, ids).sort();
}

function resolveUnsorted(prep: Prepared, ids: readonly string[] | undefined): string[] {
  if (ids === undefined) return [...prep.platformIds];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!prep.platformSet.has(id)) {
      throw new AccountingInputError([
        {
          invariant: '02§6',
          rule: 'UNKNOWN_PLATFORM',
          entityId: id,
          detail: `unknown platform ${id}`,
        },
      ]);
    }
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** 02 §5: a bet is open at `t` if placed by then and not yet closed by a (non-OPEN) settlement. */
export function isOpenAt(b: Bet, t: number): boolean {
  return b.placedAt <= t && !(b.status !== 'OPEN' && b.settledAt !== null && b.settledAt <= t);
}
