/** Container-reading task for Muse Spark: prompt, output contract, context builder. */
import { z } from 'zod'
import { drinkName, normaliseUrine, nullableText, URINE_WIRE, wireColour } from './text.ts'
import { CONTAINER_KINDS, FLUID_KINDS, READING_ISSUES, type Segmentation } from '@meniscus/shared'

export const ReadingSchema = z
  .object({
    container: z.enum(CONTAINER_KINDS),
    fluid: z.enum(FLUID_KINDS),
    volume_ml: z.number().int().min(0).max(10_000).nullable(),
    capacity_ml: z.number().int().min(0).max(10_000).nullable(),
    marks_visible: z.boolean(),
    reading_basis: z.string(),
    appearance: nullableText,
    urine_colour: wireColour,
    urine_rgb: z.string().nullable().default(null),
    confidence: z.number().min(0).max(1),
    issues: z.array(z.enum(READING_ISSUES)),
    drink_name: z.string().nullable().default(null),
  })
  .transform((r) => ({
    ...r,
    ...normaliseUrine(r.fluid === 'urine', r.urine_colour, r.urine_rgb),
    drink_name: drinkName(r.drink_name, r.fluid, r.container),
  }))

export const READING_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'container',
    'fluid',
    'volume_ml',
    'capacity_ml',
    'marks_visible',
    'reading_basis',
    'appearance',
    'urine_colour',
    'urine_rgb',
    'confidence',
    'issues',
    'drink_name',
  ],
  properties: {
    container: { type: 'string', enum: [...CONTAINER_KINDS] },
    fluid: { type: 'string', enum: [...FLUID_KINDS] },
    volume_ml: { type: ['integer', 'null'], description: 'Liquid volume in mL at the liquid surface; null if not readable.' },
    capacity_ml: { type: ['integer', 'null'], description: 'Highest graduation printed on the container, if visible.' },
    marks_visible: { type: 'boolean' },
    reading_basis: {
      type: 'string',
      description: 'One sentence: which marks the surface lies between and how the value was interpolated.',
    },
    appearance: {
      type: ['string', 'null'],
      description: 'Neutral colour/clarity of the liquid, e.g. "pale yellow, clear". Null if no liquid.',
    },
    urine_colour: {
      type: 'string',
      enum: [...URINE_WIRE],
      description: 'Urine only: nearest name (pale = pale straw, dark = dark amber). "none" for any other liquid.',
    },
    urine_rgb: {
      type: ['string', 'null'],
      description: "Urine only: the urine's colour as seen, as #rrggbb. Discount the container's tint where you can. Null otherwise.",
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    issues: { type: 'array', items: { type: 'string', enum: [...READING_ISSUES] } },
    drink_name: {
      type: ['string', 'null'],
      description: 'The specific drink, 1–4 words, e.g. "masala chai", "filter coffee", "chaas". Null if not a drink or not identifiable.',
    },
  },
} as const

export const READING_SYSTEM = `You read fluid volumes from photos of hospital containers (urinals, bedpans, commode pans, urine/stoma/drain bags, water jugs and bottles, cups, measuring jugs) for intake/output charting.

Method:
1. Identify the container and the liquid. For a drink, pick the nearest fluid kind (water, tea, coffee, milk, juice, coconut water, buttermilk or lassi, ORS, supplement drink, soup) and give drink_name, the specific drink if you can tell (e.g. "masala chai"); otherwise null.
2. Find the printed graduation marks and their labels (mL or cc; ignore oz unless there is no metric scale).
3. Locate the liquid surface. Rigid upright containers: bottom of the meniscus. Bags: where the liquid edge meets the scale.
4. Interpolate between the two nearest labelled marks. Report an integer in mL.
5. No marks: estimate only for a standard container of known capacity; set marks_visible=false and confidence <= 0.4.

Confidence >= 0.85 only when marks are sharp and the surface clearly lies between two labelled marks. Lower it for blur, steep angle, foam, occlusion or glare, and list those in issues.
No liquid or no container visible: volume_ml=null.
Appearance is a neutral visual description for nurse review. Do not diagnose.
If the liquid is urine, set urine_colour to the nearest name and urine_rgb to its colour as seen; otherwise "none" and null.`

/** Turn optional staff hint + SAM geometry into grounding text for Spark. */
export function readingContext(hint: string | undefined, seg: Segmentation | null): string {
  const lines = ['Read this container.']
  if (hint) lines.push(`Staff selected container type: ${hint}.`)
  if (seg?.container) {
    const b = seg.container
    lines.push(`Segmentation: container spans x ${b.left}–${b.right}, y ${b.top}–${b.bottom} (pixels).`)
  }
  if (seg?.fluid) {
    const b = seg.fluid
    lines.push(`Segmentation: liquid spans x ${b.left}–${b.right}, y ${b.top}–${b.bottom}; its surface is near y=${b.top}.`)
  }
  if (seg?.fill_fraction != null) {
    lines.push(
      `Liquid fills ~${Math.round(seg.fill_fraction * 100)}% of the container height. This ignores shape: take the value from the printed marks and use this only as a sanity check.`,
    )
  }
  return lines.join('\n')
}
