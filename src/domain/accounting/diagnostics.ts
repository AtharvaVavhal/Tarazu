// Findings over loaded data (04 §4): INV-ACC-07/08/09/11/13 breaches and the INV-ACC-14 warning.
// Structurally invalid data throws (AccountingInputError) before any diagnostics run.
import { platformDelta } from './contribution';
import { prepare } from './prepare';
import type { LedgerData, LedgerEntry, Violation } from './types';

const FIVE_MINUTES = 5 * 60_000;
const total = (es: readonly LedgerEntry[]) => es.reduce((sum, e) => sum + e.amount, 0n);

const finding = (invariant: string, rule: string, entityId: string, detail: string): Violation => ({
  invariant,
  rule,
  entityId,
  detail,
});

export function diagnostics(data: LedgerData): Violation[] {
  const prep = prepare(data);
  const out: Violation[] = [];

  const reversedIds = new Set<string>();
  for (const e of data.entries) if (e.reversesEntryId !== null) reversedIds.add(e.reversesEntryId);
  const isLive = (e: LedgerEntry) => !e.isReversal && !reversedIds.has(e.id);

  // INV-ACC-13
  for (const e of data.entries) {
    if (e.occurredAt > e.recordedAt + FIVE_MINUTES) {
      out.push(
        finding(
          'INV-ACC-13',
          'FUTURE_DATED',
          e.id,
          'occurredAt is more than 5 minutes after recordedAt',
        ),
      );
    }
  }

  // INV-ACC-07: transfer groups
  const groups = new Map<string, LedgerEntry[]>();
  for (const e of data.entries) {
    if (e.transferGroupId === null) continue;
    const list = groups.get(e.transferGroupId);
    if (list) list.push(e);
    else groups.set(e.transferGroupId, [e]);
  }
  for (const [group, legs] of groups) {
    const sum = legs.reduce((s, e) => s + platformDelta(e), 0n);
    const outs = legs.filter((e) => e.type === 'TRANSFER_OUT');
    const ins = legs.filter((e) => e.type === 'TRANSFER_IN');
    const samePlatform = outs.some(
      (o) => !o.isReversal && ins.some((i) => !i.isReversal && i.platformId === o.platformId),
    );
    if (sum !== 0n || outs.length !== ins.length || samePlatform) {
      out.push(
        finding(
          'INV-ACC-07',
          'TRANSFER_UNBALANCED',
          group,
          `legs sum to ${sum} paise (${outs.length} out, ${ins.length} in)${samePlatform ? '; both legs on one platform' : ''}`,
        ),
      );
    }
  }

  // INV-ACC-08 / INV-ACC-09: bet status versus live ledger entries, and bet-dated entries
  for (const b of data.bets) {
    const live = (prep.entriesByBet.get(b.id) ?? []).filter(isLive);
    const stakes = live.filter((e) => e.type === 'BET_STAKE');
    const payouts = live.filter((e) => e.type === 'BET_PAYOUT');
    const refunds = live.filter((e) => e.type === 'BET_REFUND');

    if (live.some((e) => e.platformId !== b.platformId)) {
      out.push(
        finding(
          'INV-ACC-08',
          'BET_ENTRY_PLATFORM',
          b.id,
          'a live entry of this bet is on a different platform',
        ),
      );
    }

    let consistent: boolean;
    switch (b.status) {
      case 'OPEN':
        consistent = stakes.length === 1 && payouts.length === 0 && refunds.length === 0;
        break;
      case 'SETTLED':
        consistent = stakes.length === 1 && refunds.length === 0 && payouts.length <= 1;
        break;
      case 'VOID':
        consistent =
          stakes.length === 1 &&
          payouts.length === 0 &&
          refunds.length === 1 &&
          total(refunds) === total(stakes);
        break;
      case 'ANNULLED':
        consistent = live.length === 0;
        break;
    }
    if (!consistent) {
      out.push(
        finding(
          'INV-ACC-08',
          'BET_STATUS_MISMATCH',
          b.id,
          `${b.status} bet has ${stakes.length} live stake(s), ${payouts.length} payout(s), ${refunds.length} refund(s)`,
        ),
      );
    }

    for (const e of stakes) {
      if (e.occurredAt !== b.placedAt) {
        out.push(
          finding('INV-ACC-09', 'BET_ENTRY_DATE', e.id, 'stake is not dated at the bet placedAt'),
        );
      }
    }
    for (const e of [...payouts, ...refunds]) {
      if (b.settledAt !== null && e.occurredAt !== b.settledAt) {
        out.push(
          finding(
            'INV-ACC-09',
            'BET_ENTRY_DATE',
            e.id,
            'payout/refund is not dated at the bet settledAt',
          ),
        );
      }
    }
  }

  // INV-ACC-11: opening balance
  for (const platformId of prep.platformIds) {
    const live = data.entries.filter((e) => e.platformId === platformId && isLive(e));
    const openings = live.filter((e) => e.type === 'OPENING_BALANCE');
    if (openings.length > 1) {
      out.push(
        finding(
          'INV-ACC-11',
          'OPENING_ORDER',
          platformId,
          `${openings.length} live opening balances`,
        ),
      );
    }
    const first = openings[0];
    if (first) {
      const early = live.find(
        (e) => e.type !== 'OPENING_BALANCE' && e.occurredAt < first.occurredAt,
      );
      if (early) {
        out.push(
          finding(
            'INV-ACC-11',
            'OPENING_ORDER',
            early.id,
            'entry is dated before the platform opening balance',
          ),
        );
      }
    }
  }

  // INV-ACC-14 (warning): balance below zero at some instant; evaluated after all entries of an instant
  for (const platformId of prep.platformIds) {
    const entries = data.entries
      .filter((e) => e.platformId === platformId)
      .sort((a, b) => a.occurredAt - b.occurredAt);
    let balance = 0n;
    let previousAt: number | null = null;
    let reported = false;
    const report = (at: number) => {
      out.push(
        finding(
          'INV-ACC-14',
          'NEGATIVE_BALANCE',
          platformId,
          `ledger implies ${balance} paise at ${at}; a record is probably missing`,
        ),
      );
      reported = true;
    };
    for (const e of entries) {
      // the balance at instant t includes every entry at t, so test it only once t has been fully applied
      if (previousAt !== null && e.occurredAt !== previousAt && balance < 0n) {
        report(previousAt);
        break;
      }
      balance += platformDelta(e);
      previousAt = e.occurredAt;
    }
    if (!reported && previousAt !== null && balance < 0n) report(previousAt);
  }

  return out.sort(
    (a, b) =>
      a.invariant.localeCompare(b.invariant) ||
      a.rule.localeCompare(b.rule) ||
      a.entityId.localeCompare(b.entityId),
  );
}
