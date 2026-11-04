import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { urineInWindow, urineWindow, type Admission, type Entry, type EntryCategory } from '@meniscus/shared'
import { alertsFor } from './alerts.ts'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 2, 12)
const admission: Admission = {
  id: 1,
  bed: '1',
  patient: 'Asha Verma',
  weight_kg: 60,
  qr_token: 'x'.repeat(22),
  admitted_at: new Date(NOW - 48 * HOUR).toISOString(),
  ward_id: 1,
  ward_code: '5B',
  ward_name: 'Neurology Ward 5B',
  mrn: 'AT-100001',
}
let nextId = 1
const entry = (category: EntryCategory, volume_ml: number, hoursAgo: number, over: Partial<Entry> = {}): Entry => {
  const created_at = new Date(NOW - hoursAgo * HOUR).toISOString()
  return {
    id: nextId++,
    admission_id: 1,
    direction: ['water', 'food', 'iv'].includes(category) ? 'in' : 'out',
    category,
    volume_ml,
    item: null,
    notes: null,
    source: 'manual',
    confidence: null,
    status: 'approved',
    created_at,
    reviewed_at: null,
    has_photo: false,
    recorded_ml: volume_ml,
    evidence: null,
    recorded_at: created_at,
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
  }
}
const kinds = (entries: Entry[], a: Admission = admission) => alertsFor(a, entries, NOW).map((x) => x.kind)
const recentWater = entry('water', 100, 1)

describe('alert rules', () => {
  it('[charting/alerts] Low urine output: 60 kg patient, 120 mL in 6 h', () => {
    assert.ok(kinds([recentWater, entry('urine', 120, 2), entry('urine', 500, 7)]).includes('low_urine_output'))
  })

  it('[charting/alerts] Low urine output: Enough output', () => {
    assert.ok(!kinds([recentWater, entry('urine', 200, 2)]).includes('low_urine_output'))
  })

  it('[charting/alerts] Low urine output: not before 6 h of admission or without weight', () => {
    const fresh = { ...admission, admitted_at: new Date(NOW - 2 * HOUR).toISOString() }
    assert.ok(!kinds([recentWater], fresh).includes('low_urine_output'))
    assert.ok(!kinds([recentWater], { ...admission, weight_kg: null }).includes('low_urine_output'))
  })

  it('[charting/alerts] Intake and output mismatch: Intake logged', () => {
    const alerts = alertsFor(admission, [entry('water', 1500, 10), entry('food', 600, 1), entry('urine', 120, 2)], NOW)
    const mismatch = alerts.find((a) => a.kind === 'mismatch')
    assert.ok(mismatch)
    assert.match(mismatch.message, /2100 mL/)
    assert.match(mismatch.message, /review/i)
    assert.ok(!alerts.some((a) => a.kind === 'intake_incomplete'))
  })

  it('[charting/alerts] Intake and output mismatch: Intake missing', () => {
    const k = kinds([entry('water', 300, 1), entry('urine', 120, 2)])
    assert.ok(k.includes('intake_incomplete'))
    assert.ok(!k.includes('mismatch'))
  })

  it('[charting/alerts] Fluid overload: Positive balance', () => {
    assert.ok(kinds([entry('iv', 2500, 5), recentWater, entry('urine', 900, 1)]).includes('overload'))
    assert.ok(!kinds([entry('iv', 1000, 5), entry('urine', 900, 1)]).includes('overload'))
  })

  it('[charting/alerts] Logging gap: No intake since morning', () => {
    assert.ok(kinds([entry('water', 200, 4), entry('urine', 400, 1)]).includes('logging_gap'))
    assert.ok(!kinds([entry('water', 200, 2, { status: 'pending' }), entry('urine', 400, 1)]).includes('logging_gap'))
    assert.ok(kinds([entry('water', 200, 1, { status: 'rejected' }), entry('urine', 400, 1)]).includes('logging_gap'))
  })

  it('[charting/alerts] Logging gap: Nil by mouth', () => {
    // Last intake 4 h ago; nil by mouth since 3 h ago.
    const entries = [entry('water', 200, 4), entry('urine', 400, 1)]
    assert.ok(!alertsFor(admission, entries, NOW, { nilByMouth: true }).some((a) => a.kind === 'logging_gap'))
    // Once nil by mouth is ended.
    assert.ok(alertsFor(admission, entries, NOW, { nilByMouth: false }).some((a) => a.kind === 'logging_gap'))
  })

  it('[charting/alerts] Appearance notes: Dark urine noted', () => {
    // 400 mL in the last 6 h is above 0.5 mL/kg/h for 60 kg, so dark and cloudy alone ask for nothing.
    const dark = [recentWater, entry('urine', 400, 1, { notes: 'dark, slightly cloudy', urine_colour: 'dark' })]
    assert.ok(!kinds(dark).includes('low_urine_output'))
    assert.ok(!kinds(dark).includes('appearance'))
    assert.ok(!kinds([recentWater, entry('urine', 400, 1, { notes: 'cloudy' })]).includes('appearance'))
    assert.ok(!kinds([recentWater, entry('urine', 400, 1, { notes: 'pale yellow, clear' })]).includes('appearance'))
    assert.ok(!kinds([entry('water', 400, 1, { item: 'red juice' })]).includes('appearance'))
  })

  it('[charting/alerts] Appearance notes: Red by colour', () => {
    const alerts = alertsFor(admission, [recentWater, entry('urine', 400, 1, { urine_colour: 'red', urine_rgb: '#b3242e' })], NOW)
    assert.equal(alerts.find((a) => a.kind === 'appearance')?.message, 'red noted on 1 output entry. Review.')
  })

  it('[charting/alerts] Appearance notes: Clots noted', () => {
    assert.ok(kinds([recentWater, entry('urine', 400, 1, { status: 'pending', notes: 'small clots' })]).includes('appearance'))
  })

  it('[charting/alerts] Appearance notes: Dark and low', () => {
    const k = kinds([recentWater, entry('urine', 120, 2, { urine_colour: 'dark' }), entry('urine', 500, 7)])
    assert.ok(k.includes('low_urine_output'))
    assert.ok(k.includes('appearance'))
  })

  it('[charting/alerts] Appearance notes: no alerts for a quiet, balanced chart', () => {
    assert.deepEqual(kinds([entry('water', 800, 1), entry('urine', 300, 1), entry('urine', 300, 5)]), [])
  })
})

// ---------- the low-output window (bag-alerts) ----------

/** Local time on `d` Nov 2026. */
const nov = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime()
const isoAt = (ms: number) => new Date(ms).toISOString()
const snap = (id: number, ms: number) => ({
  id,
  volume_ml: 0,
  created_at: isoAt(ms),
  media: null,
  labeled_media: null,
  evidence: null,
  event: 'check' as const,
  residual_ml: null,
})
/** A urine entry charted at `ms`; with `before`, a bag entry spread from that reading. */
const urineAt = (volume_ml: number, ms: number, over: Partial<Entry> & { before?: number | null } = {}): Entry => {
  const { before, ...rest } = over
  return entry('urine', volume_ml, 0, {
    created_at: isoAt(ms),
    recorded_at: isoAt(ms),
    levels: before === undefined ? null : { before: before === null ? null : snap(1, before), after: snap(2, ms) },
    ...rest,
  })
}
const bagEntry = (volume_ml: number, ms: number, before: number | null, over: Partial<Entry> = {}) =>
  urineAt(volume_ml, ms, { before, ...over })

describe('urineWindow and urineInWindow', () => {
  const base = { entries: [] as Entry[], intervalH: 4 }

  it('ends now without a bag reading, at the newest one, and back at now from twice the interval', () => {
    const now = nov(3, 14)
    assert.deepEqual(urineWindow({ ...base, urineBagReadingsAt: [], now }), { from: now - 6 * HOUR, to: now, bagAt: null })
    assert.deepEqual(urineWindow({ ...base, urineBagReadingsAt: [nov(3, 0), nov(3, 8)], now }), {
      from: nov(3, 2),
      to: nov(3, 8),
      bagAt: nov(3, 8),
    })
    assert.equal(urineWindow({ ...base, urineBagReadingsAt: [nov(3, 8)], now: nov(3, 15, 59) }).to, nov(3, 8))
    assert.equal(urineWindow({ ...base, urineBagReadingsAt: [nov(3, 8)], now: nov(3, 16) }).to, nov(3, 16))
  })

  it('back at now after a pending or approved urine entry not charted from a bag reading; a rejected one leaves it', () => {
    const now = nov(3, 12)
    const at = [nov(3, 8)]
    for (const status of ['pending', 'approved'] as const) {
      const w = urineWindow({ ...base, urineBagReadingsAt: at, entries: [urineAt(50, nov(3, 11), { status })], now })
      assert.equal(w.to, now, status)
    }
    const rejected = urineWindow({ ...base, urineBagReadingsAt: at, entries: [urineAt(50, nov(3, 11), { status: 'rejected' })], now })
    assert.equal(rejected.to, nov(3, 8))
    const bag = urineWindow({ ...base, urineBagReadingsAt: at, entries: [bagEntry(50, nov(3, 8), nov(3, 4))], now })
    assert.equal(bag.to, nov(3, 8))
  })

  it('starts 30 h back at a 12 h interval with the newest reading just under 24 h old', () => {
    const now = nov(3, 14)
    const newest = now - 24 * HOUR + 60_000
    const w = urineWindow({ entries: [], intervalH: 12, urineBagReadingsAt: [newest], now })
    assert.equal(w.from, newest - 6 * HOUR)
    assert.ok(now - w.from < 30 * HOUR && now - w.from > 29.9 * HOUR)
  })

  it('spreads a bag entry over the span since its reading before', () => {
    assert.equal(urineInWindow([bagEntry(320, nov(3, 8), nov(3, 0))], nov(3, 2), nov(3, 8)), 240)
  })

  it('counts a first reading whole at its time, in or out of the window', () => {
    const first = bagEntry(300, nov(3, 3), null)
    assert.equal(urineInWindow([first], nov(2, 21), nov(3, 3)), 300)
    assert.equal(urineInWindow([first], nov(3, 3), nov(3, 9)), 0)
  })

  it('rounds once, at the end', () => {
    assert.equal(urineInWindow([bagEntry(239, nov(3, 8), nov(3, 0))], nov(3, 2), nov(3, 8)), 179)
  })

  it('leaves pending and rejected entries out', () => {
    const es = [urineAt(100, nov(3, 7), { status: 'pending' }), urineAt(100, nov(3, 7), { status: 'rejected' }), urineAt(30, nov(3, 7))]
    assert.equal(urineInWindow(es, nov(3, 2), nov(3, 8)), 30)
  })
})

describe('low urine output with bag readings', () => {
  const sixty = (admitted: number, over: Partial<Admission> = {}): Admission => ({
    ...admission,
    ward_code: '3A',
    admitted_at: isoAt(admitted),
    ...over,
  })
  /** The prompt's messages at `now`, as chartView composes it: the window from the bag readings, then the rule. */
  const lowAt = (a: Admission, entries: Entry[], bagAt: number[], intervalH: number, now: number) => {
    const window = urineWindow({ urineBagReadingsAt: bagAt, entries, intervalH, now })
    return alertsFor(a, entries, now, { window })
      .filter((x) => x.kind === 'low_urine_output')
      .map((x) => x.message)
  }
  const twoDays = sixty(nov(1, 0))

  it('[charting/alerts] Low urine output: Window edges', () => {
    const es = [urineAt(100, nov(3, 4)), urineAt(100, nov(3, 9))]
    assert.deepEqual(lowAt(twoDays, es, [], 4, nov(3, 9, 59)), [])
    assert.deepEqual(lowAt(twoDays, es, [], 4, nov(3, 10)), ['Urine output 100 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.'])
  })

  it('[charting/alerts] Low urine output: Window ends at the newest bag reading', () => {
    const es = [bagEntry(320, nov(3, 8), nov(3, 0))]
    const at = [nov(3, 0), nov(3, 8)]
    assert.deepEqual(lowAt(twoDays, es, at, 4, nov(3, 14)), [])
    assert.deepEqual(lowAt(twoDays, es, at, 4, nov(3, 15, 59)), [])
    assert.deepEqual(lowAt(twoDays, es, at, 4, nov(3, 16)), ['Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.'])
  })

  it('[charting/alerts] Low urine output: Spread from the reading before', () => {
    assert.deepEqual(lowAt(twoDays, [bagEntry(200, nov(3, 8), nov(3, 0))], [nov(3, 0), nov(3, 8)], 4, nov(3, 9)), [
      'Urine output 150 mL in the 6 h to the 08:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
  })

  it('[charting/alerts] Low urine output: Rounded to whole mL', () => {
    const at = [nov(3, 0), nov(3, 8)]
    assert.deepEqual(lowAt(twoDays, [bagEntry(239, nov(3, 8), nov(3, 0))], at, 4, nov(3, 9)), [
      'Urine output 179 mL in the 6 h to the 08:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
    assert.deepEqual(lowAt(twoDays, [bagEntry(240, nov(3, 8), nov(3, 0))], at, 4, nov(3, 9)), [])
  })

  it('[charting/alerts] Low urine output: HDU hourly', () => {
    const hdu = sixty(nov(1, 0), { ward_code: 'HDU', weight_kg: 66 })
    const at = [nov(3, 3), ...[4, 5, 6, 7, 8, 9].map((h) => nov(3, h))]
    const es = [4, 5, 6, 7, 8, 9].map((h) => bagEntry(40, nov(3, h), nov(3, h - 1)))
    assert.deepEqual(lowAt(hdu, es, at, 1, nov(3, 10, 59)), [])
    assert.deepEqual(lowAt(hdu, es, at, 1, nov(3, 11)), ['Urine output 160 mL in 6 h, below 198 mL (0.5 mL/kg/h at 66 kg). Review.'])
  })

  it("[charting/alerts] Low urine output: Admitted 6 hours before the window's end", () => {
    const a = sixty(nov(3, 3))
    const es = [bagEntry(100, nov(3, 7), nov(3, 3))]
    const at = [nov(3, 3), nov(3, 7)]
    assert.deepEqual(lowAt(a, es, at, 4, nov(3, 10)), [])
    assert.deepEqual(lowAt(a, es, at, 4, nov(3, 14, 59)), [])
    assert.deepEqual(lowAt(a, es, at, 4, nov(3, 15)), ['Urine output 0 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.'])
  })

  it('[charting/alerts] Low urine output: Urinal after the bag', () => {
    const es = [bagEntry(320, nov(3, 8), nov(3, 0)), urineAt(50, nov(3, 11))]
    assert.deepEqual(lowAt(twoDays, es, [nov(3, 0), nov(3, 8)], 4, nov(3, 12)), [
      'Urine output 130 mL in 6 h, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
  })

  it('[charting/alerts] Low urine output: First reading counted whole', () => {
    const first = bagEntry(300, nov(3, 3), null)
    assert.deepEqual(lowAt(twoDays, [first], [nov(3, 3)], 4, nov(3, 8, 59)), [])
    const es = [first, bagEntry(30, nov(3, 9), nov(3, 3))]
    assert.deepEqual(lowAt(twoDays, es, [nov(3, 3), nov(3, 9)], 4, nov(3, 10)), [
      'Urine output 30 mL in the 6 h to the 09:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
  })

  it('[charting/alerts] Low urine output: Charted 25 hours before', () => {
    const a = sixty(nov(0, 14))
    const es = [bagEntry(240, nov(2, 13), nov(2, 1)), bagEntry(100, nov(2, 18), nov(2, 13))]
    assert.deepEqual(lowAt(a, es, [nov(2, 1), nov(2, 13), nov(2, 18)], 12, nov(3, 14)), [
      'Urine output 120 mL in the 6 h to the 2 Nov 18:00 bag reading, below 180 mL (0.5 mL/kg/h at 60 kg). Review.',
    ])
  })
})
