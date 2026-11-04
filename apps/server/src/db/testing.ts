/**
 * The test database: in-process Postgres (PGlite, https://pglite.dev/docs/api) with the committed migrations applied, no
 * network and no Docker. Test-only: PGlite is a dev dependency, so runtime code never imports this file.
 *
 * Cost (PGlite 0.5.15, Node 24, 2026-11-04): `PGlite.create()` runs initdb, about 6.5 s; migrating is 0.5 s; opening a
 * migrated data directory with `loadDataDir` is about 1.1 s (as is `clone()`); TRUNCATE of every table is 0.1 s. So the
 * migrated directory is built once per suite (`globalSetup`, the `--test-global-setup` module) into a file keyed by the
 * migrations, and every `createTestDb()` loads that file: a fresh, isolated database in about a second. Run alone (no
 * global setup), the first call builds the file itself.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { MIGRATIONS, type Db, type DbHandle } from './client.ts'
import * as schema from './schema.ts'

/** The migrated data directory for exactly these migration files. */
const dumpPath = () => {
  const h = createHash('sha256')
  const dir = MIGRATIONS.migrationsFolder
  for (const f of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    h.update(f).update(readFileSync(join(dir, f)))
  h.update(readFileSync(join(dir, 'meta', '_journal.json')))
  return join(tmpdir(), `meniscus-test-db-${h.digest('hex').slice(0, 16)}.tar`)
}

async function buildDump(path: string) {
  const pg = await PGlite.create()
  try {
    await migrate(drizzle({ client: pg }), MIGRATIONS)
    const dump = await pg.dumpDataDir('none')
    const tmp = `${path}.${process.pid}`
    writeFileSync(tmp, new Uint8Array(await dump.arrayBuffer()))
    renameSync(tmp, path) // atomic: a parallel reader sees no file or the whole file
  } finally {
    await pg.close()
  }
}

/** `--test-global-setup`: builds the migrated data directory once, before the test files start. */
export async function globalSetup() {
  const path = dumpPath()
  if (!existsSync(path)) await buildDump(path)
}

let dump: Promise<Blob> | undefined
const migratedDump = () =>
  (dump ??= (async () => {
    const path = dumpPath()
    if (!existsSync(path)) await buildDump(path)
    return new Blob([readFileSync(path)])
  })())

export type TestDb = DbHandle & { pg: PGlite }

/**
 * A fresh database at the latest migration, with no rows, isolated from every other. Close it when the test ends.
 * `onQuery` sees every statement Drizzle sends, with its parameters (a test asserting a lock was taken). PGlite has one
 * connection: a raw `pg.query` while a transaction is open waits for it, so never call one from inside `tx`.
 */
export async function createTestDb(onQuery?: (query: string, params: unknown[]) => void): Promise<TestDb> {
  const pg = await PGlite.create({ loadDataDir: await migratedDump() })
  const db: Db = drizzle({ client: pg, schema, ...(onQuery ? { logger: { logQuery: onQuery } } : {}) })
  return { pg, db, close: () => pg.close() }
}
