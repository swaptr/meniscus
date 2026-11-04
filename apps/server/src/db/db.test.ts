/**
 * The Postgres schema and its migrations, on PGlite (no network). The concurrent-start scenario needs two real sessions,
 * so it runs only when PG_TEST_URL names a Postgres the test may create databases on (for example the local Supabase
 * stack); it is skipped otherwise, as s3-media's S3_TEST_ENDPOINT runs are.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { getTableName, is, sql } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import postgres from 'postgres'
import { MIGRATIONS, migrateDb, tablesClosedCheck } from './client.ts'
import { createTestDb } from './testing.ts'
import * as schema from './schema.ts'
import type { HospitalSummary } from '@meniscus/shared'
import { openPgStore } from '../store/pg/store.ts'
import { testApp } from '../testing.ts'

const handles: { close(): Promise<void> }[] = []
after(async () => {
  for (const h of handles) await h.close()
})
const fresh = async () => {
  const h = await createTestDb()
  handles.push(h)
  return h
}

/** Every migration drizzle-kit generated (drizzle/meta/_journal.json). */
const MIGRATION_COUNT = (
  JSON.parse(readFileSync(join(MIGRATIONS.migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }
).entries.length

const rows = async <T>(h: Awaited<ReturnType<typeof fresh>>, text: string) => (await h.pg.query<T>(text)).rows

describe('database schema', () => {
  it('[server/storage] Schema migrated on start: Empty database', async () => {
    const h = await fresh()
    const tables = await rows<{ tablename: string }>(h, "SELECT tablename FROM pg_tables WHERE schemaname = 'meniscus' ORDER BY 1")
    const expected = Object.values(schema)
      .filter((t) => is(t, PgTable))
      .map((t) => getTableName(t))
    assert.deepEqual(tables.map((t) => t.tablename).sort(), [...expected, 'drizzle_migrations'].sort())
    const journal = await rows<{ n: number }>(h, 'SELECT count(*)::int AS n FROM meniscus.drizzle_migrations')
    assert.equal(journal[0]!.n, MIGRATION_COUNT)
    // Signed in as Anita Thomas (the test default), the started server lists the four demo wards.
    const { request } = await testApp({ store: await openPgStore(h.db) })
    const res = await request('/api/wards')
    assert.equal(res.status, 200)
    assert.deepEqual(((await res.json()) as HospitalSummary).wards.map((w) => w.code).sort(), ['2C', '3A', '5B', 'HDU'])
  })

  it('[server/storage] Schema migrated on start: Bootstrapped role', async () => {
    const h = await fresh()
    // An empty database (the fresh one, its schema dropped) and the bootstrap SQL's role: CREATE on the database, not a superuser.
    await h.pg.exec(`
      DROP SCHEMA meniscus CASCADE;
      CREATE ROLE meniscus_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
      DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO meniscus_app', current_database()); END $$;
      SET ROLE meniscus_app;`)
    try {
      await migrate(drizzle({ client: h.pg }), MIGRATIONS)
    } finally {
      await h.pg.exec('RESET ROLE')
    }
    const owners = await rows<{ tablename: string; tableowner: string }>(
      h,
      "SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'meniscus' ORDER BY 1",
    )
    assert.equal(owners.length, Object.values(schema).filter((t) => is(t, PgTable)).length + 1)
    assert.deepEqual(
      owners.filter((o) => o.tableowner !== 'meniscus_app'),
      [],
    )
  })

  it('[server/storage] Schema migrated on start: Second start', async () => {
    const h = await fresh()
    const catalog = async () => ({
      columns: await rows(
        h,
        "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'meniscus' ORDER BY 1, 2",
      ),
      indexes: await rows(h, "SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'meniscus' ORDER BY 1, 2"),
      triggers: await rows(
        h,
        `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'meniscus' ORDER BY 1, 2`,
      ),
      journal: await rows(h, 'SELECT id, hash, created_at FROM meniscus.drizzle_migrations ORDER BY id'),
    })
    // A 200 mL water entry for 3A bed 1, then a second start on the same database.
    const store = await openPgStore(h.db)
    const bed = (await store.admissions()).find((a) => a.ward_code === '3A' && a.bed === '1')!
    const added = await store.addEntry(bed.id, { direction: 'in', category: 'water', volume_ml: 200, source: 'manual' })
    assert.ok(added)
    await store.close()
    const before = await catalog()
    assert.equal(before.journal.length, MIGRATION_COUNT)
    await migrate(drizzle({ client: h.pg }), MIGRATIONS)
    const again = await openPgStore(h.db)
    assert.deepEqual(await catalog(), before)
    const list = await again.entries(bed.id)
    assert.ok(list?.entries.some((e) => e.id === added.id && e.category === 'water' && e.volume_ml === 200))
    await again.close()
  })

  it("[server/storage] Tables closed to Supabase's APIs: Every table", async () => {
    const h = await fresh()
    const open = await rows<{ relname: string }>(
      h,
      "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'meniscus' AND c.relkind = 'r' AND NOT c.relrowsecurity",
    )
    assert.deepEqual(open, [])
    // Supabase's API roles (absent from PGlite, created as Supabase has them) hold no privilege on the schema or any table.
    await h.pg.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN')
    const granted = await rows<{ role: string; tablename: string | null }>(
      h,
      `SELECT r.role, NULL AS tablename FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
         WHERE has_schema_privilege(r.role, 'meniscus', 'USAGE') OR has_schema_privilege(r.role, 'meniscus', 'CREATE')
       UNION ALL
       SELECT r.role, t.tablename FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r(role)
         CROSS JOIN pg_tables t
         WHERE t.schemaname = 'meniscus'
           AND has_table_privilege(r.role, format('meniscus.%I', t.tablename), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
    )
    assert.deepEqual(granted, [])
    const tables = await rows<{ n: number }>(h, "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'meniscus'")
    assert.ok(tables[0]!.n > 0)
  })

  /** Three entries on one bed, written as the schema's owner. */
  const threeEntries = (h: Awaited<ReturnType<typeof fresh>>) =>
    h.pg.exec(`
      INSERT INTO meniscus.ward (id, code, name, specialty, capacity) VALUES (1, '9X', 'T', 'G', 1);
      INSERT INTO meniscus.admission (id, ward_id, bed, patient, mrn, qr_token, admitted_at) VALUES (1, 1, '1', 'P', 'M', 'q', now());
      INSERT INTO meniscus.entry (admission_id, direction, category, volume_ml, source, created_at, recorded_ml, recorded_at)
        SELECT 1, 'in', 'oral', 200, 'manual', now(), 200, now() FROM generate_series(1, 3);`)

  // PGlite has no Supabase roles: the test creates anon as Supabase has it (NOLOGIN, not the owner, no BYPASSRLS).
  const asAnon = async <T>(h: Awaited<ReturnType<typeof fresh>>, text: string) => {
    await h.pg.exec('SET ROLE anon')
    try {
      return (await h.pg.query<T>(text)).rows
    } finally {
      await h.pg.exec('RESET ROLE')
    }
  }

  it("[server/storage] Tables closed to Supabase's APIs: Anonymous read", async () => {
    const h = await fresh()
    await threeEntries(h)
    await h.pg.exec('CREATE ROLE anon NOLOGIN')
    await assert.rejects(asAnon(h, 'SELECT * FROM meniscus.entry'), (e: { code?: string }) => e.code === '42501')
  })

  it("[server/storage] Tables closed to Supabase's APIs: Granted by mistake", async () => {
    const h = await fresh()
    await threeEntries(h)
    await h.pg.exec('CREATE ROLE anon NOLOGIN; GRANT USAGE ON SCHEMA meniscus TO anon; GRANT SELECT ON meniscus.entry TO anon')
    // RLS with no policy hides every row from a role that is not the owner.
    assert.deepEqual(await asAnon<{ n: number }>(h, 'SELECT count(*)::int AS n FROM meniscus.entry'), [{ n: 0 }])
    // And the start-time check refuses such a database, naming the role and the table.
    await assert.rejects(tablesClosedCheck(h.db), /anon/)
    await assert.rejects(tablesClosedCheck(h.db), /meniscus\.entry/)
  })

  it("[server/storage] Tables closed to Supabase's APIs: Table without RLS", async () => {
    const h = await fresh()
    await tablesClosedCheck(h.db) // the migrated schema passes
    await h.pg.exec('CREATE TABLE meniscus.example (id int)')
    await assert.rejects(tablesClosedCheck(h.db), /meniscus\.example/)
  })

  it('fresh test databases are isolated: a row in one is absent from another', async () => {
    const a = await fresh()
    const b = await fresh()
    await a.db.insert(schema.ward).values({ code: '9Z', name: 'Test', specialty: 'General', capacity: 4 })
    assert.equal((await a.db.select().from(schema.ward)).length, 1)
    assert.equal((await b.db.select().from(schema.ward)).length, 0)
  })

  it('timestamptz round-trips epoch ms exactly, and jsonb arrives parsed', async () => {
    const { db } = await fresh()
    const at = new Date(Date.UTC(2026, 10, 4, 9, 30, 15, 123))
    const [w] = await db.insert(schema.ward).values({ code: '9Y', name: 'T', specialty: 'G', capacity: 1 }).returning()
    const [a] = await db
      .insert(schema.admission)
      .values({ ward_id: w!.id, bed: '1', patient: 'Test Patient', mrn: 'T1', qr_token: 'tok', admitted_at: at })
      .returning()
    assert.equal(a!.admitted_at.getTime(), at.getTime())
    await db.insert(schema.staff).values({ id: 1, name: 'Test Nurse', role: 'nurse' })
    const [r] = await db
      .insert(schema.model_read)
      .values({ kind: 'photo', models: ['m'], staff_id: 1, created_at: at, issues: [], needs_review: false, drafts: 0, output: { a: 1 } })
      .returning()
    assert.deepEqual(r!.models, ['m'])
    assert.deepEqual(r!.output, { a: 1 })
  })

  it('meal_event rows refuse UPDATE and DELETE with SQLSTATE P0001', async () => {
    const h = await fresh()
    await h.pg.exec(`
      INSERT INTO meniscus.ward (id, code, name, specialty, capacity) VALUES (1, '9X', 'T', 'G', 1);
      INSERT INTO meniscus.admission (id, ward_id, bed, patient, mrn, qr_token, admitted_at) VALUES (1, 1, '1', 'P', 'M', 'q', now());
      INSERT INTO meniscus.meal (id, admission_id, meal, portion, source, created_at, recorded_at) VALUES (1, 1, 'lunch', 50, 'manual', now(), now());
      INSERT INTO meniscus.meal_event (meal_id, kind, at, reason, before, after) VALUES (1, 'amended', now(), 'r', '{}', '{}');`)
    for (const stmt of ["UPDATE meniscus.meal_event SET reason = 'x'", 'DELETE FROM meniscus.meal_event']) {
      await assert.rejects(h.pg.query(stmt), (e: { code?: string }) => e.code === 'P0001')
    }
    await assert.rejects(h.pg.query(`UPDATE meniscus.meal SET proof = '{}'`), (e: { code?: string }) => e.code === 'P0001')
    await assert.rejects(h.pg.query(`UPDATE meniscus.meal SET evidence = '{}'`), (e: { code?: string }) => e.code === 'P0001')
    await h.pg.query('UPDATE meniscus.meal SET void_reason = $1 WHERE id = 1', ['wrong bed'])
  })

  const PG = process.env.PG_TEST_URL
  it('[server/storage] Schema migrated on start: Two servers start at once', { skip: PG ? false : 'PG_TEST_URL unset' }, async () => {
    const admin = postgres(PG!, { max: 1, onnotice: () => {} })
    // Opt-in runs share database meniscus_test: one test file at a time (a session lock, released with the client).
    await admin`SELECT pg_advisory_lock(1296978755, 2)`
    const name = 'meniscus_test'
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name}`)
    await admin.unsafe(`CREATE DATABASE ${name}`)
    const url = new URL(PG!)
    url.pathname = `/${name}`
    try {
      await Promise.all([migrateDb({ url: url.toString() }), migrateDb({ url: url.toString() })])
      const db = postgres(url.toString(), { max: 1 })
      const [row] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM meniscus.drizzle_migrations`
      await db.end()
      // Each committed migration applied exactly once, though two servers ran them.
      const journal = JSON.parse(readFileSync(join(MIGRATIONS.migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }
      assert.equal(row?.n, journal.entries.length)
    } finally {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await admin.end()
    }
  })

  it('a transaction-scoped advisory lock runs on the test database', async () => {
    const { db } = await fresh()
    await db.transaction(async (t) => {
      await t.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'ab'.repeat(32)}, 0))`)
    })
  })
})
