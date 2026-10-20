import { MAX_AMOUNT_PAISE } from '../money';
import { LedgerBuilder } from '../../../tests/support/ledgerBuilder';
import { AccountingInputError, type LedgerEntry } from './types';
import { assertValidData, validateData, validateEntry } from './validate';

const base: LedgerEntry = {
  id: 'E1',
  platformId: 'A',
  type: 'DEPOSIT',
  amount: 1000n,
  fee: 0n,
  isReversal: false,
  reversesEntryId: null,
  betId: null,
  feeKind: null,
  transferGroupId: null,
  checkpointId: null,
  occurredAt: 1000,
  recordedAt: 1000,
  externalRef: null,
  note: null,
};
const rules = (e: Partial<LedgerEntry>) => validateEntry({ ...base, ...e }).map((v) => v.rule);

describe('validateEntry — field rules (INV-ACC-01, 02 §3)', () => {
  it('accepts a well-formed entry', () => {
    expect(validateEntry(base)).toEqual([]);
  });

  it('enforces 1 ≤ amount ≤ 10^12', () => {
    expect(rules({ amount: 0n })).toContain('AMOUNT_RANGE');
    expect(rules({ amount: -5n })).toContain('AMOUNT_RANGE');
    expect(rules({ amount: MAX_AMOUNT_PAISE + 1n })).toContain('AMOUNT_RANGE');
    expect(rules({ amount: MAX_AMOUNT_PAISE })).toEqual([]);
    expect(rules({ amount: 1n })).toEqual([]);
  });

  it('rejects non-bigint money at runtime (floats and numbers never enter the engine)', () => {
    expect(rules({ amount: 10.5 as unknown as bigint })).toContain('AMOUNT_RANGE');
    expect(rules({ amount: 100 as unknown as bigint })).toContain('AMOUNT_RANGE');
    expect(rules({ fee: 1 as unknown as bigint })).toContain('FEE_RANGE');
  });

  it('bounds the fee and restricts it to deposits and withdrawals', () => {
    expect(rules({ fee: -1n })).toContain('FEE_RANGE');
    expect(rules({ fee: MAX_AMOUNT_PAISE + 1n })).toContain('FEE_RANGE');
    expect(rules({ type: 'BET_STAKE', betId: 'B', fee: 1n })).toContain('FEE_NOT_ALLOWED');
    expect(rules({ type: 'WITHDRAWAL', fee: 1000n })).toEqual([]); // fee == amount allowed
    expect(rules({ type: 'WITHDRAWAL', fee: 1001n })).toContain('FEE_EXCEEDS_AMOUNT');
    expect(rules({ type: 'DEPOSIT', fee: 5000n })).toEqual([]); // deposit fee may exceed amount
  });

  it('requires isReversal ⇔ reversesEntryId', () => {
    expect(rules({ isReversal: true })).toContain('REVERSAL_FLAG');
    expect(rules({ reversesEntryId: 'E0' })).toContain('REVERSAL_FLAG');
    expect(rules({ isReversal: true, reversesEntryId: 'E0' })).toEqual([]);
  });

  it('requires a fee kind exactly on FEE / FEE_REFUND; commission needs a bet, platform fee must not have one', () => {
    expect(rules({ type: 'FEE' })).toContain('FEE_KIND');
    expect(rules({ type: 'DEPOSIT', feeKind: 'PLATFORM_FEE' })).toContain('FEE_KIND');
    expect(rules({ type: 'FEE', feeKind: 'BET_COMMISSION' })).toContain('BET_LINK');
    expect(rules({ type: 'FEE', feeKind: 'PLATFORM_FEE', betId: 'B' })).toContain('BET_LINK');
    expect(rules({ type: 'FEE', feeKind: 'PLATFORM_FEE' })).toEqual([]);
    expect(rules({ type: 'FEE_REFUND', feeKind: 'BET_COMMISSION', betId: 'B' })).toEqual([]);
  });

  it('requires a bet on stake/payout/refund and forbids it elsewhere', () => {
    for (const type of ['BET_STAKE', 'BET_PAYOUT', 'BET_REFUND'] as const) {
      expect(rules({ type })).toContain('BET_LINK');
      expect(rules({ type, betId: 'B' })).toEqual([]);
    }
    expect(rules({ type: 'DEPOSIT', betId: 'B' })).toContain('BET_LINK');
    expect(rules({ type: 'BONUS_CREDIT', betId: 'B' })).toContain('BET_LINK');
  });

  it('requires a transfer group exactly on transfers', () => {
    expect(rules({ type: 'TRANSFER_OUT' })).toContain('TRANSFER_GROUP');
    expect(rules({ type: 'TRANSFER_IN', transferGroupId: 'T' })).toEqual([]);
    expect(rules({ type: 'DEPOSIT', transferGroupId: 'T' })).toContain('TRANSFER_GROUP');
  });

  it('requires a checkpoint and a non-empty note exactly on adjustments', () => {
    expect(rules({ type: 'ADJUSTMENT_DEBIT', note: 'why' })).toContain('CHECKPOINT_LINK');
    expect(rules({ type: 'ADJUSTMENT_DEBIT', checkpointId: 'C' })).toContain('ADJUSTMENT_NOTE');
    expect(rules({ type: 'ADJUSTMENT_CREDIT', checkpointId: 'C', note: '   ' })).toContain(
      'ADJUSTMENT_NOTE',
    );
    expect(rules({ type: 'ADJUSTMENT_CREDIT', checkpointId: 'C', note: 'why' })).toEqual([]);
    expect(rules({ type: 'DEPOSIT', checkpointId: 'C' })).toContain('CHECKPOINT_LINK');
  });

  it('forbids an external reference on a reversal', () => {
    expect(rules({ isReversal: true, reversesEntryId: 'E0', externalRef: 'x' })).toContain(
      'REVERSAL_EXTERNAL_REF',
    );
  });

  it('rejects unknown types and non-finite or non-integer timestamps', () => {
    expect(rules({ type: 'PAYOUT' as unknown as LedgerEntry['type'] })).toContain('ENTRY_TYPE');
    expect(rules({ occurredAt: Number.NaN })).toContain('TIMESTAMP');
    expect(rules({ occurredAt: Number.POSITIVE_INFINITY })).toContain('TIMESTAMP');
    expect(rules({ occurredAt: 1.5 })).toContain('TIMESTAMP');
    expect(rules({ recordedAt: Number.NaN })).toContain('TIMESTAMP');
  });
});

describe('validateData — structural rules', () => {
  const builder = () => new LedgerBuilder().addPlatform('A');

  it('accepts a valid ledger with corrections', () => {
    const b = builder();
    b.opening('A', 1000n, 0);
    const d = b.deposit('A', 500n, 5n, 10);
    b.reverse(d.id);
    expect(validateData(b.data())).toEqual([]);
  });

  it('flags duplicate ids, unknown platforms and unknown bets', () => {
    const b = builder();
    const e = b.deposit('A', 500n, 0n, 10);
    const dup = validateData({ ...b.data(), entries: [e, e] });
    expect(dup.map((v) => v.rule)).toContain('DUPLICATE_ID');
    const unknownPlatform = validateData({ ...b.data(), entries: [{ ...e, platformId: 'Z' }] });
    expect(unknownPlatform.map((v) => v.rule)).toContain('UNKNOWN_PLATFORM');
    const unknownBet = validateData({
      ...b.data(),
      entries: [{ ...e, id: 'S', type: 'BET_STAKE', betId: 'nope' }],
    });
    expect(unknownBet.map((v) => v.rule)).toContain('UNKNOWN_BET');
    const dupPlatform = validateData({
      ...b.data(),
      platforms: [
        { id: 'A', name: 'x' },
        { id: 'A', name: 'y' },
      ],
    });
    expect(dupPlatform.map((v) => v.rule)).toContain('DUPLICATE_ID');
  });

  it('enforces reversal structure (INV-ACC-03)', () => {
    const b = builder();
    const d = b.deposit('A', 500n, 5n, 10);
    const r = b.reverse(d.id);
    const data = b.data();

    const missing = validateData({ ...data, entries: [r] });
    expect(missing.map((v) => v.rule)).toContain('REVERSAL_ORIGINAL_MISSING');

    const onReversal = { ...r, id: 'R2', reversesEntryId: r.id };
    expect(
      validateData({ ...data, entries: [...data.entries, onReversal] }).map((v) => v.rule),
    ).toContain('REVERSAL_OF_REVERSAL');

    const twice = { ...r, id: 'R3' };
    expect(
      validateData({ ...data, entries: [...data.entries, twice] }).map((v) => v.rule),
    ).toContain('REVERSAL_DUPLICATE');

    for (const patch of [
      { amount: 499n },
      { fee: 0n },
      { platformId: 'B' },
      { occurredAt: r.occurredAt + 1 },
      { type: 'WITHDRAWAL' as const },
    ]) {
      const bad = validateData({
        platforms: [...data.platforms, { id: 'B', name: 'B' }],
        entries: [d, { ...r, ...patch }],
        bets: [],
      });
      expect(
        bad.map((v) => v.rule),
        JSON.stringify(patch, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
      ).toContain('REVERSAL_MISMATCH');
    }
  });

  it('checks bet fields: status/settledAt coherence and ordering', () => {
    const b = builder();
    const id = b.placeBet('A', 100n, 10);
    const bet = b.bet(id);
    const check = (patch: Partial<typeof bet>) =>
      validateData({ ...b.data(), bets: [{ ...bet, ...patch }] }).map((v) => v.rule);
    expect(check({ status: 'OPEN', settledAt: 20 })).toContain('BET_FIELDS');
    expect(check({ status: 'SETTLED', settledAt: null })).toContain('BET_FIELDS');
    expect(check({ status: 'VOID', settledAt: null })).toContain('BET_FIELDS');
    expect(check({ status: 'SETTLED', settledAt: 5 })).toContain('BET_FIELDS');
    expect(check({ status: 'ANNULLED', settledAt: null })).not.toContain('BET_FIELDS');
    expect(check({ platformId: 'Z' })).toContain('UNKNOWN_PLATFORM');
    expect(check({ status: 'NOPE' as unknown as typeof bet.status })).toContain('BET_FIELDS');
  });

  it('assertValidData throws AccountingInputError carrying the violations', () => {
    const b = builder();
    const e = b.deposit('A', 500n, 0n, 10);
    const bad = { ...b.data(), entries: [{ ...e, amount: 0n }] };
    expect(() => assertValidData(bad)).toThrow(AccountingInputError);
    try {
      assertValidData(bad);
    } catch (err) {
      expect((err as AccountingInputError).violations[0]?.rule).toBe('AMOUNT_RANGE');
    }
    expect(() => assertValidData(b.data())).not.toThrow();
  });

  it('summarises long violation lists in the error message', () => {
    const b = builder();
    const e = b.deposit('A', 500n, 0n, 10);
    const many = Array.from({ length: 7 }, (_, i) => ({ ...e, id: `bad${i}`, amount: 0n }));
    try {
      assertValidData({ ...b.data(), entries: many });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as AccountingInputError).message).toContain('+2 more');
      expect((err as AccountingInputError).violations).toHaveLength(7);
    }
  });

  it('summarises long violation lists in the error message', () => {
    const b = builder();
    const e = b.deposit('A', 500n, 0n, 10);
    const many = Array.from({ length: 7 }, (_, i) => ({ ...e, id: `bad${i}`, amount: 0n }));
    try {
      assertValidData({ ...b.data(), entries: many });
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as AccountingInputError).message).toContain('+2 more');
      expect((err as AccountingInputError).violations).toHaveLength(7);
    }
  });

  it('rejects unknown fee kinds, fractional bet timestamps, and checkpoints on unknown platforms', () => {
    const b = builder();
    b.platformFee('A', 10n, 5);
    const data = b.data();
    const fee = data.entries[0];
    if (!fee) throw new Error('entry');
    const badKind = validateData({
      ...data,
      entries: [{ ...fee, feeKind: 'TAX' as unknown as 'PLATFORM_FEE' }],
    });
    expect(badKind.map((x) => x.rule)).toContain('FEE_KIND');

    const id = b.placeBet('A', 100n, 10);
    const withBet = b.data();
    const bet = withBet.bets.find((x) => x.id === id);
    if (!bet) throw new Error('bet');
    expect(
      validateData({ ...withBet, bets: [{ ...bet, placedAt: 10.5 }] }).map((x) => x.rule),
    ).toContain('BET_FIELDS');

    const cp = validateData({
      ...data,
      checkpoints: [{ id: 'C', platformId: 'Z', asOf: 1, reported: 0n, ledger: 0n }],
    });
    expect(cp.map((x) => x.rule)).toContain('UNKNOWN_PLATFORM');
  });
});
