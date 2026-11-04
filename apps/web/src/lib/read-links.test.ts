import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  Admission,
  CaptureReadResult,
  ContainerKind,
  DishValue,
  FluidKind,
  Logged,
  MealReadResult,
  NoteResult,
  Portion,
} from '@meniscus/shared'
import { createApi } from './api.ts'
import { fakeCopies, segmentation } from './copy-fixtures.ts'
import { draftFromRead, emptiedNow, saveBagReading, byHandDraft } from './bags.ts'
import {
  READ_LINK_MARGIN_MS,
  alreadyLinked,
  decidePending,
  decideRead,
  noteDrafts,
  photoDraft,
  readFields,
  readStamp,
  saveEntry,
  saveLevel,
  type Pending,
} from './capture.ts'
import { toEvidence } from './evidence.ts'
import { decideMeal, emptyMealForm, formFromRead, saveMeal, saveMealText } from './meals.ts'
import { saveByHand } from './resolve.ts'
import { Round } from './round.ts'

const HOUR = 3_600_000
/** Local time on 3 Nov 2026: the device's clock. */
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 3, h, m, s).getTime()

const read = (container: ContainerKind, fluid: FluidKind, ml: number, readId: number, confidence = 0.9): Logged<CaptureReadResult> => ({
  read_id: readId,
  mode: 'sam+spark',
  image_sha256: 'c0ffee'.padEnd(64, '0'),
  reading: {
    container,
    fluid,
    volume_ml: ml,
    capacity_ml: 2000,
    marks_visible: true,
    reading_basis: 'marks',
    appearance: null,
    confidence,
    issues: [],
  },
  segmentation: null,
  draft:
    fluid === 'urine'
      ? { direction: 'out', category: 'urine', volume_ml: ml, item: null, notes: null }
      : { direction: 'in', category: 'water', volume_ml: ml, item: null, notes: null },
  needs_review: confidence < 0.75,
  warnings: [],
  trace: [],
  ms: 10,
})

/** 200 mL tea and 300 mL urine. */
const teaAndUrine = (readId: number): Logged<NoteResult> => ({
  read_id: readId,
  transcript: 'bed 2 had tea 200 mL and passed 300 mL urine',
  entries: [
    { direction: 'in', category: 'water', volume_ml: 200, item: 'tea', notes: null },
    { direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: null },
  ],
  reply: null,
  trace: [],
  duration_ms: 4200,
  turns: [],
})

const admission = (id: number, ward_code = '3A'): Admission => ({
  id,
  bed: String(id),
  patient: `P${id}`,
  weight_kg: 60,
  qr_token: `tok${id}`.padEnd(20, '0'),
  admitted_at: new Date(2026, 10, 1).toISOString(),
  ward_id: 2,
  ward_code,
  ward_name: 'General medicine',
  mrn: `AT-${id}`,
})

type Step = 'network' | 'linked'

/**
 * Fake server. AI answers are queued per endpoint; `fail` scripts the entry, level and bag-reading posts in order
 * (`network`: the fetch throws; `linked`: 400 `already linked`; null: 201).
 */
function fake(
  o: { reads?: Logged<CaptureReadResult>[]; notes?: Logged<NoteResult>[]; trays?: Logged<MealReadResult>[]; fail?: (Step | null)[] } = {},
) {
  const reads = [...(o.reads ?? [])]
  const trays = [...(o.trays ?? [])]
  const notes = [...(o.notes ?? [])]
  const fail = [...(o.fail ?? [])]
  const calls: string[] = []
  /** JSON bodies, and form fields as plain objects (files as their type). */
  const bodies: Record<string, unknown>[] = []
  const posts: { url: string; body: Record<string, unknown> }[] = []
  let nextEntry = 100
  let nextMedia = 500
  const api = createApi(
    (url, init) => {
      const method = init?.method ?? 'GET'
      calls.push(`${method} ${url}`)
      let body: Record<string, unknown> = {}
      if (init?.body instanceof FormData) {
        for (const [k, v] of init.body.entries()) body[k] = typeof v === 'string' ? v : `<${v.type}>`
      } else if (typeof init?.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>
      bodies.push(body)
      const json = (b: unknown, status = 200) => Promise.resolve(Response.json(b, { status }))
      const bed = /^\/api\/beds\/(.+)$/.exec(url)
      if (bed) {
        const id = Number(/(\d+)/.exec(bed[1]!)![1])
        return json({ ...admission(id), qr_token: bed[1] })
      }
      if (url === '/api/ai/read') return json(reads.shift())
      if (url === '/api/ai/note' || url === '/api/ai/voice-note') return json(notes.shift())
      if (url === '/api/ai/meal') return json(trays.shift())
      if (/\/media$/.test(url)) {
        return json({ id: nextMedia++, kind: body.kind, mime: 'image/jpeg', size: 4, duration_ms: null, created_at: '', sha256: null }, 201)
      }
      if (/\/(entries|levels|bag-readings|meals)$/.test(url)) {
        const step = fail.shift() ?? null
        if (step === 'network') return Promise.reject(new TypeError('Failed to fetch'))
        if (step === 'linked') return json({ error: 'invalid_request', issues: [{ path: 'read_id', message: 'already linked' }] }, 400)
        posts.push({ url, body })
        if (url.endsWith('/levels')) return json({ level: { id: 1 }, previous_ml: null, entry: null }, 201)
        if (url.endsWith('/meals')) return json({ id: 900 + posts.length, ...body }, 201)
        if (url.endsWith('/bag-readings')) {
          return json({ reading: { id: 700 + posts.length, ...body }, entry: null }, 201)
        }
        return json({ id: nextEntry++, ...body, has_photo: false }, 201)
      }
      return json({ error: 'not_found' }, 404)
    },
    () => 1,
  )
  return { api, calls, bodies, posts }
}

/** A tray read (Spark only, so no segmentation to build): staged props, no patient. */
const trayRead = (
  readId: number,
  draft: { portion: Portion; dishes: DishValue[]; fluid_ml: number | null },
  issues: MealReadResult['reading']['issues'] = [],
): Logged<MealReadResult> => ({
  read_id: readId,
  mode: 'spark',
  image_sha256: '3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9',
  reading: { items: [], dishes: [], portion: draft.portion, fluids: [], confidence: 0.8, issues, notes: null },
  segmentation: null,
  comparison: null,
  draft: { ...draft, items: draft.dishes.map((d) => d.name).join(', ') },
  needs_review: issues.length > 0,
  warnings: [],
  trace: [{ step: 'spark:meal', model: 'muse-spark-1.3', ms: 2140 }],
  ms: 2200,
})
/** Lunch, half eaten: rice and dal, with 150 mL of fluid. */
const lunch = (readId: number) =>
  trayRead(readId, {
    portion: 50,
    dishes: [
      { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 },
      { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 50 },
    ],
    fluid_ml: 150,
  })
/** The same read, `sam+spark` with SAM's regions: what gets a labeled copy. */
const segmented = <T extends Logged<CaptureReadResult>>(r: T): T => ({ ...r, segmentation: segmentation() })
const spark = <T extends Logged<CaptureReadResult>>(r: T): T => ({ ...r, mode: 'spark', segmentation: null })
const trayRegion = (index: number, left: number) => ({
  index,
  box: { left, top: 100, right: left + 300, bottom: 400 },
  coverage: 0.5,
  mask: { width: 1, height: 1, bits: 'gA==' },
  food: { width: 1, height: 1, bits: 'gA==' },
})
const segmentedTray = <T extends Logged<MealReadResult>>(r: T): T => ({
  ...r,
  mode: 'sam+spark',
  segmentation: { regions: [trayRegion(1, 100), trayRegion(2, 500)], loose_food: 0 },
})
const lunchForm = () => ({ ...emptyMealForm(new Date(at(13))), meal: 'lunch' as const })

const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const audio = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' })
const link = (b: Record<string, unknown>) => [b.read_id, b.read_draft]

describe('reads and saves carry their read (bed capture screen)', () => {
  it('[web/capture] Reads and saves carry their read: Photo draft', async () => {
    const f = fake({ reads: [segmented(read('urinal', 'urine', 450, 41))] })
    const shot = photo()
    const r = await f.api.read(shot, { admissionId: 16 })
    assert.deepEqual(f.calls, ['POST /api/ai/read'])
    assert.equal(f.bodies[0]!.admission_id, '16')
    const p = decidePending(photoDraft(r, toEvidence(r, null), at(9))!, at(9, 5))
    f.calls.length = 0
    const copies = fakeCopies()
    await saveEntry(f.api, 16, p, { kind: 'photo', blob: shot })
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/media', 'POST /api/admissions/16/entries'])
    assert.equal(f.bodies[1]!.kind, 'photo')
    assert.equal(f.bodies[2]!.kind, 'photo')
    assert.equal(f.posts[0]!.body.read_id, 41)
    assert.deepEqual([f.posts[0]!.body.media_id, f.posts[0]!.body.labeled_media_id], [500, 501])
  })

  it('[web/capture] Reads and saves carry their read: Voice note with two drafts', async () => {
    const f = fake({ notes: [teaAndUrine(42)] })
    const rec = audio()
    const r = await f.api.voiceNote(rec, 16)
    assert.equal(f.bodies[0]!.admission_id, '16')
    const drafts = noteDrafts(r, 'voice', r.transcript ?? '', at(9))
    f.calls.length = 0
    for (const d of drafts) await saveEntry(f.api, 16, decidePending(d, at(9, 1)), { kind: 'voice', blob: rec })
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/entries', 'POST /api/admissions/16/entries'])
    assert.equal(f.bodies[1]!.kind, 'voice')
    assert.deepEqual(
      f.posts.map((x) => link(x.body)),
      [
        [42, 0],
        [42, 1],
      ],
    )
  })

  it('[web/capture] Reads and saves carry their read: Dropped draft', async () => {
    const f = fake({ notes: [teaAndUrine(42)] })
    const r = await f.api.voiceNote(audio(), 16)
    // The tea draft is removed; the urine draft keeps its index.
    const [, urine] = noteDrafts(r, 'voice', r.transcript ?? '', at(9))
    await saveEntry(f.api, 16, decidePending(urine!, at(9, 1)))
    assert.deepEqual(link(f.posts[0]!.body), [42, 1])
  })

  it('[web/capture] Reads and saves carry their read: Typed note and jug', async () => {
    const f = fake({
      notes: [{ ...teaAndUrine(45), entries: [teaAndUrine(45).entries[0]!] }],
      reads: [read('water_jug', 'water', 600, 43)],
    })
    const note = await f.api.note('tea 200', 16)
    assert.deepEqual(f.bodies[0], { text: 'tea 200', admission_id: 16 })
    const [tea] = noteDrafts(note, 'text', 'tea 200', at(9))
    await saveEntry(f.api, 16, decidePending(tea!, at(9, 1)))
    const jug = await f.api.read(photo(), { admissionId: 16 })
    await saveLevel(f.api, 16, 'water_jug', 600, 0.9, undefined, toEvidence(jug, null), decideRead(readStamp(jug, 0, at(9)), at(9, 2)))
    assert.deepEqual(link(f.posts[0]!.body), [45, 0])
    assert.equal(f.posts[1]!.url, '/api/admissions/16/levels')
    assert.equal(f.posts[1]!.body.read_id, 43)
    assert.equal('read_draft' in f.posts[1]!.body, false)
  })

  it('[web/capture] Reads and saves carry their read: By hand', async () => {
    const f = fake()
    const drink: Pending = {
      draft: { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null },
      source: 'manual',
      confidence: null,
    }
    await saveByHand(f.api, 16, decidePending(drink, at(9)), null)
    assert.equal('read_id' in f.posts[0]!.body, false)
    const bag = byHandDraft('urine_bag', 400, admission(16), null, true)
    assert.equal(bag.emptied, true)
    await saveBagReading(f.api, 16, bag, { kind: 'photo', blob: photo() })
    assert.deepEqual(f.posts[1]!.body, { container: 'urine_bag', event: 'emptied', volume_ml: 400, source: 'photo', media_id: 500 })
  })

  it('[web/capture] Reads and saves carry their read: Bag photo', async () => {
    const f = fake({ reads: [spark(read('urine_bag', 'urine', 380, 47))] })
    const shot = photo()
    const r = await f.api.read(shot, { admissionId: 16 })
    const evidence = toEvidence(r, null)
    const d = draftFromRead(r, evidence, admission(16), at(9))!
    assert.equal(d.emptied, true)
    f.calls.length = 0
    await saveBagReading(f.api, 16, { ...d, read: decideRead(d.read, at(9, 1)) }, { kind: 'photo', blob: shot })
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/bag-readings'])
    const b = f.posts[0]!.body
    assert.deepEqual([b.container, b.event, b.volume_ml, b.source, b.media_id, b.read_id], ['urine_bag', 'emptied', 380, 'photo', 500, 47])
    assert.equal('labeled_media_id' in b, false)
    assert.deepEqual(b.evidence, evidence)
  })

  it('[web/capture] Reads and saves carry their read: Emptied it now', async () => {
    const f = fake({ reads: [read('urine_bag', 'urine', 260, 48)] })
    const r = await f.api.read(photo(), { admissionId: 16 })
    const d = { ...draftFromRead(r, toEvidence(r, null), admission(16), at(9))!, emptied: false }
    const saved = await saveBagReading(f.api, 16, { ...d, read: decideRead(d.read, at(9, 1)) })
    assert.deepEqual([f.posts[0]!.body.event, f.posts[0]!.body.read_id], ['check', 48])
    await emptiedNow(f.api, 16, saved.result.reading)
    assert.deepEqual(f.posts[1]!.body, { container: 'urine_bag', event: 'emptied', volume_ml: 260, source: 'manual' })
  })

  it('[web/capture] Reads and saves carry their read: Stale read', async () => {
    const f = fake({ reads: [read('urinal', 'urine', 450, 41), read('urinal', 'urine', 300, 44), read('water_jug', 'water', 600, 43)] })
    const first = await f.api.read(photo(), { admissionId: 16 })
    const second = await f.api.read(photo(), { admissionId: 16 })
    const jug = await f.api.read(photo(), { admissionId: 16 })
    const draft = (r: Logged<CaptureReadResult>) => photoDraft(r, toEvidence(r, null), at(8))!
    await saveEntry(f.api, 16, decidePending(draft(first), at(19, 54)))
    await saveEntry(f.api, 16, decidePending(draft(second), at(19, 55)))
    await saveLevel(f.api, 16, 'water_jug', 600, 0.9, undefined, toEvidence(jug, null), decideRead(readStamp(jug, 0, at(8)), at(19, 55)))
    assert.equal(f.posts.length, 3)
    assert.equal(f.posts[0]!.body.read_id, 41)
    assert.equal('read_id' in f.posts[1]!.body, false)
    assert.equal('read_id' in f.posts[2]!.body, false)
  })

  it('[web/capture] Reads and saves carry their read: Retried save', async () => {
    const f = fake({ reads: [read('urinal', 'urine', 450, 41)], fail: ['network'] })
    const shot = photo()
    const r = await f.api.read(shot, { admissionId: 16 })
    // The first attempt fixes the decision; the screen keeps that draft for the retry.
    const kept = decidePending(photoDraft(r, toEvidence(r, null), at(8))!, at(19, 54))
    f.calls.length = 0
    await assert.rejects(saveEntry(f.api, 16, kept, { kind: 'photo', blob: shot }))
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/entries'])
    f.calls.length = 0
    await saveEntry(f.api, 16, decidePending(kept, at(19, 56)), { kind: 'photo', blob: shot })
    assert.deepEqual(f.calls, ['POST /api/admissions/16/entries'])
    assert.equal(f.posts[0]!.body.read_id, 41)
  })

  it('decideRead sends up to 11 h 55 min, and a decided stamp keeps its answer', () => {
    assert.equal(READ_LINK_MARGIN_MS, 5 * 60_000)
    const s = { id: 41, draft: 0, at: at(8) }
    assert.equal(decideRead(s, at(8) + 12 * HOUR - READ_LINK_MARGIN_MS - 1000)?.send, true)
    assert.equal(decideRead(s, at(8) + 12 * HOUR - READ_LINK_MARGIN_MS)?.send, false)
    const yes = decideRead(s, at(9))!
    assert.equal(decideRead(yes, at(23))?.send, true)
    const no = decideRead(s, at(21))!
    assert.equal(decideRead(no, at(9))?.send, false)
    assert.equal(decideRead(undefined, at(9)), undefined)
    assert.deepEqual(readFields(yes), { read_id: 41, read_draft: 0 })
    assert.deepEqual(readFields(no), {})
    // Never reads the clock: an undecided stamp sends nothing.
    assert.deepEqual(readFields(s), {})
    assert.equal(readStamp({}, 0, at(9)), undefined)
  })
})

describe('meal saves carry their read', () => {
  it('[web/capture] Meal saves carry their read: Tray lunch', async () => {
    const f = fake({ trays: [segmentedTray(lunch(61))] })
    const shot = photo()
    const r = await f.api.readMeal(shot, { admissionId: 16, meal: 'lunch' })
    assert.deepEqual(f.calls, ['POST /api/ai/meal'])
    assert.equal(f.bodies[0]!.admission_id, '16')
    f.calls.length = 0
    const copies = fakeCopies()
    await saveMeal(f.api, 16, decideMeal(formFromRead(lunchForm(), r, at(13)), at(13, 5)), null, { kind: 'photo', blob: shot })
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/media', 'POST /api/admissions/16/meals'])
    assert.deepEqual([f.posts[0]!.body.media_id, f.posts[0]!.body.labeled_media_id], [500, 501])
    assert.equal(f.posts[0]!.body.read_id, 61)
    assert.equal('read_draft' in f.posts[0]!.body, false)
    assert.equal('read_id' in (f.posts[0]!.body.evidence as object), false)
  })

  it('[web/capture] Meal saves carry their read: Meal by hand', async () => {
    const f = fake()
    await saveMeal(f.api, 16, { ...lunchForm(), portion: 50 }, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/16/meals'])
    assert.equal('read_id' in f.posts[0]!.body, false)
  })

  it('[web/capture] Meal saves carry their read: Empty tray read', async () => {
    const f = fake({ trays: [trayRead(62, { portion: 0, dishes: [], fluid_ml: null }, ['not_a_meal'])] })
    const shot = photo()
    const r = await f.api.readMeal(shot, { admissionId: 16, meal: 'lunch' })
    f.calls.length = 0
    // Charted by hand on the empty read's photo: half eaten.
    const form = { ...formFromRead(lunchForm(), r, at(13)), portion: 50 as const }
    const copies = fakeCopies()
    const m = await saveMeal(f.api, 16, decideMeal(form, at(13, 5)), null, { kind: 'photo', blob: shot })
    copies.restore()
    assert.equal(r.segmentation, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/16/media', 'POST /api/admissions/16/meals'])
    assert.equal('read_id' in f.posts[0]!.body, false)
    assert.equal('labeled_media_id' in f.posts[0]!.body, false)
    assert.equal(saveMealText(m), 'Saved lunch, half eaten.')
  })

  it('[web/capture] Meal saves carry their read: Stale tray read', async () => {
    const f = fake({ trays: [lunch(63)] })
    const r = await f.api.readMeal(photo(), { admissionId: 16, meal: 'lunch' })
    await saveMeal(f.api, 16, decideMeal(formFromRead(lunchForm(), r, at(8)), at(19, 55)), null)
    assert.equal(f.posts.length, 1)
    assert.equal('read_id' in f.posts[0]!.body, false)
  })

  it('[web/capture] Meal saves carry their read: Retried meal save', async () => {
    const f = fake({ trays: [segmentedTray(lunch(61))], fail: ['network'] })
    const shot = photo()
    const r = await f.api.readMeal(shot, { admissionId: 16, meal: 'lunch' })
    // The first attempt fixes the decision; the form keeps it for the retry.
    const kept = decideMeal(formFromRead(lunchForm(), r, at(8)), at(19, 54))
    const copies = fakeCopies()
    await assert.rejects(saveMeal(f.api, 16, kept, null, { kind: 'photo', blob: shot }))
    await saveMeal(f.api, 16, decideMeal(kept, at(19, 56)), null, { kind: 'photo', blob: shot })
    copies.restore()
    assert.equal(f.posts[0]!.body.read_id, 61)
    // The photo and its copy were uploaded once, on the first attempt; the retry reuses both ids.
    assert.equal(f.calls.filter((c) => c.endsWith('/media')).length, 2)
    assert.equal(copies.draws.length, 1)
    assert.deepEqual([f.posts[0]!.body.media_id, f.posts[0]!.body.labeled_media_id], [500, 501])
    assert.equal(f.calls.filter((c) => c.includes('/api/ai')).length, 1)
  })

  it('[web/capture] Meal saves carry their read: Already linked', async () => {
    const f = fake({ trays: [segmentedTray(lunch(61))], fail: ['network', 'linked'] })
    const shot = photo()
    const r = await f.api.readMeal(shot, { admissionId: 16, meal: 'lunch' })
    const kept = decideMeal(formFromRead(lunchForm(), r, at(13)), at(13, 5))
    const copies = fakeCopies()
    await assert.rejects(saveMeal(f.api, 16, kept, null, { kind: 'photo', blob: shot }))
    f.calls.length = 0
    const m = await saveMeal(f.api, 16, kept, null, { kind: 'photo', blob: shot })
    copies.restore()
    assert.equal(saveMealText(m), 'Saved lunch, half eaten. 150 mL waiting for nurse approval.')
    assert.deepEqual(f.calls, ['POST /api/admissions/16/meals'])
  })
})

/** Bed cards: bed N is admission N of 3A. */
const cardOf = (n: number) => `https://ward.example/a/bed/bedcard${String(n).padStart(13, '0')}`

describe('round reads and saves carry their read', () => {
  it('[web/ward-round] Round reads and saves carry their read: Two beds', async () => {
    const f = fake({ reads: [read('urinal', 'urine', 450, 51), read('water_jug', 'water', 600, 52)] })
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), cardOf(4))
    await round.onPhoto(photo(), null)
    await round.idle()
    const reads = f.calls.flatMap((c, i) => (c === 'POST /api/ai/read' ? [f.bodies[i]!.admission_id] : []))
    assert.deepEqual(reads, ['2', '4'])
  })

  it('[web/ward-round] Round reads and saves carry their read: Save all high-confidence', async () => {
    const f = fake({
      reads: [segmented(read('urinal', 'urine', 450, 51, 0.9)), segmented(read('water_jug', 'water', 600, 52, 0.8))],
    })
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), cardOf(4))
    await round.onPhoto(photo(), null)
    await round.idle()
    f.calls.length = 0
    const copies = fakeCopies()
    assert.equal(await round.saveHighConfidence(), 2)
    copies.restore()
    // Exactly six: per bed the photo, its labeled copy, then the post with `labeled_media_id`.
    assert.deepEqual(f.calls, [
      'POST /api/admissions/2/media',
      'POST /api/admissions/2/media',
      'POST /api/admissions/2/entries',
      'POST /api/admissions/4/media',
      'POST /api/admissions/4/media',
      'POST /api/admissions/4/levels',
    ])
    assert.equal(f.posts[0]!.body.read_id, 51)
    assert.equal(f.posts[1]!.body.read_id, 52)
    assert.deepEqual(
      f.posts.map((p) => [p.body.media_id, p.body.labeled_media_id]),
      [
        [500, 501],
        [502, 503],
      ],
    )
  })

  it('[web/ward-round] Round reads and saves carry their read: Bag reading', async () => {
    // Read in `spark` mode, with `segmentation: null`: two requests, no copy.
    const f = fake({ reads: [spark(read('urine_bag', 'urine', 450, 54, 0.9))] })
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    await round.onPhoto(photo(), null)
    await round.idle()
    f.calls.length = 0
    const copies = fakeCopies()
    await round.saveHighConfidence()
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/2/media', 'POST /api/admissions/2/bag-readings'])
    const b = f.posts[0]!.body
    assert.deepEqual([b.container, b.source, b.media_id, b.read_id], ['urine_bag', 'photo', 500, 54])
    assert.equal('labeled_media_id' in b, false)
  })

  it('[web/ward-round] Round reads and saves carry their read: Stale reading', async () => {
    const clock = { t: at(8) }
    const f = fake({ reads: [read('urinal', 'urine', 450, 51)] })
    const round = new Round(f.api, { now: () => clock.t })
    await round.onPhoto(photo(), cardOf(2))
    await round.onPhoto(photo(), null)
    await round.idle()
    clock.t = at(19, 55)
    const saved = await round.save(round.getState().readings[0]!.id)
    assert.ok(saved?.entry)
    assert.equal('read_id' in f.posts[0]!.body, false)
  })

  it('[web/ward-round] Round reads and saves carry their read: Recording with two drafts', async () => {
    const f = fake({ notes: [teaAndUrine(53)] })
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    round.onRecording(audio(), 4200)
    await round.idle()
    assert.equal(f.bodies[f.calls.indexOf('POST /api/ai/voice-note')]!.admission_id, '2')
    f.calls.length = 0
    await round.save(round.getState().readings[0]!.id)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/media', 'POST /api/admissions/2/entries', 'POST /api/admissions/2/entries'])
    assert.deepEqual(
      f.posts.map((x) => link(x.body)),
      [
        [53, 0],
        [53, 1],
      ],
    )
  })

  it('[web/ward-round] Round reads and saves carry their read: Dropped draft', async () => {
    const f = fake({ notes: [teaAndUrine(53)] })
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    round.onRecording(audio(), 4200)
    await round.idle()
    const id = round.getState().readings[0]!.id
    round.dropDraft(id, 0)
    f.calls.length = 0
    await round.save(id)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/media', 'POST /api/admissions/2/entries'])
    assert.deepEqual(link(f.posts[0]!.body), [53, 1])
  })

  it('[web/ward-round] Round reads and saves carry their read: Imported queue', async () => {
    const f = fake()
    const round = new Round(f.api)
    await round.onPhoto(photo(), cardOf(2))
    const file = (name: string, type: string) => new File([new Uint8Array([1, 2, 3, 4])], name, { type })
    await round.import(
      [
        file('a.jpg', 'image/jpeg'),
        file('b.jpg', 'image/jpeg'),
        file('one.m4a', 'audio/mp4'),
        file('c.jpg', 'image/jpeg'),
        file('two.webm', 'audio/webm'),
      ],
      () => Promise.resolve(null),
    )
    assert.equal(round.waitingRequests(), 13)
    assert.deepEqual(
      f.calls.filter((c) => c.includes('/api/ai/')),
      [],
    )
  })
})

describe('round saves resume after a failure', () => {
  /** A round on bed 2 with one recording read as 53 (tea and urine), ready to save. */
  async function recorded(fail: (Step | null)[], now?: () => number) {
    const f = fake({ notes: [teaAndUrine(53)], fail })
    const round = new Round(f.api, now ? { now } : {})
    await round.onPhoto(photo(), cardOf(2))
    round.onRecording(audio(), 4200)
    await round.idle()
    return { f, round, id: round.getState().readings[0]!.id }
  }

  it('[web/ward-round] Round saves resume after a failure: Second draft fails', async () => {
    const { f, round, id } = await recorded([null, 'network'])
    await assert.rejects(round.save(id))
    assert.equal(round.getState().readings[0]!.status, 'ready')
    f.calls.length = 0
    const saved = await round.save(id)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/entries'])
    assert.deepEqual(link(f.posts[1]!.body), [53, 1])
    assert.equal(round.getState().readings[0]!.status, 'saved')
    assert.deepEqual(
      saved?.entries?.map((e) => e.volume_ml),
      [200, 300],
    )
  })

  it('[web/ward-round] Round saves resume after a failure: Already linked', async () => {
    const { f, round, id } = await recorded([null, 'network', 'linked'])
    await assert.rejects(round.save(id))
    f.calls.length = 0
    const saved = await round.save(id)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/entries'])
    assert.deepEqual(link(f.bodies[f.bodies.length - 1]!), [53, 1])
    const r = round.getState().readings[0]!
    assert.deepEqual([r.status, r.error], ['saved', undefined])
    assert.ok(saved)
    f.calls.length = 0
    assert.equal(await round.save(id), null)
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward-round] Round saves resume after a failure: Retry past the margin', async () => {
    const clock = { t: at(8) }
    const { f, round, id } = await recorded([null, 'network'], () => clock.t)
    clock.t = at(19, 54)
    await assert.rejects(round.save(id))
    clock.t = at(19, 56)
    f.calls.length = 0
    await round.save(id)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/entries'])
    assert.deepEqual(
      f.posts.map((x) => link(x.body)),
      [
        [53, 0],
        [53, 1],
      ],
    )
  })
})

describe('the read link helpers', () => {
  it('alreadyLinked is the 400 with that issue at read_id, and nothing else', async () => {
    const f = fake({ fail: ['linked', 'network'] })
    const drink: Pending = {
      draft: { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null },
      source: 'text',
      confidence: null,
    }
    const linked = await saveEntry(f.api, 16, drink).catch((e: unknown) => e)
    const offline = await saveEntry(f.api, 16, drink).catch((e: unknown) => e)
    assert.equal(alreadyLinked(linked), true)
    assert.equal(alreadyLinked(offline), false)
    assert.equal(alreadyLinked(new Error('x')), false)
  })
})
