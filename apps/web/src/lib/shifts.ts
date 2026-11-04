/** Shift totals drawn in the log heading (web/ward "Shift totals drawn in the log"), on one scale for the whole log. Pure. */
import type { Shift } from './history.ts'
import { ml } from './format.ts'

export interface ShiftBar {
  /** Shares of the log's largest shift total, 0..1. */
  in: number
  out: number
  text: string
}

export function shiftBars(shifts: readonly Pick<Shift, 'in_ml' | 'out_ml' | 'pending'>[]): ShiftBar[] {
  const max = Math.max(0, ...shifts.flatMap((s) => [s.in_ml, s.out_ml]))
  return shifts.map((s) => ({
    in: max ? s.in_ml / max : 0,
    out: max ? s.out_ml / max : 0,
    text: `In ${ml(s.in_ml)} · Out ${ml(s.out_ml)}${s.pending ? ` · ${s.pending} pending` : ''}`,
  }))
}
