import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { CareOrder, EntryList, Explanation, StaffRef } from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { msg, resp, testApp, upstream, testStore } from './testing.ts'

/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const GRACE = 5
const DIVYA = 8
const LAKSHMI = 10
const SANA = 11
const SANA_REF: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }
const DIVYA_REF: StaffRef = { id: 8, name: 'Divya Kapoor', role: 'nurse' }
const GRACE_REF: StaffRef = { id: 5, name: 'Grace Lee', role: 'nurse' }
const RENAL = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }

type Body<T> = T & { error?: string }

async function setup(u = upstream()) {
  const clock = { t: nov(3, 7) }
  const store: Store = await testStore(() => clock.t)
  const { request } = await testApp({ ai: u.ai, store })
  const call = async <T>(method: string, path: string, body: unknown, staff: number) => {
    const res = await request(
      path,
      { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) },
      { staff },
    )
    return { status: res.status, body: (await res.json()) as Body<T> }
  }
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!.id
  const put = (id: number | string, body: unknown, staff: number) =>
    call<CareOrder<'diet'>>('PUT', `/api/admissions/${id}/care/diet`, body, staff)
  const end = (id: number | string, staff: number) => call<CareOrder<'diet'>>('DELETE', `/api/admissions/${id}/care/diet`, undefined, staff)
  const list = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`, undefined, SANA)).body
  const diets = async (id: number) => (await list(id)).care_history.filter((o) => o.kind === 'diet')
  const active = async (id: number) => (await list(id)).care.orders.find((o) => o.kind === 'diet') ?? null
  const at = (ms: number) => {
    clock.t = ms
  }
  return { clock, store, u, call, bed, put, end, list, diets, active, at }
}

describe('diet order values', () => {
  it('[charting/care-plan] Diet order values: Diet boundaries accepted', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 10))
    for (const body of [
      { type: 'renal', texture: 3, kcal: 800, protein_g: 20 },
      { type: 'gluten_free', texture: 7, kcal: 4000, protein_g: 200 },
      { type: 'regular', texture: 7 },
    ]) {
      const r = await t.put(id, body, SANA)
      assert.equal(r.status, 201, JSON.stringify(r.body))
    }
    assert.deepEqual((await t.active(id))?.value, { type: 'regular', texture: 7, kcal: null, protein_g: null })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Diet order values: Invalid diet values', async () => {
    const t = await setup()
    const id = await t.bed('5B', '2')
    for (const body of [
      { type: 'keto', texture: 7 },
      { type: 'renal' },
      { texture: 7 },
      { type: 'renal', texture: 2 },
      { type: 'renal', texture: 8 },
      { type: 'renal', texture: '7' },
      { type: 'renal', texture: 7, kcal: 750 },
      { type: 'renal', texture: 7, kcal: 4050 },
      { type: 'renal', texture: 7, kcal: 1800.5 },
      { type: 'renal', texture: 7, protein_g: 15 },
      { type: 'renal', texture: 7, protein_g: 210 },
      { type: 'renal', texture: 7, sodium_mg: 2000 },
    ]) {
      const r = await t.put(id, body, SANA)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.deepEqual((await t.list(id)).care_history, [])
  })
})

describe('diet order', () => {
  it('[charting/care-plan] Diet order: Renal diet', async () => {
    const t = await setup()
    t.at(nov(3, 10))
    const r = await t.put(await t.bed('HDU', '3'), RENAL, SANA)
    assert.equal(r.status, 201)
    assert.equal(r.body.kind, 'diet')
    assert.deepEqual(r.body.value, RENAL)
    assert.equal(r.body.start_at, iso(nov(3, 10)))
    assert.equal(r.body.end_at, null)
    assert.deepEqual(r.body.set_by, SANA_REF)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Diet order: Listed last, no prompt', async () => {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 9))
    await t.store.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, DIVYA)
    t.at(nov(3, 10))
    const before = (await t.list(id)).alerts
    await t.put(id, RENAL, SANA)
    const l = await t.list(id)
    const summary = (await t.call<{ id: number; care: EntryList['care'] }[]>('GET', '/api/admissions', undefined, SANA)).body.find(
      (a) => a.id === id,
    )!
    assert.deepEqual(
      l.care.orders.map((o) => o.kind),
      ['fluid_limit', 'diet'],
    )
    assert.deepEqual(
      summary.care.orders.map((o) => o.kind),
      ['fluid_limit', 'diet'],
    )
    assert.deepEqual(Object.keys(l.care).sort(), ['catheter', 'fluid_limit', 'intake_target', 'orders'])
    assert.deepEqual(l.alerts, before)
  })

  it('[charting/care-plan] Diet order: Targets left out', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    const first = await t.put(id, { type: 'regular', texture: 6 }, GRACE)
    assert.equal(first.status, 201)
    assert.deepEqual(first.body.value, { type: 'regular', texture: 6, kcal: null, protein_g: null })
    const again = await t.put(id, { type: 'regular', texture: 6, kcal: null, protein_g: null }, GRACE)
    assert.equal(again.status, 200)
    assert.deepEqual(again.body, first.body)
    assert.equal((await t.diets(id)).length, 1)
  })

  it('[charting/care-plan] Diet order: Not in Explain', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('Intake is near the fluid limit. Review.')])
      },
    })
    const t = await setup(u)
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 9))
    await t.store.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, DIVYA)
    await t.store.setCare(id, 'diet', RENAL as CareOrder<'diet'>['value'], SANA)
    const e = await t.call<{ id: number }>(
      'POST',
      `/api/admissions/${id}/entries`,
      { direction: 'in', category: 'water', volume_ml: 820, source: 'manual', charted_at: iso(nov(3, 9)) },
      DIVYA,
    )
    assert.equal(e.status, 201)
    t.at(nov(3, 10))
    assert.ok((await t.list(id)).alerts.some((a) => a.kind === 'fluid_limit_near'))
    assert.deepEqual(u.requests, [])
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { admission_id: id }, DIVYA)
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.equal(sent.length, 1)
    assert.match(sent[0]!, /fluid_limit_near/)
    assert.ok(!sent[0]!.includes('renal'), 'diet type sent upstream')
    assert.ok(!sent[0]!.includes('kcal'), 'diet target sent upstream')
  })
})

describe('diet targets', () => {
  /** HDU bed 3 with Sana Mirza's renal diet, set at 10:00. */
  async function renal() {
    const t = await setup()
    const id = await t.bed('HDU', '3')
    t.at(nov(3, 10))
    assert.equal((await t.put(id, RENAL, SANA)).status, 201)
    return { t, id }
  }

  it('[charting/care-plan] Diet targets need a dietitian: Nurse changes the texture', async () => {
    const { t, id } = await renal()
    t.at(nov(3, 11))
    const r = await t.put(id, { ...RENAL, texture: 6 }, DIVYA)
    assert.equal(r.status, 201)
    assert.deepEqual(r.body.value, { ...RENAL, texture: 6 })
    assert.deepEqual(r.body.set_by, DIVYA_REF)
    const old = (await t.diets(id)).find((o) => o.start_at === iso(nov(3, 10)))!
    assert.equal(old.end_at, iso(nov(3, 11)))
    assert.deepEqual(old.ended_by, DIVYA_REF)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/care-plan] Diet targets need a dietitian: Nurse cannot change or drop targets', async () => {
    const { t, id } = await renal()
    for (const body of [
      { type: 'renal', texture: 6, kcal: 2000, protein_g: 60 },
      { type: 'renal', texture: 6 },
      { type: 'renal', texture: 6, kcal: 1800 },
    ]) {
      const r = await t.put(id, body, DIVYA)
      assert.equal(r.status, 403, JSON.stringify(body))
      assert.equal(r.body.error, 'forbidden')
    }
    assert.deepEqual((await t.active(id))?.value, RENAL)
    assert.equal((await t.diets(id)).length, 1)
  })

  it('[charting/care-plan] Diet targets need a dietitian: Nurse or matron cannot add targets', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    for (const staff of [GRACE, LAKSHMI]) {
      const r = await t.put(id, { type: 'regular', texture: 6, kcal: 1600 }, staff)
      assert.equal(r.status, 403)
      assert.equal(r.body.error, 'forbidden')
    }
    assert.deepEqual(await t.diets(id), [])
    assert.equal((await t.put(id, { type: 'regular', texture: 6 }, GRACE)).status, 201)
  })

  it('[charting/care-plan] Diet targets need a dietitian: Ending targets needs a dietitian', async () => {
    const { t, id } = await renal()
    const refused = await t.end(id, DIVYA)
    assert.equal(refused.status, 403)
    assert.equal(refused.body.error, 'forbidden')
    assert.notEqual(await t.active(id), null)
    const ended = await t.end(id, SANA)
    assert.equal(ended.status, 200)
    assert.deepEqual(ended.body.ended_by, SANA_REF)
    const again = await t.put(id, { type: 'renal', texture: 7 }, DIVYA)
    assert.equal(again.status, 201)
    assert.deepEqual([again.body.value.kcal, again.body.value.protein_g], [null, null])
  })

  it('[charting/care-plan] Diet targets need a dietitian: No targets to keep', async () => {
    const t = await setup()
    const id = await t.bed('5B', '6')
    await t.put(id, { type: 'regular', texture: 6 }, GRACE)
    const r = await t.end(id, GRACE)
    assert.equal(r.status, 200)
    assert.deepEqual(r.body.ended_by, GRACE_REF)
  })

  it('[charting/care-plan] Diet targets need a dietitian: Order of checks', async () => {
    const { t, id } = await renal()
    const missing = await t.put(999, { type: 'renal', texture: 7, kcal: 2000 }, DIVYA)
    assert.deepEqual([missing.status, missing.body.error], [404, 'not_found'])
    const nurse = await t.put(id, { type: 'renal', texture: 9, kcal: 2000, protein_g: 60 }, DIVYA)
    assert.deepEqual([nurse.status, nurse.body.error], [403, 'forbidden'])
    const sana = await t.put(id, { type: 'renal', texture: 9, kcal: 2000, protein_g: 60 }, SANA)
    assert.deepEqual([sana.status, sana.body.error], [400, 'invalid_request'])
  })

  it('decides the targets inside the store transaction, whatever the route saw', async () => {
    const { t, id } = await renal()
    // The route's pre-check saw 1800/60; a dietitian then changed them before the nurse's write.
    t.at(nov(3, 11))
    assert.equal((await t.put(id, { ...RENAL, kcal: 2000 }, SANA)).status, 201)
    const before = await t.diets(id)
    t.at(nov(3, 12))
    assert.equal(
      await t.store.setCare(id, 'diet', { ...RENAL, texture: 6 } as CareOrder<'diet'>['value'], DIVYA, {
        keepTargets: { kcal: 1800, protein_g: 60 },
      }),
      'forbidden',
    )
    assert.equal(await t.store.endCare(id, 'diet', DIVYA, { keepTargets: true }), 'forbidden')
    assert.deepEqual(await t.diets(id), before)
    // Matching targets pass; a targetless diet may be ended.
    const kept = await t.store.setCare(id, 'diet', { ...RENAL, kcal: 2000, texture: 6 } as CareOrder<'diet'>['value'], DIVYA, {
      keepTargets: { kcal: 2000, protein_g: 60 },
    })
    assert.ok(kept && kept !== 'forbidden' && kept.created)
  })
})
