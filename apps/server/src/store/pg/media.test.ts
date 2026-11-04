/**
 * Area `media` of the Postgres store, checked for parity with the SQLite store: media rows, their 24 h expiry (on upload
 * and on open) with the hashes reported after COMMIT, and the read log with its links. The calls mirror media.test.ts,
 * s3-media.test.ts, read-log.test.ts and read-links.test.ts. In-process PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import { eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { MIGRATIONS } from '../../db/client.ts'
import * as schema from '../../db/schema.ts'
import { entry, level, meal, media } from '../../db/schema.ts'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import type { ReadRow } from '../../ai/read-log.ts'
import { ReadLinkTaken, type MediaInput } from '../port.ts'
import { expected } from './recorded.ts'
import { at, writeTx } from './context.ts'
import { expireMedia, linkRead, unlinked } from './media.ts'
import { openPgStore, type PgStoreOptions } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('media')
const T0 = Date.UTC(2026, 10, 2, 9, 0, 0)
const HOUR = 3_600_000
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

async function pair(opts: PgStoreOptions = {}) {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb()
  handles.push(h)
  const pg = await openPgStore(h.db, { ...opts, now: clock.now })
  const lite = old.session().store
  return { pg, lite, clock, h }
}

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const photo = (sha256: string, extra: Partial<MediaInput> = {}): MediaInput => ({
  kind: 'photo',
  mime: 'image/jpeg',
  sha256,
  size: 900,
  ...extra,
})
const voice = (sha256: string, extra: Partial<MediaInput> = {}): MediaInput => ({
  kind: 'voice',
  mime: 'audio/webm',
  sha256,
  size: 4_000,
  duration_ms: 3_200,
  ...extra,
})

/** A pending entry linking `mediaId`, written straight to the table (the entries area is ported separately). */
const linkEntry = (h: TestDb, admissionId: number, mediaId: number) =>
  h.db.insert(entry).values({
    admission_id: admissionId,
    direction: 'in',
    category: 'water',
    volume_ml: 200,
    source: 'photo',
    created_at: at(T0),
    recorded_ml: 200,
    recorded_at: at(T0),
    media_id: mediaId,
  })

const textRead = (admissionId: number | null): ReadRow => ({
  kind: 'text',
  mode: null,
  models: ['muse-spark'],
  hint: null,
  staff_id: 4,
  admission_id: admissionId,
  confidence: null,
  issues: [],
  needs_review: false,
  drafts: 2,
  output: {
    kind: 'text',
    drafts: [
      { category: 'water', volume_ml: 200, urine_colour: null, drink: 'tea' },
      { category: 'urine', volume_ml: 350, urine_colour: 'pale', drink: null },
    ],
  },
})

const photoRead = (admissionId: number): ReadRow => ({
  kind: 'photo',
  mode: 'sam+spark',
  models: ['sam-3.1', 'muse-spark'],
  hint: 'cup',
  staff_id: 4,
  admission_id: admissionId,
  confidence: 0.82,
  issues: ['blurred'],
  needs_review: true,
  drafts: 1,
  output: {
    kind: 'photo',
    container: 'cup',
    fluid: 'tea',
    volume_ml: 180,
    capacity_ml: 250,
    marks_visible: true,
    urine_colour: null,
    draft: { category: 'water', volume_ml: 180, urine_colour: null, drink: 'tea' },
  },
})

describe('postgres store: media rows', () => {
  it('[charting/media] Upload media: Voice recording', async () => {
    const { pg, lite } = await pair()
    const v = await pg.addMedia(1, voice(A), 4)
    assert.deepEqual(v, lite.addMedia(1, voice(A), 4))
    assert.equal(v?.duration_ms, 3_200)
    // A photo keeps no duration; a recording keeps no served meal.
    const p = await pg.addMedia(2, photo(B, { duration_ms: 99, served_meal: 'lunch' }))
    assert.deepEqual(p, lite.addMedia(2, photo(B, { duration_ms: 99, served_meal: 'lunch' })))
    assert.deepEqual([p?.duration_ms, p?.served_meal], [null, 'lunch'])
    const odd = await pg.addMedia(2, voice(C, { served_meal: 'lunch', duration_ms: undefined }))
    assert.deepEqual(odd, lite.addMedia(2, voice(C, { served_meal: 'lunch', duration_ms: undefined })))
    assert.deepEqual([odd?.duration_ms, odd?.served_meal], [null, null])
  })

  it('[charting/media] Upload media: Unknown bed', async () => {
    const { pg, lite } = await pair()
    assert.equal(await pg.addMedia(999, photo(A)), undefined)
    assert.equal(lite.addMedia(999, photo(A)), undefined)
    assert.equal(await pg.hasMediaSha(A), false)
  })

  it('[charting/media] Link media to records: lookups by id, bed and kind match', async () => {
    const { pg, lite } = await pair()
    for (const s of [pg, lite]) {
      await s.addMedia(1, voice(A), 4)
      await s.addMedia(1, photo(B), 4)
    }
    for (const id of [1, 2, 3]) {
      assert.deepEqual(await pg.media(id), lite.media(id))
      assert.deepEqual(await pg.mediaRef(id), lite.mediaRef(id))
    }
    assert.equal(await pg.media(3), undefined)
    const cases: [number, number, 'voice' | 'photo'][] = [
      [1, 1, 'voice'],
      [1, 1, 'photo'],
      [1, 2, 'voice'],
      [2, 1, 'photo'],
      [3, 1, 'photo'],
    ]
    for (const [m, a, k] of cases) assert.equal(await pg.linkable(m, a, k), lite.linkable(m, a, k), `${m} ${a} ${k}`)
    assert.deepEqual(
      [await pg.hasMediaSha(A), await pg.hasMediaSha(B), await pg.hasMediaSha(C)],
      [lite.hasMediaSha(A), lite.hasMediaSha(B), lite.hasMediaSha(C)],
    )
  })
})

describe('postgres store: unlinked media expiry', () => {
  it('[charting/media] Unlinked media expires: Never saved', async () => {
    const { pg, lite, clock } = await pair()
    const seen: string[][] = []
    pg.watchMediaGone((shas) => seen.push(shas))
    const m = (await pg.addMedia(1, photo(A)))!
    lite.addMedia(1, photo(A))
    clock.set(T0 + 24 * HOUR - 60_000)
    assert.deepEqual(await pg.media(m.id), lite.media(m.id))
    assert.ok(await pg.linkable(m.id, 1, 'photo'))
    clock.set(T0 + 24 * HOUR + 60_000)
    assert.equal(await pg.media(m.id), undefined)
    assert.equal(lite.media(m.id), undefined)
    assert.equal(await pg.linkable(m.id, 1, 'photo'), false)
    assert.equal(await pg.hasMediaSha(A), true, 'the row stays until the next upload or open')
    assert.deepEqual(seen, [])
    const next = (await pg.addMedia(1, photo(B)))!
    assert.deepEqual(next, lite.addMedia(1, photo(B)))
    assert.ok(next.id > m.id, 'ids are never reused')
    assert.deepEqual(seen, [[A]])
    assert.deepEqual([await pg.hasMediaSha(A), await pg.hasMediaSha(B)], [lite.hasMediaSha(A), lite.hasMediaSha(B)])
  })

  it('[charting/media] Unlinked media expires: linked media is kept', async () => {
    const { pg, lite, clock, h } = await pair()
    const m = (await pg.addMedia(1, photo(A)))!
    lite.addMedia(1, photo(A))
    await linkEntry(h, 1, m.id)
    lite.addEntry(1, { direction: 'in', category: 'water', volume_ml: 200, source: 'photo', media_id: m.id })
    clock.set(T0 + 30 * HOUR)
    await pg.addMedia(1, photo(B))
    lite.addMedia(1, photo(B))
    assert.deepEqual(await pg.media(m.id), lite.media(m.id))
    assert.equal((await pg.media(m.id))?.id, m.id)
    assert.equal(await pg.linkable(m.id, 1, 'photo'), true)
  })

  it('[charting/media] Objects go with their last media row: expiry on open reports the hashes once', async () => {
    const { pg, h } = await pair()
    await pg.addMedia(1, photo(A))
    await pg.addMedia(1, photo(A))
    const m = (await pg.addMedia(1, photo(B)))!
    await linkEntry(h, 1, m.id)
    const seen: string[][] = []
    await openPgStore(h.db, { now: () => T0 + 24 * HOUR - 60_000, onMediaGone: (shas) => seen.push(shas) })
    assert.equal(seen.length, 0)
    const again = await openPgStore(h.db, { now: () => T0 + 25 * HOUR, onMediaGone: (shas) => seen.push(shas) })
    assert.deepEqual(seen, [[A]])
    assert.deepEqual([await again.hasMediaSha(A), await again.hasMediaSha(B)], [false, true])
  })

  it('a rolled-back transaction reports nothing; a committed one reports after its outer COMMIT', async () => {
    const seen: string[][] = []
    const { pg, clock } = await pair({ onMediaGone: (shas) => seen.push(['hook', ...shas]) })
    const off = pg.watchMediaGone((shas) => seen.push(shas))
    await pg.addMedia(1, photo(A))
    clock.set(T0 + 25 * HOUR)
    await assert.rejects(
      pg.tx(async (t) => {
        await t.addMedia(1, photo(B))
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.deepEqual(seen, [])
    assert.equal(await pg.hasMediaSha(A), true)
    await pg.tx(async (t) => {
      await t.tx(async (inner) => void (await inner.addMedia(1, photo(C))))
      assert.deepEqual(seen, [], 'nothing before the outer COMMIT')
    })
    assert.deepEqual(seen, [['hook', A], [A]])
    off()
    clock.set(T0 + 50 * HOUR)
    await pg.addMedia(1, photo(A))
    assert.deepEqual(seen, [['hook', A], [A], ['hook', C]], 'an unsubscribed watcher hears nothing')
  })
})

describe('postgres store: the read log and its links', () => {
  it('[charting/model-accuracy] Reads are logged: reads round-trip as in the SQLite store', async () => {
    const { pg, lite } = await pair()
    for (const row of [textRead(1), photoRead(2), textRead(null)]) {
      const id = await pg.recordRead(row)
      assert.equal(id, lite.recordRead(row))
      assert.deepEqual(await pg.read(id), lite.read(id))
      assert.deepEqual(await pg.read(id), { ...row, id, created_at: T0 })
    }
    assert.equal(await pg.read(999), undefined)
    assert.equal(lite.read(999), undefined)
  })

  it('[charting/model-accuracy] Link checks: Linked twice', async () => {
    const { pg, h } = await pair()
    const read = await pg.recordRead(textRead(1))
    assert.equal(await pg.linked(read, 0), false)
    const m = (await pg.addMedia(1, photo(A)))!
    await linkEntry(h, 1, m.id)
    await linkEntry(h, 1, m.id)
    await writeTx({ db: h.db, now: () => T0 }, (t) => linkRead(t, read, 0, { entry: 1 }))
    await writeTx({ db: h.db, now: () => T0 }, (t) => linkRead(t, undefined, 1, { entry: 2 }))
    assert.deepEqual([await pg.linked(read, 0), await pg.linked(read, 1)], [true, false])
    await assert.rejects(
      writeTx({ db: h.db, now: () => T0 }, (t) => linkRead(t, read, 0, { entry: 2 })),
      (err) => err instanceof ReadLinkTaken,
    )
    await writeTx({ db: h.db, now: () => T0 }, (t) => linkRead(t, read, 1, { entry: 2 }))
    assert.equal(await pg.linked(read, 1), true)
  })
})

const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b)

describe('postgres store: media linked_at', () => {
  it('[charting/media] Unlinked media expires: same rows as before', async () => {
    let t = T0
    const clock = { set: (ms: number) => (t = ms) }
    const h = await createTestDb()
    handles.push(h)
    const pg = await openPgStore(h.db, { now: () => t })
    const m: number[] = []
    for (let i = 0; i < 11; i++) m.push((await pg.addMedia(1, photo(i.toString(16).padStart(64, '0'))))!.id)
    const day = { created_at: at(T0), recorded_at: at(T0) }
    const water = { admission_id: 1, direction: 'in' as const, category: 'water', source: 'photo', ...day }
    await h.db.insert(entry).values({ ...water, volume_ml: 200, recorded_ml: 200, media_id: m[0], labeled_media_id: m[1] })
    await h.db.insert(level).values({
      admission_id: 1,
      container: 'bag',
      volume_ml: 300,
      created_at: at(T0),
      media_id: m[2],
      proof_media_id: m[3],
      labeled_media_id: m[4],
    })
    await h.db.insert(meal).values({
      admission_id: 1,
      meal: 'lunch',
      portion: 50,
      source: 'photo',
      media_id: m[5],
      served_media_id: m[6],
      labeled_media_id: m[7],
      ...day,
    })
    // Linked by a later UPDATE, as attaching a photo to a saved entry does.
    const [later] = await h.db
      .insert(entry)
      .values({ ...water, volume_ml: 100, recorded_ml: 100 })
      .returning({ id: entry.id })
    await h.db.update(entry).set({ media_id: m[10] }).where(eq(entry.id, later!.id))
    const exact = async () => ids(await h.db.select({ id: media.id }).from(media).where(unlinked()))
    const fast = async () => ids(await h.db.select({ id: media.id }).from(media).where(isNull(media.linked_at)))
    // Before expiry: the rows each predicate would expire are the same, the two never linked.
    assert.deepEqual(await fast(), await exact())
    assert.deepEqual(await fast(), [m[8], m[9]])
    clock.set(T0 + 30 * HOUR)
    const fresh = (await pg.addMedia(1, photo('f'.repeat(64))))!.id
    assert.deepEqual(await fast(), await exact())
    assert.deepEqual(await fast(), [fresh], 'the two never linked expired on the upload; only the new one is unlinked')
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 10]) assert.equal((await pg.media(m[i]!))?.id, m[i], `m${i}`)
    for (const i of [8, 9]) assert.equal(await pg.media(m[i]!), undefined, `m${i}`)
    // Every column referencing media, outside media itself, has its trigger: a new one without it fails here.
    const cols = await h.pg.query<{ table_name: string; column_name: string }>(
      `SELECT kcu.table_name, kcu.column_name
         FROM information_schema.referential_constraints rc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = rc.unique_constraint_name AND ccu.constraint_schema = rc.unique_constraint_schema
        WHERE rc.constraint_schema = 'meniscus' AND ccu.table_name = 'media'`,
    )
    const defs = await h.pg.query<{ tbl: string; def: string }>(
      `SELECT c.relname AS tbl, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE t.tgfoid = 'meniscus.mark_media_linked'::regproc`,
    )
    // read_link names a read's media for the accuracy log; it is not a record keeping the media alive.
    const linkCols = cols.rows.filter((c) => c.table_name !== 'read_link' && c.table_name !== 'model_read')
    assert.equal(linkCols.length, 8, JSON.stringify(cols.rows))
    for (const { table_name, column_name } of linkCols)
      assert.ok(
        defs.rows.some((d) => d.tbl === table_name && d.def.includes(`'${column_name}'`)),
        `${table_name}.${column_name} has no mark_media_linked trigger`,
      )
  })

  it('[charting/media] Unlinked media expires: linked row survives the migration', async () => {
    // A database at 0002_labeled_media (before linked_at) with a linked photo and an unlinked one, both 2 days old.
    const dir = mkdtempSync(join(tmpdir(), 'meniscus-0002-'))
    mkdirSync(join(dir, 'meta'))
    const journal = JSON.parse(readFileSync(join(MIGRATIONS.migrationsFolder, 'meta', '_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const upTo = journal.entries.findIndex((e) => e.tag === '0002_labeled_media')
    assert.ok(upTo >= 0)
    journal.entries = journal.entries.slice(0, upTo + 1)
    writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal))
    for (const e of journal.entries) copyFileSync(join(MIGRATIONS.migrationsFolder, `${e.tag}.sql`), join(dir, `${e.tag}.sql`))
    const db = await PGlite.create()
    try {
      await migrate(drizzle({ client: db }), { ...MIGRATIONS, migrationsFolder: dir })
      const old = new Date(T0 - 48 * HOUR).toISOString()
      await db.query(`INSERT INTO meniscus.ward (code, name, specialty, capacity) VALUES ('T1', 'Test ward', 'general', 4)`)
      await db.query(
        `INSERT INTO meniscus.admission (ward_id, bed, patient, mrn, qr_token, admitted_at)
         SELECT id, '1', 'Test Patient', 'TP-1', 'tok-test-1', $1 FROM meniscus.ward WHERE code = 'T1'`,
        [old],
      )
      const add = async (sha: string) =>
        (
          await db.query<{ id: number }>(
            `INSERT INTO meniscus.media (admission_id, kind, mime, size, created_at, sha256)
             SELECT id, 'photo', 'image/jpeg', 900, $1, $2 FROM meniscus.admission WHERE qr_token = 'tok-test-1' RETURNING id`,
            [old, sha],
          )
        ).rows[0]!.id
      const linked = await add(A)
      await add(B)
      await db.query(
        `INSERT INTO meniscus.entry (admission_id, direction, category, volume_ml, source, created_at, recorded_ml, recorded_at, media_id)
         SELECT id, 'in', 'water', 200, 'photo', $1, 200, $1, $2 FROM meniscus.admission WHERE qr_token = 'tok-test-1'`,
        [old, linked],
      )
      await migrate(drizzle({ client: db }), MIGRATIONS)
      const d = drizzle({ client: db, schema })
      assert.deepEqual(await expireMedia({ db: d, now: () => T0 }), [B])
      const left = await d.select({ id: media.id, linked_at: media.linked_at, created_at: media.created_at }).from(media)
      assert.deepEqual(
        left.map((r) => r.id),
        [linked],
      )
      assert.equal(left[0]!.linked_at?.getTime(), left[0]!.created_at.getTime(), 'backfilled with its upload time')
    } finally {
      await db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
