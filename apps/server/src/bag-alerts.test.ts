/** bag-alerts over HTTP: duplicate readings, bag nearly full and the low-output window. No test sends a model request beyond its reads. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Alert, BagDuplicate, BagReadingInput, EntryList } from '@meniscus/shared'
import { ANITA, RAVI, nov, setup } from './read-fixture.ts'
import { openPgStore } from './store/pg/store.ts'
import { testDb } from './testing.ts'

const MEERA = 6
const iso = (ms: number) => new Date(ms).toISOString()
type T = Awaited<ReturnType<typeof setup>>

/** A manual urine-bag reading charted now (or at `charted_at`), posted at `ms`. */
const post = async (
  t: T,
  id: number,
  ms: number,
  body: Omit<Partial<BagReadingInput>, 'confirm_duplicate_of'> & Record<string, unknown>,
  staff = RAVI,
) => {
  t.at(ms)
  const r = await t.bag(id, { source: 'manual', ...body }, staff)
  // A 409's body: the reading it repeats.
  return r as typeof r & { body: { duplicate_of?: BagDuplicate } }
}
/** What the bed holds: its bag readings, urine entries (volumes) and links. */
const holds = async (t: T, id: number) => ({
  readings: (await t.store.bagReadings(id, 0)).map((r) => [r.event, r.volume_ml, r.created_at]),
  entries: (await t.store.entries(id))!.entries.map((e) => [e.category, e.volume_ml]).sort(),
})

describe('duplicate bag reading', () => {
  /** 3A bed 3: checked at 260 mL at 10:00, emptied at 380 mL at 11:00. */
  async function emptied(t: T) {
    const id = await t.bed('3A', '3')
    assert.equal((await post(t, id, nov(3, 10), { event: 'check', volume_ml: 260 })).status, 201)
    const first = await post(t, id, nov(3, 11), { event: 'emptied', volume_ml: 380 })
    assert.equal(first.status, 201)
    assert.equal(first.body.entry?.volume_ml, 120)
    return { id, first: first.body.reading }
  }
  const EMPTIED = { event: 'emptied', volume_ml: 380 } as const

  it('[charting/bag-periods] Duplicate bag reading: Emptying saved twice', async () => {
    const t = await setup(nov(1, 8))
    const { id, first } = await emptied(t)
    const before = await holds(t, id)
    const again = await post(t, id, nov(3, 11, 2), EMPTIED)
    assert.equal(again.status, 409)
    assert.deepEqual(again.body, {
      error: 'duplicate_reading',
      duplicate_of: { id: first.id, event: 'emptied', volume_ml: 380, created_at: iso(nov(3, 11)) },
    })
    assert.deepEqual(await holds(t, id), before)
    assert.equal(before.readings.length, 2)
    assert.deepEqual(
      before.entries.filter(([, ml]) => ml === 120),
      [['urine', 120]],
    )
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Duplicate bag reading: Saved anyway', async () => {
    const t = await setup(nov(1, 8))
    const { id, first } = await emptied(t)
    assert.equal((await post(t, id, nov(3, 11, 2), EMPTIED)).status, 409)
    const r = await post(t, id, nov(3, 11, 3), { ...EMPTIED, confirm_duplicate_of: first.id })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.reading.confirmed_duplicate_of, first.id)
    assert.equal(r.body.reading.rise_ml, 380)
    assert.deepEqual([r.body.entry?.category, r.body.entry?.volume_ml, r.body.entry?.status], ['urine', 380, 'pending'])
    const other = await post(t, await t.bed('3A', '5'), nov(3, 11, 4), { ...EMPTIED, confirm_duplicate_of: 5 })
    assert.equal(other.status, 201)
    assert.equal(other.body.reading.confirmed_duplicate_of, null)
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Duplicate bag reading: Response lost, tapped again', async () => {
    const t = await setup(nov(1, 8))
    const { id, first } = await emptied(t)
    assert.equal((await post(t, id, nov(3, 11, 2), EMPTIED)).status, 409)
    const saved = await post(t, id, nov(3, 11, 3), { ...EMPTIED, confirm_duplicate_of: first.id })
    assert.equal(saved.status, 201)
    const before = await holds(t, id)
    const again = await post(t, id, nov(3, 11, 4), { ...EMPTIED, confirm_duplicate_of: first.id })
    assert.equal(again.status, 409)
    assert.deepEqual(again.body.duplicate_of, {
      id: saved.body.reading.id,
      event: 'emptied',
      volume_ml: 380,
      created_at: iso(nov(3, 11, 3)),
    })
    assert.deepEqual(await holds(t, id), before)
    const anyway = (await t.store.bagReadings(id, 0)).filter((r) => r.confirmed_duplicate_of !== null)
    assert.deepEqual(
      anyway.map((r) => r.id),
      [saved.body.reading.id],
    )
    assert.deepEqual(
      before.entries.filter(([, ml]) => ml === 380),
      [['urine', 380]],
    )
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Duplicate bag reading: Match changed', async () => {
    const t = await setup(nov(1, 8))
    const { id, first } = await emptied(t)
    assert.equal((await post(t, id, nov(3, 11, 2), EMPTIED)).status, 409)
    const meera = await post(t, id, nov(3, 11, 2), { ...EMPTIED, charted_at: iso(nov(3, 11, 1)), confirm_duplicate_of: first.id }, MEERA)
    assert.equal(meera.status, 201, JSON.stringify(meera.body))
    const before = await holds(t, id)
    const ravi = await post(t, id, nov(3, 11, 3), { ...EMPTIED, confirm_duplicate_of: first.id })
    assert.equal(ravi.status, 409)
    assert.equal(ravi.body.duplicate_of?.id, meera.body.reading.id)
    assert.deepEqual(await holds(t, id), before)
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Duplicate bag reading: Bounds', async () => {
    const cases: [number, number, number][] = [
      [405, nov(3, 11, 10), 409],
      [355, nov(3, 10, 50), 409],
      [406, nov(3, 11), 201],
      [380, nov(3, 11, 11), 201],
      [380, nov(3, 10, 49), 201],
    ]
    for (const [ml, charted, status] of cases) {
      const t = await setup(nov(1, 8))
      const id = await t.bed('3A', '3')
      assert.equal((await post(t, id, nov(3, 11), EMPTIED)).status, 201)
      const r = await post(t, id, nov(3, 11, 15), { event: 'emptied', volume_ml: ml, charted_at: iso(charted) })
      assert.equal(r.status, status, `${ml} mL at ${iso(charted)}`)
      if (status === 409) assert.equal(r.body.error, 'duplicate_reading')
      assert.equal(t.requests(), 0)
    }
  })

  it('[charting/bag-periods] Duplicate bag reading: Different event or bag', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    const posts = [
      await post(t, id, nov(3, 11), { event: 'check', volume_ml: 380 }),
      await post(t, id, nov(3, 11, 1), { event: 'emptied', volume_ml: 380 }),
      await post(t, id, nov(3, 11, 2), { event: 'bag_changed', volume_ml: 0 }),
      await post(t, id, nov(3, 11, 3), { container: 'stoma_bag', event: 'check', volume_ml: 380 }),
    ]
    assert.deepEqual(
      posts.map((r) => r.status),
      [201, 201, 201, 201],
    )
    assert.equal(t.requests(), 0)
  })

  const BAG = { container: 'urine_bag', fluid: 'urine', volume_ml: 380, capacity_ml: 2000 } as const

  it('[charting/bag-periods] Duplicate bag reading: Posted again with its read', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    t.at(nov(3, 11))
    const read = await t.photoRead(id, BAG)
    const photo = await t.upload(id)
    const body = { event: 'emptied', volume_ml: 380, media_id: photo.id, evidence: t.evidence(), read_id: read } as const
    const before = t.requests()
    assert.equal((await t.bag(id, body)).status, 201)
    t.at(nov(3, 11, 2))
    const again = await t.bag(id, body)
    assert.equal(again.status, 400)
    assert.deepEqual(again.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.deepEqual(
      (await t.store.bagReadings(id, 0)).map((r) => [r.event, r.volume_ml]),
      [['emptied', 380]],
    )
    assert.equal(t.requests(), before)
  })

  it('[charting/bag-periods] Duplicate bag reading: Refused, then saved with its read', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    const first = await post(t, id, nov(3, 11), EMPTIED)
    assert.equal(first.status, 201)
    t.at(nov(3, 11, 2))
    const read = await t.photoRead(id, BAG)
    const photo = await t.upload(id)
    const body = { event: 'emptied', volume_ml: 380, source: 'photo', media_id: photo.id, evidence: t.evidence(), read_id: read } as const
    const before = { held: await holds(t, id), requests: t.requests() }
    const refused = await t.bag(id, body)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.error, 'duplicate_reading')
    assert.equal(await t.store.linked(read, 0), false)
    assert.deepEqual(await holds(t, id), before.held)
    const saved = await t.bag(id, { ...body, confirm_duplicate_of: first.body.reading.id })
    assert.equal(saved.status, 201, JSON.stringify(saved.body))
    assert.equal(await t.store.linked(read, 0), true)
    assert.deepEqual(await t.links(read), [{ draft: 0, level: { volume_ml: 380, container: 'urine_bag', event: 'emptied' } }])
    assert.equal(t.requests(), before.requests)
  })

  it('[charting/bag-periods] Duplicate bag reading: Not a way past the nurse', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('2C', '6')
    const at9 = await post(t, id, nov(3, 9), { event: 'check', volume_ml: 500 })
    await post(t, id, nov(3, 12), { event: 'check', volume_ml: 150 })
    const before = await holds(t, id)
    const r = await post(t, id, nov(3, 13), {
      event: 'emptied',
      volume_ml: 550,
      charted_at: iso(nov(3, 10, 30)),
      confirm_duplicate_of: at9.body.reading.id,
    })
    assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
    assert.deepEqual(await holds(t, id), before)
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Duplicate bag reading: Invalid confirmation', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    for (const bad of ['yes', true, 0, 1.5]) {
      const r = await post(t, id, nov(3, 11), { event: 'check', volume_ml: 300, confirm_duplicate_of: bad })
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(bad))
    }
    assert.deepEqual(await holds(t, id), { readings: [], entries: [] })
    assert.equal(t.requests(), 0)
  })
})

/** The bed's prompts on the chart read at `ms`. */
async function alerts(t: T, id: number, ms: number): Promise<Alert[]> {
  t.at(ms)
  const r = await t.get<EntryList>(`/api/admissions/${id}/entries`)
  assert.equal(r.status, 200)
  return r.body.alerts
}
const full = (as: Alert[]) => as.filter((a) => a.kind === 'bag_nearly_full').map((a) => a.message)

describe('bag nearly full', () => {
  it('[charting/bag-periods] Bag nearly full: At 80%', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    await post(t, id, nov(3, 10), { event: 'check', volume_ml: 1599 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 10, 15))), [])
    await post(t, id, nov(3, 10, 30), { event: 'check', volume_ml: 1600 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 10, 31))), ['Urine bag nearly full: 1600 of 2000 mL at 10:30. Review.'])
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Bag nearly full: Stoma and drain', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('2C', '2')
    await post(t, id, nov(3, 9), { container: 'stoma_bag', event: 'check', volume_ml: 400 })
    await post(t, id, nov(3, 9), { container: 'drain_bag', event: 'check', volume_ml: 790 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 9, 30))), ['Stoma bag nearly full: 400 of 500 mL at 09:00. Review.'])
    await post(t, id, nov(3, 10), { container: 'drain_bag', event: 'check', volume_ml: 800 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 10))), [
      'Stoma bag nearly full: 400 of 500 mL at 09:00. Review.',
      'Drain bag nearly full: 800 of 1000 mL at 10:00. Review.',
    ])
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Bag nearly full: Emptied', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    await post(t, id, nov(3, 10, 30), { event: 'check', volume_ml: 1600 })
    await post(t, id, nov(3, 10, 45), { event: 'emptied', volume_ml: 1650 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 10, 46))), [])
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Bag nearly full: Overnight', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    await post(t, id, nov(2, 22), { event: 'check', volume_ml: 1700 })
    assert.deepEqual(full(await alerts(t, id, nov(3, 6))), ['Urine bag nearly full: 1700 of 2000 mL at 2 Nov 22:00. Review.'])
    assert.equal(t.requests(), 0)
  })

  it('[charting/bag-periods] Bag nearly full: A day later', async () => {
    const t = await setup(nov(1, 8))
    const id = await t.bed('3A', '3')
    await post(t, id, nov(3, 10, 30), { event: 'check', volume_ml: 1600 })
    assert.equal(full(await alerts(t, id, nov(4, 10, 29))).length, 1)
    assert.deepEqual(full(await alerts(t, id, nov(4, 10, 31))), [])
    assert.equal(t.requests(), 0)
  })
})

/** A store whose 3A bed 3 patient weighs 60 kg, every patient admitted at the clock's start. */
async function sixtyKg(start: number) {
  const t = await setup(start, async (now) => {
    const h = await testDb()
    const store = await openPgStore(h.db, { now })
    await h.pg.query(
      "UPDATE meniscus.admission SET weight_kg = 60 WHERE bed = '3' AND ward_id = (SELECT id FROM meniscus.ward WHERE code = '3A')",
    )
    return store
  })
  return { t, id: await t.bed('3A', '3') }
}
const low = (as: Alert[]) => as.filter((a) => a.kind === 'low_urine_output').map((a) => a.message)
/** Posted at `ms`, then its entry approved by a nurse. */
async function approved(t: T, id: number, ms: number, body: Partial<BagReadingInput>) {
  const r = await post(t, id, ms, body)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  if (r.body.entry) assert.equal((await t.approve(r.body.entry.id)).status, 200)
  return r.body
}

describe('low urine output with bag readings', () => {
  it('[charting/alerts] Low urine output: Window ends at the newest bag reading', async () => {
    const { t, id } = await sixtyKg(nov(1, 0))
    await approved(t, id, nov(3, 0), { event: 'bag_changed', volume_ml: 0 })
    await approved(t, id, nov(3, 8), { event: 'emptied', volume_ml: 320 })
    assert.deepEqual(low(await alerts(t, id, nov(3, 14))), [])
    assert.deepEqual(low(await alerts(t, id, nov(3, 15, 59))), [])
    assert.deepEqual(low(await alerts(t, id, nov(3, 16))), ['Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.'])
    assert.equal(t.requests(), 0)
  })

  it('[charting/alerts] Low urine output: Charted 25 hours before', async () => {
    const { t, id } = await sixtyKg(new Date(2026, 9, 31, 13).getTime())
    t.at(nov(2, 0))
    await t.store.setCare(id, 'catheter', { type: 'urethral', inserted_at: iso(nov(1, 9)), measure_every_h: 12 }, ANITA)
    await approved(t, id, nov(2, 1), { event: 'bag_changed', volume_ml: 0 })
    await approved(t, id, nov(2, 13), { event: 'emptied', volume_ml: 240 })
    await approved(t, id, nov(2, 18), { event: 'check', volume_ml: 100 })
    assert.deepEqual(low(await alerts(t, id, nov(3, 14))), [
      'Urine output 120 mL in the 6 h to the 2 Nov 18:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
    assert.equal(t.requests(), 0)
  })
})
