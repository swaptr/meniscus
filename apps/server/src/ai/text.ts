import { z } from 'zod'
import {
  DRINK_NAME_MAX,
  HEX_COLOUR,
  URINE_COLOURS,
  isDrinkKind,
  type ContainerKind,
  type FluidKind,
  type UrineColour,
} from '@meniscus/shared'
import { isOutputReading } from './draft.ts'

const EMPTY = new Set(['', 'null', 'none', 'n/a', 'na', 'undefined'])

/** Nullable model text where the model sometimes writes "null" as a string. */
export const nullableText = z
  .string()
  .nullable()
  .transform((s) => (s === null || EMPTY.has(s.trim().toLowerCase()) ? null : s.trim()))

/** Model-facing colour names: a plain enum with a `none` sentinel (no nullable enum in strict schemas). */
export const URINE_WIRE = [...URINE_COLOURS, 'none'] as const
export const wireColour = z.enum(URINE_WIRE).default('none')

/** Colour fields for a draft: null unless it is urine; a bad hex is dropped and the name kept. */
export function normaliseUrine(
  isUrine: boolean,
  colour: (typeof URINE_WIRE)[number] | null | undefined,
  rgb: string | null | undefined,
): { urine_colour: UrineColour | null; urine_rgb: string | null } {
  if (!isUrine || !colour || colour === 'none') return { urine_colour: null, urine_rgb: null }
  const raw = rgb?.trim().toLowerCase() ?? ''
  const hex = /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : raw
  return { urine_colour: colour, urine_rgb: HEX_COLOUR.test(hex) ? hex : null }
}

// C0 controls other than whitespace, DEL and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g

/** A model's drink name, cleaned: controls removed, whitespace runs made one space, trimmed, cut to DRINK_NAME_MAX. Null when empty or null-like. */
export function cleanDrinkName(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const s = raw
    .replace(CONTROL, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, DRINK_NAME_MAX)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trim()
  return EMPTY.has(s.toLowerCase()) ? null : s
}

/** A reading's drink name: cleaned, and null unless the fluid is a drink kind and the reading is not an output. */
export function drinkName(raw: string | null | undefined, fluid: FluidKind, container: ContainerKind): string | null {
  if (!isDrinkKind(fluid) || isOutputReading(fluid, container)) return null
  return cleanDrinkName(raw)
}
