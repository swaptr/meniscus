/**
 * HTTP guards: security headers, no-store, cross-site form posts, per-client rate limit.
 * Every guard answers before any model request is made.
 */
import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context, MiddlewareHandler } from 'hono'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'

export const headers = (): MiddlewareHandler => secureHeaders({ xFrameOptions: 'DENY' })

export const noStore = (): MiddlewareHandler => async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
}

/**
 * The client's address (server/security "Trusted proxy hops"). With `hops` 0 it is the socket's. With `hops` n ≥ 1 it
 * is the n-th `X-Forwarded-For` entry from the right (each proxy appends the address it saw), or the socket's when the
 * header has fewer entries; entries left of it are client-chosen and never used. Express's numeric `trust proxy` rule.
 */
export function clientAddress(c: Context, hops: number): string {
  if (hops > 0) {
    const entries = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e !== '')
    if (entries.length >= hops) return entries[entries.length - hops]!
  }
  return socketAddress(c)
}

function socketAddress(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'local'
  } catch {
    return 'local' // no Node socket (app.request in tests)
  }
}

/**
 * The request's protocol (server/security "Forwarded protocol"): with `hops` ≥ 1, the last `X-Forwarded-Proto` value
 * when it is `http` or `https`; otherwise the socket's (`@hono/node-server` builds the URL with `https:` over TLS).
 */
export function requestProtocol(c: Context, hops: number): 'http' | 'https' {
  if (hops > 0) {
    const last = (c.req.header('x-forwarded-proto') ?? '').split(',').at(-1)?.trim().toLowerCase()
    if (last === 'http' || last === 'https') return last
  }
  return new URL(c.req.url).protocol === 'https:' ? 'https' : 'http'
}

/** The Vite dev server, which proxies /api; through it the request's own origin is usually the same anyway. */
export const DEV_WEB_ORIGIN = 'http://localhost:5173'

/**
 * Cross-site form posts (CSRF), with Hono's `csrf()`: a non-GET with a form content type (multipart, URL-encoded, plain
 * text or none) passes only with `Sec-Fetch-Site: same-origin` or an `Origin` that is the request's own (its protocol
 * per `requestProtocol`, its `Host` as received) or the dev web origin; else 403. JSON is left to CORS (no CORS headers
 * are sent, so no cross-site JSON is ever sent). A request with neither header is not from a browser, so not a CSRF:
 * scripts and tests still need a session.
 */
export function sameSite(hops = 0): MiddlewareHandler {
  const own = (c: Context) => `${requestProtocol(c, hops)}://${new URL(c.req.url).host}`
  const check = csrf({ origin: (origin, c) => origin === own(c) || origin === DEV_WEB_ORIGIN })
  return async (c, next) => {
    if (c.req.header('origin') === undefined && c.req.header('sec-fetch-site') === undefined) return next()
    return check(c, next)
  }
}

const WINDOW_MS = 60_000
const SWEEP_AT = 10_000

/** At most `limit` requests per client (`clientAddress`) per rolling minute; 429 + Retry-After beyond that. */
export function rateLimit(limit: number, now: () => number = Date.now, hops = 0): MiddlewareHandler {
  const hits = new Map<string, number[]>()
  return async (c, next) => {
    const t = now()
    if (hits.size > SWEEP_AT) {
      for (const [k, v] of hits) if (v.every((h) => t - h >= WINDOW_MS)) hits.delete(k)
    }
    const key = clientAddress(c, hops)
    const recent = (hits.get(key) ?? []).filter((h) => t - h < WINDOW_MS)
    if (recent.length >= limit) {
      hits.set(key, recent)
      const waitMs = WINDOW_MS - (t - recent[0]!)
      c.header('Retry-After', String(Math.max(1, Math.ceil(waitMs / 1000))))
      return c.json({ error: 'rate_limited' }, 429)
    }
    recent.push(t)
    hits.set(key, recent)
    await next()
    return undefined
  }
}

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/webp': (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
  'image/gif': (b) => ascii(b, 0, 4) === 'GIF8',
}
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to))

/** True when the bytes start with the file signature of `type`. */
export function matchesSignature(type: string, head: Uint8Array): boolean {
  return SIGNATURES[type]?.(head) ?? false
}
