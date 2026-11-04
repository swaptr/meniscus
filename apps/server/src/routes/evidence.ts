/** Read evidence sent with an entry: the shape the server itself emits, with tight bounds (design: entry-evidence). */
import { z } from 'zod'
import {
  CONTAINER_KINDS,
  DISH_KINDS,
  DRINK_NAME_MAX,
  FLUID_KINDS,
  HEX_COLOUR,
  MASK_GRID,
  MATCH_MAX_DISTANCE,
  MAX_TRACE_STEPS,
  MAX_READ_WARNINGS,
  MAX_WARNING_CHARS,
  MEAL_FLUID_KINDS,
  MEAL_ISSUES,
  PORTION_BASES,
  PORTIONS,
  READ_MODES,
  READING_ISSUES,
  URINE_COLOURS,
  liquidVolumeMl,
} from '@meniscus/shared'
import { MEAL_BOUNDS } from '../ai/meal.ts'

const Ml = z.number().int().min(0).max(10_000)
/** SHA-256 as 64 lowercase hex characters. */
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const Coord = z.number().int().min(0).max(20_000)

export const Trace = z
  .object({
    step: z.string().max(32),
    model: z.string().max(64),
    ms: z.number().int().min(0),
    input_tokens: z.number().int().min(0).optional(),
    output_tokens: z.number().int().min(0).optional(),
    reasoning_tokens: z.number().int().min(0).optional(),
  })
  .strict()

const Box = z.object({ left: Coord, top: Coord, right: Coord, bottom: Coord, confidence: z.number().min(0).max(1).optional() }).strict()

const Reading = z
  .object({
    container: z.enum(CONTAINER_KINDS),
    fluid: z.enum(FLUID_KINDS),
    volume_ml: Ml.nullable(),
    capacity_ml: Ml.nullable(),
    marks_visible: z.boolean(),
    reading_basis: z.string().max(300),
    appearance: z.string().max(200).nullable(),
    urine_colour: z.enum(URINE_COLOURS).nullable().optional(),
    urine_rgb: z.string().regex(HEX_COLOUR).nullable().optional(),
    confidence: z.number().min(0).max(1),
    issues: z
      .array(z.enum(READING_ISSUES))
      .max(READING_ISSUES.length)
      .refine((xs) => new Set(xs).size === xs.length, 'issues must be unique'),
    /** Optional: evidence stored before drink kinds has none. */
    drink_name: z.string().max(DRINK_NAME_MAX).nullable().optional(),
  })
  .strict()

/** Characters of base64 for MASK_GRID × MASK_GRID bits: 128 bytes → 172. */
const MAX_MASK_CHARS = Math.ceil((MASK_GRID * MASK_GRID) / 8 / 3) * 4
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const base64Bytes = (s: string) => (s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0)

/** A packed one-bit mask: at most 32 × 32 cells, in exactly ⌈w·h/8⌉ bytes. */
export const MaskBits = z
  .object({
    width: z.number().int().min(1).max(MASK_GRID),
    height: z.number().int().min(1).max(MASK_GRID),
    bits: z.string().max(MAX_MASK_CHARS).regex(BASE64),
  })
  .strict()
  .refine((m) => base64Bytes(m.bits) === Math.ceil((m.width * m.height) / 8), {
    path: ['bits'],
    message: 'bits must hold width × height cells',
  })

/**
 * Photo segmentation as the read returns it. The masks and the liquid region's volume are optional, so evidence stored
 * before they were kept still parses and round-trips unchanged (charting/photo-evidence).
 */
const PhotoSegmentation = z
  .object({
    container: Box.nullable(),
    fluid: Box.nullable(),
    fill_fraction: z.number().min(0).max(1).nullable(),
    container_mask: MaskBits.nullable().optional(),
    fluid_mask: MaskBits.nullable().optional(),
    fluid_volume_ml: Ml.nullable().optional(),
  })
  .strict()

export const PhotoEvidence = z
  .object({
    kind: z.literal('photo'),
    mode: z.enum(READ_MODES),
    /** The read's image fingerprint; equals the posted media's sha256 (checked by the route). Absent on older evidence. */
    image_sha256: Sha256.optional(),
    reading: Reading,
    segmentation: PhotoSegmentation.nullable(),
    review_reasons: z.array(z.string().max(200)).max(8),
    trace: z.array(Trace).max(3),
    colour: z
      .string()
      .regex(/^#[0-9a-f]{6}$/)
      .nullable(),
  })
  .strict()
  // A stored region volume always agrees with the stored fill and capacity ("Liquid region volume in stored evidence").
  .refine(
    (e) =>
      e.segmentation?.fluid_volume_ml === undefined ||
      e.segmentation.fluid_volume_ml === liquidVolumeMl(e.segmentation.fill_fraction, e.reading.capacity_ml),
    { path: ['segmentation', 'fluid_volume_ml'], message: 'fluid_volume_ml must be the fill × the capacity, to 10 mL' },
  )

const AudioMs = z.number().int().min(0).max(3_600_000)

const Turn = z.object({ start_ms: AudioMs, end_ms: AudioMs, text: z.string().max(500) }).strict()

const NoteEvidence = z
  .object({
    kind: z.enum(['voice', 'text']),
    transcript: z.string().max(2000),
    draft_ml: Ml.nullable(),
    trace: z.array(Trace).max(3),
    /** Voice: the recording's length and its timed turns. */
    duration_ms: AudioMs.nullable().optional(),
    turns: z.array(Turn).max(200).optional(),
  })
  .strict()

export const Evidence = z.discriminatedUnion('kind', [PhotoEvidence, NoteEvidence])

/** Evidence kind must match the entry source; manual entries carry none. */
export const evidenceMatchesSource = (e: { source: string; evidence?: { kind: string } | null }) =>
  !e.evidence || (e.source !== 'manual' && e.evidence.kind === e.source)

// ---------- tray evidence (charting/meals "Tray evidence stored with the meal") ----------

const RegionIndex = z.number().int().min(0).max(MEAL_BOUNDS.regions)
const ServedIndex = z.number().int().min(1).max(MEAL_BOUNDS.regions)
const Name = z.string().max(MEAL_BOUNDS.name)
const Coverage = z.number().min(0).max(1)

/** A tray read as `POST /api/ai/meal` returns it, within the bounds every read is trimmed to. */
export const MealReadingSchema = z
  .object({
    items: z.array(z.object({ name: Name, portion: z.literal(PORTIONS) }).strict()).max(MEAL_BOUNDS.items),
    dishes: z
      .array(
        z
          .object({
            index: RegionIndex,
            name: Name,
            dish_kind: z.enum(DISH_KINDS),
            portion: z.literal(PORTIONS),
            basis: z.enum(PORTION_BASES),
            box: Box.nullable(),
            coverage: Coverage.nullable(),
            model_portion: z.literal(PORTIONS),
            measure: z.object({ served_index: ServedIndex, served_coverage: Coverage }).strict().nullable(),
          })
          .strict()
          .refine((d) => (d.basis === 'measured') === (d.measure !== null), {
            path: ['measure'],
            message: 'a measure is set exactly when the basis is measured',
          }),
      )
      .max(MEAL_BOUNDS.items),
    portion: z.literal(PORTIONS),
    fluids: z
      .array(
        z
          .object({
            index: RegionIndex,
            name: Name,
            fluid_kind: z.enum(MEAL_FLUID_KINDS),
            volume_ml: z.number().int().min(0).max(MEAL_BOUNDS.ml),
          })
          .strict(),
      )
      .max(MEAL_BOUNDS.fluids),
    confidence: z.number().min(0).max(1),
    issues: z
      .array(z.enum(MEAL_ISSUES))
      .max(MEAL_ISSUES.length)
      .refine((xs) => new Set(xs).size === xs.length, 'issues must be unique'),
    notes: z.string().max(MEAL_BOUNDS.notes).nullable(),
  })
  .strict()

const TrayRegion = z
  .object({ index: z.number().int().min(1).max(MEAL_BOUNDS.regions), box: Box, coverage: Coverage, mask: MaskBits, food: MaskBits })
  .strict()

const TraySegmentation = z.object({ regions: z.array(TrayRegion).max(MEAL_BOUNDS.regions), loose_food: Coverage.nullable() }).strict()
const ImageSize = z.object({ width: z.number().int().min(1).max(65_535), height: z.number().int().min(1).max(65_535) }).strict()

/** The served photo a tray read compared with, as it returned it; its id and fingerprint are checked by the meal route. */
const TrayComparison = z
  .object({
    served_media_id: z.number().int().positive(),
    served_sha256: Sha256,
    served_at: z.iso.datetime({ offset: true }),
    size: ImageSize.nullable(),
    served_size: ImageSize.nullable(),
    served: TraySegmentation.nullable(),
    matches: z
      .array(
        z.object({ index: ServedIndex, served_index: ServedIndex, distance2: z.number().int().min(0).max(MATCH_MAX_DISTANCE) }).strict(),
      )
      .max(MEAL_BOUNDS.regions),
  })
  .strict()

/** A photo meal's evidence: the read as returned, bound to its photo by `image_sha256` (checked by the meal route). */
export const MealEvidenceSchema = z
  .object({
    mode: z.enum(READ_MODES),
    image_sha256: Sha256,
    reading: MealReadingSchema,
    segmentation: TraySegmentation.nullable(),
    // A read without a served photo may leave it out; it is stored as null.
    comparison: TrayComparison.nullable().default(null),
    warnings: z.array(z.string().max(MAX_WARNING_CHARS)).max(MAX_READ_WARNINGS),
    trace: z.array(Trace).max(MAX_TRACE_STEPS),
  })
  .strict()
