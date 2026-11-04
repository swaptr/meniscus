import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type { DietitianAssignment, Meal, NutritionView, Referral, StaffRef } from '@meniscus/shared'
import { applyCare, endConfirmText } from './care.ts'
import { mealRow } from './meals.ts'
import {
  HAND_BACK_CONFIRM,
  assignmentActions,
  closeBody,
  dietitianAction,
  dietitianChoices,
  dietitianLine,
  referralAction,
} from './nutrition.ts'
import {
  bedReviewHref,
  dayRows,
  dietHistory,
  dietLine,
  nutritionViewHref,
  nutritionViewLoad,
  viewReferrals,
  viewTitle,
} from './nutrition-view.ts'
import { createPoll } from './poll.ts'
import { accessGrants, cancelTo, grantAccess, needsReason, reasonBody } from './rota.ts'
import { ANITA, JOEL, MEERA, ROSTER, SANA, fakeServer, memory } from './staff-fixtures.ts'

const at = (d: number, h: number, m = 0, s = 0) => new Date(2026, 10, d, h, m, s).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const ref = (s: StaffRef): StaffRef => ({ id: s.id, name: s.name, role: s.role })
const signal = new AbortController().signal

const meal = (id: number, kind: Meal['meal'], portion: Meal['portion'], t: number): Meal => ({
  labeled_media: null,
  id,
  admission_id: 11,
  meal: kind,
  portion,
  items: null,
  fluid_ml: null,
  source: 'manual',
  confidence: null,
  evidence: null,
  created_at: iso(t),
  recorded_at: iso(t),
  late: false,
  created_by: ref(ANITA),
  entry_id: null,
  entry_status: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  media: null,
  dishes: [],
  proof: null,
  served_media: null,
  amendments: [],
  amended_at: null,
})
const assignment = (staff: StaffRef, by: StaffRef, t: number): DietitianAssignment => ({
  id: 1,
  admission_id: 11,
  staff: ref(staff),
  assigned_at: iso(t),
  assigned_by: ref(by),
  ended_at: null,
  ended_by: null,
})
const OPEN: Referral = {
  id: 5,
  admission_id: 11,
  reason: 'poor_intake',
  note: null,
  status: 'open',
  created_at: iso(at(3, 14, 5)),
  created_by: ref(ANITA),
  acknowledged_at: null,
  acknowledged_by: null,
  closed_at: null,
  closed_by: null,
  outcome: null,
  next_review: null,
}
const CLOSED: Referral = {
  ...OPEN,
  id: 2,
  reason: 'weight_loss',
  note: 'Lost weight at home',
  status: 'closed',
  created_at: iso(at(1, 9)),
  created_by: ref(MEERA),
  acknowledged_at: iso(at(1, 12)),
  acknowledged_by: ref(SANA),
  closed_at: iso(at(1, 17)),
  closed_by: ref(SANA),
  outcome: 'supplements_started',
  next_review: '2026-11-05',
}
const RENAL = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 } as const

/** 3A bed 6, Priya Iyer (admission 11), or HDU bed 3 (admission 21, ward 4). */
const view = (over: Partial<NutritionView> = {}, hdu = false): NutritionView => ({
  admission: {
    id: hdu ? 21 : 11,
    bed: hdu ? '3' : '6',
    patient: hdu ? 'Elena Novak' : 'Priya Iyer',
    weight_kg: 63,
    qr_token: 'x'.repeat(22),
    admitted_at: iso(at(1, 9)),
    ward_id: hdu ? 4 : 2,
    ward_code: hdu ? 'HDU' : '3A',
    ward_name: hdu ? 'Renal HDU' : 'Medical Ward 3A',
    mrn: 'AT-100306',
  },
  nutrition: { dietitian_available: true, dietitian: null, referral: null },
  referrals: [],
  assignments: [],
  diet: null,
  diet_history: [],
  since: iso(at(1, 0)),
  meals: [],
  days: [
    { date: '2026-11-03', meals: 0, poor_meals: 0 },
    { date: '2026-11-02', meals: 0, poor_meals: 0 },
    { date: '2026-11-01', meals: 0, poor_meals: 0 },
  ],
  ...over,
})
const viewRoute = (v: NutritionView) => ({ [`GET /api/admissions/${v.admission.id}/nutrition`]: () => Response.json(v) })

describe('patient nutrition view', () => {
  it("[web/dietitian] Patient nutrition view: Priya's food chart", () => {
    const v = view({
      meals: [meal(3, 'lunch', 0, at(3, 13)), meal(2, 'breakfast', 50, at(3, 8)), meal(1, 'dinner', 25, at(2, 19))],
      days: [
        { date: '2026-11-03', meals: 2, poor_meals: 2 },
        { date: '2026-11-02', meals: 1, poor_meals: 1 },
        { date: '2026-11-01', meals: 0, poor_meals: 0 },
      ],
    })
    assert.equal(viewTitle(v), '3A-6 · Priya Iyer')
    assert.equal(v.admission.ward_name, 'Medical Ward 3A')
    const days = dayRows(v)
    assert.deepEqual(
      days.map((d) => [d.title, d.meals.map((m) => m.meal)]),
      [
        ['Tue 3 Nov · 2 meals · 2 eaten 50% or less', ['lunch', 'breakfast']],
        ['Mon 2 Nov · 1 meal · 1 eaten 50% or less', ['dinner']],
        ['Sun 1 Nov · No meals charted', []],
      ],
    )
    const lunch = mealRow(days[0]!.meals[0]!)
    assert.deepEqual([lunch.time, lunch.meal, lunch.portion, lunch.parts], ['13:00', 'Lunch', 'None', 0])
  })

  it('[web/dietitian] Patient nutrition view: Dietitian, diet and referrals', () => {
    const v = view({
      nutrition: { dietitian_available: true, dietitian: assignment(SANA, ANITA, at(3, 14, 40)), referral: OPEN },
      diet: {
        id: 1,
        admission_id: 11,
        kind: 'diet',
        value: RENAL,
        start_at: iso(at(3, 10)),
        end_at: null,
        set_by: ref(SANA),
        ended_by: null,
      },
      referrals: [OPEN, CLOSED],
    })
    const now = at(3, 15)
    assert.equal(dietitianLine(v.nutrition, v.admission.ward_name, now), 'Dietitian: Sana M. · assigned 14:40 by Anita T.')
    assert.equal(dietLine(v), 'Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein')
    const refs = viewReferrals(v, now)
    assert.deepEqual(refs[0]!.lines, ['Referred 14:05 by Anita T. · Poor intake'])
    assert.deepEqual(refs[1]!.lines, [
      'Referred 1 Nov 09:00 by Meera P. · Weight loss',
      'Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov',
    ])
    assert.equal(refs[1]!.note, 'Lost weight at home')
  })

  describe('refresh', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setInterval', 'Date'], now: at(3, 15) }))
    afterEach(() => mock.timers.reset())

    it('[web/dietitian] Patient nutrition view: Requests', async () => {
      const f = fakeServer({ live: SANA, routes: viewRoute(view()) })
      await f.session.check()
      const before = f.seen.length
      const load = nutritionViewLoad(f.api, 11)
      let visible = true
      await load(signal) // 15:00:00
      const stop = createPoll({ ms: 30_000, paused: () => false, visible: () => visible, tick: () => void load(signal) })
      mock.timers.tick(30_000) // 15:00:30
      await Promise.resolve()
      mock.timers.tick(10_000) // 15:00:40: hidden until 15:02:00
      visible = false
      mock.timers.tick(80_000)
      await Promise.resolve()
      assert.deepEqual(
        f.seen.slice(before).map((s) => s.req),
        ['GET /api/admissions/11/nutrition', 'GET /api/admissions/11/nutrition'],
      )
      assert.ok(!f.reqs().some((r) => r.includes('/api/media') || r.includes('/api/ai')))
      stop()
    })
  })

  it('[web/dietitian] Patient nutrition view: Links', () => {
    assert.equal(bedReviewHref(11), '/n/11')
    assert.equal(nutritionViewHref(SANA, 11), '/d/11')
    assert.equal(nutritionViewHref(ANITA, 11), null)
  })
})

describe("patients outside the dietitian's wards", () => {
  beforeEach(() => mock.timers.enable({ apis: ['setInterval', 'Date'], now: at(3, 10) }))
  afterEach(() => mock.timers.reset())

  it("[web/dietitian] Patients outside the dietitian's wards: Joel opens HDU", async () => {
    const grants = accessGrants(memory())
    const f = fakeServer({
      live: JOEL,
      routes: { ...viewRoute(view({}, true)), 'POST /api/wards/4/access': () => Response.json({ id: 1 }, { status: 201 }) },
    })
    await f.session.check()
    const before = f.seen.length
    const load = nutritionViewLoad(f.api, 21)
    const first = await load(signal)
    const gated = () => needsReason(first.admission.ward_id, JOEL, Date.now(), grants)
    assert.equal(gated(), true)
    const stop = createPoll({ ms: 30_000, paused: gated, visible: () => true, tick: () => void load(signal) })
    mock.timers.tick(60_000) // 10:01
    await Promise.resolve()
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['GET /api/admissions/21/nutrition'],
    )
    assert.deepEqual(await grantAccess(f.api, 4, JOEL.id, reasonBody('Renal diet review', 'joel')!, Date.now(), grants), { ok: true })
    assert.equal(gated(), false)
    await load(signal)
    const sent = f.seen.slice(before)
    assert.deepEqual(
      sent.map((s) => s.req),
      ['GET /api/admissions/21/nutrition', 'POST /api/wards/4/access', 'GET /api/admissions/21/nutrition'],
    )
    assert.equal(sent[1]!.staff, '12')
    stop()
  })

  it("[web/dietitian] Patients outside the dietitian's wards: Cancel", async () => {
    const grants = accessGrants(memory())
    const f = fakeServer({ live: JOEL, routes: viewRoute(view({}, true)) })
    await f.session.check()
    const before = f.seen.length
    await nutritionViewLoad(f.api, 21)(signal)
    assert.equal(cancelTo(true, '/d'), 'back')
    assert.equal(cancelTo(false, '/d'), '/d')
    assert.equal(needsReason(4, JOEL, Date.now(), grants), true)
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['GET /api/admissions/21/nutrition'],
    )
  })

  it("[web/dietitian] Patients outside the dietitian's wards: Assigned is not enough", async () => {
    const grants = accessGrants(memory())
    const f = fakeServer({ live: JOEL, routes: { 'POST /api/wards/4/access': () => Response.json({ id: 1 }, { status: 201 }) } })
    await f.session.check()
    await grantAccess(f.api, 4, JOEL.id, reasonBody('Renal diet review', 'joel')!, at(3, 10), grants)
    const assigned = view(
      { nutrition: { dietitian_available: true, dietitian: assignment(JOEL, JOEL, at(3, 10, 5)), referral: null } },
      true,
    )
    // The next shift (20:00): the assignment does not open the ward.
    assert.equal(assigned.nutrition.dietitian?.staff.id, JOEL.id)
    assert.equal(needsReason(assigned.admission.ward_id, JOEL, at(3, 21), grants), true)
  })

  it("[web/dietitian] Patients outside the dietitian's wards: Own wards", async () => {
    const f = fakeServer({ live: SANA, routes: viewRoute(view({}, true)) })
    await f.session.check()
    await nutritionViewLoad(f.api, 21)(signal)
    assert.equal(needsReason(4, SANA, Date.now(), accessGrants(memory())), false)
    assert.ok(!f.reqs().some((r) => r.includes('/access')))
  })

  it("[web/dietitian] Patients outside the dietitian's wards: Once a shift, both views", async () => {
    const grants = accessGrants(memory())
    const f = fakeServer({ live: JOEL, routes: { 'POST /api/wards/4/access': () => Response.json({ id: 1 }, { status: 201 }) } })
    await f.session.check()
    await grantAccess(f.api, 4, JOEL.id, reasonBody('Renal diet review', 'joel')!, at(3, 10, 15), grants)
    const before = f.seen.length
    // /n/21 reads the same per-ward grant as /d/21.
    assert.equal(needsReason(4, JOEL, at(3, 14), grants), false)
    assert.deepEqual(f.seen.slice(before), [])
  })
})

describe('actions in the patient view', () => {
  const reloadOf = (f: ReturnType<typeof fakeServer>, id: number) => () => nutritionViewLoad(f.api, id)(signal)

  it('[web/dietitian] Referral actions in the patient view: Acknowledge', async () => {
    const f = fakeServer({
      live: SANA,
      routes: { ...viewRoute(view()), 'POST /api/referrals/5/acknowledge': () => Response.json({ ...OPEN, status: 'acknowledged' }) },
    })
    await f.session.check()
    assert.equal(viewReferrals(view({ referrals: [OPEN] }), at(3, 15))[0]!.acknowledge, true)
    const before = f.seen.length
    await referralAction(f.api, { op: 'acknowledge', id: 5 }, () => void reloadOf(f, 11)())
    await new Promise((r) => setTimeout(r, 0))
    const sent = f.seen.slice(before)
    assert.deepEqual(
      sent.map((s) => s.req),
      ['POST /api/referrals/5/acknowledge', 'GET /api/admissions/11/nutrition'],
    )
    assert.equal(sent[0]!.staff, '11')
    assert.ok(!f.reqs().some((r) => r.includes('/api/ai')))
  })

  it('[web/dietitian] Referral actions in the patient view: Close', async () => {
    const f = fakeServer({ live: SANA, routes: { ...viewRoute(view()), 'POST /api/referrals/5/close': () => Response.json(CLOSED) } })
    await f.session.check()
    const before = f.seen.length
    await referralAction(f.api, { op: 'close', id: 5, body: closeBody('monitoring', '')! }, () => void reloadOf(f, 11)())
    await new Promise((r) => setTimeout(r, 0))
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], { req: 'POST /api/referrals/5/close', staff: '11', body: { outcome: 'monitoring' } })
    assert.equal(sent[1]!.req, 'GET /api/admissions/11/nutrition')
  })

  const assignRoutes = (v: NutritionView, del: () => Response = () => Response.json({})) => ({
    ...viewRoute(v),
    'GET /api/staff': () => Response.json([...ROSTER, JOEL]),
    'PUT /api/admissions/11/dietitian': () => Response.json(assignment(SANA, SANA, at(3, 15)), { status: 201 }),
    'DELETE /api/admissions/11/dietitian': del,
  })

  it('[web/dietitian] Assignment from the patient view: Take on', async () => {
    const v = view()
    const f = fakeServer({ live: SANA, routes: assignRoutes(v) })
    await f.session.check()
    assert.equal(assignmentActions(v.nutrition, SANA).takeOn, true)
    const before = f.seen.length
    await dietitianAction(f.api, { op: 'assign', admissionId: 11, staffId: SANA.id }, reloadOf(f, 11))
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], { req: 'PUT /api/admissions/11/dietitian', staff: '11', body: { staff_id: 11 } })
    assert.deepEqual(
      sent.map((s) => s.req),
      ['PUT /api/admissions/11/dietitian', 'GET /api/admissions/11/nutrition'],
    )
  })

  it('[web/dietitian] Assignment from the patient view: Take over', async () => {
    const v = view({ nutrition: { dietitian_available: true, dietitian: assignment(JOEL, ANITA, at(3, 9)), referral: null } })
    const actions = assignmentActions(v.nutrition, SANA)
    assert.deepEqual([actions.takeOn, actions.takeOver, actions.handBack], [false, 'Take over from Joel M.?', false])
    const f = fakeServer({ live: SANA, routes: assignRoutes(v) })
    await f.session.check()
    const before = f.seen.length
    await dietitianAction(f.api, { op: 'assign', admissionId: 11, staffId: SANA.id }, reloadOf(f, 11))
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['PUT /api/admissions/11/dietitian', 'GET /api/admissions/11/nutrition'],
    )
  })

  it('[web/dietitian] Assignment from the patient view: Hand back', async () => {
    let refused = false
    const v = view({ nutrition: { dietitian_available: true, dietitian: assignment(SANA, ANITA, at(3, 9)), referral: OPEN } })
    assert.equal(assignmentActions(v.nutrition, SANA).handBack, true)
    assert.equal(HAND_BACK_CONFIRM, 'Hand back to the ward dietitians?')
    const f = fakeServer({
      live: SANA,
      routes: assignRoutes(v, () => (refused ? Response.json({ error: 'no_dietitian' }, { status: 409 }) : Response.json({}))),
    })
    await f.session.check()
    let before = f.seen.length
    const action = { op: 'handBack', admissionId: 11, wardName: 'Medical Ward 3A' } as const
    await dietitianAction(f.api, action, reloadOf(f, 11))
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['DELETE /api/admissions/11/dietitian', 'GET /api/admissions/11/nutrition'],
    )
    refused = true
    before = f.seen.length
    assert.deepEqual(await dietitianAction(f.api, action, reloadOf(f, 11)), {
      ok: false,
      text: 'No dietitian covers Medical Ward 3A to take the referral.',
    })
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['DELETE /api/admissions/11/dietitian'],
    )
  })

  it('[web/dietitian] Assignment from the patient view: Assign to a colleague', async () => {
    const f = fakeServer({ live: SANA, routes: assignRoutes(view()) })
    await f.session.check()
    const before = f.seen.length
    const choices = dietitianChoices(await f.api.staff(), 2, 'Medical Ward 3A')
    const joel = choices.find((c) => c.id === JOEL.id)!
    await dietitianAction(f.api, { op: 'assign', admissionId: 11, staffId: joel.id }, reloadOf(f, 11))
    const sent = f.seen.slice(before)
    assert.deepEqual(
      sent.map((s) => s.req),
      ['GET /api/staff', 'PUT /api/admissions/11/dietitian', 'GET /api/admissions/11/nutrition'],
    )
    assert.deepEqual(sent[1]!.body, { staff_id: 12 })
  })

  it('[web/dietitian] Diet order from the patient view: Set targets', async () => {
    const v = view({}, true)
    const f = fakeServer({
      live: SANA,
      routes: { ...viewRoute(v), 'PUT /api/admissions/21/care/diet': () => Response.json({}, { status: 201 }) },
    })
    await f.session.check()
    const before = f.seen.length
    await applyCare(f.api, 21, { op: 'set', kind: 'diet', value: RENAL }, reloadOf(f, 21))
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], { req: 'PUT /api/admissions/21/care/diet', staff: '11', body: { ...RENAL } })
    assert.equal(sent[1]!.req, 'GET /api/admissions/21/nutrition')
    assert.equal(sent.length, 2)
  })

  it('[web/dietitian] Diet order from the patient view: History and end', async () => {
    const order = {
      id: 1,
      admission_id: 21,
      kind: 'diet',
      value: RENAL,
      start_at: iso(at(3, 10)),
      end_at: null,
      set_by: ref(SANA),
      ended_by: null,
    } as const
    const v = view({ diet: order, diet_history: [order] }, true)
    assert.deepEqual(dietHistory(v, at(3, 15)), ['Diet renal, IDDSI 7, 1800 kcal, 60 g protein · 10:00–now · set by Sana M.'])
    assert.equal(endConfirmText('diet'), 'End diet?')
    const f = fakeServer({
      live: SANA,
      routes: { ...viewRoute(v), 'DELETE /api/admissions/21/care/diet': () => Response.json({ ...order, end_at: iso(at(3, 15)) }) },
    })
    await f.session.check()
    const before = f.seen.length
    await applyCare(f.api, 21, { op: 'end', kind: 'diet' }, reloadOf(f, 21))
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['DELETE /api/admissions/21/care/diet', 'GET /api/admissions/21/nutrition'],
    )
  })
})
