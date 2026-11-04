/**
 * Bag readings (charting/bag-periods). Pure: readings, orders, the admission and the clock in; rises, periods and prompts
 * out. A reading charts the rise since its baseline, never the raw level; nothing is stored here. No model requests.
 *
 * The readings of one bag are ordered by (charted time, id). A reading's baseline comes from the reading just before it,
 * however old: that reading's level after a check, the residual (0 if none) after an emptying, 0 after a bag change.
 * A level below its baseline is a fall: it charts its whole level from an unknown baseline and starts a new period.
 * `charge` is what a newly saved reading charts so that the charted total always equals Σ rises in time order, without
 * changing any entry already charted (design.md §4).
 */
import {
  BAG_CAPACITY_ML,
  BAG_CONTAINERS,
  BAG_NEARLY_FULL,
  BAG_ORDER,
  DUPLICATE_TOLERANCE_ML,
  DUPLICATE_WITHIN_MIN,
  catheterSince,
  readingInterval,
  type Admission,
  type Alert,
  type BagChart,
  type BagLevel,
  type BagContainer,
  type BagDuplicate,
  type BagEvent,
  type BagPeriod,
  type BagReading,
  type CareOrder,
} from '@meniscus/shared'
import { inForce } from './care.ts'
import { when } from './time.ts'

const HOUR = 3_600_000
const DAY_MS = 24 * HOUR
/** Chart reads load the readings charted in this window, plus each bag's newest one before it (its predecessor). */
export const BAG_WINDOW_MS = 48 * HOUR
/** A reading saved more than this after its charted time is late: the clock skew a charted time may have (SKEW_MS). */
export const LATE_READING_MS = 60_000

/** What the rise depends on. `t` is the charted time (epoch ms). */
export interface Point {
  id: number
  event: BagEvent
  volume_ml: number
  residual_ml: number | null
  t: number
}
export interface Step {
  baseline: number
  rise: number
  fell: boolean
  /** The baseline the level fell below; null unless `fell`. */
  fell_from: number | null
}
export type Stepped<P extends Point> = P & { step: Step }
type Closing = Exclude<BagEvent, 'check'>

export const baselineAfter = (p: Point): number => (p.event === 'check' ? p.volume_ml : p.event === 'emptied' ? (p.residual_ml ?? 0) : 0)

/** `r`'s baseline, rise and fall, after `p` (none: the bag's first reading). */
export function step(p: Point | undefined, r: Point): Step {
  const base = p ? baselineAfter(p) : 0
  return r.volume_ml >= base
    ? { baseline: base, rise: r.volume_ml - base, fell: false, fell_from: null }
    : { baseline: 0, rise: r.volume_ml, fell: true, fell_from: base }
}

/** (charted time, id) order. */
export const byTime = (a: Pick<Point, 'id' | 't'>, b: Pick<Point, 'id' | 't'>): number => a.t - b.t || a.id - b.id

/** One bag's readings in time order, each with its step. Recomputed on every read; never stored. */
export function steps<P extends Point>(rs: readonly P[]): Stepped<P>[] {
  const sorted = [...rs].sort(byTime)
  return sorted.map((r, i) => ({ ...r, step: step(sorted[i - 1], r) }))
}

/**
 * What saving `r` charts, `p` and `n` being the stored readings just before and after its charted time: its own rise,
 * plus the change it makes to `n`'s rise. Never negative while `r` has no residual (design.md §4); 0 or less charts nothing.
 */
export function charge(p: Point | undefined, r: Point, n: Point | undefined): number {
  const own = step(p, r).rise
  return n ? own + step(r, n).rise - step(p, n).rise : own
}

/** `r` is an emptying or bag change saved inside a fall's gap: it clears (or moves) that fall. Nurses and matrons only. */
export const clearsFall = (p: Point | undefined, r: Point, n: Point | undefined): boolean =>
  r.event !== 'check' && n !== undefined && step(p, n).fell

// ---------- duplicates (charting/bag-periods "Duplicate bag reading") ----------

/** A reading as the duplicate check sees it; `t` is the charted time. */
export interface DuplicatePoint {
  id: number
  container: BagContainer
  event: BagEvent
  volume_ml: number
  t: number
}
const DUPLICATE_WITHIN_MS = DUPLICATE_WITHIN_MIN * 60_000

/**
 * The stored reading `r` repeats: same bag and event, within DUPLICATE_TOLERANCE_ML and DUPLICATE_WITHIN_MIN of it (both
 * inclusive, either side); the nearest in time, then the newest id. undefined when none.
 */
export function duplicateOf<P extends DuplicatePoint>(stored: readonly P[], r: Omit<DuplicatePoint, 'id'>): P | undefined {
  let best: P | undefined
  for (const x of stored) {
    if (x.container !== r.container || x.event !== r.event) continue
    if (Math.abs(x.volume_ml - r.volume_ml) > DUPLICATE_TOLERANCE_ML || Math.abs(x.t - r.t) > DUPLICATE_WITHIN_MS) continue
    if (!best) best = x
    else {
      const d = Math.abs(x.t - r.t) - Math.abs(best.t - r.t)
      if (d < 0 || (d === 0 && x.id > best.id)) best = x
    }
  }
  return best
}

/** Save with `confirmed` (the confirmed match's id, or null when nothing matches), or refuse naming the match. */
export type DuplicateDecision = { save: true; confirmed: number | null } | { save: false; match: DuplicatePoint }
export function duplicateDecision(match: DuplicatePoint | undefined, confirm: number | undefined): DuplicateDecision {
  if (!match) return { save: true, confirmed: null }
  return confirm === match.id ? { save: true, confirmed: match.id } : { save: false, match }
}
export const toBagDuplicate = (m: DuplicatePoint): BagDuplicate => ({
  id: m.id,
  event: m.event,
  volume_ml: m.volume_ml,
  created_at: new Date(m.t).toISOString(),
})

export interface PeriodOf<P extends Point> {
  /** The opening emptying or bag change; null when unknown (the bag's first reading, or after a fall). */
  start: number | null
  /** The closing reading; the last reading when a fall followed; null while open. */
  end: number | null
  opened_by: Closing | null
  closed_by: Closing | null
  /** Oldest first; only those charted at or after `since`. */
  readings: Stepped<P>[]
  total_ml: number
  rate_ml_h: number | null
}

/**
 * Periods between emptyings, oldest first. Readings before `since` only shape the periods (predecessors); a period with no
 * reading left is dropped. Rate: total over the hours from the start to the last reading, whole mL; null with no start or length.
 */
export function periods<P extends Point>(st: readonly Stepped<P>[], since = -Infinity): PeriodOf<P>[] {
  type Draft = { opened: Stepped<P> | null; openedBy: Closing | null; readings: Stepped<P>[] }
  const done: (Draft & { closedBy: Closing | null; fellAfter: boolean })[] = []
  let cur: Draft = { opened: null, openedBy: null, readings: [] }
  for (const r of st) {
    if (r.step.fell) {
      if (cur.readings.length) done.push({ ...cur, closedBy: null, fellAfter: true })
      cur = { opened: null, openedBy: null, readings: [] }
    }
    cur.readings.push(r)
    if (r.event !== 'check') {
      done.push({ ...cur, closedBy: r.event, fellAfter: false })
      cur = { opened: r, openedBy: r.event, readings: [] }
    }
  }
  if (cur.readings.length) done.push({ ...cur, closedBy: null, fellAfter: false })
  return done.flatMap((d) => {
    const readings = d.readings.filter((r) => r.t >= since)
    const last = readings.at(-1)
    if (!last) return []
    const start = d.opened?.t ?? null
    const total = readings.reduce((s, r) => s + r.step.rise, 0)
    const span = start === null ? 0 : last.t - start
    return [
      {
        start,
        end: d.closedBy || d.fellAfter ? last.t : null,
        opened_by: d.openedBy,
        closed_by: d.closedBy,
        readings,
        total_ml: total,
        // Under 15 minutes a rate would mislead (450 mL over 17 s reads as 93168 mL/h): none.
        rate_ml_h: span >= RATE_MIN_SPAN_MS ? Math.round(total / (span / HOUR)) : null,
      },
    ]
  })
}

/** The shortest period given a rate (charting/bag-periods "Bag periods on the chart read"). */
const RATE_MIN_SPAN_MS = 15 * 60_000

// ---------- readings as returned ----------

/** A stored reading, before its step is worked out from its neighbours. */
export type StoredBagReading = Omit<BagReading, 'baseline_ml' | 'rise_ml' | 'fell' | 'fell_from_ml'>
const pointOf = <R extends StoredBagReading>(r: R): R & { t: number } => ({ ...r, t: Date.parse(r.created_at) })
const iso = (ms: number) => new Date(ms).toISOString()

/** Explicit fields, in BagReading's order. */
function toBagReading(r: Stepped<StoredBagReading & { t: number }>): BagReading {
  return {
    id: r.id,
    container: r.container,
    event: r.event,
    volume_ml: r.volume_ml,
    baseline_ml: r.step.baseline,
    rise_ml: r.step.rise,
    fell: r.step.fell,
    fell_from_ml: r.step.fell_from,
    residual_ml: r.residual_ml,
    source: r.source,
    media: r.media,
    labeled_media: r.labeled_media,
    proof_media: r.proof_media,
    evidence: r.evidence,
    created_by: r.created_by,
    created_at: r.created_at,
    recorded_at: r.recorded_at,
    late: r.late,
    entry: r.entry,
    confirmed_duplicate_of: r.confirmed_duplicate_of,
  }
}

/** `r` as returned, with `prev` (the reading just before it, if any) as its predecessor. */
export const bagReadingAfter = (prev: StoredBagReading | undefined, r: StoredBagReading): BagReading => {
  const p = pointOf(r)
  return toBagReading({ ...p, step: step(prev && pointOf(prev), p) })
}

const BAG_NAME: Record<BagContainer, string> = { urine_bag: 'Urine bag', stoma_bag: 'Stoma bag', drain_bag: 'Drain bag' }
/** The order each bag's `bag_without_device` names as missing. */
const DEVICE_WORD: Record<(typeof BAG_ORDER)[BagContainer], string> = { catheter: 'catheter', stoma: 'stoma', drain: 'drain' }

/** The item of the entry a reading charts: `urine bag: 150 → 260 mL` (baseline → level). */
export const bagItem = (container: BagContainer, s: Step, level: number): string =>
  s.fell
    ? `${BAG_NAME[container].toLowerCase()}: ${s.fell_from} → ${level} mL, level fell`
    : `${BAG_NAME[container].toLowerCase()}: ${s.baseline} → ${level} mL`

// ---------- the chart read ----------

export interface BagChartInput {
  /** The bed's readings charted since now − BAG_WINDOW_MS, plus each bag's newest one before that; any order. */
  readings: StoredBagReading[]
  /**
   * Active orders and those ended in the last 24 h: the active catheter's interval, and the bag orders in force at each
   * reading of the last 24 h (`bag_without_device`).
   */
  orders: CareOrder[]
  /** The admission's full catheter history, for the active catheter's start (`catheterSince`); default `orders`. */
  catheterHistory?: readonly CareOrder[]
  admission: Pick<Admission, 'ward_code'>
  now: number
}

/** The admission's active catheter order among `orders`, if any. */
export const activeCatheter = (orders: readonly CareOrder[]): CareOrder<'catheter'> | undefined =>
  orders.find((o): o is CareOrder<'catheter'> => o.kind === 'catheter' && o.end_at === null)

/**
 * The bed's bag periods (each bag's with a reading charted in the last 24 h, newest first, bags in BAG_CONTAINERS order)
 * and its bag prompts: reading due or overdue (urine bag, active catheter order, counted from the catheter's start), then
 * one per fall charted in the last 24 h, then nearly full (a bag's newest reading a check at BAG_NEARLY_FULL of capacity),
 * then one `bag_without_device` per bag read in the last 24 h while no order for it was in force, and none active now.
 */
export function bagChart({ readings, orders, catheterHistory, admission, now }: BagChartInput): {
  bags: BagChart
  alerts: Alert[]
  levels: BagLevel[]
} {
  const catheter = activeCatheter(orders)
  const interval = readingInterval(admission, catheter?.value)
  const out: BagPeriod[] = []
  const falls: Alert[] = []
  const full: Alert[] = []
  const missing: Alert[] = []
  const levels: BagLevel[] = []
  let newestUrine: number | undefined
  for (const container of BAG_CONTAINERS) {
    const st = steps(readings.filter((r) => r.container === container).map(pointOf))
    if (container === 'urine_bag') newestUrine = st.at(-1)?.t
    const recent = periods(st, now - BAG_WINDOW_MS).filter((p) => p.readings.some((r) => now - r.t < DAY_MS))
    for (const p of recent.reverse()) {
      out.push({
        container,
        start_at: p.start === null ? null : iso(p.start),
        end_at: p.end === null ? null : iso(p.end),
        opened_by: p.opened_by,
        closed_by: p.closed_by,
        readings: p.readings.map(toBagReading),
        total_ml: p.total_ml,
        rate_ml_h: p.rate_ml_h,
      })
    }
    for (const r of st) {
      if (!r.step.fell || now - r.t >= DAY_MS) continue
      falls.push({
        kind: 'bag_level_fell',
        message: `${BAG_NAME[container]} level fell from ${r.step.fell_from} to ${r.volume_ml} mL with no emptying recorded. Was it emptied? Review.`,
        entry_ids: r.entry ? [r.entry.id] : [],
        meal_ids: [],
      })
    }
    const newest = st.at(-1)
    const capacity = BAG_CAPACITY_ML[container]
    // charting/bag-periods "Bag levels on the bed list": the newest reading charted in the last 24 h.
    if (newest && now - newest.t < DAY_MS) {
      levels.push({ container, level_ml: baselineAfter(newest), capacity_ml: capacity, read_at: iso(newest.t), due_at: null })
    }
    if (newest && newest.event === 'check' && newest.volume_ml >= BAG_NEARLY_FULL * capacity && now - newest.t < DAY_MS) {
      full.push({
        kind: 'bag_nearly_full',
        message: `${BAG_NAME[container]} nearly full: ${newest.volume_ml} of ${capacity} mL at ${when(newest.t, now)}. Review.`,
      })
    }
    // charting/bag-periods "Bag reading without the device": readings of the last 24 h with no order for this bag in force.
    const kind = BAG_ORDER[container]
    const own = orders.filter((o) => o.kind === kind)
    if (!own.some((o) => o.end_at === null)) {
      const unordered = st.filter((r) => now - r.t < DAY_MS && r.t <= now && !own.some((o) => inForce(o, r.t))).at(-1)
      if (unordered) {
        missing.push({
          kind: 'bag_without_device',
          message: `${BAG_NAME[container]} reading at ${when(unordered.t, now)}, but no ${DEVICE_WORD[kind]} is on the care plan. Review.`,
        })
      }
    }
  }
  const alerts: Alert[] = []
  if (catheter) {
    // The catheter's start, not this order row's: changing only the interval starts a new row (design.md §7).
    const start = Date.parse(catheterSince(catheterHistory ?? orders, catheter)[0]!.start_at)
    const since = Math.max(newestUrine ?? start, start)
    const label =
      newestUrine !== undefined && newestUrine >= start
        ? `last ${when(since, now)}`
        : `no reading since the catheter order at ${when(since, now)}`
    const h = interval.h * HOUR
    const urine = levels.find((l) => l.container === 'urine_bag')
    if (urine) urine.due_at = iso(since + h)
    if (now - since >= 2 * h) alerts.push({ kind: 'bag_reading_overdue', message: `Urine bag reading overdue (${label}). Review.` })
    else if (now - since > h) alerts.push({ kind: 'bag_reading_due', message: `Urine bag reading due (${label}). Review.` })
  }
  return {
    bags: { interval_h: interval.h, interval_from: interval.from, periods: out },
    alerts: [...alerts, ...falls, ...full, ...missing],
    levels,
  }
}
