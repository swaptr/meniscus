import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ALERT_KINDS,
  type Admission,
  type Alert,
  type AlertKind,
  type CareKind,
  type CareOrder,
  type CareReview,
  type CareValues,
  type Entry,
  type EntryCategory,
  type Meal,
  type MealKind,
  type Portion,
  type StaffRef,
} from '@meniscus/shared'
import { CARE_RULES, careChart, careJson, careValue, inForce, orderAt } from './care.ts'

const MIN = 60_000
const HOUR = 60 * MIN
/** Local time on `d` Nov 2026 (server local time is the hospital's). */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const NURSE: StaffRef = { id: 7, name: 'Nikhil Bose', role: 'nurse' }
const admission: Admission = {
  id: 21,
  bed: '3',
  patient: 'Elena Novak',
  weight_kg: 60,
  qr_token: 'x'.repeat(22),
  admitted_at: iso(nov(1, 10)),
  ward_id: 4,
  ward_code: 'HDU',
  ward_name: 'Renal HDU',
  mrn: 'AT-100903',
}

let nextId = 1
const IN: readonly EntryCategory[] = ['water', 'food', 'iv']
const entry = (category: EntryCategory, volume_ml: number, at: number, over: Partial<Entry> = {}): Entry => ({
  id: nextId++,
  admission_id: admission.id,
  direction: IN.includes(category) ? 'in' : 'out',
  category,
  volume_ml,
  item: null,
  notes: null,
  source: 'manual',
  confidence: null,
  status: 'approved',
  created_at: iso(at),
  reviewed_at: null,
  has_photo: false,
  recorded_ml: volume_ml,
  evidence: null,
  recorded_at: iso(at),
  late: false,
  created_by: null,
  reviewed_by: null,
  approved_ml: null,
  amended_at: null,
  reject_reason: null,
  urine_colour: null,
  urine_rgb: null,
  media: null,
  labeled_media: null,
  levels: null,
  iddsi_level: null,
  drink: null,
  ...over,
})
const water = (ml: number, at: number, over: Partial<Entry> = {}) => entry('water', ml, at, over)
const tea = (ml: number, at: number, over: Partial<Entry> = {}) => entry('water', ml, at, { item: 'tea', ...over })

/** A meal; with `fluid`, also its pending food entry (returned in `entries`). */
const meal = (kind: MealKind, portion: Portion, at: number, o: { fluid?: number; voided?: boolean } = {}) => {
  const fluid = o.fluid ? entry('food', o.fluid, at, { status: o.voided ? 'rejected' : 'pending', item: kind }) : null
  const m: Meal = {
    id: nextId++,
    admission_id: admission.id,
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
    entry_id: fluid?.id ?? null,
    entry_status: fluid?.status ?? null,
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
  }
  return { meal: m, entries: fluid ? [fluid] : [] }
}

const order = <K extends CareKind>(kind: K, value: CareValues[K], start: number, end: number | null = null) =>
  ({
    id: nextId++,
    admission_id: admission.id,
    kind,
    value,
    start_at: iso(start),
    end_at: end === null ? null : iso(end),
    set_by: NURSE,
    ended_by: end === null ? null : NURSE,
  }) as CareOrder

interface Bed {
  orders?: CareOrder[]
  entries?: Entry[]
  meals?: Meal[]
  reviews?: CareReview[]
  admission?: Admission
}
const read = (bed: Bed, now: number) =>
  careChart({
    admission: bed.admission ?? admission,
    entries: [...(bed.entries ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    meals: bed.meals ?? [],
    orders: bed.orders ?? [],
    reviews: bed.reviews ?? [],
    now,
  })
const kinds = (bed: Bed, now: number) => read(bed, now).alerts.map((a) => a.kind)
const alert = (bed: Bed, now: number, kind: AlertKind) => read(bed, now).alerts.find((a) => a.kind === kind)
const ids = (a: Alert | undefined) => (a && 'entry_ids' in a ? { entry_ids: a.entry_ids, meal_ids: a.meal_ids } : undefined)

const limit = (ml: number, scope: 'oral' | 'total' = 'total', start = nov(1, 10, 30)) => order('fluid_limit', { ml, scope }, start)
const target = (ml: number, start = nov(2, 9)) => order('intake_target', { ml }, start)
const nbm = (start: number, until: number | null, end: number | null = null) =>
  order('nil_by_mouth', { until: until === null ? null : iso(until) }, start, end)
const thick = (level: 1 | 2 | 3 | 4, start: number, end: number | null = null) => order('thickened_fluids', { level }, start, end)
const catheter = (inserted: number, start: number) =>
  order('catheter', { type: 'urethral', inserted_at: iso(inserted), measure_every_h: null }, start)

/** 11:00 on 29 Oct, local. */
const oct29 = new Date(2026, 9, 29, 11).getTime()

/** A routine output row, so the existing prompts stay quiet where a scenario does not care about them. */
const urine = (at: number) => entry('urine', 400, at)

describe('care plan rules', () => {
  it("[charting/care-plan] Chart day: Before the day's start", () => {
    const c = read({ orders: [limit(1000)], entries: [water(400, nov(2, 9))] }, nov(3, 7, 30)).care
    assert.equal(c.fluid_limit?.since, iso(nov(2, 8)))
    assert.equal(c.fluid_limit?.ml, 400)
  })

  it('[charting/care-plan] Chart day: Clock change', () => {
    const tz = process.env.TZ
    process.env.TZ = 'Europe/London'
    try {
      // Clocks go back at 02:00 on 25 Oct 2026, so the chart day from 08:00 on 24 Oct lasts 25 h.
      const drink = new Date(2026, 9, 24, 8).getTime()
      const bed = {
        orders: [order('fluid_limit', { ml: 1000, scope: 'total' }, new Date(2026, 9, 24, 7).getTime())],
        entries: [water(300, drink)],
      }
      const before = new Date(2026, 9, 25, 7, 59).getTime()
      assert.equal(before - drink, 24 * HOUR + 59 * MIN)
      const late = read(bed, before).care.fluid_limit!
      assert.deepEqual([late.since, late.ml], [iso(drink), 300])
      const next = read(bed, new Date(2026, 9, 25, 8).getTime()).care.fluid_limit!
      assert.deepEqual([next.since, next.ml], [iso(new Date(2026, 9, 25, 8).getTime()), 0])
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  it('[charting/care-plan] Fluid limit progress: Near the limit', () => {
    const bed = {
      orders: [limit(1000)],
      entries: [water(400, nov(3, 9)), entry('iv', 220, nov(3, 10)), tea(200, nov(3, 11), { status: 'pending' }), urine(nov(3, 11))],
    }
    const { care, alerts } = read(bed, nov(3, 12))
    const { ml, pending_ml, percent, left_ml, of_ml, scope } = care.fluid_limit!
    assert.deepEqual(
      { ml, pending_ml, percent, left_ml, of_ml, scope },
      { ml: 820, pending_ml: 200, percent: 82, left_ml: 180, of_ml: 1000, scope: 'total' },
    )
    assert.equal(
      alerts.find((a) => a.kind === 'fluid_limit_near')?.message,
      'Fluid limit: 820 of 1000 mL total intake (incl. 200 mL pending) today since 08:00, 82%, 180 mL left. Review.',
    )
    assert.ok(!alerts.some((a) => a.kind === 'fluid_limit_reached'))
  })

  it('[charting/care-plan] Fluid limit progress: Exactly 80 percent', () => {
    assert.ok(kinds({ orders: [limit(1000)], entries: [water(800, nov(3, 9))] }, nov(3, 10)).includes('fluid_limit_near'))
    const under = read({ orders: [limit(1000)], entries: [water(799, nov(3, 9))] }, nov(3, 10))
    assert.equal(under.care.fluid_limit?.percent, 79)
    assert.ok(!under.alerts.some((a) => a.kind === 'fluid_limit_near' || a.kind === 'fluid_limit_reached'))
  })

  it('[charting/care-plan] Fluid limit progress: Exactly 100 percent', () => {
    const k = kinds({ orders: [limit(1000)], entries: [water(1000, nov(3, 9))] }, nov(3, 10))
    assert.equal(
      alert({ orders: [limit(1000)], entries: [water(1000, nov(3, 9))] }, nov(3, 10), 'fluid_limit_reached')?.message,
      'Fluid limit reached: 1000 of 1000 mL total intake today since 08:00, 100%, 0 mL left. Review.',
    )
    assert.ok(!k.includes('fluid_limit_near'))
  })

  it('[charting/care-plan] Fluid limit progress: Over the limit', () => {
    const { care, alerts } = read({ orders: [limit(1000)], entries: [water(1150, nov(3, 9))] }, nov(3, 10))
    assert.deepEqual([care.fluid_limit?.percent, care.fluid_limit?.left_ml], [115, 0])
    assert.ok(alerts.some((a) => a.kind === 'fluid_limit_reached'))
  })

  it('[charting/care-plan] Fluid limit progress: Oral leaves out IV', () => {
    const { care, alerts } = read(
      { orders: [limit(1000, 'oral')], entries: [water(600, nov(3, 9)), entry('iv', 1000, nov(3, 9))] },
      nov(3, 10),
    )
    assert.deepEqual([care.fluid_limit?.ml, care.fluid_limit?.percent], [600, 60])
    assert.ok(!alerts.some((a) => a.kind === 'fluid_limit_near' || a.kind === 'fluid_limit_reached'))
  })

  it('[charting/care-plan] Fluid limit progress: Started mid-day', () => {
    const { care, alerts } = read(
      { orders: [limit(1000, 'total', nov(3, 15))], entries: [water(500, nov(3, 9)), water(400, nov(3, 12))] },
      nov(3, 15),
    )
    assert.equal(care.fluid_limit?.ml, 900)
    assert.ok(alerts.some((a) => a.kind === 'fluid_limit_near'))
  })

  it('[charting/care-plan] Nil by mouth intake: Drink while fasting', () => {
    const drink = water(150, nov(3, 10), { status: 'pending' })
    const a = alert({ orders: [nbm(nov(3, 6), nov(3, 14))], entries: [drink] }, nov(3, 10), 'nil_by_mouth_intake')
    assert.equal(a?.message, 'Intake charted while nil by mouth: 1 entry (150 mL). Review.')
    assert.deepEqual(ids(a), { entry_ids: [drink.id], meal_ids: [] })
  })

  it('[charting/care-plan] Nil by mouth intake: Meals and IV', () => {
    const lunch = meal('lunch', 50, nov(3, 12))
    const breakfast = meal('breakfast', 0, nov(3, 8))
    const snack = meal('snack', 100, nov(3, 10), { voided: true })
    const bed = {
      orders: [nbm(nov(3, 6), null)],
      entries: [entry('iv', 1000, nov(3, 9)), water(200, nov(3, 11), { status: 'rejected' })],
      meals: [lunch.meal, breakfast.meal, snack.meal],
    }
    const a = alert(bed, nov(3, 13), 'nil_by_mouth_intake')
    assert.equal(a?.message, 'Intake charted while nil by mouth: 1 meal. Review.')
    assert.deepEqual(ids(a), { entry_ids: [], meal_ids: [lunch.meal.id] })
  })

  it('[charting/care-plan] Nil by mouth intake: Entries and a meal', () => {
    const drink = water(150, nov(3, 9), { status: 'pending' })
    const dinner = meal('dinner', 75, nov(3, 10), { fluid: 200 })
    const a = alert(
      { orders: [nbm(nov(3, 6), null)], entries: [drink, ...dinner.entries], meals: [dinner.meal] },
      nov(3, 11),
      'nil_by_mouth_intake',
    )
    assert.equal(a?.message, 'Intake charted while nil by mouth: 1 entry (150 mL), 1 meal (200 mL). Review.')
    assert.deepEqual(ids(a), { entry_ids: [drink.id, dinner.entries[0]!.id], meal_ids: [dinner.meal.id] })
  })

  it('[charting/care-plan] Nil by mouth intake: Tea with no food', () => {
    const snack = meal('snack', 0, nov(3, 10), { fluid: 150 })
    const a = alert({ orders: [nbm(nov(3, 6), null)], entries: snack.entries, meals: [snack.meal] }, nov(3, 11), 'nil_by_mouth_intake')
    assert.equal(a?.message, 'Intake charted while nil by mouth: 1 entry (150 mL). Review.')
    assert.deepEqual(ids(a), { entry_ids: [snack.entries[0]!.id], meal_ids: [] })
  })

  it('[charting/care-plan] Nil by mouth past its planned end: At the planned end', () => {
    const bed = { orders: [nbm(nov(3, 6), nov(3, 14))] }
    assert.ok(!kinds(bed, nov(3, 13, 59)).includes('nil_by_mouth_overdue'))
    const at = read(bed, nov(3, 14))
    assert.equal(
      at.alerts.find((a) => a.kind === 'nil_by_mouth_overdue')?.message,
      'Nil by mouth past its planned end of 14:00 and still active. Review.',
    )
    assert.deepEqual(
      at.care.orders.map((o) => o.kind),
      ['nil_by_mouth'],
    )
  })

  it('[charting/care-plan] Nil by mouth past its planned end: A day later', () => {
    assert.equal(
      alert({ orders: [nbm(nov(2, 6), nov(2, 14))] }, nov(3, 9), 'nil_by_mouth_overdue')?.message,
      'Nil by mouth past its planned end of 2 Nov 14:00 and still active. Review.',
    )
  })

  it('[charting/care-plan] Nil by mouth past its planned end: No planned end', () => {
    assert.ok(!kinds({ orders: [nbm(nov(3, 6), null)] }, nov(3, 23)).includes('nil_by_mouth_overdue'))
  })

  it('[charting/care-plan] Thickened fluids: Thinner, same and thicker', () => {
    const thin = water(150, nov(3, 9), { iddsi_level: 0 })
    const bed = {
      orders: [thick(2, nov(1, 10, 30))],
      entries: [
        thin,
        water(150, nov(3, 10), { iddsi_level: 2 }),
        water(150, nov(3, 11), { iddsi_level: 3 }),
        entry('food', 150, nov(3, 12)),
      ],
    }
    const a = alert(bed, nov(3, 13), 'drink_too_thin')
    assert.equal(a?.message, 'Drink consistency: 1 drink thinner than ordered. Review.')
    assert.deepEqual(ids(a), { entry_ids: [thin.id], meal_ids: [] })
    assert.ok(!kinds(bed, nov(3, 13)).includes('drink_consistency_unrecorded'))
  })

  it('[charting/care-plan] Thickened fluids: Not recorded', () => {
    const thin = water(150, nov(3, 9), { iddsi_level: 0 })
    const jug = water(400, nov(3, 11), { item: 'water jug: 1000 → 600 mL' })
    const bed = { orders: [thick(2, nov(1, 10, 30))], entries: [thin, water(150, nov(3, 10), { iddsi_level: 2 }), jug] }
    const a = alert(bed, nov(3, 13), 'drink_consistency_unrecorded')
    assert.equal(a?.message, 'Drink consistency: 1 drink with no consistency recorded. Review.')
    assert.deepEqual(ids(a), { entry_ids: [jug.id], meal_ids: [] })
    assert.deepEqual(ids(alert(bed, nov(3, 13), 'drink_too_thin')), { entry_ids: [thin.id], meal_ids: [] })
  })

  it('[charting/care-plan] Thickened fluids: Rejected or no order', () => {
    const ordered = {
      orders: [thick(2, nov(1, 10, 30))],
      entries: [water(150, nov(3, 9), { iddsi_level: 0, status: 'rejected' }), water(150, nov(3, 10), { status: 'rejected' })],
    }
    const other = { entries: [water(150, nov(3, 9), { iddsi_level: 0 })] }
    for (const bed of [ordered, other]) {
      const k = kinds(bed, nov(3, 11))
      assert.ok(!k.includes('drink_too_thin') && !k.includes('drink_consistency_unrecorded'))
    }
  })

  it('[charting/care-plan] Entries judged by the order then in force: Lifted after the drink', () => {
    const drink = water(150, nov(3, 10), { status: 'pending' })
    const a = alert({ orders: [nbm(nov(3, 6), nov(3, 14), nov(3, 12))], entries: [drink] }, nov(3, 15), 'nil_by_mouth_intake')
    assert.deepEqual(ids(a)?.entry_ids, [drink.id])
  })

  it('[charting/care-plan] Entries judged by the order then in force: Start and end', () => {
    const at6 = water(100, nov(3, 6))
    const bed = { orders: [nbm(nov(3, 6), null, nov(3, 12))], entries: [water(100, nov(3, 5, 59)), at6, water(100, nov(3, 12))] }
    assert.deepEqual(ids(alert(bed, nov(3, 13), 'nil_by_mouth_intake'))?.entry_ids, [at6.id])
    // The same [start, end) test, as exported for later rules.
    const o = bed.orders[0]!
    assert.deepEqual(
      [nov(3, 5, 59), nov(3, 6), nov(3, 11, 59), nov(3, 12)].map((t) => inForce(o, t)),
      [false, true, true, false],
    )
  })

  it('[charting/care-plan] Entries judged by the order then in force: Level changed', () => {
    const at9 = water(150, nov(3, 9), { iddsi_level: 2 })
    const bed = {
      orders: [thick(3, nov(3, 6), nov(3, 10)), thick(1, nov(3, 10))],
      entries: [at9, water(150, nov(3, 11), { iddsi_level: 2 })],
    }
    assert.deepEqual(ids(alert(bed, nov(3, 12), 'drink_too_thin'))?.entry_ids, [at9.id])
    // At the change, the new order is in force; before the first, none is.
    assert.deepEqual(
      [nov(3, 5), nov(3, 9), nov(3, 10)].map((t) => orderAt(bed.orders, t)?.value),
      [undefined, { level: 3 }, { level: 1 }],
    )
  })

  it('[charting/care-plan] Catheter day: Inserted before admission', () => {
    assert.equal(read({ orders: [catheter(oct29, nov(1, 10, 30))] }, nov(3, 9)).care.catheter?.day, 6)
  })

  it('[charting/care-plan] Catheter day: Midnight', () => {
    const bed = { orders: [catheter(nov(3, 23, 30), nov(3, 23, 30))] }
    assert.equal(read(bed, nov(3, 23, 59)).care.catheter?.day, 1)
    assert.equal(read(bed, nov(4, 0)).care.catheter?.day, 2)
  })

  it('[charting/care-plan] Catheter necessity review: Review due', () => {
    const { care, alerts } = read({ orders: [catheter(oct29, nov(1, 10, 30))] }, nov(3, 9))
    assert.equal(alerts.find((a) => a.kind === 'catheter_review')?.message, 'Catheter day 6: is it still needed? Review.')
    assert.equal(care.catheter?.review_due, true)
  })

  it('[charting/care-plan] Catheter necessity review: Set today', () => {
    const bed = { orders: [catheter(oct29, nov(3, 10))] }
    for (const now of [nov(3, 10), nov(3, 23), nov(4, 7, 59)]) {
      assert.ok(!kinds(bed, now).includes('catheter_review'), iso(now))
      assert.equal(read(bed, now).care.catheter?.review_due, false)
    }
    assert.ok(kinds(bed, nov(4, 8)).includes('catheter_review'))
  })

  it('[charting/care-plan] Catheter necessity review: Once a chart day', () => {
    const o = catheter(oct29, nov(1, 10, 30))
    const review: CareReview = { id: 1, order_id: o.id, at: iso(nov(3, 9, 10)), by: NURSE }
    const bed = { orders: [o], reviews: [review] }
    assert.ok(!kinds(bed, nov(3, 15)).includes('catheter_review'))
    assert.deepEqual(read(bed, nov(3, 15)).care.catheter, { day: 6, review_due: false, last_review: review })
    assert.ok(!kinds(bed, nov(4, 7, 59)).includes('catheter_review'))
    assert.ok(kinds(bed, nov(4, 8)).includes('catheter_review'))
    assert.equal(read(bed, nov(4, 8)).care.catheter?.review_due, true)
  })

  it('[charting/care-plan] Catheter necessity review: Interval changed while due', () => {
    // Set on 1 Nov; at 09:05 on 3 Nov the same catheter gets an interval: a new order row, the same catheter.
    const first = order('catheter', { type: 'urethral', inserted_at: iso(oct29), measure_every_h: null }, nov(1, 10, 30), nov(3, 9, 5))
    const second = order('catheter', { type: 'urethral', inserted_at: iso(oct29), measure_every_h: 1 }, nov(3, 9, 5))
    const bed = { orders: [first, second] }
    assert.equal(alert(bed, nov(3, 9, 6), 'catheter_review')?.message, 'Catheter day 6: is it still needed? Review.')
    assert.equal(read(bed, nov(3, 9, 6)).care.catheter?.review_due, true)
    const review: CareReview = { id: 1, order_id: second.id, at: iso(nov(3, 9, 10)), by: NURSE }
    assert.ok(!kinds({ ...bed, reviews: [review] }, nov(3, 9, 11)).includes('catheter_review'))
  })

  it('[charting/care-plan] Catheter necessity review: Reviewed, then interval changed', () => {
    const first = order('catheter', { type: 'urethral', inserted_at: iso(oct29), measure_every_h: null }, nov(1, 10, 30), nov(3, 9))
    const second = order('catheter', { type: 'urethral', inserted_at: iso(oct29), measure_every_h: 1 }, nov(3, 9))
    const review: CareReview = { id: 1, order_id: first.id, at: iso(nov(3, 8, 30)), by: NURSE }
    const r = read({ orders: [first, second], reviews: [review] }, nov(3, 9, 1))
    assert.ok(!r.alerts.some((a) => a.kind === 'catheter_review'))
    assert.deepEqual(r.care.catheter, { day: 6, review_due: false, last_review: review })
  })

  it('[charting/care-plan] Catheter necessity review: Another catheter', () => {
    const first = order('catheter', { type: 'urethral', inserted_at: iso(oct29), measure_every_h: null }, nov(1, 10, 30), nov(3, 10))
    const second = order('catheter', { type: 'suprapubic', inserted_at: iso(nov(3, 9, 30)), measure_every_h: null }, nov(3, 10))
    const review: CareReview = { id: 1, order_id: first.id, at: iso(nov(3, 8, 30)), by: NURSE }
    const bed = { orders: [first, second], reviews: [review] }
    const r = read(bed, nov(3, 10, 1))
    assert.ok(!r.alerts.some((a) => a.kind === 'catheter_review'))
    assert.deepEqual(r.care.catheter, { day: 1, review_due: false, last_review: null })
    assert.ok(kinds(bed, nov(4, 8)).includes('catheter_review'))
  })

  it('[charting/care-plan] Intake target progress: Behind at 14:00', () => {
    const bed = {
      orders: [target(1600)],
      entries: [water(200, nov(3, 9)), water(200, nov(3, 11)), water(200, nov(3, 13)), urine(nov(3, 12))],
    }
    const before = read(bed, nov(3, 13, 59))
    assert.ok(!before.alerts.some((a) => a.kind === 'intake_target_behind'))
    assert.deepEqual(before.care.intake_target?.next_check, { at: iso(nov(3, 14)), ml: 800 })
    const at = read(bed, nov(3, 14))
    assert.equal(
      at.alerts.find((a) => a.kind === 'intake_target_behind')?.message,
      'Behind intake target: 600 of 1600 mL oral intake by 14:00, expected 800. Review.',
    )
    assert.deepEqual(at.care.intake_target?.next_check, { at: iso(nov(3, 20)), ml: 1200 })
    assert.deepEqual([at.care.intake_target?.ml, at.care.intake_target?.of_ml, at.care.intake_target?.percent], [600, 1600, 37])
  })

  it('[charting/care-plan] Intake target progress: Caught up, then behind again', () => {
    const bed = { orders: [target(1600)], entries: [water(600, nov(3, 9)), water(250, nov(3, 15)), urine(nov(3, 12)), urine(nov(3, 18))] }
    assert.ok(!kinds(bed, nov(3, 15)).includes('intake_target_behind'))
    assert.equal(
      alert(bed, nov(3, 20), 'intake_target_behind')?.message,
      'Behind intake target: 850 of 1600 mL oral intake by 20:00, expected 1200. Review.',
    )
  })

  it('[charting/care-plan] Intake target progress: Pending and IV', () => {
    const bed = {
      orders: [target(1600)],
      entries: [water(600, nov(3, 9)), tea(100, nov(3, 12), { status: 'pending' }), entry('iv', 1000, nov(3, 10))],
    }
    const { care, alerts } = read(bed, nov(3, 14))
    assert.deepEqual([care.intake_target?.ml, care.intake_target?.pending_ml], [700, 100])
    assert.equal(
      alerts.find((a) => a.kind === 'intake_target_behind')?.message,
      'Behind intake target: 700 of 1600 mL oral intake (incl. 100 mL pending) by 14:00, expected 800. Review.',
    )
  })

  it('[charting/care-plan] Intake target progress: Rounded up', () => {
    const bed = { orders: [target(1550)], entries: [water(1162, nov(3, 9))] }
    assert.deepEqual(read(bed, nov(3, 19, 59)).care.intake_target?.next_check, { at: iso(nov(3, 20)), ml: 1163 })
    assert.equal(
      alert(bed, nov(3, 20), 'intake_target_behind')?.message,
      'Behind intake target: 1162 of 1550 mL oral intake by 20:00, expected 1163. Review.',
    )
  })

  it('[charting/care-plan] Intake target progress: Set after a check', () => {
    const bed = { orders: [target(1600, nov(3, 15))], entries: [water(300, nov(3, 9))] }
    assert.ok(!kinds(bed, nov(3, 15)).includes('intake_target_behind'))
    assert.ok(kinds(bed, nov(3, 20)).includes('intake_target_behind'))
  })

  it('[charting/care-plan] Intake target progress: Held while nil by mouth', () => {
    const entries = [water(600, nov(3, 10)), urine(nov(3, 13))]
    const fasting = kinds({ orders: [target(1600), nbm(nov(3, 12), null)], entries }, nov(3, 14))
    for (const k of ['intake_target_behind', 'logging_gap', 'nil_by_mouth_intake'] as const) assert.ok(!fasting.includes(k), k)
    // The same bed without nil by mouth raises both held prompts.
    const eating = kinds({ orders: [target(1600)], entries }, nov(3, 14))
    assert.ok(eating.includes('intake_target_behind') && eating.includes('logging_gap'))
    // Care prompts join the alerts after the existing ones.
    assert.ok(eating.indexOf('logging_gap') < eating.indexOf('intake_target_behind'), eating.join())
  })

  it('[charting/alerts] Logging gap: Nil by mouth', () => {
    // Last intake 4 h ago; nil by mouth since 3 h ago.
    const entries = [water(200, nov(3, 10)), urine(nov(3, 13))]
    assert.ok(!kinds({ orders: [nbm(nov(3, 11), null)], entries }, nov(3, 14)).includes('logging_gap'))
    // Once nil by mouth is ended, the gap is back.
    assert.ok(kinds({ orders: [nbm(nov(3, 11), null, nov(3, 13, 30))], entries }, nov(3, 14)).includes('logging_gap'))
  })

  it('[charting/care-plan] Care prompts join the alerts: Wording', () => {
    const o = catheter(oct29, nov(1, 10, 30))
    const beds: [Bed, number][] = [
      [{ orders: [limit(1000)], entries: [water(820, nov(3, 9))] }, nov(3, 10)],
      [{ orders: [limit(1000)], entries: [water(1000, nov(3, 9))] }, nov(3, 10)],
      [{ orders: [nbm(nov(3, 6), nov(3, 14))], entries: [water(150, nov(3, 10), { status: 'pending' })] }, nov(3, 14)],
      [{ orders: [thick(2, nov(1, 10))], entries: [water(150, nov(3, 9), { iddsi_level: 0 }), water(400, nov(3, 10))] }, nov(3, 11)],
      [{ orders: [target(1600)], entries: [water(600, nov(3, 13))] }, nov(3, 14)],
      [{ orders: [o] }, nov(3, 9)],
    ]
    const care = beds
      .flatMap(([bed, now]) => read(bed, now).alerts)
      .filter((a) => ALERT_KINDS.indexOf(a.kind) >= ALERT_KINDS.indexOf('nil_by_mouth_intake'))
    assert.deepEqual([...new Set(care.map((a) => a.kind))].sort(), [
      'catheter_review',
      'drink_consistency_unrecorded',
      'drink_too_thin',
      'fluid_limit_near',
      'fluid_limit_reached',
      'intake_target_behind',
      'nil_by_mouth_intake',
      'nil_by_mouth_overdue',
    ])
    for (const a of care) {
      assert.ok(a.message.endsWith('Review.'), a.message)
      assert.ok(!a.message.includes(admission.patient), a.message)
    }
  })

  it('counts the chart day from 08:00, and pending but not rejected intake', () => {
    // 07:59 / 08:00 edge.
    const edge = read({ orders: [limit(1000)], entries: [water(300, nov(3, 7, 59)), water(500, nov(3, 8))] }, nov(3, 10)).care.fluid_limit!
    assert.deepEqual([edge.since, edge.ml], [iso(nov(3, 8)), 500])
    // Approved, pending, rejected, and a voided dinner whose soup was pending (so is now rejected).
    const dinner = meal('dinner', 75, nov(3, 12), { fluid: 150, voided: true })
    const bed = {
      orders: [limit(1000)],
      entries: [
        water(500, nov(3, 9)),
        tea(200, nov(3, 10), { status: 'pending' }),
        water(300, nov(3, 11), { status: 'rejected' }),
        ...dinner.entries,
      ],
      meals: [dinner.meal],
    }
    const mixed = read(bed, nov(3, 13)).care.fluid_limit!
    assert.deepEqual([mixed.ml, mixed.pending_ml], [700, 200])
  })

  it('lists active orders in display order, and a bed with none as empty', () => {
    const c = read({ orders: [catheter(oct29, nov(1, 11)), limit(1000), nbm(nov(3, 6), null)] }, nov(3, 9)).care
    assert.deepEqual(
      c.orders.map((o) => o.kind),
      ['nil_by_mouth', 'fluid_limit', 'catheter'],
    )
    assert.deepEqual(read({}, nov(3, 9)).care, { orders: [], fluid_limit: null, intake_target: null, catheter: null })
  })
})

describe('diet order codec and rule (pure)', () => {
  it('round-trips a diet and reads absent targets as null', () => {
    const renal = { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 } as const
    assert.deepEqual(careValue('diet', careJson('diet', renal)), renal)
    assert.deepEqual(careValue('diet', careJson('diet', { type: 'regular', texture: 6 })), {
      type: 'regular',
      texture: 6,
      kcal: null,
      protein_g: null,
    })
    assert.deepEqual(careValue('diet', JSON.stringify({ type: 'regular', texture: 6 })), {
      type: 'regular',
      texture: 6,
      kcal: null,
      protein_g: null,
    })
    // Absent and null targets store the same JSON, so the same value again is a 200.
    assert.equal(
      careJson('diet', { type: 'regular', texture: 6 }),
      careJson('diet', { type: 'regular', texture: 6, kcal: null, protein_g: null }),
    )
  })

  it('raises no prompt for a diet', () => {
    assert.deepEqual(CARE_RULES.diet({} as Parameters<typeof CARE_RULES.diet>[0]), { alerts: [] })
  })
})
