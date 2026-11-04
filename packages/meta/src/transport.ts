import { type RequestBudget, type Ticket, ticketBudget } from './budget.ts'
import { MetaApiError, MetaConnectionError, MetaContentPolicyError, type MetaError, MetaTimeoutError } from './errors.ts'

/**
 * Upstream's own rate-limit window, from the `x-ratelimit-*` headers (https://dev.meta.ai/docs/pricing-rate-limits).
 * Each field only when sent as a whole number.
 */
export interface RateLimitHeadroom {
  limitRequests?: number
  remainingRequests?: number
  limitTokens?: number
  remainingTokens?: number
}

export interface RequestEvent {
  method: string
  path: string
  /** Model the request targets, when known. */
  model?: string
  /** HTTP status; undefined when no response arrived. */
  status?: number
  ms: number
  error?: MetaError
  /** Absent when the reply carried no readable `x-ratelimit-*` header (always for speech-to-text). Reported only, never a gate. */
  rateLimit?: RateLimitHeadroom
}

export interface TransportOptions {
  apiKey: string
  baseURL: string
  timeoutMs: number
  budget: RequestBudget
  fetch: typeof fetch
  /** Called once per request after it settles (success or failure). */
  onRequest?: (e: RequestEvent) => void
}

export interface RequestInit {
  method: 'GET' | 'POST'
  path: string
  model?: string
  json?: unknown
  form?: FormData
  signal?: AbortSignal
  /** The action's reservation: the request takes its slot from it instead of acquiring one. */
  ticket?: Ticket
  /** This request's timeout, replacing the client's. Only image calls set it. */
  timeoutMs?: number
}

export interface Timed<T> {
  data: T
  ms: number
}

/**
 * One HTTP request, one upstream call: budget slot (the ticket's, or its own) → fetch with timeout →
 * error normalisation → JSON. No retries, ever.
 */
export function createTransport(o: TransportOptions) {
  const base = o.baseURL.replace(/\/+$/, '')

  return async function request<T>(init: RequestInit): Promise<Timed<T>> {
    init.signal?.throwIfAborted()
    const timeoutMs = init.timeoutMs ?? o.timeoutMs
    const timeout = AbortSignal.timeout(timeoutMs)
    if (init.ticket && ticketBudget(init.ticket) !== o.budget) throw new Error('ticket from another budget')
    const release = init.ticket ? init.ticket.take() : o.budget.acquire()
    const t0 = performance.now()
    const endpoint = `${init.method} ${init.path}`
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    let status: number | undefined
    let error: MetaError | undefined
    let rateLimit: RateLimitHeadroom | undefined

    try {
      let res: Response
      try {
        res = await o.fetch(`${base}${init.path}`, {
          method: init.method,
          headers: {
            Authorization: `Bearer ${o.apiKey}`,
            Accept: 'application/json',
            ...(init.json !== undefined && { 'Content-Type': 'application/json' }),
          },
          body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
          signal,
        })
      } catch (err) {
        throw (error = fetchFailure(err, init.signal, timeout, timeoutMs, endpoint))
      }
      status = res.status
      rateLimit = headroom(res.headers)

      let text: string
      try {
        text = await res.text()
      } catch (err) {
        throw (error = fetchFailure(err, init.signal, timeout, timeoutMs, endpoint))
      }
      if (!res.ok) throw (error = apiError(res, text, endpoint))

      try {
        return { data: JSON.parse(text) as T, ms: Math.round(performance.now() - t0) }
      } catch {
        throw (error = new MetaApiError(
          `invalid JSON from ${endpoint}`,
          res.status,
          undefined,
          'invalid_json',
          undefined,
          undefined,
          endpoint,
        ))
      }
    } finally {
      release()
      const ms = Math.round(performance.now() - t0)
      o.onRequest?.({ method: init.method, path: init.path, model: init.model, status, ms, error, ...(rateLimit && { rateLimit }) })
    }
  }
}

export type Request = ReturnType<typeof createTransport>

const RATE_LIMIT_HEADERS = {
  limitRequests: 'x-ratelimit-limit-requests',
  remainingRequests: 'x-ratelimit-remaining-requests',
  limitTokens: 'x-ratelimit-limit-tokens',
  remainingTokens: 'x-ratelimit-remaining-tokens',
} as const satisfies Record<keyof RateLimitHeadroom, string>

/**
 * The `x-ratelimit-*` headers (https://dev.meta.ai/docs/pricing-rate-limits), or undefined when none is readable.
 * Assumption (the docs give no format): plain decimal integers, possibly on error replies too. Anything that is not a
 * whole number is dropped.
 */
export function headroom(headers: Headers): RateLimitHeadroom | undefined {
  let out: RateLimitHeadroom | undefined
  for (const [key, name] of Object.entries(RATE_LIMIT_HEADERS) as [keyof RateLimitHeadroom, string][]) {
    const v = headers.get(name)?.trim()
    if (v && /^\d+$/.test(v)) (out ??= {})[key] = Number(v)
  }
  return out
}

function fetchFailure(err: unknown, caller: AbortSignal | undefined, timeout: AbortSignal, timeoutMs: number, endpoint: string): MetaError {
  // Caller cancellation is theirs to handle: rethrow their reason untouched.
  if (caller?.aborted) throw caller.reason
  if (timeout.aborted) return new MetaTimeoutError(timeoutMs, endpoint)
  return new MetaConnectionError(`network error calling ${endpoint}: ${err instanceof Error ? err.message : String(err)}`, endpoint, {
    cause: err,
  })
}

/**
 * Envelope: {"error":{"message","type","param","code"}}. Unknown paths return an empty 404.
 * `content_policy_violation` (any endpoint; https://dev.meta.ai/docs/error-handling) → MetaContentPolicyError.
 */
function apiError(res: Response, text: string, endpoint: string): MetaApiError {
  let e: { message?: string; type?: string; code?: string; param?: string } | undefined
  try {
    const body = JSON.parse(text) as { error?: typeof e } & NonNullable<typeof e>
    e = body.error ?? body
  } catch {
    // Not JSON (e.g. an empty 404): fall back to the raw text below.
  }
  const message = e?.message || text.slice(0, 500) || res.statusText || 'request failed'
  const Err = e?.code === 'content_policy_violation' ? MetaContentPolicyError : MetaApiError
  return new Err(
    `${endpoint} → ${res.status}: ${message}`,
    res.status,
    e?.type,
    e?.code ?? undefined,
    e?.param ?? undefined,
    parseRetryAfter(res.headers.get('retry-after')),
    endpoint,
  )
}

/** Docs show integer seconds; HTTP-date is accepted too. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined
  const secs = Number(v)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const at = Date.parse(v)
  return Number.isNaN(at) ? undefined : Math.max(0, at - now)
}
