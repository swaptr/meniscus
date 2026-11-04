import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  CARE_HISTORY_SHOWN,
  FLUID_LIMIT_RANGE,
  type Admission,
  type AdmissionSummary,
  type Alert,
  type AlertKind,
  type CaptureReadResult,
  type CareKind,
  type CareOrder,
  type CareStatus,
  type CareValues,
  type EntryList,
  type Meal,
  type RecordAlertKind,
  type StaffRef,
} from '@meniscus/shared'
import { outputDevices } from '@meniscus/shared'
import { DIET_KCAL_RANGE, DIET_PROTEIN_RANGE } from '@meniscus/shared'
import { createApi } from './api.ts'
import { balanceNote } from './charts.ts'
import { saveEntry, toEntryInput, type Pending } from './capture.ts'
import { toEvidence } from './evidence.ts'
import { addMissedEntry, chartedAt, saveByHand } from './resolve.ts'
import { ANITA, RAVI, entry } from './audit-fixtures.ts'
import {
  DRAIN_CHOICES,
  STOMA_CHOICES,
  VOIDING_CHOICES,
  mayOrder,
  CARE_ROW,
  DIET_END_TARGETS,
  DIET_TARGETS_FORBIDDEN,
  addableKinds,
  addControl,
  applyCare,
  rowActions,
  targetsLine,
  everyChoice,
  everyChoices,
  everyOf,
  formFrom,
  careInput,
  endConfirmText,
  formDefaults,
  insertedFrom,
  stepMl,
  targetConflict,
  untilFrom,
  bedScreenLoad,
  careBadges,
  careFlags,
  carePlanView,
  consistencyDefault,
  limitCaption,
  limitTone,
  litres,
  mealFlags,
  nbmWarning,
  reviewLine,
  reviewedToday,
  saveLabel,
  seedConsistency,
  targetCaption,
  thinnerNotice,
  withCategory,
} from './care.ts'
import { ALERT_LABEL, ALERT_TONE, STATUS_LABEL, bedTone } from './labels.ts'
import { canDecide } from './staff.ts'
import { bedLoad, wardLoads } from './ward.ts'

const prompt = (kind: Exclude<AlertKind, RecordAlertKind>): Alert => ({ kind, message: `${kind}. Review.` })
const record = (kind: RecordAlertKind): Alert => ({
  kind,
  message: `${kind}. Review.`,
  entry_ids: [1],
  meal_ids: [],
})

describe('care prompts', () => {
  it('[web/ward] Care prompt colours: Worst prompt wins', () => {
    const beds: Alert[][] = [
      [prompt('catheter_review')],
      [prompt('catheter_review'), prompt('fluid_limit_near')],
      [prompt('catheter_review'), record('drink_too_thin')],
      [record('drink_consistency_unrecorded')],
    ]
    assert.deepEqual(
      beds.map((alerts) => STATUS_LABEL[bedTone(alerts, 0)]),
      ['Check', 'Review', 'Review now', 'Review'],
    )
  })

  it('[web/ward] Care prompt colours: Labels', () => {
    assert.deepEqual(
      [
        ALERT_LABEL.nil_by_mouth_intake,
        ALERT_LABEL.drink_too_thin,
        ALERT_LABEL.drink_consistency_unrecorded,
        ALERT_LABEL.fluid_limit_reached,
        ALERT_LABEL.fluid_limit_near,
        ALERT_LABEL.nil_by_mouth_overdue,
        ALERT_LABEL.intake_target_behind,
        ALERT_LABEL.catheter_review,
      ],
      [
        'Intake while NBM',
        'Drink too thin',
        'Consistency not recorded',
        'Fluid limit reached',
        'Near fluid limit',
        'NBM past planned end',
        'Behind intake target',
        'Catheter review',
      ],
    )
  })
})

describe('bag prompts', () => {
  it('[web/ward] Bag prompt colours: Worst prompt wins', () => {
    const beds: Alert[][] = [
      [prompt('bag_reading_due')],
      [prompt('bag_reading_overdue')],
      [prompt('catheter_review'), record('bag_level_fell')],
      [prompt('bag_nearly_full')],
    ]
    assert.deepEqual(
      beds.map((alerts) => STATUS_LABEL[bedTone(alerts, 0)]),
      ['Review', 'Review now', 'Review', 'Review'],
    )
    assert.deepEqual(
      [ALERT_LABEL.bag_reading_overdue, ALERT_LABEL.bag_reading_due, ALERT_LABEL.bag_level_fell, ALERT_LABEL.bag_nearly_full],
      ['Bag reading overdue', 'Bag reading due', 'Bag level fell', 'Bag nearly full'],
    )
    assert.equal(ALERT_TONE.bag_nearly_full, 'warn')
  })

  it('[web/ward] Bag prompt colours: Flagged entry', () => {
    const fell: Alert = {
      kind: 'bag_level_fell',
      message: 'Urine bag level fell from 500 to 150 mL with no emptying recorded. Was it emptied? Review.',
      entry_ids: [41],
      meal_ids: [],
    }
    const pending = entry({ id: 41, direction: 'out', category: 'urine', volume_ml: 150, status: 'pending' })
    assert.deepEqual(careFlags(pending, [fell]), [{ tone: 'warn', text: 'Bag level fell' }])
    assert.deepEqual(careFlags(entry({ id: 42, direction: 'out', category: 'urine' }), [fell]), [])
    // Approve and Reject on the pending card are the nurse's, as for any pending entry.
    assert.equal(canDecide(ANITA), true)
  })
})

// ---------- fixtures: fictional staff and patients, local clocks ----------

const MEERA: StaffRef = { id: 6, name: 'Meera Pillai', role: 'nurse' }
const NIKHIL: StaffRef = { id: 7, name: 'Nikhil Bose', role: 'nurse' }

/** Local time on `day` November 2026 (month 9 is October). */
const on = (day: number, h: number, m = 0, month = 10) => new Date(2026, month, day, h, m)
const iso = (day: number, h: number, m = 0, month = 10) => on(day, h, m, month).toISOString()
/** 3 Nov 2026, 10:00. */
const NOW = on(3, 10).getTime()

let nextOrder = 100
function order<K extends CareKind>(kind: K, value: CareValues[K], over: Partial<Omit<CareOrder, 'kind' | 'value'>> = {}) {
  return {
    id: ++nextOrder,
    admission_id: 21,
    kind,
    value,
    start_at: iso(3, 9),
    end_at: null,
    set_by: MEERA,
    ended_by: null,
    ...over,
  } as Extract<CareOrder, { kind: K }>
}
const NONE: CareStatus = { orders: [], fluid_limit: null, intake_target: null, catheter: null }
const progress = (ml: number, of: number, pending = 0) => ({
  since: iso(3, 8),
  ml,
  pending_ml: pending,
  of_ml: of,
  percent: Math.floor((100 * ml) / of),
})
const limit = (ml: number, of: number, pending = 0, scope: 'oral' | 'total' = 'total') => ({
  ...progress(ml, of, pending),
  scope,
  left_ml: Math.max(0, of - ml),
})

const ADMISSION: Admission = {
  id: 21,
  bed: '3',
  patient: 'Elena Novak',
  weight_kg: 70,
  qr_token: 'tok-hdu-3',
  admitted_at: iso(1, 9),
  ward_id: 4,
  ward_code: 'HDU',
  ward_name: 'Renal HDU',
  mrn: 'AT-100021',
}
const chartOf = (care: CareStatus, history: CareOrder[] = []): EntryList => ({
  admission: ADMISSION,
  entries: [],
  totals: { in_ml: 0, out_ml: 0, balance_ml: 0, pending_ml: 0 },
  alerts: [],
  urine_seen: null,
  care,
  devices: outputDevices(care.orders),
  care_history: history,
  bags: { interval_h: 4, interval_from: 'default', periods: [] },
  acuity: { level: 'stable', source: 'ward', order_id: null, suggested: null, reasons: [] },
  nutrition: { dietitian_available: true, dietitian: null, referral: null },
})

/** Fake server: records "METHOD path", X-Staff-Id and JSON body, and answers from `routes` (404 otherwise). */
function fake(routes: Record<string, (body: unknown) => Response> = {}, staffId: number | null = 7) {
  const calls: string[] = []
  const staff: (string | null)[] = []
  const bodies: unknown[] = []
  const api = createApi(
    (url, init) => {
      const key = `${init?.method ?? 'GET'} ${url}`
      calls.push(key)
      staff.push(new Headers(init?.headers).get('x-staff-id'))
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : (init?.body ?? null))
      const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key))
      return Promise.resolve(hit ? hit[1](bodies.at(-1)) : Response.json({ error: 'not_found' }, { status: 404 }))
    },
    () => staffId,
  )
  return { api, calls, staff, bodies }
}
const signal = new AbortController().signal

/** Every kind at once: the "Every kind" bed. */
const EVERY: CareStatus = {
  orders: [
    order('nil_by_mouth', { until: null }, { start_at: iso(3, 6) }),
    order('thickened_fluids', { level: 2 }),
    order('fluid_limit', { ml: 1500, scope: 'total' }),
    order('intake_target', { ml: 1600 }),
    order('catheter', { type: 'urethral', inserted_at: iso(29, 11, 0, 9), measure_every_h: null }),
  ],
  fluid_limit: limit(1230, 1500),
  intake_target: { ...progress(900, 1600), next_check: { at: iso(3, 14), ml: 800 } },
  catheter: { day: 6, review_due: true, last_review: null },
}

describe('care plan on the bed review', () => {
  it('[web/ward] Care plan on the bed review: Limit and target', () => {
    const care: CareStatus = {
      ...NONE,
      orders: [order('fluid_limit', { ml: 1000, scope: 'total' }), order('intake_target', { ml: 1600 })],
      fluid_limit: limit(820, 1000, 200),
      intake_target: { ...progress(600, 1600), next_check: { at: iso(3, 20), ml: 1200 } },
    }
    assert.equal(care.intake_target!.percent, 37)
    const [lim, target] = care.orders as [Extract<CareOrder, { kind: 'fluid_limit' }>, Extract<CareOrder, { kind: 'intake_target' }>]
    assert.equal(CARE_ROW.fluid_limit(lim, care, NOW), 'Fluid limit · 1000 mL total intake')
    assert.equal(CARE_ROW.intake_target(target, care, NOW), 'Intake target · 1600 mL oral intake')
    assert.equal(limitCaption(care.fluid_limit!, NOW), '820 of 1000 mL today since 08:00 · 82% · 180 mL left · incl. 200 mL pending')
    assert.equal(targetCaption(care.intake_target!, NOW), '600 of 1600 mL today since 08:00 · 37% · next check 20:00: 1200 mL')
    // The section puts each bar under its row, in the order of care.orders.
    assert.deepEqual(
      carePlanView(care, [], NOW).rows.map((r) => [r.text, r.bar?.percent, r.bar?.caption]),
      [
        ['Fluid limit · 1000 mL total intake', 82, '820 of 1000 mL today since 08:00 · 82% · 180 mL left · incl. 200 mL pending'],
        ['Intake target · 1600 mL oral intake', 37, '600 of 1600 mL today since 08:00 · 37% · next check 20:00: 1200 mL'],
      ],
    )
  })

  it('[web/ward] Care plan on the bed review: Limit and target, before 08:00', () => {
    // 07:00 on 3 Nov is still the chart day that began at 08:00 on 2 Nov: the caption dates it, as the prompt does.
    const early = on(3, 7).getTime()
    const since = iso(2, 8)
    const care: CareStatus = {
      ...NONE,
      orders: [order('fluid_limit', { ml: 1000, scope: 'total' }, { start_at: iso(2, 9) })],
      fluid_limit: { ...limit(820, 1000, 200), since },
    }
    const caption = '820 of 1000 mL today since 2 Nov 08:00 · 82% · 180 mL left · incl. 200 mL pending'
    assert.equal(limitCaption(care.fluid_limit!, early), caption)
    assert.equal(carePlanView(care, [], early).rows[0]?.bar?.caption, caption)
    assert.equal(targetCaption({ ...progress(600, 1600), since, next_check: null }, early), '600 of 1600 mL today since 2 Nov 08:00 · 37%')
  })

  it('[web/ward] Care plan on the bed review: Limit bar colours', () => {
    const bars = [790, 800, 1000].map((ml) => limit(ml, 1000))
    assert.deepEqual(bars.map(limitTone), ['neutral', 'warn', 'danger'])
    assert.deepEqual(
      bars.map((p) => limitCaption(p, NOW).split(' · ')[1]),
      ['79%', '80%', '100%'],
    )
  })

  it('[web/ward] Care plan on the bed review: Catheter', () => {
    const cath = order(
      'catheter',
      { type: 'urethral', inserted_at: iso(29, 11, 0, 9), measure_every_h: null },
      { start_at: iso(29, 12, 0, 9), set_by: NIKHIL },
    )
    const review = (at: string) => ({ id: 1, order_id: cath.id, at, by: NIKHIL })
    const care: CareStatus = { ...NONE, orders: [cath], catheter: { day: 6, review_due: true, last_review: review(iso(2, 9, 10)) } }
    assert.equal(CARE_ROW.catheter(cath, care, NOW), 'Urethral catheter · inserted 29 Oct · Catheter day 6')
    assert.equal(reviewLine(care.catheter!.last_review, NOW), 'Last reviewed 2 Nov 09:10 · Nikhil B.')
    assert.equal(reviewedToday(care.catheter!.last_review, NOW), false)
    // Reviewed at 09:10 today: at 10:00 it reads "Reviewed today".
    assert.equal(reviewLine(review(iso(3, 9, 10)), NOW), 'Reviewed today 09:10 · Nikhil B.')
    assert.equal(reviewedToday(review(iso(3, 9, 10)), NOW), true)
    // 07:30 today was before this chart day began at 08:00: still offered.
    assert.equal(reviewLine(review(iso(3, 7, 30)), NOW), 'Last reviewed 07:30 · Nikhil B.')
    assert.equal(reviewedToday(review(iso(3, 7, 30)), NOW), false)
    const row = carePlanView({ ...care, catheter: { ...care.catheter!, last_review: review(iso(3, 7, 30)) } }, [], NOW).rows[0]!
    assert.deepEqual(row.review, { text: 'Last reviewed 07:30 · Nikhil B.', offered: true })
  })

  it('[web/ward] Care plan on the bed review: Catheter, set today', () => {
    // Setting the order counts as that chart day's review, as on the server: "Reviewed today" waits for the next one.
    const offered = (start_at: string) => {
      const cath = order('catheter', { type: 'urethral', inserted_at: iso(29, 11, 0, 9), measure_every_h: null }, { start_at })
      const care: CareStatus = { ...NONE, orders: [cath], catheter: { day: 6, review_due: false, last_review: null } }
      return carePlanView(care, [], NOW).rows[0]?.review
    }
    assert.deepEqual(offered(iso(3, 9)), { text: 'No review recorded', offered: false })
    // 07:00 today was in the previous chart day, so today's review is due.
    assert.deepEqual(offered(iso(3, 7)), { text: 'No review recorded', offered: true })
    assert.deepEqual(offered(iso(2, 9)), { text: 'No review recorded', offered: true })
  })

  it('[web/ward] Care plan on the bed review: Nil by mouth and thickened fluids', () => {
    const nbm = order('nil_by_mouth', { until: iso(3, 14) }, { start_at: iso(3, 6) })
    const thick = order('thickened_fluids', { level: 2 })
    const care: CareStatus = { ...NONE, orders: [nbm, thick] }
    assert.deepEqual(
      carePlanView(care, [], NOW).rows.map((r) => r.text),
      ['Nil by mouth · since 06:00 · until 14:00', 'Thickened fluids · IDDSI 2 Mildly thick'],
    )
    const open = order('nil_by_mouth', { until: null }, { start_at: iso(3, 6) })
    assert.equal(CARE_ROW.nil_by_mouth(open, { ...NONE, orders: [open] }, NOW), 'Nil by mouth · since 06:00 · no planned end')
  })

  it('[web/ward] Care plan on the bed review: History', () => {
    const history = [
      order('nil_by_mouth', { until: iso(3, 16) }, { start_at: iso(3, 9) }),
      order('nil_by_mouth', { until: iso(3, 14) }, { start_at: iso(3, 6), end_at: iso(3, 9), ended_by: MEERA }),
    ]
    assert.deepEqual(carePlanView({ ...NONE, orders: [history[0]!] }, history, NOW).history, [
      'Nil by mouth until 16:00 · 09:00–now · set by Meera P.',
      'Nil by mouth until 14:00 · 06:00–09:00 · set by Meera P. · ended by Meera P.',
    ])
    // The newest CARE_HISTORY_SHOWN (10) first; "Show all" shows the rest.
    const long = Array.from({ length: 12 }, (_, i) =>
      order('intake_target', { ml: 1000 + 50 * i }, { start_at: iso(2, 20 - i), end_at: iso(2, 21 - i) }),
    )
    const shown = carePlanView(NONE, long, NOW)
    assert.equal(shown.history.length, CARE_HISTORY_SHOWN)
    assert.equal(shown.more, 2)
    assert.equal(carePlanView(NONE, long, NOW, true).history.length, 12)
  })

  it('[web/ward] Care plan on the bed review: Nothing ordered', () => {
    assert.deepEqual(carePlanView(NONE, [], NOW), { empty: 'No care orders', rows: [], history: [], more: 0 })
  })

  it('[web/ward] Care plan on the bed review: No extra request', async () => {
    const f = fake({
      'GET /api/admissions/21/entries': () => Response.json(chartOf(EVERY, EVERY.orders)),
      'GET /api/admissions/21/meals': () => Response.json([]),
    })
    const bed = await bedLoad(f.api, 21)(signal)
    assert.equal(carePlanView(bed.care, bed.care_history, NOW).rows.length, 5)
    assert.deepEqual(f.calls, ['GET /api/admissions/21/entries', 'GET /api/admissions/21/meals'])
  })
})

describe('care badges', () => {
  it('[web/ward] Care badges on bed cards: Every kind', () => {
    assert.deepEqual(careBadges(EVERY), ['NBM', 'IDDSI 2', 'Limit 1.5 L · 82%', 'Target 900/1600 mL', 'Catheter day 6'])
  })

  it('[web/ward] Care badges on bed cards: Litres', () => {
    assert.deepEqual([1000, 1500, 1250].map(litres), ['1', '1.5', '1.25'])
    const one = (ml: number, counted: number): CareStatus => ({
      ...NONE,
      orders: [order('fluid_limit', { ml, scope: 'total' })],
      fluid_limit: limit(counted, ml),
    })
    assert.deepEqual(careBadges(one(1000, 820)), ['Limit 1 L · 82%'])
    assert.deepEqual(careBadges(one(1250, 500)), ['Limit 1.25 L · 40%'])
  })

  it('[web/ward] Care badges on bed cards: No extra request', async () => {
    const summary = {
      ...ADMISSION,
      totals: chartOf(EVERY).totals,
      pending: 0,
      alerts: [],
      urine_seen: null,
      care: EVERY,
      devices: chartOf(EVERY).devices,
      acuity: chartOf(EVERY).acuity,
      nutrition: chartOf(EVERY).nutrition,
    }
    const beds: AdmissionSummary[] = [{ ...summary, hourly: { in_ml: [], out_ml: [], in_logged: [] } }]
    const f = fake({
      'GET /api/admissions\\?ward=3': () => Response.json(beds),
      'GET /api/wards/3/team': () => Response.json({ ward_id: 3, shift_start: iso(3, 8), in_charge: null, team: [], assignments: [] }),
    })
    const load = wardLoads(f.api, 3)
    const [list] = await Promise.all([load.beds(signal), load.team(signal)])
    assert.deepEqual(careBadges(list[0]!.care), ['NBM', 'IDDSI 2', 'Limit 1.5 L · 82%', 'Target 900/1600 mL', 'Catheter day 6'])
    assert.deepEqual(f.calls, ['GET /api/admissions?ward=3', 'GET /api/wards/3/team'])
  })
})

const meal = (over: Partial<Meal> = {}): Meal => ({
  labeled_media: null,
  id: 12,
  admission_id: 21,
  meal: 'lunch',
  portion: 50,
  items: 'rice, dal',
  fluid_ml: null,
  source: 'manual',
  confidence: null,
  evidence: null,
  created_at: iso(3, 12),
  recorded_at: iso(3, 12),
  late: false,
  created_by: null,
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
  ...over,
})
const flagged = (kind: RecordAlertKind, entry_ids: number[], meal_ids: number[] = []): Alert => ({
  kind,
  message: `${kind}. Review.`,
  entry_ids,
  meal_ids,
})
const texts = (bs: { text: string }[]) => bs.map((b) => b.text)

describe('care flags', () => {
  it('[web/ward] Care flags on entries and meals: Drink while fasting', () => {
    const drink = entry({ id: 31, volume_ml: 150, status: 'pending' })
    const alerts = [flagged('nil_by_mouth_intake', [31])]
    assert.deepEqual(texts(careFlags(drink, alerts)), ['During NBM'])
    // Anita Thomas (nurse) still approves or rejects it as before.
    assert.equal(canDecide(ANITA), true)
    assert.deepEqual(careFlags(entry({ id: 32 }), alerts), [])
  })

  it('[web/ward] Care flags on entries and meals: Thin drink', () => {
    const thin = entry({ id: 41, status: 'approved', iddsi_level: 0 })
    const jug = entry({ id: 42, status: 'approved', source: 'photo', iddsi_level: null })
    const right = entry({ id: 43, status: 'approved', iddsi_level: 2 })
    const alerts = [flagged('drink_too_thin', [41]), flagged('drink_consistency_unrecorded', [42])]
    assert.deepEqual(
      [thin, jug, right].map((e) => texts(careFlags(e, alerts))),
      [['IDDSI 0', 'Thinner than ordered'], ['Consistency not recorded'], ['IDDSI 2']],
    )
  })

  it('[web/ward] Care flags on entries and meals: Lunch while fasting', () => {
    const alerts = [flagged('nil_by_mouth_intake', [], [12])]
    assert.deepEqual(texts(mealFlags(meal(), alerts)), ['During NBM'])
    assert.deepEqual(mealFlags(meal({ id: 13 }), alerts), [])
  })
})

describe('care at the bed', () => {
  it('[web/capture] Care orders at the bed: Fasting stroke patient', async () => {
    const care: CareStatus = {
      ...NONE,
      orders: [order('nil_by_mouth', { until: null }, { start_at: iso(3, 6) }), order('thickened_fluids', { level: 2 })],
    }
    assert.deepEqual(careBadges(care), ['NBM', 'IDDSI 2'])
    const f = fake({
      'GET /api/beds/tok-2c-1': () => Response.json(ADMISSION),
      'GET /api/admissions/21/entries': () => Response.json(chartOf(care)),
    })
    const bed = await bedScreenLoad(f.api, 'tok-2c-1')(signal)
    assert.deepEqual(careBadges(bed.care), ['NBM', 'IDDSI 2'])
    assert.deepEqual(f.calls, ['GET /api/beds/tok-2c-1', 'GET /api/admissions/21/entries'])
  })
})

describe('changing care', () => {
  it('[web/ward] Change care orders from the bed review: Add a fluid limit', async () => {
    // Nikhil Bose (id 7) on HDU bed 3 (admission 21).
    const f = fake({
      'PUT /api/admissions/21/care/fluid_limit': (b) =>
        Response.json(order('fluid_limit', b as CareValues['fluid_limit']), { status: 201 }),
      'GET /api/admissions/21/entries': () => Response.json(chartOf(NONE)),
      'GET /api/admissions/21/meals': () => Response.json([]),
    })
    const form = { ...formDefaults('fluid_limit', NONE), ml: 1000 }
    assert.equal(form.scope, 'total')
    const value = careInput('fluid_limit', form, NONE, on(3, 10))
    assert.ok(value)
    const r = await applyCare(f.api, 21, { op: 'set', kind: 'fluid_limit', value }, () => bedLoad(f.api, 21)(signal))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/21/care/fluid_limit', 'GET /api/admissions/21/entries', 'GET /api/admissions/21/meals'])
    assert.deepEqual(f.bodies[0], { ml: 1000, scope: 'total' })
    assert.equal(f.staff[0], '7')
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })

  it('[web/ward] Change care orders from the bed review: Form defaults', () => {
    const today = on(3, 10)
    assert.deepEqual(formDefaults('fluid_limit', NONE, today), { ml: 1500, scope: 'total' })
    assert.deepEqual(
      [
        stepMl(1500, 1, FLUID_LIMIT_RANGE),
        stepMl(1500, -1, FLUID_LIMIT_RANGE),
        stepMl(500, -1, FLUID_LIMIT_RANGE),
        stepMl(3000, 1, FLUID_LIMIT_RANGE),
      ],
      [1550, 1450, 500, 3000],
    )
    assert.deepEqual(formDefaults('intake_target', NONE, today), { ml: 1600 })
    assert.deepEqual(formDefaults('nil_by_mouth', NONE, today), { until: null })
    assert.deepEqual(formDefaults('catheter', NONE, today), { type: 'urethral', inserted: '2026-11-03' })
    const thick = formDefaults('thickened_fluids', NONE, today)
    assert.deepEqual(thick, { level: null })
    assert.equal(careInput('thickened_fluids', thick, NONE, today), null, 'Save disabled until a level is picked')
    assert.deepEqual(careInput('thickened_fluids', { level: 2 }, NONE, today), { level: 2 })
    // With an active 1500 mL limit, the target starts at the lower of 1600 mL and the limit.
    const limited: CareStatus = { ...NONE, orders: [order('fluid_limit', { ml: 1500, scope: 'total' })], fluid_limit: limit(0, 1500) }
    assert.deepEqual(formDefaults('intake_target', limited, today), { ml: 1500 })
    const diet = formDefaults('diet', NONE, today)
    assert.deepEqual(diet, { type: null, texture: 7, kcal: null, protein_g: null })
    assert.equal(careInput('diet', diet, NONE, today), null, 'Save disabled until a type is picked')
    // The device forms (web/ward "Output devices on the care plan").
    assert.deepEqual(formDefaults('stoma', NONE, today), { type: null })
    assert.deepEqual(formDefaults('drain', NONE, today), { site: null })
    assert.deepEqual(formDefaults('voiding', NONE, today), { method: 'urinal' })
  })

  it('[web/ward] Change care orders from the bed review: Planned end of nil by mouth', () => {
    assert.equal(untilFrom('14:00', on(3, 10)), on(3, 14).toISOString())
    assert.equal(untilFrom('07:00', on(3, 22)), on(4, 7).toISOString())
    assert.deepEqual(careInput('nil_by_mouth', { until: '14:00' }, NONE, on(3, 10)), { until: on(3, 14).toISOString() })
    assert.deepEqual(careInput('nil_by_mouth', { until: null }, NONE, on(3, 10)), { until: null })
  })

  it('[web/ward] Change care orders from the bed review: Catheter insertion date', () => {
    assert.equal(insertedFrom('2026-10-29'), on(29, 0, 0, 9).toISOString())
    assert.deepEqual(careInput('catheter', { type: 'urethral', inserted: '2026-10-29' }, NONE, on(3, 10)), {
      type: 'urethral',
      inserted_at: on(29, 0, 0, 9).toISOString(),
    })
  })

  it('[web/ward] Change care orders from the bed review: End an order', async () => {
    // Meera Pillai (id 6) on 2C bed 1 (admission 11).
    const f = fake(
      {
        'DELETE /api/admissions/11/care/nil_by_mouth': () => Response.json(order('nil_by_mouth', { until: null }, { end_at: iso(3, 10) })),
        'GET /api/admissions/11/entries': () => Response.json(chartOf(NONE)),
        'GET /api/admissions/11/meals': () => Response.json([]),
      },
      6,
    )
    assert.equal(endConfirmText('nil_by_mouth'), 'End nil by mouth?')
    assert.equal(endConfirmText('catheter'), 'Catheter removed?')
    const r = await applyCare(f.api, 11, { op: 'end', kind: 'nil_by_mouth' }, () => bedLoad(f.api, 11)(signal))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, [
      'DELETE /api/admissions/11/care/nil_by_mouth',
      'GET /api/admissions/11/entries',
      'GET /api/admissions/11/meals',
    ])
    assert.equal(f.staff[0], '6')
  })

  it('[web/ward] Change care orders from the bed review: Reviewed today', async () => {
    // Nikhil Bose on HDU bed 1 (admission 19).
    let answered = 201
    const f = fake({
      'POST /api/admissions/19/care/catheter/review': () =>
        answered === 201
          ? Response.json({ id: 1, order_id: 5, at: iso(3, 9, 10), by: NIKHIL }, { status: 201 })
          : Response.json({ error: 'already_reviewed' }, { status: 409 }),
      'GET /api/admissions/19/entries': () => Response.json(chartOf(NONE)),
      'GET /api/admissions/19/meals': () => Response.json([]),
    })
    const reload = () => bedLoad(f.api, 19)(signal)
    assert.equal((await applyCare(f.api, 19, { op: 'review' }, reload)).ok, true)
    assert.deepEqual(f.calls, [
      'POST /api/admissions/19/care/catheter/review',
      'GET /api/admissions/19/entries',
      'GET /api/admissions/19/meals',
    ])
    // A second tap: 409, "Already reviewed today", and nothing more is sent.
    answered = 409
    f.calls.length = 0
    assert.deepEqual(await applyCare(f.api, 19, { op: 'review' }, reload), { ok: false, text: 'Already reviewed today' })
    assert.deepEqual(f.calls, ['POST /api/admissions/19/care/catheter/review'])
  })

  it('[web/ward] Change care orders from the bed review: Target above the limit', () => {
    const f = fake()
    const limited: CareStatus = { ...NONE, orders: [order('fluid_limit', { ml: 1500, scope: 'total' })], fluid_limit: limit(0, 1500) }
    assert.equal(targetConflict(limited, 'intake_target', 1600), 'Above the fluid limit of 1500 mL')
    assert.equal(careInput('intake_target', { ml: 1600 }, limited, on(3, 10)), null, 'Save disabled')
    assert.equal(targetConflict(limited, 'intake_target', 1500), null)
    const targeted: CareStatus = {
      ...NONE,
      orders: [order('intake_target', { ml: 1600 })],
      intake_target: { ...progress(0, 1600), next_check: null },
    }
    assert.equal(targetConflict(targeted, 'fluid_limit', 1500), 'Below the intake target of 1600 mL')
    assert.equal(targetConflict(targeted, 'fluid_limit', 1600), null)
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward] Change care orders from the bed review: Attendant', () => {
    assert.equal(canDecide(RAVI), false)
    assert.equal(canDecide(ANITA), true)
    assert.equal(canDecide({ role: 'matron' }), true)
  })
})

/** Answers entries (201, id 51 onwards), reviews, media uploads and a photo read. */
function bedServer(staffId: number, read?: CaptureReadResult) {
  let id = 50
  return fake(
    {
      'POST /api/admissions/\\d+/entries': (b) => Response.json(entry({ id: ++id, ...(b as object) }), { status: 201 }),
      'POST /api/entries/\\d+/review': () => Response.json(entry({ id, status: 'approved' })),
      'POST /api/admissions/\\d+/media': () =>
        Response.json({ id: 31, kind: 'photo', mime: 'image/jpeg', size: 4, duration_ms: null, created_at: iso(3, 10) }, { status: 201 }),
      'POST /api/ai/read': () => Response.json(read),
    },
    staffId,
  )
}
const drink = (ml = 200): Pending => ({
  draft: { direction: 'in', category: 'water', volume_ml: ml, item: null, notes: null },
  source: 'manual',
  confidence: null,
})
const nbm = (until: string | null): CareStatus => ({
  ...NONE,
  orders: [order('nil_by_mouth', { until }, { start_at: iso(3, 6), admission_id: 11 })],
})
const THICK: CareStatus = { ...NONE, orders: [order('thickened_fluids', { level: 2 })] }
const WARNING = 'Nil by mouth since 06:00. Saving records it and asks the nurse to review.'

describe('nil by mouth warning before saving', () => {
  it('[web/capture] Nil by mouth warning before saving: Drink for a fasting patient', async () => {
    // 2C bed 1 (admission 11), nil by mouth since 06:00 with no planned end; Ravi Kumar (id 1) by hand.
    const warning = nbmWarning(nbm(null), 'water', NOW)
    assert.equal(warning, WARNING)
    assert.equal(saveLabel(warning), 'Save anyway')
    const f = bedServer(1)
    await saveByHand(f.api, 11, drink(), null)
    assert.deepEqual(f.calls, ['POST /api/admissions/11/entries'])
    assert.equal(f.staff[0], '1')
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })

  it('[web/capture] Nil by mouth warning before saving: Planned end', () => {
    // A voice draft of 150 mL tea is a drink.
    assert.equal(
      nbmWarning(nbm(iso(3, 14)), 'water', NOW),
      'Nil by mouth since 06:00, until 14:00. Saving records it and asks the nurse to review.',
    )
    assert.equal(
      nbmWarning(nbm(iso(3, 14)), 'food', NOW),
      'Nil by mouth since 06:00, until 14:00. Saving records it and asks the nurse to review.',
    )
  })

  it('[web/capture] Nil by mouth warning before saving: IV or output', () => {
    const care = nbm(iso(3, 14))
    assert.deepEqual(
      (['iv', 'urine'] as const).map((c) => saveLabel(nbmWarning(care, c, NOW))),
      ['Save', 'Save'],
    )
    assert.equal(nbmWarning(NONE, 'water', NOW), null, 'no order, no warning')
  })

  it('[web/capture] Nil by mouth warning before saving: Meal', () => {
    const care = nbm(iso(3, 14))
    const forms = [
      { portion: 50, fluid_ml: null },
      { portion: 0, fluid_ml: null },
      { portion: 0, fluid_ml: 150 },
    ] as const
    assert.deepEqual(
      forms.map((m) => saveLabel(nbmWarning(care, m, NOW), 'Save lunch')),
      ['Save anyway', 'Save lunch', 'Save anyway'],
    )
  })

  it('[web/capture] Nil by mouth warning before saving: Missed entry by a nurse', async () => {
    // Meera Pillai (id 6) from the bed review: the dialog warns, and saving is as without the order.
    assert.equal(nbmWarning(nbm(null), 'water', NOW), WARNING)
    const f = bedServer(6)
    const when = chartedAt('09:00', on(3, 10), iso(1, 9))
    assert.ok('iso' in when)
    const r = await addMissedEntry(f.api, 11, { ...drink().draft, volume_ml: 200 }, when.iso)
    assert.equal(r.error, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/11/entries', 'POST /api/entries/51/review'])
    assert.deepEqual(f.bodies[1], { action: 'approve' })
    assert.deepEqual(f.staff, ['6', '6'])
  })
})

describe('drink consistency on the check screen', () => {
  it('[web/capture] Drink consistency on the check screen: Defaults to the order', async () => {
    // 5B bed 6 (admission 16), thickened fluids at level 2.
    assert.equal(consistencyDefault(THICK, 'water'), 2)
    const p = seedConsistency(drink(), THICK)
    assert.equal(p.iddsi_level, 2)
    const f = bedServer(1)
    await saveByHand(f.api, 16, p, null)
    assert.deepEqual(f.calls, ['POST /api/admissions/16/entries'])
    assert.equal((f.bodies[0] as { iddsi_level?: number }).iddsi_level, 2)
  })

  it('[web/capture] Drink consistency on the check screen: Thinner than ordered', async () => {
    assert.equal(thinnerNotice(0, THICK), 'Thinner than ordered (IDDSI 2 Mildly thick). The nurse is asked to review.')
    const f = bedServer(1)
    await saveByHand(f.api, 16, { ...seedConsistency(drink(), THICK), iddsi_level: 0 }, null)
    assert.equal((f.bodies[0] as { iddsi_level?: number }).iddsi_level, 0)
  })

  it('[web/capture] Drink consistency on the check screen: Thicker', () => {
    assert.equal(thinnerNotice(3, THICK), null)
    assert.equal(thinnerNotice(2, THICK), null)
    assert.equal(toEntryInput({ ...seedConsistency(drink(), THICK), iddsi_level: 3 }).iddsi_level, 3)
  })

  it('[web/capture] Drink consistency on the check screen: Type changed', () => {
    const food = withCategory(seedConsistency(drink(), THICK), 'food', THICK)
    assert.equal(consistencyDefault(THICK, 'food'), undefined)
    assert.equal('iddsi_level' in toEntryInput(food), false)
    const back = withCategory({ ...food }, 'water', THICK)
    assert.equal(back.draft.direction, 'in')
    assert.equal(back.iddsi_level, 2)
    // A level left on a draft whose type is not a drink is never sent.
    assert.equal('iddsi_level' in toEntryInput({ ...food, iddsi_level: 2 }), false)
  })

  it('[web/capture] Drink consistency on the check screen: No order', async () => {
    assert.equal(consistencyDefault(NONE, 'water'), undefined)
    const p = seedConsistency(drink(), NONE)
    const f = bedServer(1)
    await saveByHand(f.api, 16, p, null)
    assert.equal('iddsi_level' in (f.bodies[0] as object), false)
  })

  it('[web/capture] Drink consistency on the check screen: Photo draft', async () => {
    const read: CaptureReadResult = {
      image_sha256: 'c0ffee'.padEnd(64, '0'),
      mode: 'sam+spark',
      reading: {
        container: 'cup',
        fluid: 'water',
        volume_ml: 180,
        capacity_ml: 250,
        marks_visible: false,
        reading_basis: 'cup about three quarters full',
        appearance: null,
        confidence: 0.85,
        issues: [],
      },
      segmentation: null,
      draft: { direction: 'in', category: 'water', volume_ml: 180, item: 'water', notes: null },
      needs_review: false,
      warnings: [],
      trace: [{ step: 'spark:read', model: 'muse-spark-1.3', ms: 3000 }],
      ms: 3100,
    }
    const f = bedServer(1, read)
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
    const r = await f.api.read(photo)
    const p = seedConsistency({ draft: r.draft!, source: 'photo', confidence: r.reading.confidence, evidence: toEvidence(r, null) }, THICK)
    assert.equal(p.iddsi_level, 2)
    await saveEntry(f.api, 16, p, { kind: 'photo', blob: photo })
    assert.deepEqual(f.calls, ['POST /api/ai/read', 'POST /api/admissions/16/media', 'POST /api/admissions/16/entries'])
    assert.equal((f.bodies[2] as { iddsi_level?: number }).iddsi_level, 2)
    assert.equal(f.calls.filter((c) => c.includes('/api/ai')).length, 1)
  })
})

describe('bag reading interval on the care plan', () => {
  const cath = (every: 1 | 2 | 4 | null, over: Partial<Omit<CareOrder, 'kind' | 'value'>> = {}) =>
    order('catheter', { type: 'urethral', inserted_at: iso(29, 0, 0, 9), measure_every_h: every }, { start_at: iso(1, 10), ...over })
  const status = (o: CareOrder, review_due = false): CareStatus => ({
    ...NONE,
    orders: [o],
    catheter: { day: 6, review_due, last_review: null },
  })

  it('[web/ward] Bag reading interval on the care plan: Set by the order', () => {
    const o = cath(2)
    const row = carePlanView(status(o), [o], NOW, false, { interval_h: 2, interval_from: 'catheter' }).rows[0]!
    assert.equal(row.text, 'Urethral catheter · inserted 29 Oct · Catheter day 6')
    assert.equal(row.interval, 'Bag reading every 2 h')
  })

  it('[web/ward] Bag reading interval on the care plan: Default', () => {
    const o = cath(null)
    const row = carePlanView(status(o), [o], NOW, false, { interval_h: 1, interval_from: 'default' }).rows[0]!
    assert.equal(row.interval, 'Bag reading every 1 h · Ward default')
  })

  it('[web/ward] Bag reading interval on the care plan: Change it', async () => {
    // Nikhil Bose (id 7) on HDU bed 1 (admission 19) at 09:05 on 3 Nov; the review is due.
    const old = cath(null)
    const now = on(3, 9, 5)
    const form = { ...formFrom(old), every: everyOf('4') }
    const value = careInput('catheter', form, status(old, true), now)
    assert.ok(value)
    const changed = cath(4, { start_at: iso(3, 9, 5), set_by: NIKHIL })
    const ended = { ...old, end_at: iso(3, 9, 5), ended_by: NIKHIL }
    const after = {
      ...chartOf(status(changed, true), [changed, ended]),
      bags: { interval_h: 4, interval_from: 'catheter' as const, periods: [] },
    }
    const f = fake({
      'PUT /api/admissions/19/care/catheter': () => Response.json(changed, { status: 201 }),
      'GET /api/admissions/19/entries': () => Response.json(after),
      'GET /api/admissions/19/meals': () => Response.json([]),
    })
    let loaded: Awaited<ReturnType<ReturnType<typeof bedLoad>>> | undefined
    const r = await applyCare(f.api, 19, { op: 'set', kind: 'catheter', value }, async () => {
      loaded = await bedLoad(f.api, 19)(signal)
    })
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/19/care/catheter', 'GET /api/admissions/19/entries', 'GET /api/admissions/19/meals'])
    assert.deepEqual(f.bodies[0], { type: 'urethral', inserted_at: iso(29, 0, 0, 9), measure_every_h: 4 })
    assert.equal(f.staff[0], '7')
    const row = carePlanView(loaded!.care, loaded!.care_history, now.getTime(), false, loaded!.bags).rows[0]!
    assert.equal(row.interval, 'Bag reading every 4 h')
    assert.deepEqual(row.review?.offered, true)
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })

  it('[web/ward] Bag reading interval on the care plan: Back to the default', () => {
    const o = cath(4)
    const form = { ...formFrom(o), every: everyOf('default') }
    assert.deepEqual(careInput('catheter', form, status(o), on(3, 9, 10)), {
      type: 'urethral',
      inserted_at: iso(29, 0, 0, 9),
      measure_every_h: null,
    })
    assert.equal(everyChoices({ ward_code: 'HDU' })[0]![1], 'Ward default (1 h)')
  })

  it('[web/ward] Bag reading interval on the care plan: Form defaults', () => {
    assert.equal(everyChoice(formDefaults('catheter', NONE, on(3, 10)).every), 'default')
    assert.equal(everyChoices({ ward_code: '3A' })[0]![1], 'Ward default (4 h)')
    assert.equal(everyChoices({ ward_code: 'HDU' })[0]![1], 'Ward default (1 h)')
    assert.deepEqual(
      everyChoices({ ward_code: '3A' }).map(([, label]) => label),
      ['Ward default (4 h)', '1 h', '2 h', '4 h', '6 h', '8 h', '12 h'],
    )
    assert.equal(everyChoice(formFrom(cath(2)).every), '2')
  })

  it('[web/ward] Bag reading interval on the care plan: History', () => {
    const old = { ...cath(null), end_at: iso(3, 9, 5), set_by: NIKHIL, ended_by: NIKHIL }
    const changed = cath(4, { start_at: iso(3, 9, 5), set_by: NIKHIL })
    const view = carePlanView(status(changed), [changed, old], NOW)
    assert.equal(view.history[0], 'Urethral catheter inserted 29 Oct, bag reading every 4 h · 09:05–now · set by Nikhil B.')
    assert.equal(view.history[1], 'Urethral catheter inserted 29 Oct · 1 Nov 10:00–09:05 · set by Nikhil B. · ended by Nikhil B.')
  })
})

// ---------- diet orders (dietitian-care) ----------

const SANA: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }
const DIVYA: StaffRef = { id: 8, name: 'Divya Kapoor', role: 'nurse' }
const GRACE: StaffRef = { id: 5, name: 'Grace Lee', role: 'nurse' }
const RENAL = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 } as const
const SOFT = { type: 'regular', texture: 6, kcal: null, protein_g: null } as const
const withOrders = (...orders: CareOrder[]): CareStatus => ({ ...NONE, orders })

describe('diet order on the care plan', () => {
  it('[web/ward] Diet order on the care plan: Renal diet', () => {
    const v = carePlanView(withOrders(order('diet', RENAL)), [], NOW)
    assert.deepEqual(
      v.rows.map((r) => r.text),
      ['Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein'],
    )
  })

  it('[web/ward] Diet order on the care plan: Soft diet', () => {
    const v = carePlanView(withOrders(order('diet', SOFT)), [], NOW)
    assert.deepEqual(
      v.rows.map((r) => r.text),
      ['Diet · Regular · IDDSI 6 Soft & bite-sized'],
    )
  })

  it('[web/ward] Diet order on the care plan: History', () => {
    const now6 = order('diet', { ...RENAL, texture: 6 }, { start_at: iso(3, 11), set_by: DIVYA })
    const then7 = order('diet', RENAL, { start_at: iso(3, 10), end_at: iso(3, 11), set_by: SANA, ended_by: DIVYA })
    const v = carePlanView(withOrders(now6), [now6, then7], on(3, 12).getTime())
    assert.deepEqual(v.history, [
      'Diet renal, IDDSI 6, 1800 kcal, 60 g protein · 11:00–now · set by Divya K.',
      'Diet renal, IDDSI 7, 1800 kcal, 60 g protein · 10:00–11:00 · set by Sana M. · ended by Divya K.',
    ])
  })
})

describe('diet badges', () => {
  it('[web/ward] Diet badges on bed cards: Renal and soft', () => {
    const hdu3: CareStatus = {
      ...withOrders(order('fluid_limit', { ml: 1000, scope: 'total' }), order('diet', RENAL)),
      fluid_limit: limit(820, 1000),
    }
    assert.deepEqual(careBadges(hdu3), ['Limit 1 L · 82%', 'Renal diet'])
    assert.deepEqual(careBadges(withOrders(order('thickened_fluids', { level: 2 }), order('diet', SOFT))), ['IDDSI 2', 'Food IDDSI 6'])
    assert.deepEqual(careBadges(withOrders(order('diet', { ...SOFT, texture: 7 }))), ['Regular diet'])
    assert.deepEqual(careBadges(withOrders(order('diet', { ...SOFT, type: 'low_salt', texture: 5 }))), ['Low salt diet', 'Food IDDSI 5'])
  })

  it('[web/ward] Diet badges on bed cards: No extra request', async () => {
    const care = withOrders(order('thickened_fluids', { level: 2 }), order('diet', SOFT))
    const summary = { ...chartOf(care), ...ADMISSION, pending: 0, hourly: { in_ml: [], out_ml: [], in_logged: [] } }
    const f = fake({
      'GET /api/admissions\\?ward=3': () => Response.json([summary]),
      'GET /api/wards/3/team': () => Response.json({ ward_id: 3, shift_start: iso(3, 8), in_charge: null, team: [], assignments: [] }),
    })
    const load = wardLoads(f.api, 3)
    const [list] = await Promise.all([load.beds(signal), load.team(signal)])
    assert.deepEqual(careBadges(list[0]!.care), ['IDDSI 2', 'Food IDDSI 6'])
    assert.deepEqual(f.calls, ['GET /api/admissions?ward=3', 'GET /api/wards/3/team'])
  })

  it('[web/ward] Care badges on bed cards: Diet has its own badges', () => {
    const care = withOrders(order('thickened_fluids', { level: 2 }), order('diet', { ...SOFT, type: 'low_salt', texture: 5 }))
    assert.deepEqual(careBadges(care), ['IDDSI 2', 'Low salt diet', 'Food IDDSI 5'])
  })
})

describe('diet order from the bed review', () => {
  const chartRoutes = (id: number, care: CareStatus = NONE) => ({
    [`GET /api/admissions/${id}/entries`]: () => Response.json(chartOf(care)),
    [`GET /api/admissions/${id}/meals`]: () => Response.json([]),
  })

  it('[web/ward] Diet order from the bed review: Form defaults', () => {
    const form = formDefaults('diet', NONE, on(3, 10))
    assert.deepEqual(form, { type: null, texture: 7, kcal: null, protein_g: null })
    assert.equal(careInput('diet', form, NONE, on(3, 10)), null, 'Save disabled until a type is picked')
    assert.deepEqual(careInput('diet', { ...form, type: 'renal' }, NONE, on(3, 10)), { type: 'renal', texture: 7 })
    assert.deepEqual([DIET_KCAL_RANGE.default, DIET_KCAL_RANGE.step, DIET_KCAL_RANGE.min, DIET_KCAL_RANGE.max], [1800, 50, 800, 4000])
    assert.deepEqual(
      [DIET_PROTEIN_RANGE.default, DIET_PROTEIN_RANGE.step, DIET_PROTEIN_RANGE.min, DIET_PROTEIN_RANGE.max],
      [60, 5, 20, 200],
    )
    assert.deepEqual(
      [stepMl(1800, 1, DIET_KCAL_RANGE), stepMl(4000, 1, DIET_KCAL_RANGE), stepMl(20, -1, DIET_PROTEIN_RANGE)],
      [1850, 4000, 20],
    )
    // Added, then removed again: the body is back to type and texture.
    const added = { ...form, type: 'renal' as const, kcal: DIET_KCAL_RANGE.default, protein_g: DIET_PROTEIN_RANGE.default }
    assert.deepEqual(careInput('diet', added, NONE, on(3, 10)), { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 })
    assert.deepEqual(careInput('diet', { ...added, kcal: null, protein_g: null }, NONE, on(3, 10)), { type: 'renal', texture: 7 })
  })

  it('[web/ward] Diet order from the bed review: Sana sets a renal diet', async () => {
    const f = fake(
      { 'PUT /api/admissions/21/care/diet': () => Response.json(order('diet', RENAL), { status: 201 }), ...chartRoutes(21) },
      11,
    )
    assert.deepEqual(addableKinds(NONE, SANA), ['diet'])
    const value = careInput('diet', { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }, NONE, on(3, 10))!
    const r = await applyCare(f.api, 21, { op: 'set', kind: 'diet', value }, () => bedLoad(f.api, 21)(signal))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/21/care/diet', 'GET /api/admissions/21/entries', 'GET /api/admissions/21/meals'])
    assert.deepEqual(f.bodies[0], { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 })
    assert.equal(f.staff[0], '11')
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })

  it('[web/ward] Diet order from the bed review: Divya changes the texture', async () => {
    const active = order('diet', RENAL, { set_by: SANA })
    const care = withOrders(active)
    const f = fake(
      { 'PUT /api/admissions/21/care/diet': () => Response.json(order('diet', { ...RENAL, texture: 6 })), ...chartRoutes(21, care) },
      8,
    )
    const form = formFrom(active)
    assert.equal(targetsLine(form), '1800 kcal · 60 g protein · set by a dietitian')
    const value = careInput('diet', { ...form, texture: 6 }, care, on(3, 11))!
    await applyCare(f.api, 21, { op: 'set', kind: 'diet', value }, () => bedLoad(f.api, 21)(signal))
    assert.deepEqual(f.bodies[0], { type: 'renal', texture: 6, kcal: 1800, protein_g: 60 })
    assert.deepEqual(f.calls, ['PUT /api/admissions/21/care/diet', 'GET /api/admissions/21/entries', 'GET /api/admissions/21/meals'])
    assert.equal(targetsLine(SOFT), null)
  })

  it('[web/ward] Diet order from the bed review: Ending', async () => {
    const targeted = order('diet', RENAL, { set_by: SANA })
    assert.deepEqual(rowActions(targeted, DIVYA), { change: true, end: false, note: DIET_END_TARGETS })
    assert.equal(DIET_END_TARGETS, 'Only a dietitian can end a diet with targets.')
    assert.deepEqual(rowActions(targeted, SANA), { change: true, end: true, note: null })
    const soft = order('diet', SOFT, { set_by: GRACE })
    assert.deepEqual(rowActions(soft, GRACE), { change: true, end: true, note: null })
    assert.equal(endConfirmText('diet'), 'End diet?')
    const f = fake(
      { 'DELETE /api/admissions/18/care/diet': () => Response.json({ ...soft, end_at: iso(3, 10) }), ...chartRoutes(18, withOrders(soft)) },
      5,
    )
    await applyCare(f.api, 18, { op: 'end', kind: 'diet' }, () => bedLoad(f.api, 18)(signal))
    assert.deepEqual(f.calls, ['DELETE /api/admissions/18/care/diet', 'GET /api/admissions/18/entries', 'GET /api/admissions/18/meals'])
  })

  it("[web/ward] Diet order from the bed review: Dietitian's care plan", () => {
    const catheter = order('catheter', { type: 'urethral', inserted_at: iso(29, 11, 0, 9), measure_every_h: null })
    const care: CareStatus = { ...withOrders(catheter), catheter: { day: 6, review_due: true, last_review: null } }
    assert.deepEqual(addableKinds(care, SANA), ['diet'])
    // Offered only "Add diet": one button that opens the diet form, no kind chooser.
    assert.deepEqual(addControl(addableKinds(care, SANA)), { label: 'Add diet', direct: 'diet' })
    assert.deepEqual(addControl(addableKinds(care, GRACE)), { label: 'Add order', direct: null })
    assert.equal(addControl([]), null)
    assert.deepEqual(rowActions(catheter, SANA), { change: false, end: false, note: null })
    // "Reviewed today" is a decider's control; a dietitian is not one.
    assert.equal(canDecide(SANA), false)
  })

  it('[web/ward] Diet order from the bed review: Targets changed meanwhile', async () => {
    const f = fake(
      { 'PUT /api/admissions/21/care/diet': () => Response.json({ error: 'forbidden' }, { status: 403 }), ...chartRoutes(21) },
      8,
    )
    const r = await applyCare(f.api, 21, { op: 'set', kind: 'diet', value: { type: 'renal', texture: 6, kcal: 1800, protein_g: 60 } }, () =>
      bedLoad(f.api, 21)(signal),
    )
    assert.deepEqual(r, { ok: false, text: DIET_TARGETS_FORBIDDEN })
    assert.equal(DIET_TARGETS_FORBIDDEN, 'Only a dietitian can change energy and protein targets.')
    assert.deepEqual(f.calls, ['PUT /api/admissions/21/care/diet', 'GET /api/admissions/21/entries', 'GET /api/admissions/21/meals'])
  })

  it('[web/ward] Diet order from the bed review: Attendant', () => {
    const care = withOrders(order('diet', RENAL))
    assert.deepEqual(
      carePlanView(care, [], NOW).rows.map((r) => r.text),
      ['Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein'],
    )
    assert.deepEqual(addableKinds(NONE, RAVI), [])
    assert.deepEqual(rowActions(care.orders[0]!, RAVI), { change: false, end: false, note: null })
  })

  it('[web/ward] Change care orders from the bed review: Dietitian offered diet only', () => {
    const watch = order('acuity', { level: 'watch' })
    assert.deepEqual(addableKinds(withOrders(watch), SANA), ['diet'])
  })
})

describe('output devices on the care plan', () => {
  const ileostomy = order('stoma', { type: 'ileostomy' }, { start_at: iso(3, 9), set_by: MEERA })
  const chest = order('drain', { site: 'chest' })
  const toilet = order('voiding', { method: 'toilet' })
  const catheter = order('catheter', { type: 'urethral', inserted_at: iso(2, 9), measure_every_h: null })
  const DEVICES: CareStatus = {
    ...NONE,
    orders: [catheter, ileostomy, chest, toilet],
    catheter: { day: 2, review_due: false, last_review: null },
  }

  it('[web/ward] Output devices on the care plan: Rows', () => {
    const v = carePlanView(DEVICES, [toilet, chest, ileostomy, catheter], NOW)
    assert.deepEqual(
      v.rows.slice(1).map((r) => r.text),
      ['Ileostomy · stoma bag', 'Chest drain', 'Toilet for urine · not measured'],
    )
    assert.equal(v.rows[0]!.order.kind, 'catheter')
    assert.ok(v.history.includes('Ileostomy · 09:00–now · set by Meera P.'))
    const commode = carePlanView({ ...NONE, orders: [order('voiding', { method: 'commode' })] }, [], NOW)
    assert.deepEqual(
      commode.rows.map((r) => r.text),
      ['Commode for urine'],
    )
    assert.equal(CARE_ROW.voiding(order('voiding', { method: 'pads' }), NONE, NOW), 'Pads for urine · not measured')
  })

  it('[web/ward] Output devices on the care plan: Add a commode order', async () => {
    // Anita Thomas (id 4) on 3A bed 4 (admission 9).
    const f = fake(
      {
        'PUT /api/admissions/9/care/voiding': (b) => Response.json(order('voiding', b as CareValues['voiding']), { status: 201 }),
        'GET /api/admissions/9/entries': () => Response.json(chartOf(NONE)),
        'GET /api/admissions/9/meals': () => Response.json([]),
      },
      ANITA.id,
    )
    assert.ok(addableKinds(NONE, ANITA).includes('voiding'))
    const value = careInput('voiding', { method: 'commode' }, NONE, on(3, 10))!
    const r = await applyCare(f.api, 9, { op: 'set', kind: 'voiding', value }, () => bedLoad(f.api, 9)(signal))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/9/care/voiding', 'GET /api/admissions/9/entries', 'GET /api/admissions/9/meals'])
    assert.deepEqual(f.bodies[0], { method: 'commode' })
    assert.equal(f.staff[0], String(ANITA.id))
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })

  it('[web/ward] Output devices on the care plan: Form defaults', () => {
    const today = on(3, 10)
    assert.deepEqual(
      STOMA_CHOICES.map(([, l]) => l),
      ['Colostomy', 'Ileostomy'],
    )
    assert.deepEqual(
      DRAIN_CHOICES.map(([, l]) => l),
      ['Abdominal', 'Chest', 'Pelvic', 'Wound'],
    )
    assert.deepEqual(
      VOIDING_CHOICES.map(([, l]) => l),
      ['Urinal', 'Bedpan', 'Commode', 'Toilet (not measured)', 'Pads (not measured)'],
    )
    const stoma = formDefaults('stoma', NONE, today)
    const drain = formDefaults('drain', NONE, today)
    assert.deepEqual([stoma, drain], [{ type: null }, { site: null }])
    assert.equal(careInput('stoma', stoma, NONE, today), null, 'Save disabled until a type is picked')
    assert.equal(careInput('drain', drain, NONE, today), null, 'Save disabled until a site is picked')
    const voiding = formDefaults('voiding', NONE, today)
    assert.deepEqual(voiding, { method: 'urinal' })
    assert.deepEqual(careInput('voiding', voiding, NONE, today), { method: 'urinal' })
  })

  it('[web/ward] Output devices on the care plan: End an order', async () => {
    // Meera Pillai on 2C bed 2 (admission 12).
    const f = fake(
      {
        'DELETE /api/admissions/12/care/drain': () => Response.json({ ...chest, end_at: iso(3, 10) }),
        'GET /api/admissions/12/entries': () => Response.json(chartOf(NONE)),
        'GET /api/admissions/12/meals': () => Response.json([]),
      },
      MEERA.id,
    )
    assert.equal(endConfirmText('drain'), 'Drain removed?')
    assert.equal(endConfirmText('stoma'), 'End the stoma order?')
    assert.equal(endConfirmText('voiding'), 'Back to the urinal default?')
    const r = await applyCare(f.api, 12, { op: 'end', kind: 'drain' }, () => bedLoad(f.api, 12)(signal))
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['DELETE /api/admissions/12/care/drain', 'GET /api/admissions/12/entries', 'GET /api/admissions/12/meals'])
  })

  it('[web/ward] Output devices on the care plan: Attendant', () => {
    const v = carePlanView({ ...NONE, orders: [ileostomy] }, [ileostomy], NOW)
    assert.deepEqual(
      v.rows.map((r) => r.text),
      ['Ileostomy · stoma bag'],
    )
    assert.deepEqual(rowActions(ileostomy, RAVI), { change: false, end: false, note: null })
    assert.deepEqual(addableKinds({ ...NONE, orders: [ileostomy] }, RAVI), [])
  })
})

describe('device badges', () => {
  it('[web/ward] Device badges on bed cards: Every device', () => {
    const c: CareStatus = {
      ...NONE,
      orders: [
        order('catheter', { type: 'urethral', inserted_at: iso(2, 9), measure_every_h: null }),
        order('stoma', { type: 'ileostomy' }),
        order('drain', { site: 'abdominal' }),
        order('voiding', { method: 'commode' }),
      ],
      catheter: { day: 2, review_due: false, last_review: null },
    }
    assert.deepEqual(careBadges(c), ['Catheter day 2', 'Stoma', 'Drain', 'Commode'])
    const each = (['urinal', 'bedpan', 'commode', 'toilet', 'pads'] as const).map(
      (method) => careBadges({ ...NONE, orders: [order('voiding', { method })] })[0],
    )
    assert.deepEqual(each, ['Urinal', 'Bedpan', 'Commode', 'Toilet', 'Pads'])
  })

  it('[web/ward] Device badges on bed cards: Default urinal', () => {
    assert.equal(outputDevices(NONE.orders).urine_from, 'default')
    assert.deepEqual(careBadges(NONE), [])
  })

  it('[web/ward] Device badges on bed cards: No extra request', async () => {
    const c: CareStatus = { ...NONE, orders: [order('stoma', { type: 'ileostomy' }), order('drain', { site: 'abdominal' })] }
    const bed: AdmissionSummary = {
      ...ADMISSION,
      totals: chartOf(c).totals,
      pending: 0,
      alerts: [],
      urine_seen: null,
      care: c,
      devices: outputDevices(c.orders),
      acuity: chartOf(c).acuity,
      nutrition: chartOf(c).nutrition,
      hourly: { in_ml: [], out_ml: [], in_logged: [] },
    }
    const f = fake(
      {
        'GET /api/admissions\\?ward=1': () => Response.json([bed]),
        'GET /api/wards/1/team': () => Response.json({ ward_id: 1, shift_start: iso(3, 8), in_charge: null, team: [], assignments: [] }),
      },
      MEERA.id,
    )
    const load = wardLoads(f.api, 1)
    const [list] = await Promise.all([load.beds(signal), load.team(signal)])
    assert.deepEqual(careBadges(list[0]!.care), ['Stoma', 'Drain'])
    assert.deepEqual(f.calls, ['GET /api/admissions?ward=1', 'GET /api/wards/1/team'])
  })

  it('[web/ward] Device badges on bed cards: Urine not measured', () => {
    const toilet: CareStatus = { ...NONE, orders: [order('voiding', { method: 'toilet' })] }
    assert.deepEqual(careBadges(toilet), ['Toilet'])
    assert.equal(balanceNote(outputDevices(toilet.orders)), 'Urine not measured')
    assert.equal(balanceNote(outputDevices(NONE.orders)), null)
  })
})

describe('bag without a device', () => {
  const NO_CATHETER: Alert = {
    kind: 'bag_without_device',
    message: 'Urine bag reading at 10:30, but no catheter is on the care plan. Review.',
  }

  it('[web/ward] Bag without a device on the bed review: Colour', () => {
    assert.equal(ALERT_TONE.bag_without_device, 'warn')
    assert.equal(STATUS_LABEL[bedTone([NO_CATHETER], 0)], 'Review')
    assert.equal(ALERT_LABEL.bag_without_device, 'Bag not on care plan')
  })

  it('[web/ward] Bag without a device on the bed review: Add the catheter', async () => {
    // Anita Thomas (id 4) on 3A bed 5 (admission 10).
    const withCatheter: CareStatus = {
      ...NONE,
      orders: [order('catheter', { type: 'urethral', inserted_at: iso(3, 10), measure_every_h: null })],
      catheter: { day: 1, review_due: false, last_review: null },
    }
    let after = false
    const f = fake(
      {
        'PUT /api/admissions/10/care/catheter': (b) => {
          after = true
          return Response.json(order('catheter', b as CareValues['catheter']), { status: 201 })
        },
        'GET /api/admissions/10/entries': () =>
          Response.json({ ...chartOf(after ? withCatheter : NONE), alerts: after ? [] : [NO_CATHETER] }),
        'GET /api/admissions/10/meals': () => Response.json([]),
      },
      ANITA.id,
    )
    assert.equal(mayOrder('catheter', ANITA), true)
    const now = on(3, 11)
    const value = careInput('catheter', formDefaults('catheter', NONE, now), NONE, now)!
    let reloaded: EntryList | undefined
    const r = await applyCare(f.api, 10, { op: 'set', kind: 'catheter', value }, async () => {
      reloaded = await bedLoad(f.api, 10)(signal)
    })
    assert.equal(r.ok, true)
    assert.deepEqual(f.calls, ['PUT /api/admissions/10/care/catheter', 'GET /api/admissions/10/entries', 'GET /api/admissions/10/meals'])
    assert.equal((f.bodies[0] as { type: string }).type, 'urethral')
    assert.equal(f.staff[0], String(ANITA.id))
    assert.deepEqual(reloaded?.alerts, [])
    assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
  })
})
