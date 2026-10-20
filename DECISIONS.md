# Tarazu — Decision Log

Two sections: **Decided** (`DEC-nnn`) and **Open questions** (`Q-nnn`). IDs are never reused. A decision is changed by adding a new entry that supersedes the old one (mark the old one *Superseded by DEC-xxx*). Documents reference these IDs; keep this file the single place where rationale lives.

Format: **Decision** · **Why** · **Revisit when**.

## Decided

| ID | Date | Decision | Why | Revisit when |
|---|---|---|---|---|
| DEC-001 | 2026-10-20 | Documentation system of ten files with `00_MASTER_SPEC.md` as root; precedence and single-definition rule in `00` §2. | Prevent contradictory specs; each fact has one home. | A file becomes too large to review or a recurring contradiction appears. |
| DEC-002 | 2026-10-20 | Money is `bigint` integer **paise**, INR only, bounded to `1…10¹²` per entry. | Exact arithmetic (P-2); single currency matches the owner's use (A-1); bound keeps single values within JS safe integers at the PostgREST boundary while sums use `bigint`. | Multi-currency is needed (Q-002). |
| DEC-003 | 2026-10-20 | The ledger is append-only; corrections are **reversal entries** that mirror the original with `sgn = −1`; only `note` is editable. | Audit trail and reproducibility (P-5); makes totals order-independent and sums trivially correct. | Reversal pairs prove too confusing in the UI (consider a "correction" view model, not mutation). |
| DEC-004 | 2026-10-20 | `bets` holds **no money columns**; stake/payout/refund/commission are derived from linked ledger entries. | One source of money truth (P-4); eliminates bet-vs-ledger drift and double counting. | Bet list queries become too slow (use a materialised view, never duplicate writes). |
| DEC-005 | 2026-10-20 | Realised betting performance is attributed to **settlement date**; open bets are valued at **cost** and excluded from performance; equity = balance + open stake. | Matches what has actually resolved; avoids counting unresolved stakes as losses or projecting wins; yields the exact equity identity (INV-ACC-05). | Users need placement-date attribution views (add as an alternative metric, do not change this one). |
| DEC-006 | 2026-10-20 | External cash flow (deposits/withdrawals) is a separate metric family; fees charged outside the platform live in `fee_paise` on the deposit/withdrawal (bank-side only), fees deducted from balance are `FEE` entries. | P-6 and the "recorded once" rule prevent double-counting fees; supports a bank-side `netCash`. | Banks/gateways routinely charge inside the platform balance in a way that blurs the two. |
| DEC-007 | 2026-10-20 | Bonuses and reconciliation adjustments are reported as separate lines; All-in net result = G − Cb − Cp + Bn + A − friction, always displayed with its components. | Prevents bonuses or "plugs" from silently flattering betting performance. | — |
| DEC-008 | 2026-10-20 | Formulas are implemented **once**, in a pure TypeScript domain engine run client-side over the loaded ledger; SQL views provide integrity cross-checks and a parity test. | Fully unit/property-testable; avoids a second formula implementation; data volume is small (A-7). | Benchmarks miss `04` §10 budgets or multi-device sizes grow; move aggregation server-side behind the same API. |
| DEC-009 | 2026-10-20 | Supabase is required. **No local-only mode, no offline write queue, no optimistic ledger writes, no "sync" wording.** Demo data exists only in non-production builds behind a permanent banner. | P-1, P-3, P-11: the app must never imply data is saved or synced before that is confirmed and tested. | Offline entry becomes a real need (Q-016); design it as an explicit queue with visible unsynced state. |
| DEC-010 | 2026-10-20 | All money-affecting writes go through `SECURITY DEFINER` RPCs that derive `user_id` from `auth.uid()`; clients have `SELECT` only on those tables; composite FKs `(id, user_id)` prevent cross-user references; RLS enabled **and forced**. | Defence in depth for isolation (P-8) and atomic multi-row writes. | — |
| DEC-011 | 2026-10-20 | Timestamps are UTC `timestamptz`; windows `[from, to)` and bucketing use the user's IANA time zone (default `Asia/Kolkata`). | Correct period attribution; DST-safe for other zones. | — |
| DEC-012 | 2026-10-20 | Limits and risk signals are **advisory**: they warn and never block recording. Loosening or removing a limit takes effect after **24 h** (tightening is immediate). | The app cannot stop external activity and must keep records honest; delay adds friction against impulsive loosening. Delay length is provisional (Q-010). | Q-010 resolved. |
| DEC-013 | 2026-10-20 | A reversal inherits the original's `occurred_at`; corrected history restates past periods; `recorded_at` and the audit log preserve when the correction happened. | Corrections should read as "it was always this" in reports while remaining traceable. | An "as known at" reporting view is requested (filter by `recorded_at`). |
| DEC-014 | 2026-10-20 | Enumerations are `text` + `CHECK`, not PostgreSQL enum types. | Safe in generated columns, simpler to evolve. | — |
| DEC-015 | 2026-10-20 | Stack: React + TS (strict) + Vite, Tailwind, React Router, TanStack Query, react-hook-form + zod, Recharts, Luxon (time-zone math only, confined to `domain/time`), Vitest + Testing Library + fast-check, Playwright + axe, pgTAP, ESLint/Prettier, npm, GitHub Actions. | Matches the requested stack; additions are small and each serves a stated need. | A tool blocks a requirement. |
| DEC-016 | 2026-10-20 | A bet's **payout is total return** (stake included). The settle form can accept profit/loss and converts, always showing total return before confirm. | Matches what the platform credits to the balance, so reconciliation works; platforms display it inconsistently. | — |
| DEC-017 | 2026-10-20 | Bonuses are ordinary balance credits (`BONUS_CREDIT/FORFEIT`); no restricted-funds or wagering-requirement bucket in v1. | Keeps the ledger reconcilable to the displayed balance (A-6); the wagering model is large and platform-specific. | Q-003. |
| DEC-018 | 2026-10-20 | A real-world money charge is recorded once; every money-writing RPC takes an idempotency `request_id`; repeated `external_ref` per platform is rejected. | Prevents double-counting from retries and duplicate entry (P-7). | — |
| DEC-019 | 2026-10-20 | Bets may exist outside sessions ("No session"); a bet is linked to the user's session covering `placed_at` at placement. | Honest records matter more than forcing session discipline (Q-014 revisits). | Q-014. |
| DEC-020 | 2026-10-20 | Tarazu implements no betting advice, odds/EV/stake tools, projections, promotions, engagement mechanics, or prompting notifications; reviewed by the `06` §9 checklist. | Product purpose is accountability. | — |

## Open questions

Each lists the **working assumption** used until resolved and the **milestone by which it must be decided**.

| ID | Question | Working assumption | Decide by |
|---|---|---|---|
| Q-001 | Single-owner only, invite-only, or public sign-up? | Production sign-up disabled; owner creates accounts (SEC-18). | M3 |
| Q-002 | Multi-currency (e.g. platforms holding USD or stablecoins)? | INR only; out of scope for v1. | After MVP |
| Q-003 | Model bonus wagering requirements / restricted-withdrawal funds? | Not modelled; bonus is a plain credit (DEC-017). | After MVP |
| Q-004 | Track withdrawals "requested but not yet received" and pending/failed deposits? | Record a withdrawal when the platform balance is debited; failed ones are reversed. | M4 |
| Q-005 | Import/restore from the JSON export, and bank-statement/CSV import? | Neither in v1; JSON export exists as the safety net. | M10 |
| Q-006 | Where to host the static build (e.g. Vercel, Netlify, Cloudflare Pages) and on what domain? CSP/headers are applied there. | Any static host able to set response headers. | M3 |
| Q-007 | Tamper-evidence against the owner (hash-chained audit log, externally anchored)? | Out of scope; append-only + audit only (T9). | After MVP |
| Q-008 | Crypto/P2P/exchange-style balances and fees? | Treated as ordinary platforms in INR terms. | After MVP |
| Q-009 | Support-resource content (helplines, self-exclusion info) to show in Settings; wording and region. | Link area exists but is empty until sources are verified from official pages. | M7 |
| Q-010 | Limit-loosening delay length and whether removal is also delayed. | 24 h for both (DEC-012). | M8 |
| Q-011 | Default thresholds for risk signals (stake escalation ratio, late-night window/share, redeposit minutes, deposits per 24 h). | Values listed in `02` §6.6, configurable. | M8 |
| Q-012 | Do real platforms' displayed balances exclude open-bet stakes and include bonus funds (A-5, A-6)? Varies by platform. | A-5/A-6 hold; verified with one real platform before wide use. | M4 |
| Q-013 | Tax and regulatory treatment: how to record tax deducted at source on winnings; legal status of platforms. | Taxes recorded as `PLATFORM_FEE` with a note; no tax reporting; no legal claims (A-10). | M10 |
| Q-014 | Should bets require a session? | No (DEC-019). | M5 |
| Q-015 | Opt-in, value-free error/performance telemetry? | None in v1 (SEC-11). | M10 |
| Q-016 | Offline entry / PWA? | Not in v1 (DEC-009). | After MVP |
| Q-017 | Make TOTP MFA mandatory? | Enabled and offered, not mandatory. | M3 |
| Q-018 | Default idle sign-out timeout. | Off by default; selectable 1–240 min. | M9 |
| Q-019 | Final product framing for the name/branding and any "about" copy. | Neutral "Tarazu — gambling activity ledger". | M10 |

## Verification items carried into M2 (not decisions, but spec assumptions to confirm against real Supabase)

Generated columns with `CASE` on `text` · `btree_gist` exclusion constraint availability · `delete from auth.users` from a `SECURITY DEFINER` function · cascade-purge trigger condition `not exists (select 1 from auth.users …)` · `FORCE ROW LEVEL SECURITY` with definer functions · `security_invoker` views · behaviour of PostgREST for `bigint` columns. Outcomes are recorded here as `DEC-` entries or spec corrections.
