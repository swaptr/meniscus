/** Urine colour for display and saving. Pure. The colour shown is the one seen in the photo when there is one. */
import { URINE_REFERENCE, type DraftEntry, type Entry, type UrineColour, type UrineSeen } from '@meniscus/shared'

export const URINE_LABEL: Record<UrineColour, string> = {
  pale: 'Pale straw',
  yellow: 'Yellow',
  dark: 'Dark amber',
  orange: 'Orange',
  pink: 'Pink',
  red: 'Red',
  brown: 'Brown',
}

/** Neutral grey for urine charted without a colour. */
export const NO_COLOUR = '#c3c8ce'
export const NO_COLOUR_LABEL = 'Colour not recorded'

export interface Swatch {
  fill: string
  label: string
  /** True when `fill` is the colour seen in the photo; false for a name's reference shade. */
  photo: boolean
}

export const swatchOf = (colour: UrineColour, rgb: string | null | undefined): Swatch => ({
  fill: rgb ?? URINE_REFERENCE[colour],
  label: URINE_LABEL[colour],
  photo: Boolean(rgb),
})

/** A urine entry's swatch, or null when it is not urine or has no colour. */
export const entrySwatch = (e: Pick<Entry, 'category' | 'urine_colour' | 'urine_rgb'>): Swatch | null =>
  e.category === 'urine' && e.urine_colour ? swatchOf(e.urine_colour, e.urine_rgb) : null

/** The admission's latest colour; a pending one says so. */
export function seenSwatch(s: UrineSeen | null | undefined): Swatch | null {
  if (!s) return null
  const sw = swatchOf(s.colour, s.rgb)
  return s.status === 'pending' ? { ...sw, label: `${sw.label} · pending` } : sw
}

/** Staff picked a colour: the name replaces the read, and the photo colour no longer applies. */
export const withColour = (d: DraftEntry, colour: UrineColour): DraftEntry => ({ ...d, urine_colour: colour, urine_rgb: null })

/** The colour fields to send with an entry: only for urine with a colour. */
export const colourFields = (d: DraftEntry): { urine_colour?: UrineColour; urine_rgb?: string } =>
  d.category === 'urine' && d.urine_colour ? { urine_colour: d.urine_colour, ...(d.urine_rgb ? { urine_rgb: d.urine_rgb } : {}) } : {}
