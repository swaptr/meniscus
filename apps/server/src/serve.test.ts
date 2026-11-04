import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { connect, createServer, type AddressInfo } from 'node:net'
import { describe, it } from 'node:test'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createDb } from './db/client.ts'
import { createTestDb } from './db/testing.ts'
import { startServer, stopOnSignal } from './serve.ts'
import { openPgStore } from './store/pg/store.ts'
import { testApp, upstream } from './testing.ts'

/** A `fetch` whose answers wait until `release()`, then come from `inner`; `started` resolves when the first arrives. */
function heldFetch(inner: (r: Request) => Response | Promise<Response> = () => Response.json({ ok: true })) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let arrived!: () => void
  const started = new Promise<void>((r) => (arrived = r))
  const fetch = async (r: Request) => {
    arrived()
    await gate
    return inner(r)
  }
  return { fetch, release, started }
}

/** A store that only records `close`. */
const storeSpy = () => {
  const s = { closed: 0, close: () => (s.closed++, Promise.resolve()) }
  return s
}

/** One GET on its own connection (no keep-alive pool): the status, or the socket error's code. */
const get = (port: number) =>
  new Promise<{ status?: number; error?: string }>((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/admissions', agent: false }, (res) => {
      res.resume()
      res.on('end', () => resolve({ status: res.statusCode! }))
    })
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? e.message }))
    req.end()
  })

/** Whether a new TCP connection to the port is refused. */
const refused = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host: '127.0.0.1', port })
    s.once('connect', () => (s.destroy(), resolve(false)))
    s.once('error', () => resolve(true))
  })

/** A port nothing listens on (bound and released). */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo
      s.close(() => resolve(port))
    })
  })

/** Anita's sign-in (`POST /api/session`) on its own connection: the status, or the socket error's code. */
const signIn = (port: number) =>
  new Promise<{ status?: number; error?: string }>((resolve) => {
    const body = JSON.stringify({ username: 'anita', password: 'anita' })
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/api/session', method: 'POST', agent: false, headers: { 'content-type': 'application/json' } },
      (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode! }))
      },
    )
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? e.message }))
    req.end(body)
  })

/** The real app over the fake upstream: `u.requests` lists every model request it makes. */
const realApp = async () => {
  const u = upstream()
  const { app } = await testApp({ ai: u.ai, statusClient: () => u.client })
  return { u, fetch: (r: Request) => app.fetch(r) }
}

const portOf = (r: Awaited<ReturnType<typeof startServer>>) => (r.server.address() as AddressInfo).port

describe('graceful shutdown (in process)', () => {
  it('[server/hosting] Graceful shutdown: Request in flight', async () => {
    const { u, fetch } = await realApp()
    const held = heldFetch(fetch)
    const store = storeSpy()
    const running = await startServer({ fetch: held.fetch, store, host: '127.0.0.1', port: 0, graceMs: 5_000 })
    const port = portOf(running)
    const inFlight = signIn(port)
    await held.started
    const done = running.shutdown()
    assert.equal(await refused(port), true)
    assert.equal(store.closed, 0)
    held.release()
    assert.deepEqual(await inFlight, { status: 201 })
    await done
    assert.equal(store.closed, 1)
    assert.deepEqual(u.requests, [])
    // Idempotent: a second signal changes nothing.
    await running.shutdown()
    assert.equal(store.closed, 1)
  })

  it('[server/hosting] Graceful shutdown: Grace limit', async () => {
    const { u, fetch } = await realApp()
    const held = heldFetch(fetch)
    const store = storeSpy()
    const running = await startServer({ fetch: held.fetch, store, host: '127.0.0.1', port: 0, graceMs: 100 })
    const inFlight = get(portOf(running))
    await held.started
    const t0 = Date.now()
    await running.shutdown()
    const r = await inFlight
    assert.ok(Date.now() - t0 < 1_000, `${Date.now() - t0} ms`)
    assert.equal(r.status, undefined)
    assert.ok(r.error, 'the held connection is closed')
    assert.equal(store.closed, 1)
    held.release()
    assert.deepEqual(u.requests, [], 'the upstream received no request during shutdown')
  })

  // postgres-store task 7.3: the real store over postgres.js (createDb), its test database served on a loopback port.
  // The socket server counts the pool's connections, so the pool must be ended by shutdown, not by the process exiting.
  const onTestDatabase = async () => {
    const h = await createTestDb()
    const port = await freePort()
    const db = new PGLiteSocketServer({ db: h.pg, host: '127.0.0.1', port, maxConnections: 2 })
    await db.start()
    const handle = createDb({ url: `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`, max: 1 })
    const store = await openPgStore(handle.db, { close: () => handle.close() })
    const { app } = await testApp({ store })
    const u = upstream()
    const stop = async () => {
      await db.stop()
      await h.close()
    }
    return { u, store, db, stop, fetch: (r: Request) => app.fetch(r) }
  }
  const settle = () => new Promise((r) => setTimeout(r, 100))

  it('[server/hosting] Graceful shutdown: Request in flight, on the test database: no pool client after shutdown', async () => {
    const t = await onTestDatabase()
    try {
      const held = heldFetch(t.fetch)
      const running = await startServer({ fetch: held.fetch, store: t.store, host: '127.0.0.1', port: 0, graceMs: 5_000 })
      const inFlight = signIn(portOf(running))
      await held.started
      const done = running.shutdown()
      held.release()
      assert.deepEqual(await inFlight, { status: 201 })
      assert.equal(t.db.getStats().activeConnections, 1, 'the pool holds its client until the drain ends')
      await done
      await settle()
      assert.equal(t.db.getStats().activeConnections, 0)
      assert.deepEqual(t.u.requests, [])
    } finally {
      await t.stop()
    }
  })

  it('[server/hosting] Graceful shutdown: Grace limit, on the test database: no pool client after shutdown', async () => {
    const t = await onTestDatabase()
    try {
      // The pool has its client: the store answered before the request is held.
      assert.ok((await t.store.wards()).length > 0)
      const held = heldFetch(t.fetch)
      const running = await startServer({ fetch: held.fetch, store: t.store, host: '127.0.0.1', port: 0, graceMs: 100 })
      const inFlight = get(portOf(running))
      await held.started
      await running.shutdown()
      assert.ok((await inFlight).error, 'the held connection is closed')
      await settle()
      assert.equal(t.db.getStats().activeConnections, 0)
      held.release()
    } finally {
      await t.stop()
    }
  })

  it('[server/hosting] Graceful shutdown: Shutdown fails', async (t) => {
    const lines: string[] = []
    t.mock.method(console, 'error', (...a: unknown[]) => void lines.push(a.join(' ')))
    t.mock.method(console, 'log', (...a: unknown[]) => void lines.push(a.join(' ')))
    const codes: number[] = []
    const failing = { shutdown: () => Promise.reject(new TypeError('store /tmp/meniscus.db: patient Asha Rao')) }
    await stopOnSignal(failing, (code) => void codes.push(code))
    assert.deepEqual(codes, [1])
    assert.deepEqual(lines, ['[app] shutdown failed TypeError'])
    const ok = { shutdown: () => Promise.resolve() }
    await stopOnSignal(ok, (code) => void codes.push(code))
    assert.deepEqual(codes, [1, 0])
  })

  it('[server/hosting] Production needs the web build: a failing start check means nothing listens', async () => {
    const port = await freePort()
    const store = storeSpy()
    await assert.rejects(
      startServer({
        fetch: () => new Response('no'),
        store,
        host: '127.0.0.1',
        port,
        graceMs: 100,
        beforeListen: () => Promise.reject(new Error('WEB_DIST: no web build at /x/index.html; run pnpm build')),
      }),
      /WEB_DIST/,
    )
    assert.equal(await refused(port), true)
  })
})
