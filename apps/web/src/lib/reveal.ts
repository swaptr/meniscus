/**
 * Signature moment 2 (DESIGN.md §2.8): the first time a segmented photo is shown in a session, its overlay traces in
 * once in 480 ms (container, then the liquid or each dish 80 ms apart, then the labels). Later shows, and reduced
 * motion, draw the final state at once. Pure apart from the module-level first-show set.
 */
import type { LayerKind } from './overlay.ts'

export const REVEAL_TOTAL = 480
const STEP = 80
const TRACE = 240
const LABELS_FOR = 120

const shown = new WeakSet<object>()
const shownKeys = new Set<string>()

const has = (key: string | object) => (typeof key === 'string' ? shownKeys.has(key) : shown.has(key))

/** Whether `key` (`media:<id>`, or a capture's in-memory blob) was already shown this session. Pure read. */
export const hasShown = (key: string | object): boolean => has(key)

/** Records that `key` was shown (from an effect, so a double render cannot spend the reveal). */
export function markShown(key: string | object): void {
  if (typeof key === 'string') shownKeys.add(key)
  else shown.add(key)
}

export interface RevealSchedule {
  /** One per layer, in layer order: delay and trace duration in ms. */
  steps: { kind: LayerKind; delay: number; duration: number }[]
  labelsAt: number
  labelsFor: number
}

/** The reveal for these layers; empty under reduced motion. Steps squeeze below 80 ms apart so the whole stays 480 ms. */
export function revealSchedule(kinds: readonly LayerKind[], reduced: boolean): RevealSchedule {
  if (reduced || kinds.length === 0) return { steps: [], labelsAt: 0, labelsFor: 0 }
  const labelsAt = REVEAL_TOTAL - LABELS_FOR
  const room = labelsAt - TRACE
  const step = kinds.length > 1 ? Math.min(STEP, room / (kinds.length - 1)) : 0
  return {
    steps: kinds.map((kind, i) => ({ kind, delay: Math.round(i * step), duration: TRACE })),
    labelsAt,
    labelsFor: LABELS_FOR,
  }
}
