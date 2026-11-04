import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { mediaStoreContract } from './contract.ts'
import { createFakeS3, FAKE_S3 } from './fake-s3.ts'
import { createMemoryMediaStore } from './memory.ts'
import { MediaStoreError, readAll } from './port.ts'
import { createS3MediaStore } from './s3.ts'
import postgres from 'postgres'
import { createDb, migrateDb } from '../../db/client.ts'
import { testStore } from '../../testing.ts'
import { openPgStore } from '../pg/store.ts'

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])

const overFake = (fake = createFakeS3(), o: { forcePathStyle?: boolean; timeoutSignal?: (ms: number) => AbortSignal } = {}) => ({
  fake,
  media: createS3MediaStore({ ...FAKE_S3, forcePathStyle: o.forcePathStyle ?? true, fetch: fake.fetch, timeoutSignal: o.timeoutSignal }),
})

mediaStoreContract('memory', () => createMemoryMediaStore())
mediaStoreContract('s3 over the fake S3', () => overFake().media)
mediaStoreContract('s3 against S3_TEST_ENDPOINT', () => {
  const e = process.env
  if (!e.S3_TEST_ENDPOINT) return undefined
  return createS3MediaStore({
    endpoint: e.S3_TEST_ENDPOINT,
    region: e.S3_TEST_REGION ?? 'local',
    bucket: e.S3_TEST_BUCKET ?? 'meniscus-media',
    accessKeyId: e.S3_TEST_ACCESS_KEY_ID ?? '',
    secretAccessKey: e.S3_TEST_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: true,
  })
})

describe('s3 media store', () => {
  it('signs a path-style PUT with the payload hash and no SSE or Content-MD5 header: one request', async () => {
    const { fake, media } = overFake()
    await media.put(sha(png), png, 'image/png')
    assert.equal(fake.requests.length, 1)
    const r = fake.requests[0]!
    assert.equal(r.key, `${sha(png).slice(0, 2)}/${sha(png)}`)
    assert.equal(r.headers.get('x-amz-content-sha256'), sha(png))
    assert.match(r.headers.get('authorization')!, /^AWS4-HMAC-SHA256 Credential=ak-test-77bb\/\d{8}\/local\/s3\/aws4_request, /)
    for (const h of r.headers.keys()) assert.ok(!/server-side-encryption|content-md5/i.test(h), h)
    assert.deepEqual(fake.objects.get(r.key ?? '')?.bytes, png)
  })

  it('a wrong secret is refused by the fake (it checks signatures)', async () => {
    const fake = createFakeS3()
    const media = createS3MediaStore({ ...FAKE_S3, secretAccessKey: 'other', forcePathStyle: true, fetch: fake.fetch })
    await assert.rejects(media.put(sha(png), png, 'image/png'), (e: unknown) => e instanceof MediaStoreError && e.status === 403)
  })

  for (const status of [503, 429, 500, 403]) {
    it(`a ${status} makes exactly 1 request and throws MediaStoreError (no retry)`, async () => {
      const { fake, media } = overFake()
      fake.intercept = () => new Response('<Error/>', { status })
      for (const [op, run] of [
        ['put', () => media.put(sha(png), png, 'image/png')],
        ['get', () => media.get(sha(png))],
        ['delete', () => media.delete(sha(png))],
        ['head', () => media.head(sha(png))],
        ['head-bucket', () => media.check()],
      ] as const) {
        const before = fake.requests.length
        await assert.rejects(run(), (e: unknown) => e instanceof MediaStoreError && e.op === op && e.status === status)
        assert.equal(fake.requests.length - before, 1, op)
      }
    })
  }

  it('no answer within the timeout: one request, then MediaStoreError timeout', async () => {
    const timer = new AbortController()
    let asked = 0
    const { fake, media } = overFake(createFakeS3(), {
      timeoutSignal: (ms) => {
        asked = ms
        return timer.signal
      },
    })
    fake.intercept = () => new Promise<Response>(() => {})
    const put = media.put(sha(png), png, 'image/png')
    await new Promise((r) => setTimeout(r, 10))
    timer.abort(new DOMException('timed out', 'TimeoutError'))
    await assert.rejects(put, (e: unknown) => e instanceof MediaStoreError && e.status === 'timeout')
    assert.equal(asked, 10_000)
    assert.equal(fake.requests.length, 1)
  })

  it('an unreachable endpoint is a network error after one attempt', async () => {
    let n = 0
    const media = createS3MediaStore({
      ...FAKE_S3,
      forcePathStyle: true,
      fetch: () => {
        n++
        return Promise.reject(new TypeError('fetch failed https://s3.test/storage/v1/s3/meniscus-media'))
      },
    })
    await assert.rejects(
      media.check(),
      (e: unknown) => e instanceof MediaStoreError && e.status === 'network' && !e.message.includes('s3.test'),
    )
    assert.equal(n, 1)
  })

  it('head of an absent key resolves undefined; HeadBucket of a missing bucket is 404', async () => {
    const fake = createFakeS3({ bucket: 'other' })
    const media = createS3MediaStore({ ...FAKE_S3, forcePathStyle: true, fetch: fake.fetch })
    await assert.rejects(media.check(), (e: unknown) => e instanceof MediaStoreError && e.status === 404)
    assert.equal(await overFake().media.head(sha(png)), undefined)
  })

  it('lists every page of the bucket', async () => {
    const { fake, media } = overFake(createFakeS3({ pageSize: 2 }))
    const shas: string[] = []
    for (let i = 0; i < 5; i++) {
      const b = new Uint8Array([...png, i])
      shas.push(sha(b))
      await media.put(sha(b), b, 'image/png')
    }
    fake.objects.set('not-ours.txt', { bytes: png, mime: 'text/plain', lastModified: Date.now() })
    const listed: string[] = []
    for await (const o of media.list()) listed.push(o.sha256)
    assert.deepEqual(listed.sort(), shas.sort())
    assert.equal(fake.requests.filter((r) => r.key === null).length, 3)
  })

  it('stops listing when the continuation token repeats', async () => {
    const page = (n: number) =>
      `<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>same</NextContinuationToken><Contents><Key>${sha(new Uint8Array([n])).slice(0, 2)}/${sha(new Uint8Array([n]))}</Key><LastModified>2026-11-03T10:00:00.000Z</LastModified></Contents></ListBucketResult>`
    let n = 0
    const media = createS3MediaStore({
      ...FAKE_S3,
      forcePathStyle: true,
      fetch: () => Promise.resolve(new Response(page(n++), { status: 200 })),
    })
    const listed: string[] = []
    for await (const o of media.list()) listed.push(o.sha256)
    // The first page, then the page its token names; that page names the same token again, so listing stops.
    assert.equal(n, 2)
    assert.equal(listed.length, 2)
  })

  it('streams a GET with its size', async () => {
    const { media } = overFake()
    await media.put(sha(png), png, 'image/png')
    const obj = await media.get(sha(png))
    assert.equal(obj.size, png.byteLength)
    assert.deepEqual(await readAll(obj), png)
  })

  it('virtual-hosted style puts the bucket in the host', async () => {
    const seen: string[] = []
    const media = createS3MediaStore({
      ...FAKE_S3,
      forcePathStyle: false,
      fetch: (req) => (seen.push(req.url), Promise.resolve(new Response(null, { status: 200 }))),
    })
    await media.check()
    assert.deepEqual(seen, ['https://meniscus-media.s3.test/storage/v1/s3/'])
  })
})

// The per-hash lock is the store's (`Store.withShaLock`, an advisory lock in Postgres). PGlite has one connection, so
// two locks on different hashes run in parallel only on a real Postgres: that test is opt-in (PG_TEST_URL, database
// meniscus_test); store/pg/store.test.ts asserts the lock SQL on every run.
describe('sha lock', () => {
  const deferred = () => {
    let resolve!: () => void
    const p = new Promise<void>((r) => (resolve = r))
    return { p, resolve }
  }

  it('two callers on one hash run in order', async () => {
    const store = await testStore()
    const order: string[] = []
    const gate = deferred()
    const a = store.withShaLock('aa', async () => {
      order.push('a start')
      await gate.p
      order.push('a end')
    })
    const b = store.withShaLock('aa', () => Promise.resolve(void order.push('b')))
    await new Promise((r) => setTimeout(r, 5))
    assert.deepEqual(order, ['a start'])
    gate.resolve()
    await Promise.all([a, b])
    assert.deepEqual(order, ['a start', 'a end', 'b'])
  })

  const PG = process.env.PG_TEST_URL
  it('different hashes run in parallel', { skip: PG ? false : 'PG_TEST_URL unset' }, async () => {
    const admin = postgres(PG!, { max: 1, onnotice: () => {} })
    // Opt-in runs share database meniscus_test: one test file at a time (a session lock, released with the client).
    await admin`SELECT pg_advisory_lock(1296978755, 2)`
    await admin.unsafe('DROP DATABASE IF EXISTS meniscus_test WITH (FORCE)')
    await admin.unsafe('CREATE DATABASE meniscus_test')
    const url = new URL(PG!)
    url.pathname = '/meniscus_test'
    const h = createDb({ url: url.toString(), max: 2 })
    try {
      await migrateDb({ url: url.toString() })
      const store = await openPgStore(h.db)
      const gate = deferred()
      const order: string[] = []
      const a = store.withShaLock('aa', async () => {
        await gate.p
        order.push('a')
      })
      await store.withShaLock('bb', () => Promise.resolve(void order.push('b')))
      assert.deepEqual(order, ['b'])
      gate.resolve()
      await a
    } finally {
      await h.close()
      await admin.unsafe('DROP DATABASE IF EXISTS meniscus_test WITH (FORCE)')
      await admin.end()
    }
  })

  it('a failure does not block the next caller', async () => {
    const store = await testStore()
    await assert.rejects(store.withShaLock('cc', () => Promise.reject(new Error('x'))))
    assert.equal(await store.withShaLock('cc', () => Promise.resolve(1)), 1)
  })
})
