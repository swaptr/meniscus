/**
 * Races (postgres-store task 8.1): two requests started together with `Promise.all`, each pair giving one outcome, as
 * if the two had run one after the other. Postgres runs READ COMMITTED, so this rests on each write transaction taking
 * the bed (or ward) row lock first; the lock-first guard below checks that from the statements sent. On PGlite (one
 * connection) the transactions serialise anyway; under `PG_TEST_URL` they would contend on the lock. No model request
 * beyond each test's reads.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BagReadingInput, CareOrder, DietitianAssignment } from '@meniscus/shared'
import { createTestDb } from './db/testing.ts'
import { ANITA, RAVI, nov, setup } from './read-fixture.ts'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { testDb } from './testing.ts'

const DIVYA = 8
const SANA = 11
const JOEL = 12
const RENAL = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }
type T = Awaited<ReturnType<typeof setup>>

/** A manual urine-bag reading for `id`, as Ravi. */
const bag = (t: T, id: number, body: Partial<BagReadingInput>) => t.bag(id, { source: 'manual', ...body }, RAVI)

/** The bed's bag readings and urine entries, without ids or times that differ between runs. */
const bagState = async (t: T, id: number) => ({
  readings: (await t.store.bagReadings(id, 0)).map((r) => [r.event, r.volume_ml]),
  entries: (await t.store.entries(id))!.entries.map((e) => [e.category, e.volume_ml, e.status]).sort(),
})

/** A request's JSON body and status through the fixture's app. */
const call = async <B>(t: T, method: string, path: string, body: unknown, staff: number) => {
  const res = await t.request(path, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, { staff })
  return { status: res.status, body: (await res.json()) as B & { error?: string } }
}

describe('races', () => {
  it('[charting/bag-periods] Level fell with no emptying recorded: two readings of one bag at the same instant give one outcome', async () => {
    const A = { event: 'check', volume_ml: 150 } as const
    const B = { event: 'check', volume_ml: 100 } as const
    /** 2C bed 6 checked at 500 mL at 09:00; then `run` at 12:00. */
    /** 2C bed 6 checked at 500 mL at 09:00; then `run` at 12:00: the bed's state and each reading's fall guard. */
    const after = async (run: (t: T, id: number) => Promise<Awaited<ReturnType<typeof bag>>[]>) => {
      const t = await setup()
      const id = await t.bed('2C', '6')
      t.at(nov(3, 9))
      assert.equal((await bag(t, id, { event: 'check', volume_ml: 500 })).status, 201)
      t.at(nov(3, 12))
      const results = await run(t, id)
      const guard = results.map((r) => [r.status, r.body.reading.volume_ml, r.body.reading.fell, r.body.reading.fell_from_ml])
      return JSON.stringify({ ...(await bagState(t, id)), guard: guard.sort() })
    }
    const raced = await after((t, id) => Promise.all([bag(t, id, A), bag(t, id, B)]))
    const ab = await after(async (t, id) => [await bag(t, id, A), await bag(t, id, B)])
    const ba = await after(async (t, id) => [await bag(t, id, B), await bag(t, id, A)])
    // Each fall measured from the reading committed before it: exactly what one order or the other gives.
    assert.ok(raced === ab || raced === ba, JSON.stringify({ raced, ab, ba }))
  })

  it('[charting/bag-periods] Duplicate bag reading: two identical readings at once give one 201 and one 409', async () => {
    const t = await setup()
    const id = await t.bed('3A', '3')
    t.at(nov(3, 10))
    assert.equal((await bag(t, id, { event: 'check', volume_ml: 260 })).status, 201)
    t.at(nov(3, 11))
    const both = await Promise.all([bag(t, id, { event: 'emptied', volume_ml: 380 }), bag(t, id, { event: 'emptied', volume_ml: 380 })])
    assert.deepEqual(both.map((r) => r.status).sort(), [201, 409])
    const refused = both.find((r) => r.status === 409)!
    assert.equal(refused.body.error, 'duplicate_reading')
    const state = await bagState(t, id)
    assert.equal(state.readings.length, 2)
    assert.deepEqual(
      state.entries.filter(([, ml]) => ml === 120),
      [['urine', 120, 'pending']],
    )
  })

  it('[charting/entries] Nurse review: two reviews of one pending entry give one 200 and one 409', async () => {
    const t = await setup()
    const id = await t.bed('3A', '2')
    const e = await t.entry(id, { volume_ml: 450, source: 'manual' })
    assert.equal(e.status, 201)
    const both = await Promise.all([t.approve(e.body.id, { volume_ml: 400 }), t.approve(e.body.id)])
    assert.deepEqual(both.map((r) => r.status).sort(), [200, 409])
    assert.equal(both.find((r) => r.status === 409)!.body.error, 'not_pending')
    const won = both.find((r) => r.status === 200)!.body
    const stored = (await t.store.entries(id))!.entries.find((x) => x.id === e.body.id)!
    assert.deepEqual([stored.status, stored.volume_ml], ['approved', won.volume_ml])
  })

  it('[charting/model-accuracy] Link checks: two posts with one read_id give one link and one 400, never a 500', async () => {
    const t = await setup()
    const id = await t.bed('3A', '1')
    const read = await t.photoRead(id, { container: 'urinal', fluid: 'urine', volume_ml: 450 })
    const before = await t.held(id)
    const both = await Promise.all([t.entry(id, { read_id: read }), t.entry(id, { read_id: read })])
    assert.deepEqual(both.map((r) => r.status).sort(), [201, 400])
    assert.deepEqual(both.find((r) => r.status === 400)!.body.issues, [{ path: 'read_id', message: 'already linked' }])
    assert.deepEqual(await t.held(id), { ...before, entries: before.entries + 1 })
    assert.equal((await t.links(read)).length, 1)
  })

  it('[charting/nutrition] Assign a dietitian: two dietitians assigned at once leave one current assignment', async () => {
    // The demo roster plus Joel Mathew (dietitian, covering 3A).
    const open = async (now: () => number): Promise<Store> => {
      const h = await testDb()
      await (await openPgStore(h.db, { now })).close()
      await h.pg.query("INSERT INTO meniscus.staff (id, name, role) VALUES (12, 'Joel Mathew', 'dietitian')")
      await h.pg.query("INSERT INTO meniscus.staff_ward (staff_id, ward_id, rank) SELECT 12, id, 0 FROM meniscus.ward WHERE code = '3A'")
      return openPgStore(h.db, { now })
    }
    const t = await setup(nov(3, 14), open)
    const id = await t.bed('3A', '6')
    const assign = (staff_id: number, by: number) =>
      call<DietitianAssignment>(t, 'PUT', `/api/admissions/${id}/dietitian`, { staff_id }, by)
    const both = await Promise.all([assign(SANA, ANITA), assign(JOEL, JOEL)])
    for (const r of both) assert.ok(r.status === 200 || r.status === 201, JSON.stringify(r))
    const current = (await t.store.assignmentHistory(id, 50)).filter((a) => a.ended_at === null)
    assert.equal(current.length, 1, JSON.stringify(current))
  })

  it('[charting/care-plan] Diet targets need a dietitian: a texture change racing a target change keeps the targets', async () => {
    const t = await setup(nov(3, 10))
    const id = await t.bed('HDU', '3')
    const put = (body: unknown, staff: number) => call<CareOrder<'diet'>>(t, 'PUT', `/api/admissions/${id}/care/diet`, body, staff)
    assert.equal((await put(RENAL, SANA)).status, 201)
    t.at(nov(3, 11))
    const [nurse, dietitian] = await Promise.all([put({ ...RENAL, texture: 6 }, DIVYA), put({ ...RENAL, kcal: 2000 }, SANA)])
    assert.equal(dietitian.status, 201)
    // First, the nurse's change keeps the targets she saw; second, the targets she sent are no longer current: 403.
    if (nurse.status === 201) assert.deepEqual([nurse.body.value.kcal, nurse.body.value.protein_g], [1800, 60])
    else assert.deepEqual([nurse.status, nurse.body.error], [403, 'forbidden'])
    const active = (await t.store.careOrders(id, t.store.now())).find((o) => o.kind === 'diet' && o.end_at === null)
    assert.equal((active?.value as { kcal?: number } | undefined)?.kcal, 2000)
  })
})

/**
 * The lock-first guard (design §5): in a write transaction that reads before it writes, the first statement is the
 * bed's `FOR NO KEY UPDATE` lock. `sent` is every statement Drizzle sent while the method ran.
 */
export function assertLockFirst(sent: string[], label: string) {
  const isLock = (q: string) => /from "meniscus"\."admission".*for no key update/is.test(q)
  const first = sent.findIndex((q) => !/^(begin|savepoint|commit|release)/i.test(q.trim()))
  assert.ok(first >= 0 && isLock(sent[first]!), `${label}: the bed lock is not the first statement:\n${sent.join('\n')}`)
}

describe('lock-first guard', () => {
  const bagCall = async (skipLock: boolean) => {
    const sent: string[] = []
    const h = await createTestDb((q) => sent.push(q))
    const store = await openPgStore(h.db)
    try {
      const id = (await store.admissions())[0]!.id
      sent.length = 0
      await store.addBagReading(id, { container: 'urine_bag', event: 'check', volume_ml: 300, source: 'manual' }, RAVI)
      // A store whose addBagReading skipped the lock would send the same statements without it.
      return skipLock ? sent.filter((q) => !/for no key update/i.test(q)) : sent
    } finally {
      await store.close()
      await h.close()
    }
  }

  it('addBagReading takes the bed lock before any other statement', async () => {
    assertLockFirst(await bagCall(false), 'addBagReading')
  })

  it('the guard fails on an addBagReading that skips the lock', async () => {
    const sent = await bagCall(true)
    assert.throws(() => assertLockFirst(sent, 'addBagReading without its lock'), /the bed lock is not the first statement/)
  })
})
