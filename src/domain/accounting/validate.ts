// Input validation for the pure engine: field rules of 02 §3 / INV-ACC-01 and structural rules of §4.
import { MAX_AMOUNT_PAISE } from '../money/money';
import {
  AccountingInputError,
  BET_STATUSES,
  ENTRY_TYPES,
  FEE_KINDS,
  type Bet,
  type EntryType,
  type LedgerData,
  type LedgerEntry,
  type Violation,
} from './types';

const v = (invariant: string, rule: string, entityId: string, detail: string): Violation => ({
  invariant,
  rule,
  entityId,
  detail,
});

const isMoney = (x: unknown, min: bigint): x is bigint =>
  typeof x === 'bigint' && x >= min && x <= MAX_AMOUNT_PAISE;

const TYPE_SET: ReadonlySet<string> = new Set(ENTRY_TYPES);
const BET_LINKED: ReadonlySet<EntryType> = new Set<EntryType>([
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
]);
const FEE_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(['FEE', 'FEE_REFUND']);
const TRANSFER_TYPES: ReadonlySet<EntryType> = new Set<EntryType>(['TRANSFER_OUT', 'TRANSFER_IN']);
const ADJUSTMENT_TYPES: ReadonlySet<EntryType> = new Set<EntryType>([
  'ADJUSTMENT_CREDIT',
  'ADJUSTMENT_DEBIT',
]);

/** Field-level checks on a single entry. */
export function validateEntry(e: LedgerEntry): Violation[] {
  const out: Violation[] = [];
  const id = e.id;

  if (!TYPE_SET.has(e.type)) {
    out.push(v('02§3', 'ENTRY_TYPE', id, `unknown entry type ${String(e.type)}`));
    return out;
  }
  if (!isMoney(e.amount, 1n))
    out.push(v('INV-ACC-01', 'AMOUNT_RANGE', id, 'amount must be a bigint in 1..10^12 paise'));
  if (!isMoney(e.fee, 0n))
    out.push(v('INV-ACC-01', 'FEE_RANGE', id, 'fee must be a bigint in 0..10^12 paise'));
  else if (e.fee > 0n && e.type !== 'DEPOSIT' && e.type !== 'WITHDRAWAL') {
    out.push(
      v('INV-ACC-01', 'FEE_NOT_ALLOWED', id, 'fee is only allowed on DEPOSIT and WITHDRAWAL'),
    );
  }
  if (e.type === 'WITHDRAWAL' && isMoney(e.fee, 0n) && isMoney(e.amount, 1n) && e.fee > e.amount) {
    out.push(v('INV-ACC-01', 'FEE_EXCEEDS_AMOUNT', id, 'withdrawal fee may not exceed the amount'));
  }
  if (e.isReversal !== (e.reversesEntryId !== null)) {
    out.push(
      v(
        'INV-ACC-03',
        'REVERSAL_FLAG',
        id,
        'isReversal must be true exactly when reversesEntryId is set',
      ),
    );
  }
  if (e.isReversal && e.externalRef !== null) {
    out.push(v('02§4', 'REVERSAL_EXTERNAL_REF', id, 'a reversal carries no external reference'));
  }

  const isFeeType = FEE_TYPES.has(e.type);
  if (isFeeType !== (e.feeKind !== null)) {
    out.push(
      v('02§3', 'FEE_KIND', id, 'fee kind is required on FEE/FEE_REFUND and forbidden elsewhere'),
    );
  } else if (e.feeKind !== null && !(FEE_KINDS as readonly string[]).includes(e.feeKind)) {
    out.push(v('02§3', 'FEE_KIND', id, `unknown fee kind ${String(e.feeKind)}`));
  }

  if (BET_LINKED.has(e.type)) {
    if (e.betId === null)
      out.push(v('INV-ACC-10', 'BET_LINK', id, 'stake/payout/refund require a bet'));
  } else if (isFeeType && e.feeKind !== null) {
    if ((e.feeKind === 'BET_COMMISSION') !== (e.betId !== null)) {
      out.push(v('02§3', 'BET_LINK', id, 'a bet is required exactly for BET_COMMISSION fees'));
    }
  } else if (e.betId !== null) {
    out.push(v('02§3', 'BET_LINK', id, 'this entry type may not reference a bet'));
  }

  if (TRANSFER_TYPES.has(e.type) !== (e.transferGroupId !== null)) {
    out.push(
      v('INV-ACC-07', 'TRANSFER_GROUP', id, 'a transfer group is required exactly on transfers'),
    );
  }
  if (ADJUSTMENT_TYPES.has(e.type) !== (e.checkpointId !== null)) {
    out.push(v('02§8', 'CHECKPOINT_LINK', id, 'a checkpoint is required exactly on adjustments'));
  }
  if (ADJUSTMENT_TYPES.has(e.type) && (e.note ?? '').trim() === '') {
    out.push(v('02§8', 'ADJUSTMENT_NOTE', id, 'adjustments require a non-empty note'));
  }
  if (!Number.isInteger(e.occurredAt) || !Number.isInteger(e.recordedAt)) {
    out.push(v('02§9', 'TIMESTAMP', id, 'timestamps must be integer epoch milliseconds'));
  }
  return out;
}

function validateBet(b: Bet, platformIds: ReadonlySet<string>): Violation[] {
  const out: Violation[] = [];
  if (!platformIds.has(b.platformId))
    out.push(v('02§7', 'UNKNOWN_PLATFORM', b.id, `unknown platform ${b.platformId}`));
  if (!(BET_STATUSES as readonly string[]).includes(b.status)) {
    out.push(v('02§7', 'BET_FIELDS', b.id, `unknown bet status ${String(b.status)}`));
    return out;
  }
  if (!Number.isInteger(b.placedAt) || (b.settledAt !== null && !Number.isInteger(b.settledAt))) {
    out.push(v('02§9', 'BET_FIELDS', b.id, 'bet timestamps must be integer epoch milliseconds'));
  }
  if (b.status === 'OPEN' && b.settledAt !== null)
    out.push(v('02§7', 'BET_FIELDS', b.id, 'an OPEN bet has no settledAt'));
  if ((b.status === 'SETTLED' || b.status === 'VOID') && b.settledAt === null) {
    out.push(v('02§7', 'BET_FIELDS', b.id, `a ${b.status} bet needs settledAt`));
  }
  if (b.settledAt !== null && b.settledAt < b.placedAt) {
    out.push(v('02§7', 'BET_FIELDS', b.id, 'settledAt may not precede placedAt'));
  }
  return out;
}

const MIRRORED = [
  'platformId',
  'type',
  'amount',
  'fee',
  'betId',
  'feeKind',
  'transferGroupId',
  'checkpointId',
  'occurredAt',
] as const satisfies readonly (keyof LedgerEntry)[];

/** Structural validation of a whole dataset. Returns every violation found (empty = valid). */
export function validateData(data: LedgerData): Violation[] {
  const out: Violation[] = [];
  const platformIds = new Set<string>();
  for (const p of data.platforms) {
    if (platformIds.has(p.id)) out.push(v('02§3', 'DUPLICATE_ID', p.id, 'duplicate platform id'));
    platformIds.add(p.id);
  }
  const betIds = new Set<string>();
  for (const b of data.bets) {
    if (betIds.has(b.id)) out.push(v('02§7', 'DUPLICATE_ID', b.id, 'duplicate bet id'));
    betIds.add(b.id);
    out.push(...validateBet(b, platformIds));
  }
  for (const c of data.checkpoints ?? []) {
    if (!platformIds.has(c.platformId))
      out.push(v('02§8', 'UNKNOWN_PLATFORM', c.id, `unknown platform ${c.platformId}`));
  }

  const byId = new Map<string, LedgerEntry>();
  for (const e of data.entries) {
    if (byId.has(e.id)) out.push(v('02§3', 'DUPLICATE_ID', e.id, 'duplicate entry id'));
    byId.set(e.id, e);
  }
  const reversedBy = new Map<string, string>();
  for (const e of data.entries) {
    out.push(...validateEntry(e));
    if (!platformIds.has(e.platformId))
      out.push(v('02§3', 'UNKNOWN_PLATFORM', e.id, `unknown platform ${e.platformId}`));
    if (e.betId !== null && !betIds.has(e.betId))
      out.push(v('02§7', 'UNKNOWN_BET', e.id, `unknown bet ${e.betId}`));
    if (e.reversesEntryId === null) continue;
    const original = byId.get(e.reversesEntryId);
    if (!original) {
      out.push(
        v(
          'INV-ACC-03',
          'REVERSAL_ORIGINAL_MISSING',
          e.id,
          `original ${e.reversesEntryId} not found`,
        ),
      );
      continue;
    }
    if (original.isReversal)
      out.push(v('INV-ACC-03', 'REVERSAL_OF_REVERSAL', e.id, 'a reversal cannot be reversed'));
    const prior = reversedBy.get(original.id);
    if (prior !== undefined)
      out.push(
        v('INV-ACC-03', 'REVERSAL_DUPLICATE', e.id, `${original.id} already reversed by ${prior}`),
      );
    else reversedBy.set(original.id, e.id);
    const differs = MIRRORED.filter((k) => original[k] !== e[k]);
    if (differs.length > 0) {
      out.push(
        v(
          'INV-ACC-03',
          'REVERSAL_MISMATCH',
          e.id,
          `differs from ${original.id} in ${differs.join(', ')}`,
        ),
      );
    }
  }
  return out;
}

/** Throws AccountingInputError if the dataset is structurally invalid. */
export function assertValidData(data: LedgerData): void {
  const violations = validateData(data);
  if (violations.length > 0) throw new AccountingInputError(violations);
}
