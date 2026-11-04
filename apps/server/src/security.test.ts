import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type AppOptions } from './app.ts'
import { appFlags, parseConfig } from './config.ts'
import { jpeg, testApp, testStore, upstream, type TestRequest, PROD_MEDIA_ENV } from './testing.ts'

type App = { request: TestRequest }
const note = (app: App) =>
  app.request('/api/ai/note', {
    method: 'POST',
    body: JSON.stringify({ text: 'drank tea' }),
    headers: { 'content-type': 'application/json' },
  })
const setup = async (o: Partial<Omit<AppOptions, 'ai'>> = {}) => {
  const u = upstream()
  const { request } = await testApp({ ai: u.ai, ...o })
  return { u, app: { request } }
}

describe('server security', () => {
  it('[server/security] Loopback by default: Default host', () => {
    assert.equal(parseConfig({}).HOST, '127.0.0.1')
    // Empty values (as copied from .env.example) count as unset rather than failing startup.
    assert.equal(parseConfig({ HOST: '', NODE_ENV: 'development' }).HOST, '127.0.0.1')
  })

  it('[server/security] Loopback by default: Default port', () => {
    assert.equal(parseConfig({}).PORT, 8787)
    assert.equal(parseConfig({ PORT: '' }).PORT, 8787)
  })

  it('[server/security] Loopback by default: Hosted', () => {
    const c = parseConfig({ HOST: '0.0.0.0', PORT: '10000' })
    assert.equal(c.HOST, '0.0.0.0')
    assert.equal(c.PORT, 10000)
  })

  it('[server/security] Trusted proxy hops: Bad setting', () => {
    assert.throws(() => parseConfig({ TRUST_PROXY_HOPS: '-1' }), /TRUST_PROXY_HOPS/)
    assert.throws(() => parseConfig({ TRUST_PROXY_HOPS: 'two' }), /TRUST_PROXY_HOPS/)
    assert.throws(() => parseConfig({ TRUST_PROXY_HOPS: '4' }), /TRUST_PROXY_HOPS/)
    assert.equal(parseConfig({}).TRUST_PROXY_HOPS, 0)
    assert.equal(parseConfig({ TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS, 1)
  })

  it('[server/security] Signed-in changes: production starts without a device token, and a leftover one is ignored', () => {
    const c = parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production', MENISCUS_API_TOKEN: 'short' })
    assert.equal(c.NODE_ENV, 'production')
    assert.equal('MENISCUS_API_TOKEN' in c, false)
  })

  it('[server/hosting] Graceful shutdown: SHUTDOWN_GRACE_MS defaults to 25000', () => {
    assert.equal(parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production' }).SHUTDOWN_GRACE_MS, 25_000)
  })

  it('[server/hosting] Production needs the web build: WEB_DIST defaults to apps/web/dist', () => {
    assert.match(parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production' }).WEB_DIST, /apps[\\/]web[\\/]dist$/)
  })

  it('[server/security] No contributor models: Contributor Spark', () => {
    const u = upstream()
    assert.throws(() => parseConfig({ SPARK_MODEL: 'muse-spark-1.3-contributor' }), /SPARK_MODEL/)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] No contributor models: Any letter case, any model variable', () => {
    assert.throws(() => parseConfig({ SPARK_MODEL: 'MUSE-SPARK-1.2-CONTRIBUTOR' }), /SPARK_MODEL/)
    assert.throws(() => parseConfig({ SAM_MODEL: 'sam-3.1-contributor' }), /SAM_MODEL/)
    assert.throws(() => parseConfig({ ASR_MODEL: 'muse-voice-transcribe-1.0-Contributor' }), /ASR_MODEL/)
  })

  it('[server/security] No contributor models: Standard models', () => {
    assert.equal(parseConfig({}).SPARK_MODEL, 'muse-spark-1.3')
    assert.equal(parseConfig({ SPARK_MODEL: 'muse-spark-1.2' }).SPARK_MODEL, 'muse-spark-1.2')
  })

  it('[server/security] Per-client rate limit: Limit of 2 per minute', async () => {
    const { u, app } = await setup({ rateLimitPerMinute: 2 })
    assert.equal((await note(app)).status, 200)
    assert.equal((await note(app)).status, 200)
    const third = await note(app)
    assert.equal(third.status, 429)
    assert.equal(((await third.json()) as { error: string }).error, 'rate_limited')
    assert.ok(Number(third.headers.get('retry-after')) >= 1)
    assert.equal(u.requests.length, 2)
  })

  it('[server/security] Per-client rate limit: Sign-in attempts', async () => {
    let t = 0
    const { u, app } = await setup({ rateLimitPerMinute: 2, now: () => t })
    const signIn = (password: string) =>
      app.request(
        '/api/session',
        { method: 'POST', body: JSON.stringify({ username: 'ravi', password }), headers: { 'content-type': 'application/json' } },
        { cookie: null },
      )
    assert.equal((await signIn('wrong')).status, 401)
    assert.equal((await signIn('wrong')).status, 401)
    const third = await signIn('wrong')
    assert.equal(third.status, 429)
    assert.equal(((await third.json()) as { error: string }).error, 'rate_limited')
    assert.ok(Number(third.headers.get('retry-after')) >= 1)
    t = 60_001
    assert.equal((await signIn('ravi')).status, 201)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Per-client rate limit: break-the-glass shares the password bucket, /api/ai has its own', async () => {
    const { u, app } = await setup({ rateLimitPerMinute: 2, now: () => 0 })
    const json = { 'content-type': 'application/json' }
    // Two /api/ai requests rejected by validation use up the AI bucket (no model request), then a third is limited.
    const blankNote = () => app.request('/api/ai/note', { method: 'POST', body: JSON.stringify({ text: '' }), headers: json })
    assert.equal((await blankNote()).status, 400)
    assert.equal((await blankNote()).status, 400)
    assert.equal((await blankNote()).status, 429)
    // The password bucket is untouched by that: one sign-in and one break-the-glass check fill it.
    const signIn = () =>
      app.request(
        '/api/session',
        { method: 'POST', body: JSON.stringify({ username: 'ravi', password: 'wrong' }), headers: json },
        { cookie: null },
      )
    // Anita Thomas (the test session) on Renal HDU (ward 4), outside her wards.
    const access = () =>
      app.request('/api/wards/4/access', { method: 'POST', body: JSON.stringify({ reason: 'Covering', password: 'wrong' }), headers: json })
    assert.equal((await signIn()).status, 401)
    assert.equal((await access()).status, 401)
    const third = await access()
    assert.equal(third.status, 429)
    assert.equal(((await third.json()) as { error: string }).error, 'rate_limited')
    assert.equal((await signIn()).status, 429)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Cross-site form posts: Photo upload from another site', async () => {
    const store = await testStore()
    const { u, app } = await setup({ store })
    const id = (await store.admissions())[0]!.id
    const upload = (headers: Record<string, string>) => {
      const form = new FormData()
      form.set('file', new File([jpeg], 'p.jpg', { type: 'image/jpeg' }))
      form.set('kind', 'photo')
      return app.request(`/api/admissions/${id}/media`, { method: 'POST', body: form, headers })
    }
    assert.equal((await upload({ origin: 'https://evil.example' })).status, 403)
    assert.equal((await upload({ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal(await store.media(1), undefined)
    assert.equal((await upload({ origin: 'http://localhost' })).status, 201)
    assert.equal((await upload({ 'sec-fetch-site': 'same-origin' })).status, 201)
    assert.equal((await upload({ origin: 'http://localhost:5173' })).status, 201)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Trusted proxy hops: One hop', async () => {
    const { u, app } = await setup({ rateLimitPerMinute: 2, now: () => 0, trustProxyHops: 1 })
    const wrong = (xff: string) =>
      app.request(
        '/api/session',
        {
          method: 'POST',
          body: JSON.stringify({ username: 'ravi', password: 'wrong' }),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
        },
        { cookie: null, remote: '10.0.0.1' },
      )
    const first = await wrong('1.1.1.1, 203.0.113.7')
    const second = await wrong('9.9.9.9, 203.0.113.7')
    const third = await wrong('203.0.113.7')
    assert.deepEqual([first.status, second.status, third.status], [401, 401, 429])
    assert.equal(((await third.json()) as { error: string }).error, 'rate_limited')
    assert.equal((await wrong('203.0.113.8')).status, 401)
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Trusted proxy hops: No hops trusted', async () => {
    const { u, app } = await setup({ rateLimitPerMinute: 2, now: () => 0 })
    const wrong = (xff: string) =>
      app.request(
        '/api/session',
        {
          method: 'POST',
          body: JSON.stringify({ username: 'ravi', password: 'wrong' }),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
        },
        { cookie: null, remote: '10.0.0.1' },
      )
    const statuses = [(await wrong('1.1.1.1')).status, (await wrong('2.2.2.2')).status, (await wrong('3.3.3.3')).status]
    assert.deepEqual(statuses, [401, 401, 429])
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Trusted proxy hops: fewer entries than hops fall back to the socket', async () => {
    const { app } = await setup({ rateLimitPerMinute: 1, now: () => 0, trustProxyHops: 2 })
    const wrong = (xff: string, remote: string) =>
      app.request(
        '/api/session',
        {
          method: 'POST',
          body: JSON.stringify({ username: 'ravi', password: 'wrong' }),
          headers: { 'content-type': 'application/json', 'x-forwarded-for': xff },
        },
        { cookie: null, remote },
      )
    assert.equal((await wrong('1.1.1.1', '10.0.0.1')).status, 401)
    // One entry, two hops trusted: the socket is the key, so another made-up entry from it is still limited.
    assert.equal((await wrong('2.2.2.2', '10.0.0.1')).status, 429)
    assert.equal((await wrong('2.2.2.2', '10.0.0.2')).status, 401)
  })

  it('[server/security] Forwarded protocol: Behind TLS termination', async () => {
    const upload = async (trustProxyHops: number) => {
      const store = await testStore()
      const { u, app } = await setup({ store, trustProxyHops })
      const id = (await store.admissions())[0]!.id
      const form = new FormData()
      form.set('file', new File([jpeg], 'p.jpg', { type: 'image/jpeg' }))
      form.set('kind', 'photo')
      const res = await app.request(`http://meniscus.onrender.com/api/admissions/${id}/media`, {
        method: 'POST',
        body: form,
        headers: { host: 'meniscus.onrender.com', 'x-forwarded-proto': 'https', origin: 'https://meniscus.onrender.com' },
      })
      assert.deepEqual(u.requests, [])
      return { status: res.status, stored: (await store.media(1)) !== undefined }
    }
    assert.deepEqual(await upload(1), { status: 201, stored: true })
    assert.deepEqual(await upload(0), { status: 403, stored: false })
  })

  it('[server/security] Forwarded protocol: Secure cookie over HTTPS', async () => {
    const signIn = async (trustProxyHops: number) => {
      const config = parseConfig({ NODE_ENV: 'development' })
      const { u, app } = await setup({ ...appFlags(config), trustProxyHops })
      const res = await app.request(
        '/api/session',
        {
          method: 'POST',
          body: JSON.stringify({ username: 'ravi', password: 'ravi' }),
          headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
        },
        { cookie: null },
      )
      assert.equal(res.status, 201)
      assert.deepEqual(u.requests, [])
      return res.headers.get('set-cookie')!.split('; ')
    }
    const behind = await signIn(1)
    assert.ok(behind[0]!.startsWith('meniscus_session=') && behind.includes('Secure'), behind.join('; '))
    assert.ok(!(await signIn(0)).includes('Secure'))
  })

  it('[server/security] Per-client rate limit: window rolls over', async () => {
    let t = 0
    const { app } = await setup({ rateLimitPerMinute: 1, now: () => t })
    assert.equal((await note(app)).status, 200)
    assert.equal((await note(app)).status, 429)
    t = 60_001
    assert.equal((await note(app)).status, 200)
  })

  it('[server/security] Upload content matches its type: Text labelled as JPEG', async () => {
    const { u, app } = await setup()
    const form = new FormData()
    form.set('image', new File([new TextEncoder().encode('hello')], 'x.jpg', { type: 'image/jpeg' }))
    const res = await app.request('/api/ai/read', { method: 'POST', body: form })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_request')
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Internal errors stay internal: Pipeline bug', async (t) => {
    t.mock.method(console, 'error', () => {})
    const u = upstream()
    const app = await testApp({
      ai: {
        ...u.ai,
        parseNote: () => {
          throw new TypeError('secret detail')
        },
      },
    })
    const res = await note(app)
    assert.equal(res.status, 500)
    const body = await res.text()
    assert.equal(body, '{"error":"internal_error"}')
    assert.ok(!body.includes('secret detail'))
  })
})
