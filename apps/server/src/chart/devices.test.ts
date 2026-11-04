/** Output devices (charting/care-plan) and the unmeasured-urine hold (charting/alerts), as pure rules. No model requests. */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  outputDevices,
  type Admission,
  type CareKind,
  type CareOrder,
  type CareValues,
  type Entry,
  type EntryCategory,
  type StaffRef,
} from '@meniscus/shared'
import { careChart } from './care.ts'

const MIN = 60_000
const HOUR = 60 * MIN
/** Local time on `d` Nov 2026. */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

const NURSE: StaffRef = { id: 4, name: 'Anita Thomas', role: 'nurse' }
/** 3A bed 7, 60 kg, admitted 2 days before 10:00 on 3 Nov. */
const bed7: Admission = {
  id: 13,
  bed: '7',
  patient: 'Hugo Martin',
  weight_kg: 60,
  qr_token: 'x'.repeat(22),
  admitted_at: iso(nov(1, 10)),
  ward_id: 2,
  ward_code: '3A',
  ward_name: 'General Medicine 3A',
  mrn: 'AT-100307',
}

let nextId = 1
const order = <K extends CareKind>(kind: K, value: CareValues[K], start: number, end: number | null = null) =>
  ({
    id: nextId++,
    admission_id: bed7.id,
    kind,
    value,
    start_at: iso(start),
    end_at: end === null ? null : iso(end),
    set_by: NURSE,
    ended_by: end === null ? null : NURSE,
  }) as CareOrder
const IN: readonly EntryCategory[] = ['water', 'food', 'iv']
const entry = (category: EntryCategory, volume_ml: number, at: number, over: Partial<Entry> = {}): Entry => ({
  id: nextId++,
  admission_id: bed7.id,
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
const alerts = (orders: CareOrder[], entries: Entry[], now: number) =>
  careChart({
    admission: bed7,
    entries: [...entries].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    meals: [],
    orders,
    reviews: [],
    now,
  }).alerts
const kinds = (orders: CareOrder[], entries: Entry[], now: number) => alerts(orders, entries, now).map((a) => a.kind)
const voiding = (method: CareValues['voiding']['method'], start = nov(1, 11), end: number | null = null) =>
  order('voiding', { method }, start, end)
const catheter = (start: number) => order('catheter', { type: 'urethral', inserted_at: iso(start), measure_every_h: null }, start)

describe('outputDevices (pure)', () => {
  it('[charting/care-plan] Output devices on chart reads: Fresh store', () => {
    assert.deepEqual(outputDevices([]), { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] })
  })

  it('[charting/care-plan] Output devices on chart reads: Catheter over the voiding order', () => {
    const commode = voiding('commode', nov(3, 9))
    assert.deepEqual(outputDevices([commode]), { urine: 'commode', urine_from: 'voiding', urine_measured: true, bags: [] })
    const cath = catheter(nov(3, 10))
    assert.deepEqual(outputDevices([commode, cath]), {
      urine: 'catheter',
      urine_from: 'catheter',
      urine_measured: true,
      bags: ['urine_bag'],
    })
    // Ended orders are not on record.
    const ended = { ...cath, end_at: iso(nov(3, 16)) } as CareOrder
    assert.deepEqual(outputDevices([commode, ended]), { urine: 'commode', urine_from: 'voiding', urine_measured: true, bags: [] })
  })

  it('[charting/care-plan] Output devices on chart reads: Stoma and drain', () => {
    const orders = [order('stoma', { type: 'ileostomy' }, nov(3, 9)), order('drain', { site: 'abdominal' }, nov(3, 9)), catheter(nov(3, 9))]
    assert.deepEqual(outputDevices(orders).bags, ['urine_bag', 'stoma_bag', 'drain_bag'])
  })

  it('[charting/care-plan] Output devices on chart reads: Toilet', () => {
    assert.deepEqual(outputDevices([voiding('toilet')]), { urine: 'toilet', urine_from: 'voiding', urine_measured: false, bags: [] })
    assert.equal(outputDevices([voiding('pads')]).urine_measured, false)
  })
})

describe('urine not measured', () => {
  const NOW = nov(3, 10)
  /** 1600 mL of approved intake in the last 24 h, and no urine in the last 6 h. */
  const drinks = [entry('water', 800, NOW - 20 * HOUR), entry('water', 800, NOW - 3 * HOUR)]

  it('[charting/alerts] Urine not measured: Toilet, not measured', () => {
    const held = ['low_urine_output', 'mismatch', 'intake_incomplete']
    // The rule fires on a measured bed with the same entries, so the hold is what removes it.
    assert.ok(kinds([], drinks, NOW).includes('low_urine_output'))
    for (const method of ['toilet', 'pads'] as const) {
      const ks = kinds([voiding(method)], drinks, NOW)
      assert.deepEqual(
        ks.filter((k) => held.includes(k)),
        [],
        method,
      )
    }
  })

  it('[charting/alerts] Urine not measured: Measured again', () => {
    const toilet = voiding('toilet', nov(1, 11), nov(3, 10))
    const commode = voiding('commode', nov(3, 10))
    const low = alerts([toilet, commode], drinks, nov(3, 10, 1)).find((a) => a.kind === 'low_urine_output')
    assert.equal(low?.message, 'Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.')
  })

  it('[charting/alerts] Urine not measured: Catheter on a toilet bed', () => {
    const orders = [voiding('toilet'), catheter(nov(3, 8))]
    assert.equal(outputDevices(orders).urine_measured, true)
    assert.ok(kinds(orders, drinks, NOW).includes('low_urine_output'))
  })

  it('[charting/alerts] Low urine output: Commode and bedpan entries count', () => {
    const entries = [
      entry('urine', 120, nov(3, 6), { item: 'commode pan' }),
      entry('urine', 80, nov(3, 9), { item: 'bedpan' }),
      entry('water', 300, nov(3, 9, 30)),
    ]
    assert.ok(!kinds([voiding('commode')], entries, NOW).includes('low_urine_output'))
  })

  it('[charting/alerts] Fluid overload: Toilet bed drinking well', () => {
    const intake = [entry('water', 1200, NOW - 10 * HOUR), entry('water', 1200, NOW - 2 * HOUR)]
    assert.ok(!kinds([voiding('toilet')], intake, NOW).includes('overload'))
    assert.ok(kinds([voiding('commode')], intake, NOW).includes('overload'))
  })
})
