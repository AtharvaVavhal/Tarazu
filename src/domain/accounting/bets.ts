// 02 §6.3 / §7: per-bet money derived from ledger entries, and outcomes.
import { prepare } from './prepare';
import type { BetOutcome, BetResult, LedgerData } from './types';

export function betResults(data: LedgerData): ReadonlyMap<string, BetResult> {
  const prep = prepare(data);
  const out = new Map<string, BetResult>();
  for (const { bet: b, sums } of prep.betRows) {
    const net = sums.payout + sums.refund - sums.stake;
    let outcome: BetOutcome;
    let result: bigint | null;
    switch (b.status) {
      case 'OPEN':
        outcome = 'OPEN';
        result = null;
        break;
      case 'ANNULLED':
        outcome = 'ANNULLED';
        result = null;
        break;
      case 'VOID':
        outcome = 'VOID';
        result = net;
        break;
      case 'SETTLED': {
        const r = sums.payout - sums.stake;
        outcome = r > 0n ? 'WIN' : r < 0n ? 'LOSS' : 'PUSH';
        result = net;
        break;
      }
    }
    out.set(b.id, {
      betId: b.id,
      platformId: b.platformId,
      status: b.status,
      stake: sums.stake,
      payout: sums.payout,
      refund: sums.refund,
      commission: sums.commission,
      result,
      outcome,
    });
  }
  return out;
}
