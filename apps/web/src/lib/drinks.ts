/**
 * Drink kinds as the ward sees them (web/capture "Drink on the check screen", web/ward "Drinks named on the bed review",
 * "Intake and output breakdown", "Meal fluids with their kind"). Pure; the icons live in components/drink-label.tsx.
 */
import { DRINK_KINDS, DRINK_LABEL, type DrinkKind, type Entry, type EntryCategory, type MealFluid } from '@meniscus/shared'
import type { Pending } from './capture.ts'

export { DRINK_KINDS, DRINK_LABEL }

/** The `Drink` picker's options, in DRINK_KINDS order. */
export const DRINK_OPTIONS: readonly { id: DrinkKind; label: string }[] = DRINK_KINDS.map((id) => ({ id, label: DRINK_LABEL[id] }))

/** Only drinks and food take a drink kind. */
export const takesDrink = (category: EntryCategory): boolean => category === 'water' || category === 'food'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** `{ label: 'Tea', name: 'masala chai' }`; `name` is null when there is no item or it is the label (ignoring case). Null without a kind. */
export function drinkTitle(e: {
  drink?: DrinkKind | null
  item: string | null
}): { kind: DrinkKind; label: string; name: string | null } | null {
  if (!e.drink) return null
  const label = DRINK_LABEL[e.drink]
  return { kind: e.drink, label, name: e.item && !same(e.item, label) ? e.item : null }
}

/** The bed review's line for an entry with a kind: `Tea 150 mL · masala chai`, or `ORS 200 mL`. Null without a kind. */
export function drinkLine(e: Pick<Entry, 'drink' | 'item' | 'volume_ml'>): string | null {
  const t = drinkTitle(e)
  return t && `${t.label} ${e.volume_ml} mL${t.name ? ` · ${t.name}` : ''}`
}

/** Approved `water` entries by kind, largest first (ties in DRINK_KINDS order, then no kind). No kind is one group, `kind: null`. */
export function drinkTotals(
  entries: readonly Pick<Entry, 'status' | 'category' | 'drink' | 'volume_ml'>[],
): { kind: DrinkKind | null; ml: number }[] {
  const sums = new Map<DrinkKind | null, number>()
  for (const e of entries) {
    if (e.status !== 'approved') continue
    if (e.category !== 'water') continue
    const k = e.drink ?? null
    sums.set(k, (sums.get(k) ?? 0) + e.volume_ml)
  }
  const rank = (k: DrinkKind | null) => (k === null ? DRINK_KINDS.length : DRINK_KINDS.indexOf(k))
  return [...sums].map(([kind, ml]) => ({ kind, ml })).sort((a, b) => b.ml - a.ml || rank(a.kind) - rank(b.kind))
}

/** A breakdown segment's label: the kind's label, `Drink` for a drink with no kind. */
export const kindLabel = (kind: DrinkKind | null): string => (kind ? DRINK_LABEL[kind] : DRINK_LABEL.other)

/** "What the AI read" on a meal: `chaas · Buttermilk · 200 mL`, or `soup · 150 mL` when the name is the kind's label. */
export function mealFluidLine(f: Pick<MealFluid, 'name' | 'fluid_kind' | 'volume_ml'>): string {
  const label = DRINK_LABEL[f.fluid_kind]
  return same(f.name, label) ? `${f.name} · ${f.volume_ml} mL` : `${f.name} · ${label} · ${f.volume_ml} mL`
}

/** The check screen's head for a draft with a kind: `Tea · 150 mL`. Null without a kind. */
export function checkTitle(d: { drink?: DrinkKind | null; volume_ml: number | null }): string | null {
  if (!d.drink) return null
  return `${DRINK_LABEL[d.drink]}${d.volume_ml !== null ? ` · ${d.volume_ml} mL` : ''}`
}

/** Whether the check screen shows the `Drink` picker: a draft with a kind, or a by-hand drink. */
export const offersDrinkPicker = (p: Pending): boolean =>
  takesDrink(p.draft.category) && (p.draft.drink != null || (p.source === 'manual' && p.draft.category === 'water'))

/** The picker's pick: the kind, and the item becomes the kind's label. */
export const withDrink = (p: Pending, kind: DrinkKind): Pending => ({ ...p, draft: { ...p.draft, drink: kind, item: DRINK_LABEL[kind] } })
