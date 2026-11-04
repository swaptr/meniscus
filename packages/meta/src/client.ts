import { createAsr } from './asr.ts'
import { RequestBudget, type BudgetOptions } from './budget.ts'
import { MetaError } from './errors.ts'
import { createImages } from './images.ts'
import { createResponses, type CallOptions } from './responses.ts'
import { createSam } from './sam.ts'
import { createTransport, type RequestEvent } from './transport.ts'

export interface MetaClientOptions {
  apiKey: string
  /** Default https://api.meta.ai/v1 */
  baseURL?: string
  /** Per-request timeout. Default 90 s. */
  timeoutMs?: number
  /** Request budget; default 120/hour, 4 concurrent. Pass a shared RequestBudget to pool limits. */
  budget?: RequestBudget | BudgetOptions
  /** Server-side retention default for Responses calls. Default false (API default is true). */
  store?: boolean
  /** Default models per capability. */
  models?: { sam?: string; asr?: string; image?: string }
  /** Hook called once per HTTP request after it settles: logging, metrics. */
  onRequest?: (e: RequestEvent) => void
  /** Injectable for tests. */
  fetch?: typeof fetch
}

export interface Model {
  id: string
  object: 'model'
  created: number
  owned_by: string
  /** Only with a recognised `client` query parameter, which this client never sends (https://dev.meta.ai/docs/api-reference/models/schemas). */
  metadata?: Record<string, unknown>
}

/**
 * Meta Model API client. Every method makes exactly one HTTP request, never
 * retries, and goes through the request budget.
 */
export function createMetaClient(o: MetaClientOptions) {
  if (!o.apiKey) throw new MetaError('Meta Model API key is required')
  const budget = o.budget instanceof RequestBudget ? o.budget : new RequestBudget(o.budget ?? { perHour: 120, maxConcurrent: 4 })
  const request = createTransport({
    apiKey: o.apiKey,
    baseURL: o.baseURL ?? 'https://api.meta.ai/v1',
    timeoutMs: o.timeoutMs ?? 90_000,
    budget,
    fetch: o.fetch ?? globalThis.fetch,
    onRequest: o.onRequest,
  })
  const responses = createResponses(request, { store: o.store ?? false })

  return {
    responses,
    sam: createSam(responses, o.models?.sam ?? 'sam-3.1'),
    asr: createAsr(request, o.models?.asr ?? 'muse-voice-transcribe-1.0'),
    images: createImages(request, o.models?.image ?? 'muse-image-1.0'),
    models: {
      /** Models enabled for this key's team, newest first. */
      async list(opts: CallOptions = {}): Promise<Model[]> {
        const { data } = await request<{ data: Model[] }>({ method: 'GET', path: '/models', signal: opts.signal, ticket: opts.ticket })
        return data.data
      },
    },
    budget,
  }
}

export type MetaClient = ReturnType<typeof createMetaClient>
