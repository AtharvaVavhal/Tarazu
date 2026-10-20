# Tarazu — Database Schema

PostgreSQL (Supabase; target PG 15+). This document is the **specification** the first migrations (M2) must implement; the SQL below is normative in intent and must be verified by the pgTAP suite (`07` §4) rather than trusted. Business meaning lives in `02`; this file owns structure and enforcement. Invariants are `INV-DB-nn`.

## 1. Conventions

- All tables in `public`, RLS **enabled and forced**, no access for `anon`.
- Every user-owned table has `user_id uuid not null default auth.uid() references auth.users(id) on delete cascade`. **Clients and RPCs never accept `user_id` as input.**
- Every user-owned table also has `unique (id, user_id)`; child tables use **composite foreign keys** `(parent_id, user_id) → parent(id, user_id)`, so a row can never reference another user's row (INV-DB-03).
- Money: `bigint` paise, suffix `_paise`. Timestamps: `timestamptz`, suffix `_at`. Enumerations: `text` + `CHECK` (easier to evolve than PG enums, and safe inside generated columns — DEC-014).
- Primary keys: `uuid default gen_random_uuid()`; `audit_log` uses `bigint identity`.
- Migrations: `supabase/migrations/<timestamp>_<name>.sql`, forward-only; an applied migration is never edited. Each migration ends by redefining `public.schema_version()` (§9).
- Error codes raised by RPCs (`RAISE EXCEPTION … USING ERRCODE`): `TZ001` validation · `TZ002` not found · `TZ003` state conflict · `TZ004` integrity violation.

## 2. Tables

### 2.1 `user_settings`

```sql
create table public.user_settings (
  user_id          uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  currency         text not null default 'INR' check (currency = 'INR'),          -- A-1, Q-002
  timezone         text not null default 'Asia/Kolkata',                           -- validated in RPC/app against IANA
  week_starts_on   smallint not null default 1 check (week_starts_on between 1 and 7),  -- ISO: 1 = Monday
  privacy_mode     boolean not null default false,
  idle_lock_minutes smallint check (idle_lock_minutes is null or idle_lock_minutes between 1 and 240),  -- Q-018
  signal_config    jsonb not null default '{}'::jsonb check (jsonb_typeof(signal_config) = 'object'),  -- 02 §6.6 thresholds
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
```
Row created on first sign-in by `ensure_user_settings()` (idempotent RPC).

### 2.2 `platforms`

```sql
create table public.platforms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  kind        text not null check (kind in ('BOOKMAKER','EXCHANGE','CASINO','POKER','LOTTERY','WALLET','OTHER')),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id)
);
create unique index platforms_user_name_uq on public.platforms (user_id, lower(btrim(name)));
```

### 2.3 `sessions`

```sql
create table public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at   timestamptz,
  note       text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  unique (id, user_id),
  exclude using gist (user_id with =, tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz), '[)') with &&)
);   -- requires btree_gist; also guarantees at most one open session per user (INV-DB-13)
```

### 2.4 `bets` (no money columns — INV-ACC, P-4)

```sql
create table public.bets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform_id uuid not null,
  session_id  uuid,
  description text not null check (length(btrim(description)) between 1 and 200),
  category    text check (category is null or length(category) <= 40),
  odds_decimal numeric(9,3) check (odds_decimal is null or odds_decimal > 1),   -- informational only; never used in any calculation (INV-ACC-12)
  note        text check (note is null or length(note) <= 500),
  status      text not null default 'OPEN' check (status in ('OPEN','SETTLED','VOID','ANNULLED')),
  placed_at   timestamptz not null,
  settled_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, user_id),
  foreign key (platform_id, user_id) references public.platforms (id, user_id),
  foreign key (session_id,  user_id) references public.sessions  (id, user_id),
  check (status <> 'OPEN' or settled_at is null),                      -- OPEN ⇒ not settled
  check (status not in ('SETTLED','VOID') or settled_at is not null),  -- SETTLED/VOID ⇒ settled_at set; ANNULLED may have either
  check (settled_at is null or settled_at >= placed_at)
);
```
Tests cover all four statuses.

### 2.5 `reconciliation_checkpoints` (immutable)

```sql
create table public.reconciliation_checkpoints (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform_id         uuid not null,
  as_of               timestamptz not null,
  reported_paise      bigint not null check (reported_paise between 0 and 1000000000000),
  ledger_paise        bigint not null,                              -- computed by the server at creation
  difference_paise    bigint generated always as (reported_paise - ledger_paise) stored,
  note                text check (note is null or length(note) <= 500),
  created_at          timestamptz not null default now(),
  unique (id, user_id),
  foreign key (platform_id, user_id) references public.platforms (id, user_id)
);
```

### 2.6 `ledger_entries` (append-only; sole source of money truth)

```sql
create table public.ledger_entries (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  platform_id       uuid not null,
  entry_type        text not null check (entry_type in (
                      'OPENING_BALANCE','DEPOSIT','WITHDRAWAL','TRANSFER_OUT','TRANSFER_IN',
                      'BET_STAKE','BET_PAYOUT','BET_REFUND','FEE','FEE_REFUND',
                      'BONUS_CREDIT','BONUS_FORFEIT','ADJUSTMENT_CREDIT','ADJUSTMENT_DEBIT')),
  amount_paise      bigint not null check (amount_paise between 1 and 1000000000000),
  fee_paise         bigint not null default 0 check (fee_paise between 0 and 1000000000000),
  is_reversal       boolean not null default false,
  reverses_entry_id uuid,
  bet_id            uuid,
  fee_kind          text check (fee_kind in ('BET_COMMISSION','PLATFORM_FEE')),
  transfer_group_id uuid,
  checkpoint_id     uuid,
  occurred_at       timestamptz not null,
  recorded_at       timestamptz not null default now(),
  external_ref      text check (external_ref is null or length(external_ref) between 1 and 100),
  note              text check (note is null or length(note) <= 500),
  source            text not null default 'manual' check (source in ('manual','import','system')),

  platform_delta_paise bigint generated always as (
    (case when is_reversal then -1 else 1 end) *
    (case when entry_type in ('OPENING_BALANCE','DEPOSIT','TRANSFER_IN','BET_PAYOUT','BET_REFUND',
                              'FEE_REFUND','BONUS_CREDIT','ADJUSTMENT_CREDIT')
          then amount_paise else -amount_paise end)
  ) stored,
  bank_delta_paise bigint generated always as (
    (case when is_reversal then -1 else 1 end) *
    (case entry_type when 'DEPOSIT'    then -(amount_paise + fee_paise)
                     when 'WITHDRAWAL' then   amount_paise - fee_paise
                     else 0 end)
  ) stored,

  unique (id, user_id),
  foreign key (platform_id,        user_id) references public.platforms (id, user_id),
  foreign key (reverses_entry_id,  user_id) references public.ledger_entries (id, user_id),
  foreign key (bet_id,             user_id) references public.bets (id, user_id),
  foreign key (checkpoint_id,      user_id) references public.reconciliation_checkpoints (id, user_id),

  check (is_reversal = (reverses_entry_id is not null)),
  check (fee_paise = 0 or entry_type in ('DEPOSIT','WITHDRAWAL')),
  check (entry_type <> 'WITHDRAWAL' or fee_paise <= amount_paise),
  check ((entry_type in ('FEE','FEE_REFUND')) = (fee_kind is not null)),
  check (case
           when entry_type in ('BET_STAKE','BET_PAYOUT','BET_REFUND') then bet_id is not null
           when entry_type in ('FEE','FEE_REFUND') then ((fee_kind = 'BET_COMMISSION') = (bet_id is not null))
           else bet_id is null end),
  check ((entry_type in ('TRANSFER_OUT','TRANSFER_IN')) = (transfer_group_id is not null)),
  check ((entry_type in ('ADJUSTMENT_CREDIT','ADJUSTMENT_DEBIT')) = (checkpoint_id is not null)),
  check (not is_reversal or external_ref is null),
  check (entry_type not in ('ADJUSTMENT_CREDIT','ADJUSTMENT_DEBIT') or length(btrim(coalesce(note,''))) > 0),   -- mandatory reason, 02 §8
  check (occurred_at <= recorded_at + interval '5 minutes')            -- INV-ACC-13
);
create unique index le_reverses_uq   on public.ledger_entries (reverses_entry_id) where reverses_entry_id is not null;
create unique index le_extref_uq     on public.ledger_entries (user_id, platform_id, external_ref) where external_ref is not null;
create index le_user_time_idx        on public.ledger_entries (user_id, occurred_at, id);
create index le_platform_time_idx    on public.ledger_entries (user_id, platform_id, occurred_at, id);
create index le_bet_idx              on public.ledger_entries (bet_id) where bet_id is not null;
create index le_transfer_idx         on public.ledger_entries (transfer_group_id) where transfer_group_id is not null;
create index le_checkpoint_idx       on public.ledger_entries (checkpoint_id) where checkpoint_id is not null;
```

### 2.7 `limits`

```sql
create table public.limits (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  metric                 text not null check (metric in ('STAKED','NET_LOSS','DEPOSITED','BET_COUNT','SESSION_MINUTES')),
  period                 text not null check (period in ('DAY','WEEK','MONTH')),
  threshold_value        bigint not null check (threshold_value > 0),        -- paise, count, or minutes per metric (02 §6.5)
  warn_at_percent        smallint not null default 80 check (warn_at_percent between 1 and 100),
  pending_threshold_value bigint check (pending_threshold_value is null or pending_threshold_value >= 0),  -- 0 = removal
  pending_effective_at   timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((pending_threshold_value is null) = (pending_effective_at is null)),
  unique (id, user_id),
  unique (user_id, metric, period)
);
```
Loosening a limit (higher threshold, or removal) is delayed by 24 h (DEC-012, Q-010); tightening is immediate. Effective threshold = `pending_threshold_value` once `pending_effective_at ≤ now()`, else `threshold_value`; view `v_limits_effective` computes this and `apply_due_limit_changes()` materialises due changes.

### 2.8 `audit_log` (append-only, trigger-written)

```sql
create table public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor       uuid default auth.uid(),
  table_name  text not null,
  row_id      text not null,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_row     jsonb,
  new_row     jsonb
);
create index audit_user_row_idx on public.audit_log (user_id, table_name, row_id, id desc);
```
Audited tables: `user_settings, platforms, sessions, bets, ledger_entries, reconciliation_checkpoints, limits`. Not audited: `audit_log`, `idempotency_keys`.

### 2.9 `idempotency_keys`

```sql
create table public.idempotency_keys (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request_id uuid not null,
  rpc        text not null,
  result     jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
```
Every money-writing RPC takes `p_request_id uuid`. A replay with the same `(user, request_id)` and same `rpc` returns the stored result and writes nothing, so a network retry or double-click cannot double-record (P-7). Same id with a different `rpc` raises `TZ003`.

## 3. Triggers

| Trigger | Table | When | Behaviour |
|---|---|---|---|
| `set_updated_at` | mutable tables | BEFORE UPDATE | `updated_at := now()` |
| `ledger_immutable` | `ledger_entries` | BEFORE UPDATE | Reject unless only `note` changed (`to_jsonb(new) - 'note' = to_jsonb(old) - 'note'`) (INV-DB-04) |
| `ledger_no_delete` | `ledger_entries`, `reconciliation_checkpoints`, `audit_log` | BEFORE DELETE | Reject unless `not exists (select 1 from auth.users where id = old.user_id)` — i.e. only the account-purge cascade may delete (INV-DB-04) |
| `checkpoint_immutable` | `reconciliation_checkpoints`, `audit_log` | BEFORE UPDATE | Always reject |
| `ledger_reversal_check` | `ledger_entries` | BEFORE INSERT | If `is_reversal`: original exists, same user, `original.is_reversal = false`, and platform, entry_type, amount, fee, bet, fee_kind, transfer_group, checkpoint all equal; `occurred_at` equals the original's (INV-ACC-03, DEC-013) |
| `ledger_opening_check` | `ledger_entries` | BEFORE INSERT | Non-reversal `OPENING_BALANCE`: no other live opening on the platform and no live entry earlier than it. Any other entry: not earlier than the platform's live opening (INV-ACC-11) |
| `ledger_transfer_check` | `ledger_entries` | CONSTRAINT, DEFERRABLE INITIALLY DEFERRED | At commit: for each touched `transfer_group_id`, `Σ platform_delta = 0` and #OUT = #IN (INV-ACC-07) |
| `audit_row` | audited tables | AFTER INSERT/UPDATE/DELETE | `SECURITY DEFINER`; writes `audit_log` with `old_row/new_row` (INV-DB-11) |
| `bet_no_money_edit` | `bets` | BEFORE UPDATE | Reject changes to `status`, `settled_at`, `placed_at`, `platform_id` unless `current_setting('tarazu.rpc', true) = 'on'` (set locally by lifecycle RPCs) |

## 4. Row Level Security and grants

Applied to **every** table (INV-DB-01):

```sql
alter table public.<t> enable row level security;
alter table public.<t> force  row level security;
revoke all on public.<t> from public, anon, authenticated;
grant select on public.<t> to authenticated;
create policy <t>_select on public.<t> for select to authenticated using (user_id = (select auth.uid()));
```

Direct-write tables (RLS also covers writes):

| Table | Grants to `authenticated` | Extra policies |
|---|---|---|
| `user_settings` | select, insert, update | `insert/update … using/with check (user_id = (select auth.uid()))` |
| `sessions` | select, insert, update, delete | same predicate; delete allowed only if no bets reference it (FK `restrict`) |

RPC-only tables (no direct INSERT/UPDATE/DELETE grant for any client role): `platforms, bets, ledger_entries, reconciliation_checkpoints, limits, audit_log, idempotency_keys` (INV-DB-06).

All views are created `with (security_invoker = true)` so they inherit RLS. Functions: `revoke execute … from public, anon; grant execute … to authenticated;` (INV-DB-15).

## 5. Views

| View | Purpose |
|---|---|
| `v_platform_balances` | per platform: `balance_paise = Σ platform_delta`, `open_stake_paise` = Σ `−platform_delta` of `BET_STAKE` entries for `OPEN` bets, **as of now** (historical as-of values come from the TS engine, `04` §4) |
| `v_bet_results` | per bet: `stake_paise`, `payout_paise`, `refund_paise`, `commission_paise` (all signed-live sums), `result_paise = payout + refund − stake`, `outcome` (`OPEN`, `VOID`, `ANNULLED`, `WIN`, `LOSS`, `PUSH` per `02` §6.3) |
| `v_checkpoint_status` | `difference_paise`, `adjusted_paise = Σ platform_delta` of linked adjustments, `residual_paise`, `state` (`MATCHED`/`RESOLVED`/`OPEN`, `02` §8) |
| `v_limits_effective` | effective threshold / pending-change view (§2.7) |
| `v_integrity_violations` | rows `(rule, entity_id, detail)` for every SQL-checkable invariant below; **must be empty** in healthy data and is asserted empty after every pgTAP scenario |

`v_integrity_violations` rules: INV-ACC-07 (unbalanced transfer groups) · INV-ACC-08 (status/ledger mismatch, per status) · INV-ACC-09 (bet-linked entry date ≠ bet timestamp) · INV-ACC-11 (opening order) · reversal mirroring · orphan checkpoint adjustments. `INV-ACC-14` (negative balance as of some past instant) is a TS diagnostic, not a view row.

## 6. RPC contract

All RPCs: `language plpgsql security definer set search_path = ''`; first statement derives `v_uid := auth.uid()` and raises `28000` if null; every table access is qualified `public.` and filtered `user_id = v_uid`; none takes `user_id`; money-writing RPCs take `p_request_id` (§2.9), write ledger + status + audit atomically, and return the affected ids and the stored row(s).

| RPC | Args (besides `p_request_id`) | Effects / guards |
|---|---|---|
| `ensure_user_settings()` | — | insert default row if missing |
| `create_platform` | name, kind, opening_paise ≥ 0, opening_at | platform + `OPENING_BALANCE` if > 0 |
| `update_platform` | id, name?, kind? | rename/retag |
| `archive_platform` | id | requires `balance = 0`, no open bets (`TZ003`); `unarchive_platform` |
| `post_deposit` / `post_withdrawal` | platform, amount, fee, occurred_at, external_ref?, note? | `02` §3 rules; archived platform rejected |
| `post_transfer` | from, to, amount, occurred_at, note? | OUT + IN, shared `transfer_group_id`, atomic; from ≠ to |
| `post_fee` / `post_fee_refund` | platform, kind, amount, occurred_at, bet?, note? | `BET_COMMISSION` requires a bet that is not `OPEN`/`ANNULLED` and `occurred_at ≥ placed_at` |
| `post_bonus_credit` / `post_bonus_forfeit` | platform, amount, occurred_at, note? | — |
| `reverse_entry` | entry_id, note | writes the mirrored reversal; **rejected** for entries with `bet_id` (bet-lifecycle RPCs own those) and for transfer legs (use `reverse_transfer`) |
| `reverse_transfer` | transfer_group_id | reverses both legs atomically |
| `correct_entry` | entry_id, new fields… | `reverse_entry` + new entry in one transaction (not for bet/transfer-linked entries) |
| `place_bet` | platform, description, category?, odds?, note?, stake, placed_at | bet `OPEN` + `BET_STAKE @ placed_at`; `session_id` set to the user's session covering `placed_at`, else null |
| `settle_bet` | bet, payout ≥ 0, settled_at | `02` §7; `payout > 0` ⇒ `BET_PAYOUT @ settled_at` |
| `void_bet` | bet, settled_at | `BET_REFUND = live stake` |
| `resettle_bet` / `reopen_bet` | bet, … | reverse live payout/refund then re-apply / reopen |
| `correct_bet` | bet, stake?, placed_at?, description?, … | §7 `correct` |
| `annul_bet` | bet | reverse all live linked entries; status `ANNULLED` |
| `record_checkpoint` | platform, as_of, reported_paise, note? | server computes `ledger_paise` at `as_of` |
| `post_adjustment` | checkpoint, amount, note | direction from `sign(residual)`; platform = checkpoint platform; `occurred_at = as_of`; amount ≤ \|residual\| |
| `set_limit` | metric, period, threshold, warn_at | tightening immediate; loosening → pending 24 h (§2.7) |
| `remove_limit` | metric, period | schedules removal (pending 0) |
| `apply_due_limit_changes()` | — | materialises due pending changes |
| `delete_my_account()` | confirm text | `delete from auth.users where id = auth.uid()` as definer; cascade purges all rows (the delete triggers allow it, §3) |
| `schema_version()` | — | integer, §9 |
| `export_snapshot()` | — | single-statement consistent read of all user tables for export (`04` §7) |

Reference shape for one lifecycle RPC (abridged; other RPCs follow the same skeleton):

```sql
create or replace function public.settle_bet(p_request_id uuid, p_bet uuid, p_payout bigint, p_settled_at timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_bet public.bets; v_prior jsonb; v_res jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select result into v_prior from public.idempotency_keys where user_id = v_uid and request_id = p_request_id;
  if found then return v_prior; end if;
  if p_payout < 0 or p_payout > 1000000000000 then raise exception 'invalid payout' using errcode = 'TZ001'; end if;
  select * into v_bet from public.bets where id = p_bet and user_id = v_uid for update;
  if not found then raise exception 'bet not found' using errcode = 'TZ002'; end if;
  if v_bet.status <> 'OPEN' then raise exception 'bet not open' using errcode = 'TZ003'; end if;
  if p_settled_at < v_bet.placed_at then raise exception 'settled before placed' using errcode = 'TZ001'; end if;
  perform set_config('tarazu.rpc', 'on', true);
  update public.bets set status = 'SETTLED', settled_at = p_settled_at where id = p_bet;
  if p_payout > 0 then
    insert into public.ledger_entries (platform_id, entry_type, amount_paise, bet_id, occurred_at)
    values (v_bet.platform_id, 'BET_PAYOUT', p_payout, p_bet, p_settled_at);
  end if;
  v_res := jsonb_build_object('bet_id', p_bet);
  insert into public.idempotency_keys (request_id, rpc, result) values (p_request_id, 'settle_bet', v_res);
  return v_res;
end $$;
```

## 7. Database invariants

| ID | Invariant | Enforced by | Tested by |
|---|---|---|---|
| INV-DB-01 | RLS enabled **and forced** on every table; `anon` has no table or function access | §4 | pgTAP catalog scan + anon probe |
| INV-DB-02 | `user_id` defaults to `auth.uid()`; no RPC parameter or client payload sets it | defaults, RPC signatures | RPC signature scan; cross-user probe |
| INV-DB-03 | No row can reference another user's row | composite FKs | attempt cross-user insert/rpc → fails |
| INV-DB-04 | Ledger rows are immutable except `note`; ledger/checkpoint/audit rows deletable only by account-purge cascade | triggers §3 | update/delete attempts fail; purge succeeds |
| INV-DB-05 | Generated delta columns cannot be written and match `02` §3 for all 14 types × reversal flag | `GENERATED ALWAYS` | table-driven pgTAP vs fixture |
| INV-DB-06 | Only RPCs write `platforms, bets, ledger_entries, checkpoints, limits` | grants | direct DML as `authenticated` fails |
| INV-DB-07 | All ledger CHECKs of §2.6 hold | constraints | one failing insert per CHECK |
| INV-DB-08 | Reversals mirror originals, once each | trigger + unique index | negative tests |
| INV-DB-09 | Transfer groups balance at commit | deferred trigger | unbalanced insert fails at commit |
| INV-DB-10 | Opening-first rule | trigger | negative tests |
| INV-DB-11 | Every INSERT/UPDATE/DELETE on audited tables yields exactly one audit row with correct old/new and `actor` | trigger | count/compare after scenarios |
| INV-DB-12 | RPC replay with the same `request_id` writes nothing new | `idempotency_keys` | double-call test |
| INV-DB-13 | A user has no overlapping sessions (so at most one open) | exclusion constraint | overlap insert fails |
| INV-DB-14 | `schema_version()` equals the number of the latest applied migration | migration convention | CI check against the migrations folder |
| INV-DB-15 | Function execute rights are limited to `authenticated` | grants | catalog scan |
| INV-DB-16 | `v_integrity_violations` is empty after every happy-path scenario and non-empty (with the right rule) after each deliberate corruption done as superuser | views | pgTAP |

## 8. Performance and retention

Target: all single-user ledger queries < 100 ms at 50k entries (A-7) via the indexes in §2.6. Ledger reads are keyset-paginated on `(occurred_at, id)`. No retention deletion exists; data persists until the user deletes the account (`06` §6). `audit_log` grows with writes and is tiny at A-7 scale.

## 9. Schema versioning

`public.schema_version() returns integer` is redefined by each migration (`1` for the baseline). The client declares `SUPPORTED_SCHEMA = [min, max]`; outside that range the app enters `SCHEMA_MISMATCH` and renders no financial figures (`04` §6).

## 10. Dev and seed data

`supabase/seed.sql` is for local development only and is never applied to a hosted project. Tests build their own data through RPCs. The app contains no built-in sample dataset in production builds (P-1).
