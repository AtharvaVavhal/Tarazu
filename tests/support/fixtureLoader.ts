// Loads JSON accounting fixtures (tests/fixtures/accounting) into engine input.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Bet,
  Checkpoint,
  EntryType,
  FeeKind,
  LedgerData,
  LedgerEntry,
} from '@/domain/accounting';
import { MIN_INSTANT } from '@/domain/time';

export const FIXTURE_DIR = join(process.cwd(), 'tests', 'fixtures', 'accounting');

export interface RawEntry {
  id: string;
  occurredAt: string;
  recordedAt?: string;
  platform: string;
  type: EntryType;
  amount: string;
  fee?: string;
  bet?: string;
  feeKind?: FeeKind;
  transferGroup?: string;
  checkpoint?: string;
  reverses?: string;
  externalRef?: string;
  note?: string;
}
export interface RawBet {
  id: string;
  platform: string;
  status: Bet['status'];
  placedAt: string;
  settledAt: string | null;
}
export interface RawCheckpoint {
  id: string;
  platform: string;
  asOf: string;
  reported: string;
  ledger: string;
}
export interface RawAssertion {
  ex?: string;
  derived?: boolean;
  kind:
    | 'position'
    | 'metrics'
    | 'identity'
    | 'identityAllIn'
    | 'checkpoint'
    | 'betResult'
    | 'diagnostics';
  variant?: string;
  platforms?: string[];
  at?: string;
  from?: string;
  to?: string;
  bet?: string;
  checkpoint?: string;
  expect: Record<string, unknown>;
}
export interface RawFixture {
  _comment?: string;
  platforms: { id: string; name: string }[];
  entries: RawEntry[];
  bets: RawBet[];
  checkpoints?: RawCheckpoint[];
  variants?: Record<string, { add: RawEntry[] }>;
  assertions: RawAssertion[];
}

export function instant(iso: string): number {
  if (iso === 'MIN') return MIN_INSTANT;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`Bad fixture timestamp: ${iso}`);
  return t;
}

export function toEntry(r: RawEntry): LedgerEntry {
  return {
    id: r.id,
    platformId: r.platform,
    type: r.type,
    amount: BigInt(r.amount),
    fee: BigInt(r.fee ?? '0'),
    isReversal: r.reverses !== undefined,
    reversesEntryId: r.reverses ?? null,
    betId: r.bet ?? null,
    feeKind: r.feeKind ?? null,
    transferGroupId: r.transferGroup ?? null,
    checkpointId: r.checkpoint ?? null,
    occurredAt: instant(r.occurredAt),
    recordedAt: instant(r.recordedAt ?? r.occurredAt),
    externalRef: r.externalRef ?? null,
    note: r.note ?? null,
  };
}

export function toBet(r: RawBet): Bet {
  return {
    id: r.id,
    platformId: r.platform,
    status: r.status,
    placedAt: instant(r.placedAt),
    settledAt: r.settledAt === null ? null : instant(r.settledAt),
  };
}

export function toCheckpoint(r: RawCheckpoint): Checkpoint {
  return {
    id: r.id,
    platformId: r.platform,
    asOf: instant(r.asOf),
    reported: BigInt(r.reported),
    ledger: BigInt(r.ledger),
  };
}

export function toLedgerData(raw: RawFixture, variant?: string): LedgerData {
  const extra = variant === undefined ? [] : (raw.variants?.[variant]?.add ?? []);
  if (variant !== undefined && raw.variants?.[variant] === undefined) {
    throw new Error(`Unknown fixture variant ${variant}`);
  }
  return {
    platforms: raw.platforms.map((p) => ({ id: p.id, name: p.name })),
    entries: [...raw.entries, ...extra].map(toEntry),
    bets: raw.bets.map(toBet),
    checkpoints: (raw.checkpoints ?? []).map(toCheckpoint),
  };
}

export function readFixture(file: string): RawFixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), 'utf8')) as RawFixture;
}
