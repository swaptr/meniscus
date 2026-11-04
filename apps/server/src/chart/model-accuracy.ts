/**
 * Model accuracy in the ward (charting/model-accuracy): the link checks, each draft's outcome, and the summary. Pure, over
 * rows the store reads; outcomes are derived at query time from the read, its links and the linked records. No model
 * requests.
 */
import {
  BAG_CATEGORY,
  CONTAINER_KINDS,
  DRINK_KINDS,
  MIN_N,
  NEGATIVE_ISSUES,
  READ_ABANDON_HOURS,
  READ_OUTCOMES,
  VOLUME_TOLERANCE_ML,
  type BagContainer,
  type ClassRow,
  type ContainerKind,
  type ContainerRow,
  type BagEvent,
  type DishKind,
  type DrinkKind,
  type EntryCategory,
  type EntryStatus,
  type KindRow,
  type ModelQuality,
  type Portion,
  type ReadKind,
  type ReadMode,
  type ReadOutcome,
  type UrineColour,
  type Ward,
} from '@meniscus/shared'
import type { DraftFacts, StoredRead } from '../ai/read-log.ts'
import { pairDishes, portionAgreement, rate, summariseVolume, tallyClasses, topCorrections } from './scoring.ts'

/** The record a save would link: an entry, a jug level, a bag reading (a level with an event), or a meal. */
export type LinkRecord = 'entry' | 'level' | 'bag' | 'meal'

export interface LinkContext {
  /** The signed-in staff member. */
  staffId: number | null
  /** The record's admission. */
  admissionId: number
  record: LinkRecord
  /** The record's source. */
  source: string
  /** The draft index (`read_draft`, default 0). */
  draft: number
  now: number
}

export interface LinkProblem {
  path: 'read_id' | 'read_draft'
  message: string
}

/** Which records and sources each read kind may link (design.md §3). */
const PAIRS: Record<ReadKind, { record: LinkRecord; source: string }[]> = {
  photo: [
    { record: 'entry', source: 'photo' },
    { record: 'level', source: 'photo' },
    { record: 'bag', source: 'photo' },
  ],
  text: [{ record: 'entry', source: 'text' }],
  voice: [{ record: 'entry', source: 'voice' }],
  tray: [{ record: 'meal', source: 'photo' }],
}

/**
 * Why `read`'s draft may not be linked to the record, or null. `linked` is whether that draft already is. Checks in
 * order: exists, same staff member, names the record's bed, under READ_ABANDON_HOURS old, kind matches record and
 * source, draft exists, unlinked. `already linked` at `read_id` is a contract: the web's retry relies on it.
 */
export function linkProblem(read: StoredRead | undefined, linked: boolean, ctx: LinkContext): LinkProblem | null {
  const at = (message: string): LinkProblem => ({ path: 'read_id', message })
  if (!read) return at('no such read')
  if (read.staff_id !== ctx.staffId) return at('a read by another staff member')
  if (read.admission_id === null) return at('the read names no bed')
  if (read.admission_id !== ctx.admissionId) return at('a read of another bed')
  if (ctx.now - read.created_at >= READ_ABANDON_HOURS * 3_600_000) return at(`a read more than ${READ_ABANDON_HOURS} h old`)
  if (!PAIRS[read.kind].some((p) => p.record === ctx.record && p.source === ctx.source)) {
    return at(`a ${read.kind} read cannot link a ${ctx.source} ${ctx.record === 'bag' ? 'bag reading' : ctx.record}`)
  }
  // Meals have no read_draft: a tray read has at most one draft, so its missing draft is reported at read_id.
  if (ctx.draft >= read.drafts) return { path: ctx.record === 'meal' ? 'read_id' : 'read_draft', message: 'no such draft' }
  if (linked) return at('already linked')
  return null
}

/** An `amended` event of a linked entry: ml and category always, colours only when the colour changed. */
export interface OutcomeAmend {
  from_ml: number | null
  to_ml: number | null
  from_category: EntryCategory | null
  to_category: EntryCategory | null
  from_colour: UrineColour | null
  to_colour: UrineColour | null
}

/** A dish as the outcome rows compare it: kind and portion, never its name. */
export interface DishFacts {
  dish_kind: DishKind
  portion: Portion
}

/** A linked meal as it now stands, with what was saved and its history (design.md §3). Kinds and portions only. */
export interface OutcomeMeal {
  id: number
  voided: boolean
  /** Current values. */
  portion: Portion
  dishes: DishFacts[]
  /** The fluid mL posted with the meal (a meal amend never changes it). */
  fluid_ml: number | null
  /** `proof.confirmed` when the meal has a proof. */
  confirmed: { portion: Portion; fluid_ml: number | null; dishes: DishFacts[] } | null
  /** `meal_event` amendments, oldest first. */
  amends: { before: { portion: Portion; dishes: DishFacts[] }; after: { portion: Portion; dishes: DishFacts[] } }[]
  /** The fluid entry, when the meal has one. */
  entry: {
    status: EntryStatus
    volume_ml: number
    recorded_ml: number
    approved_ml: number | null
    amends: { from_ml: number | null; to_ml: number | null }[]
  } | null
}

/** A linked record as it now stands: an entry with its history, a level (a jug level, or a bag reading with its event), or a meal. */
export type OutcomeLink =
  | {
      draft: number
      entry: {
        status: EntryStatus
        category: EntryCategory
        volume_ml: number
        urine_colour: UrineColour | null
        /** Water and food only. */
        drink: DrinkKind | null
        recorded_ml: number
        approved_ml: number | null
        /** The `recorded` event's category: the type at save. */
        recorded_category: EntryCategory
        amends: OutcomeAmend[]
      }
      level?: undefined
      meal?: undefined
    }
  | { draft: number; level: { volume_ml: number; container: string; event: BagEvent | null }; entry?: undefined; meal?: undefined }
  | { draft: number; meal: OutcomeMeal; entry?: undefined; level?: undefined }

export interface OutcomeRead extends StoredRead {
  /** The ward of the read's bed; null for a bedless read. */
  ward_id: number | null
  links: OutcomeLink[]
  /**
   * A tray read only: a later tray read by the same staff member for the same admission came at most
   * READ_RETAKE_MINUTES after it ("Retaken tray reads"). Derived by the store; never for a bedless read.
   */
  retaken?: boolean
}

/** A tray draft: what the model drafted and, once the meal is settled, what stands. Kinds, portions and mL only. */
export interface MealScore {
  draft: { portion: Portion; fluid_ml: number | null; dishes: DishFacts[] }
  /** Null until settled (accepted, edited at capture or corrected by a nurse). `fluid_ml` null: no fluid charted at the end. */
  final: { portion: Portion; fluid_ml: number | null; dishes: DishFacts[] } | null
}

/** One draft of a read, or a read with none, with its outcome and, once settled, what it is scored against. */
export interface OutcomeItem {
  read_id: number
  kind: ReadKind
  mode: ReadMode | null
  outcome: ReadOutcome
  /** The read had a NEGATIVE_ISSUES code. */
  negative: boolean
  /** Photo reads: the container the model read. */
  container: ContainerKind | null
  /** The draft as the model read it; null for a read with none, and for tray drafts (see `meal`). */
  draft: DraftFacts | null
  /** The record as it now stands: type, volume, and (entries only) urine colour. Null when not linked, and for meals. */
  final: { category: EntryCategory; volume_ml: number; urine_colour: UrineColour | null; drink: DrinkKind | null; entry: boolean } | null
  /** Tray drafts only. */
  meal?: MealScore
}

const HOUR_MS = 3_600_000
const isNegative = (r: StoredRead) => r.issues.some((i) => (NEGATIVE_ISSUES as readonly string[]).includes(i))
const draftOf = (r: StoredRead, i: number): DraftFacts | null =>
  r.output.kind === 'photo' ? r.output.draft : r.output.kind === 'tray' ? null : (r.output.drafts[i] ?? null)

/** The record's type as charted: a jug level counts as `water`, a bag reading as the bag's category. */
const finalOf = (link: OutcomeLink): NonNullable<OutcomeItem['final']> | null =>
  link.entry
    ? {
        category: link.entry.category,
        volume_ml: link.entry.volume_ml,
        urine_colour: link.entry.urine_colour,
        drink: link.entry.drink,
        entry: true,
      }
    : link.level
      ? {
          category: link.level.event === null ? 'water' : BAG_CATEGORY[link.level.container as BagContainer],
          volume_ml: link.level.volume_ml,
          urine_colour: null,
          drink: null,
          entry: false,
        }
      : null

/** A linked entry's outcome (design.md §4 rows 8–13): pending and rejected first, then the nurse's change, then the attendant's. */
function entryOutcome(e: NonNullable<OutcomeLink['entry']>, d: DraftFacts | null): ReadOutcome {
  if (e.status === 'pending') return 'pending'
  if (e.status === 'rejected') return 'rejected'
  const amended = e.amends.some(
    (a) => a.from_ml !== a.to_ml || a.from_category !== a.to_category || (a.from_colour ?? null) !== (a.to_colour ?? null),
  )
  if ((e.approved_ml !== null && e.approved_ml !== e.recorded_ml) || amended) return 'corrected_by_nurse'
  const colourChange = e.amends.find((a) => (a.from_colour ?? null) !== (a.to_colour ?? null))
  const savedColour = colourChange ? colourChange.from_colour : e.urine_colour
  if (e.recorded_ml !== d?.volume_ml || e.recorded_category !== d.category || (savedColour ?? null) !== (d.urine_colour ?? null)) {
    return 'edited_at_capture'
  }
  return 'accepted'
}

/** The sorted `(dish_kind, portion)` multiset, as a comparable key. Names never count. */
const multiset = (ds: readonly DishFacts[]) =>
  ds
    .map((d) => `${d.dish_kind}:${d.portion}`)
    .sort()
    .join(',')

/** The values the meal was saved with: its proof, else the first amendment's before-values, else its current values. */
const savedOf = (m: OutcomeMeal) =>
  m.confirmed ??
  (m.amends[0] ? { ...m.amends[0].before, fluid_ml: m.fluid_ml } : { portion: m.portion, dishes: m.dishes, fluid_ml: m.fluid_ml })

/** A linked meal's outcome (design.md §3, rows M3–M7): voided, pending, the nurse's change, the attendant's, else accepted. */
function mealOutcome(m: OutcomeMeal, d: MealScore['draft']): ReadOutcome {
  if (m.voided) return 'rejected'
  const e = m.entry
  if (e?.status === 'pending') return 'pending'
  const nurse =
    m.amends.some((a) => a.before.portion !== a.after.portion || multiset(a.before.dishes) !== multiset(a.after.dishes)) ||
    e?.status === 'rejected' ||
    (e !== null && e.approved_ml !== null && e.approved_ml !== e.recorded_ml) ||
    (e?.amends.some((a) => a.from_ml !== a.to_ml) ?? false)
  if (nurse) return 'corrected_by_nurse'
  const saved = savedOf(m)
  if (saved.portion !== d.portion || saved.fluid_ml !== d.fluid_ml || multiset(saved.dishes) !== multiset(d.dishes))
    return 'edited_at_capture'
  return 'accepted'
}

/** What stands of a settled meal: its current portion and dishes, and its fluid entry's volume unless rejected. */
const mealFinal = (m: OutcomeMeal): NonNullable<MealScore['final']> => ({
  portion: m.portion,
  dishes: m.dishes,
  fluid_ml: m.entry && m.entry.status !== 'rejected' ? m.entry.volume_ml : null,
})

const SETTLED: readonly ReadOutcome[] = ['accepted', 'edited_at_capture', 'corrected_by_nurse']
const DECIDED: readonly ReadOutcome[] = [...SETTLED, 'rejected']

/** Each draft's outcome as of `now`, or the read's when it has none (design.md §4, and §3 for trays). Pure. */
export function outcomes(reads: OutcomeRead[], now: number): OutcomeItem[] {
  const items: OutcomeItem[] = []
  for (const r of reads) {
    const negative = isNegative(r)
    const base = {
      read_id: r.id,
      kind: r.kind,
      mode: r.kind === 'photo' || r.kind === 'tray' ? r.mode : null,
      negative,
      container: r.output.kind === 'photo' ? r.output.container : null,
    }
    if (r.drafts === 0) {
      items.push({ ...base, outcome: negative ? 'negative_confirmed' : 'nothing_drafted', draft: null, final: null })
      continue
    }
    const young = now - r.created_at < READ_ABANDON_HOURS * HOUR_MS
    const trayDraft = r.output.kind === 'tray' ? r.output.draft : null
    for (let i = 0; i < r.drafts; i++) {
      const draft = draftOf(r, i)
      const link = r.links.find((l) => l.draft === i)
      const meal = trayDraft ? { meal: { draft: trayDraft, final: null } } : {}
      if (!link) {
        // Row R0: an unlinked tray draft superseded by a later read of the same bed is retaken, at once and for good.
        const outcome: ReadOutcome = trayDraft && r.retaken ? 'retaken' : young ? 'open' : negative ? 'negative_confirmed' : 'abandoned'
        items.push({ ...base, outcome, draft, final: null, ...meal })
        continue
      }
      if (link.meal) {
        const d = trayDraft ?? { portion: link.meal.portion, fluid_ml: null, dishes: [] }
        // Rows M1–M2: a negative read's meal is overridden while it stands.
        const outcome: ReadOutcome = negative
          ? link.meal.voided
            ? 'negative_confirmed'
            : 'negative_overridden'
          : mealOutcome(link.meal, d)
        const final = SETTLED.includes(outcome) ? mealFinal(link.meal) : null
        items.push({ ...base, outcome, draft: null, final: null, meal: { draft: d, final } })
        continue
      }
      const final = finalOf(link)
      let outcome: ReadOutcome
      if (negative) outcome = link.entry?.status === 'rejected' ? 'negative_confirmed' : 'negative_overridden'
      else if (link.entry) outcome = entryOutcome(link.entry, draft)
      else outcome = link.level.volume_ml !== draft?.volume_ml ? 'edited_at_capture' : 'accepted'
      items.push({ ...base, outcome, draft, final })
    }
  }
  return items
}

const settled = (i: OutcomeItem) => SETTLED.includes(i.outcome) && i.final !== null
const settledMeal = (i: OutcomeItem): i is OutcomeItem & { meal: { final: NonNullable<MealScore['final']> } } =>
  SETTLED.includes(i.outcome) && i.meal?.final != null

/** Model volume against the final volume, over settled entries, levels and bag readings (never meal fluid). */
const volumeOf = (items: OutcomeItem[]) =>
  summariseVolume(items.filter(settled).map((i) => ({ model: i.draft?.volume_ml ?? null, final: i.final!.volume_ml })))

/** Drafted fluid mL against the final fluid, over settled meals ("Fluid with a meal"). */
function mealFluid(items: OutcomeItem[]): ModelQuality['meal_fluid'] {
  const pairs = items.filter(settledMeal).map((i) => ({ model: i.meal.draft.fluid_ml, final: i.meal.final.fluid_ml }))
  return { volume: summariseVolume(pairs), removed: pairs.filter((p) => p.model !== null && p.final === null).length }
}

/** The six kind rows, always, in this order. */
const KINDS: { kind: ReadKind; mode: ReadMode | null }[] = [
  { kind: 'photo', mode: 'sam+spark' },
  { kind: 'photo', mode: 'spark' },
  { kind: 'text', mode: null },
  { kind: 'voice', mode: null },
  { kind: 'tray', mode: 'sam+spark' },
  { kind: 'tray', mode: 'spark' },
]

const countOutcomes = (items: OutcomeItem[]) => {
  const counts = Object.fromEntries(READ_OUTCOMES.map((o) => [o, 0])) as Record<ReadOutcome, number>
  for (const i of items) counts[i.outcome]++
  return counts
}

function kindRow(kind: ReadKind, mode: ReadMode | null, all: OutcomeItem[]): KindRow {
  const items = all.filter((i) => i.kind === kind && i.mode === mode)
  const counts = countOutcomes(items)
  const decided = DECIDED.reduce((s, o) => s + counts[o], 0)
  return {
    kind,
    mode,
    drafts: items.length,
    outcomes: counts,
    accepted: rate(counts.accepted, decided),
    corrected: rate(counts.edited_at_capture + counts.corrected_by_nurse, decided),
    rejected: rate(counts.rejected, decided),
    edited_at_capture: rate(counts.edited_at_capture, decided),
    corrected_by_nurse: rate(counts.corrected_by_nurse, decided),
    // A tray row's volume is its meal fluid.
    volume: kind === 'tray' ? mealFluid(items).volume : volumeOf(items),
  }
}

/**
 * The type, urine colour and dish kind tables, by the model's class (design.md §5, §4). A level's final type is `water`
 * (jug) or the bag's category; levels skip the colour table, which scores entries where either side is urine. Dishes
 * are paired per settled meal (`pairDishes`): `none` as the model is a dish staff added, as the final one a dish removed.
 */
function classTables(items: OutcomeItem[]): ModelQuality['classes'] {
  const decided = items.filter((i) => DECIDED.includes(i.outcome) && i.draft !== null && i.final !== null)
  const type = decided.map((i) => ({ model: i.draft!.category, final: i.final!.category, settled: settled(i) }))
  const urine_colour = decided
    .filter((i) => i.final!.entry && (i.draft!.category === 'urine' || i.final!.category === 'urine'))
    .map((i) => ({ model: i.draft!.urine_colour ?? 'none', final: i.final!.urine_colour ?? 'none', settled: settled(i) }))
  const dish_kind = items.filter(settledMeal).flatMap((i) =>
    pairDishes(i.meal.draft.dishes, i.meal.final.dishes).map((p) => ({
      model: p.model?.dish_kind ?? 'none',
      final: p.final?.dish_kind ?? 'none',
      settled: true,
    })),
  )
  return {
    type: tallyClasses(type, 'model'),
    urine_colour: tallyClasses(urine_colour, 'model'),
    dish_kind: tallyClasses(dish_kind, 'model'),
  }
}

/** Dish portions per pair and the meal portion, over settled meals ("Portion agreement"). */
const DRINK_ORDER = new Map<string, number>(DRINK_KINDS.map((k, i) => [k, i]))

/**
 * The drink kind table: decided photo, text and voice drafts with a drink kind, the model's kind against the entry's
 * final `drink` (`none` when it has none, e.g. amended to IV). Only entries count: a saved jug level has no drink.
 * Rows in DRINK_KINDS order. Not in top_corrections.
 */
function drinkKindTable(items: OutcomeItem[]): ClassRow[] {
  const rows = items
    .filter((i) => i.kind !== 'tray' && DECIDED.includes(i.outcome) && i.draft?.drink != null && i.final?.entry === true)
    .map((i) => ({ model: i.draft!.drink!, final: i.final!.drink ?? 'none', settled: settled(i) }))
  return tallyClasses(rows, 'model').sort((a, b) => DRINK_ORDER.get(a.model)! - DRINK_ORDER.get(b.model)!)
}

function portions(items: OutcomeItem[]): Pick<ModelQuality, 'dish_portion' | 'meal_portion'> {
  const meals = items.filter(settledMeal)
  return {
    dish_portion: portionAgreement(
      meals.flatMap((i) =>
        pairDishes(i.meal.draft.dishes, i.meal.final.dishes).map((p) => ({
          model: p.model?.portion ?? null,
          final: p.final?.portion ?? null,
        })),
      ),
    ),
    meal_portion: portionAgreement(meals.map((i) => ({ model: i.meal.draft.portion, final: i.meal.final.portion }))),
  }
}

/** One row per container the photo reads named, both modes: what staff did with those drafts. Most reads first. */
function containerRows(items: OutcomeItem[]): ContainerRow[] {
  const groups = new Map<ContainerKind, OutcomeItem[]>()
  for (const i of items) if (i.kind === 'photo' && i.container) groups.set(i.container, [...(groups.get(i.container) ?? []), i])
  return [...groups]
    .map(([container, its]): ContainerRow => {
      const c = countOutcomes(its)
      const decided = DECIDED.reduce((s, o) => s + c[o], 0)
      return {
        container,
        reads: new Set(its.map((i) => i.read_id)).size,
        decided,
        accepted: rate(c.accepted, decided),
        corrected: rate(c.edited_at_capture + c.corrected_by_nurse, decided),
        rejected: rate(c.rejected, decided),
        volume: volumeOf(its),
      }
    })
    .sort((a, b) => b.reads - a.reads || CONTAINER_KINDS.indexOf(a.container) - CONTAINER_KINDS.indexOf(b.container))
}

/** Drafts of reads that are not negative, every kind: kept against not kept ("Positive drafts not kept"). */
function positives(items: OutcomeItem[]): ModelQuality['positives'] {
  const c = countOutcomes(items.filter((i) => !i.negative))
  const kept = c.accepted + c.edited_at_capture + c.corrected_by_nurse
  const notKept = c.rejected + c.abandoned
  return {
    kept: rate(kept, kept + notKept),
    not_kept: rate(notKept, kept + notKept),
    rejected: c.rejected,
    abandoned: c.abandoned,
    retaken: c.retaken,
  }
}

/** Counted, most first, then by name. */
const tally = (values: string[]) =>
  [...values.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())]
    .map(([to, n]) => ({ to, n }))
    .sort((a, b) => b.n - a.n || a.to.localeCompare(b.to))

/** GET /api/quality/model's body over the window's reads, as of `now`. No names, beds or MRNs. Pure. */
export function modelQuality(reads: OutcomeRead[], now: number, opts: { ward: Ward | null; days: number }): ModelQuality {
  const items = outcomes(reads, now)
  const count = (o: ReadOutcome) => items.filter((i) => i.outcome === o).length
  const [confirmed, overridden] = [count('negative_confirmed'), count('negative_overridden')]
  const classes = classTables(items)
  return {
    ward: opts.ward,
    since: new Date(now - opts.days * 24 * HOUR_MS).toISOString(),
    days: opts.days,
    min_n: MIN_N,
    tolerance_ml: VOLUME_TOLERANCE_ML,
    kinds: KINDS.map((k) => kindRow(k.kind, k.mode, items)),
    classes,
    drink_kind: drinkKindTable(items),
    volume: volumeOf(items),
    containers: containerRows(items),
    ...portions(items),
    meal_fluid: mealFluid(items),
    positives: positives(items),
    top_corrections: topCorrections(classes),
    negatives: {
      confirmed: rate(confirmed, confirmed + overridden),
      overridden: rate(overridden, confirmed + overridden),
      // A negative tray read whose meal stands was saved as a `meal`.
      overridden_as: tally(items.filter((i) => i.outcome === 'negative_overridden').map((i) => (i.meal ? 'meal' : i.final!.category))),
      nothing_drafted: count('nothing_drafted'),
    },
  }
}
