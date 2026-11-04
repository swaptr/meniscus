/**
 * The server process itself: `node src/index.ts` (Node's type stripping, no tsx), spawned with an explicit environment
 * only. No `.env` is loaded, and the model base URL points where nothing listens; no test sends a model request. Its
 * Postgres is a test database served on a loopback port by pglite-socket (one pooled connection: PGlite runs one
 * session's queries at a time).
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { connect, createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createTestDb, type TestDb } from './db/testing.ts'

const SERVER_DIR = new URL('..', import.meta.url)
const temps: string[] = []
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix))
  temps.push(d)
  return d
}
const children = new Set<ChildProcess>()
const databases: { h: TestDb; server: PGLiteSocketServer }[] = []
after(async () => {
  for (const d of databases) await d.server.stop()
  // One database may sit behind two ports: close each once.
  for (const h of new Set(databases.map((d) => d.h))) await h.close()
})
after(() => {
  // No spawned server outlives the tests, even one a timed-out test left behind.
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL')
  temps.forEach((d) => rmSync(d, { recursive: true, force: true }))
})

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

interface Proc {
  child: ChildProcess
  port: number
  out: () => string
  /** Resolves with the exit code (or the signal's name). */
  exited: Promise<number | string>
  /** Resolves once the listen line is printed. */
  listening: Promise<void>
}

/** `h` served on a free loopback port (pglite-socket accepts any password). */
async function serveDb(h: TestDb, password = 'postgres') {
  const port = await freePort()
  const server = new PGLiteSocketServer({ db: h.pg, host: '127.0.0.1', port, maxConnections: 2 })
  await server.start()
  databases.push({ h, server })
  return { server, port, url: `postgresql://postgres:${password}@127.0.0.1:${port}/postgres` }
}

/** A fresh test database on a free loopback port; its `DATABASE_URL`. */
async function database(): Promise<string> {
  return (await serveDb(await createTestDb())).url
}

/** Anita's sign-in: the session cookie. */
async function signIn(p: Proc) {
  const res = await fetch(url(p, '/api/session'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'anita', password: 'anita' }),
  })
  assert.equal(res.status, 201)
  return res.headers.get('set-cookie')!.split(';')[0]!
}

/** `node src/index.ts` with only these variables (plus PATH), a fresh database (unless `DATABASE_URL` is given) and a free PORT. */
async function start(env: Record<string, string>): Promise<Proc> {
  const port = await freePort()
  const db = 'DATABASE_URL' in env ? {} : { DATABASE_URL: await database() }
  const child = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER_DIR,
    env: {
      PATH: process.env.PATH ?? '',
      DATABASE_POOL_MAX: '1',
      ...db,
      MODEL_API_BASE_URL: 'http://127.0.0.1:9/v1',
      MODEL_API_KEY: 'fake',
      PORT: String(port),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let out = ''
  child.stdout.on('data', (b: Buffer) => (out += b.toString()))
  child.stderr.on('data', (b: Buffer) => (out += b.toString()))
  const exited = new Promise<number | string>((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal ?? -1)))
  const listening = new Promise<void>((resolve, reject) => {
    const check = () => out.includes('meniscus server on') && resolve()
    child.stdout.on('data', check)
    void exited.then(() => reject(new Error(`exited before listening:\n${out}`)))
  })
  listening.catch(() => {}) // awaited only by tests that expect it
  return { child, port, out: () => out, exited, listening }
}

/** Kills a process a test left running, so none outlives it. */
const reap = (p: Proc) => {
  if (p.child.exitCode === null && p.child.signalCode === null) p.child.kill('SIGKILL')
}

const url = (p: Proc, path: string) => `http://127.0.0.1:${p.port}${path}`

describe('server process', () => {
  it('[charting/entries] Persistent store: No database configured', { timeout: 30_000 }, async () => {
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-'), DATABASE_URL: '' })
    try {
      assert.equal(await p.exited, 1)
      assert.ok(p.out().includes('DATABASE_URL') && p.out().includes('pnpm dev:stack'), p.out())
      assert.ok(!p.out().includes('meniscus server on'))
      assert.equal(await refused(p.port), true)
    } finally {
      reap(p)
    }
  })

  it('[server/storage] Storage secrets never revealed: Database down at start', { timeout: 30_000 }, async () => {
    const p = await start({
      NODE_ENV: 'development',
      MEDIA_STORE: 'memory',
      WEB_DIST: temp('meniscus-empty-'),
      DATABASE_URL: 'postgresql://meniscus_app:pw-7f3a9c@127.0.0.1:1/postgres',
    })
    try {
      assert.equal(await p.exited, 1)
      assert.ok(p.out().includes('127.0.0.1') && p.out().includes('ECONNREFUSED'), p.out())
      assert.ok(!p.out().includes('pw-7f3a9c'), p.out())
      assert.ok(!p.out().includes('meniscus server on'))
    } finally {
      reap(p)
    }
  })

  it('[server/storage] Storage secrets never revealed: Database lost during a request', { timeout: 30_000 }, async () => {
    const db = await serveDb(await createTestDb(), 'pw-7f3a9c')
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-'), DATABASE_URL: db.url })
    try {
      await p.listening
      const cookie = await signIn(p)
      await db.server.stop() // the database goes away: open connections closed, new ones refused
      const res = await fetch(url(p, '/api/admissions'), { headers: { cookie } })
      assert.equal(res.status, 500)
      assert.equal(await res.text(), '{"error":"internal_error"}')
      p.child.kill('SIGTERM')
      await p.exited
      assert.ok(!p.out().includes('pw-7f3a9c'), p.out())
    } finally {
      reap(p)
    }
  })

  it("[server/storage] Tables closed to Supabase's APIs: Table without RLS", { timeout: 30_000 }, async () => {
    const h = await createTestDb()
    await h.pg.exec('CREATE TABLE meniscus.example (id int)')
    const db = await serveDb(h)
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-'), DATABASE_URL: db.url })
    try {
      assert.equal(await p.exited, 1)
      assert.ok(p.out().includes('meniscus.example'), p.out())
      assert.ok(!p.out().includes('meniscus server on'))
      assert.equal(await refused(p.port), true)
    } finally {
      reap(p)
    }
  })

  it('[server/storage] Session connection: Transaction mode for requests, session mode for the worker', { timeout: 30_000 }, async () => {
    // One database behind two ports: the session URL's and the request URL's. Each connection is noted in order.
    const h = await createTestDb()
    const session = await serveDb(h, 'Xy9-secret')
    const requests = await serveDb(h, 'Xy9-secret')
    const seen: string[] = []
    session.server.addEventListener('connection', () => seen.push('session'))
    requests.server.addEventListener('connection', () => seen.push('request'))
    const p = await start({
      NODE_ENV: 'development',
      MEDIA_STORE: 'memory',
      WEB_DIST: temp('meniscus-empty-'),
      DATABASE_URL: requests.url,
      DATABASE_SESSION_URL: session.url,
    })
    try {
      await p.listening
      const res = await fetch(url(p, '/api/wards'), { headers: { cookie: await signIn(p) } })
      assert.equal(res.status, 200)
      // The migrations ran on the session port, first and only there; every later query on the request port.
      assert.equal(seen[0], 'session', seen.join(','))
      const firstRequest = seen.indexOf('request')
      assert.ok(firstRequest > 0, seen.join(','))
      assert.ok(
        seen.slice(firstRequest).every((s) => s === 'request'),
        seen.join(','),
      )
      assert.equal(session.server.getStats().activeConnections, 0, 'the migration client is closed')
      const journal = await h.pg.query<{ n: number }>('SELECT count(*)::int AS n FROM meniscus.drizzle_migrations')
      assert.ok(journal.rows[0]!.n > 0)
      p.child.kill('SIGTERM')
      assert.equal(await p.exited, 0)
      assert.ok(!p.out().includes('Xy9-secret'))
    } finally {
      reap(p)
    }
  })

  it('[server/hosting] Production needs the web build: Build missing in production', { timeout: 30_000 }, async () => {
    const empty = temp('meniscus-empty-')
    // Every S3 variable explicit (none come from .env); the endpoint is loopback, where nothing listens. The web build
    // check runs before the bucket check, so the process fails on WEB_DIST having sent no S3 request.
    const p = await start({
      NODE_ENV: 'production',
      WEB_DIST: empty,
      MEDIA_STORE: 's3',
      S3_ENDPOINT: 'http://127.0.0.1:9/storage/v1/s3',
      S3_REGION: 'local',
      S3_BUCKET: 'meniscus-media',
      S3_ACCESS_KEY_ID: 'ak-test-77bb',
      S3_SECRET_ACCESS_KEY: 'sk-test-55aa',
    })
    try {
      assert.equal(await p.exited, 1)
      assert.match(p.out(), /WEB_DIST/)
      assert.ok(p.out().includes(join(empty, 'index.html')), p.out())
      assert.ok(!p.out().includes('meniscus server on'))
      assert.ok(!p.out().includes('media store'), p.out())
      assert.ok(!p.out().includes('sk-test-55aa'))
      assert.equal(await refused(p.port), true)
    } finally {
      reap(p)
    }
  })

  it('[server/hosting] Production needs the web build: Development without a build', { timeout: 30_000 }, async () => {
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-') })
    try {
      await p.listening
      assert.equal((await fetch(url(p, '/n'))).status, 404)
      const health = await fetch(url(p, '/api/health'))
      assert.equal(health.status, 200)
      assert.equal(await health.text(), '{"ok":true}')
      p.child.kill('SIGTERM')
      assert.equal(await p.exited, 0)
    } finally {
      reap(p)
    }
  })

  it('[server/hosting] Graceful shutdown: Request in flight', { timeout: 30_000 }, async () => {
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-') })
    try {
      await p.listening
      // Anita's sign-in, still in flight: its headers are in, its body is not yet complete when SIGTERM arrives.
      const body = JSON.stringify({ username: 'anita', password: 'anita' })
      const socket = connect({ host: '127.0.0.1', port: p.port })
      await new Promise<void>((resolve) => socket.once('connect', resolve))
      let reply = ''
      socket.on('data', (b: Buffer) => (reply += b.toString()))
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
      socket.write(
        `POST /api/session HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body.slice(0, 5)}`,
      )
      await new Promise((r) => setTimeout(r, 150))
      p.child.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 150))
      assert.equal(await refused(p.port), true, 'a new connection is refused')
      socket.write(body.slice(5))
      await closed
      assert.match(reply, /^HTTP\/1\.1 201 /)
      assert.equal(await p.exited, 0)
      assert.ok(!p.out().includes('anita'), 'no request body is logged')
    } finally {
      reap(p)
    }
  })

  it('[server/hosting] Graceful shutdown: Grace limit', { timeout: 30_000 }, async () => {
    const p = await start({ NODE_ENV: 'development', MEDIA_STORE: 'memory', WEB_DIST: temp('meniscus-empty-'), SHUTDOWN_GRACE_MS: '100' })
    try {
      await p.listening
      // A sign-in whose body is still being sent: the request is in flight until it ends.
      const socket = connect({ host: '127.0.0.1', port: p.port })
      await new Promise<void>((resolve) => socket.once('connect', resolve))
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
      socket.on('error', () => {})
      socket.write('POST /api/session HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"user')
      await new Promise((r) => setTimeout(r, 100))
      const t0 = Date.now()
      p.child.kill('SIGTERM')
      await closed
      assert.equal(await p.exited, 0)
      assert.ok(Date.now() - t0 < 1_000, `${Date.now() - t0} ms`)
      socket.destroy()
    } finally {
      reap(p)
    }
  })
})
