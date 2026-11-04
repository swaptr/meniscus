/**
 * Test helpers: the real @meniscus/meta client over a fake upstream, and the app over a test store (a fresh in-process
 * Postgres per call, `createTestDb()`). Never touches the network.
 */
import { afterEach } from 'node:test'
import { crc32 } from 'node:zlib'
import { RequestBudget, createMetaClient, type MetaClient } from '@meniscus/meta'
import type { ContainerReading } from '@meniscus/shared'
import { createAi } from './ai/pipeline.ts'
import { logRequests } from './model-api.ts'
import { createApp, type AppOptions } from './app.ts'
import { newToken, tokenHash } from './auth.ts'
import { createTestDb, type TestDb } from './db/testing.ts'
import type { MediaInput, Store } from './store/port.ts'
import { openPgStore, type PgStoreOptions } from './store/pg/store.ts'
import { sha256Hex } from './hash.ts'
import { createMemoryMediaStore, type MemoryMediaStore } from './store/media/memory.ts'

/** The staff member signed in for a test request that names nobody (Anita Thomas, nurse). */
export const DEFAULT_STAFF = 4

/** Test databases opened during the current test, closed after it (PGlite holds its memory until closed). */
const opened: TestDb[] = []
// Under the test runner only (it sets NODE_TEST_CONTEXT in each test file's process): a top-level hook of the file.
if (process.env.NODE_TEST_CONTEXT !== undefined) {
  afterEach(async () => {
    for (const h of opened.splice(0)) await h.close()
  })
}

/** A fresh, migrated test database, closed when the current test ends. */
export async function testDb(): Promise<TestDb> {
  const h = await createTestDb()
  opened.push(h)
  return h
}

/** The store on a fresh test database (seeded demo hospital), closed when the current test ends. */
export async function testStore(now?: () => number, opts: Omit<PgStoreOptions, 'now' | 'close'> = {}): Promise<Store> {
  const h = await testDb()
  return openPgStore(h.db, { ...opts, ...(now ? { now } : {}) })
}

/** A live session for `staffId`, created at `store.now()`; returns the `Cookie` header. */
export async function signIn(store: Store, staffId: number): Promise<string> {
  const token = newToken()
  await store.createSession(tokenHash(token), staffId)
  return `meniscus_session=${token}`
}

export interface RequestOptions {
  /** Signs this staff member in (when on the roster) and sends `X-Staff-Id`. */
  staff?: number | string
  /** Sent as is; null sends no cookie. Default: a fresh session, except to /api/session and /api/health. */
  cookie?: string | null
  /** The socket's remote address, as `getConnInfo` reads it from a Node request (default: none, keyed `local`). */
  remote?: string
}

/**
 * The app over a fresh test store (unless one is given), with a fake upstream unless `ai` is given.
 * Test defaults: demo sign-in on, no `Secure` cookie.
 *
 * `request` signs in for every request that carries no cookie, GETs included, except to /api/session and /api/health
 * (which need none, server/security "Signed-in reads"), at that moment on the store's clock, so tests that move
 * the clock never send an ended session. It signs in the staff member its `X-Staff-Id` names when they are on the
 * roster, else DEFAULT_STAFF (so an unknown id still gets its 400). A request given a cookie, or `cookie: null`, gets
 * exactly that.
 */
/** The two /api paths that need no session; `request` signs nobody in for them. */
const OPEN_PATHS = new Set(['/api/session', '/api/health'])

export async function testApp(o: Partial<AppOptions> = {}) {
  const store = o.store ?? (await testStore())
  const media = o.media ?? createMemoryMediaStore()
  const app = createApp({ demoLogin: true, secureCookie: false, ...o, ai: o.ai ?? upstream().ai, store, media })
  const request = async (path: string, init: RequestInit = {}, opts: RequestOptions = {}) => {
    const headers = new Headers(init.headers)
    if (opts.staff !== undefined) headers.set('x-staff-id', String(opts.staff))
    const open = OPEN_PATHS.has(new URL(path, 'http://localhost').pathname)
    if (typeof opts.cookie === 'string') headers.set('cookie', opts.cookie)
    else if (opts.cookie === undefined && !headers.has('cookie') && !open) {
      const raw = headers.get('x-staff-id')
      const named = raw !== null && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : undefined
      const roster = await store.staff()
      headers.set('cookie', await signIn(store, roster.some((s) => s.id === named) ? named! : DEFAULT_STAFF))
    }
    const env = opts.remote === undefined ? undefined : { incoming: { socket: { remoteAddress: opts.remote } } }
    return app.request(path, { ...init, headers }, env)
  }
  /** Keeps media as an upload would (its object, then its row); the app's media store must be the memory one. */
  const keep = (admissionId: number, input: KeptInput, staffId?: number | null) => {
    if (media.kind !== 'memory') throw new Error('keep needs the memory media store')
    return keepMedia(store, media as MemoryMediaStore, admissionId, input, staffId)
  }
  return { app, store, media, request, keep }
}

/** A media row's input with its bytes, as a test seeds it. */
export type KeptInput = Omit<MediaInput, 'sha256' | 'size'> & { bytes: Uint8Array }

/** The object in the memory media store, then the row (`store.addMedia`). */
export function keepMedia(store: Store, media: MemoryMediaStore, admissionId: number, input: KeptInput, staffId?: number | null) {
  const { bytes, ...rest } = input
  const sha256 = sha256Hex(bytes)
  media.objects.set(sha256, { bytes: bytes.slice(), mime: input.mime, lastModified: store.now() })
  return store.addMedia(admissionId, { ...rest, sha256, size: bytes.byteLength }, staffId)
}

/**
 * A production environment's media settings, for tests that load production config for another reason: the fake
 * S3's https endpoint (nothing is sent; config only).
 */
export const PROD_MEDIA_ENV = {
  MEDIA_STORE: 's3',
  S3_ENDPOINT: 'https://s3.test/storage/v1/s3',
  S3_REGION: 'local',
  S3_ACCESS_KEY_ID: 'ak-test-77bb',
  S3_SECRET_ACCESS_KEY: 'sk-test-55aa',
} as const
export type TestRequest = Awaited<ReturnType<typeof testApp>>['request']

export const reading = (over: Partial<ContainerReading> = {}): ContainerReading => ({
  container: 'urine_bag',
  fluid: 'urine',
  volume_ml: 450,
  capacity_ml: 2000,
  marks_visible: true,
  reading_basis: 'between 400 and 500',
  appearance: 'pale yellow, clear',
  confidence: 0.9,
  issues: [],
  ...over,
})

/** SAM 3.1 output sample from the @meta-sam/parser docs. */
export const SAM_TEXT =
  '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.9|>' +
  "<|mask;x=0;y=0;c=0.9;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n"

/** SAM output with one mask record per box (the fixture's raster re-boxed on a 1280 × 960 frame). Boxes are half-open. */
export const SAM_TEXT_AT = (...boxes: { left: number; top: number; right: number; bottom: number }[]) =>
  boxes
    .map((b, i) =>
      SAM_TEXT.replace('<0f>0', `<0f>${i}`).replace(
        'x1=211;y1=228;x2=270;y2=254;w=320;h=334',
        `x1=${b.left};y1=${b.top};x2=${b.right - 1};y2=${b.bottom - 1};w=1280;h=960`,
      ),
    )
    .join('')
/** One full one-bit mask (a 1 × 1 raster of 1) per half-open box: a dish or food filling its box exactly. */
export const SAM_RECT = (...boxes: { left: number; top: number; right: number; bottom: number }[]) =>
  boxes
    .map(
      (b, i) =>
        `<0f>${i}<|box;x1=${b.left};y1=${b.top};x2=${b.right - 1};y2=${b.bottom - 1};w=1000;h=800;c=0.9|>` +
        '<|mask;x=0;y=0;c=0.9;data=1,1,!!!!!&O.lVP|>\n',
    )
    .join('')
/** The image a SAM or Spark request body carries (its data URL), or null. */
export const imageOf = (body: Record<string, any>): string | null =>
  ((body.input?.[0]?.content as { type: string; image_url?: string }[] | undefined) ?? []).find((c) => c.type === 'input_image')
    ?.image_url ?? null
/** The data URL a pipeline sends for these bytes. */
export const dataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
/** SAM found nothing: an empty output text, a normal result. */
export const SAM_EMPTY = ''

export const msg = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
export const resp = (model: string, output: unknown[]) =>
  Response.json({
    id: 'r',
    object: 'response',
    status: 'completed',
    model,
    output,
    error: null,
    incomplete_details: null,
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  })

export interface Upstream {
  /** Gets the concept prompt and the whole request body. */
  sam?: (prompt: string, body: Record<string, any>) => Response
  spark?: (body: Record<string, any>) => Response
  /** Gets the transcribe request's JSON part (model, mode, …). */
  asr?: (request: Record<string, any>) => Response
  /** The client's request budget (default 50 per hour, 4 at once, no critical reserve). */
  budget?: { perHour: number; maxConcurrent?: number; reservePct?: number }
  /** The budget's clock (default Date.now). */
  clock?: () => number
  /** Receives the server's `[model-api]` line for each request (the app's own request hook). Default: dropped. */
  log?: (line: string) => void
}

/** Fake Meta API that records every request. Routes by path and model. */
export function upstream(over: Upstream = {}) {
  const requests: string[] = []
  /** The JSON body of every SAM and Spark request, in order. */
  const bodies: Record<string, any>[] = []
  /** The JSON part of each transcribe request, in order. */
  const asrRequests: Record<string, any>[] = []
  const fetch = ((url: string, init: RequestInit): Response | Promise<Response> => {
    const path = new URL(url).pathname
    if (path.endsWith('/models')) {
      requests.push('models')
      return Response.json({ object: 'list', data: [] })
    }
    if (path.endsWith('/asr/transcribe')) {
      requests.push('asr')
      return (async () => {
        const request = JSON.parse(await ((init.body as FormData).get('request') as Blob).text()) as Record<string, any>
        asrRequests.push(request)
        return (
          over.asr?.(request) ??
          Response.json({ sessionId: 's', transcript: 'bed 4 had a coconut water, 200 mL', audioDurationMs: 2000, turns: [] })
        )
      })()
    }
    const body = JSON.parse(init.body as string) as Record<string, any>
    bodies.push(body)
    if (body.model === 'sam-3.1') {
      const prompt = body.input[0].content[0].text as string
      requests.push(`sam:${prompt}`)
      return over.sam?.(prompt, body) ?? resp('sam-3.1', [msg(SAM_TEXT)])
    }
    requests.push(body.tools ? 'spark:tool' : 'spark:object')
    if (over.spark) return over.spark(body)
    if (body.tools) {
      return resp('muse-spark-1.3', [
        {
          type: 'function_call',
          call_id: 'c1',
          name: 'log_entry',
          arguments: JSON.stringify({ direction: 'in', category: 'water', volume_ml: 200, item: 'coconut water', notes: 'null' }),
        },
      ])
    }
    return resp('muse-spark-1.3', [msg(JSON.stringify(reading({ volume_ml: 1000, capacity_ml: 2000 })))])
  }) as unknown as typeof globalThis.fetch
  const budget = { perHour: 50, maxConcurrent: 4, ...over.budget }
  const requestBudget = new RequestBudget(budget, over.clock)
  const client: MetaClient = createMetaClient({
    apiKey: 'LLM_test',
    fetch,
    budget: requestBudget,
    onRequest: logRequests(() => requestBudget, over.log ?? (() => {})),
  })
  return { requests, bodies, asrRequests, client, ai: createAi(() => client) }
}

/** Records `n` requests as sent at the budget's current time, through a `high` ticket, with no fetch. */
export function useBudget(budget: RequestBudget, n: number) {
  if (n <= 0) return
  const ticket = budget.reserve(n, { priority: 'high', peak: 1 })
  for (let i = 0; i < n; i++) ticket.take()()
  ticket.release()
}

/** Holds `n` in-flight slots (each one a sent request) until the returned function is called. */
export function holdInFlight(budget: RequestBudget, n: number): () => void {
  const releases = Array.from({ length: n }, () => budget.acquire())
  return () => releases.forEach((r) => r())
}

export const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

/**
 * A PNG header of `w` × `h` (signature, IHDR, a `tEXt` chunk holding `seed`, IEND): enough for the upload sniff and
 * `imageSize`. Different seeds give different bytes, so different SHA-256s. Staged bytes, no picture.
 */
export function png(w: number, h: number, seed = 0): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length)
    const v = new DataView(out.buffer)
    v.setUint32(0, data.length)
    const typed = new Uint8Array([...type].map((c) => c.charCodeAt(0)))
    out.set(typed, 4)
    out.set(data, 8)
    v.setUint32(8 + data.length, crc32(Buffer.concat([typed, data])))
    return out
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', new TextEncoder().encode(`seed\0${seed}`)),
    chunk('IEND', new Uint8Array()),
  ])
}

/** 0.1 s of 16 kHz mono silence, as a browser might upload after recording. */
/** Silent 16 kHz mono 16-bit WAV lasting `ms` (default 100 ms, 1600 samples). */
export function silenceWav(ms = 100): Uint8Array {
  const n = (ms * 16000) / 1000
  const b = new Uint8Array(44 + n * 2)
  const v = new DataView(b.buffer)
  const put = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  put(36, 'data')
  v.setUint32(40, n * 2, true)
  return b
}
