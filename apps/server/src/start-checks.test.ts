/**
 * Bucket checked at start (server/storage), through `startServer` with `startChecks` as its `beforeListen` and the
 * fake S3 behind the injected `fetch`. Nothing is spawned; no model request is sent.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { parseConfig } from './config.ts'
import { startServer } from './serve.ts'
import { startChecks } from './start-checks.ts'
import { createMediaStore } from './store/media/create.ts'
import { createFakeS3, FAKE_S3 } from './store/media/fake-s3.ts'
import { testStore, upstream } from './testing.ts'

const dirs: string[] = []
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'meniscus-start-'))
  dirs.push(d)
  return d
}
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo
      s.close(() => resolve(port))
    })
  })
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host: '127.0.0.1', port })
    s.once('connect', () => (s.destroy(), resolve(false)))
    s.once('error', () => resolve(true))
  })

const LOCAL = 'http://127.0.0.1:54321/storage/v1/s3'
const env = (over: Record<string, string> = {}) => ({
  NODE_ENV: 'development',
  MEDIA_STORE: 's3',
  S3_ENDPOINT: LOCAL,
  S3_REGION: FAKE_S3.region,
  S3_ACCESS_KEY_ID: FAKE_S3.accessKeyId,
  S3_SECRET_ACCESS_KEY: FAKE_S3.secretAccessKey,
  ...over,
})

/** `startServer` over a fresh store, with `startChecks` and a media store whose requests go to `fetch`. */
async function start(e: Record<string, string>, fetch?: (r: Request) => Promise<Response>) {
  const config = parseConfig(e)
  const media = createMediaStore(config, fetch ? { fetch } : {})
  const store = await testStore()
  const port = await freePort()
  const lines: string[] = []
  const started = startServer({
    fetch: () => new Response('ok'),
    store,
    host: '127.0.0.1',
    port,
    graceMs: 100,
    beforeListen: startChecks(config, media, store, [], (l) => lines.push(l)),
  })
  return { started, port, lines, store }
}

describe('bucket checked at start', () => {
  it('[server/storage] Bucket checked at start: Bucket present', async () => {
    const fake = createFakeS3({ endpoint: LOCAL })
    const { started, port } = await start(env(), fake.fetch)
    const running = await started
    try {
      assert.equal(await refused(port), false)
      assert.deepEqual(
        fake.requests.map((r) => [r.method, r.key]),
        [['HEAD', null]],
      )
    } finally {
      await running.shutdown()
    }
  })

  it('[server/storage] Bucket checked at start: Missing bucket', async () => {
    const fake = createFakeS3({ endpoint: LOCAL, bucket: 'other' })
    const { started, port } = await start(env(), fake.fetch)
    await assert.rejects(started, (err: Error) => {
      for (const s of ['meniscus-media', '127.0.0.1:54321', 'not found', 'pnpm dev:s3']) assert.ok(err.message.includes(s), err.message)
      return true
    })
    assert.equal(await refused(port), true)
    assert.equal(fake.requests.length, 1)
  })

  it('[server/storage] Bucket checked at start: Refused keys', async () => {
    const fake = createFakeS3({ endpoint: LOCAL, secretAccessKey: 'another-secret' })
    const { started, port, lines } = await start(env({ S3_SECRET_ACCESS_KEY: 'sk-test-55aa' }), fake.fetch)
    await assert.rejects(started, (err: Error) => {
      assert.ok(err.message.includes('keys refused'), err.message)
      assert.ok(![err.message, err.stack ?? '', ...lines].some((l) => l.includes('sk-test-55aa')))
      return true
    })
    assert.equal(await refused(port), true)
  })

  it('[server/storage] Bucket checked at start: Unreachable endpoint', async () => {
    const u = upstream()
    // A real fetch to a loopback port where nothing listens.
    const { started, port } = await start(env({ S3_ENDPOINT: 'http://127.0.0.1:9/storage/v1/s3' }))
    await assert.rejects(started, (err: Error) => {
      assert.ok(err.message.includes('127.0.0.1:9') && err.message.includes('unreachable'), err.message)
      return true
    })
    assert.equal(await refused(port), true)
    assert.deepEqual(u.requests, [])
  })

  it('[server/storage] Bucket checked at start: production checks the web build first', async () => {
    const https = 'https://abcdefghij.storage.supabase.co/storage/v1/s3'
    const fake = createFakeS3({ endpoint: https })
    const prod = env({ NODE_ENV: 'production', S3_ENDPOINT: https })
    const empty = await start({ ...prod, WEB_DIST: temp() }, fake.fetch)
    await assert.rejects(empty.started, /WEB_DIST/)
    assert.equal(fake.requests.length, 0)

    const built = temp()
    writeFileSync(join(built, 'index.html'), '<!doctype html>')
    const ok = await start({ ...prod, WEB_DIST: built }, fake.fetch)
    const running = await ok.started
    try {
      assert.equal(fake.requests.length, 1)
      assert.ok(!ok.lines.some((l) => l.includes('dev:s3')))
    } finally {
      await running.shutdown()
    }
  })

  it('[server/storage] Media store settings: memory outside test warns that media is lost on restart', async () => {
    const dev = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory' })
    await (await dev.started).shutdown()
    assert.ok(dev.lines.some((l) => l.includes('MEDIA_STORE=memory')))
    const test = await start({ NODE_ENV: 'test' })
    await (await test.started).shutdown()
    assert.deepEqual(test.lines, [])
  })

  it('[server/storage] Bucket checked at start: objects of media expired on open are deleted before listening', async () => {
    const fake = createFakeS3({ endpoint: LOCAL })
    const config = parseConfig(env())
    const media = createMediaStore(config, { fetch: fake.fetch })
    const bytes = new Uint8Array([1])
    const gone = createHash('sha256').update(bytes).digest('hex')
    await media.put(gone, bytes, 'image/png')
    const store = await testStore()
    await startChecks(config, media, store, [gone])()
    assert.equal(fake.objects.size, 0)
    assert.deepEqual(
      fake.requests.map((r) => r.method),
      ['PUT', 'HEAD', 'DELETE'],
    )
    await store.close()
  })
})
