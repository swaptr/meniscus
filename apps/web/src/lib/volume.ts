/**
 * Volume helpers shared by the steppers, totals and charts. A leaf module (only `@meniscus/shared`), so the shared UI can
 * use them without pulling capture or ward logic into every route's bundle.
 */
import { MAX_ENTRY_ML } from '@meniscus/shared'

export const VOLUME_STEP = 10

export const clampVolume = (ml: number, min = 1) => Math.min(MAX_ENTRY_ML, Math.max(min, Math.round(ml)))
export const stepVolume = (ml: number, delta: number, min = 1) => clampVolume(ml + delta, min)

/** A balance with its sign: `+120`, `−80`, `0`. */
export const signed = (ml: number) => `${ml > 0 ? '+' : ml < 0 ? '−' : ''}${Math.abs(ml)}`

/** A stepper's button names, carrying its field: `Less energy target` / `More energy target`. */
export const stepperNames = (label: string) => {
  const field = label.toLowerCase()
  return { less: `Less ${field}`, more: `More ${field}` }
}
