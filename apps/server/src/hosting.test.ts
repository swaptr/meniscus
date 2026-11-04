import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { testApp, testStore, upstream } from './testing.ts'

const FOUR = ['x-content-type-options', 'referrer-policy', 'x-frame-options', 'cross-origin-resource-policy'] as const
const assertFour = (res: Response, what: string) => {
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff', what)
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer', what)
  assert.equal(res.headers.get('x-frame-options'), 'DENY', what)
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin', what)
}

/** The store behind a spy: every method call after `arm()` is recorded, and with `fail` it throws instead. */
async function spyStore(fail = false) {
  const real = await testStore()
  const calls: string[] = []
  let armed = false
  const store = new Proxy(real, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver) as unknown
      if (typeof v !== 'function' || !armed) return typeof v === 'function' ? v.bind(target) : v
      return (...args: unknown[]) => {
        calls.push(String(key))
        if (fail) throw new Error('store unavailable')
        return (v as (...a: unknown[]) => unknown).apply(target, args)
      }
    },
  })
  return { store, calls, arm: () => void (armed = true) }
}

describe('health check', () => {
  it('[server/hosting] Health check: Healthy server', async () => {
    const u = upstream()
    const spy = await spyStore()
    const { request } = await testApp({ ai: u.ai, statusClient: () => u.client, store: spy.store })
    spy.arm()
    const res = await request('/api/health', {}, { cookie: null })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"ok":true}')
    assert.deepEqual(spy.calls, [])
    assert.deepEqual(u.requests, [])
    // The spy does see a read that uses the store.
    await request('/api/wards')
    assert.ok(spy.calls.length > 0)
  })

  it('[server/hosting] Health check: Store unavailable', async () => {
    const spy = await spyStore(true)
    const { request } = await testApp({ store: spy.store })
    spy.arm()
    const res = await request('/api/health', {}, { cookie: null })
    assert.equal(res.status, 200)
    assert.equal(await res.text(), '{"ok":true}')
  })
})

describe('security headers', () => {
  it('[server/security] Security headers: Health and AI responses', async () => {
    const u = upstream()
    const { request } = await testApp({ ai: u.ai })
    const health = await request('/api/health')
    // Rejected: a blank note fails validation before any model request.
    const ai = await request('/api/ai/note', {
      method: 'POST',
      body: JSON.stringify({ text: '' }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(ai.status, 400)
    for (const [res, what] of [
      [health, 'health'],
      [ai, 'ai'],
    ] as const)
      assertFour(res, what)
    assert.equal(health.headers.get('cache-control'), null)
    assert.equal(ai.headers.get('cache-control'), 'no-store')
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Security headers: Patient data is not cached', async () => {
    const { request } = await testApp()
    const res = await request('/api/admissions', {}, { staff: 4 })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.ok(FOUR.every((h) => res.headers.has(h)))
  })
})

/** A web build fixture: what `vite build` writes, in miniature. */
function webBuild() {
  const dir = mkdtempSync(join(tmpdir(), 'meniscus-web-'))
  mkdirSync(join(dir, 'assets'))
  const files = {
    'index.html': '<!doctype html><title>Meniscus</title><div id="root"></div>',
    'sw.js': 'self.addEventListener("fetch", () => {})',
    'manifest.webmanifest': '{"name":"Meniscus"}',
    'assets/index-BQlYVns6.js': 'console.log("meniscus")',
  }
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body)
  return { dir, files }
}

describe('web build', () => {
  const build = webBuild()
  after(() => rmSync(build.dir, { recursive: true, force: true }))
  const web = async () => {
    const u = upstream()
    const t = await testApp({ ai: u.ai, statusClient: () => u.client, webDist: build.dir })
    return { ...t, u }
  }
  const INDEX = build.files['index.html']
  const typeOf = (res: Response) => res.headers.get('content-type') ?? ''

  it('[server/hosting] Web build served: Index and an asset', async () => {
    const { request, u } = await web()
    for (const [path, body, type] of [
      ['/', INDEX, 'text/html'],
      ['/sw.js', build.files['sw.js'], 'text/javascript'],
      ['/assets/index-BQlYVns6.js', build.files['assets/index-BQlYVns6.js'], 'text/javascript'],
    ] as const) {
      const res = await request(path, {}, { cookie: null })
      assert.equal(res.status, 200, path)
      assert.ok(typeOf(res).startsWith(type), `${path}: ${typeOf(res)}`)
      assert.equal(await res.text(), body, path)
    }
    const head = await request('/sw.js', { method: 'HEAD' }, { cookie: null })
    assert.equal(head.status, 200)
    assert.deepEqual(u.requests, [])
  })

  it('[server/hosting] Web build served: Outside the build', async () => {
    const { request } = await web()
    // The repository's package.json, which a path that left the build would reach.
    assert.ok(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8').includes('packageManager'))
    for (const path of [
      '/..%2Fpackage.json',
      '/assets/../../package.json',
      '/..%2F..%2F..%2Fpackage.json',
      '/assets/..%2F..%2Fpackage.json',
    ]) {
      const res = await request(path, {}, { cookie: null })
      const text = await res.text()
      assert.ok(!text.includes('packageManager'), path)
    }
  })

  it('[server/hosting] Web app routes fall back to index.html: Bed link and ward dashboard', async () => {
    const { request, u } = await web()
    for (const path of ['/a/bed/abc_DEF-123', '/n/w/2']) {
      const res = await request(path, {}, { cookie: null })
      assert.equal(res.status, 200, path)
      assert.ok(typeOf(res).startsWith('text/html'), path)
      assert.equal(await res.text(), INDEX, path)
    }
    assert.deepEqual(u.requests, [])
  })

  it('[server/hosting] Web app routes fall back to index.html: Missing asset', async () => {
    const { request } = await web()
    const res = await request('/assets/gone-1234abcd.js', {}, { cookie: null })
    assert.equal(res.status, 404)
    assert.notEqual(await res.text(), INDEX)
  })

  it('[server/hosting] Web cache headers: Hashed and unhashed', async () => {
    const { request } = await web()
    const cache = async (path: string) => (await request(path, {}, { cookie: null })).headers.get('cache-control')
    assert.equal(await cache('/assets/index-BQlYVns6.js'), 'public, max-age=31536000, immutable')
    for (const path of ['/', '/n/w/2', '/sw.js', '/manifest.webmanifest']) assert.equal(await cache(path), 'no-cache', path)
  })

  it('[server/hosting] API paths are never the web app: Unknown API path', async () => {
    const { request, u } = await web()
    const out = await request('/api/nope', {}, { cookie: null })
    assert.equal(out.status, 401)
    assert.equal(((await out.json()) as { error: string }).error, 'sign_in_required')
    const ravi = await request('/api/nope', {}, { staff: 1 })
    assert.equal(ravi.status, 404)
    assert.equal(await ravi.text(), '{"error":"not_found"}')
    for (const res of [out, ravi]) assert.ok(!typeOf(res).startsWith('text/html'))
    for (const path of ['/api', '/api/']) {
      const res = await request(path, {}, { staff: 1 })
      assert.equal(res.status, 404, path)
      assert.ok(!typeOf(res).startsWith('text/html'), path)
      assert.notEqual(await res.text(), INDEX, path)
    }
    assert.equal((await request('/api', {}, { cookie: null })).status, 401)
    assert.deepEqual(u.requests, [])
  })

  it('[server/hosting] API paths are never the web app: Post to a web path', async () => {
    const { request, u } = await web()
    const res = await request('/n/w/2', { method: 'POST' }, { staff: 4 })
    assert.equal(res.status, 404)
    assert.notEqual(await res.text(), INDEX)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Security headers: Web build', async () => {
    const { request } = await web()
    for (const path of ['/', '/n/w/2']) {
      const res = await request(path, {}, { cookie: null })
      assertFour(res, path)
      assert.notEqual(res.headers.get('cache-control'), 'no-store', path)
    }
  })

  it('[server/hosting] Production needs the web build: without webDist, paths outside /api are 404', async () => {
    const { request } = await testApp()
    assert.equal((await request('/n', {}, { cookie: null })).status, 404)
    assert.equal((await request('/api/health', {}, { cookie: null })).status, 200)
  })
})
