/** The balance timeline's hour readout (web/ward "Balance timeline hover"). Pure. */
import type { DrinkKind } from '@meniscus/shared'
import type { HourBucket } from './charts.ts'
import { DRINK_LABEL } from './drinks.ts'
import { hourRange, ml, signedMl } from './format.ts'
import { CATEGORY_LABEL } from './labels.ts'

export interface Readout {
  title: string
  lines: string[]
  /** The hour's entries, each by its drink kind (else category); each opens its entry peek. */
  entries: { id: number; drink: DrinkKind | null; label: string; pending: boolean }[]
}

export function hourReadout(b: HourBucket): Readout {
  return {
    title: hourRange(b.start),
    lines: [`In ${ml(b.inMl)}`, `Out ${ml(b.outMl)}`, `Pending ${ml(b.pendingIn + b.pendingOut)}`, `Balance ${signedMl(b.balance)}`],
    entries: b.entries.map((e) => ({
      id: e.id,
      drink: e.category === 'water' ? (e.drink ?? null) : null,
      label: `${e.category === 'water' && e.drink ? DRINK_LABEL[e.drink] : CATEGORY_LABEL[e.category]} ${ml(e.volume_ml)}`,
      pending: e.status === 'pending',
    })),
  }
}

/** The readout's hour after a key on the focused chart: Left/Right step, Home/End jump, Escape hides (null). */
export function moveHour(i: number, key: string, n: number): number | null | undefined {
  switch (key) {
    case 'ArrowRight':
      return Math.min(n - 1, i + 1)
    case 'ArrowLeft':
      return Math.max(0, i - 1)
    case 'Home':
      return 0
    case 'End':
      return n - 1
    case 'Escape':
      return null
    default:
      return undefined
  }
}
