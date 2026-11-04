/**
 * Media in the object store (charting/media), through the real S3 adapter over the in-process fake S3: what the bucket
 * holds, how many store requests each route makes, and what is logged. No network, no model request.
 */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it, type TestContext } from 'node:test'
import type { Entry, MediaRef } from '@meniscus/shared'
import { createFakeS3, FAKE_S3 } from './store/media/fake-s3.ts'
import { objectKey } from './store/media/port.ts'
import { createS3MediaStore } from './store/media/s3.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { testApp, testDb, upstream } from './testing.ts'

const HOUR = 3_600_000
/** 2 Nov 2026, 09:00 UTC; demo patients are admitted two days earlier. */
const NOV2_9 = Date.UTC(2026, 10, 2, 9)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Synthetic media: a file signature plus random filler (no real image or voice), `n` bytes long. */
const synthetic = (signature: number[], n: number) => {
  const b = new Uint8Array(n)
  b.set(randomBytes(n), 0)
  b.set(signature, 0)
  return b
}
const JPEG_SIG = [0xff, 0xd8, 0xff, 0xe0]
const WEBM_SIG = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0, 0, 0]
const wav = (n: number) => {
  const b = synthetic([], n)
  b.set(new TextEncoder().encode('RIFF'), 0)
  new DataView(b.buffer).setUint32(4, n - 8, true)
  b.set(new TextEncoder().encode('WAVEfmt '), 8)
  return b
}

interface Options {
  /** The S3 adapter's timeout signal (default: one the test never aborts). */
  timeoutSignal?: (ms: number) => AbortSignal
}

/** The app over a store on a fresh test database (`h`, for tests that look at the database itself). */
async function setup(o: Options = {}) {
  const clock = { t: NOV2_9 - 48 * HOUR }
  const h = await testDb()
  const store: Store = await openPgStore(h.db, { now: () => clock.t })
  clock.t = NOV2_9
  const fake = createFakeS3({ now: () => clock.t })
  const media = createS3MediaStore({
    ...FAKE_S3,
    forcePathStyle: true,
    fetch: fake.fetch,
    timeoutSignal: o.timeoutSignal ?? (() => new AbortController().signal),
  })
  const logs: string[] = []
  const u = upstream()
  const t = await testApp({ ai: u.ai, store, media, mediaLog: (l) => logs.push(l) })
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const upload = async (admissionId: number, bytes: Uint8Array, kind = 'photo') => {
    const form = new FormData()
    form.set('file', new File([bytes], 'upload', { type: kind === 'voice' ? 'audio/webm' : 'image/jpeg' }))
    form.set('kind', kind)
    const res = await t.request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form })
    return { status: res.status, text: await res.text() }
  }
  const ref = (r: { text: string }) => JSON.parse(r.text) as MediaRef & { error?: string }
  const json = async <T>(path: string, body: unknown) => {
    const res = await t.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const photoEntry = (admissionId: number, mediaId: number) =>
    json<Entry>(`/api/admissions/${admissionId}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 300,
      source: 'photo',
      media_id: mediaId,
    })
  const reject = (entryId: number) => json<Entry>(`/api/entries/${entryId}/review`, { action: 'reject', reason: 'duplicate' })
  const get = (path: string) => t.request(path)
  return { clock, store, fake, media, logs, u, t, h, bed, upload, ref, json, photoEntry, reject, get }
}

/** Media rows as the store serves them, by probing ids 1–50. */
const countMedia = async (store: Store) =>
  (await Promise.all(Array.from({ length: 50 }, (_, i) => store.media(i + 1)))).filter(Boolean).length

const deferred = () => {
  let resolve!: () => void
  const p = new Promise<void>((r) => (resolve = r))
  return { p, resolve }
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 5))
  assert.ok(cond(), 'condition not reached')
}

describe('media kept in an object store', () => {
  it('[charting/media] Media kept in an object store: Photo stored as an object', async () => {
    const s = await setup()
    const photo = synthetic(JPEG_SIG, 48_213)
    const b4 = await s.bed('3A', '4')
    const up = await s.upload(b4, photo)
    assert.equal(up.status, 201)
    const m = s.ref(up)
    assert.equal(m.sha256, sha(photo))
    assert.equal((await s.photoEntry(b4, m.id)).status, 201)
    assert.deepEqual(s.fake.objects.get(objectKey(m.sha256))?.bytes, photo)
    const res = await s.get(`/api/media/${m.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), photo)
    await s.store.close()
    // The whole database (its data directory, uncompressed) holds none of the bytes.
    const middle = Buffer.from(photo.subarray(24_000, 24_064))
    const dataDir = Buffer.from(await (await s.h.pg.dumpDataDir('none')).arrayBuffer())
    assert.equal(dataDir.indexOf(middle), -1)
    assert.deepEqual(s.u.requests, [])
    const cols = (
      await s.h.pg.query<{ name: string; nullable: string }>(
        `SELECT column_name AS name, is_nullable AS nullable FROM information_schema.columns
         WHERE table_schema = 'meniscus' AND table_name = 'media'`,
      )
    ).rows.map((c) => [c.name, c.nullable === 'NO' ? 1 : 0])
    assert.ok(!cols.some(([n]) => n === 'bytes'))
    assert.deepEqual(
      cols.find(([n]) => n === 'sha256'),
      ['sha256', 1],
    )
    // No column anywhere in the schema can hold bytes.
    const bytea = await s.h.pg.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'meniscus' AND data_type = 'bytea'",
    )
    assert.deepEqual(bytea.rows, [])
  })

  it('[charting/media] Media kept in an object store: Same bytes for two beds', async () => {
    const s = await setup()
    const photo = synthetic(JPEG_SIG, 2_000)
    const a = s.ref(await s.upload(await s.bed('3A', '4'), photo))
    const b = s.ref(await s.upload(await s.bed('3A', '5'), photo))
    assert.notEqual(a.id, b.id)
    assert.equal(a.sha256, b.sha256)
    assert.equal(s.fake.objects.size, 1)
  })

  it('[charting/media] Media kept in an object store: Refused upload writes nothing', async () => {
    const s = await setup()
    const r = await s.upload(await s.bed('3A', '4'), new TextEncoder().encode('hello'))
    assert.equal(r.status, 400)
    assert.equal(s.ref(r).error, 'invalid_request')
    assert.equal(s.fake.requests.length, 0)
    assert.equal(s.fake.objects.size, 0)
  })

  it('[charting/media] Media kept in an object store: Refused by the chart before the PUT', async () => {
    const s = await setup()
    const b4 = await s.bed('3A', '4')
    const entry = await s.json<Entry>(`/api/admissions/${b4}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 300,
      source: 'photo',
    })
    const form = (bytes: Uint8Array) => {
      const f = new FormData()
      f.set('image', new File([bytes], 'a.jpg', { type: 'image/jpeg' }))
      return f
    }
    assert.equal(
      (await s.t.request(`/api/entries/${entry.body.id}/photo`, { method: 'POST', body: form(synthetic(JPEG_SIG, 500)) })).status,
      201,
    )
    const before = s.fake.requests.length
    const keys = [...s.fake.objects.keys()]
    const unknown = await s.upload(9999, synthetic(JPEG_SIG, 600))
    const again = await s.t.request(`/api/entries/${entry.body.id}/photo`, { method: 'POST', body: form(synthetic(JPEG_SIG, 700)) })
    assert.deepEqual([unknown.status, s.ref(unknown).error], [404, 'not_found'])
    assert.deepEqual([again.status, ((await again.json()) as { error: string }).error], [409, 'photo_exists'])
    assert.equal(s.fake.requests.length - before, 0)
    assert.deepEqual([...s.fake.objects.keys()], keys)
  })
})

describe('serve media from the object store', () => {
  it('[charting/media] Serve media: Recording served', async () => {
    const s = await setup()
    const rec = synthetic(WEBM_SIG, 5_000)
    const m = s.ref(await s.upload(await s.bed('3A', '4'), rec, 'voice'))
    const before = s.fake.requests.length
    const res = await s.get(`/api/media/${m.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'audio/webm')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(res.headers.get('content-length'), String(m.size))
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), rec)
    assert.equal(s.fake.requests.length - before, 1)
  })

  it('[charting/media] Serve media: No such media', async () => {
    const s = await setup()
    const res = await s.get('/api/media/9999')
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'not_found')
    assert.equal(s.fake.requests.length, 0)
  })

  it('[charting/media] Serve media: Large recording served', async () => {
    const s = await setup()
    const rec = wav(24_000_044)
    const up = await s.upload(await s.bed('3A', '4'), rec, 'voice')
    assert.equal(up.status, 201, up.text)
    const m = s.ref(up)
    const res = await s.get(`/api/media/${m.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'audio/wav')
    assert.equal(res.headers.get('content-length'), '24000044')
    assert.equal(sha(new Uint8Array(await res.arrayBuffer())), m.sha256)
  })
})

describe('objects go with their last media row', () => {
  it('[charting/media] Objects go with their last media row: Last reference', async () => {
    const s = await setup()
    const b4 = await s.bed('3A', '4')
    const m = s.ref(await s.upload(b4, synthetic(JPEG_SIG, 900)))
    const e = await s.photoEntry(b4, m.id)
    assert.equal((await s.reject(e.body.id)).status, 200)
    assert.equal((await s.get(`/api/media/${m.id}`)).status, 404)
    assert.equal(s.fake.objects.has(objectKey(m.sha256!)), false)
    assert.equal(s.fake.count('DELETE'), 1)
  })

  it('[charting/media] Objects go with their last media row: Shared content', async () => {
    const s = await setup()
    const photo = synthetic(JPEG_SIG, 900)
    const [b4, b5] = [await s.bed('3A', '4'), await s.bed('3A', '5')]
    const m4 = s.ref(await s.upload(b4, photo))
    const m5 = s.ref(await s.upload(b5, photo))
    const e4 = await s.photoEntry(b4, m4.id)
    assert.equal((await s.photoEntry(b5, m5.id)).status, 201)
    assert.equal((await s.reject(e4.body.id)).status, 200)
    const res = await s.get(`/api/media/${m5.id}`)
    assert.equal(res.status, 200)
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), photo)
    assert.equal(s.fake.objects.has(objectKey(m5.sha256!)), true)
    assert.equal(s.fake.count('DELETE'), 0)
  })

  it('[charting/media] Objects go with their last media row: Expired upload', async () => {
    const s = await setup()
    const b1 = await s.bed('3A', '1')
    const first = s.ref(await s.upload(b1, synthetic(JPEG_SIG, 800)))
    s.clock.t = NOV2_9 + 24 * HOUR + 60_000
    const second = await s.upload(b1, synthetic(JPEG_SIG, 801))
    assert.equal(second.status, 201)
    assert.equal(s.fake.objects.has(objectKey(first.sha256!)), false)
    assert.equal(s.fake.objects.has(objectKey(s.ref(second).sha256!)), true)
  })

  it('[charting/media] Objects go with their last media row: Same bytes uploaded during a delete', async () => {
    const s = await setup()
    const photo = synthetic(JPEG_SIG, 1_200)
    const [b4, b5] = [await s.bed('3A', '4'), await s.bed('3A', '5')]
    const m4 = s.ref(await s.upload(b4, photo))
    const e4 = await s.photoEntry(b4, m4.id)
    // The second upload's PUT is still being written while the reject commits and tries to delete the object.
    const gate = deferred()
    s.fake.intercept = (_req, r) => (r.method === 'PUT' ? gate.p.then(() => undefined) : undefined)
    const upload = s.upload(b5, photo)
    await until(() => s.fake.count('PUT') === 2)
    const rejected = s.reject(e4.body.id)
    await new Promise((r) => setTimeout(r, 20))
    gate.resolve()
    const [up, rej] = await Promise.all([upload, rejected])
    assert.equal(rej.status, 200)
    assert.equal(up.status, 201)
    const res = await s.get(`/api/media/${s.ref(up).id}`)
    assert.equal(res.status, 200)
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), photo)
    assert.equal(s.fake.objects.has(objectKey(sha(photo))), true)
  })

  it('[charting/media] Objects go with their last media row: expiry on open reports the hashes once', async () => {
    const h = await testDb()
    const clock = { t: NOV2_9 - 48 * HOUR }
    const first = await openPgStore(h.db, { now: () => clock.t })
    clock.t = NOV2_9
    const b1 = (await first.admissions())[0]!.id
    const a = 'a'.repeat(64)
    await first.addMedia(b1, { kind: 'photo', mime: 'image/jpeg', sha256: a, size: 10 }, null)
    await first.addMedia(b1, { kind: 'photo', mime: 'image/jpeg', sha256: a, size: 10 }, null)
    await first.close()
    const seen: string[][] = []
    await (await openPgStore(h.db, { now: () => NOV2_9 + 25 * HOUR, onMediaGone: (shas) => seen.push(shas) })).close()
    assert.deepEqual(seen, [[a]])
  })
})

describe('media store unavailable', () => {
  for (const status of [503, 429]) {
    it(`[charting/media] Media store unavailable: Upload while the store is down (${status})`, async () => {
      const s = await setup()
      s.fake.intercept = () => new Response('<Error/>', { status })
      const r = await s.upload(await s.bed('3A', '4'), synthetic(JPEG_SIG, 900))
      assert.equal(r.status, 503)
      assert.equal(r.text, '{"error":"media_unavailable"}')
      assert.equal(await countMedia(s.store), 0)
      assert.deepEqual(
        s.fake.requests.map((q) => q.method),
        ['PUT'],
      )
    })
  }

  it('[charting/media] Media store unavailable: Store does not answer', async () => {
    const timer = new AbortController()
    const s = await setup({ timeoutSignal: () => timer.signal })
    s.fake.intercept = () => new Promise<Response>(() => {})
    const pending = s.upload(await s.bed('3A', '4'), synthetic(WEBM_SIG, 3_000), 'voice')
    await until(() => s.fake.requests.length === 1)
    timer.abort(new DOMException('timed out', 'TimeoutError'))
    const r = await pending
    assert.equal(r.status, 503)
    assert.equal(s.ref(r).error, 'media_unavailable')
    assert.equal(s.fake.requests.length, 1)
    assert.equal(s.fake.requests[0]!.method, 'PUT')
    assert.equal(await countMedia(s.store), 0)
  })

  it('[charting/media] Media store unavailable: Read while the store is down', async () => {
    const s = await setup()
    const m = s.ref(await s.upload(await s.bed('3A', '4'), synthetic(JPEG_SIG, 900)))
    s.fake.requests.length = 0
    s.fake.intercept = () => new Response('<Error/>', { status: 500 })
    const res = await s.get(`/api/media/${m.id}`)
    assert.equal(res.status, 503)
    assert.equal(((await res.json()) as { error: string }).error, 'media_unavailable')
    assert.deepEqual(
      s.fake.requests.map((q) => q.method),
      ['GET'],
    )
  })

  it('[charting/media] Media store unavailable: Delete fails', async () => {
    const s = await setup()
    const b4 = await s.bed('3A', '4')
    const m = s.ref(await s.upload(b4, synthetic(JPEG_SIG, 900)))
    const e = await s.photoEntry(b4, m.id)
    s.fake.intercept = (_req, r) => (r.method === 'DELETE' ? new Response('<Error/>', { status: 503 }) : undefined)
    const r = await s.reject(e.body.id)
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'rejected')
    assert.equal((await s.get(`/api/media/${m.id}`)).status, 404)
    assert.equal(s.fake.count('DELETE'), 1)
    assert.equal(s.fake.objects.has(objectKey(m.sha256!)), true)
    assert.ok(
      s.logs.some((l) => /^media delete 503 \d+ms$/.test(l)),
      s.logs.join('\n'),
    )
  })

  it('[charting/media] Media store unavailable: an entry photo or its read while the store is down is 503', async () => {
    const s = await setup()
    const b4 = await s.bed('3A', '4')
    const entry = await s.json<Entry>(`/api/admissions/${b4}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 300,
      source: 'photo',
    })
    const f = new FormData()
    f.set('image', new File([synthetic(JPEG_SIG, 500)], 'a.jpg', { type: 'image/jpeg' }))
    assert.equal((await s.t.request(`/api/entries/${entry.body.id}/photo`, { method: 'POST', body: f })).status, 201)
    s.fake.intercept = () => new Response('<Error/>', { status: 500 })
    const res = await s.get(`/api/entries/${entry.body.id}/photo`)
    assert.equal(res.status, 503)
    assert.equal(await res.text(), '{"error":"media_unavailable"}')
  })
})

describe('media store logs', () => {
  it('[charting/media] Media store logs nothing identifying: Refused write logged', async (t: TestContext) => {
    const printed: string[] = []
    for (const m of ['log', 'error', 'warn', 'info'] as const) {
      t.mock.method(console, m, (...a: unknown[]) => void printed.push(a.map(String).join(' ')))
    }
    const s = await setup()
    const photo = synthetic(JPEG_SIG, 900)
    s.fake.intercept = () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    const r = await s.upload(await s.bed('3A', '4'), photo)
    assert.equal(r.status, 503)
    const lines = [...s.logs, ...printed]
    assert.ok(
      lines.some((l) => l.includes('media put 403')),
      lines.join('\n'),
    )
    for (const secret of ['sk-test-55aa', 'ak-test-77bb', 'Signature=', sha(photo)]) {
      assert.ok(!lines.some((l) => l.includes(secret)), secret)
    }
  })

  it('[server/storage] Storage secrets never revealed: Storage request refused', async (t: TestContext) => {
    const printed: string[] = []
    for (const m of ['log', 'error', 'warn', 'info', 'debug'] as const) {
      t.mock.method(console, m, (...a: unknown[]) => void printed.push(a.map(String).join(' ')))
    }
    // The chart on the Postgres test database, the media store the real S3 adapter with sk-test-55aa.
    const s = await setup()
    assert.equal(FAKE_S3.secretAccessKey, 'sk-test-55aa')
    s.fake.intercept = () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 })
    const r = await s.upload(await s.bed('3A', '4'), synthetic(JPEG_SIG, 900))
    assert.equal(r.status, 503)
    assert.equal(r.text, '{"error":"media_unavailable"}')
    const lines = [...s.logs, ...printed]
    assert.ok(lines.length > 0, 'the refusal is logged')
    for (const secret of [FAKE_S3.secretAccessKey, FAKE_S3.accessKeyId]) {
      assert.ok(!lines.some((l) => l.includes(secret)) && !r.text.includes(secret), secret)
    }
  })
})
