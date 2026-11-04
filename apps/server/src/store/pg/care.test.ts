/**
 * Area `care` of the Postgres store, checked for parity with the SQLite store: care orders and catheter reviews,
 * referrals, dietitian assignments and diets. The calls of care.test.ts, diet.test.ts, nutrition*.test.ts and
 * assignment.test.ts run on both stores with one clock; the results are deep-equal. In-process PGlite only; no network.
 */
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import type { CareOrder } from '@meniscus/shared'
import { createTestDb, type TestDb } from '../../db/testing.ts'
import { expected } from './recorded.ts'
import { openPgStore } from './store.ts'

/** What the SQLite store answered to these calls (see recorded.ts). */
const old = expected('care')
const T0 = Date.UTC(2026, 10, 4, 10, 0, 0)
const HOUR = 3_600_000
const handles: TestDb[] = []
after(async () => {
  for (const h of handles) await h.close()
})

async function pair(onQuery?: (q: string, params: unknown[]) => void) {
  let t = T0
  const clock = { now: () => t, set: (ms: number) => (t = ms) }
  const h = await createTestDb(onQuery)
  handles.push(h)
  const pg = await openPgStore(h.db, { now: clock.now })
  const lite = old.session().store
  return { pg, lite, clock, h }
}

const noToken = <T extends { qr_token: string }>(a: T) => ({ ...a, qr_token: '-' })
const RENAL = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 } as unknown as CareOrder<'diet'>['value']
const SANA = 11

describe('postgres store: care orders and catheter reviews', () => {
  it('setCare starts, replaces, keeps and ends orders as the SQLite store does', async () => {
    const { pg, lite, clock } = await pair()
    const id = 3
    const both = async <T>(f: (s: typeof lite | typeof pg) => T | Promise<T>) => {
      const a = await f(pg)
      assert.deepEqual(a, await f(lite))
      return a
    }
    await both((s) => s.setCare(id, 'catheter', { type: 'urethral', inserted_at: new Date(T0 - 48 * HOUR).toISOString() }, 7))
    await both((s) => s.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 7))
    await both((s) => s.setCare(id, 'nil_by_mouth', {}, 7))
    await both((s) => s.setCare(id, 'acuity', { level: 'watch' }, 7))
    clock.set(T0 + HOUR)
    // The same value again changes nothing; a new one ends the old at the same instant.
    await both((s) => s.setCare(id, 'fluid_limit', { ml: 1000, scope: 'total' }, 8))
    await both((s) => s.setCare(id, 'fluid_limit', { ml: 1500, scope: 'oral' }, 8))
    await both((s) => s.setCare(id, 'thickened_fluids', { level: 2 }, 5))
    clock.set(T0 + 2 * HOUR)
    await both((s) => s.endCare(id, 'nil_by_mouth', 6))
    await both((s) => s.endCare(id, 'nil_by_mouth', 6))
    assert.equal(await pg.setCare(999, 'nil_by_mouth', {}, 7), undefined)
    assert.equal(await pg.endCare(999, 'nil_by_mouth', 7), undefined)
    await both((s) => s.careOrders(id, T0))
    await both((s) => s.careOrders(id, T0 + 3 * HOUR))
    await both((s) => s.careHistory(id, 3))
    await both((s) => s.careHistory(id, 50))
    for (const w of [undefined, 1, 2, 999]) await both((s) => s.careOrdersByWard(w, T0))
  })

  it('diet targets: keepTargets refuses a changed or ended target, as the SQLite store does', async () => {
    const { pg, lite } = await pair()
    const id = 5
    const both = async <T>(f: (s: typeof lite | typeof pg) => T | Promise<T>) => {
      const a = await f(pg)
      assert.deepEqual(a, await f(lite))
      return a
    }
    assert.equal(await both((s) => s.setCare(id, 'diet', RENAL, 8, { keepTargets: { kcal: 1, protein_g: null } })), 'forbidden')
    await both((s) => s.setCare(id, 'diet', RENAL, SANA))
    await both((s) => s.setCare(id, 'diet', { ...RENAL, texture: 6 }, 8, { keepTargets: { kcal: 1800, protein_g: 60 } }))
    assert.equal(await both((s) => s.endCare(id, 'diet', 8, { keepTargets: true })), 'forbidden')
    await both((s) => s.setCare(id, 'diet', { ...RENAL, kcal: null, protein_g: null }, SANA))
    await both((s) => s.endCare(id, 'diet', 8, { keepTargets: true }))
    await both((s) => s.setCare(id, 'diet', RENAL, SANA))
    await both((s) => s.setCare(6, 'diet', { ...RENAL, kcal: 2000 }, SANA))
    await both((s) => s.dietHistory(id, 10))
    await both((s) => s.dietHistory(id, 1))
    await both((s) => s.activeDiets([1, 2, 3, 4]))
    await both((s) => s.activeDiets([]))
  })

  it('catheter reviews: once per catheter chain and chart day, with the latest review', async () => {
    const { pg, lite, clock } = await pair()
    const id = 2
    const both = async <T>(f: (s: typeof lite | typeof pg) => T | Promise<T>) => {
      const a = await f(pg)
      assert.deepEqual(a, await f(lite))
      return a
    }
    assert.deepEqual(await both((s) => s.reviewCatheter(id, 4)), { ok: false, error: 'not_found' })
    const first = await both((s) => s.setCare(id, 'catheter', { type: 'urethral', inserted_at: new Date(T0 - 24 * HOUR).toISOString() }, 4))
    const r = await both((s) => s.reviewCatheter(id, 4))
    assert.equal(r.ok, true)
    assert.deepEqual(await both((s) => s.reviewCatheter(id, 5)), { ok: false, error: 'already_reviewed' })
    clock.set(T0 + HOUR)
    // A change of the same catheter (its chain) is reviewed already today.
    const second = await both((s) =>
      s.setCare(id, 'catheter', { type: 'urethral', inserted_at: new Date(T0 - 20 * HOUR).toISOString() }, 4),
    )
    await both((s) => s.reviewCatheter(id, 5))
    clock.set(T0 + 26 * HOUR)
    await both((s) => s.reviewCatheter(id, 5))
    const ids = [first, second].map((x) => (x && x !== 'forbidden' ? x.order.id : 0))
    await both((s) => s.lastReview(ids[0]!))
    await both((s) => s.lastReview(ids[1]!))
    await both((s) => s.lastReview(999))
    await both((s) => s.lastReviewOf(ids))
    await both((s) => s.lastReviewOf([]))
    await both((s) => s.catheterOrders(id))
    for (const w of [undefined, 1, 999]) await both((s) => s.catheterOrdersByWard(w))
  })

  it('setCare locks the bed row before it reads', async () => {
    const sent: string[] = []
    const { pg } = await pair((q) => sent.push(q))
    sent.length = 0
    await pg.setCare(3, 'nil_by_mouth', {}, 7)
    const lock = sent.findIndex((q) => q.includes('from "meniscus"."admission"') && q.includes('for no key update'))
    const read = sent.findIndex((q) => q.includes('from "meniscus"."care_order"'))
    assert.ok(lock >= 0 && read > lock, sent.join('\n'))
  })
})

describe('postgres store: referrals, dietitian assignments', () => {
  it('referrals open, acknowledge and close, with the latest and in-progress lists', async () => {
    const { pg, lite, clock } = await pair()
    const both = async <T>(f: (s: typeof lite | typeof pg) => T | Promise<T>) => {
      const a = await f(pg)
      assert.deepEqual(a, await f(lite))
      return a
    }
    assert.deepEqual(await both((s) => s.refer(999, { reason: 'poor_intake', note: null }, 4)), { ok: false, error: 'not_found' })
    const old = await both((s) => s.refer(1, { reason: 'weight_loss', note: 'Lost weight at home' }, 6))
    assert.ok(old.ok)
    assert.deepEqual(await both((s) => s.refer(1, { reason: 'poor_intake', note: null }, 4)), { ok: false, error: 'referral_open' })
    clock.set(T0 + HOUR)
    await both((s) => s.acknowledgeReferral(old.referral.id, SANA))
    await both((s) => s.acknowledgeReferral(old.referral.id, SANA))
    await both((s) => s.acknowledgeReferral(999, SANA))
    const strip = (rs: Awaited<ReturnType<typeof pg.referralsInProgress>>) => rs.map((r) => ({ ...r, admission: noToken(r.admission) }))
    assert.deepEqual(strip(await pg.referralsInProgress([1, 2, 3, 4])), strip(lite.referralsInProgress([1, 2, 3, 4])))
    clock.set(T0 + 2 * HOUR)
    await both((s) => s.closeReferral(old.referral.id, { outcome: 'supplements_started', next_review: '2026-11-05' }, SANA))
    await both((s) => s.closeReferral(old.referral.id, { outcome: 'no_action_needed', next_review: null }, SANA))
    await both((s) => s.closeReferral(999, { outcome: 'no_action_needed', next_review: null }, SANA))
    await both((s) => s.refer(1, { reason: 'poor_intake', note: null }, 4))
    await both((s) => s.refer(5, { reason: 'diet_query', note: null }, 5))
    await both((s) => s.acknowledgeReferral(old.referral.id, SANA))
    await both((s) => s.referral(old.referral.id))
    assert.equal(await pg.referral(999), undefined)
    await both((s) => s.latestReferral(1))
    await both((s) => s.latestReferral(2))
    for (const w of [undefined, 1, 2, 999]) await both((s) => s.latestReferralsByWard(w))
    const inProgress = await pg.referralsInProgress([1, 2, 3, 4])
    const liteInProgress = lite.referralsInProgress([1, 2, 3, 4])
    assert.equal(inProgress.length, 2)
    assert.deepEqual(strip(inProgress), strip(liteInProgress))
    await both((s) => s.referralsInProgress([]))
    await both((s) => s.referrals(1, 10))
    await both((s) => s.referrals(1, 1))
    await both((s) => s.coveredWards())
  })

  it('assignments: assign, the same again, reassign, hand back, with current and history', async () => {
    const { pg, lite, clock } = await pair()
    const both = async <T>(f: (s: typeof lite | typeof pg) => T | Promise<T>) => {
      const a = await f(pg)
      assert.deepEqual(a, await f(lite))
      return a
    }
    assert.deepEqual(await both((s) => s.assignDietitian(999, SANA, 4)), { ok: false, error: 'not_found' })
    assert.deepEqual(await both((s) => s.handBack(3, 4)), { ok: false, error: 'not_assigned' })
    await both((s) => s.assignDietitian(3, SANA, 4))
    await both((s) => s.assignDietitian(3, SANA, 4))
    clock.set(T0 + HOUR)
    await both((s) => s.assignDietitian(3, 10, 10))
    await both((s) => s.assignDietitian(6, SANA, 8))
    await both((s) => s.refer(3, { reason: 'poor_intake', note: null }, 4))
    clock.set(T0 + 2 * HOUR)
    await both((s) => s.handBack(3, 10))
    await both((s) => s.handBack(3, 10))
    for (const w of [undefined, 1, 2, 999]) await both((s) => s.currentAssignments(w))
    await both((s) => s.assignmentHistory(3, 10))
    await both((s) => s.assignmentHistory(3, 1))
  })
})
