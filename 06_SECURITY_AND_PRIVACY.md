# Tarazu — Security and Privacy

Gambling history and finances are highly sensitive personal data: disclosure can cause financial, relational, and emotional harm. The design goal is **private by default, isolated by construction, nothing sent anywhere that is not needed.** Database enforcement details are in `03`; this file owns requirements (`SEC-nn`), the threat model, and privacy rules. Not legal advice (A-10).

## 1. Assets and data classification

| Class | Data | Handling |
|---|---|---|
| **Restricted** | Ledger entries, bets, sessions, checkpoints, balances, notes, limits, audit log, exports | Only in PostgreSQL behind RLS; in browser memory only while signed in; never in logs, URLs, analytics, or browser storage |
| **Confidential** | Email address, auth tokens | Supabase Auth; token in Supabase client storage only |
| **Internal** | UI preferences (theme, collapsed panels) | May use `localStorage` (no financial values) |
| **Public** | Source code, docs, Supabase URL and anon key | Anon key is public by design; RLS is the control |

## 2. Threat model (STRIDE-lite)

| # | Threat | Mitigation |
|---|---|---|
| T1 | Another user reads/writes my rows (via API, RPC, crafted IDs) | RLS forced + composite FKs + `auth.uid()`-scoped RPCs; two-user tests (SEC-01…SEC-05) |
| T2 | Anonymous access using the public anon key | No `anon` grants; catalog scan test (SEC-03) |
| T3 | Service-role key leaks to the client or repo | Never used in the app; CI check and secret scan (SEC-04, SEC-09) |
| T4 | Account takeover (credential stuffing, phishing, weak password) | Email verification, strong password policy, MFA available, auth rate limits (SEC-06, SEC-17) |
| T5 | XSS steals the session or reads data | React escaping, no `dangerouslySetInnerHTML`, strict CSP, no third-party scripts (SEC-08, SEC-11) |
| T6 | Supply-chain compromise | Lockfile, audit, dependency review, minimal dependencies (SEC-10) |
| T7 | Shoulder-surfing / shared device | Privacy mode, idle sign-out, sign-out clears cache (SEC-07, SEC-13) |
| T8 | Sensitive data leaks through logs, error reports, analytics, fonts/CDNs | No third parties; log scrubbing (SEC-11) |
| T9 | Silent data tampering or loss; user (or a bug) rewrites history to hide losses | Append-only ledger, trigger-written audit log (SEC-16); tamper-*evidence* against the owner is out of scope (Q-007) |
| T10 | Spreadsheet formula injection from exported text | CSV neutralisation (SEC-14) |
| T11 | Data left behind after account deletion | Cascade purge test (SEC-15) |
| T12 | Replay/double submission creates duplicate money records | Idempotency keys (INV-DB-12) |
| T13 | Misleading UI makes unknown data look like zero or unsaved data look saved | Data-mode machine and `DataStateBoundary` (P-1, P-3, P-11; AC-HEALTH-*) |

Out of scope: a compromised user device or browser profile; a malicious Supabase project owner (the owner is the user); denial-of-service beyond provider defaults.

## 3. Requirements

| ID | Requirement | Verification |
|---|---|---|
| SEC-01 | RLS is enabled **and forced** on every table; policies restrict to `user_id = auth.uid()` (INV-DB-01) | pgTAP catalog scan |
| SEC-02 | `user_id` is never supplied by clients or RPC args; composite FKs prevent cross-user references (INV-DB-02/03) | pgTAP + RPC signature scan |
| SEC-03 | `anon` and `public` have no privileges on tables or functions (INV-DB-15) | pgTAP catalog scan; anon request E2E |
| SEC-04 | The service-role key is never present in client code, build output, or repo | `check-env` + bundle grep in CI |
| SEC-05 | Every `SECURITY DEFINER` function pins `search_path = ''`, qualifies objects, scopes by `auth.uid()`, and has explicit execute grants | pgTAP + review checklist |
| SEC-06 | Email verification required; password ≥ 12 characters; leaked-password protection enabled where the plan supports it; TOTP MFA enabled in the project and offered in Settings (requirement level: Q-017) | Supabase config reviewed at M3; E2E for verification |
| SEC-07 | Sign-out clears the TanStack Query cache and navigates away; optional idle timeout signs out (AC-AUTH-03, AC-SET-03) | E2E |
| SEC-08 | Production responses set CSP (`default-src 'self'`; `connect-src` limited to the Supabase origin; no `unsafe-inline`/`unsafe-eval` scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`, `Permissions-Policy` minimal | header test against the production build; applied by the hosting layer (Q-006) |
| SEC-09 | No secrets in git; secret scanning in CI and pre-commit | gitleaks |
| SEC-10 | Lockfile committed; `npm audit` high/critical fails CI; Dependabot or equivalent; new dependencies justified in the PR | CI |
| SEC-11 | No third-party analytics, error reporting, fonts, CDNs, or tag managers; fonts self-hosted; logs/errors never contain amounts, notes, descriptions, tokens, or email | grep/lint test; network-request E2E asserting only the Supabase origin is contacted |
| SEC-12 | No financial data in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, or a service worker; TanStack Query persistence is not installed | E2E storage inspection after a full session |
| SEC-13 | Privacy mode masks all amounts, including chart labels and tooltips (AC-DASH-07) | component + E2E |
| SEC-14 | Exported CSV cells beginning with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'`; JSON export is unaffected | unit test with hostile notes |
| SEC-15 | `delete_my_account()` removes the auth user and cascades every row in every user table, including `audit_log` and `idempotency_keys` (AC-AUTH-05) | pgTAP: row counts zero after purge |
| SEC-16 | `ledger_entries`, `reconciliation_checkpoints`, `audit_log` are immutable except as stated in INV-DB-04; every mutation is audited (INV-DB-11) | pgTAP |
| SEC-17 | Supabase Auth rate limits and CAPTCHA/bot protection settings are reviewed and recorded at M3 and M10 | checklist in `08` |
| SEC-18 | Public sign-up follows the decision in Q-001; until decided, production sign-up is **disabled** and accounts are created by the owner | Supabase config reviewed at M3 |
| SEC-19 | Exports contain only the authenticated user's rows; filenames carry no email or name | E2E two-user test |
| SEC-20 | User-facing errors never expose SQL text, stack traces, or other users' identifiers | unit test of error mapper |

## 4. Authentication and session

Supabase Auth, email + password, PKCE, short-lived JWT with refresh. The anon key plus a user JWT is the only credential the browser holds. Password reset via Supabase email flow. Re-authentication (password re-entry) is required for account deletion. MFA (TOTP) is supported by Supabase Auth; whether it is mandatory is Q-017.

## 5. Isolation model

Defence in depth, in order: (1) **grants** — authenticated may only select from tables and execute named RPCs; (2) **RLS** — every row predicate is `user_id = (select auth.uid())`; (3) **composite foreign keys** — no cross-user references; (4) **RPC scoping** — definer functions derive the user from the JWT and never trust parameters; (5) **tests** — a two-user suite attempts every read, write, and RPC across the boundary and expects failure or empty results. Any new table or function is incomplete until it has entries in the catalog-scan test.

## 6. Privacy, retention, deletion

- **Data minimisation:** only what the accounting model needs. No device fingerprinting, location, contacts, or free-text fields beyond notes/descriptions the user chooses to write.
- **Purpose:** personal recordkeeping only. No profiling, no sale or sharing, no advertising.
- **Retention:** kept until the user deletes it or the account. There is no automatic expiry because the ledger is a permanent financial record.
- **Deletion:** `delete_my_account()` purges all data (SEC-15). The UI offers export first. Backups held by the hosting provider age out per the provider's schedule; this must be stated in the deletion dialog once the provider's retention is confirmed (pending Q-006/Q-009 review).
- **Portability:** full JSON export (AC-EXP-01).
- **Region:** choose the Supabase region nearest to India that is available when the project is created; record the choice in `DECISIONS.md`.
- **Regulatory:** treat the data as personal data under applicable law (including India's DPDP Act, 2023) and review obligations before onboarding anyone other than the owner (Q-001, Q-013).

## 7. Backups and recovery

Tarazu does not itself run backups and **must not claim backup**. Durability comes from the hosted database; its backup/PITR availability depends on the plan and must be checked and recorded at M3 before real data is entered (task in `08`). The user-facing safety net is the JSON export; a Settings reminder shows "Last export: <date or never>". Restore tooling is Q-005. Migrations are forward-only and tested on a fresh database; hosted migrations are applied manually after a fresh export.

## 8. Supply chain and build hygiene

Small dependency set (§1 of `04`); exact versions via lockfile; CI installs with `npm ci`; no postinstall scripts from unreviewed packages; GitHub Actions pinned by commit SHA; repository requires 2FA for the owner; protected `main`.

## 9. Responsible-use guardrails and feature review checklist

Tarazu is an accountability tool. Before any change merges that adds or alters a screen, string, metric, notification, or export, answer **all** of the following; any "yes" to 1–6 blocks the change:

1. Does it suggest, rank, or imply what to bet on, how much to stake, when to bet, or how to win money back?
2. Does it show potential winnings, expected value, odds comparisons, or projections?
3. Does it reward, badge, streak, or celebrate placing or logging bets, or winning?
4. Does it add promotions, bonuses discovery, referrals, affiliate links, or social comparison?
5. Does it send or schedule a notification or email that could prompt gambling activity?
6. Does it make losses, costs, or limit breaches harder to see than gains?
7. Does every money figure trace to `02` (no new undocumented formula)?
8. Does unknown/loading/error state avoid showing `₹0` (P-3)?
9. Does it avoid claiming sync, backup, or saved state it has not confirmed (P-11)?
10. Does it add a third-party request, storage of financial data in the browser, or logging of values (SEC-11, SEC-12)?

Limits and risk signals stay advisory because the app cannot stop activity on external platforms (DEC-012); the friction it can legitimately add — delayed loosening of limits, factual signals, neutral copy — is specified in `01` FR-009. Support-resource content (e.g. national helpline numbers) must be verified against an official source before it is shown (Q-009).
