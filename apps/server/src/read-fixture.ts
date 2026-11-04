/** Read-log test fixture: the app over a clocked store with a fake upstream, and helpers to read, save and summarise. */
import assert from 'node:assert/strict'
import type {
  BagReadingInput,
  BagReadingResult,
  CaptureReadResult,
  ContainerReading,
  Entry,
  EntryInput,
  LevelInput,
  LevelResult,
  Logged,
  Meal,
  MealInput,
  MealReadResult,
  MediaRef,
  ModelQuality,
  NoteResult,
  PhotoEvidence,
} from '@meniscus/shared'
import type { MealModelOutput } from './ai/meal.ts'
import type { Store } from './store/port.ts'
import { SAM_EMPTY, jpeg, msg, reading, resp, silenceWav, testApp, testStore, upstream } from './testing.ts'

export const RAVI = 1
export const SUNITA = 2
export const ANITA = 4
export const HOUR = 3_600_000
/** Local time on `d` Nov 2026. */
export const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()

type Body<T> = T & { error?: string; issues?: { path: string; message: string }[] }

/** Spark's tool calls for a note: one `log_entry` per draft. */
export const logEntries = (drafts: Record<string, unknown>[]) =>
  resp(
    'muse-spark-1.3',
    // No draft: a reply and no `log_entry` call.
    drafts.length === 0
      ? [msg('Nothing to chart in that note.')]
      : drafts.map((d, i) => ({
          type: 'function_call',
          call_id: `c${i}`,
          name: 'log_entry',
          arguments: JSON.stringify({ item: null, notes: null, urine_colour: 'none', ...d }),
        })),
  )

/** Spark's answer to a tray read: nothing on the tray unless `out` says otherwise. */
export const tray = (out: Partial<MealModelOutput> = {}): MealModelOutput => ({
  dishes: [],
  eaten: 'none',
  fluids: [],
  confidence: 0.9,
  issues: [],
  notes: null,
  ...out,
})

/** A lunch of rice (half eaten) and dal (all eaten) with 150 mL soup, overall half eaten: the tray story's draft. */
export const LUNCH: Partial<MealModelOutput> = {
  dishes: [
    { region: 0, name: 'rice', dish_kind: 'rice', eaten: 'half' },
    { region: 0, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
  ],
  eaten: 'half',
  fluids: [{ region: 0, name: 'soup', fluid_kind: 'soup', volume_ml: 150 }],
}

/**
 * The app over a store whose clock is `clock.t`, with a fake upstream: photo reads return `next.reading`, notes draft
 * `next.drafts`. SAM finds nothing, so no fill disagreement sends a read to review.
 */
export async function setup(start = nov(3, 8), open: (now: () => number) => Promise<Store> = (now) => testStore(now)) {
  const clock = { t: start }
  const store = await open(() => clock.t)
  const next: { reading: ContainerReading; drafts: Record<string, unknown>[]; tray: MealModelOutput } = {
    reading: reading({ container: 'urinal', fluid: 'urine', volume_ml: 450, capacity_ml: 1000 }),
    drafts: [{ direction: 'in', category: 'water', volume_ml: 200 }],
    tray: tray(),
  }
  const u = upstream({
    sam: () => resp('sam-3.1', [msg(SAM_EMPTY)]),
    spark: (body) =>
      body.tools
        ? logEntries(next.drafts)
        : resp('muse-spark-1.3', [
            msg(
              JSON.stringify(
                (body.text as { format?: { name?: string } } | undefined)?.format?.name === 'meal_reading' ? next.tray : next.reading,
              ),
            ),
          ]),
  })
  const { request } = await testApp({ ai: u.ai, store })
  const at = (ms: number) => void (clock.t = ms)
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const send = async <T>(path: string, body: FormData | object, staff: number) => {
    const res = await request(
      path,
      {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      },
      { staff },
    )
    return { status: res.status, body: (await res.json()) as Body<T> }
  }
  /** A photo read (sam+spark) for `admissionId` (none when null), returning its read id. */
  const photoRead = async (admissionId: number | null, over: Partial<ContainerReading> = {}, staff = RAVI) => {
    next.reading = reading({ ...over })
    const f = new FormData()
    f.append('image', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    f.append('mode', 'sam+spark')
    if (admissionId !== null) f.append('admission_id', String(admissionId))
    const r = await send<Logged<CaptureReadResult>>('/api/ai/read', f, staff)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    last = r.body
    return r.body.read_id
  }
  let last: CaptureReadResult | undefined
  /** The last photo read's evidence, as the web sends it with the record. */
  const evidence = (): PhotoEvidence => {
    const r = last!
    return {
      kind: 'photo',
      mode: r.mode,
      reading: r.reading,
      segmentation: r.segmentation,
      review_reasons: r.warnings,
      trace: r.trace,
      colour: null,
    }
  }
  /**
   * A tray read (`/api/ai/meal`, sam+spark unless `mode` says otherwise) for `admissionId` (none when null), whose Spark
   * answer is `out`. SAM finds nothing, so every dish is region 0. Returns the read as answered.
   */
  const trayRead = async (
    admissionId: number | null,
    out: Partial<MealModelOutput> = {},
    o: { staff?: number; mode?: 'sam+spark' | 'spark'; meal?: string } = {},
  ) => {
    next.tray = tray(out)
    const f = new FormData()
    f.append('image', new File([jpeg], 'tray.jpg', { type: 'image/jpeg' }))
    f.append('mode', o.mode ?? 'sam+spark')
    if (admissionId !== null) f.append('admission_id', String(admissionId))
    if (o.meal !== undefined) f.append('meal', o.meal)
    const r = await send<Logged<MealReadResult>>('/api/ai/meal', f, o.staff ?? RAVI)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body
  }
  /**
   * Saves a photo meal for `id` from tray read `r`: the tray photo uploaded, then the lunch posted with the draft's values
   * (overridden by `over`), the read's evidence and `read_id` (none when `over.read_id` is null).
   */
  const mealFrom = async (
    id: number,
    r: Logged<MealReadResult>,
    over: Partial<Omit<MealInput, 'read_id'>> & { read_id?: number | null } = {},
    staff = RAVI,
  ) => {
    const photo = await upload(id, staff)
    const { read_id = r.read_id, ...rest } = over
    const body: MealInput = {
      meal: 'lunch',
      portion: r.draft.portion,
      items: r.draft.items || null,
      fluid_ml: r.draft.fluid_ml,
      source: 'photo',
      confidence: r.reading.confidence,
      evidence: {
        mode: r.mode,
        image_sha256: r.image_sha256,
        reading: r.reading,
        segmentation: r.segmentation,
        comparison: r.comparison,
        warnings: r.warnings,
        trace: r.trace,
      },
      media_id: photo.id,
      dishes: r.draft.dishes,
      ...rest,
      ...(read_id === null ? {} : { read_id }),
    }
    return send<Meal>(`/api/admissions/${id}/meals`, body, staff)
  }
  const textRead = async (admissionId: number, drafts = next.drafts, staff = RAVI) => {
    next.drafts = drafts
    const r = await send<Logged<NoteResult>>('/api/ai/note', { text: 'coconut water 200', admission_id: admissionId }, staff)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.read_id
  }
  const voiceRead = async (admissionId: number, drafts: Record<string, unknown>[], staff = RAVI) => {
    next.drafts = drafts
    const f = new FormData()
    f.append('audio', new File([silenceWav()], 'note.wav', { type: 'audio/wav' }))
    f.append('admission_id', String(admissionId))
    const r = await send<Logged<NoteResult>>('/api/ai/voice-note', f, staff)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.read_id
  }
  const entry = (id: number, body: Partial<EntryInput> & Record<string, unknown>, staff = RAVI) =>
    send<Entry>(`/api/admissions/${id}/entries`, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo', ...body }, staff)
  const level = (id: number, body: Partial<LevelInput> & Record<string, unknown>, staff = RAVI) =>
    send<LevelResult>(`/api/admissions/${id}/levels`, { container: 'water_jug', volume_ml: 600, source: 'photo', ...body }, staff)
  const bag = (id: number, body: Partial<BagReadingInput> & Record<string, unknown>, staff = RAVI) =>
    send<BagReadingResult>(
      `/api/admissions/${id}/bag-readings`,
      { container: 'urine_bag', event: 'emptied', source: 'photo', ...body },
      staff,
    )
  /** A GET through the app as `staff`. */
  const get = async <T>(path: string, staff = ANITA) => {
    const res = await request(path, {}, { staff })
    return { status: res.status, body: (await res.json()) as Body<T> }
  }
  const upload = async (id: number, staff = RAVI) => {
    const f = new FormData()
    f.append('file', new File([jpeg], 'bag.jpg', { type: 'image/jpeg' }))
    f.append('kind', 'photo')
    const res = await request(`/api/admissions/${id}/media`, { method: 'POST', body: f }, { staff })
    assert.equal(res.status, 201)
    return (await res.json()) as MediaRef
  }
  const approve = (entryId: number, body: Record<string, unknown> = {}) =>
    send<Entry>(`/api/entries/${entryId}/review`, { action: 'approve', ...body }, ANITA)
  const quality = async (q = '') => {
    const res = await request(`/api/quality/model${q}`)
    return { status: res.status, body: (await res.json()) as Body<ModelQuality> }
  }
  /** What the bed holds: entries and level rows (jug levels and bag readings). */
  const held = async (id: number) => ({
    entries: (await store.entries(id))!.entries.length,
    levels: (await store.levels(id))!.length,
    bags: (await store.bagReadings(id, 0)).length,
    meals: (await store.meals(id, 0))!.length,
  })
  /** The read's links as the outcome rows see them. */
  const links = async (readId: number) => (await store.readOutcomeRows(0)).find((r) => r.id === readId)?.links ?? []
  const requests = () => u.requests.length
  return {
    clock,
    store,
    u,
    request,
    at,
    bed,
    send,
    get,
    photoRead,
    evidence,
    textRead,
    voiceRead,
    trayRead,
    mealFrom,
    entry,
    level,
    bag,
    upload,
    approve,
    quality,
    held,
    links,
    requests,
  }
}
