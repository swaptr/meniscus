/**
 * HTTP surface for the AI pipelines. Parsing, the bed lookup and status mapping only; no model logic. The bed's acuity is
 * computed fresh and passed to the pipeline, whose budget policy (ai/budget-policy.ts) classes and admits the action.
 */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  CONTAINER_KINDS,
  MEAL_KINDS,
  READ_MODES,
  type AcuityStatus,
  type AudioTooLong,
  type BudgetRefusal,
  type Logged,
  type MealReadResult,
} from '@meniscus/shared'
import {
  AudioTooLongError,
  InvalidAudioError,
  MetaApiError,
  MetaBudgetError,
  MetaConnectionError,
  MetaError,
  MetaOutputError,
  MetaResponseError,
  MetaTimeoutError,
  type MetaClient,
} from '@meniscus/meta'
import { AudioConversionError } from '../ai/audio.ts'
import { MODELS, ModelApiNotConfiguredError, metaClient } from '../model-api.ts'
import type { Ai } from '../ai/pipeline.ts'
import { ImageFile, validate } from './validate.ts'
import { chartView } from '../chart/view.ts'
import { explainContext } from '../ai/explain.ts'
import { readRow, type ReadRow } from '../ai/read-log.ts'
import type { Store } from '../store/port.ts'
import { classOf } from '../ai/budget-policy.ts'
import { servedCheck } from '../ai/compare.ts'
import { notFound, type Env } from './common.ts'
import { readBytes, type MediaIo } from './media-io.ts'

const MAX_AUDIO = 25 * 1024 * 1024 // API cap is 32 MB after WAV conversion

/** An admission id sent as a form field; read by the route only, never passed to a pipeline. */
const FormId = z
  .string()
  .regex(/^[1-9]\d{0,15}$/, 'admission_id must be a positive integer')
  .transform(Number)

const ReadForm = z.object({
  image: ImageFile,
  hint: z.enum(CONTAINER_KINDS).optional(),
  mode: z.enum(READ_MODES).optional(),
  admission_id: FormId.optional(),
})

const AudioForm = z.object({
  audio: z.instanceof(File).refine((f) => f.size > 0 && f.size <= MAX_AUDIO, 'audio must be 1 B – 25 MB'),
  /** Comma-separated language bias, passed through as `languageBias`. The docs want language names ("English,Hindi"). */
  languages: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .optional(),
  admission_id: FormId.optional(),
})

/** A tray read may name its bed, and with it the meal, to find the served photo (capture/meal-reading "Tray reads name their bed"). */
const MealForm = z
  .object({ image: ImageFile, mode: z.enum(READ_MODES).optional(), admission_id: FormId.optional(), meal: z.enum(MEAL_KINDS).optional() })
  .refine((f) => f.meal === undefined || f.admission_id !== undefined, { path: ['meal'], message: 'meal needs admission_id' })

const NoteBody = z.object({ text: z.string().trim().min(1).max(4000), admission_id: z.number().int().positive().optional() })

/** zod validation with one error envelope: 400 {error, issues[{path, message}]}. */
const bytes = async (f: File) => new Uint8Array(await f.arrayBuffer())

const ExplainBody = z.object({ admission_id: z.number().int().positive() }).strict()

/** What `GET /api/ai/status` needs: one `models.list` call, through the client's own budget at normal priority. */
export type StatusClient = () => { models: Pick<MetaClient['models'], 'list'> }

export function aiRoutes(ai: Ai, store: Store, io: MediaIo, statusClient: StatusClient = metaClient) {
  /**
   * The named bed's acuity, fresh (null with no `admission_id`), or undefined for an id naming no bed: checked after the
   * body and before any model request. Sets only the budget class; nothing of it is sent upstream.
   */
  const bedStatus = async (admissionId: number | undefined): Promise<AcuityStatus | null | undefined> => {
    if (admissionId === undefined) return null
    const admission = await store.admission(admissionId)
    return admission && (await chartView(store, admission)).acuity
  }
  /** After the pipeline returned: one read in the log, its id on the response. A thrown pipeline error stores nothing. */
  const logged = async <T extends object>(result: T, row: ReadRow): Promise<Logged<T>> => ({
    ...result,
    read_id: await store.recordRead(row),
  })

  return new Hono<Env>()
    .use(bodyLimit({ maxSize: MAX_AUDIO + 1024 * 1024 }))
    .get('/status', async (c) => {
      // Confirms the key works and every model we depend on is enabled for this team.
      const ids = new Set((await statusClient().models.list({ signal: c.req.raw.signal })).map((m) => m.id))
      return c.json({ models: MODELS, enabled: Object.fromEntries(Object.values(MODELS).map((id) => [id, ids.has(id)])) })
    })
    .post('/read', validate('form', ReadForm), async (c) => {
      const { image, hint, mode, admission_id } = c.req.valid('form')
      const status = await bedStatus(admission_id)
      if (status === undefined) return c.json(notFound, 404)
      const result = await ai.readCapture({ image: await bytes(image), mime: image.type, hint, mode, status, signal: c.req.raw.signal })
      return c.json(await logged(result, readRow('photo', result, { staffId: c.get('staffId')!, admissionId: admission_id, hint })))
    })
    .post('/meal', validate('form', MealForm), async (c) => {
      const { image, mode, admission_id, meal } = c.req.valid('form')
      const status = await bedStatus(admission_id)
      if (status === undefined) return c.json(notFound, 404)
      const bytesOf = await bytes(image)
      // This bed's newest unlinked served photo of this meal in the window; its bytes are loaded once. Only the bytes
      // reach the pipeline: the bed and meal are never sent upstream.
      const ref = admission_id !== undefined && meal !== undefined ? await store.servedPhoto(admission_id, meal) : undefined
      // 1 media store GET before any model request; a failed one is 503 media_unavailable with 0 model requests.
      const kept = ref && (await store.media(ref.id)) && (await readBytes(io, ref))
      const served = ref &&
        kept && {
          bytes: kept,
          mime: ref.mime,
          check: servedCheck(bytesOf, image.type, { bytes: kept, mime: ref.mime, sha256: ref.sha256 }),
        }
      // Exactly 3 model requests in sam+spark mode (SAM dish, SAM food, Spark), 5 with a compared served photo, 1 in
      // spark mode, 0 when refused; never retried. The bed sets the class; with no bed, routine.
      const r = await ai.readMeal({ image: bytesOf, mime: image.type, mode, status, served: served || undefined, signal: c.req.raw.signal })
      const result: MealReadResult = {
        ...r,
        comparison: r.comparison && ref ? { served_media_id: ref.id, served_at: ref.created_at, ...r.comparison } : null,
      }
      // One insert after the model calls: the read log (charting/model-accuracy "Tray reads are logged").
      return c.json(await logged(result, readRow('tray', result, { staffId: c.get('staffId')!, admissionId: admission_id })))
    })
    .post('/note', validate('json', NoteBody), async (c) => {
      const { text, admission_id } = c.req.valid('json')
      const status = await bedStatus(admission_id)
      if (status === undefined) return c.json(notFound, 404)
      const result = await ai.parseNote({ text, status, signal: c.req.raw.signal })
      return c.json(await logged(result, readRow('text', result, { staffId: c.get('staffId')!, admissionId: admission_id })))
    })
    .post('/explain', validate('json', ExplainBody), async (c) => {
      const admission = await store.admission(c.req.valid('json').admission_id)
      const list = admission && (await store.entries(admission.id))
      if (!admission || !list) return c.json({ error: 'not_found' }, 404)
      // The same prompt list as the chart; the context lines stay the last 24 h.
      const { alerts, acuity } = await chartView(store, admission)
      const recent = await store.recent(admission.id)
      if (!alerts.length) return c.json({ error: 'no_alerts' }, 409)
      const context = explainContext(admission, list.totals, alerts, recent, store.now())
      return c.json(await ai.explainAlerts({ context, status: acuity, signal: c.req.raw.signal }))
    })
    .post('/voice-note', validate('form', AudioForm), async (c) => {
      const { audio, languages, admission_id } = c.req.valid('form')
      const status = await bedStatus(admission_id)
      if (status === undefined) return c.json(notFound, 404)
      const result = await ai.voiceNote({ audio: await bytes(audio), languages, status, signal: c.req.raw.signal })
      return c.json(await logged(result, readRow('voice', result, { staffId: c.get('staffId')!, admissionId: admission_id })))
    })
}

type Mapped = {
  status: 400 | 422 | 429 | 502 | 503 | 504
  body: { error: string; message: string; retryable: boolean } & Record<string, unknown>
}

/**
 * Map model-API and audio errors to HTTP. Upstream detail is kept for
 * debugging, but upstream 401/403 become 502: they are our misconfiguration,
 * not the caller's auth problem.
 */
export function aiErrorStatus(err: Error): Mapped | null {
  const m = (status: Mapped['status'], error: string, retryable: boolean, extra: Record<string, unknown> = {}): Mapped => ({
    status,
    body: { error, message: err.message, retryable, ...extra },
  })
  if (err instanceof ModelApiNotConfiguredError) return m(503, 'model_api_not_configured', false)
  if (err instanceof AudioTooLongError) {
    // capture/notes "Recording length limit": nothing was sent; the same clip would be refused again.
    const body: AudioTooLong = {
      error: 'audio_too_long',
      message: err.message,
      retryable: false,
      duration_ms: err.durationMs,
      limit_ms: 600000,
    }
    return { status: 422, body: { ...body } }
  }
  if (err instanceof AudioConversionError || err instanceof InvalidAudioError) return m(422, 'invalid_audio', false)
  if (!(err instanceof MetaError)) return null
  if (err instanceof MetaBudgetError) {
    // model-api/http-errors "Local budget refusal": nothing was sent; the client may read again after retry_after_ms.
    const body: BudgetRefusal = {
      error: 'request_budget_exceeded',
      message: err.message,
      retryable: true,
      limit: err.limit,
      budget_class: classOf(err.priority),
      retry_after_ms: err.retryAfterMs,
    }
    return { status: 429, body: { ...body } }
  }
  if (err instanceof MetaTimeoutError) return m(504, 'model_api_timeout', err.retryable)
  if (err instanceof MetaConnectionError) return m(502, 'model_api_unreachable', err.retryable)
  if (err instanceof MetaApiError) {
    const status = err.status === 429 ? 429 : err.status === 503 ? 503 : err.status === 504 ? 504 : 502
    return m(status, 'model_api_error', err.retryable, {
      upstream_status: err.status,
      code: err.code ?? null,
      ...(err.retryAfterMs !== undefined && { retry_after_ms: err.retryAfterMs }),
    })
  }
  if (err instanceof MetaResponseError) return m(502, 'model_response_unusable', false, { code: err.code ?? null })
  if (err instanceof MetaOutputError) return m(502, 'model_output_invalid', false, { issues: err.issues })
  return m(502, 'model_api_error', err.retryable)
}
