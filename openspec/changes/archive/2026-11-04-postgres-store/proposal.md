# Proposal

**Needed for the Nov 4 deploy.** This change applies right after `labeled-photo-copy` has archived and before `scale-store` and `read-queue` (design §10). The production database is Supabase Postgres from the first deploy, so the deploy waits for this change.

## Why

The hospital deployment is hosted on Render with Supabase. The chart today lives in one `node:sqlite` file that needs a persistent disk on the host, which only one Node process can write. `read-queue` plans a job queue that needs Postgres's row locks and notifications. s3-media already moved the media to an S3 bucket (Supabase Storage when hosted). Moving the chart to Postgres is the last step before a hosted deploy without a disk, and the base the later changes build on. There is no production data yet, so nothing is imported.

## What Changes

- **SQLite is removed, not kept beside Postgres.** The SQLite store (`node:sqlite`, `SCHEMA`, `STORE_SCHEMA_VERSION` through `PRAGMA user_version`) and `DATA_DIR` as a database location go away. There is one store implementation, on Postgres, in production, development and tests. An ESLint rule refuses `node:sqlite` imports.
- **Store port** (internal):
  - `Store` becomes an async interface, and every method returns a `Promise`.
  - Transactions are explicit through `tx(async (t) => …)`.
  - Every caller awaits it: the routes, `chart/`, `ai/pipeline.ts`, `auth.ts`, `testing.ts`, the scripts and the tests. That is 379 call sites in 46 files on 2026-11-04 (164 of them in 26 test files), plus 75 `openStore(` and 51 `testApp(` sites (design §1).
- **Database everywhere** (`charting/entries` **Persistent store**, MODIFIED):
  - Production: Supabase Postgres through Supavisor, `DATABASE_URL` on port 6543 for requests and `DATABASE_SESSION_URL` on 5432 for schema creation (Render has no outbound IPv6, so the direct host is out).
  - Development: the Supabase CLI local stack's Postgres, `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, started by `pnpm dev:stack` (the new name of `pnpm dev:s3`, which stays as an alias). One stack serves the database and the media bucket.
  - `DATABASE_URL` is required wherever the server or a script starts. Tests construct their own database and never read it.
  - Tests: PGlite, an in-process Postgres with no network (design §5), and opt-in runs against a real Postgres when `PG_TEST_URL` is set, as s3-media does with `S3_TEST_ENDPOINT`.
- **Schema** (new `server/storage` requirements):
  - Drizzle ORM: one TypeScript schema, `apps/server/src/db/schema.ts`, in Postgres schema `meniscus`. `drizzle-kit generate` writes the SQL migrations into `apps/server/drizzle/`, committed. The server applies the pending ones at start on the session connection, under an advisory lock, so two starting servers apply each once (design §4.4).
  - The migrations are the version (Drizzle's journal `meniscus.drizzle_migrations`). This replaces fresh-schema's "one baseline, a version, refuse others": a later change edits the schema and commits a new migration.
  - The baseline ports the SQLite `SCHEMA` table for table, with times as `timestamptz` and JSON as `jsonb` (design §4.3 inventory).
  - The immutability triggers become PL/pgSQL. `charting/meals` **Tray proof stored with the meal** and **Meal amendment history** (MODIFIED) say how the database refuses those changes on Postgres.
  - Every table has RLS enabled, and nothing is granted to `anon`, `authenticated` or `service_role`. The app role is `meniscus_app`.
- **Locks** (design §4.1): every write transaction that reads first locks its bed or ward row, and read-outcomes' link check moves inside that lock. A duplicate `read_link` that still reaches the insert answers 400 `already linked`, never 500. No SERIALIZABLE, no advisory lock on record writes, and no retry.
- **Connections** (new `server/storage`):
  - `DATABASE_URL` carries request traffic: Supavisor transaction mode (6543), session mode, or a direct connection.
  - `DATABASE_SESSION_URL` carries the migrations, and later any `LISTEN` or queue worker. It must never be port 6543.
  - A non-loopback host needs `sslmode=verify-full`, with the CA from `DATABASE_CA_FILE`.
  - Shutdown (deploy-ready's `serve.ts`) closes both pools after the HTTP drain.
- **Media** (`charting/media` **Media kept in an object store**, MODIFIED: its `DATA_DIR` check becomes a schema check):
  - s3-media's `MediaStore` port, its `s3` and `memory` adapters, its `S3_*` settings and `media:sweep` are reused as they are. No media adapter is added.
  - Its in-process per-hash lock becomes `pg_advisory_xact_lock` inside the store transaction (design §4.6), so upload and delete stay ordered across connections.
- **Seed and scripts**: the demo hospital seed runs at start into empty tables, as today. `scripts/demo-history.ts` and `media:sweep` use `DATABASE_URL`. The lab fake server (browser checks) runs on an in-process database, so browser checks need no stack (design §4.8).
- **Secrets**: the database passwords and s3-media's `S3_*` keys stay in env through `src/config.ts` and `.env.example`. They never appear in logs, errors or `/api/metrics`.
- **Supabase project setup is documented, not automated.** The user creates the project, runs the role bootstrap SQL, sets the Render env vars and the CA secret file, and turns off the Data API (`docs/deployment.md`). No task deploys anything.

### Upstream model requests per user action (before → after)

None change. Every action makes the number of requests the live specs give it (`capture/read-budget` and `capture/meal-reading`), before and after this change. No code path in this change calls the model API, and the budget stays in memory per process (design §6).

### Changed shapes

- `packages/shared`: none. `@meniscus/meta`: none.
- HTTP: no route, status or field changes.
  - Bodies are deep-equal to today's.
  - Key order inside stored JSON (`evidence`, `proof`, care `value`) may differ, because `jsonb` normalises it. The web parses JSON, so nothing it consumes breaks.
- Config (`config.ts`, `.env.example`):
  - new: `DATABASE_URL` (required at start), `DATABASE_SESSION_URL`, `DATABASE_CA_FILE`, `DATABASE_POOL_MAX`;
  - removed: `DATA_DIR`;
  - media: unchanged (s3-media's `MEDIA_STORE` and `S3_*`).
- Root scripts: `dev:stack` and `dev:stack:stop` (the Supabase CLI local stack); `dev:s3` and `dev:s3:stop` stay as aliases.
- New dependencies (design §3): `drizzle-orm` 0.45.4 and `postgres` 3.4.9; dev `drizzle-kit` 0.31.11 and `@electric-sql/pglite` 0.5.15.

### Out of scope

- **Importing a SQLite store.** There is no production data. Old `DATA_DIR` folders are deleted by hand.
- **Creating the Supabase project and running the deploy.** The user does this (tasks group 11).
- **scale-store's schema** (`linked_at`, the version tables and triggers, the query limits and plan guard). scale-store applies next, on Postgres (1 → 2).
- **The queue itself**: read-queue's tables, worker and retry policy (2 → 3). This change keeps the session connection available for a worker and its `LISTEN` (design §6).
- **Moving the model budget out of memory.** It stays per process, as acuity-budget left it (design §6).
- **Supabase Auth, Realtime, the Data API, Edge Functions, and Supabase client libraries in the web.** The web talks only to our server (AGENTS.md).
- **Multiple server processes.** The model budget and the metrics stay per process.
- **Claiming HIPAA compliance.** Whether to use Supabase for PHI, and the BAA, plan and add-on that requires, are the organisation's decisions (design §8).
- **Read replicas, Supabase Branching, PITR settings.**

## Capabilities

### New Capabilities

None. `server/storage` is created by s3-media.

### Modified Capabilities

- `server/storage` (created by s3-media): ADDED the database connection settings, the session connection, the schema migrated on start, closing the tables to Supabase's APIs, and keeping secrets out of logs.
- `charting/entries`: **Persistent store** names the Postgres database at `DATABASE_URL`, required at start; **Store schema version** (fresh-schema's SQLite file version) is REMOVED.
- `charting/meals`: **Tray proof stored with the meal** and **Meal amendment history**: the "Database refuses changes" scenarios run on Postgres (SQLSTATE `P0001`) instead of on the store file.
- `charting/wards`: **Demo hospital**: "Seeding happens once" restarts on the same database, not the same file.
- `charting/media`: **Media kept in an object store** (s3-media's): the bytes are checked to be absent from the schema, not from `DATA_DIR`.

## Impact

- `apps/server`:
  - `src/store/`: new `port.ts` (the async `Store` and `Db` types); new `src/db/` (`schema.ts`, `client.ts`, `testing.ts`), `drizzle.config.ts` and `drizzle/`, new `store/pg/` (one module per area, `store.ts` assembling them); s3-media's `media/lock.ts` (advisory lock); `store.ts` (SQLite) deleted.
  - `routes/*.ts`, `chart/view.ts`, `ai/pipeline.ts`, `auth.ts`, `app.ts`, `index.ts`, `serve.ts`, `config.ts`, `testing.ts`, `lab/fake-server.ts`.
  - `scripts/demo-history.ts`, `scripts/media-sweep.ts`, `scripts/fake-server.ts`.
  - Every server test file: `await`, and `testApp()` becomes `await testApp()`.
- The repo root: `package.json` (`dev:stack`), `.env.example`, `README.md`, `docs/deployment.md`, `render.yaml` (no disk, no `DATA_DIR`, the database secrets), `packages/config/eslint.js` (`node:sqlite` refused).
- `supabase/config.toml`: a `[db]` block pinning the major version and port (task 0.4, after s3-media archives).
- `apps/web`: none. `packages/*` other than config: none.
- CI: unchanged for tests (no network, no Docker). The deploy job's database secrets become required (design §9).
