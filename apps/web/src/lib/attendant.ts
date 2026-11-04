/**
 * Attendant screens stay simple (web/interface; DESIGN.md 2.6 "Attendant"): one task per screen, at most
 * MAX_CONTROL_GROUPS groups of controls before the commit. The capture routes render their groups from
 * `controlGroups`, so this is the layout, not a description of it.
 */
import type { EntryCategory, OutputDevices, Totals } from '@meniscus/shared'
import { BAG_NAME } from './labels.ts'
import { ml } from './format.ts'

export const MAX_CONTROL_GROUPS = 4

export type CheckItem =
  /** A bag read from a photo: its level, event and (urine bag) colour. */
  | { kind: 'bag'; urine: boolean }
  /** A water jug or bottle level. */
  | { kind: 'level' }
  /** A draft entry: from a read, or by hand (`byHand`: what also asks when; `bagLevel`: saved as a bag reading). */
  | { kind: 'item'; category: EntryCategory; drink?: boolean; consistency?: boolean; byHand?: boolean; bagLevel?: boolean }

export type AttendantScreen = { k: 'picker' } | { k: 'capture' } | { k: 'check'; item: CheckItem } | { k: 'meal' } | { k: 'round' }

/** A labelled group of controls. `what` holds the category, the drink kind and (by hand) the time it happened. */
export type ControlGroup =
  | 'beds'
  | 'capture'
  | 'container'
  | 'note'
  | 'what'
  | 'volume'
  | 'level'
  | 'bagEvent'
  | 'colour'
  | 'consistency'
  | 'readings'
  | 'photo'
  | 'meal'
  | 'eaten'
  | 'details'

export function controlGroups(screen: AttendantScreen): ControlGroup[] {
  switch (screen.k) {
    case 'picker':
      return ['beds']
    case 'capture':
      return ['capture', 'container', 'note']
    case 'round':
      return ['beds', 'readings']
    case 'meal':
      // The meal form (components/meal-form.tsx): `meal` holds the meal and when; `details` the dishes or items and fluid.
      return ['photo', 'meal', 'eaten', 'details']
    case 'check': {
      const it = screen.item
      if (it.kind === 'level') return ['level']
      if (it.kind === 'bag') return it.urine ? ['level', 'bagEvent', 'colour'] : ['level', 'bagEvent']
      const g: ControlGroup[] = ['what']
      if (it.bagLevel) g.push('level', 'bagEvent')
      else g.push('volume')
      if (it.category === 'urine') g.push('colour')
      if (it.consistency) g.push('consistency')
      return g
    }
  }
}

/** The bag commit, naming the level it saves: `Save 450 mL reading`. */
export const bagSaveLabel = (volume: number): string => `Save ${ml(volume)} reading`

/** Beds per row in the picker: 3 on a phone, 6 from 641 px (DESIGN.md 7.2). */
export const pickerColumns = (width: number): number => (width >= 641 ? 6 : 3)

/**
 * The bed strip's devices beyond the care badges (which already name the catheter, stoma, drain and voiding orders):
 * the bags on record and whether urine is measured. `Urine bag · stoma bag`, `Urine not measured`, or null.
 */
export function deviceLine(d: Pick<OutputDevices, 'bags' | 'urine_measured'>): string | null {
  const parts = d.bags.map((b) => BAG_NAME[b].toLowerCase())
  if (!d.urine_measured) parts.push('urine not measured')
  if (!parts.length) return null
  const [first, ...rest] = parts
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(' · ')
}

/** The bed strip's vitals in one line: `In 1190 mL · Out 1375 mL · 2 pending`. */
export function vitalsLine(t: Pick<Totals, 'in_ml' | 'out_ml'>, pending: number): string {
  const parts = [`In ${ml(t.in_ml)}`, `Out ${ml(t.out_ml)}`]
  if (pending > 0) parts.push(`${pending} pending`)
  return parts.join(' · ')
}
