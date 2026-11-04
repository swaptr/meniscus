import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  CareOrder,
  CareReview,
  Entry,
  EntryInput,
  EntryList,
  Explanation,
  HospitalSummary,
  Meal,
  StaffRef,
} from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { msg, resp, signIn, testApp, testDb, testStore, upstream } from './testing.ts'

const MIN = 60_000
/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const RAVI = 1
const NIKHIL: StaffRef = { id: 7, name: 'Nikhil Bose', role: 'nurse' }
const MEERA: StaffRef = { id: 6, name: 'Meera Pillai', role: 'nurse' }
const LAKSHMI: StaffRef = { id: 10, name: 'Lakshmi Iyer', role: 'matron' }
const SANA: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }
/** 11:00 on 29 Oct, local. */
const OCT29 = new Date(2026, 9, 29, 11).getTime()
const EMPTY = { orders: [], fluid_limit: null, intake_target: null, catheter: null }

type Body<T> = T & { error?: string; issues?: { path: string; message: string }[] }

/** The store opens, admitting every demo patient, at `openedAt`; the clock then moves with `at`. */
async function setup(openedAt = nov(1, 10), u = upstream(), given?: Store) {
  const clock = { t: openedAt }
  const store = given ?? (await testStore(() => clock.t))
  const { request } = await testApp({ ai: u.ai, store })
  const call = async <T>(method: string, path: string, init: { body?: unknown; staff?: number; cookie?: string | null } = {}) => {
    const res = await request(
      path,
      {
        method,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
      },
      { ...(init.staff !== undefined && { staff: init.staff }), ...(init.cookie !== undefined && { cookie: init.cookie }) },
    )
    return { status: res.status, body: (await res.json()) as Body<T> }
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const list = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`)).body
  const summary = async (id: number) => (await call<AdmissionSummary[]>('GET', '/api/admissions')).body.find((a) => a.id === id)!
  const add = (id: number, e: Partial<EntryInput> = {}, staff?: number) =>
    call<Entry>('POST', `/api/admissions/${id}/entries`, {
      body: { direction: 'in', category: 'water', volume_ml: 200, source: 'manual', ...e },
      ...(staff !== undefined && { staff }),
    })
  const review = (entryId: number, action: 'approve' | 'reject' = 'approve') =>
    call<Entry>('POST', `/api/entries/${entryId}/review`, { body: { action } })
  /** Posted, then approved, charted at `charted`. */
  const approved = async (id: number, ml: number, charted: number, e: Partial<EntryInput> = {}) => {
    const r = await add(id, { volume_ml: ml, charted_at: iso(charted), ...e })
    assert.equal(r.status, 201)
    await review(r.body.id)
    return r.body
  }
  const at = (ms: number) => {
    clock.t = ms
  }
  const put = (id: number | string, kind: string, body: unknown, staff = 4) =>
    call<CareOrder>('PUT', `/api/admissions/${id}/care/${kind}`, { body, staff })
  const end = (id: number | string, kind: string, staff = 4) => call<CareOrder>('DELETE', `/api/admissions/${id}/care/${kind}`, { staff })
  const reviewCatheter = (id: number | string, staff = 4) =>
    call<CareReview>('POST', `/api/admissions/${id}/care/catheter/review`, { staff })
  /** Every order the bed ever had, newest first. */
  const history = async (id: number) => (await list(id)).care_history
  return { clock, store, u, call, bed, list, summary, add, review, approved, at, put, end, reviewCatheter, history }
}

const kindsOf = (orders: CareOrder[]) => orders.map((o) => o.kind)

describe('care status on chart reads', () => {
  it('[charting/care-plan] Care status on chart reads: Fresh store', async () => {
    const t = await setup()
    const all = (await t.call<AdmissionSummary[]>('GET', '/api/admissions')).body
    assert.equal(all.length, 21)
    for (const a of all) assert.deepEqual(a.care, EMPTY)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care status on chart reads: Display order', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    await t.store.setCare(id, 'catheter', { type: 'urethral', inserted_at: iso(nov(1, 9)) }, 7)
    await t.store.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 7)
    await t.store.setCare(id, 'nil_by_mouth', {}, 7)
    await t.store.setCare(id, 'acuity', { level: 'watch' }, 7)
    const want = ['acuity', 'nil_by_mouth', 'fluid_limit', 'catheter']
    assert.deepEqual(kindsOf((await t.summary(id)).care.orders), want)
    assert.deepEqual(kindsOf((await t.list(id)).care.orders), want)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care order history: Long history', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    const starts: number[] = []
    for (let i = 0; i < 55; i++) {
      t.at(nov(2, 9) + i * MIN)
      starts.push(t.clock.t)
      await t.store.setCare(id, 'thickened_fluids', { level: i % 2 === 0 ? 1 : 2 }, 5)
    }
    const history = (await t.list(id)).care_history
    assert.equal(history.length, 50)
    assert.deepEqual(
      history.map((o) => o.start_at),
      starts.slice(5).reverse().map(iso),
    )
    assert.deepEqual(
      history.map((o) => o.end_at === null),
      [true, ...Array<boolean>(49).fill(false)],
    )
  })

  it('[charting/care-plan] Chart day: Across the start', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 9))
    await t.store.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 8)
    await t.approved(id, 300, nov(3, 7, 59))
    await t.approved(id, 500, nov(3, 8))
    t.at(nov(3, 10))
    const l = await t.list(id)
    assert.deepEqual([l.care.fluid_limit?.ml, l.care.fluid_limit?.since], [500, iso(nov(3, 8))])
    assert.equal(l.totals.in_ml, 800)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Counted intake: Mixed statuses', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 9))
    await t.store.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 8)
    await t.approved(id, 500, nov(3, 9))
    await t.add(id, { volume_ml: 200, item: 'tea' })
    const rejected = await t.add(id, { volume_ml: 300 })
    await t.review(rejected.body.id, 'reject')
    const dinner = await t.call<Meal>('POST', `/api/admissions/${id}/meals`, {
      body: { meal: 'dinner', portion: 75, fluid_ml: 150, source: 'manual' },
    })
    assert.equal(dinner.status, 201)
    assert.equal((await t.call<Meal>('POST', `/api/meals/${dinner.body.id}/void`, { body: { reason: 'wrong bed' } })).status, 200)
    t.at(nov(3, 10))
    const l = await t.list(id)
    assert.deepEqual([l.care.fluid_limit?.ml, l.care.fluid_limit?.pending_ml], [700, 200])
    assert.equal(l.totals.in_ml, 500)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Nil by mouth intake: Drink while fasting', async () => {
    const t = await setup()
    const id = await t.bed('2C', '1')
    t.at(nov(3, 6))
    await t.store.setCare(id, 'nil_by_mouth', { until: iso(nov(3, 14)) }, 6)
    t.at(nov(3, 10))
    const r = await t.add(id, { volume_ml: 150 })
    assert.equal(r.status, 201)
    assert.equal(r.body.status, 'pending')
    const a = (await t.list(id)).alerts.find((x) => x.kind === 'nil_by_mouth_intake')
    assert.ok(a && 'entry_ids' in a)
    assert.equal(a.message, 'Intake charted while nil by mouth: 1 entry (150 mL). Review.')
    assert.deepEqual(a.entry_ids, [r.body.id])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Thickened fluids: Recorded afterwards', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    t.at(nov(3, 8))
    await t.store.setCare(id, 'thickened_fluids', { level: 2 }, 5)
    t.at(nov(3, 9))
    const thin = await t.approved(id, 150, nov(3, 9), { iddsi_level: 0 })
    // A water jug's level drop: 1000 → 600 mL.
    for (const volume_ml of [1000, 600]) {
      t.at(t.clock.t + 30 * MIN)
      await t.call('POST', `/api/admissions/${id}/levels`, { body: { container: 'water_jug', volume_ml, source: 'manual' } })
    }
    const jug = (await t.list(id)).entries.find((e) => e.levels !== null)!
    await t.review(jug.id)
    const before = (await t.list(id)).alerts.map((a) => a.kind)
    assert.ok(before.includes('drink_consistency_unrecorded') && before.includes('drink_too_thin'))
    const r = await t.call<Entry>('POST', `/api/entries/${jug.id}/amend`, { body: { iddsi_level: 2, reason: 'checked the cup' }, staff: 4 })
    assert.equal(r.status, 200)
    assert.equal(r.body.iddsi_level, 2)
    const after = (await t.list(id)).alerts
    assert.ok(!after.some((a) => a.kind === 'drink_consistency_unrecorded'))
    const tooThin = after.find((a) => a.kind === 'drink_too_thin')
    assert.deepEqual(tooThin && 'entry_ids' in tooThin && tooThin.entry_ids, [thin.id])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care prompts join the alerts: Only a catheter review', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('The catheter is on day 6. Review whether it is still needed.')])
      },
    })
    // Admitted at 07:00, so no other prompt is due yet; the catheter order predates the chart day.
    const t = await setup(nov(3, 7), u)
    const id = await t.bed('HDU', '1')
    await t.store.setCare(id, 'catheter', { type: 'urethral', inserted_at: iso(new Date(2026, 9, 29, 11).getTime()) }, 7)
    // A catheter bed's urine bag is read hourly on HDU (charting/bag-periods): an empty bag read at 08:30 charts nothing
    // and keeps the reading prompt away, so the catheter review is the only prompt.
    t.at(nov(3, 8, 30))
    await t.store.addBagReading(id, { container: 'urine_bag', event: 'check', volume_ml: 0, source: 'manual' }, 7)
    t.at(nov(3, 9))
    assert.deepEqual(
      (await t.summary(id)).alerts.map((a) => a.kind),
      ['catheter_review'],
    )
    const hdu = (await t.call<HospitalSummary>('GET', '/api/wards')).body.wards.find((w) => w.code === 'HDU')!
    assert.equal(hdu.beds_with_alerts, 1)
    assert.deepEqual(u.requests, [])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id } })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.match(sent[0]!, /catheter_review/)
    assert.ok(!sent[0]!.includes('Nadia Rahman'), 'patient name sent upstream')
  })
})

describe('setting and ending orders', () => {
  it('[charting/care-plan] Set a care order: Start a fluid limit', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const r = await t.put(await t.bed('HDU', '3'), 'fluid_limit', { ml: 1000, scope: 'total' }, 7)
    assert.equal(r.status, 201)
    const { kind, value, start_at, end_at, set_by, ended_by } = r.body
    assert.deepEqual(
      { kind, value, start_at, end_at, set_by, ended_by },
      { kind: 'fluid_limit', value: { ml: 1000, scope: 'total' }, start_at: iso(nov(3, 10)), end_at: null, set_by: NIKHIL, ended_by: null },
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Set a care order: Change the value', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 10))
    const first = await t.put(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 7)
    t.at(nov(3, 12))
    const r = await t.put(id, 'fluid_limit', { ml: 1200, scope: 'total' }, 7)
    assert.equal(r.status, 201)
    assert.notEqual(r.body.id, first.body.id)
    assert.equal(r.body.start_at, iso(nov(3, 12)))
    const orders = (await t.list(id)).care.orders
    assert.deepEqual(
      orders.map((o) => [o.kind, o.kind === 'fluid_limit' && o.value.ml]),
      [['fluid_limit', 1200]],
    )
    const old = (await t.history(id)).find((o) => o.id === first.body.id)!
    assert.deepEqual([old.end_at, old.ended_by], [iso(nov(3, 12)), NIKHIL])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Set a care order: Same value again', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 10))
    await t.put(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 7)
    t.at(nov(3, 12))
    const current = await t.put(id, 'fluid_limit', { ml: 1200, scope: 'total' }, 7)
    t.at(nov(3, 12, 30))
    const r = await t.put(id, 'fluid_limit', { ml: 1200, scope: 'total' }, 7)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body, current.body)
    assert.equal((await t.history(id)).length, 2)
  })

  it('[charting/care-plan] Set a care order: Same value again, stored in another shape', async () => {
    const h = await testDb()
    const clock = { t: nov(3, 10) }
    const first = await openPgStore(h.db, { now: () => clock.t })
    const id = (await first.admissions()).find((a) => a.ward_code === 'HDU' && a.bed === '1')!.id
    const value = { type: 'urethral', inserted_at: iso(OCT29) } as const
    await first.setCare(id, 'catheter', value, 7)
    await first.close()
    // The same value as another build might store it: keys reordered, plus a key this build does not know.
    await h.pg.query(`UPDATE meniscus.care_order SET value = $1::jsonb WHERE admission_id = $2 AND kind = 'catheter'`, [
      JSON.stringify({ inserted_at: OCT29, note: 'left arm', type: 'urethral' }),
      id,
    ])
    const t = await setup(nov(3, 10), upstream(), await openPgStore(h.db, { now: () => clock.t }))
    clock.t = nov(3, 11)
    const r = await t.put(id, 'catheter', value, 7)
    assert.equal(r.status, 200)
    assert.equal(r.body.start_at, iso(nov(3, 10)))
    assert.equal((await t.history(id)).length, 1)
    await t.store.close()
  })

  it('[charting/care-plan] Set a care order: Unknown admission or kind', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    for (const r of [
      await t.put(999, 'fluid_limit', { ml: 1000, scope: 'total' }),
      await t.put(id, 'fluid_restriction', { ml: 1000, scope: 'total' }),
    ]) {
      assert.equal(r.status, 404)
      assert.equal(r.body.error, 'not_found')
    }
    assert.deepEqual(await t.history(id), [])
  })

  it('[charting/care-plan] Set a care order: Unknown admission before the body', async () => {
    const t = await setup()
    const r = await t.put(999, 'fluid_limit', { ml: -5 })
    assert.equal(r.status, 404)
    assert.equal(r.body.error, 'not_found')
  })

  it('[charting/care-plan] Care order values: Every kind', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const id = await t.bed('3A', '4')
    for (const [kind, body] of [
      ['nil_by_mouth', { until: iso(nov(3, 14)) }],
      ['thickened_fluids', { level: 2 }],
      ['intake_target', { ml: 1600 }],
      ['catheter', { type: 'urethral', inserted_at: iso(OCT29) }],
    ] as const) {
      const r = await t.put(id, kind, body)
      assert.equal(r.status, 201, kind)
      assert.deepEqual(r.body.value, kind === 'catheter' ? { ...body, measure_every_h: null } : body, kind)
    }
    const other = await t.put(await t.bed('3A', '5'), 'nil_by_mouth', {})
    assert.equal(other.status, 201)
    assert.deepEqual(other.body.value, { until: null })
    const cath = { type: 'suprapubic', inserted_at: iso(nov(3, 9)), measure_every_h: 2 }
    const second = await t.put(await t.bed('3A', '5'), 'catheter', cath)
    assert.equal(second.status, 201)
    assert.deepEqual(second.body.value, cath)
    const first = (await t.list(id)).care.orders.find((o) => o.kind === 'catheter')!
    assert.equal(first.kind === 'catheter' && first.value.measure_every_h, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care order values: Boundaries accepted', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const id = await t.bed('3A', '4')
    for (const [kind, body] of [
      ['fluid_limit', { ml: 500, scope: 'oral' }],
      ['fluid_limit', { ml: 3000, scope: 'oral' }],
      ['nil_by_mouth', { until: iso(nov(5, 10)) }],
      ['catheter', { type: 'suprapubic', inserted_at: iso(nov(3, 10, 1)) }],
      ['catheter', { type: 'suprapubic', inserted_at: iso(new Date(2025, 10, 3, 10).getTime()) }],
      ['catheter', { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: 1 }],
      ['catheter', { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: 12 }],
    ] as const) {
      const r = await t.put(id, kind, body)
      assert.equal(r.status, 201, JSON.stringify(body))
    }
  })

  it('[charting/care-plan] Care order values: Invalid values', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const id = await t.bed('3A', '4')
    const cases: [string, unknown][] = [
      ['fluid_limit', { ml: 450, scope: 'total' }],
      ['fluid_limit', { ml: 3050, scope: 'total' }],
      ['fluid_limit', { ml: 1000.5, scope: 'total' }],
      ['fluid_limit', { ml: 1000, scope: 'iv' }],
      ['fluid_limit', { ml: 1000 }],
      ['thickened_fluids', { level: 0 }],
      ['thickened_fluids', { level: 5 }],
      ['intake_target', { ml: 400 }],
      ['nil_by_mouth', { until: iso(nov(3, 9, 59)) }],
      ['nil_by_mouth', { until: iso(nov(3, 10)) }],
      ['nil_by_mouth', { until: iso(nov(5, 10, 1)) }],
      ['nil_by_mouth', { until: '14:00' }],
      ['nil_by_mouth', { reason: 'theatre' }],
      ['catheter', { type: 'condom', inserted_at: iso(OCT29) }],
      ['catheter', { type: 'urethral', inserted_at: iso(nov(3, 10, 2)) }],
      ['catheter', { type: 'urethral', inserted_at: iso(new Date(2025, 10, 2).getTime()) }],
      ...[0, 3, 24, 1.5, '2'].map((h): [string, unknown] => [
        'catheter',
        { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: h },
      ]),
    ]
    for (const [kind, body] of cases) {
      const r = await t.put(id, kind, body)
      assert.equal(r.status, 400, `${kind} ${JSON.stringify(body)}`)
      assert.equal(r.body.error, 'invalid_request')
      assert.deepEqual(await t.history(id), [], `${kind} ${JSON.stringify(body)}`)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care order values: No interval, sent either way', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const id = await t.bed('3A', '4')
    const set = await t.put(id, 'catheter', { type: 'urethral', inserted_at: iso(OCT29) })
    assert.equal(set.status, 201)
    const again = await t.put(id, 'catheter', { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: null })
    assert.equal(again.status, 200)
    assert.equal(again.body.id, set.body.id)
    assert.deepEqual(again.body.value, { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: null })
    assert.equal((await t.history(id)).filter((o) => o.kind === 'catheter').length, 1)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] End a care order: Lift nil by mouth', async () => {
    const t = await setup()
    const id = await t.bed('2C', '1')
    t.at(nov(3, 6))
    await t.put(id, 'nil_by_mouth', { until: iso(nov(3, 14)) }, 6)
    t.at(nov(3, 12))
    const r = await t.end(id, 'nil_by_mouth', 6)
    assert.equal(r.status, 200)
    assert.deepEqual(
      [r.body.kind, r.body.start_at, r.body.end_at, r.body.ended_by],
      ['nil_by_mouth', iso(nov(3, 6)), iso(nov(3, 12)), MEERA],
    )
    assert.deepEqual((await t.list(id)).care.orders, [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] End a care order: Nothing to end', async () => {
    const t = await setup()
    const id = await t.bed('2C', '1')
    t.at(nov(3, 6))
    await t.put(id, 'nil_by_mouth', {}, 6)
    t.at(nov(3, 12))
    await t.end(id, 'nil_by_mouth', 6)
    const before = await t.history(id)
    for (const r of [await t.end(id, 'nil_by_mouth', 6), await t.end(id, 'catheter', 6)]) {
      assert.equal(r.status, 404)
      assert.equal(r.body.error, 'not_found')
    }
    assert.deepEqual(await t.history(id), before)
  })

  it('[charting/care-plan] Care orders need a nurse: Attendant changes an order', async () => {
    const t = await setup()
    t.at(nov(3, 9))
    const [a34, c21, h1] = [await t.bed('3A', '4'), await t.bed('2C', '1'), await t.bed('HDU', '1')]
    await t.put(c21, 'nil_by_mouth', {}, 6)
    t.at(nov(3, 7))
    await t.put(h1, 'catheter', { type: 'urethral', inserted_at: iso(OCT29) }, 7)
    t.at(nov(3, 10))
    const before = await Promise.all([a34, c21, h1].map((id) => t.list(id).then((l) => [l.care, l.care_history])))
    for (const r of [
      await t.put(a34, 'fluid_limit', { ml: 1500, scope: 'total' }, RAVI),
      await t.put(999, 'fluid_limit', { ml: -5 }, RAVI),
      await t.end(c21, 'nil_by_mouth', RAVI),
      await t.reviewCatheter(h1, RAVI),
    ]) {
      assert.equal(r.status, 403)
      assert.equal(r.body.error, 'forbidden')
    }
    const after = await Promise.all([a34, c21, h1].map((id) => t.list(id).then((l) => [l.care, l.care_history])))
    assert.deepEqual(after, before)
    assert.equal(await t.store.lastReview((await t.list(h1)).care.orders[0]!.id), null)
  })

  it('[charting/care-plan] Care orders need a nurse: No session', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    const r = await t.call('PUT', `/api/admissions/${id}/care/intake_target`, { body: { ml: 1600 }, cookie: null })
    assert.equal(r.status, 401)
    assert.equal(r.body.error, 'sign_in_required')
    assert.deepEqual(await t.history(id), [])
  })

  it('[charting/care-plan] Care orders need a nurse: Matron sets an order', async () => {
    const t = await setup()
    const r = await t.put(await t.bed('3A', '4'), 'intake_target', { ml: 1600 }, 10)
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.set_by, LAKSHMI)
  })

  it('[charting/care-plan] Care orders need a nurse: Attendant reads orders', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    await t.put(id, 'intake_target', { ml: 1600 }, 4)
    const r = await t.call<EntryList>('GET', `/api/admissions/${id}/entries`, { cookie: await signIn(t.store, RAVI) })
    assert.equal(r.status, 200)
    assert.deepEqual(
      r.body.care.orders.map((o) => [o.kind, o.value]),
      [['intake_target', { ml: 1600 }]],
    )
  })

  it('[charting/care-plan] Care orders need a nurse: Dietitian sets and ends a diet', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 10))
    const set = await t.put(id, 'diet', { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }, 11)
    assert.equal(set.status, 201)
    assert.deepEqual(set.body.set_by, SANA)
    t.at(nov(3, 12))
    const ended = await t.end(id, 'diet', 11)
    assert.equal(ended.status, 200)
    assert.equal(ended.body.end_at, iso(nov(3, 12)))
    assert.deepEqual(ended.body.ended_by, SANA)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Care orders need a nurse: Dietitian and other orders', async () => {
    const t = await setup()
    t.at(nov(3, 9))
    const [a34, c21, h1] = [await t.bed('3A', '4'), await t.bed('2C', '1'), await t.bed('HDU', '1')]
    await t.put(c21, 'nil_by_mouth', {}, 6)
    t.at(nov(3, 7))
    await t.put(h1, 'catheter', { type: 'urethral', inserted_at: iso(OCT29) }, 7)
    t.at(nov(3, 10))
    const before = await Promise.all([a34, c21, h1].map((id) => t.list(id).then((l) => [l.care, l.care_history])))
    for (const r of [
      await t.put(a34, 'fluid_limit', { ml: 1500, scope: 'total' }, 11),
      await t.put(999, 'intake_target', { ml: -5 }, 11),
      await t.put(a34, 'fluid_restriction', {}, 11),
      await t.end(c21, 'nil_by_mouth', 11),
      await t.reviewCatheter(h1, 11),
    ]) {
      assert.equal(r.status, 403)
      assert.equal(r.body.error, 'forbidden')
    }
    const after = await Promise.all([a34, c21, h1].map((id) => t.list(id).then((l) => [l.care, l.care_history])))
    assert.deepEqual(after, before)
    assert.equal(await t.store.lastReview((await t.list(h1)).care.orders[0]!.id), null)
  })

  it('[charting/care-plan] Care orders need a nurse: Nurse or attendant and a diet', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    const ravi = await t.put(id, 'diet', { type: 'regular', texture: 6 }, RAVI)
    assert.equal(ravi.status, 403)
    assert.equal(ravi.body.error, 'forbidden')
    assert.deepEqual(await t.history(id), [])
    const grace = await t.put(id, 'diet', { type: 'regular', texture: 6 }, 5)
    assert.equal(grace.status, 201)
    assert.deepEqual(grace.body.set_by, { id: 5, name: 'Grace Lee', role: 'nurse' })
  })

  it('[charting/care-plan] Care order history: Replaced, then lifted', async () => {
    const t = await setup()
    const id = await t.bed('2C', '1')
    t.at(nov(3, 6))
    await t.put(id, 'nil_by_mouth', { until: iso(nov(3, 14)) }, 6)
    t.at(nov(3, 9))
    await t.put(id, 'nil_by_mouth', { until: iso(nov(3, 16)) }, 6)
    t.at(nov(3, 12))
    await t.end(id, 'nil_by_mouth', 10)
    assert.deepEqual(
      (await t.history(id)).map((o) => [o.value, o.start_at, o.end_at, o.set_by, o.ended_by]),
      [
        [{ until: iso(nov(3, 16)) }, iso(nov(3, 9)), iso(nov(3, 12)), MEERA, LAKSHMI],
        [{ until: iso(nov(3, 14)) }, iso(nov(3, 6)), iso(nov(3, 9)), MEERA, MEERA],
      ],
    )
  })

  it('[charting/care-plan] Target within the limit: Target above the limit', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    await t.put(id, 'fluid_limit', { ml: 1500, scope: 'total' })
    const r = await t.put(id, 'intake_target', { ml: 1600 })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, 'invalid_request')
    const issue = r.body.issues?.find((i) => i.path === 'ml')
    assert.match(issue?.message ?? '', /1500 mL/)
    assert.ok(!(await t.list(id)).care.orders.some((o) => o.kind === 'intake_target'))
  })

  it('[charting/care-plan] Target within the limit: Limit below the target', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    await t.put(id, 'intake_target', { ml: 1600 })
    const r = await t.put(id, 'fluid_limit', { ml: 1500, scope: 'oral' })
    assert.equal(r.status, 400)
    assert.match(r.body.issues?.find((i) => i.path === 'ml')?.message ?? '', /1600 mL/)
    assert.ok(!(await t.list(id)).care.orders.some((o) => o.kind === 'fluid_limit'))
  })

  it('[charting/care-plan] Target within the limit: Equal, or the limit ended', async () => {
    const t = await setup()
    const [one, two] = [await t.bed('HDU', '3'), await t.bed('HDU', '2')]
    await t.put(one, 'fluid_limit', { ml: 1500, scope: 'total' })
    assert.equal((await t.put(one, 'intake_target', { ml: 1500 })).status, 201)
    await t.put(two, 'fluid_limit', { ml: 1500, scope: 'total' })
    await t.end(two, 'fluid_limit')
    assert.equal((await t.put(two, 'intake_target', { ml: 1600 })).status, 201)
  })
})

describe('catheter necessity review', () => {
  /** HDU bed 1: admitted 1 Nov 10:00; a catheter inserted 29 Oct, set at 10:30 on 1 Nov by Nikhil Bose. */
  const catheterBed = async () => {
    const t = await setup()
    const id = await t.bed('HDU', '1')
    t.at(nov(1, 10, 30))
    assert.equal((await t.put(id, 'catheter', { type: 'urethral', inserted_at: iso(OCT29) }, 7)).status, 201)
    return { t, id }
  }

  it('[charting/care-plan] Catheter necessity review: Reviewed', async () => {
    const { t, id } = await catheterBed()
    t.at(nov(3, 9))
    assert.ok((await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    t.at(nov(3, 9, 10))
    const r = await t.reviewCatheter(id, 7)
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.at, r.body.by], [iso(nov(3, 9, 10)), NIKHIL])
    const l = await t.list(id)
    assert.ok(!l.alerts.some((a) => a.kind === 'catheter_review'))
    assert.equal(l.care.catheter?.review_due, false)
    assert.deepEqual(l.care.catheter?.last_review, r.body)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Catheter necessity review: Once a chart day', async () => {
    const { t, id } = await catheterBed()
    t.at(nov(3, 9, 10))
    assert.equal((await t.reviewCatheter(id, 7)).status, 201)
    t.at(nov(3, 15))
    const again = await t.reviewCatheter(id, 7)
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'already_reviewed')
    t.at(nov(4, 7, 59))
    assert.ok(!(await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    t.at(nov(4, 8))
    assert.ok((await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    t.at(nov(4, 8, 5))
    assert.equal((await t.reviewCatheter(id, 7)).status, 201)
  })

  it('[charting/care-plan] Catheter necessity review: Interval changed while due', async () => {
    const { t, id } = await catheterBed()
    t.at(nov(3, 9))
    assert.ok((await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    t.at(nov(3, 9, 5))
    const set = await t.put(id, 'catheter', { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: 1 }, 7)
    assert.equal(set.status, 201)
    t.at(nov(3, 9, 6))
    assert.equal(
      (await t.list(id)).alerts.find((a) => a.kind === 'catheter_review')?.message,
      'Catheter day 6: is it still needed? Review.',
    )
    t.at(nov(3, 9, 10))
    const r = await t.reviewCatheter(id, 7)
    assert.equal(r.status, 201)
    assert.equal(r.body.order_id, set.body.id)
    assert.ok(!(await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Catheter necessity review: Reviewed, then interval changed', async () => {
    const { t, id } = await catheterBed()
    t.at(nov(3, 8, 30))
    const review = await t.reviewCatheter(id, 7)
    assert.equal(review.status, 201)
    t.at(nov(3, 9))
    assert.equal((await t.put(id, 'catheter', { type: 'urethral', inserted_at: iso(OCT29), measure_every_h: 1 }, 7)).status, 201)
    t.at(nov(3, 9, 1))
    const l = await t.list(id)
    assert.ok(!l.alerts.some((a) => a.kind === 'catheter_review'))
    assert.equal(l.care.catheter?.review_due, false)
    assert.deepEqual(l.care.catheter?.last_review, review.body)
    t.at(nov(3, 9, 5))
    const again = await t.reviewCatheter(id, 7)
    assert.equal(again.status, 409)
    assert.equal(again.body.error, 'already_reviewed')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Catheter necessity review: Another catheter', async () => {
    const { t, id } = await catheterBed()
    t.at(nov(3, 8, 30))
    assert.equal((await t.reviewCatheter(id, 7)).status, 201)
    t.at(nov(3, 10))
    assert.equal((await t.put(id, 'catheter', { type: 'suprapubic', inserted_at: iso(nov(3, 9, 30)) }, 7)).status, 201)
    const l = await t.list(id)
    assert.ok(!l.alerts.some((a) => a.kind === 'catheter_review'))
    assert.deepEqual(l.care.catheter, { day: 1, review_due: false, last_review: null })
    t.at(nov(4, 8))
    assert.ok((await t.list(id)).alerts.some((a) => a.kind === 'catheter_review'))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Catheter necessity review: No catheter', async () => {
    const t = await setup()
    const r = await t.reviewCatheter(await t.bed('2C', '1'), 6)
    assert.equal(r.status, 404)
    assert.equal(r.body.error, 'not_found')
  })
})

describe('pre-care stores', () => {})
