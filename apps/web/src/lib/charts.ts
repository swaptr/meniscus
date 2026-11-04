/** Series maths for the bed charts, the ward activity strip and the print sheet. Pure; `now` is injected. */
import { clock } from './format.ts'
import {
  ENTRY_CATEGORIES,
  FLUID_LIMIT_WARN,
  INTAKE_TARGET_CHECKS,
  SCOPE_CATEGORIES,
  urineInWindow,
  urineWindow,
  type BagChart,
  type CareStatus,
  type DrinkKind,
  type Entry,
  type EntryCategory,
  type HourlySeries,
  type OutputDevices,
  type UrineWindow,
} from '@meniscus/shared'
import { when } from './care.ts'
import { drinkTotals } from './drinks.ts'
import { entrySwatch, NO_COLOUR, NO_COLOUR_LABEL } from './urine.ts'
import { signed } from './volume.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const PHOTO_STRIP_MAX = 12
export const URINE_WINDOW_H = 6
export const URINE_THRESHOLD = 0.5

const at = (e: Entry) => Date.parse(e.created_at)
// Same window as the server totals: charted at or after now - 24 h, including entries a little ahead of this device's clock.
const lastDay = (entries: readonly Entry[], now: number) => entries.filter((e) => at(e) >= now - DAY)
const approvedDay = (entries: readonly Entry[], now: number) => lastDay(entries, now).filter((e) => e.status === 'approved')

export interface Point {
  t: number
  v: number
}

/** While urine is not measured, the output leaves urine out (web/ward "Fluid balance chart", "Printable daily chart"). */
export const UNMEASURED_NOTE = 'Urine not measured'

/** The note under a bed card's balance: `Urine not measured` while it is not, else none. */
export const balanceNote = (devices: Pick<OutputDevices, 'urine_measured'>): string | null =>
  devices.urine_measured ? null : UNMEASURED_NOTE
const measured = (devices?: Pick<OutputDevices, 'urine_measured'>) => devices?.urine_measured ?? true

/**
 * Cumulative approved intake and output over 24 h: one step per entry, starting at 0. `outLabel` names the output line
 * (`Output (urine not measured)` while urine is not measured, else `Out`); `note` follows the balance, or is null.
 */
export function cumulative(entries: readonly Entry[], now: number, devices?: Pick<OutputDevices, 'urine_measured'>) {
  const sorted = approvedDay(entries, now).toSorted((a, b) => at(a) - at(b) || a.id - b.id)
  const line = (dir: Entry['direction']) => {
    const pts: Point[] = [{ t: now - DAY, v: 0 }]
    for (const e of sorted) if (e.direction === dir) pts.push({ t: Math.min(at(e), now), v: pts.at(-1)!.v + e.volume_ml })
    return pts
  }
  const inLine = line('in')
  const outLine = line('out')
  const balance = inLine.at(-1)!.v - outLine.at(-1)!.v
  const m = measured(devices)
  return {
    in: inLine,
    out: outLine,
    balance,
    balanceText: `${signed(balance)} mL`,
    outLabel: m ? 'Out' : 'Output (urine not measured)',
    note: m ? null : UNMEASURED_NOTE,
  }
}

export interface RatePoint {
  t: number
  /** mL/kg/h over the preceding 6 h, 2 decimals. */
  rate: number
  below: boolean
  /** Colour of the newest coloured urine at or before `t`; grey when none. */
  fill: string
  /** Its name, or `Colour not recorded`. */
  colour: string
}

/** The low-output prompt's window (charting/alerts), from the chart read's `bags`; `(now − 6 h, now]` without them. */
export function rateWindow(entries: readonly Entry[], bags: BagChart | undefined, now: number): UrineWindow {
  const urineBagReadingsAt = (bags?.periods ?? [])
    .filter((p) => p.container === 'urine_bag')
    .flatMap((p) => p.readings.map((r) => Date.parse(r.created_at)))
  return urineWindow({ urineBagReadingsAt, entries, intervalH: bags?.interval_h ?? 4, now })
}

/** `To the 08:00 bag reading` when the window ends at a bag reading; else null. */
export const rateCaption = (w: UrineWindow, now: number): string | null =>
  w.bagAt === null ? null : `To the ${when(w.bagAt, now)} bag reading`

/**
 * The 6 h rolling urine rate, counted as the low-output prompt counts it, at the prompt's window end and each hour before
 * it within the last 24 h; null without a weight. Hours under 6 h since admission are left out.
 */
export function urineRate(
  entries: readonly Entry[],
  weightKg: number | null,
  admittedAt: string,
  now: number,
  bags?: BagChart,
): RatePoint[] | null {
  if (!weightKg) return null
  const urine = entries.filter((e) => e.status === 'approved' && e.category === 'urine')
  const coloured = urine.filter((e) => e.urine_colour).toSorted((a, b) => at(b) - at(a) || b.id - a.id)
  const colourAt = (t: number) => {
    const e = coloured.find((x) => at(x) <= t)
    const sw = e && entrySwatch(e)
    return sw ? { fill: sw.fill, colour: sw.label } : { fill: NO_COLOUR, colour: NO_COLOUR_LABEL }
  }
  const admitted = Date.parse(admittedAt)
  const { to } = rateWindow(entries, bags, now)
  const out: RatePoint[] = []
  for (let i = 23; i >= 0; i--) {
    const t = to - i * HOUR
    if (t <= now - DAY || t - admitted < URINE_WINDOW_H * HOUR) continue
    // Whole mL, as the prompt counts: bag entries spread from the reading before them.
    const ml = urineInWindow(urine, t - URINE_WINDOW_H * HOUR, t)
    const exact = ml / weightKg / URINE_WINDOW_H
    // Marked from the exact rate, as the low-output prompt is; rounded only for display.
    out.push({ t, rate: Math.round(exact * 100) / 100, below: exact < URINE_THRESHOLD, ...colourAt(t) })
  }
  return out
}

/** What the rate chart shows instead of a plot, or null when it can plot. Unmeasured urine has no rate to plot. */
export const rateMessage = (points: RatePoint[] | null, measured: boolean): string | null =>
  !measured ? 'Urine not measured' : points === null ? 'Weight not recorded' : points.length === 0 ? 'Needs 6 h since admission' : null

export interface Segment {
  category: EntryCategory
  ml: number
  /** Drink segments only: the kind, null for drinks with none (web/ward "Intake and output breakdown"). */
  drink?: DrinkKind | null
}

export interface UrineRun {
  ml: number
  fill: string
  label: string
}

/**
 * Approved 24 h urine as runs of the same colour, in charted order. A run is filled with its newest
 * colour (the photo colour when there is one); urine with no colour is grey.
 */
export function urineRuns(entries: readonly Entry[], now: number): UrineRun[] {
  const runs: (UrineRun & { colour: string | null })[] = []
  const urine = approvedDay(entries, now)
    .filter((e) => e.category === 'urine')
    .toSorted((a, b) => at(a) - at(b) || a.id - b.id)
  for (const e of urine) {
    const sw = entrySwatch(e)
    const colour = sw ? e.urine_colour : null
    const last = runs.at(-1)
    if (last && last.colour === colour) {
      last.ml += e.volume_ml
      if (sw) last.fill = sw.fill
    } else {
      runs.push({ colour, ml: e.volume_ml, fill: sw?.fill ?? NO_COLOUR, label: sw?.label ?? NO_COLOUR_LABEL })
    }
  }
  return runs.map(({ ml, fill, label }) => ({ ml, fill, label }))
}

/** Approved 24 h volume by category, in the app's category order; drinks split by kind, largest first. */
export function breakdown(entries: readonly Entry[], now: number) {
  const day = approvedDay(entries, now)
  const sums = new Map<EntryCategory, number>()
  for (const e of day) sums.set(e.category, (sums.get(e.category) ?? 0) + e.volume_ml)
  const drinks: Segment[] = drinkTotals(day.filter((e) => e.category === 'water')).map((d) => ({
    category: 'water',
    ml: d.ml,
    drink: d.kind,
  }))
  const side = (dir: Entry['direction']): Segment[] =>
    ENTRY_CATEGORIES.filter((c) => sums.has(c) && (dir === 'in') === ['water', 'food', 'iv'].includes(c)).flatMap((c) =>
      c === 'water' ? drinks : [{ category: c, ml: sums.get(c)! }],
    )
  const inSegs = side('in')
  const outSegs = side('out')
  const total = (s: Segment[]) => s.reduce((n, x) => n + x.ml, 0)
  return { in: inSegs, out: outSegs, inTotal: total(inSegs), outTotal: total(outSegs) }
}

/** Entries with a photo in the last 24 h, newest first, at most 12. Any status but rejected (its photo is gone). */
export const photoStrip = (entries: readonly Entry[], now: number): Entry[] =>
  lastDay(entries, now)
    .filter((e) => e.has_photo)
    .toSorted((a, b) => at(b) - at(a) || b.id - a.id)
    .slice(0, PHOTO_STRIP_MAX)

/** The photo strip's toggle: `Photos 3`, counting every photo of the last 24 h (the strip shows at most 12). */
export const photoStripLabel = (entries: readonly Entry[], now: number): string =>
  `Photos ${lastDay(entries, now).filter((e) => e.has_photo).length}`

/** One cell per rolling hour, oldest first: true when intake was logged (not rejected). */
export const activityCells = (h: HourlySeries): boolean[] => h.in_logged.map((n) => n > 0)

/**
 * The paper I&O sheet: 24 clock hours ending with the current one, approved volumes, running balance. `outHead` heads
 * the output column, `Out (urine not measured)` while urine is not measured; `note` then ends the totals row.
 */
export function printRows(entries: readonly Entry[], now: number, devices?: Pick<OutputDevices, 'urine_measured'>) {
  const current = new Date(now)
  current.setMinutes(0, 0, 0)
  const rows: { start: number; hour: string; in: number; out: number; balance: string }[] = []
  let inSum = 0
  let outSum = 0
  for (let i = 23; i >= 0; i--) {
    const start = new Date(current)
    start.setHours(current.getHours() - i)
    const s = start.getTime()
    const end = new Date(start)
    end.setHours(start.getHours() + 1)
    const hour = entries.filter((e) => e.status === 'approved' && at(e) >= s && at(e) < end.getTime())
    const inMl = hour.filter((e) => e.direction === 'in').reduce((n, e) => n + e.volume_ml, 0)
    const outMl = hour.filter((e) => e.direction === 'out').reduce((n, e) => n + e.volume_ml, 0)
    inSum += inMl
    outSum += outMl
    rows.push({ start: s, hour: clock(start), in: inMl, out: outMl, balance: signed(inSum - outSum) })
  }
  const m = measured(devices)
  return {
    rows,
    totals: { in: inSum, out: outSum, balance: signed(inSum - outSum) },
    outHead: m ? 'Output mL' : 'Out (urine not measured)',
    note: m ? null : UNMEASURED_NOTE,
  }
}

// ---------- the 24 h rail (DESIGN.md §1.5, §5.11): shared hour columns, round-hour ticks ----------

/** Start of the rail: the current clock hour less 23 h, so 24 clock-hour columns end with the current one. */
export function railStart(now: number): number {
  const h = new Date(now)
  h.setMinutes(0, 0, 0)
  return h.getTime() - 23 * HOUR
}

/** Ticks on round hours, every `every` hours aligned to midnight (`00:00`, `04:00`, …), inside `(now − 24 h, now]`. */
export function roundHourTicks(now: number, every = 4): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = []
  const first = new Date(now - DAY)
  first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + HOUR; t <= now; t += HOUR) {
    const h = new Date(t).getHours()
    if (h % every === 0) out.push({ t, label: clock(t) })
  }
  return out
}

export interface HourBucket {
  /** Local start of the clock hour (epoch ms). */
  start: number
  /** Approved intake and output in the hour. */
  inMl: number
  outMl: number
  /** Pending intake and output in the hour: drawn outlined, moving no line. */
  pendingIn: number
  pendingOut: number
  /** Approved intake less output from the rail's start to the end of this hour. */
  balance: number
  /** The hour's entries that are not rejected, oldest first. */
  entries: Entry[]
}

/** 24 clock-hour buckets ending with the current hour, oldest first. */
export function hourBuckets(entries: readonly Entry[], now: number): HourBucket[] {
  const start = railStart(now)
  const buckets: HourBucket[] = Array.from({ length: 24 }, (_, i) => ({
    start: start + i * HOUR,
    inMl: 0,
    outMl: 0,
    pendingIn: 0,
    pendingOut: 0,
    balance: 0,
    entries: [],
  }))
  for (const e of entries.toSorted((a, b) => at(a) - at(b) || a.id - b.id)) {
    const i = Math.floor((at(e) - start) / HOUR)
    if (i < 0 || i > 23 || e.status === 'rejected') continue
    const b = buckets[i]!
    b.entries.push(e)
    const into = e.direction === 'in'
    if (e.status === 'approved') {
      if (into) b.inMl += e.volume_ml
      else b.outMl += e.volume_ml
    } else if (into) b.pendingIn += e.volume_ml
    else b.pendingOut += e.volume_ml
  }
  let run = 0
  for (const b of buckets) {
    run += b.inMl - b.outMl
    b.balance = run
  }
  return buckets
}

/** The cumulative approved step lines (web/ward "Fluid balance chart"): an alias of `cumulative` for the timeline. */
export const steps = cumulative

/** One y-scale for a set of hourly series (a ward's beds): its largest hour in or out, at least 1. */
export const scaleShared = (series: readonly Pick<HourlySeries, 'in_ml' | 'out_ml'>[]): number =>
  Math.max(1, ...series.flatMap((s) => [...s.in_ml, ...s.out_ml]))

export interface CareRails {
  /** A fluid limit: the rule at `ml` and the band from 80 % to 100 %. */
  limit: { ml: number; band: [number, number]; label: string } | null
  /** An intake target: the rule, and a mark at each INTAKE_TARGET_CHECKS time with the mL due by then. */
  target: { ml: number; label: string; checks: { t: number; ml: number; label: string }[] } | null
  /** Intake counted toward the order since the chart day began (approved and pending, the order's categories), stepped. */
  counted: Point[] | null
}

/** The care orders drawn on the timeline (web/ward "Care orders on the timeline"). Pure; no requests. */
export function careRails(care: CareStatus | null | undefined, entries: readonly Entry[], now: number): CareRails {
  const limit = care?.fluid_limit ?? null
  const target = care?.intake_target ?? null
  const order = limit ?? target
  if (!order) return { limit: null, target: null, counted: null }
  const since = Date.parse(order.since)
  const cats = SCOPE_CATEGORIES[limit ? limit.scope : 'oral']
  const counted: Point[] = [{ t: since, v: 0 }]
  for (const e of entries
    .filter((x) => x.status !== 'rejected' && x.direction === 'in' && cats.includes(x.category) && at(x) >= since && at(x) <= now)
    .toSorted((a, b) => at(a) - at(b) || a.id - b.id))
    counted.push({ t: at(e), v: counted.at(-1)!.v + e.volume_ml })
  const day = new Date(since)
  const checkAt = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number) as [number, number]
    const d = new Date(day)
    d.setHours(h, m, 0, 0)
    return d.getTime()
  }
  return {
    limit: limit && { ml: limit.of_ml, band: [Math.round(limit.of_ml * FLUID_LIMIT_WARN), limit.of_ml], label: `Limit ${limit.of_ml} mL` },
    target: target && {
      ml: target.of_ml,
      label: `Target ${target.of_ml} mL`,
      checks: INTAKE_TARGET_CHECKS.map((c) => ({
        t: checkAt(c.at),
        ml: Math.round(target.of_ml * c.fraction),
        label: `${Math.round(c.fraction * 100)}% by ${c.at}`,
      })),
    },
    counted,
  }
}

/** A gauge's accessible name (DESIGN.md §5.12): `Urine bag 42% full, 840 of 2000 mL at 18:20`. */
export function gaugeName(name: string, level: number, capacity: number, at: number | null): string {
  const pct = capacity > 0 ? Math.round((100 * level) / capacity) : 0
  const when = at === null ? '' : ` at ${clock(at)}`
  return `${name} ${pct}% full, ${level} of ${capacity} mL${when}`
}
