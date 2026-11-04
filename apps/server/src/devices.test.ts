/** Output device orders, `devices` on the chart reads and `bag_without_device`, over HTTP. No model request but Explain's. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  Alert,
  BagReadingInput,
  BagReadingResult,
  CareOrder,
  EntryList,
  Explanation,
  HospitalSummary,
  MediaRef,
  StaffRef,
} from '@meniscus/shared'
import { jpeg, msg, resp, testApp, testStore, upstream } from './testing.ts'

const MIN = 60_000
/** Local time on `d` Nov 2026. */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const RAVI = 1
const ANITA = 4
const MEERA: StaffRef = { id: 6, name: 'Meera Pillai', role: 'nurse' }
const CATH = (at: number) => ({ type: 'urethral', inserted_at: iso(at) })

type Body<T> = T & { error?: string }

/** Every demo patient is admitted when the store opens, at `openedAt`; the clock then moves with `at`. */
async function setup(openedAt = nov(3, 9), u = upstream()) {
  const clock = { t: openedAt }
  const store = await testStore(() => clock.t)
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
  const at = (ms: number) => {
    clock.t = ms
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const list = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`)).body
  const summary = async (id: number) => (await call<AdmissionSummary[]>('GET', '/api/admissions')).body.find((a) => a.id === id)!
  const put = (id: number, kind: string, body: unknown, staff = ANITA) =>
    call<CareOrder>('PUT', `/api/admissions/${id}/care/${kind}`, { body, staff })
  const end = (id: number, kind: string, staff = ANITA) => call<CareOrder>('DELETE', `/api/admissions/${id}/care/${kind}`, { staff })
  const upload = async (id: number) => {
    const form = new FormData()
    form.set('file', new File([jpeg], 'bag.jpg', { type: 'image/jpeg' }))
    form.set('kind', 'photo')
    const res = await request(`/api/admissions/${id}/media`, { method: 'POST', body: form }, { staff: RAVI })
    assert.equal(res.status, 201)
    return (await res.json()) as MediaRef
  }
  /** A bag reading posted by Ravi Kumar at `ms`. */
  const reading = async (id: number, ms: number, body: Partial<BagReadingInput>) => {
    at(ms)
    const r = await call<BagReadingResult>('POST', `/api/admissions/${id}/bag-readings`, {
      body: { container: 'urine_bag', event: 'check', source: 'manual', ...body },
      staff: RAVI,
    })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body
  }
  const prompts = async (id: number, ms?: number) => {
    if (ms !== undefined) at(ms)
    return (await list(id)).alerts
  }
  return { clock, store, u, call, at, bed, list, summary, put, end, upload, reading, prompts }
}
const kindsOf = (xs: { kind: string }[]) => xs.map((x) => x.kind)
const without = (alerts: Alert[]) => alerts.filter((a) => a.kind === 'bag_without_device')

describe('output device orders', () => {
  it('[charting/care-plan] Output device orders: Ileostomy', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const r = await t.put(await t.bed('2C', '3'), 'stoma', { type: 'ileostomy' }, MEERA.id)
    assert.equal(r.status, 201)
    assert.equal(r.body.kind, 'stoma')
    assert.deepEqual(r.body.value, { type: 'ileostomy' })
    assert.equal(r.body.start_at, iso(nov(3, 10)))
    assert.equal(r.body.end_at, null)
    assert.deepEqual(r.body.set_by, MEERA)
    assert.deepEqual(t.u.requests, [])
  })

  /** A commode order, then a drain, then a catheter, then a stoma, from 09:00. */
  const fourOrders = async (t: Awaited<ReturnType<typeof setup>>, id: number) => {
    t.at(nov(3, 9))
    assert.equal((await t.put(id, 'voiding', { method: 'commode' })).status, 201)
    assert.equal((await t.put(id, 'drain', { site: 'abdominal' })).status, 201)
    assert.equal((await t.put(id, 'catheter', CATH(nov(3, 9)))).status, 201)
    assert.equal((await t.put(id, 'stoma', { type: 'ileostomy' })).status, 201)
  }

  it('[charting/care-plan] Output device orders: Listed after the catheter', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    await fourOrders(t, id)
    const want = ['catheter', 'stoma', 'drain', 'voiding']
    assert.deepEqual(kindsOf((await t.summary(id)).care.orders), want)
    assert.deepEqual(kindsOf((await t.list(id)).care.orders), want)
  })

  it('[charting/care-plan] Output device orders: Changed and ended', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    await fourOrders(t, id)
    const commode = (await t.list(id)).care.orders.find((o) => o.kind === 'voiding')!
    t.at(nov(3, 12))
    const changed = await t.put(id, 'voiding', { method: 'bedpan' })
    assert.equal(changed.status, 201)
    assert.notEqual(changed.body.id, commode.id)
    assert.equal(changed.body.start_at, iso(nov(3, 12)))
    t.at(nov(3, 14))
    const ended = await t.end(id, 'drain')
    assert.equal(ended.status, 200)
    assert.equal(ended.body.kind, 'drain')
    assert.equal(ended.body.end_at, iso(nov(3, 14)))
    const history = (await t.list(id)).care_history
    assert.equal(history.find((o) => o.id === commode.id)?.end_at, iso(nov(3, 12)))
    // The commode, bedpan and drain orders, beside the catheter and stoma of the same bed.
    assert.deepEqual(kindsOf(history).sort(), ['catheter', 'drain', 'stoma', 'voiding', 'voiding'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Output device orders: Not by an attendant', async () => {
    const t = await setup()
    const id = await t.bed('3A', '5')
    const r = await t.put(id, 'voiding', { method: 'commode' }, RAVI)
    assert.equal(r.status, 403)
    assert.equal(r.body.error, 'forbidden')
    assert.deepEqual((await t.list(id)).care_history, [])
  })

  it('[charting/care-plan] Output device orders: No prompt', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('No intake has been logged lately. Review.')])
      },
    })
    const t = await setup(nov(3, 9), u)
    const id = await t.bed('2C', '3')
    await t.put(id, 'stoma', { type: 'ileostomy' }, MEERA.id)
    await t.put(id, 'voiding', { method: 'toilet' }, MEERA.id)
    // Nothing logged for 8 h: `logging_gap`, the one other prompt.
    const alerts = await t.prompts(id, nov(3, 17, 30))
    assert.deepEqual(kindsOf(alerts), ['logging_gap'])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id }, staff: MEERA.id })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.ok(!sent[0]!.includes('ileostomy') && !sent[0]!.includes('toilet'))
  })
})

describe('output device order values', () => {
  it('[charting/care-plan] Output device order values: Every value', async () => {
    const t = await setup()
    assert.equal((await t.put(await t.bed('3A', '1'), 'stoma', { type: 'colostomy' })).status, 201)
    assert.equal((await t.put(await t.bed('3A', '2'), 'drain', { site: 'chest' })).status, 201)
    const id = await t.bed('3A', '4')
    for (const method of ['urinal', 'bedpan', 'commode', 'toilet', 'pads']) {
      assert.equal((await t.put(id, 'voiding', { method })).status, 201, method)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Output device order values: Invalid values', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    const cases: [string, unknown][] = [
      ['stoma', { type: 'urostomy' }],
      ['stoma', {}],
      ['stoma', { type: 'ileostomy', site: 'abdominal' }],
      ['drain', { site: 'neck' }],
      ['drain', { site: 'chest', count: 2 }],
      ['voiding', { method: 'catheter' }],
      ['voiding', { method: 'urine_bag' }],
      ['voiding', { method: 'Commode' }],
    ]
    for (const [kind, body] of cases) {
      const r = await t.put(id, kind, body)
      assert.equal(r.status, 400, `${kind} ${JSON.stringify(body)}`)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.deepEqual((await t.list(id)).care_history, [])
  })
})

describe('devices on chart reads', () => {
  const DEFAULT = { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] }

  it('[charting/care-plan] Output devices on chart reads: Fresh store', async () => {
    const t = await setup()
    const all = (await t.call<AdmissionSummary[]>('GET', '/api/admissions')).body
    assert.equal(all.length, 21)
    for (const a of all) assert.deepEqual(a.devices, DEFAULT)
    assert.deepEqual((await t.list(all[0]!.id)).devices, DEFAULT)
    // The ward list carries no devices.
    const wards = (await t.call<HospitalSummary>('GET', '/api/wards')).body
    assert.ok(wards.wards.every((w) => !('devices' in w)))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Output devices on chart reads: Catheter over the voiding order', async () => {
    const t = await setup()
    const id = await t.bed('3A', '5')
    t.at(nov(3, 9))
    await t.put(id, 'voiding', { method: 'commode' })
    const both = async () => {
      const a = (await t.summary(id)).devices
      assert.deepEqual((await t.list(id)).devices, a)
      return a
    }
    t.at(nov(3, 9, 59))
    assert.deepEqual(await both(), { urine: 'commode', urine_from: 'voiding', urine_measured: true, bags: [] })
    t.at(nov(3, 10))
    await t.put(id, 'catheter', CATH(nov(3, 10)))
    assert.deepEqual(await both(), { urine: 'catheter', urine_from: 'catheter', urine_measured: true, bags: ['urine_bag'] })
    t.at(nov(3, 16))
    await t.end(id, 'catheter')
    assert.deepEqual(await both(), { urine: 'commode', urine_from: 'voiding', urine_measured: true, bags: [] })
  })

  it('[charting/care-plan] Output devices on chart reads: Stoma and drain', async () => {
    const t = await setup()
    const id = await t.bed('2C', '2')
    await t.put(id, 'catheter', CATH(nov(3, 9)), MEERA.id)
    await t.put(id, 'drain', { site: 'abdominal' }, MEERA.id)
    await t.put(id, 'stoma', { type: 'ileostomy' }, MEERA.id)
    const want = ['urine_bag', 'stoma_bag', 'drain_bag']
    assert.deepEqual((await t.summary(id)).devices.bags, want)
    assert.deepEqual((await t.list(id)).devices.bags, want)
  })

  it('[charting/care-plan] Output devices on chart reads: Toilet', async () => {
    const t = await setup()
    const id = await t.bed('3A', '7')
    await t.put(id, 'voiding', { method: 'toilet' })
    const want = { urine: 'toilet', urine_from: 'voiding', urine_measured: false, bags: [] }
    assert.deepEqual((await t.summary(id)).devices, want)
    assert.deepEqual((await t.list(id)).devices, want)
  })

  it('[charting/care-plan] Care status on chart reads: Device kinds before the diet', async () => {
    const t = await setup()
    const id = await t.bed('3A', '4')
    assert.equal((await t.put(id, 'diet', { type: 'regular', texture: 7 })).status, 201)
    await t.put(id, 'voiding', { method: 'commode' })
    await t.put(id, 'drain', { site: 'abdominal' })
    await t.put(id, 'catheter', CATH(nov(3, 9)))
    await t.put(id, 'stoma', { type: 'colostomy' })
    const want = ['catheter', 'stoma', 'drain', 'voiding', 'diet']
    assert.deepEqual(kindsOf((await t.summary(id)).care.orders), want)
    assert.deepEqual(kindsOf((await t.list(id)).care.orders), want)
  })
})

describe('bag reading without the device', () => {
  const NO_CATHETER = 'Urine bag reading at 10:30, but no catheter is on the care plan. Review.'

  it('[charting/bag-periods] Bag reading without the device: Urine bag on a bed with no catheter', async () => {
    const t = await setup()
    const id = await t.bed('3A', '5')
    const photo = await t.upload(id)
    const r = await t.reading(id, nov(3, 10, 30), { volume_ml: 300, source: 'photo', media_id: photo.id })
    assert.equal(r.reading.volume_ml, 300)
    assert.equal(r.entry?.status, 'pending')
    assert.equal(r.entry?.volume_ml, 300)
    assert.equal(r.entry?.category, 'urine')
    assert.deepEqual(without(await t.prompts(id)), [{ kind: 'bag_without_device', message: NO_CATHETER }])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/bag-periods] Bag reading without the device: Catheter added', async () => {
    const t = await setup()
    const id = await t.bed('3A', '5')
    const r = await t.reading(id, nov(3, 10, 30), { volume_ml: 300 })
    assert.equal(without(await t.prompts(id)).length, 1)
    t.at(nov(3, 11))
    assert.equal((await t.put(id, 'catheter', CATH(nov(3, 11)))).status, 201)
    const after = await t.list(id)
    assert.deepEqual(without(after.alerts), [])
    const readings = after.bags.periods.flatMap((p) => p.readings)
    assert.deepEqual(
      readings.map((x) => [x.id, x.volume_ml, x.created_at]),
      [[r.reading.id, 300, iso(nov(3, 10, 30))]],
    )
    const e = after.entries.find((x) => x.id === r.entry!.id)!
    assert.deepEqual([e.volume_ml, e.status, e.created_at], [300, 'pending', iso(nov(3, 10, 30))])
  })

  it('[charting/bag-periods] Bag reading without the device: Readings while the catheter was in', async () => {
    const t = await setup(nov(3, 7))
    const id = await t.bed('3A', '3')
    await t.put(id, 'catheter', CATH(nov(3, 7)))
    await t.reading(id, nov(3, 8), { volume_ml: 200 })
    await t.reading(id, nov(3, 12), { volume_ml: 400 })
    t.at(nov(3, 13))
    await t.end(id, 'catheter')
    assert.deepEqual(without(await t.prompts(id, nov(3, 14))), [])
    await t.reading(id, nov(3, 15), { volume_ml: 450 })
    assert.deepEqual(without(await t.prompts(id)), [
      { kind: 'bag_without_device', message: 'Urine bag reading at 15:00, but no catheter is on the care plan. Review.' },
    ])
  })

  it('[charting/bag-periods] Bag reading without the device: Stoma and drain', async () => {
    const t = await setup(nov(3, 8))
    const id = await t.bed('2C', '2')
    await t.put(id, 'catheter', CATH(nov(3, 8)), MEERA.id)
    await t.reading(id, nov(3, 9), { container: 'stoma_bag', volume_ml: 120 })
    await t.reading(id, nov(3, 10), { container: 'drain_bag', volume_ml: 80 })
    assert.deepEqual(without(await t.prompts(id)), [
      { kind: 'bag_without_device', message: 'Stoma bag reading at 09:00, but no stoma is on the care plan. Review.' },
      { kind: 'bag_without_device', message: 'Drain bag reading at 10:00, but no drain is on the care plan. Review.' },
    ])
  })

  it('[charting/bag-periods] Bag reading without the device: A day later', async () => {
    const t = await setup(nov(2, 9))
    const id = await t.bed('3A', '5')
    await t.reading(id, nov(2, 10), { volume_ml: 300 })
    assert.equal(without(await t.prompts(id, nov(3, 10) - MIN)).length, 1)
    assert.deepEqual(without(await t.prompts(id, nov(3, 10) + MIN)), [])
  })

  it('[charting/bag-periods] Bag reading without the device: Explained', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('A urine bag was read on a bed with no catheter. Review.')])
      },
    })
    const t = await setup(nov(3, 9), u)
    const id = await t.bed('3A', '5')
    await t.reading(id, nov(3, 10, 30), { volume_ml: 300 })
    assert.deepEqual(kindsOf(await t.prompts(id, nov(3, 10, 35))), ['bag_without_device'])
    const ward = (await t.call<HospitalSummary>('GET', '/api/wards')).body.wards.find((w) => w.code === '3A')!
    assert.equal(ward.beds_with_alerts, 1)
    assert.deepEqual(u.requests, [])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id }, staff: ANITA })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.match(sent[0]!, /bag_without_device/)
    assert.ok(!sent[0]!.includes('Joseph Mwangi'), 'patient name sent upstream')
  })
})
