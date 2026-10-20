// 02 §8: reconciliation checkpoints. A checkpoint's stored `ledger` is fixed at creation; these helpers
// compute that value and the checkpoint's state from the current ledger.
import { platformDelta } from './contribution';
import { prepare } from './prepare';
import {
  AccountingInputError,
  type Checkpoint,
  type CheckpointStatus,
  type EntryType,
  type LedgerData,
} from './types';

/**
 * Ledger balance of a platform at `asOf` (inclusive). Pass `excludeCheckpointId` to leave out that
 * checkpoint's own adjustments, which reproduces the value the server stored when it was created.
 */
export function checkpointLedgerBalance(
  data: LedgerData,
  platformId: string,
  asOf: number,
  excludeCheckpointId?: string,
): bigint {
  const prep = prepare(data);
  if (!prep.platformSet.has(platformId)) {
    throw new AccountingInputError([
      {
        invariant: '02§8',
        rule: 'UNKNOWN_PLATFORM',
        entityId: platformId,
        detail: `unknown platform ${platformId}`,
      },
    ]);
  }
  let total = 0n;
  for (const e of data.entries) {
    if (e.platformId !== platformId || e.occurredAt > asOf) continue;
    if (excludeCheckpointId !== undefined && e.checkpointId === excludeCheckpointId) continue;
    total += platformDelta(e);
  }
  return total;
}

/** difference = reported − ledger; residual = difference − Σ live adjustments (02 §8). */
export function checkpointStatus(data: LedgerData, checkpoint: Checkpoint): CheckpointStatus {
  prepare(data);
  const difference = checkpoint.reported - checkpoint.ledger;
  let adjusted = 0n;
  for (const e of data.entries) {
    if (e.checkpointId === checkpoint.id) adjusted += platformDelta(e);
  }
  const residual = difference - adjusted;
  return {
    checkpointId: checkpoint.id,
    difference,
    adjusted,
    residual,
    state: difference === 0n ? 'MATCHED' : residual === 0n ? 'RESOLVED' : 'OPEN',
  };
}

/** The adjustment that would settle the remaining residual, or null if there is nothing left to adjust. */
export function adjustmentFor(status: Pick<CheckpointStatus, 'residual'>): {
  readonly type: Extract<EntryType, 'ADJUSTMENT_CREDIT' | 'ADJUSTMENT_DEBIT'>;
  readonly amount: bigint;
} | null {
  if (status.residual === 0n) return null;
  return status.residual > 0n
    ? { type: 'ADJUSTMENT_CREDIT', amount: status.residual }
    : { type: 'ADJUSTMENT_DEBIT', amount: -status.residual };
}
