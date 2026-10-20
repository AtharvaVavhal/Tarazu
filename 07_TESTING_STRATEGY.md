# Tarazu — Testing Strategy

Goal: make it impossible for a money-affecting change to merge without a test that would have caught its failure. Principle P-9: acceptance criteria and failing tests exist **before** the code they gate.

## 1. Levels

| Level | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | Vitest | `domain/**` (money, time, accounting, limits, analytics), mappers, error mapper | every PR |
| Property | fast-check (inside Vitest) | accounting invariants over random valid ledgers | every PR |
| Component | Testing Library | `ui/**`, forms, `DataStateBoundary`, `MoneyInput/Text` | every PR |
| Database | Supabase CLI local stack + pgTAP | schema, constraints, triggers, RLS, RPCs, parity | every PR (`db` job) |
| E2E | Playwright | critical user journeys against the local stack | every PR |
| Accessibility | axe-core in Playwright | all P0 screens, both themes | every PR |
| Static | ESLint rules, `tsc`, grep tests | layering, float bans, forbidden vocabulary, anti-feature scan | every PR |
| Security | gitleaks, `npm audit`, header test, bundle grep | `06` | every PR / weekly |
| Mutation (optional) | Stryker on `domain/accounting` | strength of accounting tests | per milestone M1, M6 |

## 2. Test-first rule

For each milestone (`08`), the first commit set contains: the acceptance criteria already in `01`, test files implementing them as failing (or `test.todo` referencing the ID), and fixtures. Implementation follows. A feature PR must list the AC/INV/SEC IDs it satisfies and cannot merge while any referenced test is skipped or todo.

## 3. Fixtures and golden tests (accounting)

- `tests/fixtures/accounting/example-01.json` encodes **exactly** the ledger, bets, and checkpoint of `02` §12.1–12.2 (paise integers) plus the expected values of every `EX-nn` row of §12.3. This file is the single machine-readable copy; `02` remains the human authority. A test asserts the fixture's entries and expected values match the markdown tables (parsed in a script) so the two cannot drift.
- Unit tests assert `metricsFor`/`positionAt`/`betResults`/`limitStatus` against every `EX-nn` row (titles `EX-08: allInNetResult January`).
- Additional fixtures (one file each), each with hand-derived expected values documented in the file header: `reversal-chain`, `transfers-single-platform-filter`, `cross-period-bets`, `empty-ledger`, `negative-balance-diagnostic`, `cash-out-above-and-below-stake`, `void-after-settle`, `bonus-forfeit-fee-refund`, `tz-boundary` (entries at 23:59:59.999 and 00:00:00.000 IST; also a non-India zone with DST), `max-amounts` (10¹² paise and sums beyond 2⁵³ to prove `bigint` aggregation).
- **Table-driven delta test:** a table of the 14 entry types × `is_reversal` with expected `platform_delta` and `bank_delta` (including fee cases) is consumed by both the Vitest contribution test and the pgTAP generated-column test (INV-DB-05) — one table, two implementations, must agree.
- **Money tests:** parse/format round-trips; rejects `"1.234"`, `"1e3"`, `"-5"`, `"0"`, `"1,,2"`, `""`, `"₹"`; accepts `"1,23,456.5"`; `0.07 + 0.01`-style float traps are covered by asserting results as `bigint`; ratio rounding half-away-from-zero for positive and negative numerators; zero denominator ⇒ `null`.

### 3.1 Property tests (INV-ACC-03/04/05/06 …)

Generator builds a valid ledger (random platforms, openings, deposits, withdrawals, transfers, bets through the lifecycle, fees, bonuses, adjustments, random reversals/corrections) and a random window and filter. Properties:

1. **Permutation invariance** (INV-ACC-04): shuffling entries leaves all metrics identical.
2. **Equity identity** (INV-ACC-05) holds for any window/filter.
3. **All-in identity** (INV-ACC-06) holds.
4. **Reversal neutrality** (INV-ACC-03): appending original + reversal changes no metric.
5. **Transfer neutrality:** adding a balanced transfer pair changes no D, W, G, or all-in, and total balance is unchanged.
6. **Partition additivity:** for adjacent windows, additive metrics (D, W, fees, G, Cb, Cp, Bn, A, turnover) over `[a,c)` equal the sum over `[a,b)` and `[b,c)`.
7. **No float:** no result is a non-integer `bigint` conversion error; all outputs are `bigint | null`.
8. **Oracle:** a deliberately naive reference implementation (straight loops following `02` text) agrees with the optimised engine on all outputs.

Seeds are logged on failure; shrunk counterexamples are added as permanent fixtures.

## 4. Database tests (pgTAP)

Run on a freshly migrated local database; each scenario ends by asserting `v_integrity_violations` is empty (INV-DB-16) unless it is a deliberate-corruption test.

| Area | Tests |
|---|---|
| Catalog scan | RLS enabled+forced on all `public` tables (INV-DB-01); no grants to `anon`/`public` on tables or functions (INV-DB-15); every definer function has `search_path` pinned (SEC-05); every table appears in the scan list |
| Isolation (two users) | For each table: user B selects ⇒ 0 rows of A; user B insert/update/delete with A's ids ⇒ fails; each RPC called by B with A's ids ⇒ `TZ002`; composite-FK cross-reference ⇒ fails (INV-DB-02/03) |
| Constraints | One failing insert per ledger CHECK (INV-DB-07); amount bounds; fee rules; link requirements; `external_ref` uniqueness; reversal mirror + single-reversal (INV-DB-08); opening-first (INV-DB-10); deferred transfer balance (INV-DB-09); session overlap (INV-DB-13) |
| Generated columns | table-driven delta test (INV-DB-05) |
| Immutability | UPDATE of any column other than `note` fails; DELETE fails; checkpoint/audit UPDATE fails (INV-DB-04) |
| RPC behaviour | Every RPC: happy path, each guard error code, idempotent replay (INV-DB-12), atomicity (induced mid-RPC failure leaves nothing), lifecycle state machine of `02` §7 including `resettle/reopen/correct/annul` |
| Audit | Exactly one audit row per mutation with right old/new/actor (INV-DB-11) |
| Purge | `delete_my_account()` leaves zero rows in every table (SEC-15); direct delete of ledger by a client still fails |
| Parity | Load `example-01` through RPCs; assert `v_platform_balances`, `v_bet_results`, `v_checkpoint_status` equal the fixture and equal the TS engine output (the parity test runs the engine in Vitest against the same database, `tests/parity`) |
| Versioning | `schema_version()` equals the highest migration number (INV-DB-14) |

## 5. E2E and accessibility

Journeys (Playwright, local stack, a fresh user per test, data created through the UI or RPC helpers):

1. Sign in → empty dashboard (no fabricated values) (AC-DASH-06, AC-AUTH-01).
2. Create platforms with openings → deposit with fee → place, settle, void bets → withdrawal → transfer → fee/bonus → checkpoint + adjustment; dashboard equals `EX-01…EX-14` (AC-DASH-03).
3. Correct an entry and a bet settlement; history drawer shows pairs (AC-LEDG-06, AC-AUD-01).
4. Double-submit and retry-after-failure record once (AC-LEDG-10, AC-HEALTH-03).
5. Two users in separate browser contexts see only their own data; exports contain only own rows (AC-AUTH-04, SEC-19).
6. Offline: block network → stale bar, writes disabled; restore → recovers (AC-HEALTH-04).
7. Missing env → setup screen (AC-HEALTH-01); wrong schema version stub → blocked (AC-HEALTH-02).
8. Privacy mode masks amounts everywhere (AC-DASH-07, SEC-13).
9. Export JSON/CSV: totals match screen; hostile notes neutralised (AC-EXP-*, SEC-14).
10. Storage inspection after a full session: no financial values in any browser storage; only the Supabase origin was contacted (SEC-11, SEC-12).
11. Account deletion (AC-AUTH-05).
12. P1: limits create/loosen/pending/cancel; period boundaries; signals (AC-LIM-*).

axe runs on every P0 screen in light and dark, at 360 px and desktop widths. Keyboard-only walkthrough of journey 2 is a scripted test.

Static/grep tests: forbidden vocabulary (`05` §9); no `sync`/`backed up` strings; no `parseFloat/toFixed/Math.round/Number(` on money outside allowed modules; no `any`; no references to odds in `domain/**` calculations (AC-BET-07, INV-ACC-12); production bundle contains no demo markers and no service-role marker (AC-HEALTH-05, SEC-04).

## 6. Traceability

Every `AC-*`, `INV-ACC-*`, `INV-DB-*`, `SEC-*`, and `EX-*` ID is referenced in at least one test title or `it.todo` string (`it('AC-LEDG-05: …')`, `select ok(…, 'INV-DB-09: …')`). `scripts/check-ac-traceability` parses IDs from `01`, `02`, `03`, `06`, scans `src/`, `tests/`, `supabase/tests/`, and:

- **fails** if a referenced ID does not exist in the docs (typo/stale);
- **fails** if an ID belonging to a completed milestone (`scripts/milestones.json`, mirrors `08`) has no non-todo test;
- **warns** for IDs of future milestones.

A milestone is complete only when the check passes for its IDs.

## 7. Workflow per feature

1. Read the owning docs and pick IDs.
2. Write/adjust fixtures and failing tests for the IDs.
3. Implement until green; keep the engine pure and the DB authoritative.
4. Run the full local gate (`npm run verify`: lint, typecheck, unit, db, e2e for touched journeys).
5. Update docs in the same PR if behaviour changed (a doc/code mismatch is a bug); add a `DECISIONS.md` entry if a decision was made.

## 8. Quality gates

| Gate | Threshold |
|---|---|
| `domain/accounting`, `domain/money`, `domain/limits` | ≥ 95 % line and branch coverage; 100 % of `02` §11 invariants covered by a named test |
| Other `domain/**` | ≥ 90 % |
| `data/**` mappers and error mapping | ≥ 90 % |
| DB | 100 % of RPCs and triggers have ≥ 1 positive and ≥ 1 negative test |
| E2E | all journeys pass; no retries masking flakes (retries = 0 on CI for money journeys) |
| a11y | zero serious/critical axe violations |
| Mutation (when run) | score ≥ 80 % on `domain/accounting` |
| Flaky tests | quarantined within one day and fixed before the milestone closes |

Coverage is a floor, not a goal: numbers do not substitute for the named invariant tests above.
