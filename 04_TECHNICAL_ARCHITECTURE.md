# Tarazu — Technical Architecture

Derives from `00` (principles P-1…P-11) and implements `02`/`03`. Versions are pinned in `package-lock.json` at M0; this file names tools, not versions.

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | |
| UI | React (function components) | |
| Build | Vite | SPA; static output |
| Styling | Tailwind CSS | design tokens in `tailwind.config`; see `05` §8 |
| Routing | React Router | route-level code splitting |
| Server state | TanStack Query | in-memory only, no persistence (`06` SEC-12) |
| Forms / validation | react-hook-form + zod | zod is also the row/RPC boundary parser |
| Charts | Recharts | lazy-loaded analytics route |
| Time zones | Luxon (confined to `domain/time`) | DEC-015 |
| Backend | Supabase Auth + PostgreSQL (RLS), `@supabase/supabase-js` | no Edge Functions, Storage, or Realtime in v1 |
| Unit/component tests | Vitest, Testing Library, fast-check | `07` |
| DB tests | Supabase CLI local stack + pgTAP | `07` §4 |
| E2E / a11y | Playwright + axe-core | `07` §5 |
| Lint/format | ESLint (typescript-eslint, react-hooks, jsx-a11y, boundaries), Prettier | |
| Package manager | npm | |
| CI | GitHub Actions | §9 |

## 2. Repository layout

```
/ (repo root)
├─ 00_MASTER_SPEC.md … 08_IMPLEMENTATION_ROADMAP.md, DECISIONS.md   # this documentation system
├─ src/
│  ├─ domain/                 # pure TypeScript: no React, no Supabase, no I/O, no Date.now()
│  │  ├─ money/               # Paise, parse/format, bps ratios
│  │  ├─ time/                # instants (epoch ms), windows, tz bucketing (Luxon)
│  │  ├─ accounting/          # entry types, signed contributions, metrics, position, diagnostics
│  │  ├─ limits/              # limit utilisation, effective thresholds
│  │  └─ analytics/           # series builders for charts, risk signals
│  ├─ data/                   # supabase client, zod row schemas, RPC wrappers, mappers (row → domain)
│  ├─ features/               # auth, platforms, ledger, bets, sessions, reconciliation, dashboard,
│  │                          # analytics, limits, export, settings   (screens + hooks)
│  ├─ ui/                     # design-system primitives, MoneyInput, MoneyText, DataStateBoundary
│  └─ app/                    # router, providers, config, data-mode machine
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/             # 03 implemented here
│  ├─ tests/                  # pgTAP
│  └─ seed.sql                # local dev only
├─ tests/
│  ├─ fixtures/accounting/    # JSON golden fixtures derived from 02 §12
│  └─ e2e/
├─ scripts/                   # check-ac-traceability, check-env, check-migrations
└─ .github/workflows/
```

## 3. Layering rules (enforced by lint)

1. `domain/**` imports only from `domain/**` and the standard library (plus Luxon in `domain/time`). It never reads the clock; "now" is a parameter.
2. `data/**` may import `domain/**`; it is the only place that touches `@supabase/supabase-js`.
3. `features/**` may import `data`, `domain`, `ui`; `ui/**` imports only `domain/money` and itself.
4. No `parseFloat`, `parseInt` on money, `toFixed`, `Math.round`, or `Number(...)` of paise anywhere except `ui/charts/*` (display-time conversion) and the explicit `domain/money` primitives (INV-ACC-01). ESLint `no-restricted-syntax` + a unit test of the rule.
5. No `any`; no non-null assertions in `domain/**`.

## 4. Domain engine (single implementation of `02`)

All formulas exist **once**, in TypeScript, as pure functions over already-loaded data (DEC-008). Data volume is bounded by A-7, so computing client-side from the full ledger is simple and fully unit-testable. SQL views provide integrity cross-checks (balances, bet results, checkpoints), not a second formula set; a parity test (`07` §4) asserts they agree.

```ts
type Paise = bigint;                       // domain/money
type Instant = number;                     // epoch ms UTC

interface LedgerEntry { id; platformId; type: EntryType; amount: Paise; fee: Paise;
  isReversal: boolean; reversesEntryId: string | null; betId: string | null;
  feeKind: FeeKind | null; transferGroupId: string | null; checkpointId: string | null;
  occurredAt: Instant; recordedAt: Instant; externalRef: string | null; note: string | null }
interface Bet { id; platformId; sessionId; status: BetStatus; placedAt: Instant; settledAt: Instant | null; /* no money */ }

positionAt(data, t, platformIds?)          → { balanceByPlatform, openStakeByPlatform, equity }          // 02 §5
metricsFor(data, filter)                   → Metrics                                                    // 02 §6, one object, all families
  filter = { platformIds?: string[]; from: Instant; to: Instant; tz: string }
betResults(data)                           → Map<betId, BetResult>                                      // 02 §6.3
limitStatus(data, limits, now, tz)         → LimitStatus[]                                              // 02 §6.5
riskSignals(data, config, now, tz)         → Signal[]                                                   // 02 §6.6
diagnostics(data)                          → Diagnostic[]   // INV-ACC-02/07/08/09/11/14 checks over loaded data
```

- Signed contribution `sgn` and `platformDelta`/`bankDelta` are implemented once (`domain/accounting/contribution.ts`) and are the only way any function reads an entry's money effect. A unit test asserts they equal the SQL generated columns for all 14 types × reversal flag using the same table (`07` §3).
- `Metrics` carries each family separately (`external`, `betting`, `costs`, `position`, `allIn`) so the UI cannot accidentally sum across families (P-6).
- Functions return `null` for undefined ratios and never `0` as a stand-in (P-3).
- Because the engine is pure, the dashboard, analytics, and export all call it with the same `data` snapshot, which prevents divergent numbers across screens.

## 5. Data layer

- `data/client.ts` creates the Supabase client from validated config (§8) with `persistSession: true` (auth token only), `autoRefreshToken: true`, `detectSessionInUrl: true`, PKCE flow.
- **Reads:** table `select` with explicit columns, keyset pagination on `(occurred_at, id)` for the ledger (page size 1000). Every row passes a zod schema; `bigint`-valued columns arrive as JSON numbers from PostgREST, so the mapper rejects any value outside `Number.MAX_SAFE_INTEGER` (the DB bound of 10¹² paise per entry keeps all single values safe) and converts to `bigint`. Aggregates, where requested from SQL, are cast to text.
- **Writes:** only via the RPCs of `03` §6, each wrapped in a typed function that generates `p_request_id` (`crypto.randomUUID()`) **once per user action** and reuses it on retry (INV-DB-12). No optimistic updates for ledger, bets, checkpoints, platforms, or limits (P-11). After success the relevant queries are invalidated and refetched; the UI shows the confirmed server state.
- **Errors:** RPC `TZ001–TZ004` map to typed `AppError` kinds (`Validation`, `NotFound`, `Conflict`, `Integrity`); network and auth failures are distinct kinds. Unknown errors are shown generically; raw SQL messages are never rendered.
- Query keys are namespaced by `user.id`; sign-out clears the entire query cache.

## 6. Runtime states ("data mode") — honest connectivity

A single state machine in `app/dataMode.ts` gates every screen that shows financial values (P-1, P-3, P-11).

| State | Entered when | Financial values | Writes |
|---|---|---|---|
| `CONFIG_MISSING` | env vars missing/invalid or contain a service-role key | none; setup screen lists what is missing | disabled |
| `SIGNED_OUT` | no session | none | n/a |
| `CHECKING` | after sign-in: `schema_version()` + settings load in flight | none (skeleton) | disabled |
| `SCHEMA_MISMATCH` | `schema_version()` outside `SUPPORTED_SCHEMA` | none; explains the mismatch | disabled |
| `READY` | schema OK and the data load succeeded | shown, with "Last updated hh:mm" | enabled |
| `DEGRADED` | a refetch failed after a prior success | last loaded values, visibly marked stale | disabled until recovery |
| `OFFLINE` | `navigator.onLine === false` or network error | as `DEGRADED` | disabled |
| `DEMO` | **non-production builds only**, `VITE_ENABLE_DEMO=true` | synthetic data under a persistent "DEMO DATA — not real" banner | in-memory only |

Rules:
- The words "synced", "cloud sync", or "backed up" never appear in the UI. A connection indicator says "Connected" only after a successful authenticated request in this session and always shows the last successful read time.
- A write is reported "Saved" only after the RPC resolves successfully.
- The production build fails if `VITE_ENABLE_DEMO` is truthy; `DEMO` code is excluded from production bundles (build-time constant).
- There is no local-only mode and no offline write queue in v1 (DEC-009).

## 7. Export

`export_snapshot()` (`03` §6) returns a consistent read of all user tables in one transaction. The export module formats **from that snapshot**, never from separate live queries, so files agree with each other. Formats and column definitions: `01` FR-010 and `05` §6; CSV is formula-injection-safe (`06` SEC-14). Exports include a header block with schema version, export time, and row counts.

## 8. Configuration and environments

| Variable | Where | Rule |
|---|---|---|
| `VITE_SUPABASE_URL` | client | required |
| `VITE_SUPABASE_ANON_KEY` | client | required; public by design — RLS is the protection (`06`) |
| `VITE_ENABLE_DEMO` | client, non-prod only | production build asserts false |
| `SUPABASE_*` for CLI/CI | CI secrets, never committed | `scripts/check-env` fails the build if a client-exposed variable name contains `SERVICE_ROLE`, or a `.env*` file with secrets is tracked |

Environments: **local** (Supabase CLI stack — default for dev and tests), **hosted** (one Supabase project for the owner; migrations applied manually via CLI after review, ledger of applied migrations recorded in the PR), **hosting** for the static build is open (Q-006).

## 9. Quality gates and CI

GitHub Actions on every PR and on `main`:

1. `lint` — ESLint + Prettier check + `tsc --noEmit`
2. `unit` — Vitest with coverage thresholds (`07` §8); `check-ac-traceability`
3. `db` — `supabase start`, apply migrations from scratch, run pgTAP; assert `schema_version()` matches the latest migration filename
4. `e2e` — Playwright against the local stack + axe checks on key screens
5. `build` — production build, bundle-size budget check, env-leak check
6. `security` — `npm audit --omit=dev` (fail on high+), secret scan (gitleaks), dependency review

`main` is protected: all gates required, no direct pushes. Releases are tags; a hosted-DB migration is a deliberate manual step.

## 10. Performance budgets (to be validated in M10)

Initial JS ≤ 250 kB gzip (Recharts and export code split out) · dashboard interactive ≤ 2 s on a mid-range phone after data load at 5k entries · `metricsFor` ≤ 150 ms and `positionAt` ≤ 50 ms at 50k entries (benchmarked in unit tests, warn-only on CI) · ledger table virtualised beyond 200 rows.

## 11. Errors, logging, observability

- A top-level error boundary renders a neutral failure screen. No financial value, note text, or token is ever sent to a logging or error-reporting service; v1 ships with **no third-party error reporting or analytics** (SEC-11).
- `console` use is lint-banned outside a tiny `app/log.ts` that strips values and is a no-op in production.
- Diagnostics (`v_integrity_violations` and the TS `diagnostics()`) are surfaced in-app on a Diagnostics screen (`05` §5.12), not shipped anywhere.
