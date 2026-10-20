// Deliberately naive reference implementation of 02 §5–§6 (07 §3.1 property 8). Straight loops that
// restate the spec text; no shared code with the engine. Output is flattened to strings for comparison.
import type { LedgerData, LedgerEntry } from '@/domain/accounting';

const sign = (e: LedgerEntry): bigint => (e.isReversal ? -1n : 1n);

function ledgerSum(
  entries: readonly LedgerEntry[],
  pred: (e: LedgerEntry) => boolean,
  val: (e: LedgerEntry) => bigint,
) {
  let total = 0n;
  for (const e of entries) if (pred(e)) total += sign(e) * val(e);
  return total;
}

const plusTypes = [
  'OPENING_BALANCE',
  'DEPOSIT',
  'TRANSFER_IN',
  'BET_PAYOUT',
  'BET_REFUND',
  'FEE_REFUND',
  'BONUS_CREDIT',
  'ADJUSTMENT_CREDIT',
];

function delta(e: LedgerEntry): bigint {
  return sign(e) * (plusTypes.includes(e.type) ? e.amount : -e.amount);
}
function bank(e: LedgerEntry): bigint {
  if (e.type === 'DEPOSIT') return sign(e) * -(e.amount + e.fee);
  if (e.type === 'WITHDRAWAL') return sign(e) * (e.amount - e.fee);
  return 0n;
}

export interface OracleInput {
  data: LedgerData;
  platformIds?: readonly string[] | undefined;
  from: number;
  to: number;
}

function ratio(n: bigint, d: bigint): bigint | null {
  if (d === 0n) return null;
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  // round half away from zero of an*10000/ad
  const num = an * 10000n;
  let q = num / ad;
  if ((num % ad) * 2n >= ad) q += 1n;
  return neg ? -q : q;
}

function positionAt(data: LedgerData, t: number, plats: string[]) {
  const out: Record<string, { balance: string; openStake: string; equity: string }> = {};
  let tb = 0n;
  let to = 0n;
  for (const p of plats) {
    let balance = 0n;
    for (const e of data.entries) if (e.platformId === p && e.occurredAt <= t) balance += delta(e);
    let open = 0n;
    for (const b of data.bets) {
      if (b.platformId !== p) continue;
      const closedByT = b.status !== 'OPEN' && b.settledAt !== null && b.settledAt <= t;
      if (b.placedAt <= t && !closedByT) {
        open += ledgerSum(
          data.entries,
          (e) => e.betId === b.id && e.type === 'BET_STAKE',
          (e) => e.amount,
        );
      }
    }
    out[p] = { balance: String(balance), openStake: String(open), equity: String(balance + open) };
    tb += balance;
    to += open;
  }
  return {
    total: { balance: String(tb), openStake: String(to), equity: String(tb + to) },
    byPlatform: out,
  };
}

export function oracle({
  data,
  platformIds,
  from,
  to,
}: OracleInput): Record<string, string | null> {
  const plats = platformIds ? [...platformIds] : data.platforms.map((p) => p.id);
  const inP = (id: string) => plats.includes(id);
  const win = (t: number) => t >= from && t < to;
  const E = data.entries.filter((e) => inP(e.platformId) && win(e.occurredAt));

  const D = ledgerSum(
    E,
    (e) => e.type === 'DEPOSIT',
    (e) => e.amount,
  );
  const W = ledgerSum(
    E,
    (e) => e.type === 'WITHDRAWAL',
    (e) => e.amount,
  );
  const Fd = ledgerSum(
    E,
    (e) => e.type === 'DEPOSIT',
    (e) => e.fee,
  );
  const Fw = ledgerSum(
    E,
    (e) => e.type === 'WITHDRAWAL',
    (e) => e.fee,
  );
  const netCash = E.reduce((s, e) => s + bank(e), 0n);
  const O = ledgerSum(
    E,
    (e) => e.type === 'OPENING_BALANCE',
    (e) => e.amount,
  );
  const T =
    ledgerSum(
      E,
      (e) => e.type === 'TRANSFER_IN',
      (e) => e.amount,
    ) -
    ledgerSum(
      E,
      (e) => e.type === 'TRANSFER_OUT',
      (e) => e.amount,
    );
  const Cb =
    ledgerSum(
      E,
      (e) => e.type === 'FEE' && e.feeKind === 'BET_COMMISSION',
      (e) => e.amount,
    ) -
    ledgerSum(
      E,
      (e) => e.type === 'FEE_REFUND' && e.feeKind === 'BET_COMMISSION',
      (e) => e.amount,
    );
  const Cp =
    ledgerSum(
      E,
      (e) => e.type === 'FEE' && e.feeKind === 'PLATFORM_FEE',
      (e) => e.amount,
    ) -
    ledgerSum(
      E,
      (e) => e.type === 'FEE_REFUND' && e.feeKind === 'PLATFORM_FEE',
      (e) => e.amount,
    );
  const Bn =
    ledgerSum(
      E,
      (e) => e.type === 'BONUS_CREDIT',
      (e) => e.amount,
    ) -
    ledgerSum(
      E,
      (e) => e.type === 'BONUS_FORFEIT',
      (e) => e.amount,
    );
  const A =
    ledgerSum(
      E,
      (e) => e.type === 'ADJUSTMENT_CREDIT',
      (e) => e.amount,
    ) -
    ledgerSum(
      E,
      (e) => e.type === 'ADJUSTMENT_DEBIT',
      (e) => e.amount,
    );

  let G = 0n;
  let turnover = 0n;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let settledCount = 0;
  let voidCount = 0;
  let betsPlaced = 0;
  for (const b of data.bets) {
    if (!inP(b.platformId)) continue;
    const stake = ledgerSum(
      data.entries,
      (e) => e.betId === b.id && e.type === 'BET_STAKE',
      (e) => e.amount,
    );
    const payout = ledgerSum(
      data.entries,
      (e) => e.betId === b.id && e.type === 'BET_PAYOUT',
      (e) => e.amount,
    );
    const refund = ledgerSum(
      data.entries,
      (e) => e.betId === b.id && e.type === 'BET_REFUND',
      (e) => e.amount,
    );
    if (b.status !== 'ANNULLED' && win(b.placedAt)) betsPlaced += 1;
    if (b.status === 'VOID' && b.settledAt !== null && win(b.settledAt)) voidCount += 1;
    if (b.status === 'SETTLED' && b.settledAt !== null && win(b.settledAt)) {
      settledCount += 1;
      G += payout + refund - stake;
      turnover += stake;
      const r = payout - stake;
      if (r > 0n) wins += 1;
      else if (r < 0n) losses += 1;
      else pushes += 1;
    }
  }
  let openCount = 0;
  for (const b of data.bets) {
    if (!inP(b.platformId) || b.status === 'ANNULLED') continue;
    const t = to - 1;
    const closedByT = b.status !== 'OPEN' && b.settledAt !== null && b.settledAt <= t;
    if (b.placedAt <= t && !closedByT) openCount += 1;
  }

  const netBetting = G - Cb;
  const allIn = G - Cb - Cp + Bn + A - (Fd + Fw);
  const start = positionAt(data, from - 1, plats);
  const end = positionAt(data, to - 1, plats);
  const flat: Record<string, string | null> = {
    'external.deposited': String(D),
    'external.withdrawn': String(W),
    'external.netDeposited': String(D - W),
    'external.frictionFeesOnDeposits': String(Fd),
    'external.frictionFeesOnWithdrawals': String(Fw),
    'external.frictionFees': String(Fd + Fw),
    'external.netCash': String(netCash),
    'neutral.openings': String(O),
    'neutral.transfersNet': String(T),
    'betting.grossBettingResult': String(G),
    'betting.turnover': String(turnover),
    'betting.betCommissions': String(Cb),
    'betting.netBettingResult': String(netBetting),
    'betting.betsPlaced': String(betsPlaced),
    'betting.settledCount': String(settledCount),
    'betting.voidCount': String(voidCount),
    'betting.openCount': String(openCount),
    'betting.wins': String(wins),
    'betting.losses': String(losses),
    'betting.pushes': String(pushes),
    'betting.hitRateBps': ((v) => (v === null ? null : String(v)))(
      ratio(BigInt(wins), BigInt(wins + losses)),
    ),
    'betting.yieldBps': ((v) => (v === null ? null : String(v)))(ratio(netBetting, turnover)),
    // turnover >= 0, so half-away-from-zero is plain half-up: floor((2n + d) / 2d)
    'betting.avgStake':
      settledCount === 0
        ? null
        : String((2n * turnover + BigInt(settledCount)) / (2n * BigInt(settledCount))),
    'costs.platformFees': String(Cp),
    'costs.bonusesNet': String(Bn),
    'costs.adjustmentsNet': String(A),
    'allIn.total': String(allIn),
    'allIn.frictionFees': String(Fd + Fw),
  };
  for (const [label, snap] of [
    ['start', start],
    ['end', end],
  ] as const) {
    for (const k of ['balance', 'openStake', 'equity'] as const)
      flat[`position.${label}.total.${k}`] = snap.total[k];
    for (const [p, v] of Object.entries(snap.byPlatform)) {
      for (const k of ['balance', 'openStake', 'equity'] as const)
        flat[`position.${label}.byPlatform.${p}.${k}`] = v[k];
    }
  }
  return flat;
}
