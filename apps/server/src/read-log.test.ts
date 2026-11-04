import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CONTAINER_KINDS,
  DISH_KINDS,
  DRINK_KINDS,
  ENTRY_CATEGORIES,
  FLUID_KINDS,
  MEAL_FLUID_KINDS,
  MEAL_ISSUES,
  PORTION_BASES,
  READ_KINDS,
  READING_ISSUES,
  URINE_COLOURS,
  type CaptureReadResult,
  type Logged,
  type MealReadResult,
  type NoteResult,
} from '@meniscus/shared'
import type { MealModelOutput } from './ai/meal.ts'
import { ReadOutputSchema } from './ai/read-log.ts'
import { openPgStore } from './store/pg/store.ts'
import {
  SAM_EMPTY,
  SAM_RECT,
  dataUrl,
  imageOf,
  jpeg,
  msg,
  png,
  reading,
  resp,
  silenceWav,
  testApp,
  testDb,
  upstream,
  useBudget,
  type Upstream,
} from './testing.ts'

const RAVI = 1

/** A store on its own test database (so every `model_read` column can be read raw), the app over it, and the fake upstream. */
async function setup(over: Upstream = {}, now?: () => number) {
  const h = await testDb()
  const store = await openPgStore(h.db, now ? { now } : {})
  const u = upstream(over)
  const { request, keep } = await testApp({ ai: u.ai, store })
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    return f
  }
  const photo = () => new File([jpeg], 'a.jpg', { type: 'image/jpeg' })
  const post = async <T>(path: string, body: FormData | object, staff = RAVI) => {
    const res = await request(
      path,
      {
        method: 'POST',
        ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
      },
      { staff },
    )
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  /** Every stored read, every column as Postgres holds it (jsonb columns as their JSON text). */
  const rows = async () => {
    const r = await h.pg.query<Record<string, unknown>>('SELECT * FROM meniscus.model_read ORDER BY id')
    return r.rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k, v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v]),
      ),
    )
  }
  return { store, u, bed, form, photo, post, rows, keep }
}

/** Spark's tool calls for a note: one `log_entry` per draft. */
const logEntries = (...drafts: Record<string, unknown>[]) =>
  resp(
    'muse-spark-1.3',
    drafts.map((d, i) => ({
      type: 'function_call',
      call_id: `c${i}`,
      name: 'log_entry',
      arguments: JSON.stringify({ item: null, notes: null, urine_colour: 'none', ...d }),
    })),
  )
const asr = (transcript: string) => () => Response.json({ sessionId: 's', transcript, audioDurationMs: 2000, turns: [] })

/** Spark's answer to a tray read. */
const trayAnswer = (out: Partial<MealModelOutput>) =>
  resp('muse-spark-1.3', [msg(JSON.stringify({ dishes: [], eaten: 'none', fluids: [], confidence: 0.9, issues: [], notes: null, ...out }))])
/** Two dish regions on a 1000 × 800 frame, left then right; food fills each. */
const TWO_DISHES = () =>
  resp('sam-3.1', [msg(SAM_RECT({ left: 100, top: 80, right: 400, bottom: 480 }, { left: 500, top: 80, right: 800, bottom: 480 }))])
const LUNCH: Partial<MealModelOutput> = {
  dishes: [
    { region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' },
    { region: 0, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
  ],
  eaten: 'half',
  fluids: [{ region: 2, name: 'soup', fluid_kind: 'soup', volume_ml: 150 }],
  confidence: 0.82,
}
const trayFile = (bytes: Uint8Array = png(1000, 800, 42)) => new File([bytes], 'tray.png', { type: 'image/png' })

/** Every string leaf of a parsed value. */
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []

describe('read log', () => {
  it('[charting/model-accuracy] Reads are logged: Photo read', async () => {
    // SAM finds nothing to compare fills with, so the read needs no review.
    const t = await setup({
      sam: () => resp('sam-3.1', [msg(SAM_EMPTY)]),
      spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(reading({ urine_colour: 'dark', urine_rgb: '#c9952f' })))]),
    })
    const bed = await t.bed('3A', '1')
    const r = await t.post<Logged<CaptureReadResult>>(
      '/api/ai/read',
      t.form({ image: t.photo(), mode: 'sam+spark', admission_id: String(bed.id) }),
    )
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(typeof r.body.read_id, 'number')
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual(
      [read.kind, read.mode, read.models, read.staff_id, read.admission_id],
      ['photo', 'sam+spark', ['sam-3.1', 'muse-spark-1.3'], RAVI, bed.id],
    )
    assert.deepEqual([read.confidence, read.issues, read.needs_review, read.hint, read.drafts], [0.9, [], false, null, 1])
    assert.deepEqual(read.output, {
      kind: 'photo',
      container: 'urine_bag',
      fluid: 'urine',
      volume_ml: 450,
      capacity_ml: 2000,
      marks_visible: true,
      urine_colour: 'dark',
      draft: { category: 'urine', volume_ml: 450, urine_colour: 'dark', drink: null },
    })
    assert.deepEqual(t.u.requests.filter((x) => x.startsWith('sam')).length, 2)
    assert.deepEqual(t.u.requests.filter((x) => x.startsWith('spark')).length, 1)
    assert.equal(t.u.requests.length, 3)
  })

  it('[charting/model-accuracy] Reads are logged: Spark-only read', async () => {
    const t = await setup()
    const r = await t.post<Logged<CaptureReadResult>>('/api/ai/read', t.form({ image: t.photo(), mode: 'spark' }))
    assert.equal(r.status, 200)
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual([read.kind, read.mode, read.models, read.admission_id], ['photo', 'spark', ['muse-spark-1.3'], null])
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[charting/model-accuracy] Reads are logged: Text note', async () => {
    const t = await setup({ spark: () => logEntries({ direction: 'in', category: 'water', volume_ml: 200 }) })
    const r = await t.post<Logged<NoteResult>>('/api/ai/note', { text: 'coconut water 200' })
    assert.equal(r.status, 200)
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual([read.kind, read.mode, read.drafts, read.confidence, read.needs_review], ['text', null, 1, null, false])
    assert.deepEqual(read.output, { kind: 'text', drafts: [{ category: 'water', volume_ml: 200, urine_colour: null, drink: 'other' }] })
    assert.deepEqual(t.u.requests, ['spark:tool'])
  })

  it('[charting/model-accuracy] Reads are logged: Voice note with two drafts', async () => {
    const t = await setup({
      asr: asr('bed 4 had 200 mL tea and passed 300 mL urine'),
      spark: () =>
        logEntries({ direction: 'in', category: 'water', volume_ml: 200 }, { direction: 'out', category: 'urine', volume_ml: 300 }),
    })
    const r = await t.post<Logged<NoteResult>>(
      '/api/ai/voice-note',
      t.form({ audio: new File([silenceWav()], 'note.wav', { type: 'audio/wav' }) }),
    )
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual([read.kind, read.models, read.drafts], ['voice', ['muse-voice-transcribe-1.0', 'muse-spark-1.3'], 2])
    assert.deepEqual(read.output, {
      kind: 'voice',
      drafts: [
        { category: 'water', volume_ml: 200, urine_colour: null, drink: 'other' },
        { category: 'urine', volume_ml: 300, urine_colour: null, drink: null },
      ],
    })
    assert.deepEqual(t.u.requests, ['asr', 'spark:tool'])
  })

  it('[charting/model-accuracy] Reads are logged: Failed read or explain', async () => {
    const t = await setup({
      spark: (body) =>
        body.text?.format
          ? Response.json({ error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, { status: 429 })
          : resp('muse-spark-1.3', [msg('Balance is +1700 mL from IV 2500 mL. Review fluid status.')]),
    })
    const read = await t.post('/api/ai/read', t.form({ image: t.photo(), mode: 'spark' }))
    assert.equal(read.status, 429)
    assert.equal(t.u.requests.length, 1)
    // A bed with an overload prompt: IV 2500 mL in and 800 mL urine out, both approved by a nurse.
    const id = (await t.bed('5B', '1')).id
    for (const e of [
      { direction: 'in', category: 'iv', volume_ml: 2500, source: 'manual' },
      { direction: 'out', category: 'urine', volume_ml: 800, source: 'manual' },
    ]) {
      const saved = await t.post<{ id: number }>(`/api/admissions/${id}/entries`, e, 4)
      assert.equal((await t.post(`/api/entries/${saved.body.id}/review`, { action: 'approve' }, 4)).status, 200)
    }
    const explained = await t.post('/api/ai/explain', { admission_id: id }, 4)
    assert.equal(explained.status, 200)
    assert.equal(t.u.requests.length, 2)
    assert.deepEqual(await t.rows(), [])
  })

  it('[charting/model-accuracy] Read log holds no text: Voice note', async () => {
    const t = await setup({
      asr: asr('bed 4 had rice and a kokum sherbet, 200 mL'),
      spark: () =>
        logEntries({
          direction: 'in',
          category: 'water',
          volume_ml: 200,
          item: 'kokum sherbet',
          notes: 'half the glass, with rice',
          drink: 'other',
        }),
    })
    const logged: string[] = []
    const { log, error } = console
    console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    let status: number
    try {
      status = (await t.post('/api/ai/voice-note', t.form({ audio: new File([silenceWav()], 'note.wav', { type: 'audio/wav' }) }))).status
    } finally {
      console.log = log
      console.error = error
    }
    assert.equal(status, 200)
    const [row] = await t.rows()
    assert.ok(row)
    for (const [col, v] of Object.entries(row)) {
      for (const bad of ['rice', 'kokum', 'sherbet', 'bed 4', 'half the glass']) {
        assert.ok(!String(v).includes(bad), `${col} holds "${bad}"`)
        for (const line of logged) assert.ok(!line.includes(bad), `logged "${bad}"`)
      }
    }
    assert.deepEqual(t.u.requests, ['asr', 'spark:tool'])
  })

  it('[charting/model-accuracy] Read log holds no text: Photo read', async () => {
    const t = await setup({
      spark: () =>
        resp('muse-spark-1.3', [
          msg(
            JSON.stringify(
              reading({
                container: 'cup',
                fluid: 'tea',
                reading_basis: 'between the 400 and 500 marks',
                appearance: 'pale yellow, clear',
                drink_name: 'masala chai',
                issues: ['angled'],
              }),
            ),
          ),
        ]),
    })
    const r = await t.post<Logged<CaptureReadResult>>('/api/ai/read', t.form({ image: t.photo(), mode: 'spark', hint: 'cup' }))
    assert.equal(r.status, 200)
    assert.equal(r.body.reading.drink_name, 'masala chai')
    const [row] = await t.rows()
    assert.ok(row)
    for (const [col, v] of Object.entries(row)) {
      for (const bad of ['between the 400 and 500 marks', 'pale yellow, clear', 'masala'])
        assert.ok(!String(v).includes(bad), `${col} holds "${bad}"`)
    }
    const allowed = new Set<string>([
      ...READ_KINDS,
      ...CONTAINER_KINDS,
      ...FLUID_KINDS,
      ...DRINK_KINDS,
      ...ENTRY_CATEGORIES,
      ...URINE_COLOURS,
      ...READING_ISSUES,
    ])
    const leaves = strings(JSON.parse(String(row.output)))
    assert.ok(leaves.length > 0)
    for (const s of leaves) assert.ok(allowed.has(s), `"${s}" is not a closed-list value`)
    for (const s of strings(JSON.parse(String(row.issues)))) assert.ok(allowed.has(s))
    assert.deepEqual((await t.store.read(r.body.read_id))!.hint, 'cup')
    assert.deepEqual(t.u.requests, ['spark:object'])
  })
})

describe('drink kinds in the log', () => {
  it('[charting/model-accuracy] Drink kind in the read log: Photo of coffee', async () => {
    const t = await setup({
      spark: () =>
        resp('muse-spark-1.3', [
          msg(JSON.stringify(reading({ container: 'cup', fluid: 'coffee', drink_name: 'filter coffee', volume_ml: 150 }))),
        ]),
    })
    const r = await t.post<Logged<CaptureReadResult>>('/api/ai/read', t.form({ image: t.photo(), mode: 'sam+spark', hint: 'cup' }))
    assert.equal(r.status, 200)
    const out = (await t.store.read(r.body.read_id))!.output
    assert.equal(out.kind, 'photo')
    assert.ok(out.kind === 'photo')
    assert.equal(out.fluid, 'coffee')
    assert.deepEqual(out.draft, { category: 'water', volume_ml: 150, urine_colour: null, drink: 'coffee' })
    assert.ok(!String((await t.rows())[0]!.output).includes('filter'))
    assert.deepEqual(t.u.requests.sort(), ['sam:cup', 'sam:liquid', 'spark:object'])
  })

  it('[charting/model-accuracy] Drink kind in the read log: Voice note with two drafts', async () => {
    const t = await setup({
      asr: asr('bed 4 had 200 mL tea and passed 300 mL urine'),
      spark: () =>
        logEntries(
          { direction: 'in', category: 'water', volume_ml: 200, drink: 'tea' },
          { direction: 'out', category: 'urine', volume_ml: 300, drink: 'none' },
        ),
    })
    const r = await t.post<Logged<NoteResult>>(
      '/api/ai/voice-note',
      t.form({ audio: new File([silenceWav()], 'note.wav', { type: 'audio/wav' }) }),
    )
    assert.equal(r.status, 200)
    const out = (await t.store.read(r.body.read_id))!.output
    assert.ok(out.kind === 'voice')
    assert.deepEqual(out.drafts, [
      { category: 'water', volume_ml: 200, urine_colour: null, drink: 'tea' },
      { category: 'urine', volume_ml: 300, urine_colour: null, drink: null },
    ])
    assert.deepEqual(t.u.requests, ['asr', 'spark:tool'])
  })

  it('a read stored before drink kinds (drafts without drink) parses with drink null', () => {
    const photo = ReadOutputSchema.parse({
      kind: 'photo',
      container: 'cup',
      fluid: 'tea',
      volume_ml: 200,
      capacity_ml: null,
      marks_visible: true,
      urine_colour: null,
      draft: { category: 'water', volume_ml: 200, urine_colour: null },
    })
    assert.ok(photo.kind === 'photo')
    assert.equal(photo.draft?.drink, null)
    const note = ReadOutputSchema.parse({ kind: 'text', drafts: [{ category: 'water', volume_ml: 200, urine_colour: null }] })
    assert.ok(note.kind === 'text')
    assert.equal(note.drafts[0]!.drink, null)
  })
})

describe('tray reads in the log', () => {
  it('[charting/model-accuracy] Tray reads are logged: Tray read', async () => {
    const t = await setup({ sam: TWO_DISHES, spark: () => trayAnswer(LUNCH) })
    const bed = await t.bed('3A', '1')
    const r = await t.post<Logged<MealReadResult>>(
      '/api/ai/meal',
      t.form({ image: trayFile(), mode: 'sam+spark', admission_id: String(bed.id) }),
    )
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(typeof r.body.read_id, 'number')
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual(
      [read.kind, read.mode, read.models, read.staff_id, read.admission_id],
      ['tray', 'sam+spark', ['sam-3.1', 'muse-spark-1.3'], RAVI, bed.id],
    )
    assert.deepEqual([read.confidence, read.issues, read.needs_review, read.hint, read.drafts], [0.82, [], false, null, 1])
    assert.deepEqual(read.output, {
      kind: 'tray',
      served: false,
      portion: 50,
      dishes: [
        { index: 1, dish_kind: 'rice', portion: 50, basis: 'model' },
        { index: 0, dish_kind: 'dal_lentils', portion: 100, basis: 'model' },
      ],
      fluids: [{ index: 2, fluid_kind: 'soup', volume_ml: 150 }],
      draft: {
        portion: 50,
        fluid_ml: 150,
        dishes: [
          { dish_kind: 'rice', portion: 50 },
          { dish_kind: 'dal_lentils', portion: 100 },
        ],
      },
    })
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })

  it('[charting/model-accuracy] Tray reads are logged: Spark-only tray read', async () => {
    const t = await setup({ spark: () => trayAnswer(LUNCH) })
    const r = await t.post<Logged<MealReadResult>>('/api/ai/meal', t.form({ image: trayFile(), mode: 'spark' }))
    assert.equal(r.status, 200)
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual([read.kind, read.mode, read.models], ['tray', 'spark', ['muse-spark-1.3']])
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[charting/model-accuracy] Tray reads are logged: Served photo compared', async () => {
    const SERVED = png(1000, 800, 41)
    const DISH = { left: 100, top: 80, right: 400, bottom: 480 }
    const isServed = (body: Record<string, any>) => imageOf(body) === dataUrl(SERVED, 'image/png')
    const clock = { t: new Date(2026, 10, 3, 12, 40).getTime() }
    const t = await setup(
      {
        sam: (prompt, body) => resp('sam-3.1', [msg(SAM_RECT(prompt === 'dish' ? DISH : { ...DISH, bottom: isServed(body) ? 400 : 240 }))]),
        spark: () => trayAnswer({ dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'quarter' }], eaten: 'quarter' }),
      },
      () => clock.t,
    )
    const bed = await t.bed('3A', '1')
    await t.keep(bed.id, { kind: 'photo', mime: 'image/png', bytes: SERVED, served_meal: 'lunch' }, RAVI)
    clock.t = new Date(2026, 10, 3, 13, 30).getTime()
    const r = await t.post<Logged<MealReadResult>>(
      '/api/ai/meal',
      t.form({ image: trayFile(), mode: 'sam+spark', admission_id: String(bed.id), meal: 'lunch' }),
    )
    assert.equal(r.status, 200, JSON.stringify(r.body))
    const read = (await t.store.read(r.body.read_id))!
    assert.ok(read.output.kind === 'tray')
    assert.equal(read.output.served, true)
    assert.deepEqual(
      read.output.dishes.map((d) => d.basis),
      ['measured'],
    )
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
  })

  it('[charting/model-accuracy] Tray reads are logged: No draft', async () => {
    const t = await setup({ spark: () => trayAnswer({ issues: ['not_a_meal'], confidence: 0.3 }) })
    const r = await t.post<Logged<MealReadResult>>('/api/ai/meal', t.form({ image: trayFile(), mode: 'spark' }))
    assert.equal(r.status, 200)
    const read = (await t.store.read(r.body.read_id))!
    assert.deepEqual([read.kind, read.issues, read.drafts], ['tray', ['not_a_meal'], 0])
    assert.ok(read.output.kind === 'tray')
    assert.equal(read.output.draft, null)
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[charting/model-accuracy] Tray reads are logged: Failed tray read', async () => {
    const t = await setup({
      spark: () =>
        Response.json({ error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, { status: 429 }),
    })
    const r = await t.post<Record<string, unknown>>('/api/ai/meal', t.form({ image: trayFile(), mode: 'spark' }))
    assert.equal(r.status, 429)
    assert.ok(!('read_id' in r.body))
    assert.deepEqual(await t.rows(), [])
    assert.deepEqual(t.u.requests, ['spark:object'])
  })

  it('[charting/model-accuracy] Tray reads are logged: Refused by the budget', async () => {
    const t = await setup({ budget: { perHour: 120, maxConcurrent: 4, reservePct: 30 }, spark: () => trayAnswer(LUNCH) })
    useBudget(t.u.client.budget, 84)
    const bed = await t.bed('3A', '4')
    const r = await t.post<Record<string, unknown>>('/api/ai/meal', t.form({ image: trayFile(), admission_id: String(bed.id) }))
    assert.deepEqual([r.status, r.body.error, 'read_id' in r.body], [429, 'request_budget_exceeded', false])
    assert.deepEqual(await t.rows(), [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/model-accuracy] Read log holds no text: Tray read', async () => {
    const t = await setup({
      sam: TWO_DISHES,
      spark: () =>
        trayAnswer({
          dishes: [{ region: 1, name: 'paneer tikka', dish_kind: 'curry_vegetables', eaten: 'half' }],
          eaten: 'half',
          fluids: [{ region: 0, name: 'masala chai', fluid_kind: 'tea', volume_ml: 150 }],
          notes: 'left the roti',
        }),
    })
    const logged: string[] = []
    const { log, error } = console
    console.log = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    console.error = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    let r: { status: number; body: Logged<MealReadResult> }
    try {
      r = await t.post<Logged<MealReadResult>>(
        '/api/ai/meal',
        t.form({ image: trayFile(), mode: 'sam+spark', admission_id: String((await t.bed('3A', '1')).id) }),
      )
    } finally {
      console.log = log
      console.error = error
    }
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.ok(r.body.segmentation?.regions.length)
    const region = r.body.segmentation.regions[0]!
    const [row] = await t.rows()
    assert.ok(row)
    const bad = ['paneer', 'masala', 'roti', r.body.image_sha256, region.mask.bits, region.food.bits, JSON.stringify(region.box)]
    for (const [col, v] of Object.entries(row)) {
      for (const b of bad) assert.ok(!String(v).includes(b), `${col} holds "${b}"`)
    }
    for (const line of logged) for (const b of ['paneer', 'masala']) assert.ok(!line.includes(b), `logged "${b}"`)
    const allowed = new Set<string>([...READ_KINDS, ...DISH_KINDS, ...MEAL_FLUID_KINDS, ...PORTION_BASES, ...MEAL_ISSUES])
    const output = JSON.parse(String(row.output)) as Record<string, unknown>
    const leaves = strings(output)
    assert.ok(leaves.length > 0)
    for (const s of leaves) assert.ok(allowed.has(s), `"${s}" is not a closed-list value`)
    for (const k of ['image_sha256', 'name', 'mask', 'box', 'notes', 'items']) assert.ok(!JSON.stringify(output).includes(`"${k}"`), k)
    assert.deepEqual(t.u.requests, ['sam:dish', 'sam:food', 'spark:object'])
  })
})

describe('reads name their bed', () => {
  it('[charting/model-accuracy] Reads name their bed: Unknown bed', async () => {
    const t = await setup()
    const read = await t.post('/api/ai/read', t.form({ image: t.photo(), admission_id: '9999' }))
    const note = await t.post('/api/ai/note', { text: 'coconut water 200', admission_id: 9999 })
    assert.deepEqual([read.status, read.body.error, note.status, note.body.error], [404, 'not_found', 404, 'not_found'])
    assert.deepEqual(t.u.requests, [])
    assert.deepEqual(await t.rows(), [])
  })

  it('[charting/model-accuracy] Reads name their bed: Not sent upstream', async () => {
    const t = await setup({ spark: () => logEntries({ direction: 'in', category: 'water', volume_ml: 200 }) })
    const bed = await t.bed('3A', '1')
    const without = await t.post<Logged<NoteResult>>('/api/ai/note', { text: 'coconut water 200' })
    const withBed = await t.post<Logged<NoteResult>>('/api/ai/note', { text: 'coconut water 200', admission_id: bed.id })
    assert.deepEqual([without.status, withBed.status], [200, 200])
    assert.equal(t.u.bodies.length, 2)
    const [a, b] = t.u.bodies.map((x) => JSON.stringify(x))
    assert.equal(a, b)
    assert.ok(!a!.includes(bed.patient))
    assert.equal((await t.store.read(without.body.read_id))!.admission_id, null)
    assert.equal((await t.store.read(withBed.body.read_id))!.admission_id, bed.id)
  })
})
