/** Choice chips (DESIGN.md 5.14), the pure part: which option is checked, the roving tab stop, pick-several toggles. */
import type { BagEvent } from '@meniscus/shared'
import { BAG_EVENT_LABEL } from './labels.ts'

export type ChoiceOption<T extends string, L = string> = readonly [T, L]

export interface ChoiceItem<T extends string, L> {
  value: T
  label: L
  checked: boolean
}

/** Options with their checked state; at most one checked (a radio group). Selected chips take the accent, never a tone. */
export function choiceItems<T extends string, L>(options: readonly ChoiceOption<T, L>[], value: T | null | undefined): ChoiceItem<T, L>[] {
  return options.map(([v, label]) => ({ value: v, label, checked: v === value }))
}

/** The one chip in the tab order: the checked one, else the first. */
export const rovingIndex = (items: readonly { checked: boolean }[]): number =>
  Math.max(
    0,
    items.findIndex((i) => i.checked),
  )

/** Pick several: add the value, or take it out. */
export const toggleIn = <T>(list: readonly T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

/** The bag event: one radio group (web/interface "One choice chip": Bag event). */
export const BAG_EVENT_CHOICES: readonly ChoiceOption<BagEvent>[] = [
  ['check', BAG_EVENT_LABEL.check],
  ['emptied', 'Emptied after photo'],
  ['bag_changed', BAG_EVENT_LABEL.bag_changed],
]
