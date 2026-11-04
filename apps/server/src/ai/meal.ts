/**
 * Meal-tray reading task for Muse Spark: prompt, output contract and the pure mapping to the reading and draft. A tray
 * photo is 3 requests in `sam+spark` mode (SAM dish, SAM food, then Spark citing the dish regions; ai/tray.ts), 5 with a
 * compared served photo (SAM dish and food on it too; ai/compare.ts), or 1 in Spark-only mode, where every dish is in
 * region 0.
 */
import {
  AUTO_CONFIRM_CONFIDENCE,
  DISH_KINDS,
  DRINK_LABEL,
  joinItems,
  MAX_TRAY_REGIONS,
  MAX_TRACE_STEPS,
  MEAL_FLUID_KINDS,
  MEAL_ISSUES,
  type MealDish,
  type MealDraft,
  type MealFluid,
  type MealReading,
  type Portion,
  type TraySegmentation,
} from '@meniscus/shared'
import { z } from 'zod'
import { cleanDrinkName, nullableText } from './text.ts'

/** The model answers in words (string enums only, as the container read does); the chart stores percents. */
const EATEN = ['none', 'quarter', 'half', 'three_quarters', 'all'] as const
const PERCENT: Record<(typeof EATEN)[number], Portion> = { none: 0, quarter: 25, half: 50, three_quarters: 75, all: 100 }

/** Evidence bounds: a saved meal accepts nothing larger, and every read is trimmed to them. */
export const MEAL_BOUNDS = {
  items: 20,
  fluids: 10,
  name: 80,
  notes: 300,
  ml: 5000,
  regions: MAX_TRAY_REGIONS,
  traces: MAX_TRACE_STEPS,
} as const

/** What Muse Spark returns (strict JSON schema), parsed leniently and then mapped by `toMealReading`. */
export const MealModelSchema = z.object({
  dishes: z.array(z.object({ region: z.number().int().min(0), name: z.string(), dish_kind: z.enum(DISH_KINDS), eaten: z.enum(EATEN) })),
  eaten: z.enum(EATEN),
  fluids: z.array(
    z.object({
      region: z.number().int().min(0),
      name: z.string(),
      fluid_kind: z.enum(MEAL_FLUID_KINDS),
      volume_ml: z.number().int().min(0),
    }),
  ),
  confidence: z.number().min(0).max(1),
  issues: z.array(z.enum(MEAL_ISSUES)),
  notes: nullableText,
})
export type MealModelOutput = z.infer<typeof MealModelSchema>

const EATEN_JSON = { type: 'string', enum: [...EATEN] } as const
const REGION_JSON = {
  type: 'integer',
  minimum: 0,
  description: 'The dish number from the segmentation list, or 0 when it is in none of them or no list was given.',
} as const

export const MEAL_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dishes', 'eaten', 'fluids', 'confidence', 'issues', 'notes'],
  properties: {
    dishes: {
      type: 'array',
      description: 'Each food on the tray, once, with its dish number and how much of a standard serving was eaten.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['region', 'name', 'dish_kind', 'eaten'],
        properties: {
          region: REGION_JSON,
          name: { type: 'string', description: 'Short plain name, e.g. "rice", "dal", "roti".' },
          dish_kind: { type: 'string', enum: [...DISH_KINDS], description: 'The nearest kind; "other" when none fits.' },
          eaten: EATEN_JSON,
        },
      },
    },
    eaten: { ...EATEN_JSON, description: 'How much of the whole meal was eaten, to the nearest quarter.' },
    fluids: {
      type: 'array',
      description:
        'Liquids served with the meal that were drunk (soup, milk, tea, coffee, juice, buttermilk, coconut water, ORS, supplement drinks), as mL consumed, with the dish number of their cup, glass or bowl.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['region', 'name', 'fluid_kind', 'volume_ml'],
        properties: {
          region: REGION_JSON,
          name: { type: 'string', description: 'The specific drink, 1–4 words, e.g. "masala chai", "chaas".' },
          fluid_kind: { type: 'string', enum: [...MEAL_FLUID_KINDS], description: 'The nearest kind; "other" when none fits.' },
          volume_ml: { type: 'integer', minimum: 0 },
        },
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    issues: { type: 'array', items: { type: 'string', enum: [...MEAL_ISSUES] } },
    notes: { type: ['string', 'null'], description: 'One neutral sentence on what is left, or null.' },
  },
} as const

export const MEAL_SYSTEM = `You read photos of hospital meal trays, taken when the tray is collected, for the ward food chart.

Method:
1. List each food you can see (rice, dal, roti, curry, idli, bread, fruit, dessert...) once, with short plain names. When the prompt lists numbered dishes, give each food the number of the dish it is in, or 0 when it is in none of them.
2. Pick the nearest dish_kind for each food.
3. For each, say how much of a standard hospital serving was eaten: none, quarter, half, three_quarters or all. Empty bowls and clean plates mean all; untouched food means none.
4. Say how much of the whole meal was eaten, to the nearest quarter.
5. List liquids that were served and drunk (soup, milk, tea, coffee, juice, buttermilk, coconut water, ORS, supplement drinks) with a 1–4 word name and the mL consumed, from typical sizes: soup bowl 200 mL, cup 150 mL, glass 200 mL, and the number of their dish. A cup or glass holding a drink goes under fluids with its number, not under dishes. Soup or dal eaten from a bowl is a dish (soup_broth, dal_lentils); list it under fluids too only if it was drunk as a liquid. Leave out water jugs, which are charted separately.
6. Report issues: not_a_meal, blurred, partly_hidden, tray_empty_unclear (cannot tell eaten from not served).

A dish's food coverage is the share of the dish still covered by food. Near 0 means mostly eaten or never served, and coverage cannot tell which: check the photo.

Confidence >= 0.85 only when every item and its leftovers are clearly visible.
Describe only what is on the tray. Never comment on diet, nutrition or the patient's health.`

export const MEAL_PROMPT = 'Read this meal tray.'

const cut = (s: string, n: number) => s.trim().slice(0, n)

/**
 * Pure: model output → the stored reading, trimmed to the evidence bounds. A cited region outside the segmentation (or
 * any region without one) becomes 0, with no box or coverage. Dishes come only from `dishes`, so a cup cited only by a
 * fluid is a drink, not a dish.
 */
export function toMealReading(m: MealModelOutput, seg: TraySegmentation | null): MealReading {
  const regionOf = (n: number) => (seg && n >= 1 && n <= seg.regions.length ? seg.regions.find((r) => r.index === n) : undefined)
  const dishes = m.dishes
    .slice(0, MEAL_BOUNDS.items)
    .map((d): MealDish => {
      const r = regionOf(d.region)
      return {
        index: r ? r.index : 0,
        name: cut(d.name, MEAL_BOUNDS.name),
        dish_kind: d.dish_kind,
        portion: PERCENT[d.eaten],
        basis: 'model',
        box: r ? r.box : null,
        coverage: r ? r.coverage : null,
        model_portion: PERCENT[d.eaten],
        measure: null,
      }
    })
    .filter((d) => d.name)
  const fluids = m.fluids.slice(0, MEAL_BOUNDS.fluids).map((f): MealFluid => ({
    index: regionOf(f.region)?.index ?? 0,
    // Drink-name rules (capture/photo-reading "Drink name bounds"); an empty name becomes the kind's label.
    name: cleanDrinkName(f.name) ?? DRINK_LABEL[f.fluid_kind],
    fluid_kind: f.fluid_kind,
    volume_ml: Math.min(f.volume_ml, MEAL_BOUNDS.ml),
  }))
  return {
    items: dishes.map((d) => ({ name: d.name, portion: d.portion })),
    dishes,
    portion: PERCENT[m.eaten],
    fluids,
    confidence: m.confidence,
    issues: [...new Set(m.issues)],
    notes: m.notes === null ? null : cut(m.notes, MEAL_BOUNDS.notes) || null,
  }
}

/** Pure: reading → the form's draft. Fluids of 0 mL are left out; items cut to the meal's 200 characters. */
export function toMealDraft(r: MealReading): MealDraft {
  const fluid = r.fluids.reduce((n, f) => n + f.volume_ml, 0)
  return {
    portion: r.portion,
    items: joinItems(r.items),
    fluid_ml: fluid > 0 ? Math.min(fluid, MEAL_BOUNDS.ml) : null,
    dishes: r.dishes.map(({ index, name, dish_kind, portion }) => ({ index, name, dish_kind, portion })),
  }
}

/** Pure: should the attendant check the tray before saving? */
export const mealNeedsReview = (r: MealReading): boolean => r.confidence < AUTO_CONFIRM_CONFIDENCE || r.issues.length > 0
