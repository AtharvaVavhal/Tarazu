// diagnostics(): findings for INV-ACC-07/08/09/11/13/14 (04 §4). Healthy data yields none.
import { LedgerBuilder } from '../../../tests/support/ledgerBuilder';
import { diagnostics } from './diagnostics';
import type { LedgerData } from './types';

const DAY = 86_400_000;
const T0 = 500 * DAY;
const rules = (d: LedgerData) => diagnostics(d).map((v) => v.rule);

function healthy() {
  const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
  b.opening('A', 100_000n, T0);
  b.opening('B', 100_000n, T0);
  b.transfer('A', 'B', 1_000n, T0 + 1);
  const won = b.placeBet('A', 500n, T0 + 2);
  b.settle(won, 900n, T0 + 3);
  const v = b.placeBet('A', 500n, T0 + 4);
  b.voidBet(v, T0 + 5);
  const open = b.placeBet('B', 500n, T0 + 6);
  const ann = b.placeBet('B', 500n, T0 + 7);
  b.annul(ann);
  return { b, won, v, open, ann };
}

describe('diagnostics', () => {
  it('reports nothing for a healthy ledger covering every lifecycle path', () => {
    const { b, won } = healthy();
    b.resettle(won, 0n, T0 + 8);
    b.correctStake(won, 600n);
    expect(diagnostics(b.data())).toEqual([]);
  });

  it('INV-ACC-14: flags a balance that is negative at some instant, once per platform', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.deposit('A', 100n, 0n, T0);
    b.withdrawal('A', 150n, 0n, T0 + 1);
    const found = diagnostics(b.data());
    expect(found.map((v) => v.rule)).toEqual(['NEGATIVE_BALANCE']);
    expect(found[0]).toMatchObject({ invariant: 'INV-ACC-14', entityId: 'A' });
  });

  it('INV-ACC-14: evaluates balance per instant, so same-instant ordering cannot cause a false alarm', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.withdrawal('A', 100n, 0n, T0); // listed first, but the deposit shares the instant
    b.deposit('A', 100n, 0n, T0);
    expect(rules(b.data())).toEqual([]);
  });

  it('INV-ACC-14: does not flag a balance of exactly zero', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.deposit('A', 100n, 0n, T0);
    b.withdrawal('A', 100n, 0n, T0 + 1);
    expect(rules(b.data())).toEqual([]);
  });

  it('INV-ACC-07: flags unbalanced transfer groups', () => {
    const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
    b.opening('A', 10_000n, T0);
    b.add({
      platformId: 'A',
      type: 'TRANSFER_OUT',
      amount: 100n,
      transferGroupId: 'G1',
      occurredAt: T0 + 1,
    });
    expect(rules(b.data())).toContain('TRANSFER_UNBALANCED');

    const c = new LedgerBuilder().addPlatform('A').addPlatform('B');
    c.opening('A', 10_000n, T0);
    c.add({
      platformId: 'A',
      type: 'TRANSFER_OUT',
      amount: 100n,
      transferGroupId: 'G1',
      occurredAt: T0 + 1,
    });
    c.add({
      platformId: 'B',
      type: 'TRANSFER_IN',
      amount: 99n,
      transferGroupId: 'G1',
      occurredAt: T0 + 1,
    });
    expect(rules(c.data())).toContain('TRANSFER_UNBALANCED');

    const d = new LedgerBuilder().addPlatform('A');
    d.opening('A', 10_000n, T0);
    d.add({
      platformId: 'A',
      type: 'TRANSFER_OUT',
      amount: 100n,
      transferGroupId: 'G1',
      occurredAt: T0 + 1,
    });
    d.add({
      platformId: 'A',
      type: 'TRANSFER_IN',
      amount: 100n,
      transferGroupId: 'G1',
      occurredAt: T0 + 1,
    });
    expect(rules(d.data())).toContain('TRANSFER_UNBALANCED'); // same platform on both legs
  });

  it('INV-ACC-07: a transfer with both legs reversed stays balanced', () => {
    const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
    b.opening('A', 10_000n, T0);
    b.transfer('A', 'B', 100n, T0 + 1);
    for (const e of b.entries.filter((x) => x.type.startsWith('TRANSFER'))) b.reverse(e.id);
    expect(rules(b.data())).toEqual([]);
  });

  it('INV-ACC-08: flags status that disagrees with the live ledger entries', () => {
    const open = new LedgerBuilder().addPlatform('A');
    open.opening('A', 10_000n, T0);
    const o = open.placeBet('A', 100n, T0 + 1);
    open.add({ platformId: 'A', type: 'BET_PAYOUT', amount: 50n, betId: o, occurredAt: T0 + 2 });
    expect(rules(open.data())).toContain('BET_STATUS_MISMATCH');

    const settled = new LedgerBuilder().addPlatform('A');
    settled.opening('A', 10_000n, T0);
    const s = settled.placeBet('A', 100n, T0 + 1);
    settled.settle(s, 150n, T0 + 2);
    settled.add({
      platformId: 'A',
      type: 'BET_REFUND',
      amount: 100n,
      betId: s,
      occurredAt: T0 + 2,
    });
    expect(rules(settled.data())).toContain('BET_STATUS_MISMATCH');

    const twoPayouts = new LedgerBuilder().addPlatform('A');
    twoPayouts.opening('A', 10_000n, T0);
    const t = twoPayouts.placeBet('A', 100n, T0 + 1);
    twoPayouts.settle(t, 150n, T0 + 2);
    twoPayouts.add({
      platformId: 'A',
      type: 'BET_PAYOUT',
      amount: 10n,
      betId: t,
      occurredAt: T0 + 2,
    });
    expect(rules(twoPayouts.data())).toContain('BET_STATUS_MISMATCH');

    const voided = new LedgerBuilder().addPlatform('A');
    voided.opening('A', 10_000n, T0);
    const v = voided.placeBet('A', 100n, T0 + 1);
    voided.voidBet(v, T0 + 2);
    voided.add({ platformId: 'A', type: 'BET_PAYOUT', amount: 10n, betId: v, occurredAt: T0 + 2 });
    expect(rules(voided.data())).toContain('BET_STATUS_MISMATCH');

    const partial = new LedgerBuilder().addPlatform('A');
    partial.opening('A', 10_000n, T0);
    const p = partial.placeBet('A', 100n, T0 + 1);
    partial.add({ platformId: 'A', type: 'BET_REFUND', amount: 60n, betId: p, occurredAt: T0 + 2 });
    const pd = partial.data();
    const asVoid: LedgerData = {
      ...pd,
      bets: pd.bets.map((x) => ({ ...x, status: 'VOID', settledAt: T0 + 2 })),
    };
    expect(rules(asVoid)).toContain('BET_STATUS_MISMATCH'); // refund 60 ≠ stake 100

    const noStake = new LedgerBuilder().addPlatform('A');
    noStake.opening('A', 10_000n, T0);
    const n = noStake.placeBet('A', 100n, T0 + 1);
    noStake.reverse(noStake.entries.find((e) => e.betId === n && e.type === 'BET_STAKE')?.id ?? '');
    expect(rules(noStake.data())).toContain('BET_STATUS_MISMATCH'); // OPEN bet without a live stake

    const annulled = new LedgerBuilder().addPlatform('A');
    annulled.opening('A', 10_000n, T0);
    const a = annulled.placeBet('A', 100n, T0 + 1);
    const ad = annulled.data();
    expect(
      rules({ ...ad, bets: ad.bets.map((x) => ({ ...x, status: 'ANNULLED' as const, id: a })) }),
    ).toContain('BET_STATUS_MISMATCH'); // annulled but stake still live
  });

  it('INV-ACC-08: flags bet entries recorded on a different platform than the bet', () => {
    const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
    b.opening('A', 10_000n, T0);
    b.opening('B', 10_000n, T0);
    const id = b.placeBet('A', 100n, T0 + 1);
    b.add({ platformId: 'B', type: 'BET_PAYOUT', amount: 200n, betId: id, occurredAt: T0 + 2 });
    const d = b.data();
    const settled: LedgerData = {
      ...d,
      bets: d.bets.map((x) => ({ ...x, status: 'SETTLED', settledAt: T0 + 2 })),
    };
    expect(rules(settled)).toContain('BET_ENTRY_PLATFORM');
  });

  it('INV-ACC-09: flags live stake/payout/refund entries not dated at the bet timestamps', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 10_000n, T0);
    const id = b.placeBet('A', 100n, T0 + 5);
    b.settle(id, 150n, T0 + 9);
    const d = b.data();
    const shiftedPlaced: LedgerData = {
      ...d,
      bets: d.bets.map((x) => ({ ...x, placedAt: T0 + 4 })),
    };
    expect(rules(shiftedPlaced)).toContain('BET_ENTRY_DATE');
    const shiftedSettled: LedgerData = {
      ...d,
      bets: d.bets.map((x) => ({ ...x, settledAt: T0 + 10 })),
    };
    expect(rules(shiftedSettled)).toContain('BET_ENTRY_DATE');
  });

  it('INV-ACC-09: reversed entries are exempt (their dates were correct for the old timestamps)', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.opening('A', 10_000n, T0);
    const id = b.placeBet('A', 100n, T0 + 5);
    b.settle(id, 150n, T0 + 9);
    b.resettle(id, 150n, T0 + 12); // payout moves; old payout + reversal keep the old date
    expect(rules(b.data())).toEqual([]);
  });

  it('INV-ACC-11: flags two live openings and entries dated before the opening', () => {
    const two = new LedgerBuilder().addPlatform('A');
    two.opening('A', 100n, T0);
    two.opening('A', 100n, T0 + 1);
    expect(rules(two.data())).toContain('OPENING_ORDER');

    const early = new LedgerBuilder().addPlatform('A');
    early.opening('A', 100n, T0);
    early.deposit('A', 50n, 0n, T0 - 1);
    expect(rules(early.data())).toContain('OPENING_ORDER');

    const sameInstant = new LedgerBuilder().addPlatform('A');
    sameInstant.opening('A', 100n, T0);
    sameInstant.deposit('A', 50n, 0n, T0);
    expect(rules(sameInstant.data())).toEqual([]);
  });

  it('INV-ACC-11: a reversed opening followed by a corrected one is fine', () => {
    const b = new LedgerBuilder().addPlatform('A');
    const o = b.opening('A', 100n, T0);
    b.reverse(o.id);
    b.opening('A', 120n, T0);
    expect(rules(b.data())).toEqual([]);
  });

  it('INV-ACC-13: flags entries dated more than 5 minutes after they were recorded', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.add({
      platformId: 'A',
      type: 'DEPOSIT',
      amount: 100n,
      occurredAt: T0 + 5 * 60_000,
      recordedAt: T0,
    });
    expect(rules(b.data())).toEqual([]); // exactly 5 minutes is allowed
    b.add({
      platformId: 'A',
      type: 'DEPOSIT',
      amount: 100n,
      occurredAt: T0 + 5 * 60_000 + 1,
      recordedAt: T0,
    });
    expect(rules(b.data())).toContain('FUTURE_DATED');
  });

  it('every finding names its invariant, rule, entity and detail', () => {
    const b = new LedgerBuilder().addPlatform('A');
    b.withdrawal('A', 100n, 0n, T0);
    for (const v of diagnostics(b.data())) {
      expect(v.invariant).toMatch(/^INV-ACC-\d\d$/);
      expect(v.rule).not.toBe('');
      expect(v.entityId).not.toBe('');
      expect(v.detail).not.toBe('');
    }
  });
});
