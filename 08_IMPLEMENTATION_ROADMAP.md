# Tarazu — Implementation Roadmap

Milestones are ordered by dependency and risk: **money correctness first, storage and isolation second, UI third.** Each milestone starts by writing its failing tests (`07` §2) and ends only when its exit criteria are met and `scripts/check-ac-traceability` passes for its IDs. Sizes are relative (S ≈ 1–2 days, M ≈ 3–5, L ≈ 1–2 weeks of focused solo work).

**MVP = M0–M7. P1 = M8–M10.**

**Real-data gate:** no real financial data is entered until M2 and M3 are complete on the hosted project, the hosted backup/PITR situation has been checked and recorded (`06` §7), and M4 has exited. Before that, use local/demo data only.

---

## M0 — Foundations (S)

**Goal:** a repository where every later change is linted, typed, tested, and gated.

Deliverables: `git init` (default branch `main`) and GitHub repo (owner's decision on visibility; private recommended); Vite + React + TS strict; Tailwind; ESLint/Prettier with the layering and float-ban rules of `04` §3; Vitest, Testing Library, fast-check; Playwright skeleton; Supabase CLI project (`supabase init`, local stack starts); `scripts/` stubs (`check-ac-traceability`, `check-env`, `check-migrations`); GitHub Actions with the six gates of `04` §9; `.gitignore`, `.env.example`; `npm run verify`; branch protection on `main`; docs committed.

Tests first: lint-rule unit tests (forbidden `parseFloat`/`toFixed` in `domain`, boundary imports, forbidden vocabulary scan); a trivial passing test per level proving each runner works; CI fails on a seeded violation.

**Exit:** CI green on `main`; a deliberately introduced lint/float/boundary violation fails CI; `supabase start` works from a clean checkout; docs build no broken IDs (`check-ac-traceability` parses all doc IDs).

## M1 — Money and accounting engine (L) ← recommended first feature milestone

**Goal:** the entire accounting model of `02` as pure, exhaustively tested TypeScript with no UI and no database.

Deliverables: `domain/money` (Paise, parse, format en-IN, bps ratios), `domain/time` (windows, tz bucketing), `domain/accounting` (contributions, `positionAt`, `metricsFor`, `betResults`, `diagnostics`), fixtures of `07` §3, the property-test suite, the naive oracle implementation.

Tests first: money tests; table-driven delta test; all `EX-01…EX-16` assertions from `example-01.json`; the additional fixtures; property tests 1–8.

IDs: INV-ACC-01…06, 08, 09, 11, 12, 14, 15 (engine side); EX-01…EX-16; AC-LEDG-05 (parsing layer).

**Exit:** all above green; coverage gates of `07` §8; mutation score ≥ 80 % on `domain/accounting`; benchmarks meet `04` §10 at 50k entries; zero floats (lint + grep); a short README in `src/domain` describing public API. **Any discrepancy between code and `02` is resolved by fixing the wrong one and logging a `DECISIONS.md` entry.**

## M2 — Database, RLS, RPCs (L)

**Goal:** the schema of `03` with enforcement proven by pgTAP; the authoritative isolation layer.

Deliverables: migration(s) for all tables, triggers, views, RPCs, grants; `schema_version()`; seed for local dev only; `tests/parity` harness running the TS engine against the DB.

Tests first: pgTAP suites of `07` §4 (catalog scan, two-user isolation, per-CHECK negatives, immutability, RPC happy/negative/idempotent/atomic, audit, purge, parity, versioning).

IDs: INV-DB-01…16; INV-ACC-07, 08, 09, 10, 11, 13 (DB side); SEC-01, 02, 03, 05, 15, 16; AC-AUD-02; AC-LEDG-10 (DB side); AC-SESS-01 (DB side).

**Exit:** fresh `supabase db reset` + full pgTAP green in CI; parity test green on `example-01`; `v_integrity_violations` empty in all scenarios; peer review of every `SECURITY DEFINER` function against SEC-05; open items to verify against real Supabase behaviour are checked and recorded: generated columns with `CASE`, exclusion constraint extension availability, `delete from auth.users` from a definer function, cascade-purge trigger condition, `FORCE RLS` interplay with definer functions.

## M3 — App shell, auth, honest data modes (M)

**Goal:** a deployable app that signs a user in and *never* shows or claims anything it has not verified.

Deliverables: router, providers, `app/dataMode` state machine, config validation, Supabase client, sign-in/out/reset flows, `ensure_user_settings`, `DataStateBoundary`, `MoneyText`, `MoneyInput`, layout/navigation, theme tokens, `DEMO` mode (non-production only), error mapper, hosted Supabase project created and migrated, auth settings reviewed (email verification, password policy, MFA, sign-up disabled per SEC-18, rate limits), **backup/PITR availability checked and recorded**, hosting choice made (Q-006) with CSP headers designed.

Tests first: component tests for `MoneyText`/`MoneyInput`/`DataStateBoundary`; data-mode machine tests (all transitions); E2E 1, 7, 6 (offline) stubs; storage and network-origin tests (journey 10, partial).

IDs: AC-AUTH-01…04; AC-HEALTH-01, 02, 04, 05, 07; SEC-04, 06, 07, 09, 10, 11, 12, 17, 18, 20.

**Exit:** signing in on local and hosted works; unauthenticated access shows nothing; each data mode renders as `04` §6; production build has no demo code; the hosted-project checklist is recorded in `DECISIONS.md`.

## M4 — Platforms, ledger, history (L)

**Goal:** record every non-bet money movement correctly, correct mistakes safely, and see history.

Deliverables: platforms CRUD/archive; deposit, withdrawal, transfer, fee, fee refund, bonus credit/forfeit forms; ledger list with filters, keyset pagination, running balance, collapsed reversal pairs; correct/reverse flows; note edit; duplicate warnings; history drawer; quick-add sheet (non-bet items).

Tests first: E2E journey 2 (non-bet part), 3 (entries), 4; component tests for forms and duplicate warning; AC list below.

IDs: AC-PLAT-01…04; AC-LEDG-01…11; AC-AUD-01; AC-HEALTH-03 (write-failure path).

**Exit:** all IDs green; ledger totals equal engine and SQL views on `example-01` (non-bet subset); **real-data gate** may open for non-bet entries only after review.

## M5 — Bets and sessions (L)

**Goal:** full bet lifecycle and sessions with the accounting of `02` §7.

Deliverables: place/settle/void/resettle/reopen/correct/annul flows, commission; bet list/detail; sessions (start/end/summary/12 h prompt); quick-add additions.

Tests first: lifecycle E2E; AC-BET list; cross-period E2E (EX-13); integrity-empty assertions after each action.

IDs: AC-BET-01…10; AC-SESS-01…04.

**Exit:** all IDs green; `v_integrity_violations` and `diagnostics()` empty after every lifecycle path; static test shows no odds-derived calculation or potential-return string (AC-BET-07).

## M6 — Reconciliation and dashboard (L)

**Goal:** the truthful overview.

Deliverables: checkpoint and adjustment flow; dashboard of `05` §5.2 with the period selector; per-platform rows; open bets; privacy mode; time zone/week-start settings; empty state.

Tests first: E2E 2 (full) asserting `EX-01…EX-14` on screen; AC-DASH, AC-RECON, AC-SET-01/02 tests; privacy E2E (journey 8).

IDs: AC-RECON-01…05; AC-DASH-01…07; AC-SET-01, 02; SEC-13.

**Exit:** the dashboard equals the golden fixture exactly in the E2E; non-READY modes never show `₹0`; the three groups are visually separate and All-in is itemised.

## M7 — Export, diagnostics, account deletion (M) — **MVP complete**

**Goal:** the user can leave, verify, and audit.

Deliverables: `export_snapshot()` client module; JSON export; Diagnostics screen; account deletion UI; "last export" reminder in Settings; docs sync pass.

Tests first: E2E 9 (JSON part), 11; export parity test (AC-EXP-03); two-user export isolation (SEC-19).

IDs: AC-EXP-01, 03, 04; AC-HEALTH-06; AC-AUTH-05; SEC-19.

**Exit:** all MVP IDs (every P0 AC) green in CI; a manual full-day dry run with demo data reconciles; MVP tagged `v0.1.0`.

## M8 — Limits and risk signals (M)

Deliverables: limits CRUD via RPC, delayed loosening with pending/cancel, utilisation on dashboard and post-log, `limitStatus`, `riskSignals`, signal settings.

Tests first: engine tests for limit metrics and period boundaries (tz fixtures); pgTAP for `set_limit` tightening/loosening/removal timing; E2E 12.

IDs: AC-LIM-01…06; remaining parts of `02` §6.5–6.6.

**Exit:** all IDs green; thresholds for signals decided (Q-010, Q-011) and logged.

## M9 — Analytics and CSV (M)

Deliverables: charts of `05` §5.9 (lazy-loaded), table alternatives, series builders in `domain/analytics`, CSV export, idle timeout.

Tests first: series-vs-engine equality tests; a11y checks for charts; CSV injection test (SEC-14); AC-SET-03 E2E.

IDs: AC-ANLY-01…04; AC-EXP-02; AC-SET-03; SEC-14.

**Exit:** all IDs green; bundle budget met with Recharts split out.

## M10 — Hardening and release (M)

Deliverables: performance validation at 5k/50k entries; full a11y audit (axe + manual screen-reader pass); security review against `06` (threat model walk-through, SEC-08 header test on the real host, auth settings re-check SEC-17); dependency and secret audit; documentation sync; restore/export rehearsal; Q-xxx items still open reviewed; release notes; `v1.0.0` tag.

**Exit:** all P0 and P1 IDs green; budgets of `04` §10 met; zero serious/critical axe issues; documentation contradiction check (`00` §7 table) passes; every `Q-` either decided or explicitly deferred with an owner note.

---

## Dependency map

```
M0 → M1 ─┬─────────────────────────────┐
         └→ M2 → M3 → M4 → M5 → M6 → M7 (MVP) → M8 → M9 → M10
```
M1 and M2 can overlap after M0 (M2's parity test needs M1's engine, so parity lands last in M2).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Model proves wrong against a real platform's behaviour (e.g. balance semantics A-5/A-6, bonus buckets) | Q-012/Q-003 verified at M4 with one real platform before wide use; adjustments surface mismatches rather than hiding them |
| Client-side engine slow at scale | Benchmarks in M1; fallback to server-side aggregation tracked in DEC-008 revisit trigger |
| Supabase behaviour differs from spec assumptions | M2 verification list; spec corrected in the same PR |
| Scope creep toward anti-features | `06` §9 checklist on every PR |
| Solo-dev slippage | MVP is deliberately M0–M7; limits and analytics wait |
