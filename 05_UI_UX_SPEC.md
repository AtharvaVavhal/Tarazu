# Tarazu — UI/UX Specification

Implements `01` requirements. Business rules are in `02`; this file does not restate formulas — labels quote the metric names of `02` §6. The UI is calm, factual, and fast. It is the interface of an accountability tool: no persuasion, no celebration, no urgency.

## 1. Information architecture

Primary navigation (bottom bar on phones, left rail ≥ 1024 px):

| Item | Route | Priority |
|---|---|---|
| Overview (dashboard) | `/` | P0 |
| Ledger | `/ledger` | P0 |
| Bets | `/bets`, `/bets/:id` | P0 |
| Sessions | `/sessions`, `/sessions/:id` | P0 |
| Platforms | `/platforms`, `/platforms/:id` | P0 |
| Reconcile | `/reconcile` | P0 |
| Analytics | `/analytics` | P1 |
| Limits | `/limits` | P1 |
| Settings (time zone, privacy, export, diagnostics, delete account) | `/settings/*` | P0 |

A persistent **Add** button (floating on phones) opens the quick-add sheet: *Placed a bet · Settled a bet · Deposit · Withdrawal · Transfer · Fee · Bonus · Checkpoint*. There is no "Payout" action: payouts happen only by settling a bet (INV-ACC-10).

## 2. Global patterns

### 2.1 Data states (P-1, P-3, P-11)

Every data-bearing component is wrapped in `DataStateBoundary`, which renders exactly one of:

| State | Rendering |
|---|---|
| Loading | Skeleton; amounts as `—` (never `₹0`) |
| Error | "Couldn't load this. Nothing has been changed." + Retry; amounts `—` |
| Empty (loaded, no rows) | Explanatory empty state with the next sensible action; amounts as a true `₹0.00` **only** when the loaded dataset is empty and the figure is genuinely zero |
| Stale (`DEGRADED`/`OFFLINE`) | Values shown with a persistent "Last updated 21:14 — couldn't refresh" bar; write controls disabled |
| Ready | Values with "Updated hh:mm" in the footer of the page |

The app-level banner reflects the data mode of `04` §6 (`CONFIG_MISSING`, `SCHEMA_MISMATCH`, `OFFLINE`, `DEMO`). `DEMO` shows a non-dismissible high-contrast "DEMO DATA — not real" strip on every screen.

### 2.2 Write feedback

A button enters a pending state while the RPC runs; the success toast ("Saved") appears only after the RPC resolves, and the list refetches from the server. On error: inline message in plain language (mapped from `TZ001–TZ004`), the form keeps its values, nothing is shown as saved. Retrying reuses the same request id (`04` §5).

### 2.3 Privacy mode

A header toggle (and setting) replaces every amount with `₹ ••••` (assistive text: "amount hidden"). It applies to dashboard, lists, charts (values removed, shapes kept but axis labels hidden), and exports remain unmasked. State persists in `user_settings`.

### 2.4 Confirmation friction

Corrections, reopen, annul, archive, limit loosening, and account deletion show a short consequence statement ("This adds a reversal entry and a replacement. The original stays in history.") before confirming. Recording ordinary events needs no confirmation.

## 3. Money components and forms

- `MoneyText`: formats paise as `₹1,23,456.78` (en-IN), minus sign for negatives, tabular numerals, optional explicit `+` for signed deltas. Props require a `bigint | null`; `null` renders `—`.
- `MoneyInput`: text input with `inputmode="decimal"`, ₹ prefix, no spinners; accepts commas; live grouped preview beneath the field ("₹1,23,456.50"); parses by string only; blocks > 2 decimals; shows the exact paise-safe value that will be saved. Errors are specific ("Use at most 2 decimal places").
- Date/time: `datetime-local` defaulting to now in the user's zone; future times beyond 5 minutes rejected with an explanation.
- Every form shows a one-line "what this will change" summary before submit (e.g. "Alpha balance 5,000.00 → 7,000.00"), computed from the loaded engine state, labelled as a preview.
- Defaults never prefill amounts or suggest values.

## 4. Responsive behaviour

Mobile-first from 360 px. Tables collapse to stacked cards below 640 px with the primary figure right-aligned. Quick-add is a bottom sheet on phones and a modal on desktop. Touch targets ≥ 44 px. No horizontal page scroll; wide tables scroll within their container with a visible affordance.

## 5. Screens

### 5.1 Sign in / account
Email + password, "Forgot password", sign-up only if enabled (Q-001). Failure messages are generic ("Email or password is incorrect"). Neutral first-run copy. Nothing financial is requested or rendered before authentication (AC-AUTH-01).

### 5.2 Overview (dashboard) — FR-007
Top: period selector (Today · This week · This month · Last 30 days · Lifetime · Custom) and the reconciliation badge.
Three clearly separated groups, in this order, each with a one-line definition link to its `02` section:

1. **Position (now):** Total balance · At risk (open stake) · Equity; per-platform rows with balance / at risk. Subtext: "At risk is shown at cost."
2. **Money in and out (selected period):** Deposited · Withdrawn · Net deposited · Net cash (bank-side) · friction fees.
3. **Betting performance (selected period):** Realised betting result · Commissions · Net betting result · Turnover · Settled / won / lost / void counts. Then **Other**: platform fees · bonuses · adjustments.

Below the groups: **All-in net result** with its components itemised on the same card (`G − Cb − Cp + Bn + A − friction`), never shown without them. Then: Open bets (list), Limits status (P1), Recent ledger entries (5), Risk signals (P1).
There is no "profit" headline and no single traffic-light for the account.

### 5.3 Ledger — FR-003
Chronological table (newest first): date, platform, type, description (bet name where linked), amount, platform Δ, running platform balance (when filtered to one platform). Filters: platform, type, date range, bet, "include reversed pairs". Reversed pairs appear as one collapsed row ("Corrected — view") by default. Row detail: all fields, linked bet/transfer/checkpoint, **History** (audit). Actions: *Edit note*, *Correct*, *Reverse* — never "Delete".

### 5.4 Entry forms
Common fields: platform, amount (`MoneyInput`), date/time, optional note. Specifics:
- **Deposit / Withdrawal:** + "Fee charged outside the platform balance" (separate field, with helper "If the platform deducted it from your balance, record it as a Fee instead.") + optional reference id.
- **Transfer:** from, to (different), amount.
- **Fee:** kind (Platform fee / Bet commission), bet picker for commission.
- **Bonus:** Credit / Forfeit.
- **Checkpoint:** see 5.8.
Duplicate warning (AC-LEDG-08) appears inline and requires a confirm.

### 5.5 Bets — FR-004
List: status chips (Open · Settled · Void), platform, description, stake, result, placed/settled dates; filters per AC-BET-06. Open bets are grouped first.
**Place bet:** platform, description, optional category/odds (labelled "recorded for reference only"), stake, placed time. After saving: the session link (if any) is stated, then limit status is shown if relevant (never blocking).
**Settle:** two modes — *Total return* (default) and *Profit/loss* — with the derived total return and resulting net shown before confirm. Zero total return = "Lost". Separate **Void** action ("Platform cancelled the bet and returned the stake").
**Detail:** facts, linked ledger entries, history, actions: Resettle, Reopen, Correct, Add commission, Annul (each with §2.4 confirmation).
Nothing on this screen computes potential returns.

### 5.6 Sessions — FR-005
Start/End controls; the current session shows elapsed time. History list with duration, bets, staked, net result. A session open > 12 h shows a neutral check-in (AC-SESS-04).

### 5.7 Platforms — FR-002
List with balance, at risk, equity, last checkpoint state. Create/rename/archive. Detail page: ledger for the platform, checkpoints, open bets.

### 5.8 Reconcile — FR-006
Per platform: enter "Balance shown by the platform right now" (default `as_of` = now). The screen then shows ledger balance, difference, and state. If a difference exists the flow is: (1) "Check for a missing or wrong entry" — link to the ledger window around `as_of`; (2) "I can't find it" → adjustment dialog with required note. History of checkpoints below. Copy is neutral ("Your records are ₹20.00 higher than the platform shows").

### 5.9 Analytics — FR-008 (P1)
Range selector shared with the dashboard. Each chart has a "View as table" toggle (AC-ANLY-03).

| Chart | Type | Source (`02`) |
|---|---|---|
| Cumulative All-in net result (daily) | line | §6.9 |
| Net betting result by month | bars | §6.3 |
| Deposited vs withdrawn by month | grouped bars | §6.1 |
| Turnover and bets placed by week | bars | §6.3 |
| Stake size: median per week | line | §6.6 |
| By platform (table, not pie) | table with sparkline | §6.3 |
| Sessions: count and duration by week | bars | `sessions` |
| Bets by hour of day (local) | bar / heat strip | `bets.placed_at` |
| Days since last bet | single figure | `bets.placed_at` |

No forecast lines, no "expected", no projections, no best/worst-platform rankings framed as advice.

### 5.10 Limits and signals — FR-009 (P1)
List of limits with utilisation bar (value + text + icon, not colour only), state, pending changes with "Cancel change". Create/edit form states the 24 h rule when loosening. Risk signals appear as neutral factual statements with the data window shown. Copy for exceeded limits is plain: "You've passed the daily stake limit you set (₹5,000.00 of ₹4,000.00)."

### 5.11 Settings
Time zone, week start, privacy mode, idle timeout (P1), Export (JSON/CSV), Diagnostics, Delete account (confirmation phrase; export offered first), Sign out. Support resources link (content pending Q-009).

### 5.12 Diagnostics
Lists `diagnostics()` and `v_integrity_violations` findings with the offending entity and a link to it. Empty state: "No problems found in the data currently loaded." Includes data mode, schema version, last successful read.

### 5.13 History (audit)
A drawer available from any platform, bet, entry, session, or limit: chronological list of changes ("Created", "Note changed", "Reversed by …"), with before/after for changed fields. Read-only.

## 6. Export (FR-010)

JSON: one file `tarazu-export-YYYYMMDD-HHmm.json` with `{ meta: {schema_version, exported_at, counts}, tables: { … } }`; paise as decimal strings.
CSV files (zip is optional; separate downloads are acceptable): `ledger.csv` (`id, occurred_at, recorded_at, platform, entry_type, amount_paise, amount_inr, fee_paise, fee_inr, platform_delta_paise, bank_delta_paise, is_reversal, reverses_entry_id, bet_id, fee_kind, transfer_group_id, checkpoint_id, external_ref, note`), `bets.csv` (+ derived stake/payout/refund/commission/result/outcome in paise and INR), `sessions.csv`, `checkpoints.csv`, `platforms.csv`. UTF-8, RFC 4180 quoting, timestamps ISO-8601 UTC, header row always present, CSV-injection neutralisation (SEC-14).

## 7. Accessibility (WCAG 2.2 AA)

- Colour is never the only signal: amounts carry explicit signs; states pair icon + text + colour.
- Contrast ≥ 4.5:1 text, ≥ 3:1 UI components and chart marks, in both themes.
- Full keyboard operation; visible focus; logical order; skip link; modals trap and restore focus; bottom sheet is dismissible by Esc.
- Forms: programmatic labels, `aria-describedby` for hints/errors, error summary on submit, no placeholder-only labels.
- Charts: text alternative (summary + data table), no information in hover only.
- Respect `prefers-reduced-motion`; no auto-playing animation; no celebratory effects.
- Targets ≥ 44 px; no content lost at 200 % zoom / 320 px reflow.
- axe checks run in E2E on every P0 screen (`07` §5).

## 8. Visual design tokens

Neutral, low-stimulation palette; light and dark themes via CSS variables consumed by Tailwind.

| Token | Use |
|---|---|
| `surface`, `surface-raised`, `border` | backgrounds, cards |
| `text`, `text-muted` | content |
| `accent` | neutral blue for actions and focus (not green/gold) |
| `negative`, `positive` | sign emphasis, **muted** (never saturated red/green), always with sign/icon |
| `warning`, `exceeded` | limit states, with icon + label |
| `demo` | high-contrast banner colour, used for nothing else |

Type: one sans family (self-hosted, SEC-11), tabular numerals for all amounts. No imagery, mascots, or casino-style motifs. Charts use a colour-blind-safe categorical palette plus differing line styles/markers.

## 9. Copy and tone; anti-feature review

- Plain, factual, second person. Losses are stated as numbers without euphemism or alarm; wins are stated without celebration.
- Forbidden vocabulary in UI strings: lucky, hot streak, win big, jackpot, recover, win back, chase (as advice), boost, "you're due", "just one more", congratulations/confetti-style wording for results. A lint test scans `src/**` strings for the forbidden list.
- Never use "sync/synced/cloud sync/backed up" (AC-HEALTH-07).
- No promotional slots, referral prompts, streak badges, or push/email nudges to log or place bets.
- Every new screen or string change that touches results, limits, or notifications passes the checklist in `06` §9 before merge.
- "Days since last bet" and similar are descriptive only; no rewards attached.
