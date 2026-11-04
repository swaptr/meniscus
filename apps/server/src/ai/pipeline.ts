/**
 * Capture pipelines. Orchestration only: prompts/contracts live in reading.ts,
 * meal.ts and notes.ts, geometry in segmentation.ts and tray.ts, transport in @meniscus/meta.
 *
 *   photo ─► SAM(container) ┐
 *           SAM(liquid)    ─┴► locate() ─► Spark(read marks, grounded) ─► draft + review gate
 *   audio ─► ffmpeg ─► ASR ─► Spark(log_entry tool calls) ─► drafts
 *   tray  ─► SAM(dish) ┐
 *           SAM(food) ─┴► layoutTray() ─► [served ─► SAM(dish), SAM(food) ─► layoutTray() ─► matchRegions()]
 *                                       ─► Spark(meal read, grounded) ─► measureDishes() ─► draft + review gate
 *
 * Request counts are fixed per mode, and every action is admitted whole before its first request (ai/budget-policy.ts):
 * photo read 3 in `sam+spark` mode (2 SAM + 1 Spark) or 1 in `spark` mode; meal tray photo 3, 5 with a compared served
 * photo (2 more SAM, on the served photo, only after the collected pair settled and found a dish), or 1 in Spark-only
 * mode; text note 1, voice note 2 (ASR in ENDPOINTING mode, for timed turns, then Spark), Explain 1; 0 when the budget
 * refuses the action. A `sam+spark` read whose 3 no longer fit, but 1 does, runs in `spark` mode with 1 and a `budget
 * pressure` warning; a comparable tray read whose 5 no longer fit, but 3 do, reads with 3 and no comparison.
 */
import { MetaBudgetError, assertCompleted, checkWav, outputText, type Ticket } from '@meniscus/meta'
import {
  MAX_READ_WARNINGS,
  MAX_TRACE_STEPS,
  type MealReading,
  type TrayComparison,
  MAX_WARNING_CHARS,
  type CallTrace,
  type CaptureReadResult,
  type AcuityStatus,
  type ContainerKind,
  type Explanation,
  type MealReadResult,
  type NoteResult,
  type ReadMode,
  type Segmentation,
  liquidVolumeMl,
  type TranscriptTurn,
  type TraySegmentation,
} from '@meniscus/shared'
import { config } from '../config.ts'
import { MODELS, traceOf } from '../model-api.ts'
import { toWav } from './audio.ts'
import { EXPLAIN_SYSTEM } from './explain.ts'
import { needsReview, toDraft } from './draft.ts'
import { MEAL_JSON_SCHEMA, MEAL_SYSTEM, MealModelSchema, mealNeedsReview, toMealDraft, toMealReading } from './meal.ts'
import { LOG_ENTRY_TOOL, NOTE_SYSTEM } from './notes.ts'
import { withBudget, type Plan } from './budget-policy.ts'
import { matchRegions, measureDishes, type ServedCheck } from './compare.ts'
import type { AiPorts } from './ports.ts'
import { READING_JSON_SCHEMA, READING_SYSTEM, ReadingSchema, readingContext } from './reading.ts'
import { LIQUID_CONCEPT, SAM_CONCEPT, locateWithMasks, toInstance } from './segmentation.ts'
import { TRAY_DISH_CONCEPT, TRAY_FOOD_CONCEPT, layoutTray, toTrayMask, trayContext } from './tray.ts'
import { sha256Hex } from '../hash.ts'

export interface ReadInput {
  image: Uint8Array
  mime: string
  hint?: ContainerKind
  mode?: ReadMode
  signal?: AbortSignal
  /** The bed's acuity, which sets the budget class; null or absent with no bed (routine). Never sent upstream. */
  status?: AcuityStatus | null
}

export interface MealReadInput {
  image: Uint8Array
  mime: string
  mode?: ReadMode
  signal?: AbortSignal
  /** The bed's acuity, which sets the budget class; null or absent with no bed (routine). Never sent upstream. */
  status?: AcuityStatus | null
  /** The bed's served photo for this meal, as found by the route; `check` from `servedCheck`. Only its bytes go upstream. */
  served?: { bytes: Uint8Array; mime: string; check: ServedCheck }
}

/** The comparison as the pipeline knows it; the route adds the served media's id and time. */
export type ReadComparison = Omit<TrayComparison, 'served_media_id' | 'served_at'>
export type MealRead = Omit<MealReadResult, 'comparison'> & { comparison: ReadComparison | null }

export interface NoteInput {
  text: string
  signal?: AbortSignal
  status?: AcuityStatus | null
}

export interface VoiceNoteInput {
  /** Any format ffmpeg decodes. */
  audio: Uint8Array
  languages?: string[]
  signal?: AbortSignal
  status?: AcuityStatus | null
}

/** Every port call of one action carries its signal and its ticket. */
interface Call {
  signal?: AbortSignal
  ticket: Ticket
}

const toDataUrl = (bytes: Uint8Array, mime: string) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`

/** Bounds of voice timing, as voice evidence accepts it (routes/evidence.ts). */
export const MAX_TURNS = 200
export const MAX_TURN_TEXT = 500
export const MAX_AUDIO_MS = 3_600_000
const msOf = (ms: unknown): number | null =>
  typeof ms === 'number' && Number.isFinite(ms) ? Math.min(MAX_AUDIO_MS, Math.max(0, Math.round(ms))) : null

/** ASR turns as `{ start_ms, end_ms, text }`: trimmed, empty ones dropped, at most 200. */
function turnsOf(turns: { startMs: number; endMs: number; transcript: string }[] | undefined): TranscriptTurn[] {
  const out: TranscriptTurn[] = []
  for (const t of turns ?? []) {
    const text = (t.transcript ?? '').trim().slice(0, MAX_TURN_TEXT)
    const start = msOf(t.startMs)
    const end = msOf(t.endMs)
    if (!text || start === null || end === null) continue
    out.push({ start_ms: start, end_ms: Math.max(start, end), text })
    if (out.length === MAX_TURNS) break
  }
  return out
}

export interface AiOptions {
  /** Tray reads with no `mode`: `sam+spark` when true, `spark` when false. */
  mealUseSam: boolean
}

export function createAi(ports: () => AiPorts, opts: AiOptions = { mealUseSam: config.MEAL_USE_SAM }) {
  async function segmentFor(image: string, hint: ContainerKind | undefined, call: Call) {
    const { sam } = ports()
    const [containers, liquids] = await Promise.all([
      sam.segment({ image, prompt: SAM_CONCEPT[hint ?? 'other'] }, call),
      sam.segment({ image, prompt: LIQUID_CONCEPT }, call),
    ])
    return {
      seg: locateWithMasks(containers.masks.map(toInstance), liquids.masks.map(toInstance)),
      traces: [traceOf('sam:container', containers), traceOf('sam:liquid', liquids)],
    }
  }

  function readCapture(input: ReadInput): Promise<CaptureReadResult> {
    const wanted = input.mode ?? (config.READ_USE_SAM ? 'sam+spark' : 'spark')
    return withBudget('read', { mode: wanted, status: input.status }, ports, (mode, ticket) =>
      readCaptureAs(mode, input, { signal: input.signal, ticket }),
    )
  }

  async function readCaptureAs(mode: ReadMode, input: ReadInput, call: Call): Promise<CaptureReadResult> {
    const t0 = performance.now()
    // Local, before any request: binds the read's geometry to the photo kept (capture/photo-reading "Photo read names its image").
    const image_sha256 = sha256Hex(input.image)
    const image = toDataUrl(input.image, input.mime)
    const trace: CallTrace[] = []
    const warnings: string[] = []

    let segmentation: Segmentation | null = null
    if (mode === 'sam+spark') {
      try {
        const r = await segmentFor(image, input.hint, call)
        segmentation = r.seg
        trace.push(...r.traces)
        if (!r.seg.container) warnings.push('segmentation found no container')
        if (!r.seg.fluid) warnings.push('segmentation found no liquid')
      } catch (err) {
        // SAM is an accuracy aid: degrade to Spark-only instead of failing the
        // capture. Cancellation still propagates; the ticket holds Spark's slot, so no budget refusal comes here.
        if (input.signal?.aborted) throw err
        warnings.push(`segmentation unavailable: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const r = await ports().responses.generateObject(
      {
        model: MODELS.spark,
        instructions: READING_SYSTEM,
        reasoning: { effort: config.SPARK_READ_EFFORT },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: readingContext(input.hint?.replace(/_/g, ' '), segmentation) },
              { type: 'input_image', image_url: image, detail: 'high' },
            ],
          },
        ],
        output: { name: 'container_reading', jsonSchema: READING_JSON_SCHEMA, schema: ReadingSchema },
      },
      call,
    )
    trace.push(traceOf('spark:read', r))

    const reading = r.object
    const review = needsReview(reading, segmentation?.fill_fraction ?? null)
    // The liquid region's share of the capacity, from results already in hand: no extra request.
    if (segmentation) segmentation = { ...segmentation, fluid_volume_ml: liquidVolumeMl(segmentation.fill_fraction, reading.capacity_ml) }
    return {
      mode,
      image_sha256,
      reading,
      segmentation,
      draft: toDraft(reading),
      needs_review: review.length > 0,
      warnings: [...warnings, ...review],
      trace,
      ms: Math.round(performance.now() - t0),
    }
  }

  function parseNote(input: NoteInput): Promise<NoteResult> {
    return withBudget('note', { mode: null, status: input.status }, ports, (_mode, ticket) =>
      noteCall(input.text, { signal: input.signal, ticket }),
    )
  }

  async function noteCall(text: string, call: Call): Promise<NoteResult> {
    const r = await ports().responses.callTool(
      {
        model: MODELS.spark,
        instructions: NOTE_SYSTEM,
        reasoning: { effort: config.SPARK_NOTE_EFFORT },
        input: [{ role: 'user', content: [{ type: 'input_text', text }] }],
        tool: LOG_ENTRY_TOOL,
      },
      call,
    )
    const entries = r.calls.map((c) => c.input)
    return { entries, reply: entries.length ? null : r.text || null, trace: [traceOf('spark:note', r)] }
  }

  async function voiceNote(input: VoiceNoteInput): Promise<NoteResult> {
    // Converted and checked (format, then the 10-minute limit) before the action is admitted, so a bad or
    // over-long recording holds no slot and sends nothing, whatever the budget (capture/notes "Recording length limit").
    const audio = await toWav(input.audio)
    checkWav(audio)
    return withBudget('voice', { mode: null, status: input.status }, ports, (_mode, ticket) =>
      voiceCall(audio, input, { signal: input.signal, ticket }),
    )
  }

  async function voiceCall(audio: Uint8Array, input: VoiceNoteInput, call: Call): Promise<NoteResult> {
    // ENDPOINTING returns timed turns for the clip in this same one request (PUSH_TO_TALK returns none). No other mode is tried.
    // An empty transcript ends the action after 1 request; its Spark slot is returned.
    const asr = await ports().asr.transcribe({ audio, languageBias: input.languages, mode: 'ENDPOINTING' }, call)
    const asrTrace: CallTrace = { step: 'asr', model: MODELS.asr, ms: asr.ms }
    const timing = { duration_ms: msOf(asr.audioDurationMs), turns: turnsOf(asr.turns) }
    if (!asr.transcript) return { transcript: '', entries: [], reply: null, trace: [asrTrace], ...timing }
    const note = await noteCall(asr.transcript, call)
    return { ...note, transcript: asr.transcript, trace: [asrTrace, ...note.trace], ...timing }
  }

  /** `context` is de-identified (see explain.ts). */
  function explainAlerts(input: { context: string; signal?: AbortSignal; status?: AcuityStatus | null }): Promise<Explanation> {
    return withBudget('explain', { mode: null, status: input.status }, ports, (_mode, ticket) =>
      explainCall(input.context, { signal: input.signal, ticket }),
    )
  }

  async function explainCall(context: string, call: Call): Promise<Explanation> {
    const r = await ports().responses.create(
      {
        model: MODELS.spark,
        instructions: EXPLAIN_SYSTEM,
        reasoning: { effort: config.SPARK_NOTE_EFFORT },
        input: [{ role: 'user', content: [{ type: 'input_text', text: context }] }],
      },
      call,
    )
    assertCompleted(r.response)
    return { text: outputText(r.response).trim(), trace: [traceOf('spark:explain', r)] }
  }

  /**
   * `sam+spark`: SAM `dish` and SAM `food` on the tray (started in that order, both settled), then, with a comparable
   * served photo admitted for 5 and at least one collected dish region, SAM `dish` and `food` on the served photo (both
   * settled), then one Muse Spark request grounded by the dish regions and served coverage: 3 or 5 requests. `spark`:
   * Spark alone, 1 request. A SAM request that fails upstream degrades the read (still 3 or 5 sent); cancellation fails
   * it before Spark. The budget admits every request up front, or cuts the read down, or refuses it with 0
   * (ai/budget-policy.ts). Never retried; saves nothing.
   */
  function readMeal(input: MealReadInput): Promise<MealRead> {
    const wanted = input.mode ?? (opts.mealUseSam ? 'sam+spark' : 'spark')
    const comparable = typeof input.served?.check === 'object'
    return withBudget('meal', { mode: wanted, status: input.status, served: comparable }, ports, (mode, ticket, plan) =>
      readMealAs(mode, input, { signal: input.signal, ticket }, plan),
    )
  }

  /** Both SAM requests on one tray photo, settled; the trace steps are `<prefix>dish` and `<prefix>food`. */
  async function segmentTray(image: string, prefix: string, signal: AbortSignal | undefined, call: Call, trace: CallTrace[]) {
    const { sam } = ports()
    const segment = (prompt: string) => sam.segment({ image, prompt, maskEncoding: 'one_bit' }, call)
    const [dish, food] = await Promise.allSettled([segment(TRAY_DISH_CONCEPT), segment(TRAY_FOOD_CONCEPT)])
    const failed = [dish, food].flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []))
    // Cancellation (and a budget refusal, which an action admitted whole cannot get) fails the read, after both settled.
    for (const err of failed) if (signal?.aborted || err instanceof MetaBudgetError) throw err
    if (dish.status === 'fulfilled') trace.push(traceOf(`${prefix}dish`, dish.value))
    if (food.status === 'fulfilled') trace.push(traceOf(`${prefix}food`, food.value))
    if (dish.status === 'rejected') return { error: dish.reason as unknown }
    if (food.status === 'rejected') return { error: food.reason as unknown }
    return { seg: layoutTray(dish.value.masks.map(toTrayMask), food.value.masks.map(toTrayMask)) }
  }

  const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

  async function readMealAs(mode: ReadMode, input: MealReadInput, call: Call, plan: Plan): Promise<MealRead> {
    const t0 = performance.now()
    // Before any request, over the bytes the route received: the saved meal's photo must hash the same.
    const image_sha256 = sha256Hex(input.image)
    const image = toDataUrl(input.image, input.mime)
    const trace: CallTrace[] = []
    const warnings: string[] = []
    const served = input.served
    const check = served?.check

    // Decided before any request: the same bytes in every mode, an unreadable size only when SAM would have run.
    if (check === 'same_bytes') warnings.push('comparison unavailable: same photo as served')
    if (check === 'size_unknown' && mode === 'sam+spark') warnings.push('comparison unavailable: photo size unknown')
    let comparison: ReadComparison | null =
      served && check !== 'same_bytes'
        ? { served_sha256: sha256Hex(served.bytes), size: null, served_size: null, served: null, matches: [] }
        : null

    let segmentation: TraySegmentation | null = null
    if (mode === 'sam+spark') {
      const r = await segmentTray(image, 'sam:', input.signal, call, trace)
      if ('seg' in r && r.seg) {
        segmentation = r.seg
        if (!segmentation.regions.length) warnings.push('segmentation found no dishes')
      } else {
        // SAM is an accuracy aid: an upstream failure (429 included) degrades to Spark-only instead of failing the read.
        warnings.push(`segmentation unavailable: ${messageOf(r.error)}`)
      }
    }

    // The served pair only when 5 were admitted and the collected photo has a region to match; else its 2 slots go back.
    const servedCoverage = new Map<number, number>()
    let servedSeg: TraySegmentation | null = null
    if (plan.compare && served && typeof check === 'object' && comparison && segmentation?.regions.length) {
      const r = await segmentTray(toDataUrl(served.bytes, served.mime), 'sam:served-', input.signal, call, trace)
      comparison = { ...comparison, size: check.size, served_size: check.served_size }
      if ('seg' in r && r.seg) {
        servedSeg = r.seg
        const matches = r.seg.regions.length ? matchRegions(segmentation.regions, check.size, r.seg.regions, check.served_size) : []
        comparison = { ...comparison, served: r.seg, matches }
        if (!r.seg.regions.length) warnings.push('comparison found no served dishes')
        for (const m of matches) servedCoverage.set(m.index, r.seg.regions.find((x) => x.index === m.served_index)!.coverage)
      } else {
        warnings.push(`comparison unavailable: ${messageOf(r.error)}`)
      }
    }

    const r = await ports().responses.generateObject(
      {
        model: MODELS.spark,
        instructions: MEAL_SYSTEM,
        reasoning: { effort: config.SPARK_READ_EFFORT },
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: trayContext(segmentation, servedCoverage) },
              { type: 'input_image', image_url: image, detail: 'high' },
            ],
          },
        ],
        output: { name: 'meal_reading', jsonSchema: MEAL_JSON_SCHEMA, schema: MealModelSchema },
      },
      call,
    )
    trace.push(traceOf('spark:meal', r))
    let reading: MealReading = toMealReading(r.object, segmentation)
    if (segmentation && servedSeg && comparison?.matches.length) {
      const dishes = measureDishes(reading.dishes, segmentation, servedSeg, comparison.matches)
      reading = { ...reading, dishes, items: dishes.map((d) => ({ name: d.name, portion: d.portion })) }
    }
    return {
      mode,
      image_sha256,
      reading,
      segmentation,
      comparison,
      draft: toMealDraft(reading),
      needs_review: mealNeedsReview(reading),
      warnings: warnings.slice(0, MAX_READ_WARNINGS).map((w) => w.slice(0, MAX_WARNING_CHARS)),
      trace: trace.slice(0, MAX_TRACE_STEPS),
      ms: Math.round(performance.now() - t0),
    }
  }

  return { readCapture, parseNote, voiceNote, explainAlerts, readMeal }
}

export type Ai = ReturnType<typeof createAi>
