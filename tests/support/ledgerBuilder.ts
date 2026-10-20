// Test-only builder that produces *valid* ledgers by following the lifecycle rules of 02 §3, §4, §7
// literally (reversal pairs, bet-dated entries). It is deliberately independent of the engine.
import type {
  Bet,
  Checkpoint,
  EntryType,
  LedgerData,
  LedgerEntry,
  Platform,
} from '@/domain/accounting';

export class LedgerBuilder {
  readonly platforms: Platform[] = [];
  readonly entries: LedgerEntry[] = [];
  readonly bets: Bet[] = [];
  readonly checkpoints: Checkpoint[] = [];
  private readonly reversed = new Set<string>();
  private seq = 0;
  private maxTime = 0;

  nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}${this.seq}`;
  }

  addPlatform(id: string): this {
    this.platforms.push({ id, name: id });
    return this;
  }

  /** Raw append; callers are responsible for validity. */
  add(
    e: Partial<LedgerEntry> & Pick<LedgerEntry, 'platformId' | 'type' | 'amount' | 'occurredAt'>,
  ): LedgerEntry {
    const entry: LedgerEntry = {
      id: e.id ?? this.nextId('E'),
      platformId: e.platformId,
      type: e.type,
      amount: e.amount,
      fee: e.fee ?? 0n,
      isReversal: e.isReversal ?? false,
      reversesEntryId: e.reversesEntryId ?? null,
      betId: e.betId ?? null,
      feeKind: e.feeKind ?? null,
      transferGroupId: e.transferGroupId ?? null,
      checkpointId: e.checkpointId ?? null,
      occurredAt: e.occurredAt,
      recordedAt: e.recordedAt ?? e.occurredAt,
      externalRef: e.externalRef ?? null,
      note: e.note ?? null,
    };
    this.maxTime = Math.max(this.maxTime, entry.occurredAt, entry.recordedAt);
    this.entries.push(entry);
    return entry;
  }

  opening(p: string, amount: bigint, at: number) {
    return this.add({ platformId: p, type: 'OPENING_BALANCE', amount, occurredAt: at });
  }
  deposit(p: string, amount: bigint, fee: bigint, at: number) {
    return this.add({ platformId: p, type: 'DEPOSIT', amount, fee, occurredAt: at });
  }
  withdrawal(p: string, amount: bigint, fee: bigint, at: number) {
    return this.add({ platformId: p, type: 'WITHDRAWAL', amount, fee, occurredAt: at });
  }
  transfer(from: string, to: string, amount: bigint, at: number): string {
    const group = this.nextId('T');
    this.add({
      platformId: from,
      type: 'TRANSFER_OUT',
      amount,
      transferGroupId: group,
      occurredAt: at,
    });
    this.add({
      platformId: to,
      type: 'TRANSFER_IN',
      amount,
      transferGroupId: group,
      occurredAt: at,
    });
    return group;
  }
  platformFee(p: string, amount: bigint, at: number) {
    return this.add({
      platformId: p,
      type: 'FEE',
      amount,
      feeKind: 'PLATFORM_FEE',
      occurredAt: at,
    });
  }
  platformFeeRefund(p: string, amount: bigint, at: number) {
    return this.add({
      platformId: p,
      type: 'FEE_REFUND',
      amount,
      feeKind: 'PLATFORM_FEE',
      occurredAt: at,
    });
  }
  commission(betId: string, amount: bigint, at: number, refund = false) {
    const bet = this.bet(betId);
    return this.add({
      platformId: bet.platformId,
      type: refund ? 'FEE_REFUND' : 'FEE',
      amount,
      feeKind: 'BET_COMMISSION',
      betId,
      occurredAt: at,
    });
  }
  bonus(p: string, amount: bigint, at: number, forfeit = false) {
    return this.add({
      platformId: p,
      type: forfeit ? 'BONUS_FORFEIT' : 'BONUS_CREDIT',
      amount,
      occurredAt: at,
    });
  }

  bet(id: string): Bet {
    const b = this.bets.find((x) => x.id === id);
    if (!b) throw new Error(`unknown bet ${id}`);
    return b;
  }
  private setBet(id: string, patch: Partial<Bet>) {
    const i = this.bets.findIndex((x) => x.id === id);
    const cur = this.bets[i];
    if (!cur) throw new Error(`unknown bet ${id}`);
    this.bets[i] = { ...cur, ...patch };
  }

  placeBet(p: string, stake: bigint, at: number): string {
    const id = this.nextId('B');
    this.bets.push({ id, platformId: p, status: 'OPEN', placedAt: at, settledAt: null });
    this.add({ platformId: p, type: 'BET_STAKE', amount: stake, betId: id, occurredAt: at });
    return id;
  }

  private liveEntries(betId: string, types: EntryType[]): LedgerEntry[] {
    return this.entries.filter(
      (e) =>
        e.betId === betId && types.includes(e.type) && !e.isReversal && !this.reversed.has(e.id),
    );
  }

  private applySettlement(betId: string, payout: bigint | 'VOID', at: number) {
    const bet = this.bet(betId);
    if (at < bet.placedAt) throw new Error('settled before placed');
    if (payout === 'VOID') {
      const stake = this.liveEntries(betId, ['BET_STAKE']).reduce((s, e) => s + e.amount, 0n);
      this.add({
        platformId: bet.platformId,
        type: 'BET_REFUND',
        amount: stake,
        betId,
        occurredAt: at,
      });
      this.setBet(betId, { status: 'VOID', settledAt: at });
    } else {
      if (payout > 0n) {
        this.add({
          platformId: bet.platformId,
          type: 'BET_PAYOUT',
          amount: payout,
          betId,
          occurredAt: at,
        });
      }
      this.setBet(betId, { status: 'SETTLED', settledAt: at });
    }
  }

  settle(betId: string, payout: bigint, at: number) {
    if (this.bet(betId).status !== 'OPEN') throw new Error('bet not open');
    this.applySettlement(betId, payout, at);
  }
  voidBet(betId: string, at: number) {
    if (this.bet(betId).status !== 'OPEN') throw new Error('bet not open');
    this.applySettlement(betId, 'VOID', at);
  }
  reopen(betId: string) {
    const bet = this.bet(betId);
    if (bet.status !== 'SETTLED' && bet.status !== 'VOID') throw new Error('cannot reopen');
    for (const e of this.liveEntries(betId, ['BET_PAYOUT', 'BET_REFUND'])) this.reverse(e.id);
    this.setBet(betId, { status: 'OPEN', settledAt: null });
  }
  resettle(betId: string, payout: bigint | 'VOID', at: number) {
    this.reopen(betId);
    this.applySettlement(betId, payout, at);
  }
  /** 02 §7 `correct(stake)`: reverse live stake (and live refund if VOID), post new ones. */
  correctStake(betId: string, newStake: bigint) {
    const bet = this.bet(betId);
    if (bet.status === 'ANNULLED') throw new Error('annulled');
    const wasVoid = bet.status === 'VOID';
    for (const e of this.liveEntries(
      betId,
      wasVoid ? ['BET_STAKE', 'BET_REFUND'] : ['BET_STAKE'],
    )) {
      this.reverse(e.id);
    }
    this.add({
      platformId: bet.platformId,
      type: 'BET_STAKE',
      amount: newStake,
      betId,
      occurredAt: bet.placedAt,
    });
    if (wasVoid && bet.settledAt !== null) {
      this.add({
        platformId: bet.platformId,
        type: 'BET_REFUND',
        amount: newStake,
        betId,
        occurredAt: bet.settledAt,
      });
    }
  }
  annul(betId: string) {
    const bet = this.bet(betId);
    if (bet.status === 'ANNULLED') throw new Error('already annulled');
    const all = this.entries.filter(
      (e) => e.betId === betId && !e.isReversal && !this.reversed.has(e.id),
    );
    for (const e of all) this.reverse(e.id);
    this.setBet(betId, { status: 'ANNULLED' });
  }

  /** Writes the mirror entry (02 §4): same fields, isReversal, inherits occurredAt (DEC-013). */
  reverse(entryId: string): LedgerEntry {
    const o = this.entries.find((e) => e.id === entryId);
    if (!o) throw new Error(`unknown entry ${entryId}`);
    if (o.isReversal || this.reversed.has(o.id)) throw new Error('not reversible');
    this.reversed.add(o.id);
    return this.add({
      platformId: o.platformId,
      type: o.type,
      amount: o.amount,
      fee: o.fee,
      isReversal: true,
      reversesEntryId: o.id,
      betId: o.betId,
      feeKind: o.feeKind,
      transferGroupId: o.transferGroupId,
      checkpointId: o.checkpointId,
      occurredAt: o.occurredAt,
      recordedAt: this.maxTime + 1,
      note: o.note, // reversals of adjustments need the mandatory note too (03 §2.6)
    });
  }

  isLive(entryId: string): boolean {
    const e = this.entries.find((x) => x.id === entryId);
    return e !== undefined && !e.isReversal && !this.reversed.has(entryId);
  }

  /** Records a checkpoint with the given ledger balance; if reported differs, posts the adjustment at `asOf`. */
  checkpoint(p: string, asOf: number, ledger: bigint, reported: bigint, resolve: boolean): string {
    const id = this.nextId('C');
    this.checkpoints.push({ id, platformId: p, asOf, reported, ledger });
    const diff = reported - ledger;
    if (resolve && diff !== 0n) {
      this.add({
        platformId: p,
        type: diff > 0n ? 'ADJUSTMENT_CREDIT' : 'ADJUSTMENT_DEBIT',
        amount: diff > 0n ? diff : -diff,
        checkpointId: id,
        occurredAt: asOf,
        note: 'reconciliation difference',
      });
    }
    return id;
  }

  data(): LedgerData {
    return {
      platforms: [...this.platforms],
      entries: [...this.entries],
      bets: [...this.bets],
      checkpoints: [...this.checkpoints],
    };
  }
}
