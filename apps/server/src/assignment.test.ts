import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DietitianAssignment, EntryList, NutritionView, NutritionWorklist, Referral, StaffRef } from '@meniscus/shared'
import type { TestDb } from './db/testing.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { signIn, testApp, testDb, upstream } from './testing.ts'

/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const RAVI = 1
const ANITA = 4
const GRACE = 5
const LAKSHMI = 10
const SANA = 11
const JOEL = 12
const ANITA_REF: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
const SANA_REF: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }
const JOEL_REF: StaffRef = { id: 12, name: 'Joel Mathew', role: 'dietitian' }

type Body<T> = T & { error?: string }

/** The roster also has Joel Mathew (id 12, dietitian, `wards` 3A). */
const addJoel = async (h: TestDb) => {
  await h.pg.query("INSERT INTO meniscus.staff (id, name, role) VALUES (12, 'Joel Mathew', 'dietitian')")
  await h.pg.query("INSERT INTO meniscus.staff_ward (staff_id, ward_id, rank) SELECT 12, id, 0 FROM meniscus.ward WHERE code = '3A'")
}
/** Sana Mirza no longer covers 3A, so nobody does. */
const without3A = async (h: TestDb) => {
  await h.pg.query("DELETE FROM meniscus.staff_ward WHERE staff_id = 11 AND ward_id = (SELECT id FROM meniscus.ward WHERE code = '3A')")
}

/** A store opened at 07:00 on 3 Nov, optionally edited with SQL first and reopened, then `fn`. */
async function withStore(fn: (t: Awaited<ReturnType<typeof app>>) => Promise<void>, edit?: (h: TestDb) => Promise<void>) {
  const h = await testDb()
  const clock = { t: nov(3, 7) }
  await openPgStore(h.db, { now: () => clock.t })
  if (edit) await edit(h)
  const t = await app(await openPgStore(h.db, { now: () => clock.t }), clock)
  try {
    await fn(t)
  } finally {
    await t.store.close()
  }
}

async function app(store: Store, clock: { t: number }) {
  const u = upstream()
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
  const assign = (id: number | string, body: unknown, staff: number) =>
    call<DietitianAssignment>('PUT', `/api/admissions/${id}/dietitian`, { body, staff })
  const handBack = (id: number | string, staff: number) => call<DietitianAssignment>('DELETE', `/api/admissions/${id}/dietitian`, { staff })
  const current = async (id: number) => (await call<EntryList>('GET', `/api/admissions/${id}/entries`, { staff: ANITA })).body.nutrition
  const listed = async (id: number) =>
    (await call<{ id: number; nutrition: EntryList['nutrition'] }[]>('GET', '/api/admissions', { staff: ANITA })).body.find(
      (a) => a.id === id,
    )!.nutrition
  const history = async (id: number) =>
    (await call<NutritionView>('GET', `/api/admissions/${id}/nutrition`, { staff: ANITA })).body.assignments
  const worklist = async (staff: number) =>
    (await call<NutritionWorklist>('GET', '/api/nutrition/worklist', { cookie: await signIn(store, staff) })).body
  const at = (ms: number) => {
    clock.t = ms
  }
  return { store, u, call, bed, assign, handBack, current, listed, history, worklist, at }
}

describe('assign a dietitian', () => {
  it('[charting/nutrition] Assign a dietitian: Nurse assigns Sana', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      t.at(nov(3, 14, 40))
      const r = await t.assign(id, { staff_id: SANA }, ANITA)
      assert.equal(r.status, 201)
      assert.deepEqual(r.body.staff, SANA_REF)
      assert.deepEqual(r.body.assigned_by, ANITA_REF)
      assert.equal(r.body.assigned_at, iso(nov(3, 14, 40)))
      assert.deepEqual([r.body.ended_at, r.body.ended_by], [null, null])
      assert.deepEqual((await t.current(id)).dietitian, r.body)
      assert.deepEqual((await t.listed(id)).dietitian, r.body)
      assert.deepEqual(t.u.requests, [])
    }))

  it('[charting/nutrition] Assign a dietitian: Same dietitian again', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      t.at(nov(3, 14, 40))
      const first = await t.assign(id, { staff_id: SANA }, ANITA)
      t.at(nov(3, 14, 50))
      const again = await t.assign(id, { staff_id: SANA }, ANITA)
      assert.equal(again.status, 200)
      assert.deepEqual(again.body, first.body)
      assert.equal((await t.history(id)).length, 1)
    }))

  it('[charting/nutrition] Assign a dietitian: Another dietitian takes over', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      t.at(nov(3, 14, 40))
      const first = await t.assign(id, { staff_id: SANA }, ANITA)
      t.at(nov(3, 15))
      const joel = await t.assign(id, { staff_id: JOEL }, JOEL)
      assert.equal(joel.status, 201)
      assert.deepEqual(joel.body.staff, JOEL_REF)
      const old = (await t.history(id)).find((a) => a.id === first.body.id)!
      assert.equal(old.ended_at, iso(nov(3, 15)))
      assert.deepEqual(old.ended_by, JOEL_REF)
      assert.deepEqual((await t.current(id)).dietitian?.staff, JOEL_REF)
    }, addJoel))

  it('[charting/nutrition] Assign a dietitian: Another dietitian takes over (admission_dietitian keeps one current row)', async () => {
    const h = await testDb()
    const clock = { t: nov(3, 14, 40) }
    await openPgStore(h.db, { now: () => clock.t })
    await addJoel(h)
    const store = await openPgStore(h.db, { now: () => clock.t })
    const id = (await store.admissions()).find((a) => a.ward_code === '3A' && a.bed === '6')!.id
    assert.ok((await store.assignDietitian(id, SANA, ANITA)).ok)
    clock.t = nov(3, 15)
    assert.ok((await store.assignDietitian(id, JOEL, JOEL)).ok)
    await store.close()
    const { rows } = await h.pg.query<{ staff_id: number; ended_at: Date | null; ended_by: number | null }>(
      'SELECT staff_id, ended_at, ended_by FROM meniscus.admission_dietitian WHERE admission_id = $1 ORDER BY id',
      [id],
    )
    // Replaced, not added alongside: the earlier row is ended at the takeover and stays as the audit trail.
    assert.deepEqual(
      rows.map((r) => ({ ...r, ended_at: r.ended_at?.getTime() ?? null })),
      [
        { staff_id: SANA, ended_at: nov(3, 15), ended_by: JOEL },
        { staff_id: JOEL, ended_at: null, ended_by: null },
      ],
    )
    // The partial unique index refuses a second current assignment written past the store.
    await assert.rejects(
      h.pg.query('INSERT INTO meniscus.admission_dietitian (admission_id, staff_id, assigned_at, assigned_by) VALUES ($1, $2, $3, $4)', [
        id,
        SANA,
        new Date(nov(3, 15, 5)),
        ANITA,
      ]),
      /duplicate key value violates unique constraint "admission_dietitian_current"/,
    )
    // An ended row beside the current one is allowed: only `ended_at IS NULL` is unique.
    await h.pg.query(
      'INSERT INTO meniscus.admission_dietitian (admission_id, staff_id, assigned_at, assigned_by, ended_at, ended_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, SANA, new Date(nov(3, 15, 5)), ANITA, new Date(nov(3, 15, 6)), ANITA],
    )
    const current = await h.pg.query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM meniscus.admission_dietitian WHERE admission_id = $1 AND ended_at IS NULL',
      [id],
    )
    assert.equal(current.rows[0]!.n, 1)
  })

  it('[charting/nutrition] Assign a dietitian: Matron and dietitians on any ward', () =>
    withStore(async (t) => {
      assert.equal((await t.assign(await t.bed('HDU', '3'), { staff_id: SANA }, LAKSHMI)).status, 201)
      assert.equal((await t.assign(await t.bed('2C', '3'), { staff_id: SANA }, SANA)).status, 201)
      assert.equal((await t.assign(await t.bed('5B', '2'), { staff_id: JOEL }, JOEL)).status, 201)
    }, addJoel))

  it('[charting/nutrition] Assign a dietitian: Not allowed', () =>
    withStore(async (t) => {
      for (const r of [
        await t.assign(await t.bed('3A', '6'), { staff_id: SANA }, RAVI),
        await t.assign(999, { staff_id: SANA }, RAVI),
        await t.assign(await t.bed('HDU', '3'), { staff_id: SANA }, GRACE),
      ]) {
        assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
      }
      for (const b of [await t.bed('3A', '6'), await t.bed('HDU', '3')]) assert.deepEqual(await t.history(b), [])
    }))

  it('[charting/nutrition] Assign a dietitian: Invalid or unknown', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      const missing = await t.assign(999, { staff_id: SANA }, ANITA)
      assert.deepEqual([missing.status, missing.body.error], [404, 'not_found'])
      for (const body of [{ staff_id: ANITA }, { staff_id: 999 }, {}, { staff_id: '11' }, { staff_id: 11, note: 'renal' }]) {
        const r = await t.assign(id, body, ANITA)
        assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], JSON.stringify(body))
      }
      const grace = await t.assign(999, { staff_id: SANA }, GRACE)
      assert.deepEqual([grace.status, grace.body.error], [404, 'not_found'])
      assert.deepEqual(await t.history(id), [])
      const nobody = await t.call('PUT', `/api/admissions/${id}/dietitian`, { body: { staff_id: SANA }, cookie: null })
      assert.deepEqual([nobody.status, nobody.body.error], [401, 'sign_in_required'])
    }))
})

describe('hand back a patient', () => {
  it('[charting/nutrition] Hand back a patient: Sana hands back', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      await t.assign(id, { staff_id: SANA }, ANITA)
      await t.call<Referral>('POST', `/api/admissions/${id}/referrals`, { body: { reason: 'poor_intake' }, staff: ANITA })
      t.at(nov(3, 16))
      const r = await t.handBack(id, SANA)
      assert.equal(r.status, 200)
      assert.equal(r.body.ended_at, iso(nov(3, 16)))
      assert.deepEqual(r.body.ended_by, SANA_REF)
      const n = await t.current(id)
      assert.equal(n.dietitian, null)
      assert.equal(n.referral?.status, 'open')
      assert.ok((await t.worklist(SANA)).patients.some((p) => p.admission.id === id))
      assert.deepEqual(t.u.requests, [])
    }))

  it('[charting/nutrition] Hand back a patient: Nothing to hand back', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      await t.assign(id, { staff_id: SANA }, ANITA)
      assert.equal((await t.handBack(id, SANA)).status, 200)
      const again = await t.handBack(id, SANA)
      assert.deepEqual([again.status, again.body.error], [409, 'not_assigned'])
    }))

  it('[charting/nutrition] Hand back a patient: Open referral with nobody to take it', () =>
    withStore(async (t) => {
      const id = await t.bed('3A', '6')
      await t.assign(id, { staff_id: SANA }, ANITA)
      const ref = await t.call<Referral>('POST', `/api/admissions/${id}/referrals`, { body: { reason: 'poor_intake' }, staff: ANITA })
      assert.equal(ref.status, 201)
      assert.equal((await t.call('POST', `/api/referrals/${ref.body.id}/acknowledge`, { staff: SANA })).status, 200)
      const refused = await t.handBack(id, SANA)
      assert.deepEqual([refused.status, refused.body.error], [409, 'no_dietitian'])
      assert.deepEqual((await t.current(id)).dietitian?.staff, SANA_REF)
      assert.equal(
        (await t.call('POST', `/api/referrals/${ref.body.id}/close`, { body: { outcome: 'monitoring' }, staff: SANA })).status,
        200,
      )
      assert.equal((await t.handBack(id, SANA)).status, 200)
    }, without3A))

  it('[charting/nutrition] Hand back a patient: Not allowed', () =>
    withStore(async (t) => {
      const id = await t.bed('HDU', '3')
      await t.assign(id, { staff_id: SANA }, SANA)
      for (const staff of [RAVI, GRACE]) {
        const r = await t.handBack(id, staff)
        assert.deepEqual([r.status, r.body.error], [403, 'forbidden'])
      }
      assert.deepEqual((await t.current(id)).dietitian?.staff, SANA_REF)
    }))
})
