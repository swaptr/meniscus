import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it, mock } from 'node:test'
import type {
  Admission,
  Alert,
  CareOrder,
  DietitianAssignment,
  Meal,
  NutritionStatus,
  NutritionWorklist,
  Referral,
  StaffRef,
} from '@meniscus/shared'
import { REFERRAL_NOTE_MAX } from '@meniscus/shared'
import { navFor } from '../nav.ts'
import { ALERT_LABEL, ALERT_TONE, STATUS_LABEL, bedTone } from './labels.ts'
import { dishRows } from './dishes.ts'
import { mealRow } from './meals.ts'
import {
  REFERRAL_OUTCOME_LABEL,
  REFERRAL_REASON_LABEL,
  HAND_BACK_CONFIRM,
  WORKLIST_EMPTY,
  WORKLIST_ONLY,
  bedDietitianActions,
  dietitianAction,
  dietitianChoices,
  mayAssignDietitian,
  worklistSections,
  canActOnReferral,
  canRefer,
  closeBody,
  dietitianLine,
  intakeLine,
  isDietitian,
  referBody,
  referralAction,
  referralChip,
  referralLines,
  reviewBounds,
  worklistLoad,
  worklistRows,
} from './nutrition.ts'
import { createPoll } from './poll.ts'
import { offersReferral } from './resolve-rules.ts'
import { ANITA, DIVYA, fakeServer, GRACE, JOEL, LAKSHMI, MEERA, RAVI, ROSTER, SANA, WARD } from './staff-fixtures.ts'
import { VIEW_ONLY, nutritionViewHref, nutritionViewLoad } from './nutrition-view.ts'
import { LANDING } from './staff.ts'
import { bedLoad, wardLoads } from './ward.ts'

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()
const ref = (s: StaffRef) => ({ id: s.id, name: s.name, role: s.role })

const POOR: Alert = {
  kind: 'poor_meal_intake',
  message: 'Poor meal intake: the last 3 meals were 50% eaten or less (breakfast 0%, snack 25%, snack 0%). Review.',
}
const referral = (over: Partial<Referral> = {}): Referral => ({
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
  ...over,
})
const acknowledged = (over: Partial<Referral> = {}) =>
  referral({ status: 'acknowledged', acknowledged_at: iso(at(3, 14, 30)), acknowledged_by: ref(SANA), ...over })
const closed = (over: Partial<Referral> = {}) =>
  referral({ status: 'closed', closed_at: iso(at(3, 15)), closed_by: ref(SANA), outcome: 'monitoring', ...over })
const status = (referral: Referral | null, dietitian_available = true, dietitian: DietitianAssignment | null = null): NutritionStatus => ({
  dietitian_available,
  dietitian,
  referral,
})
const assignment = (staff: StaffRef, by: StaffRef, at: number, over: Partial<DietitianAssignment> = {}): DietitianAssignment => ({
  id: 1,
  admission_id: 11,
  staff: ref(staff),
  assigned_at: iso(at),
  assigned_by: ref(by),
  ended_at: null,
  ended_by: null,
  ...over,
})

const meal = (over: Partial<Meal> = {}): Meal => ({
  labeled_media: null,
  id: 1,
  admission_id: 11,
  meal: 'lunch',
  portion: 50,
  items: 'rice, dal',
  fluid_ml: null,
  source: 'photo',
  confidence: 0.82,
  evidence: null,
  created_at: iso(at(3, 13, 10)),
  recorded_at: iso(at(3, 13, 10)),
  late: false,
  created_by: ref(RAVI),
  entry_id: null,
  entry_status: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  media: {
    id: 41,
    kind: 'photo',
    mime: 'image/png',
    size: 100,
    duration_ms: null,
    created_at: iso(at(3, 13, 10)),
    sha256: null,
    served_meal: null,
  },
  dishes: [],
  proof: null,
  served_media: null,
  amendments: [],
  amended_at: null,
  ...over,
})

/** A bed review's two reads for admission 11, with the given nutrition and meals. */
const bedRoutes = (nutrition: NutritionStatus, meals: Meal[] = [], alerts: Alert[] = []) => ({
  'GET /api/admissions/11/entries': () =>
    Response.json({
      admission: { id: 11, ward_id: 2, ward_code: '3A', ward_name: 'Medical Ward 3A', bed: '6', patient: 'Priya Iyer' },
      entries: [],
      alerts,
      nutrition,
    }),
  'GET /api/admissions/11/meals': () => Response.json(meals),
})

const WORKLIST: NutritionWorklist = {
  since: iso(at(2, 15)),
  patients: [
    {
      admission: {
        id: 11,
        bed: '6',
        patient: 'Priya Iyer',
        weight_kg: 63,
        qr_token: 'x'.repeat(22),
        admitted_at: iso(at(2, 9)),
        ward_id: 2,
        ward_code: '3A',
        ward_name: 'Medical Ward 3A',
        mrn: 'AT-100306',
      },
      nutrition: status(referral()),
      diet: null,
      intake: { meals: 3, poor_meals: 3 },
    },
    {
      admission: {
        id: 12,
        bed: '7',
        patient: 'Hugo Martin',
        weight_kg: 82,
        qr_token: 'y'.repeat(22),
        admitted_at: iso(at(2, 9)),
        ward_id: 2,
        ward_code: '3A',
        ward_name: 'Medical Ward 3A',
        mrn: 'AT-100307',
      },
      nutrition: status(
        referral({
          id: 4,
          admission_id: 12,
          created_at: iso(at(3, 12, 30)),
          status: 'acknowledged',
          acknowledged_at: iso(at(3, 13, 30)),
          acknowledged_by: ref(SANA),
        }),
      ),
      diet: null,
      intake: { meals: 0, poor_meals: 0 },
    },
  ],
  assigned: [],
  diets: [],
}

const admission = (id: number, ward: keyof typeof WARD, wardName: string, bed: string, patient: string): Admission => ({
  id,
  bed,
  patient,
  weight_kg: 70,
  qr_token: 'z'.repeat(22),
  admitted_at: iso(at(2, 9)),
  ward_id: WARD[ward].id,
  ward_code: ward,
  ward_name: wardName,
  mrn: `AT-1${id}`,
})
const dietOrder = (admission_id: number, value: CareOrder<'diet'>['value'], by: StaffRef): CareOrder<'diet'> => ({
  id: 70 + admission_id,
  admission_id,
  kind: 'diet',
  value,
  start_at: iso(at(3, 9)),
  end_at: null,
  set_by: ref(by),
  ended_by: null,
})

describe('nutrition on the bed review', () => {
  it('[web/ward] Nutrition on the bed review: Acknowledged referral', () => {
    const n = status(acknowledged())
    assert.equal(dietitianLine(n, 'Medical Ward 3A'), 'Dietitian: ward dietitians')
    assert.deepEqual(referralLines(n.referral!, at(3, 15)), {
      lines: ['Referred 14:05 by Anita T. · Poor intake · Acknowledged 14:30 · Sana M.'],
      note: null,
    })
  })

  it('[web/ward] Nutrition on the bed review: Closed with an outcome', () => {
    const r = referral({
      reason: 'weight_loss',
      note: 'Lost weight at home',
      created_at: iso(at(1, 9)),
      created_by: ref(MEERA),
      status: 'closed',
      closed_at: iso(at(1, 17)),
      closed_by: ref(SANA),
      outcome: 'supplements_started',
      next_review: '2026-11-05',
    })
    assert.deepEqual(referralLines(r, at(3, 10)), {
      lines: ['Referred 1 Nov 09:00 by Meera P. · Weight loss', 'Closed 1 Nov 17:00 by Sana M. · Supplements started · next review 5 Nov'],
      note: 'Lost weight at home',
    })
  })

  it('[web/ward] Nutrition on the bed review: No dietitian', () => {
    assert.equal(dietitianLine(status(null, false), 'Medical Ward 3A'), 'No dietitian covers Medical Ward 3A')
  })

  it('[web/ward] Nutrition on the bed review: Assigned dietitian', () => {
    assert.equal(
      dietitianLine(status(null, true, assignment(SANA, ANITA, at(3, 14, 40))), 'Medical Ward 3A', at(3, 15)),
      'Dietitian: Sana M. · assigned 14:40 by Anita T.',
    )
    assert.equal(
      dietitianLine(status(null, true, assignment(SANA, ANITA, at(2, 9))), 'Medical Ward 3A', at(3, 15)),
      'Dietitian: Sana M. · assigned 2 Nov 09:00 by Anita T.',
    )
  })

  it('[web/ward] Nutrition on the bed review: Meals in the section', async () => {
    const dishes = [
      { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 },
      { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 50 },
    ] as const
    const f = fakeServer({ live: SANA, routes: bedRoutes(status(null), [meal({ dishes: [...dishes] })]) })
    await f.session.check()
    const bed = await bedLoad(f.api, 11)(new AbortController().signal)
    const row = mealRow(bed.meals[0]!)
    assert.deepEqual([row.time, row.meal, row.portion, row.parts, row.items], ['13:10', 'Lunch', 'Half', 2, 'rice, dal'])
    assert.deepEqual(
      dishRows(bed.meals[0]!).map((d) => d.text),
      ['rice · All', 'dal · Half'],
    )
    assert.ok(!f.reqs().some((r) => r.includes('/api/media')), 'tray photo loaded')
  })

  it('[web/ward] Nutrition on the bed review: No extra request', async () => {
    const dishes = [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 } as const]
    const meals = [meal({ id: 1, dishes }), meal({ id: 2, meal: 'breakfast', dishes }), meal({ id: 3, meal: 'dinner', dishes })]
    const f = fakeServer({ live: ANITA, routes: bedRoutes(status(acknowledged(), true, assignment(SANA, ANITA, at(3, 14, 40))), meals) })
    await f.session.check()
    const before = f.seen.length
    await bedLoad(f.api, 11)(new AbortController().signal)
    assert.deepEqual(
      f.seen
        .slice(before)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
  })
})

describe('referral actions on the bed review', () => {
  it('[web/ward] Referral actions on the bed review: Acknowledge', async () => {
    const f = fakeServer({
      live: SANA,
      routes: { ...bedRoutes(status(referral())), 'POST /api/referrals/5/acknowledge': () => Response.json(acknowledged()) },
    })
    await f.session.check()
    const before = f.seen.length
    assert.equal(canActOnReferral(SANA), true)
    let reloads = 0
    const load = bedLoad(f.api, 11)
    await referralAction(f.api, { op: 'acknowledge', id: 5 }, () => void reloads++)
    await load(new AbortController().signal)
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], { req: 'POST /api/referrals/5/acknowledge', staff: '11', body: null })
    assert.deepEqual(
      sent
        .slice(1)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
    assert.equal(reloads, 1)
    assert.ok(!f.reqs().some((r) => r.includes('/api/ai')))
  })

  it('[web/ward] Referral actions on the bed review: Close', async () => {
    assert.deepEqual(reviewBounds(at(3, 10)), { min: '2026-11-03', max: '2026-12-01' })
    assert.equal(closeBody(null, '2026-11-06'), null)
    assert.deepEqual(closeBody('supplements_started', '2026-11-06'), { outcome: 'supplements_started', next_review: '2026-11-06' })
    assert.deepEqual(closeBody('supplements_started', ''), { outcome: 'supplements_started' })
    assert.deepEqual(Object.values(REFERRAL_OUTCOME_LABEL), ['Diet changed', 'Supplements started', 'Monitoring', 'No action needed'])
    const f = fakeServer({
      live: SANA,
      routes: { ...bedRoutes(status(acknowledged())), 'POST /api/referrals/5/close': () => Response.json(closed()) },
    })
    await f.session.check()
    const before = f.seen.length
    await referralAction(f.api, { op: 'close', id: 5, body: closeBody('supplements_started', '2026-11-06')! }, () => {
      void bedLoad(f.api, 11)(new AbortController().signal)
    })
    await new Promise((r) => setTimeout(r, 0))
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], {
      req: 'POST /api/referrals/5/close',
      staff: '11',
      body: { outcome: 'supplements_started', next_review: '2026-11-06' },
    })
    assert.deepEqual(
      sent
        .slice(1)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
  })

  it('[web/ward] Referral actions on the bed review: Nurse looks', () => {
    for (const s of [ANITA, LAKSHMI]) assert.equal(canActOnReferral(s), false)
    // They still see the referral.
    assert.equal(referralLines(referral(), at(3, 15)).lines[0], 'Referred 14:05 by Anita T. · Poor intake')
  })
})

describe('refer to dietitian', () => {
  it('[web/ward] Refer to dietitian: Anita refers', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        ...bedRoutes(status(null), [], [POOR]),
        'POST /api/admissions/11/referrals': () => Response.json(referral(), { status: 201 }),
      },
    })
    await f.session.check()
    assert.equal(offersReferral(POOR.kind), true)
    assert.equal(canRefer(ANITA, status(null)), true)
    const before = f.seen.length
    await referralAction(f.api, { op: 'refer', admissionId: 11, body: referBody('poor_intake', '')! }, () => {
      void bedLoad(f.api, 11)(new AbortController().signal)
    })
    await new Promise((r) => setTimeout(r, 0))
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0], { req: 'POST /api/admissions/11/referrals', staff: '4', body: { reason: 'poor_intake' } })
    assert.deepEqual(
      sent
        .slice(1)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
    assert.ok(!f.reqs().some((r) => r.includes('/api/ai')))
  })

  it('[web/ward] Refer to dietitian: Reason and note', () => {
    assert.deepEqual(Object.values(REFERRAL_REASON_LABEL), ['Poor intake', 'Weight loss', 'Swallowing', 'Diet query', 'Other'])
    assert.equal(referBody(null, ''), null)
    assert.equal(referBody('other', 'x'.repeat(REFERRAL_NOTE_MAX + 1)), null)
    assert.equal(REFERRAL_NOTE_MAX, 200)
    assert.deepEqual(referBody('other', 'x'.repeat(200)), { reason: 'other', note: 'x'.repeat(200) })
    assert.deepEqual(referBody('other', 'Asks for vegetarian meals'), { reason: 'other', note: 'Asks for vegetarian meals' })
    assert.deepEqual(referBody('other', '   '), { reason: 'other' })
  })

  it('[web/ward] Refer to dietitian: No dietitian available', () => {
    assert.equal(ALERT_LABEL[POOR.kind], 'Poor meal intake')
    assert.equal(STATUS_LABEL[bedTone([POOR], 0)], 'Review')
    // Neither the prompt row nor the Nutrition section offers it: both read canRefer.
    assert.equal(canRefer(ANITA, status(null, false)), false)
  })

  it('[web/ward] Refer to dietitian: Who may refer', () => {
    const n = status(null)
    assert.deepEqual(
      [RAVI, SANA, LAKSHMI].map((s) => canRefer(s, n)),
      [false, false, true],
    )
  })

  it('[web/ward] Refer to dietitian: Already referred', () => {
    assert.equal(canRefer(ANITA, status(referral())), false)
    assert.equal(canRefer(ANITA, status(acknowledged())), false)
    assert.equal(canRefer(ANITA, status(closed())), true)
  })
})

describe('nutrition on bed cards', () => {
  it('[web/ward] Nutrition on bed cards: Referral chip', () => {
    assert.equal(referralChip(status(referral())), 'Referred to dietitian')
    assert.equal(referralChip(status(acknowledged())), 'Referred to dietitian · Sana M.')
    assert.equal(referralChip(status(closed())), null)
    assert.equal(referralChip(status(null)), null)
  })

  it('[web/ward] Nutrition on bed cards: Prompt colour', () => {
    assert.equal(ALERT_LABEL.poor_meal_intake, 'Poor meal intake')
    assert.equal(ALERT_TONE.poor_meal_intake, 'warn')
    // The dashboard card and the bed review's banner read the same tone and status text.
    const tone = bedTone([POOR], 0)
    assert.equal(tone, 'warn')
    assert.equal(STATUS_LABEL[tone], 'Review')
  })

  it('[web/ward] Nutrition on bed cards: No extra request', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        'GET /api/admissions\\?ward=2': () => Response.json([{ id: 11, nutrition: status(acknowledged()) }]),
        'GET /api/wards/2/team': () => Response.json({ ward_id: 2, team: [], assignments: [], in_charge: null }),
      },
    })
    await f.session.check()
    const before = f.seen.length
    const loads = wardLoads(f.api, 2)
    const signal = new AbortController().signal
    await Promise.all([loads.beds(signal), loads.team(signal)])
    assert.deepEqual(
      f.seen
        .slice(before)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions?ward=2', 'GET /api/wards/2/team'],
    )
  })
})

describe('dietitian worklist', () => {
  it("[web/dietitian] Dietitian worklist: Sana's worklist", () => {
    const rows = worklistRows(WORKLIST, at(3, 15))
    assert.deepEqual(
      rows.map((r) => r.title),
      ['3A-6 · Priya Iyer', '3A-7 · Hugo Martin'],
    )
    assert.deepEqual(
      [rows[0]!.referral, rows[0]!.intake],
      ['Referred 14:05 by Anita T. · Poor intake', '3 of 3 meals 50% eaten or less · last 24 h'],
    )
    assert.deepEqual(
      [rows[1]!.referral, rows[1]!.intake],
      ['Referred 12:30 by Anita T. · Poor intake · Acknowledged 13:30 · Sana M.', 'No meals charted · last 24 h'],
    )
    assert.equal(intakeLine({ meals: 3, poor_meals: 2 }), '2 of 3 meals 50% eaten or less · last 24 h')
  })

  it('worklist row peek: referral, diet and intake from the worklist load', () => {
    const row = worklistRows(WORKLIST, at(3, 15))[0]!
    assert.deepEqual(row.peek.lines, [
      'Referred 14:05 by Anita T. · Poor intake',
      'No diet order',
      '3 of 3 meals 50% eaten or less · last 24 h',
    ])
    assert.deepEqual([row.ward, row.bed, row.patient, row.meals, row.poorMeals], ['3A', '6', 'Priya Iyer', 3, 3])
  })

  it('[web/dietitian] Dietitian worklist: Opens the bed review', async () => {
    // The scenario keeps its name; the row now opens the patient nutrition view.
    const f = fakeServer({ live: SANA, routes: { 'GET /api/admissions/11/nutrition': () => Response.json({}) } })
    await f.session.check()
    const row = worklistRows(WORKLIST, at(3, 15))[0]!
    assert.equal(row.href, '/d/11')
    const before = f.seen.length
    await nutritionViewLoad(f.api, row.admissionId)(new AbortController().signal)
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['GET /api/admissions/11/nutrition'],
    )
  })

  it('[web/dietitian] Dietitian worklist: Your patients and diet orders', () => {
    const w: NutritionWorklist = {
      ...WORKLIST,
      assigned: [
        {
          admission: admission(3, '2C', 'General Ward 2C', '3', 'Deepa Rao'),
          nutrition: status(null, true, assignment(SANA, SANA, at(3, 9), { admission_id: 3 })),
          diet: null,
          intake: { meals: 2, poor_meals: 0 },
        },
      ],
      diets: [
        {
          admission: admission(18, '5B', 'Neurology Ward 5B', '6', 'Kofi Mensah'),
          nutrition: status(null),
          diet: dietOrder(18, { type: 'regular', texture: 6, kcal: null, protein_g: null }, GRACE),
          intake: { meals: 0, poor_meals: 0 },
        },
        {
          admission: admission(21, 'HDU', 'Renal HDU', '3', 'Elena Novak'),
          nutrition: status(null),
          diet: dietOrder(21, { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }, SANA),
          intake: { meals: 0, poor_meals: 0 },
        },
      ],
    }
    const secs = worklistSections(w, at(3, 15))
    assert.deepEqual(
      secs.map((x) => x.title),
      ['Referrals', 'Your patients', 'Diet orders'],
    )
    assert.deepEqual(
      [secs[1]!.rows[0]!.title, secs[1]!.rows[0]!.referral, secs[1]!.rows[0]!.intake],
      ['2C-3 · Deepa Rao', 'Assigned 09:00 by Sana M.', '0 of 2 meals 50% eaten or less · last 24 h'],
    )
    assert.deepEqual(
      secs[2]!.rows.map((r) => [r.title, r.referral]),
      [
        ['5B-6 · Kofi Mensah', 'Diet · Regular · IDDSI 6 Soft & bite-sized · set by Grace L.'],
        ['HDU-3 · Elena Novak', 'Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein · set by Sana M.'],
      ],
    )
    assert.deepEqual(
      secs.flatMap((x) => x.rows.map((r) => r.href)),
      ['/d/11', '/d/12', '/d/3', '/d/18', '/d/21'],
    )
  })

  it('[web/dietitian] Dietitian worklist: Nothing to do', () => {
    const empty: NutritionWorklist = { since: WORKLIST.since, patients: [], assigned: [], diets: [] }
    assert.deepEqual(worklistRows(empty, at(3, 15)), [])
    assert.deepEqual(worklistSections(empty, at(3, 15)), [])
    assert.equal(WORKLIST_EMPTY, 'Nothing on your worklist')
    const diets = { ...empty, diets: [{ ...WORKLIST.patients[0]!, nutrition: status(null), diet: null }] }
    assert.deepEqual(
      worklistSections(diets, at(3, 15)).map((x) => x.title),
      ['Diet orders'],
    )
  })

  describe('refresh', () => {
    beforeEach(() => mock.timers.enable({ apis: ['setInterval', 'Date'], now: at(3, 15) }))
    afterEach(() => mock.timers.reset())

    it('[web/dietitian] Dietitian worklist: Requests', async () => {
      const f = fakeServer({ live: SANA, routes: { 'GET /api/nutrition/worklist': () => Response.json(WORKLIST) } })
      await f.session.check()
      const before = f.seen.length
      const load = worklistLoad(f.api)
      await load(new AbortController().signal) // 15:00:00, on open
      const stop = createPoll({ ms: 30_000, paused: () => false, visible: () => true, tick: () => void load(new AbortController().signal) })
      mock.timers.tick(30_000) // 15:00:30
      await Promise.resolve()
      assert.deepEqual(
        f.seen.slice(before).map((s) => s.req),
        ['GET /api/nutrition/worklist', 'GET /api/nutrition/worklist'],
      )
      assert.ok(!f.reqs().some((r) => r.includes('/api/ai')))
      stop()
    })
  })
})

describe('worklist for dietitians only', () => {
  it('[web/dietitian] Worklist for dietitians only: Navigation', () => {
    const nutrition = (s: StaffRef) => navFor(s).find((i) => i.label === 'Nutrition')
    assert.equal(nutrition(SANA)?.to, '/d')
    assert.equal(nutrition(ANITA), undefined)
    assert.equal(nutrition(RAVI), undefined)
  })

  it('[web/dietitian] Worklist for dietitians only: Nurse opens a patient view', async () => {
    const f = fakeServer({ live: ANITA })
    await f.session.check()
    // The page reads the notice and links to the bed review; it starts no nutrition load.
    assert.equal(isDietitian(ANITA), false)
    assert.equal(VIEW_ONLY, 'The nutrition view is for dietitians.')
    assert.equal(nutritionViewHref(ANITA, 11), null)
    assert.deepEqual(f.reqs(), ['GET /api/session'])
  })

  it('[web/dietitian] Worklist for dietitians only: Nurse opens the worklist', async () => {
    const f = fakeServer({ live: ANITA })
    await f.session.check()
    // The page reads the notice and links to her landing page; it starts no worklist load.
    assert.equal(isDietitian(ANITA), false)
    assert.equal(WORKLIST_ONLY, 'The nutrition worklist is for dietitians.')
    assert.equal(LANDING[ANITA.role], '/n')
    assert.deepEqual(f.reqs(), ['GET /api/session'])
  })
})

const STAFF_ROUTE = { 'GET /api/staff': () => Response.json([...ROSTER, JOEL]) }

describe('assign a dietitian from the bed review', () => {
  it('[web/ward] Assign a dietitian from the bed review: Anita assigns Sana', async () => {
    const f = fakeServer({
      live: ANITA,
      routes: {
        ...STAFF_ROUTE,
        ...bedRoutes(status(null)),
        'PUT /api/admissions/11/dietitian': () => Response.json(assignment(SANA, ANITA, at(3, 14, 40)), { status: 201 }),
      },
    })
    await f.session.check()
    assert.deepEqual(bedDietitianActions(ANITA, 2, status(null)), { assign: 'Assign dietitian…', handBack: false })
    const before = f.seen.length
    const roster = await f.api.staff()
    const pick = dietitianChoices(roster, 2, 'Medical Ward 3A')[0]!
    assert.equal(pick.id, 11)
    const r = await dietitianAction(f.api, { op: 'assign', admissionId: 11, staffId: pick.id }, () =>
      bedLoad(f.api, 11)(new AbortController().signal),
    )
    assert.equal(r.ok, true)
    const sent = f.seen.slice(before)
    assert.deepEqual(sent[0]!.req, 'GET /api/staff')
    assert.deepEqual(sent[1], { req: 'PUT /api/admissions/11/dietitian', staff: '4', body: { staff_id: 11 } })
    assert.deepEqual(
      sent
        .slice(2)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
    assert.ok(!f.reqs().some((r) => r.includes('/api/ai')))
  })

  it('[web/ward] Assign a dietitian from the bed review: Dietitians covering the ward first', () => {
    // Joel Mathew covers 3A only; Sana Mirza covers HDU.
    assert.deepEqual(
      dietitianChoices([...ROSTER, JOEL], WARD.HDU.id, 'Renal HDU').map((c) => c.label),
      ['Sana Mirza · covers Renal HDU', 'Joel Mathew'],
    )
  })

  it('[web/ward] Assign a dietitian from the bed review: Hand back', async () => {
    let answer: 'ok' | 'refused' = 'ok'
    const f = fakeServer({
      live: ANITA,
      routes: {
        ...bedRoutes(status(referral(), true, assignment(SANA, ANITA, at(3, 14, 40)))),
        'DELETE /api/admissions/11/dietitian': () =>
          answer === 'ok'
            ? Response.json(assignment(SANA, ANITA, at(3, 14, 40), { ended_at: iso(at(3, 16)), ended_by: ref(ANITA) }))
            : Response.json({ error: 'no_dietitian' }, { status: 409 }),
      },
    })
    await f.session.check()
    assert.equal(HAND_BACK_CONFIRM, 'Hand back to the ward dietitians?')
    assert.deepEqual(bedDietitianActions(ANITA, 2, status(null, true, assignment(SANA, ANITA, at(3, 14, 40)))), {
      assign: 'Change…',
      handBack: true,
    })
    const reload = () => bedLoad(f.api, 11)(new AbortController().signal)
    let before = f.seen.length
    await dietitianAction(f.api, { op: 'handBack', admissionId: 11, wardName: 'Medical Ward 3A' }, reload)
    assert.deepEqual(f.seen[before]!.req, 'DELETE /api/admissions/11/dietitian')
    assert.deepEqual(
      f.seen
        .slice(before + 1)
        .map((s) => s.req)
        .toSorted(),
      ['GET /api/admissions/11/entries', 'GET /api/admissions/11/meals'],
    )
    answer = 'refused'
    before = f.seen.length
    assert.deepEqual(await dietitianAction(f.api, { op: 'handBack', admissionId: 11, wardName: 'Medical Ward 3A' }, reload), {
      ok: false,
      text: 'No dietitian covers Medical Ward 3A to take the referral.',
    })
    assert.deepEqual(
      f.seen.slice(before).map((s) => s.req),
      ['DELETE /api/admissions/11/dietitian'],
    )
  })

  it('[web/ward] Assign a dietitian from the bed review: Who is offered', () => {
    const n = status(null)
    assert.deepEqual(
      [RAVI, GRACE, LAKSHMI, SANA].map((s) => bedDietitianActions(s, WARD['3A'].id, n).assign),
      [null, 'Assign dietitian…', 'Assign dietitian…', 'Assign dietitian…'],
    )
    assert.equal(mayAssignDietitian(GRACE, WARD.HDU.id), false)
    assert.equal(mayAssignDietitian(DIVYA, WARD.HDU.id), true)
    // Everyone sees the line.
    assert.equal(dietitianLine(n, 'Medical Ward 3A'), 'Dietitian: ward dietitians')
  })
})
