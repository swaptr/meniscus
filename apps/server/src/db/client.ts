/**
 * The chart's database connection: Drizzle ORM over postgres.js (https://orm.drizzle.team/docs/connect-supabase), and
 * the migrations applied at start. Production and development only; tests use `createTestDb` (src/db/testing.ts), on
 * the same schema and the same `Db` type.
 */
import { readFileSync } from 'node:fs'
import { rootCertificates } from 'node:tls'
import { fileURLToPath } from 'node:url'
import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from './schema.ts'

/** What the store talks to: satisfied by the postgres-js and PGlite drivers, and by a transaction on either. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** A database and the function that closes its connections (graceful shutdown awaits it after the HTTP drain). */
export interface DbHandle {
  db: Db
  close(): Promise<void>
}

/** drizzle-kit's committed output, applied in order by `migrate()`. Drizzle's journal table sits in our own schema. */
export const MIGRATIONS = {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  migrationsSchema: 'meniscus',
  migrationsTable: 'drizzle_migrations',
} as const

export interface DbOptions {
  /** DATABASE_URL: request traffic (Supavisor transaction mode, 6543, on Supabase). */
  url: string
  /** DATABASE_CA_FILE: PEM CA, trusted with Node's root CAs; certificate and host checked. Unset: no TLS (loopback). */
  caFile?: string
  /** DATABASE_POOL_MAX. */
  max?: number
}

/**
 * TLS for postgres.js. An `ssl` object overrides any `sslmode` in the URL ("Options in the object will override any
 * present in the url", https://github.com/porsager/postgres#connection-details); config.ts still demands
 * `sslmode=verify-full` on remote hosts.
 */
const tls = (caFile: string | undefined) =>
  caFile === undefined ? false : { ca: [readFileSync(caFile, 'utf8'), ...rootCertificates], rejectUnauthorized: true }

const clientOptions = (caFile: string | undefined, max: number): postgres.Options<Record<string, never>> => ({
  max,
  // Supavisor transaction mode has no prepared statements (https://supabase.com/docs/guides/database/drizzle).
  prepare: false,
  ssl: tls(caFile),
  connection: { application_name: 'meniscus-server' },
  // NOTICEs can name identifiers or values; never print them.
  onnotice: () => {},
})

/**
 * Drizzle's postgres-js driver makes the timestamp serializers pass values through untouched (its column mappers send
 * strings), so a `Date` in a raw `sql` template would reach the socket as an object and fail. PGlite takes the `Date`, so
 * only postgres.js needs this: dates in raw SQL go out as ISO strings, as the column mappers send them.
 */
const DATE_TYPES = ['1082', '1114', '1184'] as const
const isoDates = (client: postgres.Sql) => {
  for (const t of DATE_TYPES) {
    client.options.serializers[t] = (v: unknown) => (v instanceof Date ? v.toISOString() : v)
  }
}

export function createDb({ url, caFile, max = 5 }: DbOptions): DbHandle {
  const client = postgres(url, clientOptions(caFile, max))
  const db = drizzle({ client, schema })
  isoDates(client)
  return { db, close: () => client.end({ timeout: 5 }) }
}

/**
 * A database error as it may be logged: the SQLSTATE or Node's error code (`ECONNREFUSED`), never the message, which can
 * echo a value, a key or a statement (server/storage "Storage secrets never revealed").
 */
export const dbErrorCode = (err: unknown): string => {
  const e = (err instanceof Error && 'cause' in err && err.cause instanceof Error ? err.cause : err) as { code?: unknown }
  return typeof e?.code === 'string' ? e.code : err instanceof Error ? err.name : 'unknown error'
}

/** Supabase's API roles (https://supabase.com/docs/guides/database/postgres/roles); absent on PGlite and plain Postgres. */
const API_ROLES = ['anon', 'authenticated', 'service_role'] as const

/** A schema open to the API roles. The message holds table and role names only. */
export class TablesOpen extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`database tables open to Supabase's APIs: ${problems.join('; ')}`)
    this.name = 'TablesOpen'
    this.problems = problems
  }
}

/**
 * server/storage "Tables closed to Supabase's APIs", checked at start after the migrations: every table in `meniscus`
 * has RLS and no policy, and no API role that exists holds a privilege on the schema or on any of its tables. Throws
 * one error naming every problem (table and role names only); the server does not start.
 */
export async function tablesClosedCheck(db: Db): Promise<void> {
  const roles = sql.join(
    API_ROLES.map((r) => sql`${r}`),
    sql`, `,
  )
  // postgres.js answers `execute` with the row array, PGlite with `{ rows }`.
  const result: unknown = await db.execute(sql`
    SELECT 'meniscus.' || c.relname || ' has no row level security' AS problem
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'meniscus' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
    UNION ALL
    SELECT DISTINCT 'meniscus.' || c.relname || ' has a policy'
      FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'meniscus'
    UNION ALL
    SELECT r.rolname || ' has a privilege on schema meniscus'
      FROM pg_roles r
      WHERE r.rolname IN (${roles})
        AND (has_schema_privilege(r.oid, 'meniscus', 'USAGE') OR has_schema_privilege(r.oid, 'meniscus', 'CREATE'))
    UNION ALL
    SELECT r.rolname || ' has a privilege on meniscus.' || c.relname
      FROM pg_roles r
      CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE r.rolname IN (${roles}) AND n.nspname = 'meniscus' AND c.relkind IN ('r', 'p')
        AND has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    ORDER BY 1`)
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { problem: string }[]
  const problems = rows.map((r) => r.problem)
  if (problems.length) {
    throw new TablesOpen(problems)
  }
}

/** Any session-level advisory lock key: two int4s, ('M' 'N' 'S' 'C' as a number, 1 = migrations). */
const MIGRATE_LOCK = sql`SELECT pg_advisory_lock(1296978755, 1)`
const MIGRATE_UNLOCK = sql`SELECT pg_advisory_unlock(1296978755, 1)`

/**
 * Applies the pending migrations before the server listens, on its own one-connection client on the session URL
 * (5432; session advisory locks do not survive transaction mode). Drizzle's `migrate()` takes no lock and reads the last
 * applied migration outside its transaction, so two starting instances would both apply the baseline: the lock makes
 * the second wait, then find nothing to apply. A crashed holder's lock goes with its session.
 */
export async function migrateDb({ url, caFile }: Omit<DbOptions, 'max'>): Promise<void> {
  const client = postgres(url, clientOptions(caFile, 1))
  const db = drizzle({ client })
  try {
    await db.execute(MIGRATE_LOCK)
    try {
      await migrate(db, MIGRATIONS)
    } finally {
      await db.execute(MIGRATE_UNLOCK)
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}
