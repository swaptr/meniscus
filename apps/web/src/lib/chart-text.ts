/** Text equivalents for the charts (web/interface "Charts have a text equivalent"): names and tables. Pure. */
import type { HourlySeries } from '@meniscus/shared'
import type { HourBucket, Segment } from './charts.ts'
import { kindLabel } from './drinks.ts'
import { clock, hourRange, ml, percent, signedMl } from './format.ts'
import { CATEGORY_LABEL } from './labels.ts'

const HOUR = 3_600_000
/** A run this long without intake is a gap worth naming (and the warn underline under the bars). */
export const GAP_HOURS = 3

/** `Fluid balance, last 24 hours: in 1400 mL, out 900 mL, balance +500 mL, limit 1500 mL, 93% used`. */
export function balanceName(o: { inMl: number; outMl: number; limit: { ml: number; counted: number } | null; measured: boolean }): string {
  const parts = [`in ${ml(o.inMl)}`, `out ${ml(o.outMl)}`, `balance ${signedMl(o.inMl - o.outMl)}`]
  if (o.limit) parts.push(`limit ${ml(o.limit.ml)}`, `${percent(o.limit.counted / o.limit.ml)} used`)
  if (!o.measured) parts.push('urine not measured')
  return `Fluid balance, last 24 hours: ${parts.join(', ')}`
}

export interface BalanceRow {
  hour: string
  in: string
  out: string
  pending: string
  balance: string
}

/** One row per hour of the rail, newest last, in the chart's own numbers. */
export const balanceTable = (buckets: readonly HourBucket[]): BalanceRow[] =>
  buckets.map((b) => ({
    hour: hourRange(b.start),
    in: ml(b.inMl),
    out: ml(b.outMl),
    pending: ml(b.pendingIn + b.pendingOut),
    balance: signedMl(b.balance),
  }))

/** A bed tile's 24 h bars: `Last 24 hours: in 1400 mL, out 900 mL, no intake logged since 13:00` (rolling hours ending `now`). */
export function stripName(h: HourlySeries, now: number): string {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)
  const head = `Last 24 hours: in ${ml(sum(h.in_ml))}, out ${ml(sum(h.out_ml))}`
  const last = h.in_logged.findLastIndex((n) => n > 0)
  if (last < 0) return `${head}, no intake logged`
  const end = now - (h.in_logged.length - 1 - last) * HOUR
  return now - end >= GAP_HOURS * HOUR ? `${head}, no intake logged since ${clock(end)}` : head
}

/** The breakdown's `Table`: intake rows (drinks by kind, in the bar's order) then output rows. */
export function breakdownTable(b: { in: Segment[]; out: Segment[] }): {
  in: { label: string; ml: number }[]
  out: { label: string; ml: number }[]
} {
  const label = (s: Segment) => (s.category === 'water' ? kindLabel(s.drink ?? null) : CATEGORY_LABEL[s.category])
  return { in: b.in.map((s) => ({ label: label(s), ml: s.ml })), out: b.out.map((s) => ({ label: label(s), ml: s.ml })) }
}
