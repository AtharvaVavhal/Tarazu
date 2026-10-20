import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTRY_TYPES, type EntryType, type LedgerEntry } from './types';
import { bankDelta, entrySign, platformDelta } from './contribution';

interface Row {
  entryType: EntryType;
  amount: string;
  fee: string;
  isReversal: boolean;
  platformDelta: string;
  bankDelta: string;
}
const table = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/accounting/delta-table.json'), 'utf8'),
) as { rows: Row[] };

function entry(r: Row): LedgerEntry {
  return {
    id: 'x',
    platformId: 'A',
    type: r.entryType,
    amount: BigInt(r.amount),
    fee: BigInt(r.fee),
    isReversal: r.isReversal,
    reversesEntryId: r.isReversal ? 'orig' : null,
    betId: null,
    feeKind: null,
    transferGroupId: null,
    checkpointId: null,
    occurredAt: 0,
    recordedAt: 0,
    externalRef: null,
    note: null,
  };
}

describe('contribution (02 §3, INV-DB-05 shared table)', () => {
  it('the shared table covers all 14 entry types in both directions', () => {
    expect(ENTRY_TYPES).toHaveLength(14);
    for (const t of ENTRY_TYPES) {
      expect(table.rows.some((r) => r.entryType === t && !r.isReversal)).toBe(true);
      expect(table.rows.some((r) => r.entryType === t && r.isReversal)).toBe(true);
    }
  });

  it.each(table.rows.map((r, i) => [i, r] as const))(
    'row %i matches platform and bank delta',
    (_i, r) => {
      const e = entry(r);
      expect(platformDelta(e).toString()).toBe(r.platformDelta);
      expect(bankDelta(e).toString()).toBe(r.bankDelta);
    },
  );

  it('a reversal contributes exactly the negative of its original (INV-ACC-03)', () => {
    for (const r of table.rows.filter((x) => !x.isReversal)) {
      const orig = entry(r);
      const rev = entry({ ...r, isReversal: true });
      expect(platformDelta(rev)).toBe(-platformDelta(orig));
      expect(bankDelta(rev)).toBe(-bankDelta(orig));
      expect(entrySign(rev)).toBe(-entrySign(orig));
    }
  });
});
