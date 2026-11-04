import type { EntryCategory } from '@meniscus/shared'

/** The reference palette's validated categorical slots (light mode, on white), each hex once. Slot 1 is `SLOT[0]`. */
export const SLOT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'] as const

/** Per-category hues in a validated order (CVD-separated within each bar); always shown with a text label. */
export const CATEGORY_HUE: Record<EntryCategory, string> = {
  water: SLOT[0],
  food: SLOT[2],
  iv: SLOT[5],
  urine: SLOT[3],
  stoma: SLOT[4],
  drain: SLOT[6],
  vomit: SLOT[1],
}

/** Outcome bars: slots 1–4 in segment order. Never a status colour, so a bar never reads as a prompt. */
export const OUTCOME_HUE = {
  accepted: SLOT[0],
  edited_at_capture: SLOT[1],
  corrected_by_nurse: SLOT[2],
  rejected: SLOT[3],
} as const
