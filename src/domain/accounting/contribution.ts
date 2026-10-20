// Signed contribution of one ledger entry (02 §3, §4). The only place an entry's money effect is computed.
import type { Paise } from '../money/money';
import type { EntryType, LedgerEntry } from './types';

/** Entry types that add to the platform balance (before the reversal sign). */
const CREDITS: ReadonlySet<EntryType> = new Set<EntryType>([
  'OPENING_BALANCE',
  'DEPOSIT',
  'TRANSFER_IN',
  'BET_PAYOUT',
  'BET_REFUND',
  'FEE_REFUND',
  'BONUS_CREDIT',
  'ADJUSTMENT_CREDIT',
]);

type Shape = Pick<LedgerEntry, 'type' | 'amount' | 'fee' | 'isReversal'>;

/** −1 for a reversal, +1 otherwise (`sgn` in 02 §3). */
export function entrySign(e: Pick<LedgerEntry, 'isReversal'>): 1n | -1n {
  return e.isReversal ? -1n : 1n;
}

/** Effect on the platform balance (`platform_delta`). */
export function platformDelta(e: Shape): Paise {
  const magnitude = CREDITS.has(e.type) ? e.amount : -e.amount;
  return e.isReversal ? -magnitude : magnitude;
}

/** Effect on the user's bank account (`bank_delta`): deposits cost amount+fee, withdrawals return amount−fee. */
export function bankDelta(e: Shape): Paise {
  let magnitude: Paise;
  switch (e.type) {
    case 'DEPOSIT':
      magnitude = -(e.amount + e.fee);
      break;
    case 'WITHDRAWAL':
      magnitude = e.amount - e.fee;
      break;
    default:
      magnitude = 0n;
  }
  return e.isReversal ? -magnitude : magnitude;
}

/** `sgn × amount`, the weight an entry carries in a "signed sum" (Σ* in 02 §6). */
export function signedAmount(e: Pick<LedgerEntry, 'amount' | 'isReversal'>): Paise {
  return e.isReversal ? -e.amount : e.amount;
}

/** `sgn × fee`. */
export function signedFee(e: Pick<LedgerEntry, 'fee' | 'isReversal'>): Paise {
  return e.isReversal ? -e.fee : e.fee;
}
