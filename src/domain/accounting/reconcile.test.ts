// Reconciliation (02 §8, EX-15): checkpoint state, residual, adjustment direction.
import { LedgerBuilder } from '../../../tests/support/ledgerBuilder';
import { AccountingInputError } from './types';
import { adjustmentFor, checkpointLedgerBalance, checkpointStatus } from './reconcile';

const DAY = 86_400_000;
const T0 = 700 * DAY;

function platformWith(balance: bigint) {
  const b = new LedgerBuilder().addPlatform('A').addPlatform('B');
  b.opening('A', balance, T0);
  b.opening('B', 9_999n, T0);
  return b;
}

describe('checkpointLedgerBalance', () => {
  it('is the platform balance at as_of, inclusive, excluding the checkpoint’s own adjustments', () => {
    const b = platformWith(1_000n);
    b.deposit('A', 500n, 0n, T0 + 5);
    b.deposit('A', 700n, 0n, T0 + 20); // after as_of
    const cp = b.checkpoint('A', T0 + 10, 1_500n, 1_480n, true);
    const data = b.data();
    expect(checkpointLedgerBalance(data, 'A', T0 + 10)).toBe(1_480n); // adjustment is dated as_of → included
    expect(checkpointLedgerBalance(data, 'A', T0 + 10, cp)).toBe(1_500n); // creation-time view
    expect(checkpointLedgerBalance(data, 'A', T0 + 4)).toBe(1_000n);
  });

  it('rejects unknown platforms', () => {
    expect(() => checkpointLedgerBalance(platformWith(1n).data(), 'Z', T0)).toThrow(
      AccountingInputError,
    );
  });
});

describe('checkpointStatus', () => {
  it('MATCHED when reported equals ledger', () => {
    const b = platformWith(1_000n);
    b.checkpoint('A', T0 + 1, 1_000n, 1_000n, false);
    const data = b.data();
    const cp = data.checkpoints?.[0];
    if (!cp) throw new Error('checkpoint');
    expect(checkpointStatus(data, cp)).toEqual({
      checkpointId: cp.id,
      difference: 0n,
      adjusted: 0n,
      residual: 0n,
      state: 'MATCHED',
    });
  });

  it('OPEN while a difference has no adjustment; RESOLVED once adjusted (EX-15 shape)', () => {
    const b = platformWith(1_000n);
    b.checkpoint('A', T0 + 1, 1_000n, 980n, false);
    const openData = b.data();
    const openCp = openData.checkpoints?.[0];
    if (!openCp) throw new Error('checkpoint');
    expect(checkpointStatus(openData, openCp)).toMatchObject({
      difference: -20n,
      adjusted: 0n,
      residual: -20n,
      state: 'OPEN',
    });

    const r = platformWith(1_000n);
    r.checkpoint('A', T0 + 1, 1_000n, 980n, true);
    const data = r.data();
    const cp = data.checkpoints?.[0];
    if (!cp) throw new Error('checkpoint');
    expect(checkpointStatus(data, cp)).toMatchObject({
      difference: -20n,
      adjusted: -20n,
      residual: 0n,
      state: 'RESOLVED',
    });
  });

  it('stays OPEN with a smaller residual after a partial adjustment, and when over-adjusted', () => {
    const b = platformWith(1_000n);
    const id = b.checkpoint('A', T0 + 1, 1_000n, 900n, false);
    b.add({
      platformId: 'A',
      type: 'ADJUSTMENT_DEBIT',
      amount: 40n,
      checkpointId: id,
      occurredAt: T0 + 1,
      note: 'part',
    });
    let data = b.data();
    let cp = data.checkpoints?.[0];
    if (!cp) throw new Error('checkpoint');
    expect(checkpointStatus(data, cp)).toMatchObject({
      adjusted: -40n,
      residual: -60n,
      state: 'OPEN',
    });

    b.add({
      platformId: 'A',
      type: 'ADJUSTMENT_DEBIT',
      amount: 70n,
      checkpointId: id,
      occurredAt: T0 + 1,
      note: 'too much',
    });
    data = b.data();
    cp = data.checkpoints?.[0];
    if (!cp) throw new Error('checkpoint');
    expect(checkpointStatus(data, cp)).toMatchObject({
      adjusted: -110n,
      residual: 10n,
      state: 'OPEN',
    });
  });

  it('ignores reversed adjustments (their signed contribution cancels)', () => {
    const b = platformWith(1_000n);
    const id = b.checkpoint('A', T0 + 1, 1_000n, 1_050n, false);
    const adj = b.add({
      platformId: 'A',
      type: 'ADJUSTMENT_CREDIT',
      amount: 50n,
      checkpointId: id,
      occurredAt: T0 + 1,
      note: 'x',
    });
    b.reverse(adj.id);
    const data = b.data();
    const cp = data.checkpoints?.[0];
    if (!cp) throw new Error('checkpoint');
    expect(checkpointStatus(data, cp)).toMatchObject({
      adjusted: 0n,
      residual: 50n,
      state: 'OPEN',
    });
  });

  it('does not count adjustments of other checkpoints', () => {
    const b = platformWith(1_000n);
    const c1 = b.checkpoint('A', T0 + 1, 1_000n, 1_010n, true);
    const c2 = b.checkpoint('A', T0 + 2, 1_010n, 1_000n, false);
    const data = b.data();
    const second = data.checkpoints?.find((c) => c.id === c2);
    if (!second) throw new Error('checkpoint');
    expect(checkpointStatus(data, second)).toMatchObject({
      adjusted: 0n,
      residual: -10n,
      state: 'OPEN',
    });
    expect(c1).not.toBe(c2);
  });
});

describe('adjustmentFor', () => {
  const status = (residual: bigint) => ({
    checkpointId: 'C',
    difference: residual,
    adjusted: 0n,
    residual,
    state: residual === 0n ? ('MATCHED' as const) : ('OPEN' as const),
  });

  it('credits a positive residual and debits a negative one, by absolute amount', () => {
    expect(adjustmentFor(status(250n))).toEqual({ type: 'ADJUSTMENT_CREDIT', amount: 250n });
    expect(adjustmentFor(status(-2000n))).toEqual({ type: 'ADJUSTMENT_DEBIT', amount: 2000n });
  });

  it('returns null when nothing remains to adjust', () => {
    expect(adjustmentFor(status(0n))).toBeNull();
  });
});
