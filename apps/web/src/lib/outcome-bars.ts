/** The Chart view's outcome bars (web/ward "Outcome bars"): pure. Rates are the server's; only segment widths are computed here. */
import type { KindRow, ModelQuality } from '@meniscus/shared'
import { OUTCOME_HUE } from './hues.ts'
import { kindLabel, rateText } from './model-accuracy.ts'
import { PEEK_DELAY } from './peek.ts'

/** Decided outcomes, in segment and legend order. */
export const OUTCOME_ORDER = ['accepted', 'edited_at_capture', 'corrected_by_nurse', 'rejected'] as const
export type DecidedOutcome = (typeof OUTCOME_ORDER)[number]

export const OUTCOME_LABEL: Record<DecidedOutcome, string> = {
  accepted: 'Accepted',
  edited_at_capture: 'Edited at capture',
  corrected_by_nurse: 'Corrected by a nurse',
  rejected: 'Rejected',
}

export { OUTCOME_HUE }

/** The panels' popup is a peek: it opens after a 400 ms rest (lib/peek.ts), never on focus alone. */
export const OUTCOME_POPUP_DELAY = PEEK_DELAY
/** Panels per row: 3 from 900 px wide, else 1 (web/ward "Outcome bars": Panels). */
export const PANELS_WIDE = 900
export const panelColumns = (width: number): 1 | 3 => (width >= PANELS_WIDE ? 3 : 1)

export interface DrawnBar {
  kind: KindRow
  label: string
  /** `76% · 20/26 accepted`. */
  accepted: string
  /** Zero-count outcomes draw no segment. `widthPct` is exact; the DOM uses it as is. */
  segments: { outcome: DecidedOutcome; widthPct: number }[]
  /** All four outcomes, zeros included: `Accepted 76% · 20/26`. */
  popup: string[]
  /** The row button's name: the visible label word for word, then the other three outcomes. */
  ariaLabel: string
}
export interface FewBar {
  kind: KindRow
  label: string
  /** `Too few to chart · 4 decided`. */
  tooFew: string
}
export type Bar = DrawnBar | FewBar

/** One bar per kind with drafts, in the summary's order. Fewer than `min_n` decided drafts read as too few to chart. */
export function outcomeBars(q: Pick<ModelQuality, 'min_n' | 'kinds'>): Bar[] {
  return q.kinds
    .filter((k) => k.drafts > 0)
    .map((k): Bar => {
      const label = kindLabel(k)
      const decided = k.accepted.of
      if (decided < q.min_n) return { kind: k, label, tooFew: `Too few to chart · ${decided} decided` }
      const accepted = `${rateText(k.accepted)} accepted`
      const lines = OUTCOME_ORDER.map((o) => [o, rateText(k[o])] as const)
      return {
        kind: k,
        label,
        accepted,
        segments: OUTCOME_ORDER.filter((o) => k.outcomes[o] > 0).map((o) => ({ outcome: o, widthPct: (100 * k.outcomes[o]) / decided })),
        popup: lines.map(([o, r]) => `${OUTCOME_LABEL[o]} ${r}`),
        ariaLabel: `${label}, ${accepted}: ${lines
          .slice(1)
          .map(([o, r]) => `${OUTCOME_LABEL[o].toLowerCase()} ${r}`)
          .join(', ')}`,
      }
    })
}
