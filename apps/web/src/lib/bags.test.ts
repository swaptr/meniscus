import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  Admission,
  Alert,
  BagChart,
  BagPeriod,
  BagReading,
  BagReadingResult,
  CaptureReadResult,
  ContainerReading,
  Entry,
  EntryList,
  LevelSnapshot,
  MediaRef,
  OutputDevices,
} from '@meniscus/shared'
import { createApi } from './api.ts'
import { fakeCopies } from './copy-fixtures.ts'
import { ANITA, RAVI, entry } from './audit-fixtures.ts'
import {
  afterView,
  bagContainer,
  bagEvent,
  bagSections,
  byHandDraft,
  checkView,
  discardedText,
  draftFromRead,
  duplicateText,
  emptiedNow,
  fallsOf,
  finishAfterEmptying,
  missedForm,
  missedSubmit,
  nearlyFullLine,
  offersMissedEmptying,
  postBagReading,
  saveAnyway,
  saveBagReading,
  savedText,
  trySaveBag,
  bagMismatch,
  bagOfCategory,
  byHandCategory,
  promptDevice,
  type BagOutcome,
  type BagRefused,
} from './bags.ts'
import { applyCare, bedScreenLoad, careInput, formDefaults, mayOrder } from './care.ts'
import { hintsFor, photoTileHint, unmeasuredLine, type Pending } from './capture.ts'
import { toEvidence } from './evidence.ts'
import { ALERT_LABEL, BAG_NAME } from './labels.ts'
import { chartedAt, saveByHand } from './resolve.ts'
import { photoTitle, rejectSourceText, sourceOf } from './sources.ts'
import { timeline } from './timeline.ts'
import { bedLoad } from './ward.ts'
import { photoShown } from './photo-view.ts'

/** Local time on `d` Nov 2026 (3 Nov by default). */
const ms = (h: number, m = 0, d = 3) => new Date(2026, 10, d, h, m).getTime()
const at = (h: number, m = 0, d = 3) => new Date(ms(h, m, d)).toISOString()
const signal = new AbortController().signal
const photoBlob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

const admission = (ward_code: string, over: Partial<Admission> = {}): Admission => ({
  id: 31,
  bed: '3',
  patient: 'Rohan Das',
  weight_kg: 69,
  qr_token: 'tok3A3tok3A3tok3A3tok3',
  admitted_at: at(9, 0, 1),
  ward_id: 2,
  ward_code,
  ward_name: ward_code === 'HDU' ? 'Renal HDU' : 'General medicine',
  mrn: 'AT-100303',
  ...over,
})
const media = (id: number, h = 8): MediaRef => ({
  id,
  kind: 'photo',
  mime: 'image/jpeg',
  size: 4,
  duration_ms: null,
  created_at: at(h),
  sha256: null,
  served_meal: null,
})

let nextId = 40
const reading = (over: Partial<BagReading> & Pick<BagReading, 'volume_ml'>): BagReading => ({
  labeled_media: null,
  id: nextId++,
  container: 'urine_bag',
  event: 'check',
  baseline_ml: 0,
  rise_ml: over.volume_ml,
  fell: false,
  fell_from_ml: null,
  residual_ml: null,
  source: 'manual',
  media: null,
  proof_media: null,
  evidence: null,
  created_by: RAVI,
  created_at: at(8),
  recorded_at: over.created_at ?? at(8),
  late: false,
  entry: null,
  confirmed_duplicate_of: null,
  ...over,
})
const period = (readings: BagReading[], over: Partial<BagPeriod> = {}): BagPeriod => ({
  container: 'urine_bag',
  start_at: null,
  end_at: null,
  opened_by: null,
  closed_by: null,
  readings,
  total_ml: readings.reduce((s, r) => s + r.rise_ml, 0),
  rate_ml_h: null,
  ...over,
})
const chart = (periods: BagPeriod[], interval_h = 4): BagChart => ({ interval_h, interval_from: 'default', periods })
const list = (a: Admission, bags: BagChart, alerts: Alert[] = []): EntryList => ({
  admission: a,
  entries: [],
  totals: { in_ml: 0, out_ml: 0, balance_ml: 0, pending_ml: 0 },
  alerts,
  urine_seen: null,
  care: { orders: [], fluid_limit: null, intake_target: null, catheter: null },
  devices: { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] },
  care_history: [],
  bags,
  acuity: { level: 'stable', source: 'ward', order_id: null, suggested: null, reasons: [] },
  nutrition: { dietitian_available: true, dietitian: null, referral: null },
})
const bagRead = (ml: number, container: ContainerReading['container'] = 'urine_bag'): CaptureReadResult => ({
  image_sha256: 'c0ffee'.padEnd(64, '0'),
  mode: 'sam+spark',
  reading: {
    container,
    fluid: 'urine',
    volume_ml: ml,
    capacity_ml: 2000,
    marks_visible: true,
    reading_basis: 'between the marks',
    appearance: null,
    confidence: 0.9,
    issues: [],
  },
  segmentation: {
    container: { left: 1, top: 1, right: 9, bottom: 9 },
    fluid: { left: 2, top: 5, right: 8, bottom: 9 },
    fill_fraction: 0.5,
  },
  draft: { direction: 'out', category: 'urine', volume_ml: ml, item: null, notes: null },
  needs_review: false,
  warnings: [],
  trace: [
    { step: 'sam:container', model: 'sam-3.1', ms: 2000 },
    { step: 'sam:liquid', model: 'sam-3.1', ms: 2000 },
    { step: 'spark:read', model: 'muse-spark-1.3', ms: 4000 },
  ],
  ms: 8000,
})
/** The server's 201 for a saved reading. */
const saved = (r: Partial<BagReading> & Pick<BagReading, 'volume_ml'>, entryMl: number | null): BagReadingResult => {
  const rd = reading(r)
  return {
    reading: rd,
    entry: entryMl === null ? null : entry({ id: 900, direction: 'out', category: 'urine', volume_ml: entryMl, status: 'pending' }),
  }
}

/** Fake server: records "METHOD path", X-Staff-Id and bodies; answers from `routes` (regex on "METHOD path"), else 404. */
function fake(routes: Record<string, (body: unknown) => Response> = {}, staffId: number | null = RAVI.id) {
  const calls: string[] = []
  const staff: (string | null)[] = []
  const bodies: unknown[] = []
  let nextMedia = 500
  const api = createApi(
    (url, init) => {
      const key = `${init?.method ?? 'GET'} ${url}`
      calls.push(key)
      staff.push(new Headers(init?.headers).get('x-staff-id'))
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null)
      bodies.push(body instanceof FormData ? Object.fromEntries([...body.entries()].filter(([k]) => k !== 'file')) : body)
      if (/^POST \/api\/admissions\/\d+\/media$/.test(key)) return Promise.resolve(Response.json(media(nextMedia++), { status: 201 }))
      const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key))
      return Promise.resolve(hit ? hit[1](body) : Response.json({ error: 'not_found' }, { status: 404 }))
    },
    () => staffId,
  )
  return { api, calls, staff, bodies, ai: () => calls.filter((c) => c.includes('/api/ai/')) }
}
const json = (body: unknown, status = 200) => Response.json(body, { status })
const EMPTY_CARE = { orders: [], fluid_limit: null, intake_target: null, catheter: null }
/** The bed's devices: the default urinal unless overridden. */
const dev = (over: Partial<OutputDevices> = {}): OutputDevices => ({
  urine: 'urinal',
  urine_from: 'default',
  urine_measured: true,
  bags: [],
  ...over,
})
/** "Enter by hand": a 200 mL drink, as the bed screen starts it. */
const manualWater = (): Pending => ({
  draft: { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null },
  source: 'manual',
  confidence: null,
})

describe('bag photos record readings', () => {
  it('[web/capture] Bag photos record readings: Emptied on a general ward', async () => {
    const a = admission('3A')
    const last = reading({ event: 'check', volume_ml: 260, baseline_ml: 150, rise_ml: 110, created_at: at(10) })
    const read = bagRead(380)
    const darkRead = { ...read, draft: { ...read.draft!, urine_colour: 'dark' as const } }
    const f = fake({
      'GET /api/beds/.+': () => json(a),
      'GET /api/admissions/31/entries': () => json(list(a, chart([period([last], { start_at: at(8), opened_by: 'emptied' })]))),
      'POST /api/ai/read': () => json(darkRead),
      'POST /api/admissions/31/bag-readings': () =>
        json(saved({ event: 'emptied', volume_ml: 380, baseline_ml: 260, rise_ml: 120, created_at: at(11) }, 120), 201),
    })
    const bed = await bedScreenLoad(f.api, a.qr_token)(signal)
    const photo = photoBlob()
    const r = await f.api.read(photo)
    const d = draftFromRead(r, toEvidence(r, null), bed.admission)!
    const v = checkView(d, bed.bags, ms(11))
    assert.deepEqual(
      [v.last, v.preview, bagEvent(d), v.next],
      ['Last reading 260 mL at 10:00', '+120 mL since 10:00', 'emptied', 'The next reading starts from 0 mL.'],
    )
    assert.deepEqual(f.calls, [`GET /api/beds/${a.qr_token}`, 'GET /api/admissions/31/entries', 'POST /api/ai/read'])
    f.calls.length = 0
    f.bodies.length = 0
    const copies = fakeCopies()
    const s = await saveBagReading(f.api, a.id, d, { kind: 'photo', blob: photo })
    copies.restore()
    // The sam+spark read is segmented: the photo, its labeled copy, then the reading.
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    assert.deepEqual(f.bodies[0], { kind: 'photo' })
    assert.deepEqual(f.bodies[1], { kind: 'photo' })
    assert.equal(copies.draws[0]!.photo, photo)
    const body = f.bodies[2] as Record<string, unknown>
    assert.deepEqual(
      [body.container, body.event, body.volume_ml, body.source, body.media_id, body.labeled_media_id, body.urine_colour],
      ['urine_bag', 'emptied', 380, 'photo', 500, 501, 'dark'],
    )
    assert.equal('urine_rgb' in body, false)
    assert.deepEqual(body.evidence, toEvidence(r, null))
    assert.equal(savedText(s.result), 'Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval.')
  })

  it('[web/capture] Bag photos record readings: Hourly check on HDU', async () => {
    const a = admission('HDU', { id: 41, bed: '1' })
    const last = reading({ volume_ml: 150, created_at: at(9) })
    const f = fake({
      'POST /api/admissions/41/bag-readings': () =>
        json(saved({ event: 'check', volume_ml: 260, baseline_ml: 150, rise_ml: 110, created_at: at(10) }, 110), 201),
    })
    const r = bagRead(260)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    const v = checkView(d, chart([period([last])], 1), ms(10))
    assert.deepEqual([bagEvent(d), v.next], ['check', 'The next reading starts from 260 mL.'])
    const s = await saveBagReading(f.api, a.id, d)
    assert.equal((f.bodies.at(-1) as { event: string }).event, 'check')
    assert.equal(savedText(s.result), 'Urine bag checked at 260 mL: 110 mL charted. Waiting for nurse approval.')
  })

  it('[web/capture] Bag photos record readings: Bag changed', async () => {
    const a = admission('HDU', { id: 41, bed: '1' })
    const f = fake({ 'POST /api/admissions/41/bag-readings': () => json(saved({ event: 'bag_changed', volume_ml: 260 }, 260), 201) })
    const r = bagRead(260)
    const d = { ...draftFromRead(r, toEvidence(r, null), a)!, changed: true }
    const v = checkView(d, chart([], 1), ms(10))
    assert.deepEqual([bagEvent(d), v.next], ['bag_changed', 'The next reading starts from 0 mL.'])
    await saveBagReading(f.api, a.id, d)
    assert.equal((f.bodies.at(-1) as { event: string }).event, 'bag_changed')
  })

  it('[web/capture] Bag photos record readings: Level fell', async () => {
    const a = admission('HDU', { id: 41 })
    const f = fake({
      'POST /api/admissions/41/bag-readings': () =>
        json(saved({ volume_ml: 150, baseline_ml: 0, rise_ml: 150, fell: true, fell_from_ml: 500, created_at: at(12) }, 150), 201),
    })
    const r = bagRead(150)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    assert.equal(bagEvent(d), 'check')
    const v = checkView(d, chart([period([reading({ volume_ml: 500, created_at: at(9) })])], 1), ms(12))
    assert.equal(
      v.preview,
      'Below the 09:00 reading (500 mL) with no emptying recorded. Saving charts 150 mL and asks the nurse to review.',
    )
    assert.equal(v.fell, true)
    const s = await saveBagReading(f.api, a.id, d)
    assert.equal(
      savedText(s.result),
      'Urine bag checked at 150 mL: 150 mL charted and flagged for review, as the level fell. Waiting for nurse approval.',
    )
  })

  it('[web/capture] Bag photos record readings: Nothing to chart', async () => {
    const a = admission('HDU', { id: 41 })
    const f = fake({
      'POST /api/admissions/41/bag-readings': () =>
        json(saved({ volume_ml: 300, baseline_ml: 300, rise_ml: 0, created_at: at(10, 13) }, null), 201),
    })
    const r = bagRead(300)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    const v = checkView(d, chart([period([reading({ volume_ml: 300, created_at: at(10, 2) })])], 1), ms(10, 13))
    assert.equal(v.preview, 'No rise since 10:02: saving charts nothing')
    const text = savedText((await saveBagReading(f.api, a.id, d)).result)
    assert.equal(text, 'Urine bag checked at 300 mL: nothing new to chart.')
    assert.ok(!text.includes('Waiting for nurse approval'))
  })

  it('[web/capture] Bag photos record readings: First reading', () => {
    const r = bagRead(600)
    const d = draftFromRead(r, toEvidence(r, null), admission('3A'))!
    const v = checkView(d, chart([]), ms(8))
    assert.deepEqual([v.last, v.preview], [null, 'First reading of this bag: saving charts 600 mL'])
  })

  it('[web/capture] Bag photos record readings: Adjusted bag reading', async () => {
    const a = admission('3A')
    const f = fake({ 'POST /api/admissions/31/bag-readings': () => json(saved({ volume_ml: 430 }, 430), 201) })
    const r = bagRead(450)
    const d = { ...draftFromRead(r, toEvidence(r, null), a)!, volume_ml: 430 }
    await saveBagReading(f.api, a.id, d, { kind: 'photo', blob: photoBlob() })
    const body = f.bodies.at(-1) as {
      volume_ml: number
      evidence: { kind: string; reading: { volume_ml: number }; segmentation: unknown; trace: unknown }
    }
    assert.equal(body.volume_ml, 430)
    assert.equal(body.evidence.kind, 'photo')
    assert.equal(body.evidence.reading.volume_ml, 450)
    assert.deepEqual(body.evidence.segmentation, r.segmentation)
    assert.deepEqual(body.evidence.trace, r.trace)
  })

  it('[web/capture] Bag photos record readings: Urinal', async () => {
    const a = admission('3A')
    // Read in `spark` mode: no segmentation, so no labeled copy.
    const r = { ...bagRead(300, 'urinal'), mode: 'spark' as const, segmentation: null }
    assert.equal(bagContainer(r.reading), null)
    assert.equal(draftFromRead(r, toEvidence(r, null), a), null)
    const f = fake({
      'POST /api/admissions/31/entries': () => json(entry({ id: 5, direction: 'out', category: 'urine', volume_ml: 300 }), 201),
    })
    const { saveEntry } = await import('./capture.ts')
    await saveEntry(
      f.api,
      a.id,
      { draft: r.draft!, source: 'photo', confidence: 0.9, evidence: toEvidence(r, null) },
      { kind: 'photo', blob: photoBlob() },
    )
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/entries'])
    assert.equal('labeled_media_id' in (f.bodies[1] as object), false)
    const body = f.bodies[1] as { direction: string; category: string; volume_ml: number }
    assert.deepEqual([body.direction, body.category, body.volume_ml], ['out', 'urine', 300])
  })
})

describe('photos without a read', () => {
  it('[web/capture] Labeled copy drawn at the bed: No read, no copy', async () => {
    const copies = fakeCopies()
    const a = admission('3A')
    // A typed bag level with a photo: one upload, then the reading, with no copy.
    const f = fake({ 'POST /api/admissions/31/bag-readings': () => json(saved({ event: 'check', volume_ml: 400 }, null), 201) })
    const typed = byHandDraft('urine_bag', 400, a, null, true)
    await trySaveBag(f.api, a.id, typed, { kind: 'photo', blob: photoBlob() })
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    assert.equal('labeled_media_id' in (f.bodies[1] as object), false)
    // An after-emptying photo: one upload, then its post.
    const g = fake({ 'POST /api/bag-readings/31/after-emptying': () => json(reading({ id: 31, volume_ml: 380 })) })
    await finishAfterEmptying(g.api, 13, { id: 31, event: 'emptied', volume_ml: 380 }, { photo: photoBlob(), residual_ml: 0 })
    assert.deepEqual(g.calls, ['POST /api/admissions/13/media', 'POST /api/bag-readings/31/after-emptying'])
    copies.restore()
    assert.equal(copies.draws.length, 0)
  })
})

describe('bag level by hand', () => {
  const ok = () => json(saved({ event: 'emptied', volume_ml: 400 }, 400), 201)

  it('[web/capture] Bag level by hand: Emptied now', async () => {
    const a = admission('3A')
    const f = fake({ 'POST /api/admissions/31/bag-readings': ok })
    // 3A bed 3 has its catheter: picking urine output offers "Bag level", already on.
    const devices = dev({ urine: 'catheter', urine_from: 'catheter', bags: ['urine_bag'] })
    assert.equal(byHandCategory(manualWater(), 'urine', EMPTY_CARE, devices).bagOn, true)
    const bag = bagOfCategory('urine', devices)
    assert.equal(bag, 'urine_bag')
    const d = byHandDraft(bag, 400, a, null)
    assert.equal(d.emptied, true)
    await saveBagReading(f.api, a.id, d)
    assert.deepEqual(f.calls, ['POST /api/admissions/31/bag-readings'])
    assert.deepEqual(f.bodies[0], { container: 'urine_bag', event: 'emptied', volume_ml: 400, source: 'manual' })
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] Bag level by hand: Earlier time', async () => {
    const a = admission('3A')
    const f = fake({ 'POST /api/admissions/31/bag-readings': ok })
    const when = chartedAt('12:30', new Date(ms(14)), a.admitted_at)
    assert.ok('iso' in when)
    await saveBagReading(f.api, a.id, byHandDraft('urine_bag', 400, a, when.iso))
    assert.equal((f.bodies[0] as { charted_at: string }).charted_at, new Date(2026, 10, 3, 12, 30).toISOString())
  })

  it('[web/capture] Bag level by hand: Photo, level typed', async () => {
    const a = admission('3A')
    const f = fake({ 'POST /api/admissions/31/bag-readings': ok })
    const d = byHandDraft('urine_bag', 400, a, null, true)
    await saveBagReading(f.api, a.id, d, { kind: 'photo', blob: photoBlob() })
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    assert.deepEqual(f.bodies[0], { kind: 'photo' })
    assert.deepEqual(f.bodies[1], { container: 'urine_bag', event: 'emptied', volume_ml: 400, source: 'photo', media_id: 500 })
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] Bag level by hand: Not a bag', async () => {
    // "Bag level" offered on a catheterised bed, and turned off: the 300 mL is an entry.
    assert.equal(bagOfCategory('urine', dev({ urine: 'catheter', urine_from: 'catheter', bags: ['urine_bag'] })), 'urine_bag')
    const f = fake({ 'POST /api/admissions/31/entries': () => json(entry({ id: 6 }), 201) })
    await saveByHand(
      f.api,
      31,
      { draft: { direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: null }, source: 'manual', confidence: null },
      null,
    )
    assert.deepEqual(f.calls, ['POST /api/admissions/31/entries'])
  })
})

describe('after-emptying photo', () => {
  const emptying = reading({ id: 31, event: 'emptied', volume_ml: 600, created_at: at(8) })
  const afterOk = () => json({ ...emptying, proof_media: media(500) })

  it('[web/capture] After-emptying photo: Proof photo', async () => {
    const v = afterView(emptying)
    assert.deepEqual([v.actions[0], v.residual], ['Add after-emptying photo', true])
    const f = fake({ 'POST /api/bag-readings/31/after-emptying': afterOk })
    const r = await finishAfterEmptying(f.api, 13, emptying, { photo: photoBlob(), residual_ml: 0 })
    assert.ok(r)
    assert.deepEqual(f.calls, ['POST /api/admissions/13/media', 'POST /api/bag-readings/31/after-emptying'])
    assert.deepEqual(f.bodies, [{ kind: 'photo' }, { media_id: 500 }])
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] After-emptying photo: Residual only', async () => {
    const f = fake({ 'POST /api/bag-readings/31/after-emptying': afterOk })
    await finishAfterEmptying(f.api, 13, emptying, { residual_ml: 30 })
    assert.deepEqual(f.calls, ['POST /api/bag-readings/31/after-emptying'])
    assert.deepEqual(f.bodies, [{ residual_ml: 30 }])
  })

  it('[web/capture] After-emptying photo: Nothing added', async () => {
    const f = fake()
    assert.equal(await finishAfterEmptying(f.api, 13, emptying, { residual_ml: 0 }), null)
    assert.deepEqual(f.calls, [])
  })

  it('[web/capture] After-emptying photo: After a check', async () => {
    const check = reading({ id: 50, event: 'check', volume_ml: 260, created_at: at(10) })
    assert.deepEqual(afterView(check).actions[0], 'Emptied it now? Add after-emptying photo')
    const f = fake(
      {
        'POST /api/admissions/41/bag-readings': () => json(saved({ id: 51, event: 'emptied', volume_ml: 260, rise_ml: 0 }, null), 201),
        'POST /api/bag-readings/51/after-emptying': () => json(reading({ id: 51, event: 'emptied', volume_ml: 260 })),
      },
      ANITA.id,
    )
    const now = await emptiedNow(f.api, 41, check)
    assert.equal(now.reading.event, 'emptied')
    await finishAfterEmptying(f.api, 41, now.reading, { photo: photoBlob(), residual_ml: 0 })
    assert.deepEqual(f.calls, [
      'POST /api/admissions/41/bag-readings',
      'POST /api/admissions/41/media',
      'POST /api/bag-readings/51/after-emptying',
    ])
    assert.deepEqual(f.bodies[0], { container: 'urine_bag', event: 'emptied', volume_ml: 260, source: 'manual' })
    assert.deepEqual(f.bodies[2], { media_id: 500 })
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] After-emptying photo: Check left as it is', async () => {
    const f = fake()
    const check = reading({ event: 'check', volume_ml: 260 })
    assert.equal(afterView(check).residual, false)
    assert.equal(await finishAfterEmptying(f.api, 41, check, { residual_ml: 0 }), null)
    assert.deepEqual(f.calls, [])
  })
})

describe('bag periods on the bed review', () => {
  const closed = () => {
    const first = reading({ event: 'emptied', volume_ml: 600, created_at: at(8) })
    const ps = [
      period(
        [
          reading({ volume_ml: 150, baseline_ml: 0, rise_ml: 150, created_at: at(10) }),
          reading({ volume_ml: 260, baseline_ml: 150, rise_ml: 110, created_at: at(11) }),
          reading({ event: 'emptied', volume_ml: 380, baseline_ml: 260, rise_ml: 120, created_at: at(12) }),
        ],
        { start_at: at(8), end_at: at(12), opened_by: 'emptied', closed_by: 'emptied', rate_ml_h: 95 },
      ),
      period([first], { end_at: at(8), closed_by: 'emptied' }),
    ]
    return ps
  }

  it('[web/ward] Bag periods on the bed review: Closed period', () => {
    const [bag] = bagSections(chart(closed()), ms(13))
    const p = bag!.periods[0]!
    assert.equal(p.header, '08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h')
    assert.deepEqual(
      p.rows.map((r) => r.text),
      ['10:00 · Check · 150 mL · +150 mL', '11:00 · Check · 260 mL · +110 mL', '12:00 · Emptied · 380 mL · +120 mL'],
    )
  })

  it('[web/ward] Bag periods on the bed review: Open period and unknown start', () => {
    const open = period([reading({ volume_ml: 150, created_at: at(13) })], { start_at: at(12), opened_by: 'emptied', rate_ml_h: 150 })
    const [bag] = bagSections(chart([open, ...closed()]), ms(13, 30))
    assert.equal(bag!.periods[0]!.header, 'Since 12:00: 150 mL so far (1 reading)')
    assert.equal(bag!.periods.at(-1)!.header, 'Until 08:00: 600 mL (1 reading, emptied 08:00)')
  })

  it('[web/ward] Bag periods on the bed review: Too short to rate', () => {
    const short = period([reading({ event: 'emptied', volume_ml: 450, baseline_ml: 0, rise_ml: 450, created_at: at(8, 10) })], {
      start_at: at(8),
      end_at: at(8, 10),
      opened_by: 'emptied',
      closed_by: 'emptied',
      rate_ml_h: null,
    })
    const [bag] = bagSections(chart([short]), ms(13))
    assert.equal(bag!.periods[0]!.header, '08:00 → 08:10: 450 mL (1 reading, emptied 08:10) · — mL/h')
  })

  it('[web/ward] Bag periods on the bed review: Fall', () => {
    const fell = reading({ volume_ml: 150, rise_ml: 150, fell: true, fell_from_ml: 500, created_at: at(12) })
    const [bag] = bagSections(chart([period([fell])]), ms(13))
    const row = bag!.periods[0]!.rows[0]!
    assert.equal(row.text, '12:00 · Check · 150 mL · +150 mL · Level fell from 500 mL')
    // The list row shows a `Level fell` chip, then "from 500 mL" as plain text.
    assert.deepEqual(row.fall, { chip: 'Level fell', from: 'from 500 mL' })
  })

  it('[web/ward] Bag periods on the bed review: Late reading already charted', () => {
    const rs = [
      reading({ volume_ml: 150, created_at: at(9), entry: { id: 1, volume_ml: 150, status: 'pending' } }),
      reading({ volume_ml: 260, baseline_ml: 150, rise_ml: 110, created_at: at(10), recorded_at: at(11, 30), late: true }),
      reading({
        event: 'emptied',
        volume_ml: 380,
        baseline_ml: 260,
        rise_ml: 120,
        created_at: at(11),
        entry: { id: 2, volume_ml: 230, status: 'pending' },
      }),
    ]
    const [bag] = bagSections(chart([period(rs, { end_at: at(11), closed_by: 'emptied' })]), ms(12))
    const row = bag!.periods[0]!.rows[1]!
    assert.equal(row.text, '10:00 · Check · 260 mL · +110 mL · Late · 90 min · charted with 11:00')
    // The list row shows the same parts, in the same order.
    assert.deepEqual(
      [row.time, row.event, row.change, row.fall, row.lateness, row.note],
      ['10:00', 'Check', '260 mL · +110 mL', null, 'Late · 90 min', 'charted with 11:00'],
    )
  })

  it('[web/ward] Bag periods on the bed review: Proof', () => {
    const r = reading({ event: 'emptied', volume_ml: 600, media: media(70), proof_media: media(71), residual_ml: 30, created_at: at(8) })
    const [bag] = bagSections(chart([period([r], { end_at: at(8), closed_by: 'emptied' })]), ms(9))
    const row = bag!.periods[0]!.rows[0]!
    assert.deepEqual(row.photos, [
      { media_id: 70, label: 'Before emptying' },
      { media_id: 71, label: 'After emptying' },
    ])
    assert.deepEqual([row.residual, row.by], ['Left in bag 30 mL', 'by Ravi K.'])
  })

  it('[web/ward] Raw and labeled views of a kept photo: Bag reading photo', () => {
    const copy = { ...media(72), sha256: '7c1e'.padEnd(62, '0') + 'd4' }
    const r = reading({ event: 'emptied', volume_ml: 600, media: media(70), labeled_media: copy, created_at: at(8) })
    const [bag] = bagSections(chart([period([r], { end_at: at(8), closed_by: 'emptied' })]), ms(9))
    const [tile] = bag!.periods[0]!.rows[0]!.photos
    assert.deepEqual(tile, { media_id: 70, label: 'Before emptying', labeled: copy })
    // The viewer opens on Labeled, fetching the copy only; Raw fetches the photo.
    const labeled = photoShown({ media_id: tile.media_id, labeled: tile.labeled, segmented: true, mode: 'labeled' })
    assert.deepEqual([labeled.media_id, labeled.copy, labeled.line?.text], [72, true, 'Labeled copy fingerprint: 7c1e…d4'])
    assert.equal(photoShown({ media_id: 70, labeled: copy, segmented: true, mode: 'raw' }).media_id, 70)
  })

  it('[web/ward] Bag periods on the bed review: No extra request', async () => {
    const a = admission('3A')
    const f = fake({
      'GET /api/admissions/31/entries': () => json(list(a, chart(closed()))),
      'GET /api/admissions/31/meals': () => json([]),
    })
    const data = await bedLoad(f.api, a.id)(signal)
    assert.equal(bagSections(data.bags, ms(13)).length, 1)
    assert.deepEqual(f.calls, ['GET /api/admissions/31/entries', 'GET /api/admissions/31/meals'])
    assert.deepEqual(bagSections(chart([]), ms(13)), [])
  })
})

describe('add a missed emptying', () => {
  const fallAlert = (from: number, to: number, entryId: number | null): Alert => ({
    kind: 'bag_level_fell',
    message: `Urine bag level fell from ${from} to ${to} mL with no emptying recorded. Was it emptied? Review.`,
    entry_ids: entryId === null ? [] : [entryId],
    meal_ids: [],
  })
  /** A fall from `from` mL at `prevAt` to `to` mL at `fellAt`. */
  const fallChart = (from: number, prevAt: string, to: number, fellAt: string, prev: Partial<BagReading> = {}) => {
    const before = reading({ volume_ml: from, created_at: prevAt, ...prev })
    const fell = reading({
      volume_ml: to,
      rise_ml: to,
      fell: true,
      fell_from_ml: prev.event === 'emptied' ? (prev.residual_ml ?? 0) : from,
      created_at: fellAt,
      entry: { id: 77, volume_ml: to, status: 'pending' },
    })
    return chart([period([fell]), period([before], { end_at: prevAt })])
  }

  it('[web/ward] Add a missed emptying: Nurse adds it', async () => {
    const a = admission('2C', { id: 26, bed: '6' })
    const bags = fallChart(500, at(9), 150, at(12))
    const [fall] = fallsOf(bags, [fallAlert(500, 150, 77)], ms(13))
    assert.ok(fall)
    assert.equal(offersMissedEmptying(ANITA), true)
    const form = missedForm(fall, ms(13), a.admitted_at)
    const sent = missedSubmit(form, '10:30', 550)
    assert.ok('input' in sent)
    const f = fake(
      {
        'POST /api/admissions/26/bag-readings': () =>
          json(saved({ event: 'emptied', volume_ml: 550, created_at: at(10, 30), late: true }, 50), 201),
      },
      ANITA.id,
    )
    const r = await f.api.addBagReading(a.id, sent.input)
    assert.deepEqual(f.calls, ['POST /api/admissions/26/bag-readings'])
    assert.deepEqual(f.bodies[0], { container: 'urine_bag', event: 'emptied', volume_ml: 550, source: 'manual', charted_at: at(10, 30) })
    assert.deepEqual(f.staff, ['4'])
    assert.deepEqual(f.ai(), [])
    assert.deepEqual([r.entry?.volume_ml, r.entry?.status], [50, 'pending'])
  })

  it('[web/ward] Add a missed emptying: Floor at the residual', () => {
    const a = admission('2C', { id: 26, bed: '6' })
    const bags = fallChart(600, at(8), 20, at(9), { event: 'emptied', residual_ml: 30 })
    const [fall] = fallsOf(bags, [fallAlert(30, 20, 77)], ms(10))
    assert.equal(missedForm(fall!, ms(10), a.admitted_at).level, 30)
  })

  it('[web/ward] Add a missed emptying: Level not known', async () => {
    const a = admission('2C', { id: 26, bed: '6' })
    const bags = fallChart(500, at(9), 150, at(12))
    const [fall] = fallsOf(bags, [fallAlert(500, 150, 77)], ms(13))
    const form = missedForm(fall!, ms(13), a.admitted_at)
    const sent = missedSubmit(form, '10:30', form.level)
    assert.ok('input' in sent)
    const f = fake(
      {
        'POST /api/admissions/26/bag-readings': () => json(saved({ event: 'emptied', volume_ml: 500 }, null), 201),
        'GET /api/admissions/26/entries': () => json(list(a, chart([]), [])),
        'GET /api/admissions/26/meals': () => json([]),
      },
      ANITA.id,
    )
    await f.api.addBagReading(a.id, sent.input)
    assert.deepEqual(f.calls, ['POST /api/admissions/26/bag-readings'])
    const reloaded = await bedLoad(f.api, a.id)(signal)
    assert.deepEqual(fallsOf(reloaded.bags, reloaded.alerts, ms(13)), [])
  })

  it('[web/ward] Add a missed emptying: Attendant', () => {
    assert.equal(ALERT_LABEL.bag_level_fell, 'Bag level fell')
    assert.equal(offersMissedEmptying(RAVI), false)
    assert.equal(offersMissedEmptying(null), false)
  })

  it('[web/ward] Add a missed emptying: Refused on the device', () => {
    const a = admission('2C', { id: 26, bed: '6' })
    const [fall] = fallsOf(fallChart(500, at(9), 150, at(12)), [fallAlert(500, 150, 77)], ms(13))
    const form = missedForm(fall!, ms(13), a.admitted_at)
    // The level stepper is floored here, so "Less" is disabled at 500 mL; the submit check is a safeguard.
    assert.deepEqual([form.level, form.floor], [500, 500])
    assert.deepEqual(missedSubmit(form, '10:30', 450), { error: 'Below 500 mL, the level it fell from' })
    assert.deepEqual(missedSubmit(form, '09:00', 550), { error: 'Between 09:00 and 12:00' })
    assert.deepEqual(missedSubmit(form, '12:00', 550), { error: 'Between 09:00 and 12:00' })
  })

  it('[web/ward] Add a missed emptying: Across midnight', () => {
    const a = admission('2C', { id: 26, bed: '6' })
    const [fall] = fallsOf(fallChart(500, at(22, 0, 2), 150, at(2)), [fallAlert(500, 150, 77)], ms(3))
    const form = missedForm(fall!, ms(3), a.admitted_at)
    const first = missedSubmit(form, '23:30', 550)
    const second = missedSubmit(form, '00:30', 550)
    assert.ok('input' in first && 'input' in second)
    assert.equal(first.input.charted_at, at(23, 30, 2))
    assert.equal(second.input.charted_at, at(0, 30, 3))
  })

  it('[web/ward] Add a missed emptying: Older than a day', () => {
    const a = admission('2C', { id: 26, bed: '6' })
    // The 1 Nov reading is older than the chart read's window, so the bed review does not list it.
    const fell = reading({
      volume_ml: 150,
      rise_ml: 150,
      fell: true,
      fell_from_ml: 400,
      created_at: at(9),
      entry: { id: 77, volume_ml: 150, status: 'pending' },
    })
    const [fall] = fallsOf(chart([period([fell])]), [fallAlert(400, 150, 77)], ms(10))
    const form = missedForm(fall!, ms(10), a.admitted_at)
    assert.deepEqual(missedSubmit(form, '09:30', 450), { error: 'Between 2 Nov 10:00 and 09:00' })
    const ok = missedSubmit(form, '08:30', 450)
    assert.ok('input' in ok)
    assert.equal(ok.input.charted_at, at(8, 30))
  })
})

describe('bag reading on the entry', () => {
  const snap = (
    id: number,
    volume_ml: number,
    iso: string,
    event: LevelSnapshot['event'],
    residual_ml: number | null = null,
  ): LevelSnapshot => ({
    labeled_media: null,
    id,
    volume_ml,
    created_at: iso,
    media: media(100 + id),
    evidence: null,
    event,
    residual_ml,
  })
  const bagEntry = (volume: number, before: LevelSnapshot | null, after: LevelSnapshot, over: Partial<Entry> = {}) =>
    entry({
      id: 9,
      direction: 'out',
      category: 'urine',
      volume_ml: volume,
      recorded_ml: volume,
      source: 'photo',
      created_by: RAVI,
      created_at: after.created_at,
      recorded_at: after.created_at,
      media: after.media,
      has_photo: true,
      levels: { before, after },
      ...over,
    })
  const saveLine = (e: Entry) => timeline(e, []).find((s) => s.kind === 'save')!.text
  const levelsOf = (e: Entry) => {
    const src = sourceOf(e)
    assert.equal(src.kind, 'levels')
    return src.kind === 'levels' ? src : null
  }

  it('[web/ward] Bag reading on the entry: Rise since a check', () => {
    const e = bagEntry(110, snap(1, 150, at(10), 'check'), snap(2, 260, at(11), 'check'))
    const src = levelsOf(e)!
    assert.deepEqual(src.photos.map(photoTitle), ['150 mL · Check · 10:00', '260 mL · Check · 11:00'])
    assert.equal(src.drop, '150 mL → 260 mL · +110 mL')
    assert.equal(saveLine(e), 'Saved 110 mL, the rise since 10:00')
  })

  it('[web/ward] Bag reading on the entry: After an emptying', () => {
    const e = bagEntry(150, snap(1, 600, at(8), 'emptied'), snap(2, 150, at(10), 'check'))
    assert.equal(levelsOf(e)!.drop, '0 mL (emptied 08:00) → 150 mL · +150 mL')
  })

  it('[web/ward] Bag reading on the entry: First reading', () => {
    const e = bagEntry(600, null, snap(3, 600, at(8), 'emptied'))
    const src = levelsOf(e)!
    assert.equal(src.photos.length, 1)
    assert.equal(src.drop, '0 mL → 600 mL · +600 mL')
    assert.equal(saveLine(e), 'Saved 600 mL, the first reading of this bag')
  })

  it('[web/ward] Bag reading on the entry: Fall', () => {
    const e = bagEntry(150, snap(1, 500, at(9), 'check'), snap(2, 150, at(12), 'check'))
    assert.equal(levelsOf(e)!.drop, '500 mL → 150 mL · level fell')
    assert.equal(saveLine(e), 'Saved 150 mL, the whole level, as it fell since 09:00')
  })

  it('[web/ward] Bag reading on the entry: Late emptying', () => {
    const e = bagEntry(260, snap(1, 150, at(9), 'check'), snap(2, 260, at(10), 'emptied'), { recorded_at: at(11, 30), late: true })
    assert.equal(levelsOf(e)!.drop, '150 mL → 260 mL · +110 mL')
    assert.equal(saveLine(e), "Saved 260 mL, what this late reading adds to the bag's charted total")
  })

  it('[web/ward] Bag reading on the entry: Reject a bag entry', () => {
    const e = bagEntry(110, snap(1, 150, at(10), 'check'), snap(2, 260, at(11), 'check'))
    assert.equal(rejectSourceText(e), null)
  })
})

describe('duplicate bag reading at the bed', () => {
  const dup = (id: number, event: BagReading['event'], volume_ml: number, created_at: string) =>
    json({ error: 'duplicate_reading', duplicate_of: { id, event, volume_ml, created_at } }, 409)
  const refusedOf = (o: BagOutcome): BagRefused => {
    assert.ok('duplicate' in o, 'expected a 409')
    return o
  }
  const read49 = () => ({ ...bagRead(380), read_id: 49, read_kind: 'photo' as const })

  it('[web/capture] Duplicate bag reading at the bed: Saved twice', async () => {
    const a = admission('3A')
    const f = fake({ 'POST /api/admissions/31/bag-readings': () => dup(101, 'emptied', 380, at(11)) })
    const r = read49()
    const d = draftFromRead(r, toEvidence(r, null), a)!
    const o = refusedOf(await trySaveBag(f.api, a.id, d, { kind: 'photo', blob: photoBlob() }))
    assert.equal(duplicateText(o.duplicate, ms(11, 2)), 'Same as the reading at 11:00: emptied at 380 mL.')
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    assert.equal((f.bodies[1] as { read_id?: number }).read_id, 49)
    assert.deepEqual(f.ai(), [])
  })

  /** Saved twice, then the panel's state: the first attempt's body and the 11:00 reading. */
  async function refusedAt11() {
    const a = admission('3A')
    const answers: (() => Response | Promise<Response>)[] = [() => dup(101, 'emptied', 380, at(11))]
    const f = fake({ 'POST /api/admissions/31/bag-readings': () => answers.shift()!() as Response })
    const r = read49()
    const d = draftFromRead(r, toEvidence(r, null), a)!
    const o = refusedOf(await trySaveBag(f.api, a.id, d, { kind: 'photo', blob: photoBlob() }))
    const first = f.bodies[1] as Record<string, unknown>
    f.calls.length = 0
    f.bodies.length = 0
    return { a, f, o, first, answers }
  }

  it('[web/capture] Duplicate bag reading at the bed: Save anyway', async () => {
    const { a, f, o, first, answers } = await refusedAt11()
    answers.push(() => json(saved({ event: 'emptied', volume_ml: 380, confirmed_duplicate_of: 101 }, 380), 201))
    const r = await saveAnyway(f.api, a.id, o)
    assert.deepEqual(f.calls, ['POST /api/admissions/31/bag-readings'])
    const sent = f.bodies[0] as Record<string, unknown>
    assert.deepEqual([sent.media_id, sent.read_id], [500, 49])
    assert.deepEqual(sent, { ...first, confirm_duplicate_of: 101 })
    assert.ok('saved' in r)
    assert.equal(savedText(r.saved.result), 'Urine bag emptied at 380 mL: 380 mL charted. Waiting for nurse approval.')
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] Duplicate bag reading at the bed: Response lost', async () => {
    const { a, f, o, first, answers } = await refusedAt11()
    answers.push(() => Promise.reject(new TypeError('Failed to fetch')))
    await assert.rejects(saveAnyway(f.api, a.id, o), (err: Error) => err.name === 'ApiError')
    answers.push(() => dup(102, 'emptied', 380, at(11, 3)))
    const again = refusedOf(await saveAnyway(f.api, a.id, o))
    assert.deepEqual(f.calls, ['POST /api/admissions/31/bag-readings', 'POST /api/admissions/31/bag-readings'])
    assert.deepEqual(f.bodies[1], { ...first, confirm_duplicate_of: 101 })
    assert.equal(duplicateText(again.duplicate, ms(11, 4)), 'Same as the reading at 11:03: emptied at 380 mL.')
    // The next "Save anyway" confirms the newly shown reading; nothing is sent until then.
    assert.deepEqual(again.resend, first)
    assert.equal(f.calls.length, 2)
  })

  it('[web/capture] Duplicate bag reading at the bed: Discard', async () => {
    const { f, o } = await refusedAt11()
    assert.equal(discardedText(o.duplicate, ms(11, 2)), 'Not saved. The reading at 11:00 stands.')
    assert.deepEqual(f.calls, [])
  })

  it('[web/capture] Duplicate bag reading at the bed: By hand', async () => {
    const a = admission('3A')
    const answers = [() => dup(88, 'check', 290, at(10, 2)), () => json(saved({ event: 'check', volume_ml: 300 }, 10), 201)]
    const f = fake({ 'POST /api/admissions/31/bag-readings': () => answers.shift()!() })
    const d = { ...byHandDraft('urine_bag', 300, a, null, true), emptied: false }
    const o = refusedOf(await trySaveBag(f.api, a.id, d, { kind: 'photo', blob: photoBlob() }))
    assert.equal(duplicateText(o.duplicate, ms(10, 5)), 'Same as the reading at 10:02: checked at 290 mL.')
    await saveAnyway(f.api, a.id, o)
    assert.deepEqual(f.calls, [
      'POST /api/admissions/31/media',
      'POST /api/admissions/31/bag-readings',
      'POST /api/admissions/31/bag-readings',
    ])
    assert.deepEqual(f.bodies[2], {
      container: 'urine_bag',
      event: 'check',
      volume_ml: 300,
      source: 'photo',
      media_id: 500,
      confirm_duplicate_of: 88,
    })
    assert.deepEqual(f.ai(), [])
  })
})

describe('nearly full at the bed', () => {
  it('[web/capture] Nearly full at the bed: Check at 1650 mL', async () => {
    const a = admission('HDU', { id: 41, bed: '1' })
    const r = bagRead(1650)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    assert.equal(d.emptied, false)
    assert.equal(nearlyFullLine(d), 'Nearly full: 1650 of 2000 mL. Empty it now?')
    const f = fake({ 'POST /api/admissions/41/bag-readings': () => json(saved({ event: 'check', volume_ml: 1650 }, 200), 201) }, ANITA.id)
    const s = await saveBagReading(f.api, a.id, d, { kind: 'photo', blob: photoBlob() })
    assert.equal(afterView(s.result.reading).actions[0], 'Emptied it now? Add after-emptying photo')
    assert.deepEqual(f.calls, ['POST /api/admissions/41/media', 'POST /api/admissions/41/bag-readings'])
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] Nearly full at the bed: Under 80%, or emptied', () => {
    const a = admission('HDU', { id: 41, bed: '1' })
    const r = bagRead(1599)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    assert.equal(nearlyFullLine(d), null)
    assert.equal(nearlyFullLine({ ...d, volume_ml: 1650, emptied: true }), null)
  })

  it('[web/capture] Nearly full at the bed: Stoma bag by hand', () => {
    const d = { ...byHandDraft('stoma_bag', 420, admission('3A'), null), emptied: false }
    assert.equal(nearlyFullLine(d), 'Nearly full: 420 of 500 mL. Empty it now?')
  })
})

describe('missed emptying already recorded', () => {
  const fallChart = () => {
    const before = reading({ volume_ml: 500, created_at: at(9) })
    const fell = reading({
      volume_ml: 150,
      rise_ml: 150,
      fell: true,
      fell_from_ml: 500,
      created_at: at(12),
      entry: { id: 77, volume_ml: 150, status: 'pending' },
    })
    return chart([period([fell]), period([before], { end_at: at(9) })])
  }
  const fallAlert: Alert = {
    kind: 'bag_level_fell',
    message: 'Urine bag level fell from 500 to 150 mL with no emptying recorded. Was it emptied? Review.',
    entry_ids: [77],
    meal_ids: [],
  }
  const a = admission('2C', { id: 26, bed: '6' })
  async function refused(answers: (() => Response)[]) {
    const f = fake(
      {
        'POST /api/admissions/26/bag-readings': () => answers.shift()!(),
        'GET /api/admissions/26/entries': () => json(list(a, fallChart(), [fallAlert])),
        'GET /api/admissions/26/meals': () => json([]),
      },
      ANITA.id,
    )
    const [fall] = fallsOf(fallChart(), [fallAlert], ms(13))
    const sent = missedSubmit(missedForm(fall!, ms(13), a.admitted_at), '10:32', 550)
    assert.ok('input' in sent)
    const o = await postBagReading(f.api, a.id, sent.input)
    assert.ok('duplicate' in o)
    return { f, o }
  }
  const dup214 = () =>
    json({ error: 'duplicate_reading', duplicate_of: { id: 214, event: 'emptied', volume_ml: 550, created_at: at(10, 30) } }, 409)

  it('[web/ward] Missed emptying already recorded: Added by someone else', async () => {
    const { f, o } = await refused([dup214])
    assert.equal(duplicateText(o.duplicate, ms(13)), 'Same as the reading at 10:30: emptied at 550 mL.')
    assert.deepEqual(f.calls, ['POST /api/admissions/26/bag-readings'])
    assert.deepEqual(f.ai(), [])
  })

  it('[web/ward] Missed emptying already recorded: Cancel', async () => {
    const { f } = await refused([dup214])
    f.calls.length = 0
    await bedLoad(f.api, a.id)(signal)
    assert.deepEqual(f.calls, ['GET /api/admissions/26/entries', 'GET /api/admissions/26/meals'])
  })

  it('[web/ward] Missed emptying already recorded: Save anyway', async () => {
    const { f, o } = await refused([dup214, () => json(saved({ event: 'emptied', volume_ml: 550, created_at: at(10, 32) }, 50), 201)])
    f.calls.length = 0
    f.bodies.length = 0
    const r = await saveAnyway(f.api, a.id, o)
    assert.ok('saved' in r)
    await bedLoad(f.api, a.id)(signal)
    assert.deepEqual(f.calls, ['POST /api/admissions/26/bag-readings', 'GET /api/admissions/26/entries', 'GET /api/admissions/26/meals'])
    assert.deepEqual(f.bodies[0], {
      container: 'urine_bag',
      event: 'emptied',
      volume_ml: 550,
      source: 'manual',
      charted_at: at(10, 32),
      confirm_duplicate_of: 214,
    })
    assert.deepEqual(f.ai(), [])
  })
})

describe('readings saved anyway', () => {
  it('[web/ward] Readings saved anyway: Repeat emptying', () => {
    const at11 = reading({ id: 300, event: 'emptied', volume_ml: 380, baseline_ml: 260, rise_ml: 120, created_at: at(11) })
    const again = reading({ id: 301, event: 'emptied', volume_ml: 380, rise_ml: 380, created_at: at(11, 2), confirmed_duplicate_of: 300 })
    const check = reading({ id: 299, volume_ml: 260, created_at: at(10) })
    const ps = [
      period([again], { start_at: at(11), end_at: at(11, 2), opened_by: 'emptied', closed_by: 'emptied' }),
      period([check, at11], { end_at: at(11), closed_by: 'emptied' }),
    ]
    const [bag] = bagSections(chart(ps), ms(12))
    assert.equal(bag!.periods[0]!.rows[0]!.text, '11:02 · Emptied · 380 mL · +380 mL · Saved anyway · same as 11:00')
    assert.equal(bag!.periods[1]!.rows[1]!.text, '11:00 · Emptied · 380 mL · +120 mL')
    assert.equal(bag!.periods[1]!.rows[1]!.anyway, null)
  })
})

describe('capture follows the devices', () => {
  const labels = (d: OutputDevices) => hintsFor(d).map((h) => h.label)

  it("[web/capture] Capture choices follow the bed's devices: Commode bed", async () => {
    const a = admission('3A', { bed: '4' })
    const devices = dev({ urine: 'commode', urine_from: 'voiding' })
    const f = fake({
      'GET /api/beds/.+': () => json(a),
      'GET /api/admissions/31/entries': () => json({ ...list(a, chart([])), devices }),
    })
    const chartRead = await bedScreenLoad(f.api, a.qr_token)(signal)
    assert.deepEqual(labels(chartRead.devices), [
      'Auto-detect',
      'Commode pan',
      'Water jug',
      'Water bottle',
      'Cup',
      'Measuring jug',
      'Urinal',
      'Bedpan',
      'Emesis basin',
    ])
    assert.deepEqual(f.calls, [`GET /api/beds/${a.qr_token}`, 'GET /api/admissions/31/entries'])
  })

  it("[web/capture] Capture choices follow the bed's devices: Catheter and drain", () => {
    assert.deepEqual(labels(dev({ urine: 'catheter', urine_from: 'catheter', bags: ['urine_bag', 'drain_bag'] })), [
      'Auto-detect',
      'Urine bag',
      'Drain bag',
      'Water jug',
      'Water bottle',
      'Cup',
      'Measuring jug',
      'Urinal',
      'Bedpan',
      'Commode pan',
      'Emesis basin',
    ])
  })

  it("[web/capture] Capture choices follow the bed's devices: Default urinal", () => {
    assert.deepEqual(labels(dev()), [
      'Auto-detect',
      'Urinal',
      'Water jug',
      'Water bottle',
      'Cup',
      'Measuring jug',
      'Bedpan',
      'Commode pan',
      'Emesis basin',
    ])
  })

  it('Take-photo tile names the first output container of the hint list', () => {
    assert.equal(photoTileHint(dev()), 'Urinal, jug, bottle or cup')
    assert.equal(photoTileHint(dev({ urine: 'commode', urine_from: 'voiding' })), 'Commode pan, jug, bottle or cup')
    assert.equal(photoTileHint(dev({ urine: 'catheter', urine_from: 'catheter', bags: ['urine_bag'] })), 'Urine bag, jug, bottle or cup')
    assert.equal(photoTileHint(dev({ bags: ['stoma_bag'] })), 'Urinal, jug, bottle or cup')
  })

  it("[web/capture] Capture choices follow the bed's devices: Urine by hand", async () => {
    const f = fake({ 'POST /api/admissions/31/entries': () => json(entry({ id: 6 }), 201) })
    const commode = byHandCategory(manualWater(), 'urine', EMPTY_CARE, dev({ urine: 'commode', urine_from: 'voiding' })).pending
    await saveByHand(f.api, 31, { ...commode, draft: { ...commode.draft, volume_ml: 220 } }, null)
    const urinal = byHandCategory(manualWater(), 'urine', EMPTY_CARE, dev()).pending
    await saveByHand(f.api, 31, { ...urinal, draft: { ...urinal.draft, volume_ml: 180 } }, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/31/entries', 'POST /api/admissions/31/entries'])
    const pick = (b: unknown) => {
      const { direction, category, volume_ml, item, source } = b as Record<string, unknown>
      return { direction, category, volume_ml, item, source }
    }
    assert.deepEqual(pick(f.bodies[0]), { direction: 'out', category: 'urine', volume_ml: 220, item: 'commode pan', source: 'manual' })
    assert.deepEqual(pick(f.bodies[1]), { direction: 'out', category: 'urine', volume_ml: 180, item: 'urinal', source: 'manual' })
  })

  it("[web/capture] Capture choices follow the bed's devices: Toilet", async () => {
    const devices = dev({ urine: 'toilet', urine_from: 'voiding', urine_measured: false })
    assert.deepEqual(labels(devices), [
      'Auto-detect',
      'Water jug',
      'Water bottle',
      'Cup',
      'Measuring jug',
      'Urinal',
      'Bedpan',
      'Commode pan',
      'Emesis basin',
    ])
    assert.equal(unmeasuredLine(devices), 'Urine is not measured on this bed (toilet).')
    assert.equal(unmeasuredLine(dev()), null)
    const f = fake({ 'POST /api/admissions/31/entries': () => json(entry({ id: 6 }), 201) })
    const p = byHandCategory(manualWater(), 'urine', EMPTY_CARE, devices).pending
    await saveByHand(f.api, 31, { ...p, draft: { ...p.draft, volume_ml: 300 } }, null)
    assert.equal((f.bodies[0] as { item: unknown }).item, null)
  })

  it('[web/capture] Bag level by hand: No bag on record', async () => {
    const devices = dev()
    for (const c of ['urine', 'stoma', 'drain'] as const) {
      assert.equal(bagOfCategory(c, devices), null, c)
      assert.equal(byHandCategory(manualWater(), c, EMPTY_CARE, devices).bagOn, false, c)
    }
    const f = fake({ 'POST /api/admissions/31/entries': () => json(entry({ id: 6 }), 201) })
    const p = byHandCategory(manualWater(), 'urine', EMPTY_CARE, devices).pending
    await saveByHand(f.api, 31, { ...p, draft: { ...p.draft, volume_ml: 300 } }, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/31/entries'])
  })

  it('[web/capture] Bag level by hand: Stoma only', () => {
    const devices = dev({ bags: ['stoma_bag'] })
    const stoma = byHandCategory(manualWater(), 'stoma', EMPTY_CARE, devices)
    assert.equal(stoma.bagOn, true)
    const bag = bagOfCategory('stoma', devices)
    assert.equal(bag && `${BAG_NAME[bag]} level`, 'Stoma bag level')
    assert.equal(byHandCategory(stoma.pending, 'urine', EMPTY_CARE, devices).bagOn, false)
  })
})

describe('bag photo on a bed without that bag', () => {
  const NO_CATHETER = 'No catheter on the care plan for this bed. Saving charts it and asks the nurse to review.'

  it('[web/capture] Bag photo on a bed without that bag: Attendant', async () => {
    const a = admission('3A', { bed: '5' })
    const f = fake({
      'GET /api/beds/.+': () => json(a),
      'GET /api/admissions/31/entries': () => json(list(a, chart([]))),
      'POST /api/ai/read': () => json(bagRead(300)),
      'POST /api/admissions/31/bag-readings': () => json(saved({ volume_ml: 300 }, 300), 201),
    })
    const chartRead = await bedScreenLoad(f.api, a.qr_token)(signal)
    const r = await f.api.read(photoBlob(), { admissionId: a.id }, signal)
    const d = draftFromRead(r, toEvidence(r, null), a)!
    assert.equal(bagMismatch(d.container, chartRead.devices)?.check, NO_CATHETER)
    assert.deepEqual(f.calls, [`GET /api/beds/${a.qr_token}`, 'GET /api/admissions/31/entries', 'POST /api/ai/read'])
    await saveBagReading(f.api, a.id, d, { kind: 'photo', blob: photoBlob() })
    assert.deepEqual(f.calls.slice(3), ['POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    assert.equal((f.bodies[3] as { kind: string }).kind, 'photo')
    assert.equal((f.bodies[4] as { container: string }).container, 'urine_bag')
    assert.equal(f.ai().length, 1)
    // The saved screen offers "Add catheter" to a nurse or matron only.
    assert.equal(bagMismatch(d.container, chartRead.devices)?.add, 'Add catheter')
    assert.equal(mayOrder('catheter', RAVI), false)
  })

  it('[web/capture] Bag photo on a bed without that bag: Nurse adds the catheter', async () => {
    const a = admission('3A', { bed: '5' })
    const f = fake(
      {
        'PUT /api/admissions/31/care/catheter': () => json({}, 201),
        'GET /api/admissions/31/entries': () => json(list(a, chart([]))),
      },
      ANITA.id,
    )
    const miss = bagMismatch('urine_bag', dev())!
    assert.equal(miss.kind, 'catheter')
    assert.equal(mayOrder(miss.kind, ANITA), true)
    const now = new Date(ms(11))
    const value = careInput('catheter', formDefaults('catheter', EMPTY_CARE, now), EMPTY_CARE, now)!
    const r = await applyCare(f.api, a.id, { op: 'set', kind: 'catheter', value }, () => f.api.entries(a.id))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/31/care/catheter', 'GET /api/admissions/31/entries'])
    assert.equal((f.bodies[0] as { type: string }).type, 'urethral')
    assert.equal(f.staff[0], String(ANITA.id))
    assert.deepEqual(f.ai(), [])
  })

  it('[web/capture] Bag photo on a bed without that bag: Bag on record', () => {
    assert.equal(bagMismatch('urine_bag', dev({ urine: 'catheter', urine_from: 'catheter', bags: ['urine_bag'] })), null)
  })

  it('[web/capture] Bag photo on a bed without that bag: Drain on a stoma bed', () => {
    assert.equal(
      bagMismatch('drain_bag', dev({ bags: ['stoma_bag'] }))?.check,
      'No drain on the care plan for this bed. Saving charts it and asks the nurse to review.',
    )
    assert.equal(bagMismatch('stoma_bag', dev({ bags: ['stoma_bag'] })), null)
  })
})

describe('bag without a device on the bed review', () => {
  const prompt = (message: string): Alert => ({ kind: 'bag_without_device', message })

  it('[web/ward] Bag without a device on the bed review: Drain', () => {
    const stoma = prompt('Stoma bag reading at 09:00, but no stoma is on the care plan. Review.')
    const drain = prompt('Drain bag reading at 10:00, but no drain is on the care plan. Review.')
    assert.deepEqual(
      [promptDevice(stoma), promptDevice(drain)],
      [
        { kind: 'stoma', add: 'Add stoma' },
        { kind: 'drain', add: 'Add drain' },
      ],
    )
    assert.equal(promptDevice({ kind: 'logging_gap', message: 'No intake logged in the last 8 h. Check jug and meals.' }), null)
  })

  it('[web/ward] Bag without a device on the bed review: Attendant', () => {
    const p = promptDevice(prompt('Urine bag reading at 10:30, but no catheter is on the care plan. Review.'))!
    assert.equal(p.add, 'Add catheter')
    assert.equal(mayOrder(p.kind, RAVI), false)
  })
})
