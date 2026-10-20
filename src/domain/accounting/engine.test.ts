// Unit tests for positionAt, metricsFor, betResults: filters, boundaries, invalid input, purity.
import { LedgerBuilder } from '../../../tests/support/ledgerBuilder';
import { betResults } from './bets';
import { metricsFor } from './metrics';
import { positionAt } from './position';
import { AccountingInputError, type LedgerData } from './types';

const DAY = 86_400_000;
const T0 = 1_000 * DAY;

function sample() {
  const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
  b.opening('A', 100_000n, T0);
  b.opening('B', 50_000n, T0);
  b.deposit('A', 20_000n, 100n, T0 + DAY);
  const x = b.placeBet('A', 10_000n, T0 + 2 * DAY);
  b.settle(x, 30_000n, T0 + 3 * DAY);
  b.commission(x, 500n, T0 + 3 * DAY);
  const y = b.placeBet('B', 5_000n, T0 + 4 * DAY); // stays open
  return { b, x, y, data: b.data() };
}

describe('positionAt (02 §5, INV-ACC-12)', () => {
  it('is zero before any entry and treats `t` inclusively', () => {
    const { data } = sample();
    expect(positionAt(data, T0 - 1).total).toEqual({ balance: 0n, openStake: 0n, equity: 0n });
    expect(positionAt(data, T0).total.balance).toBe(150_000n);
  });

  it('counts a bet as open from placed_at (inclusive) until settled_at (inclusive of the closing instant)', () => {
    const { data, x } = sample();
    const placed = T0 + 2 * DAY;
    const settled = T0 + 3 * DAY;
    expect(positionAt(data, placed - 1, ['A']).total.openStake).toBe(0n);
    expect(positionAt(data, placed, ['A']).total.openStake).toBe(10_000n);
    expect(positionAt(data, settled - 1, ['A']).total.openStake).toBe(10_000n);
    expect(positionAt(data, settled, ['A']).total.openStake).toBe(0n);
    expect(x).toBeDefined();
  });

  it('INV-ACC-12: values open bets at cost, and equity = balance + open stake', () => {
    const { data } = sample();
    const p = positionAt(data, T0 + 5 * DAY);
    expect(p.byPlatform['B']).toEqual({ balance: 45_000n, openStake: 5_000n, equity: 50_000n });
    expect(p.total.equity).toBe(p.total.balance + p.total.openStake);
  });

  it('filters by platform and sums totals across included platforms', () => {
    const { data } = sample();
    const all = positionAt(data, T0 + 5 * DAY);
    const onlyA = positionAt(data, T0 + 5 * DAY, ['A']);
    expect(Object.keys(onlyA.byPlatform)).toEqual(['A']);
    expect(all.total.balance).toBe(positionAt(data, T0 + 5 * DAY, ['A']).total.balance + 45_000n);
  });

  it('rejects unknown platforms and non-finite instants', () => {
    const { data } = sample();
    expect(() => positionAt(data, T0, ['Z'])).toThrow(AccountingInputError);
    expect(() => positionAt(data, Number.NaN)).toThrow(RangeError);
  });

  it('excludes annulled bets from open stake', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1000n, T0);
    const id = b.placeBet('A', 400n, T0 + 1);
    b.annul(id);
    const p = positionAt(b.data(), T0 + DAY);
    expect(p.total).toEqual({ balance: 1000n, openStake: 0n, equity: 1000n });
  });

  it('shows a reopened bet as open again', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1000n, T0);
    const id = b.placeBet('A', 400n, T0 + 1);
    b.settle(id, 0n, T0 + 2);
    expect(positionAt(b.data(), T0 + 3).total.openStake).toBe(0n);
    b.reopen(id);
    expect(positionAt(b.data(), T0 + 3).total.openStake).toBe(400n);
  });
});

describe('metricsFor (02 §6)', () => {
  const win = { from: T0, to: T0 + 10 * DAY };

  it('returns all families and an itemised all-in', () => {
    const { data } = sample();
    const m = metricsFor(data, win);
    expect(m.external).toMatchObject({
      deposited: 20_000n,
      withdrawn: 0n,
      netCash: -20_100n,
      frictionFees: 100n,
    });
    expect(m.betting).toMatchObject({
      grossBettingResult: 20_000n,
      betCommissions: 500n,
      netBettingResult: 19_500n,
      turnover: 10_000n,
      settledCount: 1,
      wins: 1,
      betsPlaced: 2,
      openCount: 1,
    });
    expect(m.allIn).toEqual({
      grossBettingResult: 20_000n,
      betCommissions: 500n,
      platformFees: 0n,
      bonusesNet: 0n,
      adjustmentsNet: 0n,
      frictionFees: 100n,
      total: 19_400n,
    });
  });

  it('attributes entries by occurred_at and bet results by settled_at, using half-open windows', () => {
    const { data } = sample();
    const settled = T0 + 3 * DAY;
    expect(metricsFor(data, { from: T0, to: settled }).betting.grossBettingResult).toBe(0n);
    expect(metricsFor(data, { from: settled, to: settled + 1 }).betting.grossBettingResult).toBe(
      20_000n,
    );
    expect(metricsFor(data, { from: T0, to: T0 + DAY }).external.deposited).toBe(0n); // deposit at T0+DAY excluded by `to`
    expect(metricsFor(data, { from: T0 + DAY, to: T0 + DAY + 1 }).external.deposited).toBe(20_000n);
  });

  it('counts open bets as of the last instant of the window (to − 1)', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1000n, T0);
    const placedAt = T0 + 100;
    const settledAt = T0 + 200;
    const id = b.placeBet('A', 100n, placedAt);
    b.settle(id, 0n, settledAt);
    const data = b.data();
    // window ends exactly when the bet settles: still open at to − 1, and not yet counted as settled
    expect(metricsFor(data, { from: T0, to: settledAt }).betting).toMatchObject({
      openCount: 1,
      settledCount: 0,
    });
    expect(metricsFor(data, { from: T0, to: settledAt + 1 }).betting).toMatchObject({
      openCount: 0,
      settledCount: 1,
    });
    // a bet placed exactly at `to` belongs to the next window
    expect(metricsFor(data, { from: T0, to: placedAt }).betting).toMatchObject({
      openCount: 0,
      betsPlaced: 0,
    });
    expect(metricsFor(data, { from: T0, to: placedAt + 1 }).betting).toMatchObject({
      openCount: 1,
      betsPlaced: 1,
    });
  });

  it('applies the platform filter to entries and to bets', () => {
    const { data } = sample();
    const a = metricsFor(data, { ...win, platformIds: ['A'] });
    const bOnly = metricsFor(data, { ...win, platformIds: ['B'] });
    expect(a.betting.betsPlaced).toBe(1);
    expect(bOnly.betting.betsPlaced).toBe(1);
    expect(bOnly.betting.grossBettingResult).toBe(0n);
    expect(bOnly.neutral.openings).toBe(50_000n);
    expect(a.platformIds).toEqual(['A']);
  });

  it('treats an empty platform list as "none" and de-duplicates repeated ids', () => {
    const { data } = sample();
    const none = metricsFor(data, { ...win, platformIds: [] });
    expect(none.neutral.openings).toBe(0n);
    expect(none.position.end.total.equity).toBe(0n);
    const dup = metricsFor(data, { ...win, platformIds: ['A', 'A'] });
    expect(dup).toEqual(metricsFor(data, { ...win, platformIds: ['A'] }));
  });

  it('rejects invalid filters', () => {
    const { data } = sample();
    expect(() => metricsFor(data, { from: 10, to: 10 })).toThrow(RangeError);
    expect(() => metricsFor(data, { from: 10, to: 5 })).toThrow(RangeError);
    expect(() => metricsFor(data, { from: Number.NaN, to: 5 })).toThrow(RangeError);
    expect(() => metricsFor(data, { from: 0, to: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => metricsFor(data, { ...win, platformIds: ['Z'] })).toThrow(AccountingInputError);
  });

  it('rejects structurally invalid data instead of computing on it', () => {
    const { data } = sample();
    const first = data.entries[0];
    if (!first) throw new Error('fixture has entries');
    const bad: LedgerData = {
      ...data,
      entries: [...data.entries, { ...first, id: 'bad', amount: 0n }],
    };
    expect(() => metricsFor(bad, win)).toThrow(AccountingInputError);
    expect(() => positionAt(bad, T0)).toThrow(AccountingInputError);
    expect(() => betResults(bad)).toThrow(AccountingInputError);
  });

  it('excludes annulled bets from every count and result', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1000n, T0);
    const id = b.placeBet('A', 400n, T0 + 1);
    b.annul(id);
    const m = metricsFor(b.data(), { from: T0, to: T0 + DAY });
    expect(m.betting).toMatchObject({
      betsPlaced: 0,
      settledCount: 0,
      voidCount: 0,
      openCount: 0,
      turnover: 0n,
    });
    expect(m.allIn.total).toBe(0n);
  });

  it('commissions are attributed by their own entry date, refunds subtract', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 100_000n, T0);
    const id = b.placeBet('A', 1_000n, T0 + 1);
    b.settle(id, 0n, T0 + 2);
    b.commission(id, 300n, T0 + 2 * DAY);
    b.commission(id, 100n, T0 + 3 * DAY, true);
    const early = metricsFor(b.data(), { from: T0, to: T0 + DAY });
    expect(early.betting.betCommissions).toBe(0n);
    const late = metricsFor(b.data(), { from: T0 + 2 * DAY, to: T0 + 4 * DAY });
    expect(late.betting.betCommissions).toBe(200n);
  });

  it('computes hit rate (pushes excluded), yield and average stake with half-away rounding', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 100_000n, T0);
    const stakes = [100n, 100n, 101n];
    const payouts = [200n, 0n, 101n]; // win, loss, push
    stakes.forEach((s, i) => {
      const id = b.placeBet('A', s, T0 + 1 + i);
      b.settle(id, payouts[i] ?? 0n, T0 + 10 + i);
    });
    const m = metricsFor(b.data(), { from: T0, to: T0 + DAY });
    expect(m.betting).toMatchObject({
      wins: 1,
      losses: 1,
      pushes: 1,
      turnover: 301n,
      grossBettingResult: 0n,
    });
    expect(m.betting.hitRateBps).toBe(5000n);
    expect(m.betting.yieldBps).toBe(0n);
    expect(m.betting.avgStake).toBe(100n); // 301/3 = 100.33 → 100
  });

  it('INV-ACC-15: derived metrics are recomputed, never stored — frozen input is accepted and repeated calls agree', () => {
    const { data } = sample();
    const frozen: LedgerData = Object.freeze({
      platforms: Object.freeze([...data.platforms]),
      entries: Object.freeze(data.entries.map((e) => Object.freeze({ ...e }))),
      bets: Object.freeze(data.bets.map((x) => Object.freeze({ ...x }))),
    });
    expect(metricsFor(frozen, win)).toEqual(metricsFor(frozen, win));
  });
});

describe('betResults (02 §6.3, §7)', () => {
  it('derives money and outcomes from ledger entries; OPEN and ANNULLED have no result', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1_000_000n, T0);
    const open = b.placeBet('A', 100n, T0 + 1);
    const won = b.placeBet('A', 100n, T0 + 2);
    b.settle(won, 250n, T0 + 3);
    const voided = b.placeBet('A', 100n, T0 + 4);
    b.voidBet(voided, T0 + 5);
    const ann = b.placeBet('A', 100n, T0 + 6);
    b.annul(ann);
    const r = betResults(b.data());
    expect(r.get(open)).toMatchObject({ outcome: 'OPEN', result: null, stake: 100n });
    expect(r.get(won)).toMatchObject({ outcome: 'WIN', result: 150n, payout: 250n });
    expect(r.get(voided)).toMatchObject({ outcome: 'VOID', result: 0n, refund: 100n });
    expect(r.get(ann)).toMatchObject({ outcome: 'ANNULLED', result: null, stake: 0n });
  });

  it('follows a corrected stake and a re-settlement', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 1_000_000n, T0);
    const id = b.placeBet('A', 100n, T0 + 1);
    b.settle(id, 0n, T0 + 2);
    b.correctStake(id, 150n);
    expect(betResults(b.data()).get(id)).toMatchObject({
      stake: 150n,
      result: -150n,
      outcome: 'LOSS',
    });
    b.resettle(id, 400n, T0 + 3);
    expect(betResults(b.data()).get(id)).toMatchObject({
      stake: 150n,
      payout: 400n,
      result: 250n,
      outcome: 'WIN',
    });
  });
});
