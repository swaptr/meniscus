import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Admission, CareOrder, DietitianAssignment, Meal, MealKind, Portion, Referral, Staff, StaffRole } from '@meniscus/shared'
import { foodChart, mayAssignDietitian, nutritionStatus, poorMealIntake, routedTo, worklistFor, type WorklistInput } from './nutrition.ts'

const MIN = 60_000
/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

let nextId = 1
const meal = (kind: MealKind, portion: Portion, at: number, o: { fluid?: number; voided?: boolean } = {}): Meal => ({
  id: nextId++,
  admission_id: 11,
  meal: kind,
  portion,
  items: null,
  fluid_ml: o.fluid ?? null,
  source: 'manual',
  confidence: null,
  evidence: null,
  created_at: iso(at),
  recorded_at: iso(at),
  late: false,
  created_by: null,
  entry_id: null,
  entry_status: null,
  voided_at: o.voided ? iso(at + MIN) : null,
  voided_by: null,
  void_reason: o.voided ? 'wrong bed' : null,
  media: null,
  labeled_media: null,
  dishes: [],
  proof: null,
  served_media: null,
  amendments: [],
  amended_at: null,
})
const nbm = (start: number, end: number | null = null): CareOrder => ({
  id: nextId++,
  admission_id: 11,
  kind: 'nil_by_mouth',
  value: { until: null },
  start_at: iso(start),
  end_at: end === null ? null : iso(end),
  set_by: null,
  ended_by: null,
})
const referral = (created: number, over: Partial<Referral> = {}): Referral => ({
  id: nextId++,
  admission_id: 11,
  reason: 'poor_intake',
  note: null,
  status: 'open',
  created_at: iso(created),
  created_by: null,
  acknowledged_at: null,
  acknowledged_by: null,
  closed_at: null,
  closed_by: null,
  outcome: null,
  next_review: null,
  ...over,
})

/** The prompt's message, or null when it is not raised. */
const poor = (meals: Meal[], now: number, o: { orders?: CareOrder[]; referral?: Referral | null } = {}) =>
  poorMealIntake(meals, now, { orders: o.orders ?? [], referral: o.referral ?? null })?.message ?? null
const msg = (parts: string) => `Poor meal intake: the last 3 meals were 50% eaten or less (${parts}). Review.`

const THREE = () => [meal('dinner', 25, nov(2, 19)), meal('breakfast', 50, nov(3, 8)), meal('lunch', 0, nov(3, 13))]

describe('poor meal intake', () => {
  it('[charting/nutrition] Poor meal intake: Three poor meals', () => {
    const alert = poorMealIntake(THREE(), nov(3, 14), { orders: [], referral: null })
    assert.deepEqual(alert, { kind: 'poor_meal_intake', message: msg('dinner 25%, breakfast 50%, lunch 0%') })
  })

  it('[charting/nutrition] Poor meal intake: Exactly half', () => {
    const meals = [meal('dinner', 50, nov(2, 19)), meal('breakfast', 50, nov(3, 8)), meal('lunch', 50, nov(3, 13))]
    assert.equal(poor(meals, nov(3, 14)), msg('dinner 50%, breakfast 50%, lunch 50%'))
  })

  it('[charting/nutrition] Poor meal intake: Two meals', () => {
    assert.equal(poor([meal('breakfast', 0, nov(3, 8)), meal('lunch', 0, nov(3, 13))], nov(3, 14)), null)
  })

  it('[charting/nutrition] Poor meal intake: A better meal breaks the run', () => {
    const meals = [
      meal('breakfast', 25, nov(3, 8)),
      meal('lunch', 75, nov(3, 13)),
      meal('snack', 25, nov(3, 16)),
      meal('dinner', 0, nov(3, 19)),
    ]
    assert.equal(poor(meals, nov(3, 19, 30)), null)
    // Newest first, as the store returns them: the order given does not matter.
    const later = [meal('snack', 25, nov(3, 21)), ...meals.toReversed()]
    assert.equal(poor(later, nov(3, 21)), msg('snack 25%, dinner 0%, snack 25%'))
  })

  it('[charting/nutrition] Poor meal intake: Held while nil by mouth', () => {
    assert.equal(poor(THREE(), nov(3, 14), { orders: [nbm(nov(3, 13, 30))] }), null)
    assert.equal(poor(THREE(), nov(3, 15), { orders: [nbm(nov(3, 13, 30), nov(3, 15))] }), msg('dinner 25%, breakfast 50%, lunch 0%'))
  })
})

describe('meals counted for poor intake', () => {
  it('[charting/nutrition] Meals counted for poor intake: Window edge', () => {
    const today = [meal('breakfast', 0, nov(3, 8)), meal('lunch', 0, nov(3, 13))]
    assert.equal(poor([meal('dinner', 0, nov(2, 14)), ...today], nov(3, 14)), msg('dinner 0%, breakfast 0%, lunch 0%'))
    assert.equal(poor([meal('dinner', 0, nov(2, 13, 59)), ...today], nov(3, 14)), null)
  })

  it('[charting/nutrition] Meals counted for poor intake: Voided meal left out', () => {
    const meals = [
      meal('breakfast', 25, nov(3, 8)),
      meal('lunch', 100, nov(3, 13), { voided: true }),
      meal('snack', 50, nov(3, 16)),
      meal('dinner', 0, nov(3, 19)),
    ]
    assert.equal(poor(meals, nov(3, 20)), msg('breakfast 25%, snack 50%, dinner 0%'))
  })

  it('[charting/nutrition] Meals counted for poor intake: Charted under nil by mouth', () => {
    const orders = [nbm(nov(3, 9), nov(3, 12))]
    const rest = (snackAt: number) => [
      meal('breakfast', 100, nov(3, 8)),
      meal('snack', 0, snackAt),
      meal('lunch', 25, nov(3, 13)),
      meal('snack', 0, nov(3, 13, 30)),
    ]
    assert.equal(poor(rest(nov(3, 10)), nov(3, 14), { orders }), null)
    // At the order's end, excluded: the meal counts.
    assert.equal(poor(rest(nov(3, 12)), nov(3, 14), { orders }), msg('snack 0%, lunch 25%, snack 0%'))
  })

  it('[charting/nutrition] Meals counted for poor intake: Drink-only snack', () => {
    const meals = (fluid?: number) => [
      meal('dinner', 100, nov(2, 19)),
      meal('breakfast', 25, nov(3, 8)),
      meal('snack', 0, nov(3, 10, 30), fluid ? { fluid } : {}),
      meal('lunch', 0, nov(3, 13)),
    ]
    assert.equal(poor(meals(150), nov(3, 14)), null)
    assert.equal(poor(meals(), nov(3, 14)), msg('breakfast 25%, snack 0%, lunch 0%'))
  })
})

describe('prompt while referred (rule)', () => {
  it('holds the prompt while referred, and counts only meals after the close', () => {
    const r = referral(nov(3, 14, 5))
    assert.equal(poor(THREE(), nov(3, 14, 10), { referral: r }), null)
    assert.equal(poor(THREE(), nov(3, 14, 40), { referral: { ...r, status: 'acknowledged', acknowledged_at: iso(nov(3, 14, 30)) } }), null)
    const closed = { ...r, status: 'closed' as const, closed_at: iso(nov(3, 15)), outcome: 'monitoring' as const }
    // A meal at the instant of the close does not count.
    const after = [...THREE(), meal('snack', 0, nov(3, 15)), meal('dinner', 25, nov(3, 19)), meal('snack', 0, nov(3, 21))]
    assert.equal(poor(after, nov(3, 21, 30), { referral: closed }), null)
    assert.equal(
      poor([...after, meal('breakfast', 50, nov(4, 8))], nov(4, 8, 30), { referral: closed }),
      msg('dinner 25%, snack 0%, breakfast 50%'),
    )
  })
})

describe('dietitian worklist (order)', () => {
  const adm = (id: number, ward_id: number, ward_code: string, bed: string): Admission => ({
    id,
    bed,
    patient: `Patient ${id}`,
    weight_kg: 60,
    qr_token: 'x'.repeat(22),
    admitted_at: iso(nov(1, 10)),
    ward_id,
    ward_code,
    ward_name: ward_code,
    mrn: `AT-${id}`,
  })
  it("[charting/nutrition] Dietitian worklist: Sana's worklist", () => {
    const now = nov(3, 15)
    const bed6 = adm(11, 2, '3A', '6')
    const bed7 = adm(12, 2, '3A', '7')
    const c3 = adm(3, 1, '2C', '3')
    const b2 = adm(14, 3, '5B', '2')
    const r = (a: Admission, created: number, over: Partial<Referral> = {}) => ({
      admission: a,
      referral: { ...referral(created, over), admission_id: a.id },
    })
    const rows = [
      r(bed7, nov(2, 10), { status: 'acknowledged', acknowledged_at: iso(nov(2, 11)) }),
      r(c3, nov(3, 14, 30)),
      r(bed6, nov(3, 14, 5)),
      r(b2, nov(2, 12), { status: 'closed', closed_at: iso(nov(2, 13)), outcome: 'monitoring' }),
    ]
    const meals = new Map([
      [
        11,
        [
          { ...meal('dinner', 25, nov(2, 19)), admission_id: 11 },
          { ...meal('breakfast', 50, nov(3, 8)), admission_id: 11 },
          { ...meal('lunch', 0, nov(3, 13)), admission_id: 11 },
          // Before the window, voided, or tea: not counted.
          { ...meal('lunch', 0, nov(2, 13)), admission_id: 11 },
          { ...meal('snack', 0, nov(3, 10), { voided: true }), admission_id: 11 },
          { ...meal('snack', 0, nov(3, 11), { fluid: 150 }), admission_id: 11 },
        ],
      ],
    ])
    const sana = { id: 11, role: 'dietitian' as const, wards: [1, 2, 3, 4].map((id) => ({ id, code: String(id) })) }
    const input = (covered: number[]): WorklistInput => ({
      referrals: rows,
      assignments: new Map(),
      diets: new Map(),
      admissions: new Map(),
      latest: new Map(),
      covered: new Set(covered),
      meals,
      now,
    })
    const w = worklistFor(sana, input([1, 2, 3, 4]))
    assert.equal(w.since, iso(nov(2, 15)))
    assert.deepEqual(
      w.patients.map((p) => p.admission.id),
      [11, 3, 12],
    )
    assert.deepEqual(w.patients[0]!.intake, { meals: 3, poor_meals: 3 })
    assert.deepEqual(w.patients[2]!.intake, { meals: 0, poor_meals: 0 })
    // Wards outside hers are not listed.
    assert.deepEqual(
      worklistFor({ ...sana, wards: [{ id: 1, code: '2C' }] }, input([1])).patients.map((p) => p.admission.id),
      [3],
    )
  })
})

const person = (id: number, role: StaffRole, wards: number[]): Staff => ({
  id,
  name: `Staff ${id}`,
  role,
  wards: wards.map((w) => ({ id: w, code: String(w) })),
})
const assignment = (admission_id: number, staff: Staff): DietitianAssignment => ({
  id: nextId++,
  admission_id,
  staff: { id: staff.id, name: staff.name, role: staff.role },
  assigned_at: iso(nov(3, 9)),
  assigned_by: null,
  ended_at: null,
  ended_by: null,
})
const SANA = person(11, 'dietitian', [1, 2, 3, 4])
const JOEL = person(12, 'dietitian', [2])

describe('routing (pure)', () => {
  it('routes to the assignee first, else the ward pool', () => {
    assert.equal(routedTo(SANA, 2, null), true)
    assert.equal(routedTo(JOEL, 1, null), false)
    const joel = assignment(11, JOEL)
    assert.equal(routedTo(JOEL, 4, joel), true)
    assert.equal(routedTo(SANA, 4, joel), false)
    // Not a dietitian: routed nowhere.
    assert.equal(routedTo(person(4, 'nurse', [2]), 2, null), false)
  })

  it('falls back to the ward pool when the assignee is no longer a dietitian', () => {
    const former = assignment(11, person(12, 'nurse', [2]))
    assert.equal(routedTo(SANA, 2, former), true)
    assert.deepEqual(nutritionStatus(2, new Set(), null, former), { dietitian_available: false, dietitian: null, referral: null })
    assert.equal(nutritionStatus(2, new Set(), null, assignment(11, JOEL)).dietitian_available, true)
  })

  it('lets a decider on the ward, or any dietitian, assign', () => {
    assert.equal(mayAssignDietitian(person(4, 'nurse', [2, 3]), 2), true)
    assert.equal(mayAssignDietitian(person(5, 'nurse', [3, 2]), 4), false)
    assert.equal(mayAssignDietitian(person(10, 'matron', [1, 2, 3, 4]), 4), true)
    assert.equal(mayAssignDietitian(person(1, 'attendant', [2]), 2), false)
    assert.equal(mayAssignDietitian(JOEL, 4), true)
  })
})

describe('worklist sections (pure)', () => {
  const adm = (id: number, ward_id: number, bed: string): Admission => ({
    id,
    bed,
    patient: `Patient ${id}`,
    weight_kg: 60,
    qr_token: 'x'.repeat(22),
    admitted_at: iso(nov(1, 10)),
    ward_id,
    ward_code: String(ward_id),
    ward_name: String(ward_id),
    mrn: `AT-${id}`,
  })
  const diet = (admission_id: number): CareOrder<'diet'> => ({
    id: nextId++,
    admission_id,
    kind: 'diet',
    value: { type: 'regular', texture: 6, kcal: null, protein_g: null },
    start_at: iso(nov(3, 9)),
    end_at: null,
    set_by: null,
    ended_by: null,
  })
  it('lists each patient once, in the first section that applies, by ward then bed', () => {
    const a = {
      referred: adm(1, 1, '3'),
      assignedReferred: adm(2, 1, '4'),
      assigned10: adm(3, 1, '10'),
      assigned2: adm(4, 1, '2'),
      dietHdu: adm(5, 4, '3'),
      diet5b: adm(6, 3, '6'),
      dietJoel: adm(7, 2, '4'),
    }
    const all = new Map(Object.values(a).map((x) => [x.id, x]))
    const input: WorklistInput = {
      referrals: [
        { admission: a.assignedReferred, referral: { ...referral(nov(3, 10)), admission_id: 2 } },
        { admission: a.referred, referral: { ...referral(nov(3, 11)), admission_id: 1 } },
      ],
      assignments: new Map([
        [2, assignment(2, SANA)],
        [3, assignment(3, SANA)],
        [4, assignment(4, SANA)],
        [7, assignment(7, JOEL)],
      ]),
      diets: new Map([5, 6, 7, 3].map((id) => [id, diet(id)])),
      admissions: all,
      latest: new Map(),
      covered: new Set([1, 2, 3, 4]),
      meals: new Map(),
      now: nov(3, 15),
    }
    const w = worklistFor(SANA, input)
    const ids = (ps: { admission: Admission }[]) => ps.map((p) => p.admission.id)
    assert.deepEqual(ids(w.patients), [2, 1])
    assert.deepEqual(ids(w.assigned), [4, 3])
    assert.equal(w.assigned[1]!.diet?.admission_id, 3)
    assert.deepEqual(ids(w.diets), [6, 5])
    const j = worklistFor(JOEL, input)
    assert.deepEqual([ids(j.patients), ids(j.assigned), ids(j.diets)], [[], [7], []])
  })
})

describe('food chart (pure)', () => {
  it('counts three local days, newest first, across local midnight', () => {
    const meals = [
      meal('snack', 50, nov(3, 0, 0)),
      meal('dinner', 100, new Date(2026, 10, 2, 23, 59).getTime()),
      meal('lunch', 25, nov(2, 13), { voided: true }),
      meal('snack', 0, nov(2, 10), { fluid: 150 }),
      meal('breakfast', 0, nov(1, 8)),
      meal('dinner', 0, new Date(2026, 9, 31, 23, 59).getTime()),
    ]
    const { since, days } = foodChart(meals, nov(3, 15))
    assert.equal(since, nov(1, 0))
    assert.deepEqual(days, [
      { date: '2026-11-03', meals: 1, poor_meals: 1 },
      { date: '2026-11-02', meals: 1, poor_meals: 0 },
      { date: '2026-11-01', meals: 1, poor_meals: 1 },
    ])
  })
})
