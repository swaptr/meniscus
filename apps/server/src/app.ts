import { Hono, type Context } from 'hono'
import { except } from 'hono/combine'
import { HTTPException } from 'hono/http-exception'
import { MetaApiError, MetaResponseError } from '@meniscus/meta'
import { createAi, type Ai } from './ai/pipeline.ts'
import { livePorts } from './ai/ports.ts'
import { aiErrorStatus, aiRoutes, type StatusClient } from './routes/ai.ts'
import { metaClient } from './model-api.ts'
import { bagRoutes } from './routes/bags.ts'
import { careRoutes } from './routes/care.ts'
import { nutritionRoutes } from './routes/nutrition.ts'
import { chartRoutes } from './routes/chart.ts'
import { notFound, session } from './routes/common.ts'
import { mediaRoutes } from './routes/media.ts'
import { metricsRoutes, type BudgetSource } from './routes/metrics.ts'
import { createMetrics } from './metrics.ts'
import { qualityRoutes } from './routes/quality.ts'
import { sessionRoutes } from './routes/session.ts'
import type { Store } from './store/port.ts'
import { createMediaGc, type MediaLog } from './media-gc.ts'
import { createMemoryMediaStore } from './store/media/memory.ts'
import { MediaStoreError, type MediaStore } from './store/media/port.ts'
import { headers, noStore, rateLimit, sameSite } from './security.ts'
import { webApp } from './web.ts'

export interface AppOptions {
  ai?: Ai
  /** The client `GET /api/ai/status` lists models with (default: the app's one Meta client). Tests pass the fake's. */
  statusClient?: StatusClient
  /** Chart store (Postgres; tests use `createTestDb()`). */
  store: Store
  /** Per-client /api/ai/* requests per rolling minute; separately, as many password checks. */
  rateLimitPerMinute?: number
  /** The rate limiter's clock. Sessions and shifts use the store's. */
  now?: () => number
  /** List the demo accounts and accept demo passwords (off by default; on outside production, see `appFlags`). */
  demoLogin?: boolean
  /** Mark the session cookie `Secure` (on by default; production). Over HTTPS it is marked anyway. */
  secureCookie?: boolean
  /** Proxies whose forwarded headers are trusted (server/security "Trusted proxy hops"; default 0). */
  trustProxyHops?: number
  /** Serve this web build outside /api (server/hosting). Omitted: /api only (tests, development without a build). */
  webDist?: string | undefined
  /** Where media bytes live (server/storage); in-memory when omitted, as the store is. */
  media?: MediaStore
  /** Media store failure lines (default: stderr). Tests capture them. */
  mediaLog?: MediaLog
  /** The model request budget `GET /api/metrics` reports (default: the app's one Meta client's). Tests pass the fake's. */
  modelBudget?: BudgetSource
}

export function createApp({
  ai = createAi(livePorts),
  statusClient = metaClient,
  store,
  rateLimitPerMinute = 20,
  now,
  demoLogin = false,
  secureCookie = true,
  trustProxyHops = 0,
  webDist,
  media = createMemoryMediaStore(),
  mediaLog,
  modelBudget = () => metaClient().budget,
}: AppOptions) {
  // Objects whose last media row a request deleted are deleted before it answers (charting/media).
  const gc = createMediaGc(store, media, mediaLog)
  store.watchMediaGone(gc.onMediaGone)
  const io = { store, media, gc, log: mediaLog }
  // Order matters: the session before the limiters, so callers without one can't use up a client's quota. Every
  // request needs a session (except to /api/session; /api/health is outside). Then cross-site form posts are refused.
  const guarded = [noStore(), session(store), sameSite(trustProxyHops)]
  // Password checks get their own bucket of the same size. No account lockout: it would lock staff out mid-shift.
  const passwordChecks = rateLimit(rateLimitPerMinute, now, trustProxyHops)
  // Counted first, so every answer is, refusals and 404s included (server/metrics).
  const metrics = createMetrics()
  const api = new Hono()
    .basePath('/api')
    .use(except('/api/health', ...guarded, gc.middleware))
    .use('/ai/*', rateLimit(rateLimitPerMinute, now, trustProxyHops))
    .post('/session', passwordChecks)
    .post('/wards/:id/access', passwordChecks)
    // server/hosting "Health check": no store, no clock, no model.
    .get('/health', (c) => c.json({ ok: true }))
    .route('/', sessionRoutes(store, { demoLogin, secureCookie, trustProxyHops }))
    .route('/ai', aiRoutes(ai, store, io, statusClient))
    .route('/', chartRoutes(store, { demoLogin, io }))
    .route('/', qualityRoutes(store))
    .route('/', careRoutes(store))
    .route('/', nutritionRoutes(store))
    .route('/', bagRoutes(store))
    .route('/', mediaRoutes(store, io))
    .route('/', metricsRoutes(store, metrics, modelBudget))
    .onError(onError)
  // The root: security headers on every response, then /api, then the web build. Nothing outside /api is answered by
  // an API route, and the web handler skips /api, so an unknown API path is a JSON 404 (or 401), never the web app.
  const root = new Hono().use(metrics.middleware).use(headers()).route('/', api)
  if (webDist !== undefined) root.use('*', webApp(webDist))
  return root
    .notFound((c) => (c.req.path === '/api' || c.req.path.startsWith('/api/') ? c.json(notFound, 404) : c.text('Not Found', 404)))
    .onError(onError)
}

/** Every error the app answers: HTTP exceptions as thrown, model errors mapped, anything else a bare 500. */
function onError(err: Error, c: Context) {
  if (err instanceof HTTPException) return err.getResponse()
  // Logged where it happened, with its media id (charting/media "Media store logs nothing identifying").
  if (err instanceof MediaStoreError) return c.json({ error: 'media_unavailable' }, 503)
  const mapped = aiErrorStatus(err)
  if (mapped) {
    // Status, our code, class and upstream code only: the message can echo the note (model-api/client "Server log lines").
    const upstream = err instanceof MetaApiError || err instanceof MetaResponseError ? err.code : undefined
    const code = upstream ? ` ${upstream}` : ''
    console.error(`[ai] ${mapped.status} ${mapped.body.error} ${err.name}${code}`)
    if (mapped.body.retry_after_ms !== undefined) {
      const secs = Math.ceil(Number(mapped.body.retry_after_ms) / 1000)
      // A local refusal always names a wait of at least 1 s (model-api/http-errors "Local budget refusal").
      c.header('Retry-After', String(mapped.body.error === 'request_budget_exceeded' ? Math.max(1, secs) : secs))
    }
    return c.json(mapped.body, mapped.status)
  }
  console.error(unhandledLogLine(err))
  return c.json({ error: 'internal_error' }, 500)
}

/**
 * The unhandled-error line: the error class and up to 3 stack frames, never the message. A stack starts with
 * `Name: message`, and a multi-line message spans several lines, so only lines that are frames (`at …`) are kept
 * (model-api/client "Server log lines").
 */
export function unhandledLogLine(err: Error): string {
  const frames = (err.stack ?? '')
    .split('\n')
    .filter((l) => /^\s+at /.test(l))
    .slice(0, 3)
  return [`[app] unhandled ${err.name}`, ...frames].join('\n')
}
