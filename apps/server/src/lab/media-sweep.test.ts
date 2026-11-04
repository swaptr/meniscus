import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { sql } from 'drizzle-orm'
import { createFakeS3, FAKE_S3 } from '../store/media/fake-s3.ts'
import { createS3MediaStore } from '../store/media/s3.ts'
import { openPgStore } from '../store/pg/store.ts'
import { testDb } from '../testing.ts'
import { mediaShas, sweepMedia } from './media-sweep.ts'

const MIN = 60_000
const NOV3_10 = Date.UTC(2026, 10, 3, 10)
/** A store on one database (the writer, as the live server), the sweep's reader of it, and the fake S3 on one clock. */
async function setup() {
  const h = await testDb()
  const clock = { t: NOV3_10 - 120 * MIN }
  const writer = await openPgStore(h.db, { now: () => clock.t })
  const reader = mediaShas(h.db)
  const fake = createFakeS3({ now: () => clock.t })
  const media = createS3MediaStore({ ...FAKE_S3, forcePathStyle: true, fetch: fake.fetch })
  const bed = (await writer.admissions())[0]!.id
  let n = 0
  /** Synthetic bytes (a PNG signature and a counter), written as an object, and with `row` a media row naming it. */
  const object = async (row: boolean) => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n++])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await media.put(sha256, bytes, 'image/png')
    if (row) await addRow(sha256)
    return { sha256, bytes }
  }
  const addRow = (sha256: string) => writer.addMedia(bed, { kind: 'photo', mime: 'image/png', sha256, size: 9 }, null)
  const sweep = (del: boolean, beforeRecheck?: (sha: string) => void | Promise<void>) => {
    fake.requests.length = 0
    return sweepMedia({ store: reader, media, delete: del, now: () => clock.t, beforeRecheck })
  }
  return { clock, fake, media, object, addRow, sweep, writer, reader }
}

/** 3 named objects and 2 orphans, written 2 hours ago. */
async function bucket() {
  const s = await setup()
  for (const row of [true, true, true, false, false]) await s.object(row)
  s.clock.t = NOV3_10
  return s
}

describe('media:sweep', () => {
  it('[server/storage] Orphaned objects swept: Dry run', async () => {
    const s = await bucket()
    const r = await s.sweep(false)
    assert.equal(r.line, 'orphans 2 of 5')
    assert.equal(s.fake.objects.size, 5)
    assert.deepEqual(
      s.fake.requests.map((q) => q.method),
      ['GET'],
    )
  })

  it('[server/storage] Orphaned objects swept: Delete', async () => {
    const s = await bucket()
    const r = await s.sweep(true)
    assert.equal(r.line, 'deleted 2 of 5')
    assert.equal(s.fake.objects.size, 3)
    for (const k of s.fake.objects.keys()) assert.ok(await s.reader.hasMediaSha(k.slice(3)))
    assert.equal(s.fake.count('HEAD'), 2)
    assert.equal(s.fake.count('DELETE'), 2)
  })

  it('[server/storage] Orphaned objects swept: Recent object kept', async () => {
    const s = await setup()
    s.clock.t = NOV3_10 - 5 * MIN
    await s.object(false)
    s.clock.t = NOV3_10
    const r = await s.sweep(true)
    assert.equal(r.line, 'deleted 0 of 1')
    assert.equal(s.fake.objects.size, 1)
    assert.equal(s.fake.count('DELETE'), 0)
  })

  it('[server/storage] Orphaned objects swept: Re-uploaded during the sweep: not deleted', async () => {
    const s = await setup()
    const o = await s.object(false)
    s.clock.t = NOV3_10
    // Between the listing and the re-check, the same bytes are uploaded again: the object is rewritten, a row names it.
    const r = await s.sweep(true, async (sha) => {
      await s.media.put(sha, o.bytes, 'image/png')
      await s.addRow(sha)
    })
    assert.equal(r.line, 'deleted 0 of 1')
    assert.equal(s.fake.objects.size, 1)
    assert.equal(s.fake.count('DELETE'), 0)

    // Only a row is added: the re-check of the row alone keeps it.
    const t = await setup()
    await t.object(false)
    t.clock.t = NOV3_10
    const second = await t.sweep(true, async (sha) => void (await t.addRow(sha)))
    assert.equal(second.line, 'deleted 0 of 1')
    assert.equal(t.fake.objects.size, 1)
    assert.equal(t.fake.count('DELETE'), 0)

    // Only the object is rewritten (a PUT whose row is not yet in): its new age keeps it.
    const u = await setup()
    const uo = await u.object(false)
    u.clock.t = NOV3_10
    const third = await u.sweep(true, async (sha) => u.media.put(sha, uo.bytes, 'image/png'))
    assert.equal(third.line, 'deleted 0 of 1')
    assert.equal(u.fake.count('DELETE'), 0)
  })

  it('[server/storage] Orphaned objects swept: the read-only open runs no expiry and writes nothing', async () => {
    const h = await testDb()
    const writer = await openPgStore(h.db, { now: () => NOV3_10 })
    const sha256 = 'c'.repeat(64)
    await writer.addMedia((await writer.admissions())[0]!.id, { kind: 'photo', mime: 'image/png', sha256, size: 1 }, null)
    // 30 h later an unlinked row would expire on a store open; the sweep's reader keeps it and has no write at all.
    const ro = mediaShas(h.db)
    assert.equal(await ro.hasMediaSha(sha256), true)
    assert.deepEqual(Object.keys(ro), ['hasMediaSha'])
    const rows = await h.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM meniscus.media')
    assert.equal(rows.rows[0]!.n, 1)
    // A database without the chart's tables is refused, never created.
    await h.db.execute(sql`DROP SCHEMA meniscus CASCADE`)
    await assert.rejects(mediaShas(h.db).hasMediaSha(sha256))
  })

  it('[server/storage] Orphaned objects swept: a failed HEAD is counted and left for the next run', async () => {
    const s = await bucket()
    s.fake.intercept = (_req, r) => (r.method === 'HEAD' ? new Response(null, { status: 503 }) : undefined)
    const r = await s.sweep(true)
    assert.equal(r.line, 'deleted 0 of 5 (2 failed)')
    assert.equal(s.fake.count('HEAD'), 2)
    assert.equal(s.fake.count('DELETE'), 0)
  })
})
