# Tarazu — Accounting Specification

Authority for all money behaviour (see `00` §2). Terms are defined in `00` §3. Every number in §12 was recomputed independently (script run 2026-10-20) and every identity in §11 was checked to hold on that data.

## 1. Principles applied here

1. Only the **ledger** moves balances (P-4). Bets, sessions, limits, and checkpoints never carry money that affects a balance.
2. **Cash flow, betting performance, and position are three separate families** (P-6) and are never added into one "profit" number. Only the explicitly named *All-in net result* combines them, and its definition is fixed in §6.9.
3. **One real-world event ⇒ one ledger event** (P-7). §10 lists the double-counting traps and how each is prevented.
4. Corrections are new entries, never edits (P-5).

## 2. Units, bounds, rounding

- **Money**: integer paise, `bigint` in PostgreSQL and native `bigint` in TypeScript. No `number` in money paths. `1 ≤ amount ≤ 10¹²` paise (₹10,000,000,000). Fees `0 ≤ fee ≤ 10¹²`. (INV-ACC-01)
- **Parsing user input**: decimal rupee string → paise by string manipulation (max 2 decimal places, no exponent, no `parseFloat`). `"1,234.5"` → `123450`. More than 2 decimals is a validation error, not a rounding.
- **Aggregates** returned from SQL are text and parsed to `bigint`.
- **Ratios** (yield, hit rate, utilisation) are derived for display only, never stored: `bps = round_half_away_from_zero(numerator × 10000 / denominator)` using `bigint`. Zero denominator ⇒ `null` (rendered `—`). Display as percent with two decimals (`1667 bps → 16.67%`).
- **Display**: `₹` + en-IN grouping (`₹1,23,456.78`); negatives with a leading minus and never colour-only (see `05` §7).
- **Charts** may convert paise to `Number` rupees at the very last presentation step; that is the only permitted float use.

## 3. Ledger entry types

Every ledger entry has: `platform`, `entry_type`, `amount` (> 0), `fee` (≥ 0, only on DEPOSIT/WITHDRAWAL), `is_reversal`, `occurred_at`, optional links. `sgn = −1` if `is_reversal` else `+1`.

`platform_delta = sgn × (±amount)` per the table. `bank_delta` is the effect on the user's real bank account.

| Entry type | `platform_delta` (before sgn) | `bank_delta` (before sgn) | Family | Required links |
|---|---|---|---|---|
| `OPENING_BALANCE` | +amount | 0 | Opening | — |
| `DEPOSIT` | +amount | −(amount + fee) | External flow | — |
| `WITHDRAWAL` | −amount | +(amount − fee) | External flow | fee ≤ amount |
| `TRANSFER_OUT` | −amount | 0 | Transfer | `transfer_group` |
| `TRANSFER_IN` | +amount | 0 | Transfer | `transfer_group` |
| `BET_STAKE` | −amount | 0 | Betting | `bet` |
| `BET_PAYOUT` | +amount | 0 | Betting | `bet` |
| `BET_REFUND` | +amount | 0 | Betting (void only) | `bet` |
| `FEE` | −amount | 0 | Cost | `fee_kind`; `bet` iff `BET_COMMISSION` |
| `FEE_REFUND` | +amount | 0 | Cost | `fee_kind`; `bet` iff `BET_COMMISSION` |
| `BONUS_CREDIT` | +amount | 0 | Bonus | — |
| `BONUS_FORFEIT` | −amount | 0 | Bonus | — |
| `ADJUSTMENT_CREDIT` | +amount | 0 | Adjustment | `checkpoint` |
| `ADJUSTMENT_DEBIT` | −amount | 0 | Adjustment | `checkpoint` |

**Fee kinds:** `BET_COMMISSION` (charged on a specific bet, e.g. exchange commission) and `PLATFORM_FEE` (any other charge deducted from the platform balance). Taxes deducted by a platform are recorded as `PLATFORM_FEE` with a note until Q-013 is resolved.

**Where a fee is recorded depends on who is charged, once only (INV-ACC-10):**
- Deducted **from the platform balance** → `FEE` entry (platform delta).
- Charged **outside** the platform on a deposit/withdrawal (bank, UPI, gateway) → `fee` field on that DEPOSIT/WITHDRAWAL (bank delta only).

**There is no standalone "payout", "winnings", or "profit" entry type.** A payout exists only as `BET_PAYOUT` created by settling a bet (INV-ACC-10).

## 4. Reversals and corrections

A reversal is an entry with `is_reversal = true` and `reverses_entry_id` pointing to an original. It copies the original's platform, type, amount, fee, bet, fee kind, transfer group, and checkpoint, and by `sgn = −1` contributes exactly the negative of the original to **every** sum, delta, and metric. (INV-ACC-03)

- An entry can be reversed at most once; a reversal cannot be reversed. To "undo an undo", post a fresh entry.
- A reversal **inherits the original's `occurred_at`** (DEC-013): the corrected history reads as if it had always been right. `recorded_at` (server time) and the audit log preserve when the correction was made. Consequence: past period totals can change after a correction; this is intended.
- Editing an entry's amount/date/type = reverse + new entry in one RPC transaction.
- Only `note` is editable in place (audited).

## 5. Derived position quantities

For platform *p* and instant *t* (inclusive; `occurred_at ≤ t`), over all entries:

```
balance(p, t)   = Σ platform_delta(e)                          for e on p, occurred_at ≤ t
openStake(p, t) = Σ liveStake(b)                               for bets b on p with
                    placed_at ≤ t  AND NOT (status(b) ≠ OPEN AND settled_at(b) ≤ t)
                    where liveStake(b) = Σ sgn × amount over b's BET_STAKE entries
equity(p, t)    = balance(p, t) + openStake(p, t)
```

`ANNULLED` bets have `liveStake = 0` by construction, so they never contribute. Totals across platforms are plain sums. `openStake` is **cost**, never potential return (INV-ACC-12).

## 6. Metric catalog

All metrics take a **filter** (platform set; time window `[from, to)` half-open in the user's time zone). `Σ*` below means "signed sum": each entry weighted by `sgn`. "Window" entries are those with `from ≤ occurred_at < to`.

### 6.1 External cash flow (not performance)

```
deposited      D     = Σ* amount   of DEPOSIT      in window
withdrawn      W     = Σ* amount   of WITHDRAWAL   in window
netDeposited         = D − W                         (positive: more put in than taken out)
frictionFees   Fd,Fw = Σ* fee      of DEPOSIT / WITHDRAWAL in window;  frictionFees = Fd + Fw
netCash              = Σ* bank_delta over window     = (W − Fw) − (D + Fd)
                       (positive: net money returned to the bank account)
```

### 6.2 Opening and transfers (neutral)

```
openings       O     = Σ* amount of OPENING_BALANCE in window
transfersNet   T     = Σ* amount TRANSFER_IN − Σ* amount TRANSFER_OUT in window
```
`T = 0` whenever all platforms are in the filter. With a platform filter, T shows money moved to/from other platforms and is excluded from D, W, and every performance metric.

### 6.3 Betting performance

Attributed to **settlement date** (`bets.settled_at`):

```
settledBets(window) = bets with status = SETTLED and settled_at in window
grossBettingResult G = Σ over settledBets of ( payout(b) + refund(b) − stake(b) )
    payout(b) = Σ* BET_PAYOUT amount; refund(b) = Σ* BET_REFUND amount; stake(b) = Σ* BET_STAKE amount
      (VOID bets are not in settledBets; their net is 0 by construction.)
turnover             = Σ over settledBets of stake(b)
betCommissions Cb    = Σ* FEE(kind BET_COMMISSION) − Σ* FEE_REFUND(kind BET_COMMISSION), by entry date in window
netBettingResult     = G − Cb
```

Counts (per window): `betsPlaced` = bets with `placed_at` in window and status ≠ ANNULLED; `settledCount`, `voidCount` by `settled_at`; `openCount` as of `to`.
Per-bet outcome of a SETTLED bet by `r = payout − stake`: `WIN` (r > 0), `LOSS` (r < 0, including partial cash-out below stake), `PUSH` (r = 0). `hitRate = wins / (wins + losses)` in bps; pushes excluded from both.
`yield = netBettingResult × 10000 / turnover` in bps (null if turnover = 0). `avgStake = turnover / settledCount` (integer paise, rounded half away).

### 6.4 Other costs and credits

```
platformFees  Cp  = Σ* FEE(kind PLATFORM_FEE) − Σ* FEE_REFUND(kind PLATFORM_FEE)   in window
bonusesNet    Bn  = Σ* BONUS_CREDIT − Σ* BONUS_FORFEIT                            in window
adjustmentsNet A  = Σ* ADJUSTMENT_CREDIT − Σ* ADJUSTMENT_DEBIT                     in window
```
Bonuses are never part of G. Adjustments are never hidden inside G; they are shown as their own line so reconciliation differences cannot silently flatter or worsen performance.

### 6.5 Limit metrics (period = `DAY | WEEK | MONTH` in user time zone, current period to date)

| Metric | Definition (live entries only) | Unit |
|---|---|---|
| `STAKED` | Σ stake of bets with `placed_at` in period, any status except ANNULLED (VOID included: the money was committed) | paise |
| `NET_LOSS` | `max(0, −netBettingResult)` for the period (by settlement date) | paise |
| `DEPOSITED` | `D` for the period | paise |
| `BET_COUNT` | `betsPlaced` for the period | count |
| `SESSION_MINUTES` | Σ minutes of session time overlapping the period; an open session counts until now | minutes |

Utilisation = `current × 100 / threshold` (integer percent, floor). States: `OK` < `warn_at_percent` ≤ `WARNING` < 100 ≤ `EXCEEDED`. Limits are advisory (DEC-012): they warn, and never block recording an event that happened.

### 6.6 Risk signals (descriptive; thresholds configurable, defaults open — Q-011)

| Signal | Definition |
|---|---|
| Stake escalation | median stake of bets placed in last 7 days ÷ median over the previous 28 days ≥ ratio (default 1.5) |
| Late-night activity | share of bets placed 23:00–05:00 local in the last 28 days ≥ share |
| Rapid redeposit | a DEPOSIT within N minutes (default 60) after a bet settled as LOSS |
| Deposit frequency | ≥ N deposits within 24 h (default 3) |

Signals state facts ("3 deposits in the last 24 hours") and never advise.

### 6.7 Position

`balance`, `openStake`, `equity` as in §5, per platform and in total, at "now" or any past instant.

### 6.8 Period attribution rules (the "which date?" table)

| Metric family | Attributed by |
|---|---|
| D, W, fees on them, O, T, Bn, A, Cp, Cb | `occurred_at` of the ledger entry |
| G, turnover, outcome counts, hit rate, yield | bet `settled_at` |
| `betsPlaced`, `STAKED`, `BET_COUNT` | bet `placed_at` |
| balance, openStake, equity | as-of instant |

Bet-linked entries are dated by the bet's own timestamps: `BET_STAKE.occurred_at = placed_at`; `BET_PAYOUT`/`BET_REFUND.occurred_at = settled_at` (INV-ACC-09). Moving a bet's timestamps is a correction (§7).

### 6.9 All-in net result

```
allInNetResult = G − Cb − Cp + Bn + A − (Fd + Fw)
```
Plain reading: *what taking part actually cost or returned, after every fee, bonus, and reconciliation difference, ignoring how much was moved in or out.* Excludes D, W, O, T. Displayed with its component lines; never shown without them.

## 7. Bet lifecycle

States: `OPEN → SETTLED | VOID`; `SETTLED | VOID → OPEN | SETTLED | VOID` (correction); any → `ANNULLED` (terminal).

| Action | Preconditions | Ledger effect (single transaction) | Bet row |
|---|---|---|---|
| `place` | platform not archived; `stake ≥ 1` | `BET_STAKE` = stake @ `placed_at` | `OPEN`; `settled_at` null |
| `settle(payout ≥ 0, settled_at)` | status `OPEN`; `settled_at ≥ placed_at` | if payout > 0: `BET_PAYOUT` = payout @ `settled_at` (total return) | `SETTLED` |
| `void(settled_at)` | status `OPEN` | `BET_REFUND` = live stake @ `settled_at` | `VOID` |
| `resettle` | status `SETTLED`/`VOID` | reverse live payout/refund, then apply `settle` or `void` | new status/`settled_at` |
| `reopen` | status `SETTLED`/`VOID` | reverse live payout/refund | `OPEN`; `settled_at` null |
| `correct(stake?, placed_at?)` | not `ANNULLED` | reverse live stake (and live refund if `VOID`), post new stake (and refund = new stake if `VOID`) | fields updated |
| `annul` | not `ANNULLED` | reverse every live entry linked to the bet (stake, payout, refund, bet fees) | `ANNULLED` |
| `commission` (add fee) | status ≠ `OPEN`, ≠ `ANNULLED` | `FEE`(`BET_COMMISSION`, bet) any date ≥ `placed_at` | unchanged |

Status ⇄ ledger consistency (INV-ACC-08): `OPEN` ⇒ no live payout/refund; `SETTLED` ⇒ exactly one live stake, no live refund, payout ≥ 0 (zero payout ⇒ lost, no entry); `VOID` ⇒ exactly one live stake, no live payout, live refund = live stake; `ANNULLED` ⇒ all linked entries net to zero.

A cash-out is just a settlement whose payout is the cash-out amount. Payout may exceed stake by any amount; there is no upper limit other than the amount bound.

## 8. Reconciliation

A **checkpoint** records: platform, `as_of`, `reported` (what the platform displays), and `ledger` (the ledger balance at `as_of`, computed by the server at creation and stored). `difference = reported − ledger`.

| State | Condition |
|---|---|
| `MATCHED` | `difference = 0` |
| `RESOLVED` | `difference ≠ 0` and `residual = 0` |
| `OPEN` | `difference ≠ 0` and `residual ≠ 0` |

`residual = difference − Σ platform_delta of live adjustment entries linked to the checkpoint`.

Resolution order the UI must present: (1) look for a missing/wrong entry and fix it via reversal — this changes `ledger_balance` going forward (the stored checkpoint is not altered); (2) only if the cause is unknown or unrecoverable, post an adjustment: `ADJUSTMENT_CREDIT` if `difference > 0` else `ADJUSTMENT_DEBIT`, `amount = |residual|`, dated `as_of`, with a mandatory note. Adjustments flow into *All-in net result* as their own line (§6.4).

## 9. Time

All instants are UTC `timestamptz`. Windows, day/week/month buckets, and "late-night" are computed in the user's time zone (default `Asia/Kolkata`, DST-safe via IANA zone). Windows are `[from, to)`; "as of *t*" is inclusive. `occurred_at` may not exceed server now + 5 minutes. Ordering for running balances: `(occurred_at, recorded_at, id)`; totals never depend on order (INV-ACC-04).

## 10. Double-counting traps and their guards

| # | Trap | Guard |
|---|---|---|
| 1 | Winnings recorded as bet payout **and** as a deposit/"payout" row | No standalone payout type; payouts only via settle (INV-ACC-10) |
| 2 | Withdrawing winnings treated as profit realised | Withdrawals are external flow (§6.1), excluded from G |
| 3 | Deposit treated as a loss | Deposits are external flow only |
| 4 | Platform-to-platform move counted as W + D | Transfer pair, neutral; excluded from D/W (§6.2) |
| 5 | Bonus counted as a betting win | Separate `Bn` line, excluded from G |
| 6 | Stake of an open bet counted as a loss | Excluded from G until settled; shown as at-risk cost in equity |
| 7 | Void counted as turnover / a bet won or lost | `VOID` excluded from `settledBets` |
| 8 | A fee counted twice (as `fee` field and as `FEE` entry) | §3 "recorded once" rule; UI asks "Was this deducted from the platform balance?" |
| 9 | Correction by adding a "fix" entry next to the wrong one | Reversal pairing + one-reversal-per-entry; UI offers only "Correct" |
| 10 | Same deposit/withdrawal entered twice | Unique `(user, platform, external_ref)`; UI warns on same platform + amount within 24 h |
| 11 | Adjustment used to hide a recording mistake | Adjustment requires checkpoint + note and is displayed as its own line |
| 12 | Entries dated before the opening balance | Rejected (INV-ACC-11) |

## 11. Invariants (must hold for every valid ledger; each has an automated test — `07` §3 and §4)

| ID | Invariant |
|---|---|
| INV-ACC-01 | Amounts are integers with `1 ≤ amount ≤ 10¹²`; fee `0 ≤ fee ≤ 10¹²`; fee > 0 only on DEPOSIT/WITHDRAWAL; withdrawal fee ≤ amount. |
| INV-ACC-02 | `balance(p,t) = Σ platform_delta`, computed from entries alone. |
| INV-ACC-03 | A reversal mirrors its original in all fields, reverses at most one entry, is reversed by none, and contributes exactly the negative in every sum. |
| INV-ACC-04 | Every metric is invariant under any permutation of the entry list. |
| INV-ACC-05 | **Equity identity**, for any filter and window `[from, to)`, with `t0 = from − 1µs` and `t1 = to − 1µs`: `equity(t1) − equity(t0) = O + (D − W) + T + G − Cb − Cp + Bn + A`. |
| INV-ACC-06 | **All-in identity**: `allInNetResult = netCash + (equity(t1) − equity(t0)) − O − T`. |
| INV-ACC-07 | Every transfer group has exactly one OUT and one IN, same amount, different platforms; their `platform_delta` sum to 0. |
| INV-ACC-08 | Bet status is consistent with live ledger entries (§7). |
| INV-ACC-09 | `BET_STAKE.occurred_at = bet.placed_at`; `BET_PAYOUT/BET_REFUND.occurred_at = bet.settled_at`. |
| INV-ACC-10 | `BET_PAYOUT`/`BET_REFUND` exist only with a `bet` link and only through lifecycle RPCs; a real-world charge is recorded once (§3). |
| INV-ACC-11 | At most one live `OPENING_BALANCE` per platform, and no entry on that platform is dated before it. |
| INV-ACC-12 | Open bets are valued at cost; no metric uses odds or potential return. |
| INV-ACC-13 | `occurred_at ≤ recorded_at + 5 min`. |
| INV-ACC-14 | *Diagnostic, not enforced:* `balance(p,t) ≥ 0` for all t. A violation is surfaced in diagnostics as "ledger implies negative balance — a record is probably missing". |
| INV-ACC-15 | Derived metrics are never stored; they are recomputed from live entries. Ratios use §2 rounding. |

## 12. Worked example (golden fixture)

Currency INR; dates are local (IST) calendar dates in 2026; amounts in rupees (paise = ×100). Two platforms: **Alpha** (A) and **Beta** (B).

### 12.1 Ledger

| Entry | Date | Plat | Type | Amount | Fee | Link | Platform Δ | Bank Δ |
|---|---|---|---|---:|---:|---|---:|---:|
| E01 | 01-01 | A | OPENING_BALANCE | 5,000.00 | | | +5,000.00 | |
| E02 | 01-02 | A | DEPOSIT | 2,000.00 | 10.00 | | +2,000.00 | −2,010.00 |
| E03 | 01-03 | A | BET_STAKE | 1,000.00 | | B1 | −1,000.00 | |
| E04 | 01-03 | A | BET_PAYOUT | 1,800.00 | | B1 | +1,800.00 | |
| E05 | 01-03 | A | FEE (BET_COMMISSION) | 50.00 | | B1 | −50.00 | |
| E06 | 01-04 | A | BET_STAKE | 500.00 | | B2 | −500.00 | |
| E07 | 01-05 | A | BET_STAKE | 700.00 | | B3 | −700.00 | |
| E08 | 01-05 | A | BET_REFUND | 700.00 | | B3 | +700.00 | |
| E09 | 01-06 | A | BET_STAKE | 400.00 | | B4 | −400.00 | |
| E10 | 01-07 | A | BONUS_CREDIT | 300.00 | | | +300.00 | |
| E11 | 01-10 | A | FEE (PLATFORM_FEE) | 100.00 | | | −100.00 | |
| E12 | 01-20 | A | WITHDRAWAL | 3,000.00 | 15.00 | | −3,000.00 | +2,985.00 |
| E13 | 01-22 | A | TRANSFER_OUT | 500.00 | | T1 | −500.00 | |
| E14 | 01-22 | B | TRANSFER_IN | 500.00 | | T1 | +500.00 | |
| E15 | 01-25 | A | ADJUSTMENT_DEBIT | 20.00 | | C1 | −20.00 | |
| E16 | 01-30 | B | BET_STAKE | 300.00 | | B5 | −300.00 | |
| E17 | 02-01 | B | BET_PAYOUT | 900.00 | | B5 | +900.00 | |

### 12.2 Bets

| Bet | Platform | Placed | Status | Settled | Stake | Payout | Refund | Outcome |
|---|---|---|---|---|---:|---:|---:|---|
| B1 | A | 01-03 | SETTLED | 01-03 | 1,000.00 | 1,800.00 | | WIN (+800.00) |
| B2 | A | 01-04 | SETTLED | 01-04 | 500.00 | 0 (no entry) | | LOSS (−500.00) |
| B3 | A | 01-05 | VOID | 01-05 | 700.00 | | 700.00 | — |
| B4 | A | 01-06 | SETTLED | 02-03 | 400.00 | 0 (no entry) | | LOSS (−400.00) |
| B5 | B | 01-30 | SETTLED | 02-01 | 300.00 | 900.00 | | WIN (+600.00) |

Checkpoint **C1**: platform A, `as_of` 01-25 end of day, reported 3,530.00; ledger at that time (E01–E13 only, before E15) = 3,550.00.

### 12.3 Rows to assert (each is a fixture assertion, `07` §3)

| ID | Quantity | Window / as-of | Value |
|---|---|---|---:|
| EX-01 | balance A / balance B | as of 01-31 | 3,530.00 / 200.00 |
| EX-02 | openStake A / B (B4 / B5) | as of 01-31 | 400.00 / 300.00 |
| EX-03 | equity total | as of 01-31 | 4,430.00 |
| EX-04 | D, W, netDeposited, Fd, Fw | January | 2,000.00; 3,000.00; −1,000.00; 10.00; 15.00 |
| EX-05 | netCash | January | +975.00 (bank in 2,985.00 − bank out 2,010.00) |
| EX-06 | G; Cb; netBettingResult | January | 300.00; 50.00; 250.00 |
| EX-07 | Cp; Bn; A | January | 100.00; 300.00; −20.00 |
| EX-08 | allInNetResult | January | **405.00** = 300 − 50 − 100 + 300 − 20 − 25 |
| EX-09 | Equity identity (all platforms) | January | 4,430.00 = 5,000 + (−1,000) + 0 + 300 − 50 − 100 + 300 − 20 |
| EX-10 | turnover; yield; counts | January | 1,500.00; 1667 bps (16.67%); settled 2 (1 win, 1 loss), void 1, placed 5, open at 01-31: 2 |
| EX-11 | Equity identity, Alpha only | January | 3,930.00 = 5,000 + (−1,000) + (−500) + 300 − 50 − 100 + 300 − 20 |
| EX-12 | Equity identity, Beta only | January | 500.00 = 0 + 0 + (+500) + 0 |
| EX-13 | G; allIn; ΔBalance; ΔOpenStake; ΔEquity | February | 200.00 (B5 +600, B4 −400); 200.00; +900.00 (A 0, B +900); −700.00; +200.00 |
| EX-14 | allIn lifetime to 02-28; netCash; equity − openings | lifetime | 605.00; 975.00; 4,630.00 − 5,000.00 = −370.00 (975 − 370 = 605) |
| EX-15 | checkpoint C1: difference; state | — | −20.00; `RESOLVED` by E15 (residual 0) |
| EX-16 | Correction: B1 payout 1,800 → 1,900 via X1 (reversal of E04, 1,800) + X2 (payout 1,900) | — | signed payout 1,900.00; Alpha balance +100.00; January G 400.00; January allIn 505.00 |

Spot-check of EX-14 by hand: lifetime all-in = G (300 + 200 = 500) − Cb 50 − Cp 100 + Bn 300 + A (−20) − fees 25 = **605**. ✓ Equals netCash + Δequity − openings = 975 + 4,630 − 5,000.

EX-13 shows why period attribution matters: January's open stakes (B4 400, B5 300) leave the at-risk column in February and appear as February's realised result.

## 13. Edge cases (each needs a test)

| Case | Rule |
|---|---|
| Zero-payout settlement | No ledger entry; `SETTLED`; outcome LOSS |
| Cash-out below stake | Payout = cash-out; outcome LOSS; counts in turnover |
| Cash-out above stake | Payout = cash-out; outcome WIN |
| Settle at same instant as placement | Allowed (`settled_at ≥ placed_at`) |
| Reopen a settled bet | Payout reversed; stake returns to `openStake` as of `to` |
| Void after settlement | `resettle` to `VOID`: payout reversed, refund posted |
| Correction moves `settled_at` across a month boundary | Past months restate (DEC-013); audit shows when |
| Single-platform filter with transfers | Transfers appear in `T`, not D/W; identity INV-ACC-05 still holds |
| Archived platform | Visible in history; no new entries; archiving requires balance 0 and no open bets |
| Backdated entry before an existing checkpoint | Allowed; checkpoint's stored ledger value is unchanged; diagnostics may show new differences on re-check |
| Ledger implies negative balance | Allowed, flagged by INV-ACC-14 diagnostic |
| Fee equal to withdrawal amount | Allowed (`fee ≤ amount`) |
| Amount `0` or negative | Rejected at form, zod, and DB |
| `external_ref` reuse after reversal | Reversal copies no `external_ref`; the original's ref remains reserved |
| Empty ledger | All sums 0; ratios `null`; UI shows empty state, not zeros-as-facts (P-3) |
| Window with no settled bets | G = 0, turnover = 0, yield `null` |
