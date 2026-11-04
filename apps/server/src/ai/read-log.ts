/**
 * The read log's privacy boundary (charting/model-accuracy "Read log holds no text"). Pure: a pipeline result becomes a
 * row of closed-list values, numbers, booleans and ids. Only enumerated fields are copied, and the output is parsed with
 * a schema of vocabularies and numbers, so free text added to a result later fails in tests instead of reaching the table.
 * Never: transcript, note text, reply, image, image hash, reading basis, appearance, sampled colour, draft item or notes,
 * turns, dish, fluid or drink names, boxes, masks, segmentation, comparison, warnings. The drink kind (a closed list) is kept.
 */
import { z } from 'zod'
import {
  CONTAINER_KINDS,
  DISH_KINDS,
  DRINK_KINDS,
  ENTRY_CATEGORIES,
  FLUID_KINDS,
  MEAL_FLUID_KINDS,
  MEAL_ISSUES,
  PORTIONS,
  PORTION_BASES,
  READ_KINDS,
  READ_MODES,
  READING_ISSUES,
  URINE_COLOURS,
  trayDrafts,
  type CaptureReadResult,
  type ContainerKind,
  type DraftEntry,
  type MealIssue,
  type MealReadResult,
  type NoteResult,
  type ReadKind,
  type ReadMode,
  type ReadingIssue,
} from '@meniscus/shared'

const Ml = z.number().finite().min(0).nullable()
const Colour = z.enum(URINE_COLOURS).nullable()

const Portion = z.union(PORTIONS.map((p) => z.literal(p)))
const Index = z.number().int().min(0)

/** `drink` defaults to null so reads stored before drink kinds still parse. Never the drink's name. */
const DraftFactsSchema = z
  .object({
    category: z.enum(ENTRY_CATEGORIES),
    volume_ml: Ml,
    urine_colour: Colour,
    drink: z.enum(DRINK_KINDS).nullable().default(null),
  })
  .strict()

export const ReadOutputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('photo'),
      container: z.enum(CONTAINER_KINDS),
      fluid: z.enum(FLUID_KINDS),
      volume_ml: Ml,
      capacity_ml: Ml,
      marks_visible: z.boolean(),
      urine_colour: Colour,
      draft: DraftFactsSchema.nullable(),
    })
    .strict(),
  z.object({ kind: z.enum(['text', 'voice']), drafts: z.array(DraftFactsSchema).max(50) }).strict(),
  z
    .object({
      kind: z.literal('tray'),
      /** A served photo was found for the read (`comparison` not null), compared or not. */
      served: z.boolean(),
      portion: Portion,
      dishes: z
        .array(z.object({ index: Index, dish_kind: z.enum(DISH_KINDS), portion: Portion, basis: z.enum(PORTION_BASES) }).strict())
        .max(50),
      fluids: z
        .array(z.object({ index: Index, fluid_kind: z.enum(MEAL_FLUID_KINDS), volume_ml: z.number().finite().min(0) }).strict())
        .max(50),
      /** Null when the read has no draft (no dish and no fluid mL). */
      draft: z
        .object({
          portion: Portion,
          fluid_ml: Ml,
          dishes: z.array(z.object({ dish_kind: z.enum(DISH_KINDS), portion: Portion }).strict()).max(50),
        })
        .strict()
        .nullable(),
    })
    .strict(),
])

export type DraftFacts = z.infer<typeof DraftFactsSchema>
export type ReadOutput = z.infer<typeof ReadOutputSchema>

const ReadRowSchema = z
  .object({
    kind: z.enum(READ_KINDS),
    mode: z.enum(READ_MODES).nullable(),
    /** Model ids, as the API names them. */
    models: z.array(z.string().regex(/^[\w.:/-]{1,64}$/)).max(8),
    hint: z.enum(CONTAINER_KINDS).nullable(),
    staff_id: z.number().int().positive(),
    admission_id: z.number().int().positive().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    issues: z.array(z.enum([...READING_ISSUES, ...MEAL_ISSUES])).max(READING_ISSUES.length + MEAL_ISSUES.length),
    needs_review: z.boolean(),
    drafts: z.number().int().min(0),
    output: ReadOutputSchema,
  })
  .strict()

/** What `store.recordRead` keeps; the store adds the id and the time. */
export type ReadRow = z.infer<typeof ReadRowSchema>

/** A read as stored (`store.read`). `created_at` is epoch ms on the store's clock. */
export interface StoredRead extends ReadRow {
  id: number
  created_at: number
}

export interface ReadContext {
  staffId: number
  admissionId?: number | null
  hint?: ContainerKind | null
}

const facts = (d: DraftEntry): DraftFacts => ({
  category: d.category,
  volume_ml: d.volume_ml,
  urine_colour: d.category === 'urine' ? (d.urine_colour ?? null) : null,
  drink: d.drink ?? null,
})

/** Distinct trace models, in call order. */
const modelsOf = (trace: { model: string }[]) => [...new Set(trace.map((c) => c.model))]

export function readRow(kind: 'photo', result: CaptureReadResult, ctx: ReadContext): ReadRow
export function readRow(kind: 'text' | 'voice', result: NoteResult, ctx: ReadContext): ReadRow
export function readRow(kind: 'tray', result: MealReadResult, ctx: ReadContext): ReadRow
export function readRow(kind: ReadKind, result: CaptureReadResult | NoteResult | MealReadResult, ctx: ReadContext): ReadRow {
  const base = { staff_id: ctx.staffId, admission_id: ctx.admissionId ?? null, models: modelsOf(result.trace) }
  if (kind === 'tray') {
    const r = result as MealReadResult
    const m = r.reading
    const drafts = trayDrafts(r.draft)
    return ReadRowSchema.parse({
      ...base,
      kind,
      mode: r.mode satisfies ReadMode,
      hint: null,
      confidence: m.confidence,
      issues: m.issues satisfies MealIssue[],
      needs_review: r.needs_review,
      drafts,
      output: {
        kind,
        served: r.comparison !== null,
        portion: m.portion,
        dishes: m.dishes.map((d) => ({ index: d.index, dish_kind: d.dish_kind, portion: d.portion, basis: d.basis })),
        fluids: m.fluids.map((f) => ({ index: f.index, fluid_kind: f.fluid_kind, volume_ml: f.volume_ml })),
        draft: drafts
          ? {
              portion: r.draft.portion,
              fluid_ml: r.draft.fluid_ml,
              dishes: r.draft.dishes.map((d) => ({ dish_kind: d.dish_kind, portion: d.portion })),
            }
          : null,
      },
    })
  }
  if (kind === 'photo') {
    const r = result as CaptureReadResult
    const m = r.reading
    return ReadRowSchema.parse({
      ...base,
      kind,
      mode: r.mode satisfies ReadMode,
      hint: ctx.hint ?? null,
      confidence: m.confidence,
      issues: m.issues satisfies ReadingIssue[],
      needs_review: r.needs_review,
      drafts: r.draft ? 1 : 0,
      output: {
        kind,
        container: m.container,
        fluid: m.fluid,
        volume_ml: m.volume_ml,
        capacity_ml: m.capacity_ml,
        marks_visible: m.marks_visible,
        urine_colour: m.urine_colour ?? null,
        draft: r.draft ? facts(r.draft) : null,
      },
    })
  }
  const n = result as NoteResult
  return ReadRowSchema.parse({
    ...base,
    kind,
    mode: null,
    hint: null,
    confidence: null,
    issues: [],
    needs_review: false,
    drafts: n.entries.length,
    output: { kind, drafts: n.entries.map(facts) },
  })
}
