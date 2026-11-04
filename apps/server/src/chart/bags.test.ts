import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catheterSince, emptiedByDefault, readingInterval, type BagEvent, type CareOrder } from '@meniscus/shared'
import { byTime, charge, clearsFall, duplicateDecision, duplicateOf, periods, steps, type DuplicatePoint, type Point } from './bags.ts'

const HOUR = 3_600_000
/** Hours (and minutes) after an arbitrary midnight. */
const h = (hours: number, minutes = 0) => hours * HOUR + minutes * 60_000

type Reading = Point
let nextId = 1
const reading = (t: number, event: BagEvent, volume_ml: number, residual_ml: number | null = null): Reading => ({
  id: nextId++,
  t,
  event,
  volume_ml,
  residual_ml,
})

/** The readings just before and after `r` in (charted time, id) order, among those already stored. */
function neighbours(stored: Reading[], r: Reading) {
  const sorted = [...stored].sort(byTime)
  const before = sorted.filter((s) => byTime(s, r) < 0)
  const after = sorted.filter((s) => byTime(s, r) > 0)
  return { p: before.at(-1), n: after[0] }
}

/** Saves the readings in the order given, as the store does: the Δ each charts. */
function save(order: Reading[]) {
  const stored: Reading[] = []
  const charged: number[] = []
  for (const r of order) {
    const { p, n } = neighbours(stored, r)
    charged.push(charge(p, r, n))
    stored.push(r)
  }
  return { stored, charged }
}

const rises = (rs: Reading[]) => steps(rs).map((s) => s.step.rise)
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

describe('bag steps and charge', () => {
  it('worked timeline, row by row', () => {
    const r = [
      reading(h(8), 'emptied', 600),
      reading(h(9), 'check', 150),
      reading(h(11), 'emptied', 380),
      reading(h(10), 'check', 260), // saved 11:30, late
      reading(h(12), 'check', 100),
      reading(h(15), 'check', 500),
      reading(h(18), 'check', 150), // fell from 500
      reading(h(16, 30), 'emptied', 550), // saved 18:20, a missed emptying
    ]
    const { stored, charged } = save(r)
    assert.deepEqual(charged, [600, 150, 230, 0, 100, 400, 150, 50])
    assert.equal(sum(charged), 1680)
    assert.deepEqual(rises(stored), [600, 150, 110, 120, 100, 400, 50, 150])
    assert.equal(sum(rises(stored)), 1680)
    // The 16:30 emptying cleared the fall: the 18:00 reading's baseline is now 0, after the emptying.
    const at18 = steps(stored).find((s) => s.t === h(18))!.step
    assert.deepEqual(at18, { baseline: 0, rise: 150, fell: false, fell_from: null })
  })

  it('worked timeline, the 450 mL variant of the 16:30 row', () => {
    const r = [
      reading(h(8), 'emptied', 600),
      reading(h(9), 'check', 150),
      reading(h(11), 'emptied', 380),
      reading(h(10), 'check', 260),
      reading(h(12), 'check', 100),
      reading(h(15), 'check', 500),
      reading(h(18), 'check', 150),
      reading(h(16, 30), 'emptied', 450),
    ]
    const { stored, charged } = save(r)
    assert.equal(charged.at(-1), 450)
    const st = steps(stored)
    assert.deepEqual(st.find((s) => s.t === h(16, 30))!.step, { baseline: 0, rise: 450, fell: true, fell_from: 500 })
    assert.equal(st.find((s) => s.t === h(18))!.step.fell, false)
    assert.equal(sum(charged), sum(rises(stored)))
  })

  it('a late emptying between two checks', () => {
    const { stored, charged } = save([reading(h(9), 'check', 150), reading(h(11), 'check', 380), reading(h(10), 'emptied', 260)])
    assert.deepEqual(charged, [150, 230, 260])
    assert.equal(sum(charged), 640)
    assert.deepEqual(rises(stored), [150, 110, 380])
  })

  it('a fall to 0, and below a residual', () => {
    const toEmpty = steps([reading(h(9), 'check', 500), reading(h(12), 'check', 0)])
    assert.deepEqual(toEmpty[1]!.step, { baseline: 0, rise: 0, fell: true, fell_from: 500 })
    const belowResidual = steps([reading(h(8), 'emptied', 600, 30), reading(h(9), 'check', 20)])
    assert.deepEqual(belowResidual[1]!.step, { baseline: 0, rise: 20, fell: true, fell_from: 30 })
  })

  it('the residual is the next baseline, and a bag change resets it to 0', () => {
    const residual = steps([reading(h(8), 'emptied', 600, 30), reading(h(10), 'check', 200)])
    assert.deepEqual(residual[1]!.step, { baseline: 30, rise: 170, fell: false, fell_from: null })
    const changed = steps([reading(h(8), 'check', 300), reading(h(12), 'bag_changed', 900), reading(h(13), 'check', 100)])
    assert.deepEqual(
      changed.map((s) => s.step.baseline),
      [0, 300, 0],
    )
    assert.deepEqual(
      changed.map((s) => s.step.rise),
      [300, 600, 100],
    )
  })

  it('no lookback: a predecessor 49 hours old still sets the baseline', () => {
    const st = steps([reading(h(8), 'check', 400), reading(h(8) + h(49), 'check', 700)])
    assert.deepEqual(st[1]!.step, { baseline: 400, rise: 300, fell: false, fell_from: null })
  })

  it('equal charted times are ordered by id', () => {
    const a = reading(h(8), 'emptied', 600)
    const b = reading(h(8), 'check', 100)
    assert.deepEqual(
      steps([b, a]).map((s) => s.id),
      [a.id, b.id],
    )
    assert.equal(steps([b, a])[1]!.step.baseline, 0)
  })

  it('clearsFall only for an emptying or bag change whose next reading fell', () => {
    const p = reading(h(9), 'check', 500)
    const n = reading(h(12), 'check', 150)
    assert.equal(clearsFall(p, reading(h(10), 'emptied', 550), n), true)
    assert.equal(clearsFall(p, reading(h(10), 'bag_changed', 0), n), true)
    assert.equal(clearsFall(p, reading(h(10), 'check', 550), n), false)
    // The next reading did not fall from the one before.
    assert.equal(clearsFall(p, reading(h(10), 'emptied', 550), reading(h(12), 'check', 600)), false)
    // No next reading.
    assert.equal(clearsFall(p, reading(h(13), 'emptied', 550), undefined), false)
  })

  it('property: every Δ ≥ 0, and the charted total equals Σ rises in time order', () => {
    // Deterministic PRNG (mulberry32), so a failure reproduces.
    let seed = 0x5eed
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
    const events = ['check', 'emptied', 'bag_changed'] as const
    for (let round = 0; round < 400; round++) {
      const count = 1 + Math.floor(rand() * 9)
      const rs = Array.from({ length: count }, () => reading(Math.floor(rand() * 12) * HOUR, pick(events), Math.floor(rand() * 1001)))
      // A random save order.
      const order = [...rs].sort(() => rand() - 0.5)
      const stored: Reading[] = []
      let charged = 0
      for (const r of order) {
        const { p, n } = neighbours(stored, r)
        const d = charge(p, r, n)
        assert.ok(d >= 0, `Δ ${d} < 0 in round ${round}`)
        charged += d
        stored.push(r)
        // Sometimes a residual is recorded on the newest reading, while it is an emptying (the after-emptying route).
        const newest = [...stored].sort(byTime).at(-1)!
        if (newest.event === 'emptied' && newest.residual_ml === null && rand() < 0.3) {
          newest.residual_ml = Math.floor(rand() * (newest.volume_ml + 1))
        }
        assert.equal(charged, sum(rises(stored)), `round ${round}`)
      }
    }
  })
})

describe('bag periods', () => {
  it('unknown start, closed by an emptying, rate 95', () => {
    const st = steps([
      reading(h(8), 'emptied', 600),
      reading(h(10), 'check', 150),
      reading(h(11), 'check', 260),
      reading(h(12), 'emptied', 380),
    ])
    const ps = periods(st)
    assert.equal(ps.length, 2)
    const [first, second] = ps
    assert.deepEqual(
      {
        start: first!.start,
        end: first!.end,
        opened: first!.opened_by,
        closed: first!.closed_by,
        total: first!.total_ml,
        rate: first!.rate_ml_h,
      },
      { start: null, end: h(8), opened: null, closed: 'emptied', total: 600, rate: null },
    )
    assert.deepEqual(
      {
        start: second!.start,
        end: second!.end,
        opened: second!.opened_by,
        closed: second!.closed_by,
        total: second!.total_ml,
        rate: second!.rate_ml_h,
      },
      { start: h(8), end: h(12), opened: 'emptied', closed: 'emptied', total: 380, rate: 95 },
    )
    assert.deepEqual(
      second!.readings.map((r) => r.step.rise),
      [150, 110, 120],
    )
  })

  it('emptied early: rate 88 over its own 2.5 hours', () => {
    const [, p] = periods(steps([reading(h(8), 'emptied', 600), reading(h(10, 30), 'emptied', 220)]))
    assert.deepEqual([p!.total_ml, p!.rate_ml_h], [220, 88])
  })

  it('open period', () => {
    const ps = periods(steps([reading(h(12), 'emptied', 380), reading(h(13), 'check', 150)]))
    const open = ps.at(-1)!
    assert.deepEqual([open.start, open.end, open.closed_by, open.total_ml], [h(12), null, null, 150])
  })

  it('ended by a fall: the period ends at its last reading, and the fall starts one with no known start', () => {
    const ps = periods(steps([reading(h(6), 'emptied', 300), reading(h(9), 'check', 500), reading(h(12), 'check', 150)]))
    assert.equal(ps.length, 3)
    assert.deepEqual([ps[1]!.start, ps[1]!.end, ps[1]!.closed_by, ps[1]!.total_ml], [h(6), h(9), null, 500])
    assert.deepEqual([ps[2]!.start, ps[2]!.end, ps[2]!.opened_by, ps[2]!.total_ml, ps[2]!.rate_ml_h], [null, null, null, 150, null])
  })

  it('a fall straight after an emptying starts a period with no known start', () => {
    const ps = periods(steps([reading(h(8), 'emptied', 600, 30), reading(h(9), 'check', 20)]))
    assert.equal(ps.length, 2)
    assert.deepEqual([ps[1]!.start, ps[1]!.opened_by, ps[1]!.total_ml], [null, null, 20])
  })

  it('no length: rate null', () => {
    const ps = periods(steps([reading(h(8), 'emptied', 600), reading(h(8), 'bag_changed', 0)]))
    const p = ps.at(-1)!
    assert.deepEqual([p.start, p.end, p.closed_by, p.total_ml, p.rate_ml_h], [h(8), h(8), 'bag_changed', 0, null])
  })

  it('readings before the window only serve as predecessors', () => {
    const st = steps([reading(h(1), 'check', 100), reading(h(9), 'check', 300), reading(h(10), 'emptied', 450)])
    const [p] = periods(st, h(5))
    assert.deepEqual(
      p!.readings.map((r) => r.t),
      [h(9), h(10)],
    )
    assert.deepEqual([p!.start, p!.total_ml], [null, 350])
  })
})

describe('reading interval', () => {
  it('HDU hourly, every other ward 4-hourly, by default', () => {
    assert.deepEqual(readingInterval({ ward_code: 'HDU' }), { h: 1, from: 'default' })
    assert.deepEqual(readingInterval({ ward_code: '3A' }), { h: 4, from: 'default' })
    assert.equal(emptiedByDefault({ h: 1, from: 'default' }), false)
    assert.equal(emptiedByDefault({ h: 4, from: 'default' }), true)
  })
})

describe('catheter reading interval', () => {
  it("the catheter order's measure_every_h wins over the ward default", () => {
    assert.deepEqual(readingInterval({ ward_code: '3A' }, { measure_every_h: 1 }), { h: 1, from: 'catheter' })
    assert.deepEqual(readingInterval({ ward_code: 'HDU' }, { measure_every_h: 4 }), { h: 4, from: 'catheter' })
    assert.deepEqual(readingInterval({ ward_code: '3A' }, { measure_every_h: null }), { h: 4, from: 'default' })
    assert.deepEqual(readingInterval({ ward_code: '3A' }, null), { h: 4, from: 'default' })
    assert.deepEqual(readingInterval({ ward_code: '3A' }), { h: 4, from: 'default' })
  })
})

describe('catheterSince', () => {
  const T0 = Date.UTC(2026, 10, 1, 8)
  const iso = (hours: number) => new Date(T0 + hours * HOUR).toISOString()
  const INSERTED = iso(-48)
  let id = 100
  const cath = (start: number, end: number | null, over: Partial<CareOrder<'catheter'>['value']> = {}): CareOrder<'catheter'> => ({
    id: id++,
    admission_id: 1,
    kind: 'catheter',
    value: { type: 'urethral', inserted_at: INSERTED, measure_every_h: null, ...over },
    start_at: iso(start),
    end_at: end === null ? null : iso(end),
    set_by: null,
    ended_by: null,
  })
  const ids = (os: CareOrder[]) => os.map((o) => o.id)

  it('walks back through orders of the same type and insertion that end where the next starts', () => {
    const a = cath(0, 5)
    const b = cath(5, 9, { measure_every_h: 2 })
    const c = cath(9, null, { measure_every_h: 1 })
    assert.deepEqual(ids(catheterSince([c, a, b], c)), [a.id, b.id, c.id])
  })

  it('a type change starts a new catheter', () => {
    const a = cath(0, 5, { type: 'suprapubic' })
    const b = cath(5, 9)
    const c = cath(9, null, { measure_every_h: 2 })
    assert.deepEqual(ids(catheterSince([a, b, c], c)), [b.id, c.id])
  })

  it('a gap, or another insertion time, starts a new catheter', () => {
    const a = cath(0, 4)
    const b = cath(5, null)
    assert.deepEqual(ids(catheterSince([a, b], b)), [b.id])
    const x = cath(10, 12, { inserted_at: iso(-24) })
    const y = cath(12, null)
    assert.deepEqual(ids(catheterSince([x, y], y)), [y.id])
  })

  it('reaches an order that ended more than 24 hours ago', () => {
    const a = cath(-30, -26)
    const b = cath(-26, null, { measure_every_h: 2 })
    assert.deepEqual(ids(catheterSince([a, b], b)), [a.id, b.id])
  })
})

describe('duplicateOf', () => {
  const MIN = 60_000
  let did = 1
  const r = (t: number, volume_ml: number, over: Partial<DuplicatePoint> = {}): DuplicatePoint => ({
    id: did++,
    container: 'urine_bag',
    event: 'emptied',
    volume_ml,
    t,
    ...over,
  })
  const at11 = h(11)
  const posted = (t: number, volume_ml: number, over: Partial<DuplicatePoint> = {}) => ({
    container: 'urine_bag' as const,
    event: 'emptied' as const,
    volume_ml,
    t,
    ...over,
  })

  it('same event at ±25 mL and ±10 min inclusive matches', () => {
    const x = r(at11, 380)
    for (const [t, ml] of [
      [at11 + 10 * MIN, 405],
      [at11 - 10 * MIN, 355],
    ] as const)
      assert.equal(duplicateOf([x], posted(t, ml)), x)
  })

  it('26 mL, 10 min 1 s, another event and another container do not', () => {
    const x = r(at11, 380)
    assert.equal(duplicateOf([x], posted(at11, 406)), undefined)
    assert.equal(duplicateOf([x], posted(at11, 354)), undefined)
    assert.equal(duplicateOf([x], posted(at11 + 10 * MIN + 1000, 380)), undefined)
    assert.equal(duplicateOf([x], posted(at11 - 10 * MIN - 1000, 380)), undefined)
    assert.equal(duplicateOf([x], posted(at11, 380, { event: 'check' })), undefined)
    assert.equal(duplicateOf([x], posted(at11, 380, { container: 'stoma_bag' })), undefined)
  })

  it('with several matches, the nearest in time wins, then the newest id', () => {
    const far = r(at11 - 5 * MIN, 380)
    const near = r(at11 - 1 * MIN, 380)
    assert.equal(duplicateOf([near, far], posted(at11, 380)), near)
    const older = r(at11 + 2 * MIN, 380)
    const newer = r(at11 - 2 * MIN, 380)
    assert.equal(duplicateOf([newer, older], posted(at11, 380)), newer)
  })

  it('the save decision', () => {
    const x = r(at11, 380)
    assert.deepEqual(duplicateDecision(undefined, undefined), { save: true, confirmed: null })
    assert.deepEqual(duplicateDecision(undefined, 5), { save: true, confirmed: null })
    assert.deepEqual(duplicateDecision(x, x.id), { save: true, confirmed: x.id })
    assert.deepEqual(duplicateDecision(x, x.id + 1), { save: false, match: x })
    assert.deepEqual(duplicateDecision(x, undefined), { save: false, match: x })
  })
})
