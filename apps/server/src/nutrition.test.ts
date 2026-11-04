import assert from 'node:assert/strict'
import { describe, it, type TestContext } from 'node:test'
import type {
  AdmissionSummary,
  DietitianAssignment,
  EntryList,
  Explanation,
  HospitalSummary,
  MealInput,
  NutritionStatus,
  NutritionWorklist,
  Referral,
} from '@meniscus/shared'
import type { TestDb } from './db/testing.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { msg, resp, signIn, testApp, testDb, testStore, upstream } from './testing.ts'

/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

type Body<T> = T & { error?: string; issues?: { path: string; message: string }[] }

/** The store opens, admitting every demo patient, at `openedAt`; the clock then moves with `at`. */
async function setup(openedAt = nov(3, 7), u = upstream(), given?: (clock: { t: number }) => Promise<Store>) {
  const clock = { t: openedAt }
  const store = given ? await given(clock) : await testStore(() => clock.t)
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
  const all = async (query = '') => (await call<AdmissionSummary[]>('GET', `/api/admissions${query}`)).body
  const summary = async (id: number) => (await all()).find((a) => a.id === id)!
  const at = (ms: number) => {
    clock.t = ms
  }
  /** A meal charted at `charted` (by hand, no fluid unless given), posted by Ravi Kumar. */
  const meal = async (id: number, meal: MealInput['meal'], portion: MealInput['portion'], charted: number, o: Partial<MealInput> = {}) => {
    const r = await call<{ id: number }>('POST', `/api/admissions/${id}/meals`, {
      body: { meal, portion, source: 'manual', charted_at: iso(charted), ...o },
      staff: 1,
    })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    return r.body
  }
  const refer = (id: number | string, body: unknown, staff = ANITA) =>
    call<Referral>('POST', `/api/admissions/${id}/referrals`, { body, staff })
  const acknowledge = (id: number | string, staff = SANA) => call<Referral>('POST', `/api/referrals/${id}/acknowledge`, { staff })
  const close = (id: number | string, body: unknown, staff = SANA) => call<Referral>('POST', `/api/referrals/${id}/close`, { body, staff })
  /** GET /api/nutrition/worklist signed in as `staff`, or with no session. */
  const worklist = async (staff: number | null = SANA) =>
    call<NutritionWorklist>('GET', '/api/nutrition/worklist', { cookie: staff === null ? null : await signIn(store, staff) })
  const kinds = async (id: number) => (await summary(id)).alerts.map((a) => a.kind)
  /** Every referral stored for the bed, any status (ids are small and dense in a test store). */
  const referralCount = async (id: number) =>
    (await Promise.all(Array.from({ length: 100 }, (_, i) => store.referral(i + 1)))).filter((r) => r?.admission_id === id).length
  const assign = (id: number | string, staffId: number, staff: number) =>
    call<DietitianAssignment>('PUT', `/api/admissions/${id}/dietitian`, { body: { staff_id: staffId }, staff })
  const handBack = (id: number | string, staff: number) => call<DietitianAssignment>('DELETE', `/api/admissions/${id}/dietitian`, { staff })
  return {
    clock,
    store,
    u,
    call,
    bed,
    list,
    all,
    summary,
    at,
    meal,
    refer,
    acknowledge,
    close,
    worklist,
    kinds,
    referralCount,
    assign,
    handBack,
  }
}

const ANITA = 4
const SANA = 11
const RAVI = 1
const ANITA_REF = { id: 4, name: 'Anita Thomas', role: 'nurse' }
const SANA_REF = { id: 11, name: 'Sana Mirza', role: 'dietitian' }

/** A test database whose store was opened at `openedAt`, then edited with `edit`; `open` reopens the store on it. */
async function editedStore(openedAt: number, edit: (h: TestDb) => Promise<void>) {
  const h = await testDb()
  await openPgStore(h.db, { now: () => openedAt })
  await edit(h)
  return { open: (clock: { t: number }) => openPgStore(h.db, { now: () => clock.t }) }
}
/** Sana Mirza no longer covers 3A. */
const without3A = async (h: TestDb) => {
  await h.pg.query("DELETE FROM meniscus.staff_ward WHERE staff_id = 11 AND ward_id = (SELECT id FROM meniscus.ward WHERE code = '3A')")
}

const NONE: NutritionStatus = { dietitian_available: true, dietitian: null, referral: null }

describe('nutrition status on chart reads', () => {
  it('[charting/nutrition] Nutrition status on chart reads: Ward pool', async () => {
    const t = await setup()
    const id = await t.bed('3A', '6')
    const ward = (await t.store.admission(id))!.ward_id
    const listed = (await t.all(`?ward=${ward}`)).find((a) => a.id === id)!
    assert.deepEqual(listed.nutrition, NONE)
    assert.deepEqual((await t.list(id)).nutrition, NONE)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Nutrition status on chart reads: No dietitian covers the ward', async () => {
    const f = await editedStore(nov(3, 7), without3A)
    const t = await setup(nov(3, 7), upstream(), f.open)
    try {
      const beds = await t.all()
      const of = (code: string) => beds.filter((a) => a.ward_code === code)
      assert.ok(of('3A').length > 0 && of('2C').length > 0)
      for (const a of of('3A')) assert.equal(a.nutrition.dietitian_available, false)
      for (const a of of('2C')) assert.equal(a.nutrition.dietitian_available, true)
      assert.equal((await t.list(await t.bed('3A', '6'))).nutrition.dietitian_available, false)
      assert.deepEqual(t.u.requests, [])
    } finally {
      await t.store.close()
    }
  })
})

describe('poor meal intake on chart reads', () => {
  /** A fresh store opened at 07:00 on 3 Nov; 3A bed 6 charted three poor meals by 09:00, read at 09:30. */
  async function poorBed(u = upstream()) {
    const t = await setup(nov(3, 7), u)
    const id = await t.bed('3A', '6')
    t.at(nov(3, 9, 30))
    await t.meal(id, 'breakfast', 0, nov(3, 8), { items: 'idli, sambar' })
    await t.meal(id, 'snack', 25, nov(3, 8, 30))
    await t.meal(id, 'snack', 0, nov(3, 9))
    return { t, id }
  }

  it('[charting/nutrition] Poor meal intake: Counted on the ward list', async () => {
    const { t, id } = await poorBed()
    const bed = await t.summary(id)
    assert.deepEqual(bed.alerts, [
      {
        kind: 'poor_meal_intake',
        message: 'Poor meal intake: the last 3 meals were 50% eaten or less (breakfast 0%, snack 25%, snack 0%). Review.',
      },
    ])
    const flagged = (await t.call<HospitalSummary>('GET', '/api/wards')).body.wards.map((w) => [w.code, w.beds_with_alerts])
    assert.deepEqual(flagged, [
      ['2C', 0],
      ['3A', 1],
      ['5B', 0],
      ['HDU', 0],
    ])
    assert.deepEqual((await t.list(id)).alerts, bed.alerts)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Poor meal intake: Explained', async () => {
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('The last three meals were mostly left. Review.')])
      },
    })
    const { t, id } = await poorBed(u)
    const res = await t.call<Explanation>('POST', '/api/ai/explain', { body: { admission_id: id } })
    assert.equal(res.status, 200)
    assert.equal(u.requests.length, 1)
    assert.equal(sent.length, 1)
    assert.match(sent[0]!, /poor_meal_intake/)
    assert.ok(!sent[0]!.includes('Priya Iyer'), 'patient name sent upstream')
    assert.ok(!sent[0]!.includes('idli'), 'meal items sent upstream')
  })
})

function captureLogs(t: TestContext) {
  const lines: string[] = []
  for (const m of ['log', 'error', 'warn', 'info'] as const) {
    t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(' ')))
  }
  return lines
}

/** 3A bed 6 with the three poor meals of "Three poor meals", in a store opened at 09:00 on 2 Nov, read at 14:00 on 3 Nov. */
async function threePoor(u = upstream()) {
  const t = await setup(nov(2, 9), u)
  const id = await t.bed('3A', '6')
  t.at(nov(3, 14))
  await t.meal(id, 'dinner', 25, nov(2, 19))
  await t.meal(id, 'breakfast', 50, nov(3, 8))
  await t.meal(id, 'lunch', 0, nov(3, 13))
  return { t, id }
}

describe('refer to a dietitian', () => {
  it('[charting/nutrition] Refer to a dietitian: Nurse refers', async () => {
    const t = await setup(nov(3, 7))
    t.at(nov(3, 14, 5))
    const res = await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })
    assert.equal(res.status, 201)
    const { id, ...rest } = res.body
    assert.ok(Number.isInteger(id))
    assert.deepEqual(rest, {
      admission_id: await t.bed('3A', '6'),
      reason: 'poor_intake',
      note: null,
      status: 'open',
      created_at: iso(nov(3, 14, 5)),
      created_by: ANITA_REF,
      acknowledged_at: null,
      acknowledged_by: null,
      closed_at: null,
      closed_by: null,
      outcome: null,
      next_review: null,
    })
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Refer to a dietitian: Note kept, never logged', async (tc) => {
    const logs = captureLogs(tc)
    const t = await setup(nov(3, 7))
    const res = await t.refer(await t.bed('3A', '5'), { reason: 'other', note: '  Asks for vegetarian meals  ' })
    assert.equal(res.status, 201)
    assert.equal(res.body.note, 'Asks for vegetarian meals')
    assert.equal((await t.summary(await t.bed('3A', '5'))).nutrition.referral?.note, 'Asks for vegetarian meals')
    for (const line of logs) assert.ok(!line.includes('vegetarian'), 'note logged')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Refer to a dietitian: Attendant or dietitian cannot refer', async () => {
    const t = await setup(nov(3, 7))
    const id = await t.bed('3A', '6')
    for (const staff of [RAVI, SANA]) {
      for (const res of [await t.refer(id, { reason: 'poor_intake' }, staff), await t.refer(999, { reason: 'hungry' }, staff)]) {
        assert.deepEqual([res.status, res.body.error], [403, 'forbidden'], String(staff))
      }
    }
    assert.equal(await t.referralCount(id), 0)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Refer to a dietitian: Invalid referrals', async () => {
    const t = await setup(nov(3, 7))
    const id = await t.bed('3A', '6')
    for (const body of [
      { reason: 'hungry' },
      {},
      { reason: 'other', note: '   ' },
      { reason: 'other', note: 'x'.repeat(201) },
      { reason: 'poor_intake', urgent: true },
    ]) {
      const res = await t.refer(id, body)
      assert.deepEqual([res.status, res.body.error], [400, 'invalid_request'], JSON.stringify(body))
    }
    assert.equal(await t.referralCount(id), 0)
    assert.equal((await t.summary(id)).nutrition.referral, null)
  })

  it('[charting/nutrition] Refer to a dietitian: Already referred', async () => {
    const t = await setup(nov(3, 7))
    const id = await t.bed('3A', '6')
    const first = await t.refer(id, { reason: 'poor_intake' })
    assert.equal(first.status, 201)
    const again = await t.refer(id, { reason: 'weight_loss' })
    assert.equal((await t.acknowledge(first.body.id)).status, 200)
    const afterAck = await t.refer(id, { reason: 'weight_loss' })
    for (const res of [again, afterAck]) assert.deepEqual([res.status, res.body.error], [409, 'referral_open'])
    assert.equal(await t.referralCount(id), 1)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Refer to a dietitian: No dietitian available', async () => {
    const f = await editedStore(nov(3, 7), without3A)
    const t = await setup(nov(3, 7), upstream(), f.open)
    try {
      const id = await t.bed('3A', '6')
      const res = await t.refer(id, { reason: 'poor_intake' })
      assert.deepEqual([res.status, res.body.error], [409, 'no_dietitian'])
      assert.equal(await t.referralCount(id), 0)
      assert.deepEqual(t.u.requests, [])
    } finally {
      await t.store.close()
    }
  })

  it('[charting/nutrition] Refer to a dietitian: Unknown admission or no session', async () => {
    const t = await setup(nov(3, 7))
    const unknown = await t.refer(999, { reason: 'poor_intake' })
    const nobody = await t.call('POST', `/api/admissions/${await t.bed('3A', '6')}/referrals`, {
      body: { reason: 'poor_intake' },
      cookie: null,
    })
    assert.deepEqual([unknown.status, unknown.body.error], [404, 'not_found'])
    assert.deepEqual([nobody.status, nobody.body.error], [401, 'sign_in_required'])
    assert.equal(await t.referralCount(await t.bed('3A', '6')), 0)
  })
})

describe('prompt while referred', () => {
  it('[charting/nutrition] Prompt while referred: Referred', async () => {
    const { t, id } = await threePoor()
    assert.ok((await t.kinds(id)).includes('poor_meal_intake'))
    t.at(nov(3, 14, 5))
    const r = await t.refer(id, { reason: 'poor_intake' })
    assert.equal(r.status, 201)
    const bed = await t.summary(id)
    assert.ok(!bed.alerts.some((a) => a.kind === 'poor_meal_intake'))
    assert.equal(bed.nutrition.referral?.status, 'open')
    t.at(nov(3, 14, 30))
    assert.equal((await t.acknowledge(r.body.id)).status, 200)
    assert.ok(!(await t.kinds(id)).includes('poor_meal_intake'))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Prompt while referred: Closed, then poor again', async () => {
    const { t, id } = await threePoor()
    t.at(nov(3, 14, 5))
    const r = await t.refer(id, { reason: 'poor_intake' })
    t.at(nov(3, 14, 30))
    await t.acknowledge(r.body.id)
    t.at(nov(3, 15))
    assert.equal((await t.close(r.body.id, { outcome: 'monitoring' })).status, 200)
    await t.meal(id, 'snack', 0, nov(3, 15))
    assert.ok(!(await t.kinds(id)).includes('poor_meal_intake'))
    t.at(nov(3, 21, 30))
    await t.meal(id, 'dinner', 25, nov(3, 19))
    await t.meal(id, 'snack', 0, nov(3, 21))
    assert.ok(!(await t.kinds(id)).includes('poor_meal_intake'))
    t.at(nov(4, 8, 30))
    await t.meal(id, 'breakfast', 50, nov(4, 8))
    const poor = (await t.summary(id)).alerts.find((a) => a.kind === 'poor_meal_intake')
    assert.equal(poor?.message, 'Poor meal intake: the last 3 meals were 50% eaten or less (dinner 25%, snack 0%, breakfast 50%). Review.')
    assert.deepEqual(t.u.requests, [])
  })
})

describe('referral routing', () => {
  /** The roster also has Joel Mathew (id 12, dietitian), covering 3A. */
  const withJoel = async (h: TestDb) => {
    await h.pg.query("INSERT INTO meniscus.staff (id, name, role) VALUES (12, 'Joel Mathew', 'dietitian')")
    await h.pg.query("INSERT INTO meniscus.staff_ward (staff_id, ward_id, rank) SELECT 12, id, 0 FROM meniscus.ward WHERE code = '3A'")
  }
  const listed = (w: NutritionWorklist) => w.patients.map((p) => `${p.admission.ward_code}-${p.admission.bed}`)

  it('[charting/nutrition] Referral routing: Ward pool', async () => {
    const f = await editedStore(nov(3, 7), withJoel)
    const t = await setup(nov(3, 7), upstream(), f.open)
    try {
      assert.equal((await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })).status, 201)
      assert.deepEqual(listed((await t.worklist(SANA)).body), ['3A-6'])
      assert.deepEqual(listed((await t.worklist(12)).body), ['3A-6'])
      assert.deepEqual(t.u.requests, [])
    } finally {
      await t.store.close()
    }
  })

  it('[charting/nutrition] Referral routing: Another ward', async () => {
    const f = await editedStore(nov(3, 7), withJoel)
    const t = await setup(nov(3, 7), upstream(), f.open)
    try {
      await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })
      t.at(nov(3, 7, 5))
      assert.equal((await t.refer(await t.bed('2C', '3'), { reason: 'diet_query' }, 6)).status, 201)
      assert.deepEqual(listed((await t.worklist(SANA)).body), ['3A-6', '2C-3'])
      assert.deepEqual(listed((await t.worklist(12)).body), ['3A-6'])
    } finally {
      await t.store.close()
    }
  })

  it('[charting/nutrition] Referral routing: Closed', async () => {
    const f = await editedStore(nov(3, 7), withJoel)
    const t = await setup(nov(3, 7), upstream(), f.open)
    try {
      const r = await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })
      assert.equal((await t.close(r.body.id, { outcome: 'no_action_needed' })).status, 200)
      assert.deepEqual(listed((await t.worklist(SANA)).body), [])
      assert.deepEqual(listed((await t.worklist(12)).body), [])
    } finally {
      await t.store.close()
    }
  })
})

describe('acknowledge a referral', () => {
  async function open() {
    const t = await setup(nov(3, 7))
    t.at(nov(3, 14, 5))
    const r = await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })
    assert.equal(r.status, 201)
    return { t, r: r.body }
  }

  it('[charting/nutrition] Acknowledge a referral: Sana acknowledges', async () => {
    const { t, r } = await open()
    t.at(nov(3, 14, 30))
    const res = await t.acknowledge(r.id)
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'acknowledged')
    assert.deepEqual(res.body.acknowledged_by, SANA_REF)
    assert.equal(res.body.acknowledged_at, iso(nov(3, 14, 30)))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Acknowledge a referral: Twice', async () => {
    const { t, r } = await open()
    t.at(nov(3, 14, 30))
    await t.acknowledge(r.id)
    t.at(nov(3, 14, 40))
    const res = await t.acknowledge(r.id)
    assert.deepEqual([res.status, res.body.error], [409, 'not_open'])
    assert.equal((await t.store.referral(r.id))!.acknowledged_at, iso(nov(3, 14, 30)))
  })

  it('[charting/nutrition] Acknowledge a referral: Not a dietitian', async () => {
    const { t, r } = await open()
    for (const res of [await t.acknowledge(r.id, ANITA), await t.acknowledge(999, ANITA)]) {
      assert.deepEqual([res.status, res.body.error], [403, 'forbidden'])
    }
    assert.equal((await t.store.referral(r.id))!.status, 'open')
  })

  it('[charting/nutrition] Acknowledge a referral: Unknown referral', async () => {
    const { t } = await open()
    const res = await t.acknowledge(999)
    assert.deepEqual([res.status, res.body.error], [404, 'not_found'])
  })
})

describe('close a referral', () => {
  it('[charting/nutrition] Close a referral: Supplements started', async () => {
    const t = await setup(nov(3, 7))
    const id = await t.bed('3A', '6')
    t.at(nov(3, 14, 5))
    const r = (await t.refer(id, { reason: 'poor_intake' })).body
    t.at(nov(3, 14, 30))
    await t.acknowledge(r.id)
    t.at(nov(3, 15))
    const res = await t.close(r.id, { outcome: 'supplements_started', next_review: '2026-11-06' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'closed')
    assert.deepEqual(res.body.closed_by, SANA_REF)
    assert.equal(res.body.closed_at, iso(nov(3, 15)))
    assert.equal(res.body.outcome, 'supplements_started')
    assert.equal(res.body.next_review, '2026-11-06')
    assert.deepEqual(res.body.acknowledged_by, SANA_REF)
    assert.deepEqual((await t.summary(id)).nutrition.referral, res.body)
    assert.deepEqual((await t.list(id)).nutrition.referral, res.body)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Close a referral: Closed straight from open', async () => {
    const t = await setup(nov(3, 7))
    const r = (await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })).body
    const res = await t.close(r.id, { outcome: 'no_action_needed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'closed')
    assert.equal(res.body.acknowledged_by, null)
    assert.equal(res.body.next_review, null)
  })

  it('[charting/nutrition] Close a referral: Review date bounds', async () => {
    const t = await setup(nov(3, 7))
    t.at(nov(3, 10))
    const refs = []
    for (const bed of ['5', '6', '7']) refs.push((await t.refer(await t.bed('3A', bed), { reason: 'poor_intake' })).body)
    const [a, b, c] = refs as [Referral, Referral, Referral]
    assert.equal((await t.close(a.id, { outcome: 'monitoring', next_review: '2026-11-03' })).status, 200)
    assert.equal((await t.close(b.id, { outcome: 'monitoring', next_review: '2026-12-01' })).status, 200)
    for (const body of [
      { outcome: 'fed' },
      {},
      { outcome: 'monitoring', next_review: '2026-11-02' },
      { outcome: 'monitoring', next_review: '2026-12-02' },
      { outcome: 'monitoring', next_review: '6/11/2026' },
    ]) {
      const res = await t.close(c.id, body)
      assert.deepEqual([res.status, res.body.error], [400, 'invalid_request'], JSON.stringify(body))
    }
    assert.equal((await t.store.referral(c.id))!.status, 'open')
  })

  it('[charting/nutrition] Close a referral: Unknown referral before the body', async () => {
    const t = await setup(nov(3, 7))
    const res = await t.close(999, { outcome: 'fed' })
    assert.deepEqual([res.status, res.body.error], [404, 'not_found'])
  })

  it('[charting/nutrition] Close a referral: Role checked first', async () => {
    const t = await setup(nov(3, 7))
    const res = await t.close(999, { outcome: 'fed' }, ANITA)
    assert.deepEqual([res.status, res.body.error], [403, 'forbidden'])
  })

  it('[charting/nutrition] Close a referral: Twice or not a dietitian', async () => {
    const t = await setup(nov(3, 7))
    const r = (await t.refer(await t.bed('3A', '6'), { reason: 'poor_intake' })).body
    const other = (await t.refer(await t.bed('3A', '5'), { reason: 'swallowing' })).body
    await t.close(r.id, { outcome: 'monitoring' })
    const twice = await t.close(r.id, { outcome: 'monitoring' })
    const nurse = await t.close(other.id, { outcome: 'monitoring' }, ANITA)
    assert.deepEqual([twice.status, twice.body.error], [409, 'already_closed'])
    assert.deepEqual([nurse.status, nurse.body.error], [403, 'forbidden'])
    assert.equal((await t.store.referral(other.id))!.status, 'open')
  })
})

describe('dietitian worklist', () => {
  it("[charting/nutrition] Dietitian worklist: Sana's worklist", async () => {
    const t = await setup(nov(2, 9))
    const bed = (w: string, n: string) => t.bed(w, n)
    t.at(nov(2, 10))
    const seven = (await t.refer(await bed('3A', '7'), { reason: 'poor_intake' })).body
    t.at(nov(2, 11))
    await t.acknowledge(seven.id)
    t.at(nov(2, 12))
    const fiveB = (await t.refer(await bed('5B', '2'), { reason: 'diet_query' }, 5)).body
    await t.close(fiveB.id, { outcome: 'no_action_needed' })
    t.at(nov(3, 14, 5))
    await t.meal(await bed('3A', '6'), 'dinner', 25, nov(2, 19))
    await t.meal(await bed('3A', '6'), 'breakfast', 50, nov(3, 8))
    await t.meal(await bed('3A', '6'), 'lunch', 0, nov(3, 13))
    await t.refer(await bed('3A', '6'), { reason: 'poor_intake' })
    t.at(nov(3, 14, 30))
    await t.refer(await bed('2C', '3'), { reason: 'swallowing' }, 6)
    t.at(nov(3, 15))
    const res = await t.worklist()
    assert.equal(res.status, 200)
    assert.equal(res.body.since, iso(nov(2, 15)))
    assert.deepEqual(
      res.body.patients.map((p) => [p.admission.ward_code, p.admission.bed]),
      [
        ['3A', '6'],
        ['2C', '3'],
        ['3A', '7'],
      ],
    )
    assert.deepEqual(res.body.patients[0]!.intake, { meals: 3, poor_meals: 3 })
    assert.equal(res.body.patients[0]!.nutrition.dietitian_available, true)
    assert.equal(res.body.patients[2]!.nutrition.referral?.status, 'acknowledged')
    assert.deepEqual([res.body.assigned, res.body.diets], [[], []])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/nutrition] Dietitian worklist: Not a dietitian or nobody signed in', async () => {
    const t = await setup(nov(3, 7))
    const nurse = await t.worklist(ANITA)
    const nobody = await t.worklist(null)
    assert.deepEqual([nurse.status, nurse.body.error], [403, 'forbidden'])
    assert.deepEqual([nobody.status, nobody.body.error], [401, 'sign_in_required'])
  })
})

/** The roster also has Joel Mathew (id 12, dietitian), covering 3A. */
const addJoel = async (h: TestDb) => {
  await h.pg.query("INSERT INTO meniscus.staff (id, name, role) VALUES (12, 'Joel Mathew', 'dietitian')")
  await h.pg.query("INSERT INTO meniscus.staff_ward (staff_id, ward_id, rank) SELECT 12, id, 0 FROM meniscus.ward WHERE code = '3A'")
}
const beds = (ps: { admission: { ward_code: string; bed: string } }[]) => ps.map((p) => `${p.admission.ward_code}-${p.admission.bed}`)

/** A store edited with `edit`, then `fn`, then closed and removed. */
async function withStore(
  edit: (h: TestDb) => Promise<void>,
  fn: (t: Awaited<ReturnType<typeof setup>>) => Promise<void>,
  openedAt = nov(3, 7),
) {
  const f = await editedStore(openedAt, edit)
  const t = await setup(openedAt, upstream(), f.open)
  try {
    await fn(t)
  } finally {
    await t.store.close()
  }
}

describe('assignment on chart reads and routing', () => {
  it('[charting/nutrition] Nutrition status on chart reads: Assigned across wards', () =>
    withStore(without3A, async (t) => {
      const id = await t.bed('3A', '6')
      t.at(nov(3, 14, 40))
      assert.equal((await t.assign(id, SANA, ANITA)).status, 201)
      const ward = (await t.store.admission(id))!.ward_id
      const listedBeds = await t.all(`?ward=${ward}`)
      for (const n of [listedBeds.find((a) => a.id === id)!.nutrition, (await t.list(id)).nutrition]) {
        assert.equal(n.dietitian_available, true)
        assert.deepEqual(n.dietitian?.staff, SANA_REF)
        assert.deepEqual(n.dietitian?.assigned_by, ANITA_REF)
        assert.equal(n.dietitian?.assigned_at, iso(nov(3, 14, 40)))
      }
      for (const a of listedBeds.filter((a) => a.id !== id)) {
        assert.deepEqual([a.nutrition.dietitian_available, a.nutrition.dietitian], [false, null])
      }
      assert.deepEqual(t.u.requests, [])
    }))

  it('[charting/nutrition] Refer to a dietitian: Assigned dietitian available', () =>
    withStore(without3A, async (t) => {
      const id = await t.bed('3A', '6')
      await t.assign(id, SANA, ANITA)
      const r = await t.refer(id, { reason: 'poor_intake' })
      assert.deepEqual([r.status, r.body.status], [201, 'open'])
      const other = await t.refer(await t.bed('3A', '5'), { reason: 'poor_intake' })
      assert.deepEqual([other.status, other.body.error], [409, 'no_dietitian'])
      assert.deepEqual(t.u.requests, [])
    }))

  it('[charting/nutrition] Referral routing: Assigned dietitian first', () =>
    withStore(addJoel, async (t) => {
      const id = await t.bed('3A', '6')
      await t.refer(id, { reason: 'poor_intake' })
      assert.equal((await t.assign(id, 12, 12)).status, 201)
      assert.deepEqual(beds((await t.worklist(12)).body.patients), ['3A-6'])
      assert.deepEqual(beds((await t.worklist(SANA)).body.patients), [])
      assert.equal((await t.handBack(id, 12)).status, 200)
      assert.deepEqual(beds((await t.worklist(12)).body.patients), ['3A-6'])
      assert.deepEqual(beds((await t.worklist(SANA)).body.patients), ['3A-6'])
    }))

  it('[charting/nutrition] Referral routing: Assigned across wards', () =>
    withStore(addJoel, async (t) => {
      const id = await t.bed('HDU', '3')
      await t.refer(id, { reason: 'diet_query' }, 8)
      assert.equal((await t.assign(id, 12, 12)).status, 201)
      assert.deepEqual(beds((await t.worklist(12)).body.patients), ['HDU-3'])
      assert.deepEqual(beds((await t.worklist(SANA)).body.patients), [])
    }))

  it('[charting/nutrition] Dietitian worklist: Your patients and diet orders', () =>
    withStore(
      addJoel,
      async (t) => {
        const bed = (w: string, n: string) => t.bed(w, n)
        t.at(nov(2, 10))
        const seven = (await t.refer(await bed('3A', '7'), { reason: 'poor_intake' })).body
        t.at(nov(2, 11))
        await t.acknowledge(seven.id)
        t.at(nov(3, 14, 5))
        await t.refer(await bed('3A', '6'), { reason: 'poor_intake' })
        t.at(nov(3, 14, 30))
        await t.refer(await bed('2C', '3'), { reason: 'swallowing' }, 6)
        t.at(nov(3, 14, 40))
        await t.assign(await bed('2C', '3'), SANA, SANA)
        await t.assign(await bed('2C', '2'), SANA, SANA)
        const renal = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }
        assert.equal((await t.call('PUT', `/api/admissions/${await bed('HDU', '3')}/care/diet`, { body: renal, staff: SANA })).status, 201)
        assert.equal(
          (await t.call('PUT', `/api/admissions/${await bed('5B', '6')}/care/diet`, { body: { type: 'regular', texture: 6 }, staff: 5 }))
            .status,
          201,
        )
        assert.equal(
          (
            await t.call('PUT', `/api/admissions/${await bed('3A', '4')}/care/diet`, {
              body: { type: 'low_salt', texture: 5 },
              staff: ANITA,
            })
          ).status,
          201,
        )
        await t.assign(await bed('3A', '4'), 12, 12)
        t.at(nov(3, 15))
        const sana = (await t.worklist(SANA)).body
        assert.deepEqual(beds(sana.patients), ['3A-6', '2C-3', '3A-7'])
        assert.deepEqual(beds(sana.assigned), ['2C-2'])
        assert.equal(sana.assigned[0]!.diet, null)
        assert.deepEqual(beds(sana.diets), ['5B-6', 'HDU-3'])
        assert.deepEqual(sana.diets[0]!.diet?.value, { type: 'regular', texture: 6, kcal: null, protein_g: null })
        assert.deepEqual(sana.diets[1]!.diet?.value, renal)
        const joel = (await t.worklist(12)).body
        assert.deepEqual(beds(joel.assigned), ['3A-4'])
        assert.equal(joel.assigned[0]!.diet?.value.type, 'low_salt')
        assert.deepEqual(joel.diets, [])
        assert.ok(![...sana.assigned, ...sana.diets].some((p) => p.admission.ward_code === '3A'))
        assert.deepEqual(t.u.requests, [])
      },
      nov(2, 9),
    ))
})
