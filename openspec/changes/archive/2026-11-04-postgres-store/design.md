# Design

**Needed for the Nov 4 deploy.** This change applies on top of s3-media (SQLite `STORE_SCHEMA_VERSION` 8; labeled-photo-copy's 9 if it lands first) and lands before `scale-store` and `read-queue` (§10). It replaces the SQLite store with Postgres: no SQLite remains in production, development or tests, and nothing is imported. Docs were read on 2026-11-04, and every external claim links its source.

**Decided (2026-11-04, `docs/postgres.md`).** Drizzle ORM 0.45.4 and drizzle-kit 0.31.11 over postgres.js 3.4.9 (`prepare: false`), PGlite 0.5.15 in tests. One TypeScript schema gives the SQL migrations and the query types; `migrate()` applies them at start under an advisory lock. Every table lives in schema `meniscus` and the app role is `meniscus_app` (the product is renamed to Meniscus; the db layer uses the new name from the start). §3, §4.2, §4.2a, §4.4 and §5 record the decisions; the base agent's worktree landed them (tasks groups 1–3 and the worked example of group 4).

## 0. Changed types

`packages/shared` and `@meniscus/meta` do not change.

### Store port (`apps/server/src/store/port.ts`, new)

```ts
/** Every method of today's SQLite `Store`, same name, arguments and result, now `Promise`-returning. Derived by a mapped
 *  type while store.ts exists (so the two cannot drift); written out when store.ts is deleted (task 6.3). */
export type Store = { [K in AsyncMethods]: (...args: A) => Promise<R> } & Pick<SqliteStore, 'now' | 'watchMediaGone'> & {
  tx<T>(fn: (t: Store) => Promise<T>): Promise<T>            // one transaction; nested: a savepoint
  withShaLock<T>(sha256: string, fn: (t: Store) => Promise<T>): Promise<T>  // pg_advisory_xact_lock on the hash (§4.6)
  close(): Promise<void>
}
```

`MediaStore` is s3-media's (`src/store/media/port.ts`), unchanged. Its in-process `withShaLock(sha, fn)` (`media/lock.ts`) becomes `store.withShaLock(sha, fn)`; the media area agent switches its callers (`routes/media-io.ts`, `media-gc.ts`, `lab/seed-media.ts`) and deletes `lock.ts`.

### Database (`apps/server/src/db/`, new)

```ts
// client.ts (runtime)
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>  // postgres-js and PGlite drivers, and a transaction on either
export interface DbHandle { db: Db; close(): Promise<void> }
export function createDb(o: { url: string; caFile?: string; max?: number }): DbHandle   // requests: DATABASE_URL
export function migrateDb(o: { url: string; caFile?: string }): Promise<void>            // start: the session URL
export const MIGRATIONS = { migrationsFolder: 'apps/server/drizzle', migrationsSchema: 'meniscus', migrationsTable: 'drizzle_migrations' }
export const dbErrorCode: (err: unknown) => string  // SQLSTATE or ECONNREFUSED; never the message
// testing.ts (tests only; PGlite is a dev dependency)
export function createTestDb(onQuery?: (sql: string, params: unknown[]) => void): Promise<DbHandle & { pg: PGlite }>
export function globalSetup(): Promise<void>  // --test-global-setup: builds the migrated data directory once
```

The store talks to `Db` only. `createStore(db, { now })` (`store/pg/store.ts`) is pure; `openPgStore(db, { now })` seeds and expires first, as `openStore` does.

### Server config (`src/config.ts`, `.env.example`)

| Var | Rule | Default |
| --- | --- | --- |
| `DATABASE_URL` | `postgres(ql)://`. A non-loopback host needs `sslmode=verify-full`. Required by `index.ts` and every script; tests never read it | none. Dev: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` in `.env` |
| `DATABASE_SESSION_URL` | the same rules. The session URL (this, else `DATABASE_URL`) must not be port 6543. Carries the migrations | `DATABASE_URL` |
| `DATABASE_CA_FILE` | a readable PEM file, required with a remote host. Trusted with Node's root CAs, passed to postgres.js as the `ssl` option, which overrides the URL's `sslmode` ([README](https://github.com/porsager/postgres#connection-details)). Supabase's CA is downloaded from the dashboard ([SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)) | none |
| `DATABASE_POOL_MAX` | integer 1–20 | 5 |
| ~~`DATA_DIR`~~ | removed | — |

`config.ts` parses at import, and tests import it, so `DATABASE_URL` stays optional in the schema and `index.ts` (and each script) refuses to start without it once the last area has moved (task 5.2; until then `index.ts` migrates when it is set and the chart stays in SQLite) (charting/entries "Persistent store: No database configured"). Media settings are s3-media's and unchanged.

`redactUrl(url)` in `config.ts` is the only way a URL reaches a log, and it keeps only the scheme, host and port. `config.ts` errors are built from the variable name and never from its value.

### Layer ownership

| Module | Layer | Role |
| --- | --- | --- |
| `src/db/schema.ts` | db | the Drizzle schema, one file (drizzle-kit loads it without resolving schema imports) |
| `drizzle.config.ts`, `drizzle/*.sql`, `drizzle/meta/` | db | drizzle-kit config and its committed output: `0000_baseline` (generated), `0001_triggers_and_grants` (custom SQL) |
| `src/db/client.ts` | db | `Db`, `createDb`, `migrateDb` with its lock, `dbErrorCode` |
| `src/db/testing.ts` | test | `createTestDb`, `globalSetup` (§5) |
| `src/store/port.ts` | store | the async `Store` type |
| `src/store/pg/context.ts` | store | `Ctx` (`db`, `now`), time and staff mappers, `bedOrder` |
| `src/store/pg/<area>.ts` | store | one area's queries and methods, with row mappers and the bed or ward lock first in each write. Done: `wards.ts`, `staff.ts`, `seed.ts`. To do: `entries.ts`, `levels.ts`, `meals.ts`, `media.ts`, `care.ts`, `dashboards.ts` (tasks group 4) |
| `src/store/pg/store.ts` | store | `createStore`, `openPgStore`: assembles the areas, owns `tx` and `withShaLock`, holds the `TODO(area)` stubs |
| `routes/*`, `chart/view.ts`, `ai/pipeline.ts`, `auth.ts`, `app.ts`, `index.ts`, `serve.ts`, `testing.ts` | HTTP / domain | `await` the store. No SQL |

## 1. Context

- **Store.** `apps/server/src/store/store.ts` is 2,642 lines on 2026-11-04, with s3-media being applied (it changes under that apply, so this section cites symbols; task 0.3 re-counts).
  - It is `DatabaseSync` (synchronous) with STRICT tables, WAL and `BEGIN IMMEDIATE` transactions (`tx` in `openStore`).
  - It has about 119 prepared statements, written with `?1` placeholders, `json_object`, `CAST(a.bed AS INTEGER)` and 0/1 booleans.
  - On open (fresh-schema): an empty file gets `SCHEMA` and `STORE_SCHEMA_VERSION`; a file at another version is refused; then `seedStaff → seed → seedTeams`.
  - Media bytes are not in the store: s3-media keeps each object in the S3 bucket under its `sha256`.
- **What the earlier changes left**, from each archived `design.md`. §4.3's inventory maps every item to the baseline.
  - bag-emptying: the `level` columns `event`, `residual_ml`, `recorded_at`, `created_by`, `proof_media_id` and `source`, and the indexes `level_proof_media` and `entry_level`.
  - tray-segmentation: `media.sha256`, `meal.dishes` and `meal.proof` (JSON), and the trigger `meal_evidence_fixed`.
  - read-outcomes: `model_read` (JSON `models`, `issues`, `output`; nullable `admission_id`; `model_read_created`) and `read_link` (`PRIMARY KEY (read_id, draft)`, unique `entry_id`, `level_id`, `meal_id`, exactly one link set). Outcomes are derived on request.
  - dietitian: `referral` with `referral_in_progress` and `referral_admission`; the `dietitian` staff role; ward cover in `staff_ward`.
  - acuity-budget: `ward.default_acuity`. Budget counters live in memory (§6).
  - tray-comparison: `media.served_meal`, `meal.served_media_id`, `meal.amended_at`; `media_served`, `meal_served_media`; `meal_event` with `meal_event_meal` and the triggers `meal_event_fixed` and `meal_event_kept`; `UNLINKED` gains `meal.served_media_id`.
  - bag-alerts: `level.confirmed_duplicate_of`. read-outcomes' `linkProblem` runs in the route before `addBagReading`'s transaction; this change moves it inside, after the bed lock (§4.1).
  - accuracy-views: no schema; `retaken` is one `EXISTS` over `model_read`.
  - dietitian-care: `admission_dietitian` with `admission_dietitian_current` and `admission_dietitian_admission`.
  - drink-types (7): the `drink` columns and their CHECK.
  - s3-media (8): `media` without `bytes`, `sha256 TEXT NOT NULL`, `media_sha256`; the `MediaStore` port, its per-hash lock and `media:sweep`.
  - ui-polish: no schema.
  - labeled-photo-copy (9): `labeled_media_id` on `entry`, `level` and `meal`, each indexed; `UNLINKED` gains the three columns; rejecting an entry and voiding a meal null it with `media_id`.
- **Callers today** (`grep -rhoE 'store\??\.[a-zA-Z]+\('` over `src` and `scripts`, 2026-11-04): **379 call sites in 46 files**, 164 of them in 26 test files. Also 75 `openStore(` and 51 `testApp(` sites, and 49 test files.
  - Re-run (task 0.3, after group 6, on Postgres): **388 call sites in 47 files**, 171 of them in 26 test files; 53 `testApp(` sites, 57 `openPgStore(`/`createStore(` sites, no `openStore(`, and 60 test files. `src/store/pg/` is 4,809 lines: the six areas, `wards`, `staff`, `seed`, `recorded` and their tests.
- **Lint helps.** The type-aware ESLint config already has `recommendedTypeChecked` and `no-floating-promises`. Most missed `await`s become type errors, because a `Promise<Entry>` has no `.id`; the rest become lint errors.

## 2. Goals / Non-Goals

**Goals**

- Every existing HTTP test passes unchanged in its assertions against Postgres, with bodies deep-equal.
- One store, one SQL dialect: every later change writes its SQL once.
- The deploy runs on Supabase Postgres from the first day, with no Render disk.
- `pnpm test` stays network-free and needs no Docker.
- Supabase is a configuration choice, closed to Supabase's own APIs. The server is the only client.

**Non-Goals**

- Keeping SQLite in any role, or importing a SQLite file.
- scale-store's and read-queue's schema; the job queue.
- Several server processes, Supabase Auth, Realtime or the Data API.

## 3. Dependencies

From the npm registry on 2026-11-04 (`pnpm view`), pinned exactly in `apps/server/package.json`:

| Package | Version | Why |
| --- | --- | --- |
| `drizzle-orm` | 0.45.4 (`latest`; the docs site installs 1.0.0-rc.5, not used) | schema, queries, `migrate()` for postgres-js and PGlite ([Drizzle PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)) |
| `postgres` (postgres.js) | 3.4.9, not 4.0.0 | the driver of Drizzle's and Supabase's guides ([Drizzle Supabase](https://orm.drizzle.team/docs/connect-supabase), [Supabase Drizzle](https://supabase.com/docs/guides/database/drizzle)). 4.0.0 (2026-10-29) changes inference, `Date` handling and transactions ([v4.0.0](https://github.com/porsager/postgres/releases/tag/v4.0.0)) and no Drizzle doc covers it; moving is its own change |
| `drizzle-kit` | 0.31.11, dev | `generate`, `migrate`, `check`, `studio` ([drizzle-kit](https://orm.drizzle.team/docs/kit-overview)) |
| `@electric-sql/pglite` | 0.5.15 (Postgres 18.6), dev | the in-process test database ([PGlite](https://pglite.dev/docs/), [Drizzle PGlite](https://orm.drizzle.team/docs/connect-pglite)) |

All four ship compiled JS, so `node src/index.ts` (Node 24 type stripping, which refuses `.ts` under `node_modules`, [TypeScript](https://nodejs.org/api/typescript.html)) and `tsx --test` both run them; the server typechecks with TypeScript 7. `pg`, `@types/pg`, pglite-socket and Kysely are not used. Runtime code never imports PGlite: only `src/db/testing.ts` and tests do.

## 4. Decisions

### 4.1 Store port: async, explicit transactions

- Every method returns a `Promise`. Names, arguments and results stay the same, so routes change by `await` only.
- **Transactions.**
  - Today `tx(() => …)` is internal. It becomes `tx(async (t) => …)`, with `t` a `Store` bound to one checked-out client.
  - Multi-statement methods such as `addEntry`, `review`, `amend`, `addBagReading`, `voidMeal`, `setCare` and `assignBeds` keep running inside one `tx`.
  - Routes that need two store calls in one transaction get `store.tx`.
- **Inside a `tx`**, only queries on `t` and pure code run. There is no model call and no media I/O. The one exception is the S3 `PUT` or `DELETE` under the hash lock (§4.6).
- **Isolation.** SQLite's `BEGIN IMMEDIATE` serialised all writers. Postgres runs at READ COMMITTED.
  - Every write `tx` that reads before it writes first runs `SELECT 1 FROM meniscus.admission WHERE id = $1 FOR UPDATE`. A method keyed by a child row resolves and locks in one statement, `… FOR UPDATE OF a` ([locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)). Ward-level writes lock `meniscus.ward`.
  - **Read links run inside the locked transaction.** Routes that take a `read_id` run read-outcomes' `linkProblem` inside the record's `tx`, right after the bed lock. A read names exactly one bed, so two posts with one `read_id` queue on that bed's lock, and the second sees the first's committed `read_link` row. The order of answers is unchanged.
  - **Belt and braces.** A unique violation (SQLSTATE `23505`, [error codes](https://www.postgresql.org/docs/current/errcodes-appendix.html)) on `read_link_once` maps to 400 `invalid_request` with `{ path: 'read_id', message: 'already linked' }`. No other constraint is mapped, and nothing is retried.
  - **After the lock**, every statement sees what the previous holder committed ([Read Committed](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED)).

  | Lock | Write transactions that read first |
  | --- | --- |
  | bed | `addEntry`, `review`, `amend`, `addLevel` (with the link check) · `attachPhoto` and the media links · `addBagReading`: link check, fall guard, duplicate check, neighbour load, `charge` · `reviewCatheter` · `addMeal`: proof, served photo, labeled copy, link check · `amendMeal` · `voidMeal` · `setCare`, `endCare` (diet targets compare) · refer, acknowledge, close a referral · assign a dietitian, hand back |
  | ward | `setInCharge`, `assignBeds`, the ward default acuity |

  - The guarded single-statement updates (`WHERE status = 'pending'`, `WHERE end_at IS NULL`, `ON CONFLICT DO NOTHING`) and the unique indexes already behave under READ COMMITTED. With the bed lock first, none of them is the deciding check.
  - SERIALIZABLE was rejected: it needs a retry loop on SQLSTATE 40001 ([serializable](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-SERIALIZABLE)). The only advisory locks are the schema-creation lock (§4.4) and the per-hash media lock (§4.6).
- **Results.** Bodies are deep-equal; `jsonb` may reorder keys. Tests compare parsed bodies.
- **Clock.** `now()` stays injected, so SQL never calls `now()` or `CURRENT_TIMESTAMP`. Every time is a parameter.

### 4.2 Driver

**postgres.js 3.4.9 through `drizzle-orm/postgres-js`**, `prepare: false` on every client: Supavisor's transaction mode has no prepared statements ([Supabase Drizzle](https://supabase.com/docs/guides/database/drizzle)). Never call Drizzle's `.prepare(name)`. Options: `max` from `DATABASE_POOL_MAX`, `ssl` from `DATABASE_CA_FILE` (`{ ca: [CA, ...rootCertificates], rejectUnauthorized: true }`), `application_name: 'meniscus-server'`, NOTICEs dropped. `close()` is `client.end({ timeout: 5 })`.

**Types.** Times are `timestamp(…, { withTimezone: true, mode: 'date' })`: Drizzle maps `timestamptz` to `Date` on both drivers, and the store maps epoch ms in (`at(ms)`) and ISO strings out (`iso(d)`), as the SQLite mappers do today. A raw `sql` time (`max(created_at)`) gets `.mapWith(entry.created_at)`. Aggregates are cast in SQL (`count(*)::int`): postgres.js returns int8 as a string, PGlite as a number. `jsonb` columns arrive parsed. Flags are `boolean`.

### 4.2a Query layer

**Drizzle's query builder**, typed from `schema.ts`: `db.select(…).from(…).where(…)`, `insert … onConflictDoUpdate … returning`, `.for('no key update')`. Raw `sql` only for what the builder cannot say: `FILTER`, correlated subqueries, `date_bin`, `jsonb_build_object`, advisory locks. TS keys equal the column names (`admitted_at`), so rows keep the SQLite row shapes and the mappers port almost unchanged. No relational query API (`db.query.*`): the joins are explicit, as today.

The worked example is `store/pg/wards.ts` and `store/pg/staff.ts`, parity-tested against the SQLite store in `store/pg/store.test.ts`.

### 4.3 Schema: types, dialect, triggers

**Schema `meniscus`**, not `public`: Supabase's default grants to `anon` and `authenticated` apply to new objects in `public` ([hardening](https://supabase.com/docs/guides/database/hardening-data-api)).

| SQLite (STRICT) | Postgres | Notes |
| --- | --- | --- |
| `INTEGER PRIMARY KEY [AUTOINCREMENT]` | `integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY` | identity values are never reused, which keeps AUTOINCREMENT's guarantee for `media` and `model_read` |
| epoch-ms `INTEGER` times | `timestamptz` | microsecond precision round-trips ms exactly |
| JSON `TEXT` | `jsonb` | |
| `REAL` | `double precision` | |
| `TEXT CHECK (x IN (…))` | `text CHECK (x IN (…))` | lists built from shared constants (`STAFF_ROLES`, `MEAL_KINDS`, drink kinds) are checked against them by a test |
| `media.sha256 TEXT NOT NULL` | `text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')` | the object key (§4.6) |
| 0/1 `INTEGER` flags | `boolean` | |

**Baseline inventory** (`src/db/schema.ts` → `drizzle/0000_baseline.sql`), the SQLite `SCHEMA` ported table for table. The worktree base is SQLite version 8 (labeled-photo-copy not applied yet), so its three `labeled_media_id` columns land with labeled-photo-copy or, if it applies after, as a `db:generate` migration:

| Origin | Tables | Columns on existing tables | Indexes and constraints | Triggers |
| --- | --- | --- | --- | --- |
| today | `ward`, `staff`, `admission`, `media`, `entry`, `entry_event`, `level`, `meal`, `staff_ward`, `ward_shift`, `bed_assignment`, `ward_access`, `care_order`, `care_review`, `session` | — | every PK and UNIQUE and today's indexes (`care_order_active` unique `WHERE end_at IS NULL`) | — |
| bag-emptying | — | `level` bag columns | `level_proof_media`, `entry_level` | — |
| tray-segmentation | — | `media.sha256`; `meal.dishes`, `meal.proof` | — | `meal_evidence_fixed` |
| read-outcomes | `model_read`, `read_link` | — | `model_read_created`; `read_link_once` PK; unique links; `CHECK (num_nonnulls(entry_id, level_id, meal_id) = 1)` | — |
| dietitian | `referral` | `staff.role` gains `dietitian` | `referral_in_progress`, `referral_admission` | — |
| acuity-budget | — | `ward.default_acuity` | — | — |
| tray-comparison | `meal_event` | `media.served_meal`; `meal.served_media_id`, `meal.amended_at` | `media_served`, `meal_served_media`, `meal_event_meal` | `meal_event_kept` (SQLite's two `meal_event` triggers as one) |
| bag-alerts | — | `level.confirmed_duplicate_of` | — | — |
| dietitian-care | `admission_dietitian` | — | `admission_dietitian_current`, `admission_dietitian_admission` | — |
| drink-types | — | the `drink` columns | their CHECK | — |
| s3-media | — | `media.sha256 NOT NULL`; no `bytes` | `media_sha256` | — |
| labeled-photo-copy | — | `entry`, `level`, `meal` `labeled_media_id` | `entry_labeled_media`, `level_labeled_media`, `meal_labeled_media` | — |
| this change | `drizzle_migrations` (Drizzle's journal) | — | — | `refuse_change()` in `0001` |

Task 0.1 re-reads every archived design, and task 3.3's one-time parity check catches anything this list missed.

**One-time parity check** (task 3.3). Before the SQLite store is deleted, a scratch test opens it in memory at version 9 and compares `sqlite_master` (tables, `pragma_table_info` columns, indexes with uniqueness and `WHERE`, triggers) with `information_schema.columns`, `pg_indexes` and `pg_trigger` for `meniscus`, through an explicit map (two `meal_event` triggers per Postgres one; `drizzle_migrations` Postgres-only). It runs until it passes, and is deleted with `node:sqlite` in the same task. From then on `src/db/schema.ts` and the migrations are the only schema.

**Dialect fixes** (inside the area modules; each covered by the HTTP suite):
- `?1` becomes `$1`.
- `json_object(…)` becomes `jsonb_build_object(…)`; `json_group_array` becomes `coalesce(jsonb_agg(… ORDER BY …), '[]'::jsonb)`.
- `CAST(a.bed AS INTEGER)` becomes `coalesce(substring(a.bed from '^[0-9]+')::int, 0)`.
- `last_seen_at + ?2 <= ?1` becomes `last_seen_at + $2 * interval '1 millisecond' <= $1`; tray-comparison's 4 h window and accuracy-views' retake window compare `timestamptz` the same way.
- `?2 IS NULL OR a.ward_id = ?2` gets explicit casts (`$2::int IS NULL`).
- `(a IS NOT NULL) + … = 1` becomes `num_nonnulls(…) = 1` (the `read_link_one` CHECK).
- `PRAGMA` calls go away. `INSERT … RETURNING` and `ON CONFLICT … DO UPDATE` are unchanged.

**Triggers in PL/pgSQL** ([CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html)):

```sql
CREATE FUNCTION meniscus.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '%', TG_ARGV[0] USING ERRCODE = 'P0001'; END $$;

-- tray-segmentation: fires only when an UPDATE's SET names evidence or proof, like SQLite's UPDATE OF
CREATE TRIGGER meal_evidence_fixed BEFORE UPDATE OF evidence, proof ON meniscus.meal
  FOR EACH ROW EXECUTE FUNCTION meniscus.refuse_change('meal evidence and proof cannot change');
-- tray-comparison: meal_event is append-only
CREATE TRIGGER meal_event_kept BEFORE UPDATE OR DELETE ON meniscus.meal_event
  FOR EACH ROW EXECUTE FUNCTION meniscus.refuse_change('meal_event rows are kept as written');
```

`P0001` is `raise_exception`. charting/meals "Database refuses changes" (both requirements) specifies the refusal. The triggers live in the custom migration `0001_triggers_and_grants.sql` (`drizzle-kit generate --custom`, [custom migrations](https://orm.drizzle.team/docs/kit-custom-migrations)); scale-store adds its own as a new custom migration.

**Postgres version skew.** PGlite 0.5.15 is Postgres 18.6; Supabase defaults to 17 ([changelog](https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change)) and the local stack runs 17.11 (checked 2026-11-04). Rule: Postgres 17 features only, so no `uuidv7()`, virtual generated columns or `RETURNING OLD/NEW` (18). `PG_TEST_URL` runs on the local stack's 17.

### 4.4 Schema: Drizzle migrations, applied at start

**Chosen** (replaces fresh-schema's "one baseline, a version, refuse others"): forward-only SQL migrations, generated by `drizzle-kit generate` from `src/db/schema.ts` into `apps/server/drizzle/` and committed with their `meta/` snapshots ([migrations](https://orm.drizzle.team/docs/migrations)). The migrations are the version: Drizzle's journal `meniscus.drizzle_migrations` replaces `schema_version`, and there is no refusal path. A later change edits `schema.ts`, runs `db:generate`, and commits the new file (scale-store `0002_…`, read-queue after it). Never edit an applied migration: `migrate()` stores the hash but never compares it.

- `drizzle.config.ts`: `dialect: 'postgresql'`, `schema: './src/db/schema.ts'`, `out: './drizzle'`, `schemaFilter: ['meniscus']`, `migrations: { schema: 'meniscus', table: 'drizzle_migrations' }`, `strict`, credentials from `DATABASE_SESSION_URL` or `DATABASE_URL` in the shell ([config file](https://orm.drizzle.team/docs/drizzle-config-file)). Scripts: `db:generate`, `db:migrate`, `db:check`, `db:studio`.
- `0000_baseline.sql` is generated; its first line is edited to `CREATE SCHEMA IF NOT EXISTS`, because `migrate()` creates the journal's schema before it runs the first migration. `0001_triggers_and_grants.sql` is custom SQL (`--custom`): `refuse_change()`, the two triggers, RLS on every table, and the guarded revokes (§4.5).
- **On start** (`index.ts`, before the store opens): `migrateDb` on the session URL. A failure exits 1 with `[server] start failed: database migrations at postgresql://<host:port>: <SQLSTATE or ECONNREFUSED>`; never the URL's password or the error message.
- **Two starters** (Render overlaps instances on deploy). `migrate()` in drizzle-orm 0.45.4 (`pg-core/dialect.js`) creates the journal and reads its last row outside any transaction, then runs the pending files in one transaction, and takes no lock: two instances on an empty database both apply the baseline, and the second fails on a duplicate object. So `migrateDb` opens its own one-connection client (`max: 1`) on the session URL, takes `pg_advisory_lock(1296978755, 1)`, migrates, and unlocks in `finally`. Session advisory locks hold "until explicitly released or the session ends" ([locking](https://www.postgresql.org/docs/17/explicit-locking.html)) and do not survive transaction mode ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)), hence 5432. Checked on the local stack (Postgres 17.11): two `migrateDb` at once record each migration once.
- **Seeds** run after the migrations in `openPgStore`, into empty tables only, in one transaction under `pg_advisory_xact_lock(1296978755, 2)`.

**Why not `supabase/migrations/` with the CLI:** tests must build the same schema in-process with no Docker, creation runs as `meniscus_app`, and starting the server stays the whole procedure. drizzle-kit gives the same SQL files from the TypeScript schema.

### 4.5 Security: role, RLS, keys

**Bootstrap** (user-run once in the Supabase SQL editor; in `docs/deployment.md` §4.3):

```sql
create role meniscus_app with login password '<generated, 32+ chars>' nosuperuser nobypassrls;
grant create on database postgres to meniscus_app;   -- the baseline creates schema meniscus
alter role meniscus_app set statement_timeout = '5s';
alter role meniscus_app set idle_in_transaction_session_timeout = '15s';
```

The first start creates schema `meniscus` and every table, owned by `meniscus_app`. Locally, the stack's `postgres` user does the same. `CREATE SCHEMA` needs `CREATE` on the database ([CREATE SCHEMA](https://www.postgresql.org/docs/17/sql-createschema.html)); role-level timeouts hold on every pooler mode, where a session `SET` does not ([timeouts](https://supabase.com/docs/guides/database/postgres/timeouts)).

- A login role per service ([roles](https://supabase.com/docs/guides/database/postgres/roles)). The pooler username is `meniscus_app.<ref>` (task 11.2).
- **RLS on every table**, no policy: deny-all ([Postgres RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)). `0001_triggers_and_grants.sql` enables it on every table in `meniscus` and revokes every privilege from `anon`, `authenticated` and `service_role`, inside `IF EXISTS (SELECT FROM pg_roles …)` so it runs on PGlite too. A later migration that adds a table enables RLS on it in the same file; the start-time check catches one that does not.
- **Start-time check** (task 3.4): after the migrations, the server queries `pg_class` for tables in `meniscus` with `relrowsecurity = false`, and `has_schema_privilege` / `has_table_privilege` for the three roles when they exist. Any hit stops the start, naming the table.
- **Data API off** ([hardening](https://supabase.com/docs/guides/database/hardening-data-api)); user-run (task 11.1). `meniscus` is never added to the exposed schemas.
- **Keys.** The server holds the `meniscus_app` password and the S3 access keys; no Supabase API key is used, and the web receives none.
- **Never logged.** `redactUrl()` for every connection log line; database errors as `dbErrorCode()` only; S3 failures as method + status.

### 4.6 Media: s3-media's port, an advisory lock

- **Port and adapters** are s3-media's, unchanged: `s3` over `aws4fetch`, `memory` for tests, the `S3_*` settings, the HeadBucket start check, the 503 `media_unavailable` mapping and `media:sweep`. No adapter and no media variable is added.
- **References.** A media is referenced while any row links it, through today's `UNLINKED` predicate over `entry.media_id`, `level.media_id`, `level.proof_media_id`, `meal.media_id`, `meal.served_media_id` and the three `labeled_media_id` columns. `voidMeal` clears `media_id`, `served_media_id` and `labeled_media_id` in one UPDATE, which `meal_evidence_fixed` allows. Rejecting an entry nulls `media_id` and `labeled_media_id` together. scale-store later replaces the predicate with `linked_at`.
- **The race across connections.** s3-media's in-process `withShaLock` becomes `store.withShaLock(sha, fn)`: `pg_advisory_xact_lock(hashtextextended(sha256, 0))` first in a transaction, which works on any connection mode ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
  - **Upload:** one `tx` takes the lock, runs s3-media's `put`, inserts the row, and commits. A `MediaStoreError` rolls back with no row.
  - **Delete** (reject, void, expiry): the rows' transaction commits, and `DELETE … RETURNING sha256` gives `onMediaGone` its hashes. Then, per hash, one `tx` takes the lock, checks `SELECT 1 FROM meniscus.media WHERE sha256 = $1`, and deletes the object if no row has it.
  - The two critical sections serialise on the lock, so s3-media's "Same bytes uploaded during a delete" keeps passing. Holding a transaction across one S3 call is bounded by s3-media's 10 s timeout.

### 4.7 Development: the Supabase CLI local stack

- `pnpm dev:stack` (today's `dev:s3` command, renamed; `dev:s3` and `dev:s3:stop` stay as one-line aliases, so s3-media's `(run pnpm dev:s3)` hints stay true) starts the local stack: Postgres on `127.0.0.1:54322` and Storage on `54321` ([CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)).
- `.env` gets `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`, pasted by hand like the `S3_*` values. No script reads or writes `.env`.
- A refused connection at start exits 1 with `database unreachable at 127.0.0.1:54322 (run pnpm dev:stack)`.
- `pnpm --filter @meniscus/server demo` writes the demo history into that database, and refuses when it already holds entries ("Use a fresh database: drop schema meniscus").
- **`supabase/config.toml`** has no `[db]` block today; the CLI defaults the port to 54322. Task 0.4 adds `[db]` with `port = 54322` and `major_version` equal to the hosted project's major, and turns the CLI seed off (we seed from TypeScript), each key checked against the CLI 3.0.0 config reference. The file is s3-media's until it archives, so the task waits for that.

### 4.8 Lab fake server

`src/lab/fake-server.ts` (browser checks, no `.env`) runs on a fresh in-process PGlite database per start (§5's factory), so browser checks need neither Docker nor the stack. It is a test harness, so it is the one non-test runtime that does not need `DATABASE_URL`. `scripts/fake-server.ts` stops requiring `DATA_DIR`.

## 5. Tests

- **Backend: PGlite in memory, in-process**, through `drizzle-orm/pglite` with the same schema and migrations ([Drizzle PGlite](https://orm.drizzle.team/docs/connect-pglite)). No network, Docker or Supabase.
- **Measured** (PGlite 0.5.15, Node 24.18, 8 cores, 2026-11-04): `PGlite.create()` runs initdb, 6.5 s; `migrate()` 0.5 s; `clone()` 1.2 s; `PGlite.create({ loadDataDir })` of the migrated directory 1.1 s cold, about 0.6 s warm in a test process; TRUNCATE of every table 0.1 s; the demo seed about 0.4 s.
- **Chosen:** `globalSetup` in `src/db/testing.ts` (the server's `test` script passes `--test-global-setup=./src/db/testing.ts`, [test runner](https://nodejs.org/api/test.html)) builds the migrated data directory once into `$TMPDIR/meniscus-test-db-<hash of the migrations>.tar`. Each `createTestDb()` loads it: a fresh, isolated database per call, so `testApp()` keeps "a fresh store per test". A file run alone builds the dump on first use. Fallback if the suite is too slow: one database per file and TRUNCATE between tests.
- **One connection.** PGlite serialises everything: a raw `pg.query` issued while a transaction is open waits for it (a deadlock in a test). Inside `tx`, use only the bound store. Lock assertions use `createTestDb(onQuery)` (Drizzle's logger) to check the lock statement precedes the writes.
- **Parity.** `store/pg/store.test.ts` opens the SQLite and Postgres stores on one clock and deep-equals each ported method's results (QR tokens aside). Each area agent extends it for its methods before switching callers.
- **Opt-in real Postgres.** With `PG_TEST_URL` set in the shell (the local stack), `db.test.ts` "Two servers start at once" creates a scratch database and runs two `migrateDb` concurrently. Without it the test is skipped. `tsx --test` loads no `.env`.
- **Media** runs on s3-media's memory store and fake S3, unchanged.

## 6. What read-queue gets

- **Ownership.** read-queue owns its queue tables, added to `schema.ts` with their own migration (after scale-store's), their RLS, their worker and its tests. This change creates no queue table and installs no queue package.
- **The session connection.** `DATABASE_SESSION_URL` (5432, never 6543) stays available for a worker and its `LISTEN`; `migrateDb` is its only user here; a worker opens its own client on it the same way. Supavisor's transaction mode loses `LISTEN`/`NOTIFY` ([connecting](https://supabase.com/docs/guides/database/connecting-to-postgres)).
- **The model budget stays in memory**, per process (acuity-budget design §1). read-queue's `BudgetStore` is what would move it.

## 7. Connections (Supavisor)

From Supabase's [connecting guide](https://supabase.com/docs/guides/database/connecting-to-postgres):

| Endpoint | Host:port | Session features |
| --- | --- | --- |
| Direct | `db.<ref>.supabase.co:5432`, IPv6 (IPv4 with the add-on) | all |
| Supavisor session mode | `aws-<n>-<region>.pooler.supabase.com:5432`, IPv4 | all |
| Supavisor transaction mode | same host, `:6543` | loses `SET`/`RESET`, session-level advisory locks, `LISTEN`/`NOTIFY`, temporary tables and prepared statements |

- **On Render**: "Render doesn't support outbound IPv6" ([Render + Supabase](https://render.com/articles/how-to-connect-a-render-service-to-supabase-postgres)), so the direct host is out without the IPv4 add-on. `DATABASE_URL` is the pooler on **6543** (Render's guide recommends it for request traffic), and `DATABASE_SESSION_URL` the same host on **5432**.
- The adapter keeps no session state on `DATABASE_URL`: no `SET` (only `SET LOCAL` in a `tx`), no session locks, no `LISTEN`, no temp tables, no named statements. The bed and ward locks are row locks held to COMMIT, and the media lock is transaction-scoped.
- **TLS**: `sslmode=verify-full` for any non-loopback host ([SSL enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement)); the pool is built with `ssl: { ca, rejectUnauthorized: true }` from `DATABASE_CA_FILE` (a Render secret file at `/etc/secrets/supabase-ca.crt`).
- **Pool size**: `DATABASE_POOL_MAX` defaults to 5. Render "can reset long-lived outbound connections", so the pool must drop a broken client and open a new one on the next request, never retrying the failed query.

## 8. HIPAA: the organisation's decision

Verified, and not a compliance claim:

- HIPAA is "available as paid add-on" on **Team** and **Enterprise**, "Not included" on Free and Pro ([pricing](https://supabase.com/pricing)). It needs a signed BAA, and projects set to "High Compliance" ([HIPAA projects](https://supabase.com/docs/guides/platform/hipaa-projects)), with PITR, SSL Enforcement, Network Restrictions and connection logging.
- "The responsibility of applying the recommended controls falls directly to the customer" ([HIPAA compliance](https://supabase.com/docs/guides/security/hipaa-compliance)).
- Not stated in the docs: which services the BAA covers, Storage included.
- Render and the Meta Model API carry their own terms.
- This change provides `verify-full` TLS, nothing granted to API roles, and no PHI in logs. The rest is user-run (task 11.1).

## 9. Hosting: Render, no disk

**Render**, one native-Node Web Service that serves the web build too (deploy-ready, `render.yaml`, `docs/deployment.md`). With this change there is no Phase A: the first deploy runs on Supabase Postgres and the Supabase Storage bucket, with **no persistent disk**, which also brings back zero-downtime deploys ([disks](https://render.com/docs/disks)).

- One long-lived instance on Node 24, never scaled to zero (per-process budget and metrics).
- Outbound TCP to the pooler on 6543 and 5432.
- Health checks on `/api/health`, which reads no store, so a database outage doesn't fail them.
- SIGTERM: deploy-ready's `serve.ts` drains requests, then awaits `store.close()`, which ends the request pool and any session client (task 7.3).
- Secrets as env vars: `DATABASE_URL` and `DATABASE_SESSION_URL` are required secrets, `DATABASE_CA_FILE` a required variable naming the secret file.
- `render.yaml`: drop `disk:` and `DATA_DIR`, add the four database variables uncommented, and drop the "paid: needed for the disk" comment (paid stays, for no spin-down).

## 10. Order and overlaps

**Fixed order** (the coordinator's, 2026-11-04):

> drink-types (7) → deploy-ready → s3-media (8) → ui-polish → labeled-photo-copy (9) → **postgres-store** (Postgres 1) → scale-store (Postgres 2) → read-queue (Postgres 3)

SQLite ends at labeled-photo-copy's 9 and is deleted here. scale-store and read-queue are Postgres-only.

| Change | What it leaves for this change | Where it lands here |
| --- | --- | --- |
| bag-emptying | `level` bag columns and indexes, the fall guard | §4.3; bed lock (§4.1); `UNLINKED` (§4.6) |
| tray-segmentation | `media.sha256`, `meal.dishes`, `meal.proof`, `meal_evidence_fixed`; "Database refuses changes" on the store file | §4.3; charting/meals MODIFIED to SQLSTATE `P0001` |
| read-outcomes | `model_read`, `read_link`, `linkProblem` | §4.3; link check inside the bed lock and the `23505` mapping (§4.1) |
| dietitian, dietitian-care | `referral`, `admission_dietitian`, the role, cover in `staff_ward` | §4.3; bed lock on their writes (§4.1) |
| acuity-budget | `ward.default_acuity`; in-memory budget | §4.3; §6 |
| tray-comparison | served photo columns and indexes, `meal_event` and its triggers, `UNLINKED`, the 4 h window | §4.3 (one trigger); §4.6 |
| bag-alerts | `confirmed_duplicate_of`; `linkProblem` outside the transaction | §4.3; §4.1; task 8.1's races |
| accuracy-views | tray reads and meal links; `retaken` | §4.1 |
| drink-types | `drink` columns | §4.3 |
| deploy-ready | tables created in an empty schema; `serve.ts` shutdown | §4.4 step 2; §9 and task 7.3 |
| s3-media | `MediaStore`, `S3_*`, the lock, `media:sweep`, `server/storage` with its `## Purpose`, "Media kept in an object store" | §4.6; this delta ADDs to `server/storage`; its `DATA_DIR` scenario line MODIFIED |
| ui-polish | no schema | — |
| labeled-photo-copy | `labeled_media_id` ×3 with indexes; `UNLINKED`; reject and void null it | §4.3; §4.6 |
| **scale-store** (after) | — | ports nothing from here; it edits `schema.ts` and adds a generated and a custom migration with `linked_at`, the version tables and PL/pgSQL triggers, the query limits and `EXPLAIN` guard, on Postgres only |
| **read-queue** (after) | — | its tables in `schema.ts`, as a new migration |
| fresh-schema | `SCHEMA`, `STORE_SCHEMA_VERSION`, "Store schema version" | REMOVED here; replaced by Drizzle migrations (server/storage "Schema migrated on start") |

**Estimate** (agent-assisted, from the counts in §1; per task group):

| Group | Work | Agent-hours |
| --- | --- | --- |
| 0 | Preconditions, counts, deps, `config.toml` | 0.5 |
| 1 | Port types, driver, test harness, spike, baseline timing | 2 |
| 2 | Configuration and `DATABASE_URL` at start | 0.5 |
| 3 | Drizzle schema, migrations, RLS, triggers, one-time parity | 2.5 (done by the base agent, except the parity check and the RLS start check) |
| 4 | Store methods by area (6 areas, about 119 statements; parallel once 1 and 3 land) | 8–10 total, 1.5–2 per area |
| 5 | Routes, `chart/view.ts`, pipeline, `auth.ts`, `app.ts`, `index.ts` (about 215 non-test call sites, lint-guided; 217 at task 0.3's re-run) | 2 |
| 6 | Tests: 164 call sites in 26 files and 126 harness sites; SQLite-only tests removed (task 0.3's re-run: 171 call sites in 26 files, 110 harness sites) | 2.5 |
| 7 | Scripts, seed, fake server, shutdown | 2 |
| 8 | Races, lock-first guard, link check in the lock | 1.5 |
| 9 | Media lock | 0.5 |
| 10 | Docs, `render.yaml`, `.env.example`, README | 1 |
| 11 | User-run on Supabase | 0.5 (user) |
| 12 | Integration and `pnpm verify` | 1 |

About **24–27 agent-hours** in total. Groups 0–3 are serial (about 5.5 h); groups 4–7 then run in parallel by area in worktrees, so the wall clock is about **9–11 hours** with five agents. On Nov 4 that leaves little margin before 9 PM ET, which is why scale-store and read-queue are cut first (PLAN.md §16).

## 11. Risks / Trade-offs

- **[A missed `await`]** → Type errors, plus `no-floating-promises` and `no-misused-promises`. The HTTP suite runs end-to-end on Postgres.
- **[Postgres 18 in tests vs 15/17 in production]** → The Postgres 15-only rule, the grep test, `PG_TEST_URL` on the local stack's major, and the first start on the project (task 11.3).
- **[jsonb reorders keys]** → Bodies compared deep-equal; no hash is computed over stored JSON text.
- **[PGlite slower than `:memory:` SQLite]** → Template and `clone()`, the 2× budget, and the truncate fallback.
- **[Per-bed locks are weaker than SQLite's global writer lock]** → Lock-first in every read-then-write `tx`, the guard, and the race tests.
- **[PGlite cannot show a lock wait]** → The guard, and `PG_TEST_URL` runs.
- **[Development needs Docker for the stack]** → It already does for the media bucket (s3-media); tests and the fake server need neither.
- **[A baseline that misses an earlier change's object]** → The one-time parity check against SQLite version 9 before it is deleted (task 3.3).
- **[pg with Supavisor transaction mode]** → Unnamed statements only. Task 11.3 smoke-tests on 6543; if it fails, use the 5432 session URL for `DATABASE_URL` too.
- **[An S3 request inside a transaction]** → Bounded by s3-media's 10 s timeout; on failure the transaction rolls back on the safe side.
- **[Deadline]** → The estimate in §10 is most of the remaining day. If group 4 is not green by about 5 PM ET, the deploy ships on the last green build (PLAN.md §16 C).

## 12. Migration Plan

**Deploy (user-run, `docs/deployment.md` §4):**
1. Create the project, note its Postgres major.
2. Run the bootstrap SQL.
3. Turn off the Data API, turn on SSL enforcement, download the CA.
4. The private bucket `meniscus-media` and its S3 access keys (s3-media).
5. Set the env vars and the CA secret file on Render (or the GitHub Actions secrets).
6. Deploy. The first start runs the migrations (schema `meniscus` and every table) and seeds the demo hospital.
7. Smoke test (`docs/deployment.md` §7).

**Rollback**: start the previous build against its own database. Writes made after the switch are not carried back. There is no SQLite file to fall back to.

**Local**: delete any old `DATA_DIR` (it is no longer read), run `pnpm dev:stack`, set `DATABASE_URL` in `.env`, start.

## 13. Open Questions

- Which Supabase services the BAA covers, Storage included. For the organisation to ask Supabase.
- The hosted Postgres major for a new project, 15 or 17 (task 0.4 pins the local stack to it).
