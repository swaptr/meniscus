/** The app's single Meta Model API client, built from validated config. */
import { MetaApiError, createMetaClient, type MetaClient, type RequestBudget, type RequestEvent, type Result } from '@meniscus/meta'
import type { CallTrace } from '@meniscus/shared'
import { config } from './config.ts'

export const MODELS = {
  spark: config.SPARK_MODEL,
  sam: config.SAM_MODEL,
  asr: config.ASR_MODEL,
} as const

export class ModelApiNotConfiguredError extends Error {
  override name = 'ModelApiNotConfiguredError'
}

let client: MetaClient | undefined

/** Lazy so the server boots (and tests run) without a key; calls then fail with a clear 503. */
export function metaClient(): MetaClient {
  if (client) return client
  if (!config.MODEL_API_KEY) throw new ModelApiNotConfiguredError('MODEL_API_KEY is not set')
  client = createMetaClient({
    apiKey: config.MODEL_API_KEY,
    baseURL: config.MODEL_API_BASE_URL,
    timeoutMs: config.MODEL_API_TIMEOUT_MS,
    budget: {
      perHour: config.MODEL_API_MAX_REQUESTS_PER_HOUR,
      maxConcurrent: config.MODEL_API_MAX_CONCURRENT,
      reservePct: config.CRITICAL_RESERVE_PCT,
    },
    models: { sam: MODELS.sam, asr: MODELS.asr },
    onRequest: logRequests(() => client?.budget),
  })
  return client
}

type LogStats = Pick<ReturnType<RequestBudget['stats']>, 'total' | 'lastHour' | 'perHour'>

/**
 * The one `[model-api]` line per upstream request (model-api/client "Server log lines"): method, path, model, status,
 * ms, local budget counts, upstream headroom, and on failure the error class and upstream code. Never the error message,
 * which can echo what was sent.
 */
export function requestLogLine(e: RequestEvent, s: LogStats | undefined): string {
  const pair = (rem: number | undefined, lim: number | undefined, unit: string) =>
    rem === undefined && lim === undefined ? '' : ` ${rem ?? '?'}/${lim ?? '?'} ${unit}`
  const h = e.rateLimit
  const up = h ? pair(h.remainingRequests, h.limitRequests, 'req') + pair(h.remainingTokens, h.limitTokens, 'tok') : ''
  const code = e.error instanceof MetaApiError && e.error.code ? ` ${e.error.code}` : ''
  const tail = e.error ? ` ✗ ${e.error.name}${code}` : ''
  return (
    `[model-api] ${e.method} ${e.path} ${e.model ?? ''} ${e.status ?? '—'} ${e.ms}ms ` +
    `(#${s?.total}, ${s?.lastHour}/${s?.perHour} per h)${up ? ` upstream${up}` : ''}${tail}`
  )
}

/** The request hook every client in this app uses: one `requestLogLine` per request, after it settles. */
export function logRequests(budget: () => RequestBudget | undefined, log: (line: string) => void = (l) => console.log(l)) {
  return (e: RequestEvent) => log(requestLogLine(e, budget()?.stats()))
}

/** One upstream call's latency and token usage, for responses, logs and evals. */
export function traceOf(step: string, r: Pick<Result, 'response' | 'usage' | 'ms'>): CallTrace {
  return {
    step,
    model: r.response.model,
    ms: r.ms,
    input_tokens: r.usage?.input_tokens,
    output_tokens: r.usage?.output_tokens,
    reasoning_tokens: r.usage?.output_tokens_details?.reasoning_tokens,
  }
}
