// fast-check generator of valid ledgers: a random command script interpreted through LedgerBuilder.
import fc from 'fast-check';
import type { LedgerData } from '@/domain/accounting';
import { LedgerBuilder } from './ledgerBuilder';

export const BASE = 1_700_000_000_000; // arbitrary fixed epoch ms; keeps runs reproducible
const STEP = 3_600_000; // 1 hour

const amount = fc.oneof(
  { weight: 8, arbitrary: fc.bigInt({ min: 1n, max: 1_000_000n }) },
  { weight: 1, arbitrary: fc.bigInt({ min: 1n, max: 1_000_000_000_000n }) },
);
const idx = fc.nat(1000);
const dt = fc.integer({ min: 0, max: 72 });

export type Command =
  | { k: 'deposit'; p: number; amt: bigint; feeBps: number; dt: number }
  | { k: 'withdrawal'; p: number; amt: bigint; feeBps: number; dt: number }
  | { k: 'transfer'; from: number; to: number; amt: bigint; dt: number }
  | { k: 'fee'; p: number; amt: bigint; refund: boolean; dt: number }
  | { k: 'bonus'; p: number; amt: bigint; forfeit: boolean; dt: number }
  | { k: 'place'; p: number; stake: bigint; dt: number }
  | { k: 'settle'; bet: number; payout: bigint; dt: number }
  | { k: 'void'; bet: number; dt: number }
  | { k: 'reopen'; bet: number }
  | { k: 'resettle'; bet: number; payout: bigint; isVoid: boolean; dt: number }
  | { k: 'correctStake'; bet: number; stake: bigint }
  | { k: 'annul'; bet: number }
  | { k: 'commission'; bet: number; amt: bigint; refund: boolean; dt: number }
  | { k: 'reverse'; entry: number }
  | { k: 'checkpoint'; p: number; reportedDelta: bigint; resolve: boolean; dt: number };

export const commandArb: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    k: fc.constant('deposit' as const),
    p: idx,
    amt: amount,
    feeBps: fc.integer({ min: 0, max: 500 }),
    dt,
  }),
  fc.record({
    k: fc.constant('withdrawal' as const),
    p: idx,
    amt: amount,
    feeBps: fc.integer({ min: 0, max: 10_000 }),
    dt,
  }),
  fc.record({ k: fc.constant('transfer' as const), from: idx, to: idx, amt: amount, dt }),
  fc.record({ k: fc.constant('fee' as const), p: idx, amt: amount, refund: fc.boolean(), dt }),
  fc.record({ k: fc.constant('bonus' as const), p: idx, amt: amount, forfeit: fc.boolean(), dt }),
  {
    weight: 3,
    arbitrary: fc.record({ k: fc.constant('place' as const), p: idx, stake: amount, dt }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      k: fc.constant('settle' as const),
      bet: idx,
      payout: fc.oneof(fc.constant(0n), amount),
      dt,
    }),
  },
  fc.record({ k: fc.constant('void' as const), bet: idx, dt }),
  fc.record({ k: fc.constant('reopen' as const), bet: idx }),
  fc.record({
    k: fc.constant('resettle' as const),
    bet: idx,
    payout: fc.oneof(fc.constant(0n), amount),
    isVoid: fc.boolean(),
    dt,
  }),
  fc.record({ k: fc.constant('correctStake' as const), bet: idx, stake: amount }),
  fc.record({ k: fc.constant('annul' as const), bet: idx }),
  fc.record({
    k: fc.constant('commission' as const),
    bet: idx,
    amt: amount,
    refund: fc.boolean(),
    dt,
  }),
  fc.record({ k: fc.constant('reverse' as const), entry: idx }),
  fc.record({
    k: fc.constant('checkpoint' as const),
    p: idx,
    reportedDelta: fc.bigInt({ min: -5000n, max: 5000n }),
    resolve: fc.boolean(),
    dt,
  }),
);

export interface Scenario {
  openings: bigint[]; // one per platform; 0n = no opening entry
  commands: Command[];
}

export const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  openings: fc.array(fc.oneof(fc.constant(0n), fc.bigInt({ min: 1n, max: 10_000_000n })), {
    minLength: 1,
    maxLength: 3,
  }),
  commands: fc.array(commandArb, { maxLength: 40 }),
});

/** Interprets commands; commands that would break a lifecycle rule are skipped, so the result is always valid. */
export function build(s: Scenario): { data: LedgerData; end: number } {
  const b = new LedgerBuilder();
  const platforms = s.openings.map((_, i) => `P${i}`);
  platforms.forEach((p) => b.addPlatform(p));
  let t = BASE;
  s.openings.forEach((o, i) => {
    if (o > 0n) b.opening(platforms[i] ?? 'P0', o, t);
  });
  const P = (i: number) => platforms[i % platforms.length] ?? 'P0';
  const withStatus = (...ok: string[]) => b.bets.filter((x) => ok.includes(x.status));
  const pick = <T>(xs: readonly T[], i: number): T | undefined =>
    xs.length ? xs[i % xs.length] : undefined;
  const feeOf = (a: bigint, bps: number) => (a * BigInt(bps)) / 10_000n;

  for (const c of s.commands) {
    if ('dt' in c) t += c.dt * STEP;
    switch (c.k) {
      case 'deposit':
        b.deposit(P(c.p), c.amt, feeOf(c.amt, c.feeBps), t);
        break;
      case 'withdrawal':
        b.withdrawal(P(c.p), c.amt, feeOf(c.amt, c.feeBps), t);
        break;
      case 'transfer':
        if (platforms.length > 1 && c.from % platforms.length !== c.to % platforms.length) {
          b.transfer(P(c.from), P(c.to), c.amt, t);
        }
        break;
      case 'fee':
        if (c.refund) b.platformFeeRefund(P(c.p), c.amt, t);
        else b.platformFee(P(c.p), c.amt, t);
        break;
      case 'bonus':
        b.bonus(P(c.p), c.amt, t, c.forfeit);
        break;
      case 'place':
        b.placeBet(P(c.p), c.stake, t);
        break;
      case 'settle': {
        const bet = pick(withStatus('OPEN'), c.bet);
        if (bet) b.settle(bet.id, c.payout, Math.max(t, bet.placedAt));
        break;
      }
      case 'void': {
        const bet = pick(withStatus('OPEN'), c.bet);
        if (bet) b.voidBet(bet.id, Math.max(t, bet.placedAt));
        break;
      }
      case 'reopen': {
        const bet = pick(withStatus('SETTLED', 'VOID'), c.bet);
        if (bet) b.reopen(bet.id);
        break;
      }
      case 'resettle': {
        const bet = pick(withStatus('SETTLED', 'VOID'), c.bet);
        if (bet) b.resettle(bet.id, c.isVoid ? 'VOID' : c.payout, Math.max(t, bet.placedAt));
        break;
      }
      case 'correctStake': {
        const bet = pick(withStatus('OPEN', 'SETTLED', 'VOID'), c.bet);
        if (bet) b.correctStake(bet.id, c.stake);
        break;
      }
      case 'annul': {
        const bet = pick(withStatus('OPEN', 'SETTLED', 'VOID'), c.bet);
        if (bet) b.annul(bet.id);
        break;
      }
      case 'commission': {
        const bet = pick(withStatus('SETTLED', 'VOID'), c.bet);
        if (bet) b.commission(bet.id, c.amt, Math.max(t, bet.placedAt), c.refund);
        break;
      }
      case 'reverse': {
        // Only entries not owned by a bet lifecycle, transfer, or checkpoint (same restriction as 03 §6).
        const e = pick(
          b.entries.filter(
            (x) =>
              b.isLive(x.id) &&
              x.betId === null &&
              x.transferGroupId === null &&
              x.checkpointId === null &&
              x.type !== 'OPENING_BALANCE',
          ),
          c.entry,
        );
        if (e) b.reverse(e.id);
        break;
      }
      case 'checkpoint': {
        const p = P(c.p);
        const ledger = b.entries
          .filter((x) => x.platformId === p && x.occurredAt <= t)
          .reduce((s2, x) => s2 + delta(x), 0n);
        const reported = ledger + c.reportedDelta < 0n ? 0n : ledger + c.reportedDelta;
        b.checkpoint(p, t, ledger, reported, c.resolve);
        break;
      }
    }
  }
  return { data: b.data(), end: Math.max(t, ...b.entries.map((e) => e.occurredAt)) };
}

// Local delta for checkpoint ledger computation (generator-side only; independent of the engine).
function delta(e: { type: string; amount: bigint; isReversal: boolean }): bigint {
  const plus = [
    'OPENING_BALANCE',
    'DEPOSIT',
    'TRANSFER_IN',
    'BET_PAYOUT',
    'BET_REFUND',
    'FEE_REFUND',
    'BONUS_CREDIT',
    'ADJUSTMENT_CREDIT',
  ];
  const v = plus.includes(e.type) ? e.amount : -e.amount;
  return e.isReversal ? -v : v;
}

/** A random filter window over the scenario timeline and an optional non-empty platform subset. */
export function windowArb(end: number, nPlatforms: number) {
  const span = Math.max(end - BASE, STEP) + 4 * STEP;
  return fc.record({
    a: fc.integer({ min: 0, max: span }),
    b: fc.integer({ min: 1, max: span }),
    subset: fc.option(
      fc.subarray(
        Array.from({ length: nPlatforms }, (_, i) => `P${i}`),
        { minLength: 1 },
      ),
      { nil: undefined },
    ),
  });
}
export const toWindow = (w: { a: number; b: number }) => {
  const lo = Math.min(w.a, w.b);
  const hi = Math.max(w.a, w.b) + 1;
  return { from: BASE - 2 * STEP + lo, to: BASE - 2 * STEP + hi };
};
