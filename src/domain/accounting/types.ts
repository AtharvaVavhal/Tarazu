// Domain types of 02 §3, §5, §7, §8. Money is `Paise` (bigint); instants are epoch ms (04 §4).
import type { Instant, Window } from '../time/time';
import type { Paise } from '../money/money';

export const ENTRY_TYPES = [
  'OPENING_BALANCE',
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'FEE',
  'FEE_REFUND',
  'BONUS_CREDIT',
  'BONUS_FORFEIT',
  'ADJUSTMENT_CREDIT',
  'ADJUSTMENT_DEBIT',
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const FEE_KINDS = ['BET_COMMISSION', 'PLATFORM_FEE'] as const;
export type FeeKind = (typeof FEE_KINDS)[number];

export const BET_STATUSES = ['OPEN', 'SETTLED', 'VOID', 'ANNULLED'] as const;
export type BetStatus = (typeof BET_STATUSES)[number];

export type BetOutcome = 'OPEN' | 'VOID' | 'ANNULLED' | 'WIN' | 'LOSS' | 'PUSH';

export interface Platform {
  readonly id: string;
  readonly name: string;
}

export interface LedgerEntry {
  readonly id: string;
  readonly platformId: string;
  readonly type: EntryType;
  /** Always > 0 (INV-ACC-01); direction comes from `type` and `isReversal`. */
  readonly amount: Paise;
  /** Friction fee; > 0 only on DEPOSIT / WITHDRAWAL. */
  readonly fee: Paise;
  readonly isReversal: boolean;
  readonly reversesEntryId: string | null;
  readonly betId: string | null;
  readonly feeKind: FeeKind | null;
  readonly transferGroupId: string | null;
  readonly checkpointId: string | null;
  readonly occurredAt: Instant;
  readonly recordedAt: Instant;
  readonly externalRef: string | null;
  readonly note: string | null;
}

/** A bet carries no money (DEC-004); amounts are derived from its ledger entries. */
export interface Bet {
  readonly id: string;
  readonly platformId: string;
  readonly status: BetStatus;
  readonly placedAt: Instant;
  readonly settledAt: Instant | null;
}

export interface Checkpoint {
  readonly id: string;
  readonly platformId: string;
  readonly asOf: Instant;
  readonly reported: Paise;
  /** Ledger balance at `asOf`, computed once when the checkpoint was created. */
  readonly ledger: Paise;
}

export interface LedgerData {
  readonly platforms: readonly Platform[];
  readonly entries: readonly LedgerEntry[];
  readonly bets: readonly Bet[];
  readonly checkpoints?: readonly Checkpoint[];
}

export interface PositionAmounts {
  readonly balance: Paise;
  readonly openStake: Paise;
  readonly equity: Paise;
}

/** Position at one instant: per included platform and in total (02 §5). */
export interface PositionSnapshot {
  readonly at: Instant;
  readonly total: PositionAmounts;
  readonly byPlatform: Readonly<Record<string, PositionAmounts>>;
}

export interface MetricsFilter {
  /** Platforms to include; omitted = all platforms in the data. */
  readonly platformIds?: readonly string[];
  readonly from: Instant;
  readonly to: Instant;
}

/** Separate families so callers cannot sum across them by accident (P-6). */
export interface Metrics {
  readonly window: Window;
  readonly platformIds: readonly string[];
  /** 02 §6.1 — cash crossing the bank boundary; not performance. */
  readonly external: {
    readonly deposited: Paise;
    readonly withdrawn: Paise;
    readonly netDeposited: Paise;
    readonly frictionFeesOnDeposits: Paise;
    readonly frictionFeesOnWithdrawals: Paise;
    readonly frictionFees: Paise;
    readonly netCash: Paise;
  };
  /** 02 §6.2 */
  readonly neutral: { readonly openings: Paise; readonly transfersNet: Paise };
  /** 02 §6.3 */
  readonly betting: {
    readonly grossBettingResult: Paise;
    readonly turnover: Paise;
    readonly betCommissions: Paise;
    readonly netBettingResult: Paise;
    readonly betsPlaced: number;
    readonly settledCount: number;
    readonly voidCount: number;
    readonly openCount: number;
    readonly wins: number;
    readonly losses: number;
    readonly pushes: number;
    readonly hitRateBps: bigint | null;
    readonly yieldBps: bigint | null;
    readonly avgStake: Paise | null;
  };
  /** 02 §6.4 */
  readonly costs: {
    readonly platformFees: Paise;
    readonly bonusesNet: Paise;
    readonly adjustmentsNet: Paise;
  };
  /** 02 §5 at `from - 1ms` and `to - 1ms`. */
  readonly position: { readonly start: PositionSnapshot; readonly end: PositionSnapshot };
  /** 02 §6.9, always with its components. */
  readonly allIn: {
    readonly grossBettingResult: Paise;
    readonly betCommissions: Paise;
    readonly platformFees: Paise;
    readonly bonusesNet: Paise;
    readonly adjustmentsNet: Paise;
    readonly frictionFees: Paise;
    readonly total: Paise;
  };
}

export interface BetResult {
  readonly betId: string;
  readonly platformId: string;
  readonly status: BetStatus;
  readonly stake: Paise;
  readonly payout: Paise;
  readonly refund: Paise;
  /** Cost: commissions minus commission refunds. */
  readonly commission: Paise;
  /** payout + refund − stake for SETTLED and VOID bets; null while OPEN or when ANNULLED. */
  readonly result: Paise | null;
  readonly outcome: BetOutcome;
}

export type CheckpointState = 'MATCHED' | 'RESOLVED' | 'OPEN';

export interface CheckpointStatus {
  readonly checkpointId: string;
  readonly difference: Paise;
  readonly adjusted: Paise;
  readonly residual: Paise;
  readonly state: CheckpointState;
}

export interface Violation {
  /** The invariant of 02 §11 this finding relates to. */
  readonly invariant: string;
  readonly rule: string;
  readonly entityId: string;
  readonly detail: string;
}

export class AccountingInputError extends Error {
  readonly violations: readonly Violation[];
  constructor(violations: readonly Violation[]) {
    super(
      `Invalid accounting input: ${violations
        .slice(0, 5)
        .map((v) => `${v.rule}(${v.entityId})`)
        .join(', ')}${violations.length > 5 ? `, +${violations.length - 5} more` : ''}`,
    );
    this.name = 'AccountingInputError';
    this.violations = violations;
  }
}
