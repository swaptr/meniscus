import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  Alert,
  BagReading,
  BagReadingInput,
  BagReadingResult,
  Entry,
  EntryEvent,
  EntryList,
  Explanation,
  HospitalSummary,
  Level,
  MediaRef,
  StaffRef,
} from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { jpeg, msg, resp, testApp, testStore, upstream } from './testing.ts'

const MIN = 60_000
const HOUR = 60 * MIN
/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const RAVI: StaffRef = { id: 1, name: 'Ravi Kumar', role: 'attendant' }
const ANITA: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }

type Body<T> = T & { error?: string; issues?: { path: string; message: string }[] }

/** The store opens on 30 Oct (every demo patient admitted then); the clock then moves with `at`. */
async function setup(
  openedAt = new Date(2026, 9, 30, 10).getTime(),
  open: (now: () => number) => Promise<Store> = (now) => testStore(now),
  u = upstream(),
) {
  const clock = { t: openedAt }
  const store = await open(() => clock.t)
  const { request } = await testApp({ ai: u.ai, store })
  const call = async <T>(method: string, path: string, init: { body?: unknown; staff?: number } = {}) => {
    const res = await request(
      path,
      {
        method,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
      },
      init.staff !== undefined ? { staff: init.staff } : {},
    )
    return { status: res.status, body: (await res.json()) as Body<T> }
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const at = (ms: number) => {
    clock.t = ms
  }
  const post = (id: number, body: Partial<BagReadingInput> | Record<string, unknown>, staff = RAVI.id) =>
    call<BagReadingResult>('POST', `/api/admissions/${id}/bag-readings`, { body, staff })
  /** A urine bag reading (by default) posted at `ms`, charted now unless `charted_at` is given. */
  const reading = async (
    id: number,
    ms: number,
    event: BagReadingInput['event'],
    volume_ml: number,
    extra: Partial<BagReadingInput> = {},
    staff = RAVI.id,
  ) => {
    at(ms)
    const r = await post(id, { container: 'urine_bag', event, volume_ml, source: 'manual', ...extra }, staff)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body
  }
  const upload = async (id: number, staff = RAVI.id) => {
    const form = new FormData()
    form.set('file', new File([jpeg], 'bag.jpg', { type: 'image/jpeg' }))
    form.set('kind', 'photo')
    const res = await request(`/api/admissions/${id}/media`, { method: 'POST', body: form }, { staff })
    assert.equal(res.status, 201)
    return (await res.json()) as MediaRef
  }
  const list = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`)).body
  const after = (readingId: number, body: unknown, staff = RAVI.id) =>
    call<BagReading>('POST', `/api/bag-readings/${readingId}/after-emptying`, { body, staff })
  const events = async (entryId: number) => (await call<EntryEvent[]>('GET', `/api/entries/${entryId}/events`)).body
  const entry = async (id: number, entryId: number) => (await list(id)).entries.find((e) => e.id === entryId)!
  /** The bed's prompts on the chart read, at `ms`. */
  const alerts = async (id: number, ms?: number) => {
    if (ms !== undefined) at(ms)
    return (await list(id)).alerts
  }
  /** Every bag reading of the bed now, oldest first, as the chart read returns them. */
  const readings = async (id: number) =>
    (await list(id)).bags.periods
      .flatMap((p) => p.readings)
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id)
  /** Sets a care order as Anita Thomas at `ms` (a bag's order, so its readings raise no `bag_without_device`). */
  const order = async (id: number, ms: number, kind: string, body: Record<string, unknown>) => {
    at(ms)
    const r = await call('PUT', `/api/admissions/${id}/care/${kind}`, { body, staff: ANITA.id })
    assert.equal(r.status, 201, JSON.stringify(r.body))
  }
  /** GET /api/media/:id's status. */
  const served = async (mediaId: number) => (await request(`/api/media/${mediaId}`)).status
  return { clock, store, u, call, bed, at, post, reading, upload, list, after, events, entry, served, alerts, readings, order }
}
type T = Awaited<ReturnType<typeof setup>>

/** Rows the store holds for the bed: its bag readings (any level row with an event) and its entries. */
const stored = async (t: T, id: number) => ({
  readings: (await t.store.bagReadings(id, 0)).length,
  entries: (await t.store.entries(id))!.entries.length,
})

describe('bag readings in the store', () => {
  it('a saved reading keeps its row, and its entry links it and its predecessor', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const first = await t.reading(id, nov(3, 8), 'emptied', 600)
    const photo = await t.upload(id)
    t.at(nov(3, 10))
    const second = (await t.post(id, { container: 'urine_bag', event: 'check', volume_ml: 150, source: 'photo', media_id: photo.id })).body
    const rows = await t.store.bagReadings(id, 0)
    assert.deepEqual(
      rows.map((r) => [r.id, r.event, r.volume_ml, r.residual_ml, r.source, r.created_by?.id, r.created_at, r.recorded_at]),
      [
        [first.reading.id, 'emptied', 600, null, 'manual', 1, iso(nov(3, 8)), iso(nov(3, 8))],
        [second.reading.id, 'check', 150, null, 'photo', 1, iso(nov(3, 10)), iso(nov(3, 10))],
      ],
    )
    const e = second.entry!
    assert.deepEqual([e.levels?.before?.id, e.levels?.after.id, e.media?.id], [first.reading.id, second.reading.id, photo.id])
    assert.equal(first.entry!.levels?.before, null)
  })

  it('bagReadings returns the window, plus the newest reading before it of each bag', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(1, 8), 'check', 100)
    await t.reading(id, nov(1, 9), 'check', 200)
    await t.reading(id, nov(1, 10), 'check', 50, { container: 'stoma_bag' })
    await t.reading(id, nov(3, 9), 'check', 300)
    const got = await t.store.bagReadings(id, nov(2, 9))
    assert.deepEqual(
      got.map((r) => [r.container, r.created_at]),
      [
        ['urine_bag', iso(nov(1, 9))],
        ['stoma_bag', iso(nov(1, 10))],
        ['urine_bag', iso(nov(3, 9))],
      ].sort((a, b) => Date.parse(a[1]!) - Date.parse(b[1]!)),
    )
    const byWard = await t.store.bagReadingsByWard((await t.store.admission(id))!.ward_id, nov(2, 9))
    assert.deepEqual(
      byWard.get(id)?.map((r) => r.id),
      got.map((r) => r.id),
    )
    // Jug levels are not bag readings, and bag readings are not levels.
    await t.call('POST', `/api/admissions/${id}/levels`, { body: { container: 'water_jug', volume_ml: 1000, source: 'manual' } })
    assert.equal((await t.store.bagReadings(id, 0)).length, 4)
    assert.deepEqual(
      (await t.call<Level[]>('GET', `/api/admissions/${id}/levels`)).body.map((l) => l.container),
      ['water_jug'],
    )
  })
})

describe('record a bag reading', () => {
  it('[charting/bag-periods] Record a bag reading: Normal emptying', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 8))
    const photo = await t.upload(id)
    const r = await t.post(id, { container: 'urine_bag', event: 'emptied', volume_ml: 600, source: 'photo', media_id: photo.id })
    assert.equal(r.status, 201)
    const { reading, entry } = r.body
    assert.deepEqual(
      [reading.event, reading.volume_ml, reading.baseline_ml, reading.rise_ml, reading.media, reading.created_by],
      ['emptied', 600, 0, 600, photo, RAVI],
    )
    assert.ok(entry)
    assert.deepEqual(
      [entry.direction, entry.category, entry.volume_ml, entry.status, entry.created_by, entry.media],
      ['out', 'urine', 600, 'pending', RAVI, photo],
    )
    assert.deepEqual(reading.entry, { id: entry.id, volume_ml: 600, status: 'pending' })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Record a bag reading: Photo with the level typed', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 8))
    const photo = await t.upload(id)
    const r = await t.post(id, { container: 'urine_bag', event: 'emptied', volume_ml: 400, source: 'photo', media_id: photo.id })
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.reading.source, r.body.reading.media, r.body.reading.evidence], ['photo', photo, null])
    assert.deepEqual(r.body.entry?.media, photo)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Record a bag reading: Not a bag reading', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 8))
    const photo = await t.upload(id)
    const bag = { container: 'urine_bag', event: 'check', volume_ml: 300, source: 'manual' }
    const bodies = [
      { container: 'urinal', event: 'check', volume_ml: 300, source: 'manual' },
      { container: 'water_jug', event: 'check', volume_ml: 600, source: 'manual' },
      { container: 'urine_bag', volume_ml: 300, source: 'manual' },
      { ...bag, event: 'refilled' },
      { ...bag, volume_ml: 5001 },
      { ...bag, container: 'stoma_bag', urine_colour: 'yellow' },
      { ...bag, media_id: photo.id },
    ]
    for (const body of bodies) {
      const r = await t.post(id, body)
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(body))
    }
    assert.deepEqual(await stored(t, id), { readings: 0, entries: 0 })
    assert.deepEqual((await t.call<Level[]>('GET', `/api/admissions/${id}/levels`)).body, [])
  })

  it('[charting/bag-periods] Record a bag reading: Unknown admission', async () => {
    const t = await setup()
    t.at(nov(3, 8))
    const r = await t.post(999, { container: 'urine_bag', event: 'check', volume_ml: 300, source: 'manual' })
    assert.deepEqual([r.status, r.body.error], [404, 'not_found'])
  })
})

describe('the rise since the baseline', () => {
  it('[charting/bag-periods] Output is the rise since the baseline: Hourly checks, then emptied', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    const saved = [
      await t.reading(id, nov(3, 9), 'check', 150),
      await t.reading(id, nov(3, 10), 'check', 260),
      await t.reading(id, nov(3, 11), 'emptied', 380),
    ]
    const charted = saved.map((r) => [r.entry?.direction, r.entry?.category, r.entry?.status, r.entry?.volume_ml])
    assert.deepEqual(charted, [
      ['out', 'urine', 'pending', 150],
      ['out', 'urine', 'pending', 110],
      ['out', 'urine', 'pending', 120],
    ])
    // The entries add up to the level the bag held when emptied.
    assert.equal(
      saved.reduce((sum, r) => sum + (r.entry?.volume_ml ?? 0), 0),
      saved.at(-1)!.reading.volume_ml,
    )
    assert.equal(saved.at(-1)!.reading.volume_ml, 380)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Output is the rise since the baseline: Emptied before it was full', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    const r = await t.reading(id, nov(3, 10, 30), 'emptied', 220)
    assert.deepEqual([r.entry?.category, r.entry?.volume_ml], ['urine', 220])
  })

  it('[charting/bag-periods] Output is the rise since the baseline: Level unchanged', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 10, 2), 'check', 300)
    const r = await t.reading(id, nov(3, 10, 13), 'check', 300)
    assert.deepEqual([r.reading.rise_ml, r.entry], [0, null])
  })

  it('[charting/bag-periods] Output is the rise since the baseline: Two days apart', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(1, 8), 'check', 400)
    const r = await t.reading(id, nov(3, 9), 'check', 700)
    assert.deepEqual([r.reading.baseline_ml, r.entry?.volume_ml], [400, 300])
  })

  it('[charting/bag-periods] Output is the rise since the baseline: Bags kept apart', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'check', 120, { container: 'stoma_bag' })
    const urine = await t.reading(id, nov(3, 8, 30), 'check', 380)
    const r = await t.reading(id, nov(3, 9), 'check', 200, { container: 'stoma_bag' })
    assert.deepEqual([r.entry?.category, r.entry?.volume_ml], ['stoma', 80])
    const urineNow = (await t.store.bagReadings(id, 0)).find((x) => x.id === urine.reading.id)!
    assert.deepEqual([urineNow.volume_ml, urineNow.entry], [380, urine.reading.entry])
    assert.equal((await t.entry(id, urine.entry!.id)).volume_ml, 380)
  })

  it('[charting/bag-periods] Emptying and bag change start a new period: Bag changed', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 6), 'emptied', 500)
    const got = [
      await t.reading(id, nov(3, 8), 'check', 300),
      await t.reading(id, nov(3, 12), 'bag_changed', 900),
      await t.reading(id, nov(3, 13), 'check', 100),
    ].map((r) => [r.entry?.created_at, r.entry?.volume_ml])
    assert.deepEqual(got, [
      [iso(nov(3, 8)), 300],
      [iso(nov(3, 12)), 600],
      [iso(nov(3, 13)), 100],
    ])
  })
})

describe('bag periods on the chart read', () => {
  it('[charting/bag-periods] Bag periods on the chart read: One period closed', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 10), 'check', 150)
    await t.reading(id, nov(3, 11), 'check', 260)
    await t.reading(id, nov(3, 12), 'emptied', 380)
    t.at(nov(3, 12, 30))
    const [newest, next, ...rest] = (await t.list(id)).bags.periods
    assert.deepEqual(rest, [])
    assert.deepEqual(
      [newest!.container, newest!.start_at, newest!.end_at, newest!.closed_by, newest!.total_ml, newest!.rate_ml_h],
      ['urine_bag', iso(nov(3, 8)), iso(nov(3, 12)), 'emptied', 380, 95],
    )
    assert.deepEqual(
      newest!.readings.map((r) => [r.created_at, r.rise_ml]),
      [
        [iso(nov(3, 10)), 150],
        [iso(nov(3, 11)), 110],
        [iso(nov(3, 12)), 120],
      ],
    )
    assert.deepEqual(
      [next!.start_at, next!.end_at, next!.readings.length, next!.total_ml, next!.rate_ml_h],
      [null, iso(nov(3, 8)), 1, 600, null],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Bag periods on the chart read: Emptied early', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 10, 30), 'emptied', 220)
    const [p] = (await t.list(id)).bags.periods
    assert.deepEqual([p!.start_at, p!.end_at, p!.total_ml, p!.rate_ml_h], [iso(nov(3, 8)), iso(nov(3, 10, 30)), 220, 88])
  })

  it('[charting/bag-periods] Bag periods on the chart read: Open period', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 12), 'emptied', 380)
    await t.reading(id, nov(3, 13), 'check', 150)
    const [p] = (await t.list(id)).bags.periods
    assert.deepEqual([p!.start_at, p!.end_at, p!.closed_by, p!.total_ml], [iso(nov(3, 12)), null, null, 150])
  })

  it('[charting/bag-periods] Bag periods on the chart read: No length', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 8, 5), 'bag_changed', 0, { charted_at: iso(nov(3, 8)) })
    const [p] = (await t.list(id)).bags.periods
    assert.deepEqual(
      [p!.start_at, p!.end_at, p!.closed_by, p!.total_ml, p!.rate_ml_h],
      [iso(nov(3, 8)), iso(nov(3, 8)), 'bag_changed', 0, null],
    )
  })

  it('[charting/bag-periods] Bag periods on the chart read: Too short to rate', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 8, 10), 'emptied', 450)
    await t.reading(id, nov(3, 8, 25), 'emptied', 100)
    const [later, early] = (await t.list(id)).bags.periods
    assert.deepEqual([early!.total_ml, early!.rate_ml_h], [450, null], '10 minutes: no rate')
    assert.deepEqual([later!.total_ml, later!.rate_ml_h], [100, 400], '15 minutes: rated')
  })

  it('[charting/bag-periods] Bag periods on the chart read: No bag', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    t.at(nov(3, 9))
    const e = await t.call<Entry>('POST', `/api/admissions/${id}/entries`, {
      body: { direction: 'out', category: 'urine', volume_ml: 300, source: 'manual', item: 'urinal' },
      staff: RAVI.id,
    })
    assert.equal(e.status, 201)
    assert.deepEqual((await t.list(id)).bags.periods, [])
  })

  it('[charting/bag-periods] Bag periods on the chart read: Not on the ward list', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 8), 'emptied', 600)
    await t.reading(id, nov(3, 9), 'check', 150)
    const ward = (await t.store.admission(id))!.ward_id
    const items = (await t.call<AdmissionSummary[]>('GET', `/api/admissions?ward=${ward}`)).body
    assert.ok(items.some((a) => a.id === id))
    for (const a of items) assert.ok(!('bags' in a), `bed ${a.bed} has bags`)
    for (const a of (await t.call<AdmissionSummary[]>('GET', '/api/admissions')).body) assert.ok(!('bags' in a))
  })

  it('[charting/bag-periods] Reading interval: Ward defaults', async () => {
    const t = await setup()
    t.at(nov(3, 9))
    const hdu = (await t.list(await t.bed('HDU', '1'))).bags
    const general = (await t.list(await t.bed('3A', '3'))).bags
    assert.deepEqual([hdu.interval_h, hdu.interval_from], [1, 'default'])
    assert.deepEqual([general.interval_h, general.interval_from], [4, 'default'])
    assert.deepEqual(t.u.requests, [])
  })
})

describe('proof kept with each reading', () => {
  it('[charting/bag-periods] Bag readings keep their proof: Rise rejected', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 12))
    const photo = await t.upload(id)
    const r = await t.post(id, { container: 'urine_bag', event: 'check', volume_ml: 150, source: 'photo', media_id: photo.id })
    assert.equal(r.body.entry?.volume_ml, 150)
    t.at(nov(3, 12, 30))
    const rejected = await t.call<Entry>('POST', `/api/entries/${r.body.entry.id}/review`, {
      body: { action: 'reject', reason: 'wrong_volume' },
      staff: ANITA.id,
    })
    assert.equal(rejected.status, 200)
    assert.equal(await t.served(photo.id), 200)
    // Still served once unlinked uploads would have expired.
    t.at(nov(4, 13))
    assert.equal(await t.served(photo.id), 200)
    t.at(nov(3, 13))
    const listed = (await t.list(id)).bags.periods.flatMap((p) => p.readings).find((x) => x.id === r.body.reading.id)!
    assert.deepEqual(listed.media, photo)
    assert.deepEqual(listed.entry, { id: r.body.entry.id, volume_ml: 150, status: 'rejected' })
  })

  it('[charting/bag-periods] Bag readings keep their proof: Saved late', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const r = await t.reading(id, nov(3, 10), 'check', 200, { charted_at: iso(nov(3, 8)) })
    assert.deepEqual(
      [r.reading.created_at, r.reading.recorded_at, r.reading.late, r.reading.created_by],
      [iso(nov(3, 8)), iso(nov(3, 10)), true, RAVI],
    )
    const listed = (await t.list(id)).bags.periods[0]!.readings[0]!
    assert.deepEqual([listed.created_at, listed.recorded_at, listed.late, listed.created_by], [iso(nov(3, 8)), iso(nov(3, 10)), true, RAVI])
  })
})

const kinds = (alerts: Alert[]) => alerts.map((a) => a.kind)
const fellAlerts = (alerts: Alert[]) => alerts.filter((a) => a.kind === 'bag_level_fell')
const READING_PROMPTS: Alert['kind'][] = ['bag_reading_due', 'bag_reading_overdue']
const readingPrompt = (alerts: Alert[]) => alerts.filter((a) => READING_PROMPTS.includes(a.kind))

describe('after emptying', () => {
  it('[charting/bag-periods] After-emptying record: Proof photo', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    t.at(nov(3, 8, 2))
    const proof = await t.upload(id)
    const r = await t.after(emptied.reading.id, { media_id: proof.id })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.id, r.body.proof_media?.kind, r.body.proof_media], [emptied.reading.id, 'photo', proof])
    assert.equal(await t.served(proof.id), 200)
    t.at(nov(3, 8, 2) + 25 * HOUR)
    assert.equal(await t.served(proof.id), 200)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] After-emptying record: Residual', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    const r = await t.after(emptied.reading.id, { residual_ml: 30 })
    assert.deepEqual([r.status, r.body.residual_ml], [200, 30])
    const check = await t.reading(id, nov(3, 10), 'check', 200)
    assert.equal(check.entry?.volume_ml, 170)
  })

  it('[charting/bag-periods] After-emptying record: Closed', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.equal((await t.after(emptied.reading.id, { residual_ml: 30 })).status, 200)
    const again = await t.after(emptied.reading.id, { residual_ml: 10 })
    assert.deepEqual([again.status, again.body.error], [409, 'after_emptying_closed'])
    const other = await t.bed('3A', '4')
    const early = await t.reading(other, nov(3, 8), 'emptied', 400)
    await t.reading(other, nov(3, 9), 'check', 100)
    const late = await t.after(early.reading.id, { residual_ml: 20 })
    assert.deepEqual([late.status, late.body.error], [409, 'after_emptying_closed'])
    const rows = (await t.store.bagReadings(id, 0)).concat(await t.store.bagReadings(other, 0))
    assert.deepEqual(
      rows.map((x) => [x.residual_ml, x.proof_media]),
      [
        [30, null],
        [null, null],
        [null, null],
      ],
    )
  })

  it('[charting/bag-periods] After-emptying record: Invalid', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const check = await t.reading(id, nov(3, 7), 'check', 300, { container: 'stoma_bag' })
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    const changed = await t.reading(id, nov(3, 8), 'bag_changed', 50, { container: 'drain_bag' })
    const elsewhere = await t.upload(await t.bed('3A', '4'))
    const cases: [number, unknown][] = [
      [check.reading.id, { residual_ml: 20 }],
      [emptied.reading.id, { residual_ml: 700 }],
      [changed.reading.id, { residual_ml: 20 }],
      [emptied.reading.id, {}],
      [emptied.reading.id, { media_id: elsewhere.id }],
    ]
    for (const [readingId, body] of cases) {
      const r = await t.after(readingId, body)
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(body))
    }
    assert.deepEqual(
      (await t.store.bagReadings(id, 0)).map((x) => [x.residual_ml, x.proof_media]),
      [
        [null, null],
        [null, null],
        [null, null],
      ],
    )
  })

  it('[charting/bag-periods] After-emptying record: Not a bag reading', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 8))
    const jug = await t.call<{ level: Level }>('POST', `/api/admissions/${id}/levels`, {
      body: { container: 'water_jug', volume_ml: 1000, source: 'manual' },
    })
    for (const readingId of [9999, jug.body.level.id]) {
      const r = await t.after(readingId, { residual_ml: 30 })
      assert.deepEqual([r.status, r.body.error], [404, 'not_found'])
    }
    assert.deepEqual(
      (await t.call<Level[]>('GET', `/api/admissions/${id}/levels`)).body.map((l) => l.volume_ml),
      [1000],
    )
  })

  it('[charting/bag-periods] Emptying and bag change start a new period: Residual left in the bag', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.equal((await t.after(emptied.reading.id, { residual_ml: 30 })).status, 200)
    const r = await t.reading(id, nov(3, 10), 'check', 200)
    assert.deepEqual([r.reading.baseline_ml, r.entry?.volume_ml], [30, 170])
  })
})

describe('falls', () => {
  it('[charting/bag-periods] Level fell with no emptying recorded: Emptied but not recorded', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    await t.reading(id, nov(3, 9), 'check', 500)
    const r = await t.reading(id, nov(3, 12), 'check', 150)
    assert.deepEqual(
      [r.reading.fell, r.reading.fell_from_ml, r.entry?.category, r.entry?.volume_ml, r.entry?.status],
      [true, 500, 'urine', 150, 'pending'],
    )
    assert.deepEqual(fellAlerts(await t.alerts(id)), [
      {
        kind: 'bag_level_fell',
        message: 'Urine bag level fell from 500 to 150 mL with no emptying recorded. Was it emptied? Review.',
        entry_ids: [r.entry!.id],
        meal_ids: [],
      },
    ])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Level fell with no emptying recorded: Fell to empty', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    await t.reading(id, nov(3, 9), 'check', 500)
    const r = await t.reading(id, nov(3, 12), 'check', 0)
    assert.equal(r.entry, null)
    const [fell, ...more] = fellAlerts(await t.alerts(id))
    assert.deepEqual(more, [])
    assert.deepEqual(fell && 'entry_ids' in fell ? fell.entry_ids : undefined, [])
  })

  it('[charting/bag-periods] Level fell with no emptying recorded: Below the residual', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.equal((await t.after(emptied.reading.id, { residual_ml: 30 })).status, 200)
    const r = await t.reading(id, nov(3, 9), 'check', 20)
    assert.deepEqual([r.reading.fell_from_ml, r.entry?.volume_ml], [30, 20])
    assert.deepEqual(
      fellAlerts(await t.alerts(id)).map((a) => a.message),
      ['Urine bag level fell from 30 to 20 mL with no emptying recorded. Was it emptied? Review.'],
    )
  })

  it('[charting/bag-periods] Level fell with no emptying recorded: Two days apart', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    await t.reading(id, nov(1, 8), 'check', 500)
    const r = await t.reading(id, nov(3, 9), 'check', 150)
    assert.deepEqual([r.reading.fell, r.reading.fell_from_ml, r.entry?.volume_ml], [true, 500, 150])
    assert.equal(fellAlerts(await t.alerts(id)).length, 1)
  })

  it('[charting/bag-periods] Level fell with no emptying recorded: A day later', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    await t.reading(id, nov(3, 9), 'check', 500)
    await t.reading(id, nov(3, 12), 'check', 150)
    assert.equal(fellAlerts(await t.alerts(id, nov(4, 11, 59))).length, 1)
    assert.deepEqual(fellAlerts(await t.alerts(id, nov(4, 12, 1))), [])
  })

  it('[charting/bag-periods] Bag prompts join the alerts: Only a fall', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('The urine bag level fell with no emptying recorded. Review.')])
      },
    })
    // Admitted at 09:00, so no other prompt is due by 11:05.
    const t = await setup(nov(3, 9), undefined, u)
    const id = await t.bed('2C', '6')
    // Its catheter, so the readings are of a bag on record (charting/bag-periods "Bag reading without the device").
    await t.order(id, nov(3, 9), 'catheter', { type: 'urethral', inserted_at: iso(nov(3, 9)) })
    await t.reading(id, nov(3, 9), 'check', 500)
    await t.reading(id, nov(3, 11), 'check', 150)
    assert.deepEqual(kinds(await t.alerts(id, nov(3, 11, 5))), ['bag_level_fell'])
    const ward = (await t.call<HospitalSummary>('GET', '/api/wards')).body.wards.find((w) => w.code === '2C')!
    assert.equal(ward.beds_with_alerts, 1)
    assert.deepEqual(u.requests, [])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id }, staff: ANITA.id })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.match(sent[0]!, /bag_level_fell/)
    assert.ok(!sent[0]!.includes('Fatima Khan'), 'patient name sent upstream')
  })
})

describe('missed emptyings', () => {
  /** 2C bed 6's urine bag fell from 500 mL at 09:00 to 150 mL at 12:00. */
  async function fall(t: T) {
    const id = await t.bed('2C', '6')
    await t.reading(id, nov(3, 9), 'check', 500)
    const fell = await t.reading(id, nov(3, 12), 'check', 150)
    return { id, fell }
  }
  const missed = (t: T, id: number, volume_ml: number, charted: number, staff = ANITA.id, event: BagReadingInput['event'] = 'emptied') => {
    t.at(nov(3, 13))
    return t.post(id, { container: 'urine_bag', event, volume_ml, source: 'manual', charted_at: iso(charted) }, staff)
  }

  it('[charting/bag-periods] Add a missed emptying: Emptied at 10:30', async () => {
    const t = await setup()
    const { id, fell } = await fall(t)
    const before = await t.events(fell.entry!.id)
    const r = await missed(t, id, 550, nov(3, 10, 30))
    assert.equal(r.status, 201)
    const e = r.body.entry!
    assert.deepEqual([e.category, e.volume_ml, e.status, e.created_at, e.late], ['urine', 50, 'pending', iso(nov(3, 10, 30)), true])
    assert.deepEqual(fellAlerts(await t.alerts(id)), [])
    const old = await t.entry(id, fell.entry!.id)
    assert.deepEqual([old.volume_ml, old.status], [150, 'pending'])
    assert.deepEqual(await t.events(fell.entry!.id), before)
    const at12 = (await t.readings(id)).find((x) => x.id === fell.reading.id)!
    assert.deepEqual([at12.baseline_ml, at12.fell, at12.fell_from_ml], [0, false, null])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Add a missed emptying: Level not known', async () => {
    const t = await setup()
    const { id } = await fall(t)
    const r = await missed(t, id, 500, nov(3, 10, 30))
    assert.deepEqual([r.status, r.body.entry], [201, null])
    assert.deepEqual(fellAlerts(await t.alerts(id)), [])
  })

  it('[charting/bag-periods] Add a missed emptying: From the residual', async () => {
    const t = await setup()
    const id = await t.bed('2C', '6')
    const emptied = await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.equal((await t.after(emptied.reading.id, { residual_ml: 30 })).status, 200)
    await t.reading(id, nov(3, 9), 'check', 20)
    assert.equal(fellAlerts(await t.alerts(id)).length, 1)
    t.at(nov(3, 9, 30))
    const r = await t.post(
      id,
      { container: 'urine_bag', event: 'emptied', volume_ml: 40, source: 'manual', charted_at: iso(nov(3, 8, 30)) },
      ANITA.id,
    )
    assert.deepEqual([r.status, r.body.entry?.category, r.body.entry?.volume_ml], [201, 'urine', 10])
    assert.deepEqual(fellAlerts(await t.alerts(id)), [])
  })

  it('[charting/bag-periods] Add a missed emptying: Below the floor', async () => {
    const t = await setup()
    const { id, fell } = await fall(t)
    const r = await missed(t, id, 450, nov(3, 10, 30))
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.reading.fell, r.body.reading.fell_from_ml, r.body.entry?.volume_ml], [true, 500, 450])
    assert.deepEqual(
      fellAlerts(await t.alerts(id)).map((a) => a.message),
      ['Urine bag level fell from 500 to 450 mL with no emptying recorded. Was it emptied? Review.'],
    )
    assert.equal((await t.readings(id)).find((x) => x.id === fell.reading.id)!.fell, false)
  })

  it('[charting/bag-periods] Add a missed emptying: Not by an attendant', async () => {
    const t = await setup()
    const { id } = await fall(t)
    const before = await stored(t, id)
    for (const event of ['emptied', 'bag_changed'] as const) {
      const r = await missed(t, id, 550, nov(3, 10, 30), RAVI.id, event)
      assert.deepEqual([r.status, r.body.error], [403, 'forbidden'], event)
    }
    assert.deepEqual(await stored(t, id), before)
    assert.equal(fellAlerts(await t.alerts(id)).length, 1)
  })
})

describe('late readings', () => {
  /** Every entry's history, by id. */
  const histories = async (t: T, ids: number[]) => Promise.all(ids.map((x) => t.events(x)))

  it('[charting/bag-periods] Late readings never change a charted entry: Check added between two readings', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const first = await t.reading(id, nov(3, 8), 'emptied', 600)
    const nine = await t.reading(id, nov(3, 9), 'check', 150)
    const eleven = await t.reading(id, nov(3, 11), 'emptied', 380)
    assert.deepEqual([nine.entry?.volume_ml, eleven.entry?.volume_ml], [150, 230])
    const ids = [first, nine, eleven].map((x) => x.entry!.id)
    const before = await histories(t, ids)
    const r = await t.reading(id, nov(3, 11, 30), 'check', 260, { charted_at: iso(nov(3, 10)) })
    assert.deepEqual([r.reading.rise_ml, r.entry], [110, null])
    assert.equal((await t.entry(id, eleven.entry!.id)).volume_ml, 230)
    assert.deepEqual(await histories(t, ids), before)
    const all = await t.readings(id)
    assert.deepEqual(
      all.map((x) => x.rise_ml),
      [600, 150, 110, 120],
    )
    assert.deepEqual(all.at(-1)!.entry, { id: eleven.entry!.id, volume_ml: 230, status: 'pending' })
  })

  it('[charting/bag-periods] Late readings never change a charted entry: Emptying added between two checks', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const nine = await t.reading(id, nov(3, 9), 'check', 150)
    const eleven = await t.reading(id, nov(3, 11), 'check', 380)
    assert.deepEqual([nine.entry?.volume_ml, eleven.entry?.volume_ml], [150, 230])
    const ids = [nine, eleven].map((x) => x.entry!.id)
    const before = await histories(t, ids)
    const r = await t.reading(id, nov(3, 11, 30), 'emptied', 260, { charted_at: iso(nov(3, 10)) }, ANITA.id)
    assert.deepEqual([r.entry?.volume_ml, r.entry?.created_at], [260, iso(nov(3, 10))])
    const entries = (await t.list(id)).entries
    assert.equal(
      entries.reduce((s, e) => s + e.volume_ml, 0),
      640,
    )
    assert.deepEqual(
      (await t.readings(id)).map((x) => x.rise_ml),
      [150, 110, 380],
    )
    assert.deepEqual(await histories(t, ids), before)
  })

  it('[charting/bag-periods] Late readings never change a charted entry: After the newest reading', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    const nine = await t.reading(id, nov(3, 9), 'check', 150)
    const before = await histories(t, [nine.entry!.id])
    const r = await t.reading(id, nov(3, 11, 15), 'check', 260, { charted_at: iso(nov(3, 10)) })
    assert.deepEqual([r.entry?.volume_ml, r.entry?.late], [110, true])
    assert.deepEqual(await histories(t, [nine.entry!.id]), before)
  })

  it('[charting/bag-periods] Late readings never change a charted entry: Out of range', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 14, 10))
    for (const charted of [nov(3, 14, 12), nov(3, 14, 10) - 25 * HOUR]) {
      const r = await t.post(id, { container: 'urine_bag', event: 'check', volume_ml: 200, source: 'manual', charted_at: iso(charted) })
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'])
    }
    assert.deepEqual(await stored(t, id), { readings: 0, entries: 0 })
  })
})

describe('reading due', () => {
  /** A catheter order set on the bed at `ms`. */
  const catheter = async (t: T, id: number, ms: number) => {
    t.at(ms)
    await t.store.setCare(id, 'catheter', { type: 'urethral', inserted_at: iso(nov(1, 9)) }, ANITA.id)
  }

  it('[charting/bag-periods] Urine bag reading due: At the interval', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await catheter(t, id, nov(3, 7))
    await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 12))), [])
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 12, 1))), [
      { kind: 'bag_reading_due', message: 'Urine bag reading due (last 08:00). Review.' },
    ])
  })

  it('[charting/bag-periods] Urine bag reading due: Twice the interval', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await catheter(t, id, nov(3, 7))
    await t.reading(id, nov(3, 8), 'emptied', 600)
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 15, 59)))), ['bag_reading_due'])
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 16))), [
      { kind: 'bag_reading_overdue', message: 'Urine bag reading overdue (last 08:00). Review.' },
    ])
  })

  it('[charting/bag-periods] Urine bag reading due: HDU hourly', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '1')
    await catheter(t, id, nov(3, 7))
    await t.reading(id, nov(3, 9), 'check', 150)
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 10))), [])
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 10, 1)))), ['bag_reading_due'])
  })

  it('[charting/bag-periods] Urine bag reading due: No reading since the order', async () => {
    const t = await setup()
    const id = await t.bed('3A', '5')
    await t.reading(id, nov(3, 6), 'check', 200)
    await catheter(t, id, nov(3, 10))
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 14))), [])
    assert.deepEqual(
      readingPrompt(await t.alerts(id, nov(3, 14, 1))).map((a) => a.message),
      ['Urine bag reading due (no reading since the catheter order at 10:00). Review.'],
    )
  })

  it('[charting/bag-periods] Urine bag reading due: Overnight', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await catheter(t, id, nov(2, 20))
    await t.reading(id, nov(2, 22), 'check', 200)
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 6))), [
      { kind: 'bag_reading_overdue', message: 'Urine bag reading overdue (last 2 Nov 22:00). Review.' },
    ])
  })

  it('[charting/bag-periods] Urine bag reading due: Reading taken', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await catheter(t, id, nov(3, 7))
    await t.reading(id, nov(3, 8, 29), 'emptied', 600)
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 12, 30)))), ['bag_reading_due'])
    await t.reading(id, nov(3, 12, 31), 'check', 200)
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 12, 32))), [])
  })

  it('[charting/bag-periods] Urine bag reading due: No catheter order', async () => {
    const t = await setup()
    const bagged = await t.bed('2C', '6')
    const urinal = await t.bed('2C', '5')
    await t.reading(bagged, nov(3, 6), 'emptied', 400)
    await t.reading(bagged, nov(3, 8), 'check', 200)
    t.at(nov(3, 8))
    await t.call('POST', `/api/admissions/${urinal}/entries`, {
      body: { direction: 'out', category: 'urine', volume_ml: 300, source: 'manual' },
      staff: RAVI.id,
    })
    assert.deepEqual(readingPrompt(await t.alerts(bagged, nov(3, 20))), [])
    assert.deepEqual(readingPrompt(await t.alerts(urinal, nov(3, 20))), [])
    assert.deepEqual(t.u.requests, [])
  })
})

describe('catheter reading interval', () => {
  const put = (t: T, id: number, ms: number, body: Record<string, unknown>) => {
    t.at(ms)
    return t.call('PUT', `/api/admissions/${id}/care/catheter`, { body, staff: ANITA.id })
  }
  const CATH = { type: 'urethral', inserted_at: iso(new Date(2026, 9, 29, 11).getTime()) }

  it('[charting/bag-periods] Reading interval: Catheter interval', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    assert.equal((await put(t, id, nov(3, 7), { ...CATH, measure_every_h: 1 })).status, 201)
    await t.reading(id, nov(3, 8), 'emptied', 600)
    const bags = (await t.list(id)).bags
    assert.deepEqual([bags.interval_h, bags.interval_from], [1, 'catheter'])
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 9))), [])
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 9, 1)))), ['bag_reading_due'])
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 10)))), ['bag_reading_overdue'])
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/bag-periods] Reading interval: Longer than the ward's", async () => {
    const t = await setup()
    const id = await t.bed('HDU', '1')
    assert.equal((await put(t, id, nov(3, 8), { ...CATH, measure_every_h: 4 })).status, 201)
    await t.reading(id, nov(3, 9), 'check', 150)
    const bags = (await t.list(id)).bags
    assert.deepEqual([bags.interval_h, bags.interval_from], [4, 'catheter'])
    assert.deepEqual(readingPrompt(await t.alerts(id, nov(3, 13))), [])
    assert.deepEqual(kinds(readingPrompt(await t.alerts(id, nov(3, 13, 1)))), ['bag_reading_due'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Reading interval: Not set', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    assert.equal((await put(t, id, nov(3, 7), { ...CATH, measure_every_h: null })).status, 201)
    const bags = (await t.list(id)).bags
    assert.deepEqual([bags.interval_h, bags.interval_from], [4, 'default'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Reading interval: Order ended', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    assert.equal((await put(t, id, nov(3, 7), { ...CATH, measure_every_h: 1 })).status, 201)
    await t.reading(id, nov(3, 8), 'emptied', 600)
    t.at(nov(3, 9, 30))
    assert.equal((await t.call('DELETE', `/api/admissions/${id}/care/catheter`, { staff: ANITA.id })).status, 200)
    t.at(nov(3, 9, 31))
    const l = await t.list(id)
    assert.deepEqual([l.bags.interval_h, l.bags.interval_from], [4, 'default'])
    assert.deepEqual(readingPrompt(l.alerts), [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Urine bag reading due: Interval changed while overdue', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const bed5 = await t.bed('3A', '5')
    assert.equal((await put(t, bed3, nov(2, 10), CATH)).status, 201)
    await t.reading(bed3, nov(3, 6), 'check', 200)
    assert.equal((await put(t, bed5, nov(3, 6), CATH)).status, 201)
    assert.deepEqual(kinds(readingPrompt(await t.alerts(bed3, nov(3, 14)))), ['bag_reading_overdue'])
    assert.equal((await put(t, bed3, nov(3, 14, 30), { ...CATH, measure_every_h: 2 })).status, 201)
    assert.equal((await put(t, bed5, nov(3, 14, 30), { ...CATH, measure_every_h: 2 })).status, 201)
    t.at(nov(3, 14, 31))
    assert.deepEqual(readingPrompt(await t.alerts(bed3)), [
      { kind: 'bag_reading_overdue', message: 'Urine bag reading overdue (last 06:00). Review.' },
    ])
    assert.deepEqual(readingPrompt(await t.alerts(bed5)), [
      { kind: 'bag_reading_overdue', message: 'Urine bag reading overdue (no reading since the catheter order at 06:00). Review.' },
    ])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Bag prompts join the alerts: Only nearly full', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('The drain bag is nearly full. Review.')])
      },
    })
    const t = await setup(nov(3, 9), undefined, u)
    const id = await t.bed('2C', '2')
    // Its drain, so the reading is of a bag on record (charting/bag-periods "Bag reading without the device").
    await t.order(id, nov(3, 9), 'drain', { site: 'abdominal' })
    await t.reading(id, nov(3, 9, 30), 'check', 850, { container: 'drain_bag' })
    assert.deepEqual(kinds(await t.alerts(id, nov(3, 10))), ['bag_nearly_full'])
    const ward = (await t.call<HospitalSummary>('GET', '/api/wards')).body.wards.find((w) => w.code === '2C')!
    assert.equal(ward.beds_with_alerts, 1)
    assert.deepEqual(u.requests, [])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id }, staff: ANITA.id })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.match(sent[0]!, /bag_nearly_full/)
    assert.ok(!sent[0]!.includes('Grace Okafor'), 'patient name sent upstream')
  })
})

describe('bag levels on the bed list', () => {
  const levelsOf = async (t: T, id: number) => {
    const ward = (await t.store.admission(id))!.ward_id
    const items = (await t.call<AdmissionSummary[]>('GET', `/api/admissions?ward=${ward}`)).body
    return items.find((a) => a.id === id)!.bag_levels
  }

  it('[charting/bag-periods] Bag levels on the bed list: Urine bag on a catheter', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    t.at(nov(3, 7))
    await t.store.setCare(id, 'catheter', { type: 'urethral', inserted_at: iso(nov(1, 9)) }, ANITA.id)
    await t.reading(id, nov(3, 18, 20), 'check', 1680)
    t.at(nov(3, 22, 5))
    assert.deepEqual(await levelsOf(t, id), [
      { container: 'urine_bag', level_ml: 1680, capacity_ml: 2000, read_at: iso(nov(3, 18, 20)), due_at: iso(nov(3, 22, 20)) },
    ])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Bag levels on the bed list: Emptied and changed', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(3, 7), 'check', 300, { container: 'stoma_bag' })
    await t.reading(id, nov(3, 8), 'emptied', 300, { container: 'stoma_bag' })
    await t.reading(id, nov(3, 8, 30), 'check', 400, { container: 'drain_bag' })
    await t.reading(id, nov(3, 9), 'bag_changed', 50, { container: 'drain_bag' })
    assert.deepEqual(await levelsOf(t, id), [
      { container: 'stoma_bag', level_ml: 0, capacity_ml: 500, read_at: iso(nov(3, 8)), due_at: null },
      { container: 'drain_bag', level_ml: 0, capacity_ml: 1000, read_at: iso(nov(3, 9)), due_at: null },
    ])
  })

  it('[charting/bag-periods] Bag levels on the bed list: No recent reading', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    await t.reading(id, nov(2, 8), 'check', 300)
    t.at(nov(3, 14))
    assert.deepEqual(await levelsOf(t, id), [])
    assert.deepEqual(t.u.requests, [])
  })
})
