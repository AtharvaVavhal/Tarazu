# Tarazu — Master Specification

| | |
|---|---|
| Status | Draft v0.1 — documentation baseline, no application code exists yet |
| Date | 2026-10-20 |
| Authority | This file is the root of the documentation system. On conflict, see §2 (precedence). |

## 1. What Tarazu is

Tarazu is a personal **recordkeeping and financial-accountability** web app for gambling activity. The user manually records what happened (bets, deposits, withdrawals, payouts, fees, refunds, bonuses, balances). Tarazu turns those records into exact, auditable numbers: where the money is, how much crossed the bank boundary, and what betting actually cost or returned.

It exists to make the true financial picture hard to ignore. It does not help anyone gamble.

### 1.1 Scope (in)

Platforms and balances · transaction ledger with audit trail · individual bets (open and settled) · sessions · reconciliation against platform-reported balances · financial dashboard · analytics · configurable risk limits and risk signals · data export · per-user isolated storage (Supabase Auth + PostgreSQL + RLS).

### 1.2 Non-goals and anti-features (hard rules)

Tarazu must **never** implement, display, or hint at: betting advice, tips, predictions, odds comparison, expected-value or stake-sizing calculations (Kelly, martingale, "optimal" anything), loss-recovery targets ("win back ₹X"), projected or "potential" winnings, bonus/promotion discovery, affiliate links, leaderboards, betting streaks or achievements, or notifications that prompt the user to bet or to log more bets.

Also out of scope for v1: connecting to platforms or banks (no scraping, APIs, or statement import), multi-currency, native mobile apps, offline writes, tax computation, social/sharing features, AI features.

Any proposed feature touching the anti-feature list is rejected without further analysis. See `06_SECURITY_AND_PRIVACY.md` §9 for the review checklist.

## 2. Document system

| File | Owns | Does not own |
|---|---|---|
| `00_MASTER_SPEC.md` | Glossary, assumptions, principles, scope, precedence, ID conventions, cross-document contract (§7) | Formulas, DDL, UI detail |
| `01_PRD.md` | Users, functional requirements `FR-*`, acceptance criteria `AC-*` | Formula definitions |
| `02_ACCOUNTING_SPEC.md` | Entry types, formulas, lifecycle rules, invariants `INV-ACC-*`, worked example `EX-*` | Storage |
| `03_DATABASE_SCHEMA.md` | Tables, constraints, RLS, RPCs, DB invariants `INV-DB-*` | Product behaviour |
| `04_TECHNICAL_ARCHITECTURE.md` | Stack, layering, repo layout, data flow, runtime states, CI | Formula definitions |
| `05_UI_UX_SPEC.md` | Screens, flows, copy rules, accessibility | Business rules |
| `06_SECURITY_AND_PRIVACY.md` | Threat model, requirements `SEC-*`, privacy, retention | Schema detail |
| `07_TESTING_STRATEGY.md` | Test levels, fixtures, traceability, quality gates | — |
| `08_IMPLEMENTATION_ROADMAP.md` | Milestones `M*`, exit criteria | — |
| `DECISIONS.md` | Decision log `DEC-*` and open questions `Q-*` | — |

**Precedence on conflict:** definitions → this file's glossary; formulas and money behaviour → `02`; storage shape and DB enforcement → `03`; everything else → the owning file above. A conflict is a documentation bug: fix the non-authoritative file in the same change, never work around it in code.

**Single-definition rule:** each fact lives in exactly one file; other files link by ID (e.g. "see INV-ACC-07"). Do not restate formulas outside `02`.

**ID conventions:** `FR-nnn` requirement · `AC-<AREA>-nn` acceptance criterion · `INV-ACC-nn` / `INV-DB-nn` invariant · `EX-nn` worked-example row · `SEC-nn` security requirement · `DEC-nnn` decision · `Q-nnn` open question · `M<n>` milestone. IDs are never reused. Tests reference IDs in their titles (`07` §6).

## 3. Glossary

Terms are capitalised where used precisely. Money is always INR in integer **paise** (1 ₹ = 100 paise).

| Term | Definition |
|---|---|
| **Platform** | An external place that holds the user's gambling funds (bookmaker, exchange, casino, poker room, wallet). Each has its own balance. |
| **Ledger** | The append-only table of **Ledger Entries**; the only source of truth for money. |
| **Ledger Entry** | One immutable money movement on one platform: a type, a positive `amount`, a date, and optional links. |
| **Entry Type** | One of `OPENING_BALANCE, DEPOSIT, WITHDRAWAL, TRANSFER_OUT, TRANSFER_IN, BET_STAKE, BET_PAYOUT, BET_REFUND, FEE, FEE_REFUND, BONUS_CREDIT, BONUS_FORFEIT, ADJUSTMENT_CREDIT, ADJUSTMENT_DEBIT` (full table in `02` §3). |
| **Reversal** | A ledger entry that cancels a specific earlier entry by contributing the negative of it. The only way to correct the ledger. |
| **Live entry** | An entry that is neither reversed nor itself a reversal; equivalently, the signed sum of an original+reversal pair is zero. |
| **Platform balance** | Σ `platform_delta` of a platform's entries up to a time. Mirrors what the platform shows (assumption A-5, A-6). |
| **Bet** | A descriptive record of one wager with a lifecycle (`OPEN`, `SETTLED`, `VOID`, `ANNULLED`). Holds **no money fields**; its amounts are derived from linked ledger entries. |
| **Stake** | Money committed to a bet; a `BET_STAKE` debit at placement time. |
| **Payout (total return)** | Everything the platform credits back for a settled bet, **including** returned stake (`BET_PAYOUT`). A lost bet has payout 0 and no payout entry. Profit-only platform displays are converted at input (DEC-016). |
| **Refund** | `BET_REFUND`: full stake returned for a `VOID` bet. Distinct from `FEE_REFUND` (platform returns a fee). |
| **Void** | The platform cancelled the bet and returned the stake in full. Not a win, loss, or part of turnover. |
| **Annulled** | The user recorded a bet in error; all its entries are reversed. Excluded from every metric and hidden by default. |
| **Open stake / At risk** | Σ stakes (at cost) of bets that are `OPEN` as of a time. Never valued at potential winnings. |
| **Equity** | Platform balance + open stake. Money the user has placed with platforms, whether idle or in play. |
| **External cash flow** | Money crossing the user's bank boundary: deposits and withdrawals (and their friction fees). Not performance. |
| **Friction fee** | `fee_paise` on a deposit/withdrawal charged outside the platform balance (bank/UPI/gateway). Cost, not betting performance. |
| **Realized betting result (G)** | Σ over bets settled in the period of (payout + refund − stake). Attributed to **settlement date**. |
| **All-in net result** | Realized betting result − commissions − platform fees + bonuses + adjustments − friction fees. Excludes transfers, openings, and deposits/withdrawals as such. |
| **Reconciliation checkpoint** | An immutable record of "the platform said ₹X at time T" compared with the ledger at T. |
| **Adjustment** | `ADJUSTMENT_CREDIT/DEBIT` entry resolving a checkpoint difference; always linked to a checkpoint. |
| **Session** | A user-started time window of gambling activity (`started_at`, optional `ended_at`). Bets may reference one. |
| **Limit** | A user-configured threshold (metric × period) producing advisory warnings. Cannot block recording. |
| **Risk signal** | A derived, descriptive indicator (e.g. deposit shortly after a loss). Descriptive only; never prescriptive. |
| **Occurred at / Recorded at** | When it happened in the world (user-entered) / when Tarazu stored it (server clock). |
| **Data mode** | Runtime state of backend connectivity (`04` §6). Financial figures render only in `READY` (or clearly bannered `DEMO` in non-production). |
| **Unknown vs zero** | "Unknown" (not loaded, errored) is displayed as `—`, never as ₹0 (P-3). |

## 4. Assumptions

Recorded explicitly; changing one requires a `DECISIONS.md` entry.

| ID | Assumption |
|---|---|
| A-1 | Single currency, INR. Amounts are stored as integer paise. (Q-002 for multi-currency.) |
| A-2 | The user is a single adult individual recording their own activity; the app is multi-user-capable at the database level but each account sees only its own data. Public signup policy is open (Q-001). |
| A-3 | All data is entered manually. Tarazu never contacts platforms or banks. |
| A-4 | Default time zone is `Asia/Kolkata`; configurable per user. Weeks start Monday; configurable. |
| A-5 | A platform's displayed balance **excludes** stake locked in open bets. Verified per platform in M4 (Q-012). |
| A-6 | A platform's displayed balance **includes** bonus funds (no separate restricted bucket modelled; DEC-017, Q-003). |
| A-7 | Scale target: ≤ 50,000 ledger entries and ≤ 20 platforms per user lifetime. |
| A-8 | Evergreen desktop and mobile browsers; English UI; en-IN number formatting (lakh/crore grouping). |
| A-9 | One developer; static SPA deployment; Supabase hosted project (region nearest to India where available). |
| A-10 | Tarazu gives no legal, tax, or medical advice. Regulatory and tax context is deliberately out of the product model (Q-013). |

## 5. Principles

| ID | Principle | Consequence |
|---|---|---|
| P-1 | **Honest numbers.** No fabricated, estimated, or placeholder financial values. | No seed data in production; demo mode is bannered and non-production only (DEC-009). |
| P-2 | **Exact arithmetic.** Integer paise end to end; no floats in money paths. | `bigint` in TS and PostgreSQL; ratios computed in integer basis points (`02` §2). |
| P-3 | **Unknown ≠ zero.** | Loading/error states render `—` and an explanation. |
| P-4 | **One source of money truth.** Only ledger entries move balances. | Bets hold no money columns (DEC-004). |
| P-5 | **Append-only history.** Corrections add entries; nothing is overwritten. | Reversal mechanism (DEC-003); audit log. |
| P-6 | **Cash flow ≠ performance.** | Separate metric families (`02` §6); never summed into one "profit" figure. |
| P-7 | **No double counting.** One real-world event ⇒ one ledger event. | A payout exists only via bet settlement; `external_ref` dedupe; INV-ACC-10. |
| P-8 | **Isolation by construction.** Per-user rows, RLS forced, `user_id` never client-supplied. | `03` §6, `06`. |
| P-9 | **Tests before dependent features.** Acceptance criteria and failing tests exist before the code they gate. | `07` §7, `08` gates. |
| P-10 | **Accountability, not encouragement.** Neutral tone, friction on risky changes, no engagement mechanics. | §1.2, `05` §9. |
| P-11 | **Honest connectivity.** Never imply data is saved or synced until the write is confirmed by the backend. | No optimistic ledger writes; no "sync" wording (DEC-009). |

## 6. System summary

```
Browser (React SPA)
 ├─ domain/  pure TS: money, accounting engine, limits, analytics   ← all formulas (02)
 ├─ data/    Supabase client, zod-validated rows, RPC wrappers
 └─ features/ + ui/
        │  HTTPS, user JWT only (anon key public, RLS is the guard)
        ▼
Supabase Auth ── PostgreSQL (RLS forced)
                  ├─ ledger_entries (append-only, generated deltas)
                  ├─ bets, sessions, platforms, limits, checkpoints, user_settings
                  ├─ audit_log (trigger-written, append-only)
                  └─ RPCs (SECURITY DEFINER, scoped by auth.uid()) = only write path for money
```

## 7. Cross-document contract (what must stay in agreement)

| Contract item | Authority | Must match |
|---|---|---|
| Entry type list, signs, bucket mapping | `02` §3 | `03` `ledger_entries` CHECK + generated columns; domain `EntryType` union; `05` form list |
| Metric names and formulas | `02` §6 | domain engine function names; `05` labels (tooltips quote `02` names) |
| Amount bounds (`1 ≤ amount ≤ 10¹²` paise) | `02` §2 | `03` CHECK; zod schemas; form validation |
| Bet statuses | `02` §7 | `03` `bets.status` CHECK; UI badges |
| Fee kinds | `02` §3 | `03` `fee_kind` CHECK; fee form |
| Limit metrics and periods | `02` §6.5 | `03` `limits` CHECKs; limits UI |
| Data-mode states | `04` §6 | `05` banners; `07` E2E cases |
| Test ID traceability | this file §2 | `07` §6 script |

## 8. Reading order for implementers

`00` → `02` (the heart) → `03` → `04` → `01` (what to build) → `05` → `06` → `07` → `08`. Start work at the first incomplete milestone in `08`; do not skip its test-first step.
