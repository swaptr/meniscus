import assert from 'node:assert/strict'
import { randomBytes, scryptSync } from 'node:crypto'
import { describe, it, type TestContext } from 'node:test'
import type { AdmissionSummary, Entry, EntryList, HospitalSummary, SessionInfo, SignInRequired } from '@meniscus/shared'
import { type AppOptions } from './app.ts'
import { passwordMatches } from './auth.ts'
import { appFlags, parseConfig } from './config.ts'
import { DEMO_STAFF } from './store/demo-hospital.ts'
import { DEMO_PASSWORD_HASHES } from './store/demo-passwords.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { jpeg, signIn as signInAs, testApp, testDb, testStore, upstream, PROD_MEDIA_ENV } from './testing.ts'

/** 2026-11-<d> hh:mm local time: sessions end with the server's local shift. */
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const RAVI = { username: 'ravi', password: 'ravi' }

interface Send {
  body?: unknown
  form?: FormData
  /** Default: none. */
  cookie?: string | null
  staff?: number
}

/** No session is added for you here: each request carries exactly the cookie given. */
async function setup(o: { clock?: number; store?: Store; app?: Omit<AppOptions, 'ai' | 'store'> } = {}) {
  const clock = { t: o.clock ?? at(2, 10) }
  const store = o.store ?? (await testStore(() => clock.t))
  const u = upstream()
  const { request } = await testApp({ ai: u.ai, statusClient: () => u.client, store, ...o.app })
  const send = async <T>(method: string, path: string, s: Send = {}) => {
    const headers: Record<string, string> = {}
    if (s.body !== undefined) headers['content-type'] = 'application/json'
    const body = s.form ?? (s.body !== undefined ? JSON.stringify(s.body) : undefined)
    const res = await request(
      path,
      { method, headers, ...(body !== undefined ? { body } : {}) },
      { cookie: s.cookie ?? null, ...(s.staff !== undefined ? { staff: s.staff } : {}) },
    )
    const text = await res.text()
    return {
      status: res.status,
      text,
      body: (text ? JSON.parse(text) : null) as T & { error?: string },
      setCookie: res.headers.get('set-cookie'),
      /** `meniscus_session=<token>`, ready to send back. */
      cookie: res.headers.get('set-cookie')?.split(';')[0] ?? null,
    }
  }
  const signIn = (creds = RAVI, s: Send = {}) => send<SessionInfo>('POST', '/api/session', { ...s, body: creds })
  /** Reads for the test's own bookkeeping, signed in as Anita Thomas (reads need a session). */
  const reader = () => signInAs(store, 4)
  const bed = async (n = '1', ward = '3A') =>
    (await send<AdmissionSummary[]>('GET', '/api/admissions', { cookie: await reader() })).body.find(
      (a) => a.bed === n && a.ward_code === ward,
    )!.id
  const addEntry = async (s: Send = {}) =>
    send<Entry>('POST', `/api/admissions/${await bed()}/entries`, {
      ...s,
      body: { direction: 'in', category: 'water', volume_ml: 200, source: 'manual' },
    })
  const entries = async () =>
    (await send<EntryList>('GET', `/api/admissions/${await bed()}/entries`, { cookie: await reader() })).body.entries
  return { clock, store, u, send, signIn, bed, addEntry, entries }
}

/** Every console line the server writes during the test. */
function captureLogs(t: TestContext) {
  const lines: string[] = []
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(' ')))
  }
  return lines
}

/** A store on a test database, for tests that look at its rows directly (`h.pg`). */
async function dbStore(clock: { t: number }) {
  const h = await testDb()
  const rows = async <T>(sql: string) => (await h.pg.query<T>(sql)).rows
  return { h, store: await openPgStore(h.db, { now: () => clock.t }), rows }
}

describe('staff sign-in', () => {
  it('[server/security] Staff sign-in: Ravi signs in', async (t) => {
    const logs = captureLogs(t)
    const s = await setup()
    const res = await s.signIn()
    assert.equal(res.status, 201)
    const { wards, ...staff } = res.body.staff
    assert.deepEqual(staff, { id: 1, name: 'Ravi Kumar', role: 'attendant' })
    assert.deepEqual(
      wards.map((w) => w.code),
      ['3A', '2C'],
    )
    const [pair, ...attrs] = res.setCookie!.split('; ')
    const [name, token] = pair!.split('=') as [string, string]
    assert.equal(name, 'meniscus_session')
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
    assert.ok(attrs.includes('HttpOnly') && attrs.includes('SameSite=Strict') && attrs.includes('Path=/api'), res.setCookie!)
    assert.ok(!attrs.includes('Secure'))
    assert.ok(!res.text.includes(token) && !res.text.includes('scrypt$'))
    // The session works, and still says nothing secret.
    const again = await s.send<SessionInfo>('GET', '/api/session', { cookie: res.cookie })
    assert.equal(again.status, 200)
    assert.ok(!again.text.includes(token) && !again.text.includes('scrypt$'))
    for (const line of logs) {
      for (const secret of [token, 'scrypt$', JSON.stringify(RAVI)]) assert.ok(!line.includes(secret), 'secret logged')
    }
    assert.deepEqual(s.u.requests, [])
  })

  it('[server/security] Staff sign-in: Same answer for a wrong username or password', async () => {
    const s = await setup()
    const wrongPassword = await s.signIn({ username: 'ravi', password: 'wrong' })
    const wrongUser = await s.signIn({ username: 'nobody', password: 'ravi' })
    for (const r of [wrongPassword, wrongUser]) {
      assert.equal(r.status, 401)
      assert.equal(r.text, '{"error":"invalid_credentials"}')
      assert.equal(r.setCookie, null)
    }
  })

  it('[server/security] Staff sign-in: Secure in production', async () => {
    const config = parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production', MENISCUS_DEMO_LOGIN: '1' })
    const s = await setup({ app: appFlags(config) })
    const res = await s.signIn(RAVI)
    assert.equal(res.status, 201)
    assert.ok(res.setCookie!.split('; ').includes('Secure'), res.setCookie!)
  })

  it('[server/security] Staff sign-in: every committed demo hash is the first name', async () => {
    assert.equal(Object.keys(DEMO_PASSWORD_HASHES).length, DEMO_STAFF.length)
    for (const s of DEMO_STAFF) {
      assert.equal(s.username, s.name.split(' ')[0]!.toLowerCase())
      assert.ok(await passwordMatches(DEMO_PASSWORD_HASHES[s.id]!, s.username), s.name)
    }
    // Each with its own salt.
    assert.equal(new Set(Object.values(DEMO_PASSWORD_HASHES).map((h) => h.split('$')[2])).size, DEMO_STAFF.length)
  })

  it('[server/security] Staff sign-in: a malformed stored hash is a wrong password', async () => {
    const clock = { t: at(2, 10) }
    const f = await dbStore(clock)
    await f.store.close()
    await f.h.pg.query("UPDATE meniscus.staff SET password_hash = 'scrypt$bad' WHERE id = 1")
    const s = await setup({ store: await openPgStore(f.h.db, { now: () => clock.t }) })
    const res = await s.signIn()
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'invalid_credentials')
    await s.store.close()
  })

  it('[server/security] Staff sign-in: a stored key of the wrong length is a wrong password, not a 500', async () => {
    const clock = { t: at(2, 10) }
    const f = await dbStore(clock)
    await f.store.close()
    // A well-formed header and salt, and the right password, but a 31-byte key: timingSafeEqual would throw on it.
    const salt = randomBytes(16)
    const key = scryptSync('ravi', salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).subarray(0, 31)
    await f.h.pg.query('UPDATE meniscus.staff SET password_hash = $1 WHERE id = 1', [
      `scrypt$N=32768,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`,
    ])
    const s = await setup({ store: await openPgStore(f.h.db, { now: () => clock.t }) })
    const res = await s.signIn()
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'invalid_credentials')
    await s.store.close()
  })

  it('[server/security] Staff sign-in: a stored hash asking for too much work is a wrong password', async () => {
    /** A genuine hash of `password` with these parameters (cheap ones only), as a stored row would hold it. */
    const genuine = (password: string, N: number, r: number, p: number) => {
      const salt = randomBytes(16)
      const key = scryptSync(password, salt, 32, { N, r, p, maxmem: 256 * N * r })
      return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64url')}$${key.toString('base64url')}`
    }
    const forged = (N: number, r: number, p: number) =>
      `scrypt$N=${N},r=${r},p=${p}$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`
    // Within the caps, other parameters still verify.
    assert.equal(await passwordMatches(genuine('ravi', 1024, 8, 1), 'ravi'), true)
    assert.equal(await passwordMatches(genuine('ravi', 1024, 16, 4), 'ravi'), true)
    // r over 16 or p over 4: refused even with the right password, after the dummy hash's work instead.
    assert.equal(await passwordMatches(genuine('ravi', 16, 17, 1), 'ravi'), false)
    assert.equal(await passwordMatches(genuine('ravi', 1024, 8, 5), 'ravi'), false)
    // N over 2^20, or 128 · N · r over 64 MiB: refused without running them.
    for (const [N, r, p] of [
      [2 ** 21, 1, 1],
      [2 ** 20, 1, 1],
      [2 ** 17, 8, 1],
      [2 ** 19, 2, 1],
    ] as const) {
      assert.equal(await passwordMatches(forged(N, r, p), 'ravi'), false, `N=${N},r=${r},p=${p}`)
    }
  })
})

describe('sessions end', () => {
  it('[server/security] Sessions end: Shift end', async () => {
    const s = await setup({ clock: at(2, 19, 30) })
    const { cookie } = await s.signIn()
    s.clock.t = at(2, 19, 50)
    const live = await s.send<SessionInfo>('GET', '/api/session', { cookie })
    assert.equal(live.status, 200)
    assert.equal(live.body.staff.name, 'Ravi Kumar')
    s.clock.t = at(2, 20)
    const ended = await s.send('GET', '/api/session', { cookie })
    assert.equal(ended.status, 401)
    assert.equal(ended.body.error, 'sign_in_required')
  })

  it('[server/security] Sessions end: Thirty minutes without a request', async () => {
    const clock = { t: at(2, 10) }
    const f = await dbStore(clock)
    const s = await setup({ store: f.store })
    const { cookie } = await s.signIn()
    clock.t = at(2, 10, 29)
    assert.equal((await s.send('GET', '/api/session', { cookie })).status, 200)
    clock.t = at(2, 11)
    const ended = await s.send('GET', '/api/session', { cookie })
    assert.equal(ended.status, 401)
    assert.equal(ended.body.error, 'sign_in_required')
    assert.deepEqual(await f.rows('SELECT * FROM meniscus.session'), [])
    await f.store.close()
  })

  it('[server/security] Sessions end: Sign out', async () => {
    const s = await setup()
    const { cookie } = await s.signIn()
    const out = await s.send('DELETE', '/api/session', { cookie })
    assert.equal(out.status, 204)
    const cleared = out.setCookie!.split('; ')
    assert.equal(cleared[0], 'meniscus_session=')
    assert.ok(cleared.includes('Max-Age=0') && cleared.includes('Path=/api'), out.setCookie!)
    const entry = await s.addEntry({ cookie })
    assert.equal(entry.status, 401)
    assert.equal(entry.body.error, 'sign_in_required')
    assert.deepEqual(await s.entries(), [])
    assert.equal((await s.send('DELETE', '/api/session', { cookie })).status, 204)
    assert.equal((await s.send('DELETE', '/api/session')).status, 204)
  })
})

describe('signed-in changes', () => {
  it('[server/security] Signed-in changes: No session', async () => {
    const s = await setup()
    const id = await s.bed()
    const wards = async () => (await s.send<HospitalSummary>('GET', '/api/wards', { cookie: await signInAs(s.store, 4) })).body.wards
    const wardId = (await wards()).find((w) => w.code === '3A')!.id
    const form = new FormData()
    form.set('file', new File([jpeg], 'p.jpg', { type: 'image/jpeg' }))
    form.set('kind', 'photo')
    for (const r of [
      await s.addEntry(),
      await s.send('POST', '/api/ai/note', { body: { text: 'drank tea' } }),
      await s.send('POST', `/api/admissions/${id}/media`, { form }),
      await s.send('PUT', `/api/wards/${wardId}/in-charge`, { body: { staff_id: 4 } }),
    ]) {
      assert.equal(r.status, 401)
      assert.equal(r.body.error, 'sign_in_required')
    }
    assert.deepEqual(await s.entries(), [])
    assert.equal((await wards()).find((w) => w.code === '3A')!.in_charge?.id, 4)
    assert.deepEqual(s.u.requests, [])
  })

  it('[server/security] Signed-in changes: Ended session', async () => {
    const s = await setup({ clock: at(2, 19, 30) })
    const { cookie } = await s.signIn()
    s.clock.t = at(2, 20, 5)
    const res = await s.addEntry({ cookie })
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'sign_in_required')
    assert.deepEqual(await s.entries(), [])
  })

  it("[server/security] Signed-in changes: Someone else's id", async () => {
    const s = await setup()
    const { cookie } = await s.signIn()
    const other = await s.addEntry({ cookie, staff: 4 })
    const unknown = await s.addEntry({ cookie, staff: 999 })
    const own = await s.addEntry({ cookie, staff: 1 })
    assert.deepEqual(
      [other.status, other.body.error, unknown.status, unknown.body.error, own.status],
      [401, 'sign_in_required', 400, 'invalid_request', 201],
    )
    assert.deepEqual(own.body.created_by, { id: 1, name: 'Ravi Kumar', role: 'attendant' })
    assert.deepEqual(
      (await s.entries()).map((e) => e.id),
      [own.body.id],
    )
  })

  it('[server/security] Signed-in changes: Sign in again over an ended session', async () => {
    const s = await setup({ clock: at(2, 19, 30) })
    const { cookie } = await s.signIn()
    s.clock.t = at(2, 20, 5)
    const res = await s.signIn(RAVI, { cookie, staff: 1 })
    assert.equal(res.status, 201)
    assert.equal(res.body.staff.name, 'Ravi Kumar')
    assert.match(res.cookie!, /^meniscus_session=[A-Za-z0-9_-]{43}$/)
    assert.notEqual(res.cookie, cookie)
  })

  it('[server/security] Signed-in changes: Reads stay open', async () => {
    const s = await setup()
    const session = await s.send<SignInRequired>('GET', '/api/session')
    assert.equal(session.status, 401)
    assert.equal(session.body.error, 'sign_in_required')
    assert.equal(session.body.hospital, 'Meniscus Demo Hospital')
    assert.ok(Array.isArray(session.body.demo_accounts))
    const health = await s.send('GET', '/api/health')
    assert.deepEqual([health.status, health.text], [200, '{"ok":true}'])
    assert.equal((await s.send('GET', '/api/wards')).status, 401)
    assert.deepEqual(s.u.requests, [])
  })
})

describe('signed-in reads', () => {
  const bed4 = async (store: Store) => (await store.admissions()).find((a) => a.ward_code === '3A' && a.bed === '4')!

  it('[server/security] Signed-in reads: Reads without a session', async () => {
    const s = await setup()
    const b = await bed4(s.store)
    for (const path of [
      '/api/wards',
      '/api/admissions',
      `/api/beds/${b.qr_token}`,
      `/api/admissions/${b.id}/entries`,
      '/api/media/1',
      '/api/quality/model',
      '/api/ai/status',
    ]) {
      const r = await s.send('GET', path)
      assert.deepEqual([r.status, r.text], [401, '{"error":"sign_in_required"}'], path)
      const head = await s.send('HEAD', path)
      assert.equal(head.status, 401, `HEAD ${path}`)
    }
    assert.deepEqual(s.u.requests, [])
  })

  it('[server/security] Signed-in reads: Reads without a session (every GET route)', async () => {
    const u = upstream()
    const { app } = await testApp({ ai: u.ai, statusClient: () => u.client })
    const open = new Set(['/api/session', '/api/health'])
    const paths = [
      ...new Set(
        app.routes
          .filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !open.has(r.path))
          .map((r) => r.path.replace(/:[^/]+/g, '1')),
      ),
    ]
    assert.ok(paths.length >= 15, `${paths.length} GET routes`)
    for (const path of paths) {
      const res = await app.request(path)
      assert.equal(res.status, 401, path)
      assert.equal(await res.text(), '{"error":"sign_in_required"}', path)
    }
    assert.deepEqual(u.requests, [])
  })

  it('[server/security] Signed-in reads: Ended session', async () => {
    const s = await setup({ clock: at(2, 19, 30) })
    const { cookie } = await s.signIn()
    s.clock.t = at(2, 20, 5)
    const r = await s.send('GET', `/api/beds/${(await bed4(s.store)).qr_token}`, { cookie })
    assert.equal(r.status, 401)
    assert.equal(r.body.error, 'sign_in_required')
    assert.ok(!r.text.includes('patient') && !r.text.includes('mrn'), r.text)
    assert.deepEqual(s.u.requests, [])
  })

  it('[server/security] Signed-in reads: Signed in', async () => {
    const s = await setup()
    const { cookie } = await s.signIn()
    const b = await bed4(s.store)
    assert.equal((await s.send('GET', '/api/wards', { cookie })).status, 200)
    const r = await s.send<AdmissionSummary>('GET', `/api/beds/${b.qr_token}`, { cookie })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.id, r.body.ward_code, r.body.bed], [b.id, '3A', '4'])
    assert.deepEqual(s.u.requests, [])
  })

  it('[server/security] Signed-in reads: a read keeps the session alive', async () => {
    const s = await setup({ clock: at(2, 10) })
    const { cookie } = await s.signIn()
    s.clock.t = at(2, 10, 25)
    assert.equal((await s.send('GET', '/api/wards', { cookie })).status, 200)
    s.clock.t = at(2, 10, 50)
    assert.equal((await s.send('GET', '/api/wards', { cookie })).status, 200)
  })

  it('[web/bed-qr] Bed link needs sign-in: Token alone', async () => {
    const s = await setup()
    const r = await s.send('GET', `/api/beds/${(await bed4(s.store)).qr_token}`)
    assert.equal(r.status, 401)
    assert.equal(r.body.error, 'sign_in_required')
    for (const field of ['patient', 'mrn', 'admission']) assert.ok(!r.text.includes(field), field)
    assert.deepEqual(s.u.requests, [])
  })
})

describe('demo sign-in', () => {
  it('[server/security] Demo accounts and sign-in: Demo accounts listed', async () => {
    const s = await setup({ app: appFlags(parseConfig({ NODE_ENV: 'development' })) })
    const res = await s.send<SignInRequired>('GET', '/api/session')
    assert.equal(res.status, 401)
    assert.equal(res.body.error, 'sign_in_required')
    assert.equal(res.body.hospital, 'Meniscus Demo Hospital')
    assert.equal(res.body.demo_accounts.length, 11)
    assert.deepEqual(
      res.body.demo_accounts.find((a) => a.username === 'anita'),
      { username: 'anita', name: 'Anita Thomas', role: 'nurse', ward: '3A' },
    )
    assert.deepEqual(
      res.body.demo_accounts.find((a) => a.username === 'lakshmi'),
      { username: 'lakshmi', name: 'Lakshmi Iyer', role: 'matron', ward: null },
    )
    assert.deepEqual(
      res.body.demo_accounts.find((a) => a.username === 'sana'),
      { username: 'sana', name: 'Sana Mirza', role: 'dietitian', ward: null },
    )
    assert.equal((await s.signIn({ username: 'lakshmi', password: 'lakshmi' })).status, 201)
    const sana = await s.signIn({ username: 'sana', password: 'sana' })
    assert.equal(sana.status, 201)
    assert.equal(sana.body.staff.id, 11)
  })

  it('[server/security] Demo accounts and sign-in: Production refuses demo passwords', async () => {
    const off = parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production' })
    const s = await setup({ app: appFlags(off) })
    const refused = await s.signIn(RAVI)
    assert.equal(refused.status, 401)
    assert.equal(refused.body.error, 'invalid_credentials')
    assert.deepEqual((await s.send<SignInRequired>('GET', '/api/session')).body.demo_accounts, [])

    const on = parseConfig({ ...PROD_MEDIA_ENV, NODE_ENV: 'production', MENISCUS_DEMO_LOGIN: '1' })
    const t = await setup({ app: appFlags(on) })
    assert.equal((await t.signIn(RAVI)).status, 201)
  })
})
