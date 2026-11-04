/** One ward row on the nurse home `/n` (DESIGN.md 7.5; web/ward "Ward cards drawn"). Pure, from `GET /api/wards` only. */
import type { WardSummary } from '@meniscus/shared'
import { ml } from './format.ts'
import { wardCard, wardTone } from './ward.ts'

const zeros = (): number[] => Array<number>(24).fill(0)
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

export interface WardRow extends ReturnType<typeof wardCard> {
  id: number
  code: string
  specialty: string
  tone: ReturnType<typeof wardTone>
  /** The 24 rolling hours, oldest first (zeros when the server sent none). */
  hourly: { in_ml: number[]; out_ml: number[] }
  /** The bars' accessible name: `Last 24 hours: in 1200 mL, out 900 mL`. */
  barsName: string
  /** Beds to review as a share of occupied beds, 0..1 (the stacked bar). */
  reviewShare: number
  href: string
}

export function wardRow(w: WardSummary, now: number): WardRow {
  const hourly = { in_ml: w.hourly?.in_ml ?? zeros(), out_ml: w.hourly?.out_ml ?? zeros() }
  return {
    ...wardCard(w, now),
    id: w.id,
    code: w.code,
    specialty: w.specialty,
    tone: wardTone(w),
    hourly,
    barsName: `Last 24 hours: in ${ml(sum(hourly.in_ml))}, out ${ml(sum(hourly.out_ml))}`,
    reviewShare: w.occupied ? Math.min(1, w.beds_with_alerts / w.occupied) : 0,
    href: `/n/w/${w.id}`,
  }
}

/** The one scale for every ward's bars on the screen: the largest hour, in or out. */
export const wardsScale = (wards: readonly WardSummary[]): number =>
  Math.max(1, ...wards.flatMap((w) => [...(w.hourly?.in_ml ?? []), ...(w.hourly?.out_ml ?? [])]))
