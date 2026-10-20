# Tarazu — Product Requirements

Scope, glossary, and principles: `00`. Money rules: `02`. This file defines **what the product does** and the acceptance criteria (`AC-*`) that prove it. Priorities: **P0** = MVP (milestones M0–M7), **P1** = after MVP (M8–M10); see `08`.

## 1. Users

**The Owner** — one person in India who gambles on 1–10 platforms and wants an exact, private record of what it costs. They may be tracking out of curiosity, discipline, or in an attempt to cut down. They will sometimes open the app after a bad session, so the product must be calm, factual, and impossible to misread. They use phone and laptop, enter data by hand, and tolerate no rounding or hidden estimates.

The database supports multiple accounts with strict isolation (A-2), but the product is designed around one Owner per account.

## 2. Problem and goals

Gambling platforms show balances and bet histories that make true cost hard to see: deposits, withdrawals, bonuses, fees, and open bets blur together. Tarazu's job is to answer, exactly and without flattery:

1. How much money is where, and how much is in play right now?
2. How much have I put in and taken out (cash flow), separately from what betting itself returned?
3. What did betting activity actually cost or return after every fee and bonus?
4. Am I within the limits I set for myself, and are recorded patterns drifting?

**Success measures**

| Measure | Target |
|---|---|
| Numeric correctness | 100 % of golden fixtures (`02` §12) pass in unit, DB parity, and E2E |
| Honesty | No reachable state shows an unknown value as ₹0 or implies unsaved data is saved |
| Entry speed | Record a placed bet in ≤ 6 interactions; settle it in ≤ 4 |
| Reconciliation | A checkpoint can be recorded and resolved in < 2 minutes |
| Isolation | Zero cross-user reads/writes in the two-user test suite |

## 3. Non-goals

See `00` §1.2 (anti-features and exclusions). Nothing in this PRD may be read as permitting them.

## 4. Functional requirements and acceptance criteria

Each criterion is testable and referenced by ID from test titles (`07` §6).

### FR-001 Authentication and account (P0)

Email/password sign-in via Supabase Auth; account deletion.

| ID | Criterion |
|---|---|
| AC-AUTH-01 | An unauthenticated visitor can reach only the sign-in screen; no financial route renders and no financial request is issued. |
| AC-AUTH-02 | Where sign-up is enabled (Q-001), data access requires a verified email. |
| AC-AUTH-03 | Sign-out clears the in-memory query cache; navigating back shows no financial data. |
| AC-AUTH-04 | Two accounts operating on the same deployment never see each other's data (E2E with two users; DB test INV-DB-03). |
| AC-AUTH-05 | Account deletion requires typing a confirmation phrase, offers export first, and purges every row owned by the user (`06` SEC-15). |

### FR-002 Platforms (P0)

| ID | Criterion |
|---|---|
| AC-PLAT-01 | Creating a platform takes name, kind, opening balance (≥ 0), and opening date; an `OPENING_BALANCE` entry exists iff the opening is > 0, and the platform balance equals it. |
| AC-PLAT-02 | Names are unique per user, case-insensitively; duplicates show a clear error. |
| AC-PLAT-03 | Archiving requires balance = 0 and no open bets; an archived platform keeps its history, accepts no new entries, and can be unarchived. |
| AC-PLAT-04 | Each platform shows balance, at-risk (open stake), and equity, equal to the engine and the SQL view for the same data. |

### FR-003 Ledger (P0)

Record deposits, withdrawals, transfers, fees, fee refunds, bonus credits/forfeits; correct mistakes; browse history.

| ID | Criterion |
|---|---|
| AC-LEDG-01 | A deposit of ₹2,000.00 with ₹10.00 fee raises the platform balance by 2,000.00 and bank-side cash out by 2,010.00 (EX-04/EX-05). |
| AC-LEDG-02 | A withdrawal rejects a fee greater than its amount and shows bank-side receipt = amount − fee. |
| AC-LEDG-03 | A transfer atomically creates one OUT and one IN entry sharing a group; it changes no external-flow or performance metric (EX-11, EX-12). |
| AC-LEDG-04 | Platform fees, bet commissions (bet required), fee refunds, bonus credits, and bonus forfeits can be recorded and appear in their own metric lines (EX-07). |
| AC-LEDG-05 | Money inputs accept `1,23,456.5` and `123456.50`; reject more than two decimals, zero, negatives, exponent notation, and amounts above ₹10,000,000,000 — at form, zod, and DB layers. |
| AC-LEDG-06 | "Correct" on an entry creates a reversal plus a replacement atomically; the original remains visible in a collapsed pair; totals change by exactly the difference (EX-16); both actions appear in the audit history. |
| AC-LEDG-07 | The UI offers no delete and no amount/date/type edit for ledger entries; the API rejects them; only the note is editable. |
| AC-LEDG-08 | Recording the same platform + amount within 24 h shows a duplicate warning (confirmable); a repeated `external_ref` on the same platform is rejected. |
| AC-LEDG-09 | The ledger list filters by platform, type, date range, and bet; paginates by keyset; its per-platform running balance matches `positionAt`. |
| AC-LEDG-10 | Submitting the same action twice (double-click, retry) records it exactly once (INV-DB-12). |
| AC-LEDG-11 | No form or API creates a standalone "payout", "winnings", or "profit" entry (INV-ACC-10). |

### FR-004 Bets (P0)

| ID | Criterion |
|---|---|
| AC-BET-01 | Placing a bet creates an `OPEN` bet and a stake debit dated at `placed_at`; platform balance falls and at-risk rises by the stake (EX-02). |
| AC-BET-02 | Settling with total return > 0 posts a payout dated at `settled_at`; total return 0 posts none and marks a loss; the bet's result and the period's realised result update (EX-06). |
| AC-BET-03 | The settle form can take "total return" or "profit/loss" and always displays the resulting total return before confirmation (DEC-016). |
| AC-BET-04 | Voiding returns the full stake as a refund and excludes the bet from turnover, hit rate, and win/loss counts (EX-10). |
| AC-BET-05 | Resettle, reopen, correct, and annul follow `02` §7; after each, `v_integrity_violations` is empty. |
| AC-BET-06 | The bet list filters by status, platform, date range, and session; the detail screen shows linked ledger entries and the change history. |
| AC-BET-07 | No screen, export, or code path computes or shows potential winnings, expected value, odds comparisons, or stake suggestions (INV-ACC-12; lint/grep test + UI snapshot test). |
| AC-BET-08 | A bet commission can be added only to a non-open, non-annulled bet. |
| AC-BET-09 | A bet placed inside a session is linked to it automatically; a bet outside any session is allowed and labelled "No session". |
| AC-BET-10 | A bet placed 01-30 and settled 02-01 contributes to February's realised result and not January's (EX-13). |

### FR-005 Sessions (P0)

| ID | Criterion |
|---|---|
| AC-SESS-01 | A user can start a session, and end it; at most one session is open; overlapping sessions are rejected (INV-DB-13). |
| AC-SESS-02 | A session summary shows duration, bets placed, total staked, deposits during the session, net result of its settled bets, and lists its still-open bets separately. |
| AC-SESS-03 | Editing a session's times is rejected if it would exclude a bet already linked to it. |
| AC-SESS-04 | A session open for more than 12 hours shows a neutral "Still in this session?" prompt; it never auto-ends. |

### FR-006 Reconciliation (P0)

| ID | Criterion |
|---|---|
| AC-RECON-01 | Recording a checkpoint stores server-computed ledger balance at `as_of`, shows `difference`, and sets the state `MATCHED`/`OPEN` (EX-15). |
| AC-RECON-02 | Resolving requires a note and posts `ADJUSTMENT_CREDIT/DEBIT` dated `as_of`, amount ≤ \|residual\|; residual 0 ⇒ `RESOLVED`; adjustments appear as their own line in All-in (EX-08). |
| AC-RECON-03 | Before offering an adjustment, the flow prompts the user to look for a missing or wrong entry and links to the platform's ledger around `as_of`. |
| AC-RECON-04 | Checkpoints are immutable and listed chronologically per platform. |
| AC-RECON-05 | Reported balance must be ≥ 0; `as_of` cannot be in the future. |

### FR-007 Dashboard (P0)

| ID | Criterion |
|---|---|
| AC-DASH-01 | Shows total balance, at-risk, equity (and per platform); net deposited and net cash; realised betting result, commissions, net betting result; platform fees, bonuses, adjustments, friction fees; **All-in net result with its component lines**; open bets; reconciliation status. |
| AC-DASH-02 | A period selector (Today, This week, This month, Last 30 days, Lifetime, Custom) uses the user's time zone and `[from, to)` windows; every figure comes from the same `metricsFor` call on one data snapshot. |
| AC-DASH-03 | With the golden example loaded through the RPCs, dashboard values equal `EX-01…EX-14` exactly. |
| AC-DASH-04 | External flow, betting performance, and position are in separate visual groups; no figure sums across groups except All-in with its stated components (P-6). |
| AC-DASH-05 | In any non-`READY` data mode, figures render as `—` or skeletons, never `₹0` (P-3). |
| AC-DASH-06 | A new account shows an empty state with next steps; no placeholder numbers. |
| AC-DASH-07 | Privacy mode masks every amount in the app until toggled. |

### FR-008 Analytics (P1)

| ID | Criterion |
|---|---|
| AC-ANLY-01 | Charts (`05` §5.9) cover a selectable range; every plotted value equals the corresponding `metricsFor` result (test compares series to engine). |
| AC-ANLY-02 | No chart or text projects, forecasts, or implies expected outcomes. |
| AC-ANLY-03 | Each chart has a keyboard-reachable data-table alternative. |
| AC-ANLY-04 | Charts show an explicit "not enough data" state instead of empty axes or zeros. |

### FR-009 Limits and risk signals (P1)

| ID | Criterion |
|---|---|
| AC-LIM-01 | A limit is defined by metric × period (`02` §6.5); one per pair. |
| AC-LIM-02 | Utilisation and state (`OK/WARNING/EXCEEDED`) are shown on the dashboard and immediately after logging an event; limits never prevent recording. |
| AC-LIM-03 | Tightening applies immediately; loosening or removal takes effect after 24 h and shows a visible pending state that can be cancelled (DEC-012). |
| AC-LIM-04 | Day/week/month boundaries follow the user's time zone and week-start setting. |
| AC-LIM-05 | Risk signals follow `02` §6.6, are configurable, and use factual wording with no advice. |
| AC-LIM-06 | Every limit change is in the audit history. |

### FR-010 Export (P0 JSON; P1 CSV)

| ID | Criterion |
|---|---|
| AC-EXP-01 | JSON export contains all the user's tables from one `export_snapshot()`, with `schema_version`, export time, row counts; paise are decimal strings (no precision loss). |
| AC-EXP-02 | CSV export (ledger, bets, sessions, checkpoints, platforms) gives each amount as integer paise and as a rupee decimal string; cells starting with `= + - @` are neutralised (SEC-14). |
| AC-EXP-03 | The export header's per-platform Σ platform delta equals on-screen balances. |
| AC-EXP-04 | Export contains only the signed-in user's data and is generated in the browser without third-party calls. |

### FR-011 Settings (P0 time zone/privacy; P1 idle timeout)

| ID | Criterion |
|---|---|
| AC-SET-01 | Time zone, week start, and privacy mode persist and immediately change windows/masking. |
| AC-SET-02 | An invalid IANA time zone is rejected. |
| AC-SET-03 | When an idle timeout is set, inactivity signs the user out and clears the cache. |

### FR-012 Integrity and honest states (P0)

| ID | Criterion |
|---|---|
| AC-HEALTH-01 | Missing/invalid Supabase config shows the setup screen; no financial UI renders (`CONFIG_MISSING`). |
| AC-HEALTH-02 | A `schema_version()` outside the supported range blocks the app (`SCHEMA_MISMATCH`). |
| AC-HEALTH-03 | A failed write shows an error, never "Saved", and a refetch shows the ledger unchanged. |
| AC-HEALTH-04 | Offline/degraded state marks data stale with last-updated time and disables writes. |
| AC-HEALTH-05 | Production builds contain no demo-mode code path and fail if `VITE_ENABLE_DEMO` is set. |
| AC-HEALTH-06 | The Diagnostics screen lists integrity findings (`03` §5, INV-ACC-14) and is empty on healthy data. |
| AC-HEALTH-07 | The UI never claims "synced" or "backed up"; the connection indicator appears only after a successful authenticated request. |

### FR-013 History (P0)

| ID | Criterion |
|---|---|
| AC-AUD-01 | Any platform, bet, ledger entry, session, or limit has a history view listing every change (when, what changed). |
| AC-AUD-02 | Every INSERT/UPDATE/DELETE on an audited table has exactly one audit row (INV-DB-11). |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Accessibility | WCAG 2.2 AA on all screens (`05` §7) |
| Browsers | Last two versions of Chrome, Safari (incl. iOS), Firefox, Edge |
| Responsive | Usable from 360 px width; all core flows work one-handed on a phone |
| Performance | Budgets in `04` §10 |
| Privacy/security | `06` |
| Localisation | English; en-IN number/date formatting; INR only (A-1) |
| Data durability | Backups are the hosted project's concern; the app offers export and never claims backup (`06` §7) |

## 6. Out of scope for v1 (tracked as open questions)

Import/restore (Q-005) · multi-currency (Q-002) · bonus wagering buckets (Q-003) · in-transit withdrawals (Q-004) · tax treatment (Q-013) · offline/PWA · notifications.
