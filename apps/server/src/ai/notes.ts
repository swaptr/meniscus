/** Voice/text note → chart entries, via a Spark function tool. */
import { z } from 'zod'
import { normaliseUrine, nullableText, URINE_WIRE, wireColour } from './text.ts'
import { DRINK_KINDS, ENTRY_CATEGORIES, ENTRY_DIRECTIONS, type DrinkKind } from '@meniscus/shared'
import type { ToolDef } from '@meniscus/meta'

/** Model-facing drink kinds, with a `none` sentinel (no nullable enum in strict schemas). */
const DRINK_WIRE = [...DRINK_KINDS, 'none'] as const

/** A drink gets its kind (`other` when not named); food only a real kind; anything else none. */
function noteDrink(category: string, wire: (typeof DRINK_WIRE)[number]): DrinkKind | null {
  const kind = wire === 'none' ? null : wire
  if (category === 'water') return kind ?? 'other'
  if (category === 'food') return kind
  return null
}

const DraftSchema = z
  .object({
    direction: z.enum(ENTRY_DIRECTIONS),
    category: z.enum(ENTRY_CATEGORIES),
    volume_ml: z.number().int().min(0).max(10_000).nullable(),
    item: nullableText,
    notes: nullableText,
    urine_colour: wireColour,
    drink: z.enum(DRINK_WIRE).default('none'),
  })
  // Words carry a name, never a photo colour.
  .transform((d) => ({ ...d, ...normaliseUrine(d.category === 'urine', d.urine_colour, null), drink: noteDrink(d.category, d.drink) }))

export const LOG_ENTRY_TOOL: ToolDef<z.output<typeof DraftSchema>> = {
  name: 'log_entry',
  description: 'Record one intake or output event for the current patient. Call once per distinct event.',
  schema: DraftSchema,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['direction', 'category', 'volume_ml', 'item', 'notes', 'urine_colour', 'drink'],
    properties: {
      direction: { type: 'string', enum: [...ENTRY_DIRECTIONS], description: 'in = intake, out = output' },
      category: { type: 'string', enum: [...ENTRY_CATEGORIES] },
      volume_ml: {
        type: ['integer', 'null'],
        description: 'Volume in mL. Convert cups/glasses/bottles only when their size is stated; otherwise null.',
      },
      item: { type: ['string', 'null'], description: 'What was consumed or emptied, e.g. "coconut water", "urine bag".' },
      notes: { type: ['string', 'null'], description: 'Observations such as colour, clarity, partial consumption.' },
      urine_colour: {
        type: 'string',
        enum: [...URINE_WIRE],
        description: 'Urine only, when the note states its colour: nearest name (pale = pale straw, dark = dark amber). Otherwise "none".',
      },
      drink: {
        type: 'string',
        enum: [...DRINK_WIRE],
        description: 'Drinks and soup only: the nearest kind (chai = tea, chaas or lassi = buttermilk). Otherwise "none".',
      },
    },
  },
}

export const NOTE_SYSTEM = `You turn short spoken or typed notes from hospital ward staff into intake/output chart entries.
Call log_entry once for every distinct intake or output event mentioned. Drinks are category "water" with drink set to the nearest kind (tea, coffee, coconut water, ORS, buttermilk…); meals and soup are "food" (drink "soup" for soup, else "none").
Use only amounts that are stated or unambiguous (e.g. "half of a 500 mL bottle" = 250). Never invent volumes.
Notes may be in any language; write item and notes in English.
Set urine_colour only when the note states the urine's colour.
If the note contains no intake/output event, reply in one short sentence without calling the tool.`
