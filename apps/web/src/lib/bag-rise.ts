/**
 * A bag entry's rise, from the two readings frozen on it (`levels`): what entry details and the timeline say.
 * Pure, and the same rule as the server's: the baseline is the previous reading's level, 0 after a bag change, and
 * an emptying's residual (0 when none was recorded); a level below it fell, and counts whole.
 */
import type { BagEvent, Entry, LevelSnapshot } from '@meniscus/shared'
import { clock } from './format.ts'

const hhmm = (iso: string) => clock(iso)

/** What the next reading of the bag rises from. */
export const baselineAfter = (p: { event: BagEvent | null; volume_ml: number; residual_ml: number | null }) =>
  p.event === 'emptied' ? (p.residual_ml ?? 0) : p.event === 'bag_changed' ? 0 : p.volume_ml

export interface Rise {
  baseline: number
  rise: number
  /** The baseline it fell below, or null. */
  fell_from: number | null
}
export function rise(before: LevelSnapshot | null, after: { volume_ml: number }): Rise {
  const base = before ? baselineAfter(before) : 0
  return after.volume_ml >= base
    ? { baseline: base, rise: after.volume_ml - base, fell_from: null }
    : { baseline: 0, rise: after.volume_ml, fell_from: base }
}

/** Charted from a bag reading (its frozen `after` has an event); jug and bottle levels have none. */
export const isBagEntry = (e: Pick<Entry, 'levels'>) => e.levels?.after.event != null

/** "0 mL (emptied 08:00) → 150 mL · +150 mL", or "500 mL → 150 mL · level fell". */
export function bagDrop(before: LevelSnapshot | null, after: LevelSnapshot): string {
  const r = rise(before, after)
  const base = r.fell_from ?? r.baseline
  const why =
    before?.event === 'emptied'
      ? ` (emptied ${hhmm(before.created_at)})`
      : before?.event === 'bag_changed'
        ? ` (bag changed ${hhmm(before.created_at)})`
        : ''
  const from = `${base} mL${why} → ${after.volume_ml} mL`
  return r.fell_from === null ? `${from} · +${r.rise} mL` : `${from} · level fell`
}

/** The timeline's "Saved …" line for a bag entry. */
export function bagSaved(e: Pick<Entry, 'levels' | 'recorded_ml'>): string {
  const { before, after } = e.levels!
  const r = rise(before, after)
  const ml = e.recorded_ml
  if (ml !== r.rise) return `Saved ${ml} mL, what this late reading adds to the bag's charted total`
  if (!before) return `Saved ${ml} mL, the first reading of this bag`
  if (r.fell_from !== null) return `Saved ${ml} mL, the whole level, as it fell since ${hhmm(before.created_at)}`
  return `Saved ${ml} mL, the rise since ${hhmm(before.created_at)}`
}
