/** The ward's Model accuracy section: pure text and rows from GET /api/quality/model. No model requests. */
import {
  DRINK_LABEL,
  type ClassRow,
  type ClassTable,
  type ContainerKind,
  type DishKind,
  type DrinkKind,
  type KindRow,
  type ModelQuality,
  type PortionAgreement,
  type Positives,
  type Rate,
  type UrineColour,
  type VolumeError,
  type WardQuality,
} from '@meniscus/shared'
import type { Api } from './api.ts'
import { CATEGORY_LABEL, CONTAINER_LABEL, DISH_LABEL } from './labels.ts'
import { MODEL_DAYS } from './model-view.ts'
import { NO_COLOUR_LABEL, URINE_LABEL } from './urine.ts'

export { MODEL_DAYS, hospitalModelLoad, hospitalView } from './model-view.ts'

export const NO_READS_TEXT = `No AI reads in the last ${MODEL_DAYS} days`

/** `92% · 23/25`, or `— · 4/4` when the summary withholds the percentage (below MIN_N). */
export const rateText = (r: Rate): string => `${r.pct === null ? '—' : `${r.pct}%`} · ${r.n}/${r.of}`

/** Read kinds, by `kind` and, for photos and trays, `kind:mode`. */
export const KIND_LABEL = {
  'photo:sam+spark': 'Photo (SAM + Spark)',
  'photo:spark': 'Photo (Spark only)',
  text: 'Typed note',
  voice: 'Voice note',
  'tray:sam+spark': 'Tray (SAM + Spark)',
  'tray:spark': 'Tray (Spark only)',
} as const
export const kindLabel = (k: Pick<KindRow, 'kind' | 'mode'>): string =>
  k.kind === 'photo' || k.kind === 'tray' ? KIND_LABEL[`${k.kind}:${k.mode ?? 'sam+spark'}`] : KIND_LABEL[k.kind]

/** A type's name as the chart shows it (`water` is `Drink`, a meal is `Meal`); anything else as sent. */
const typeLabel = (t: string) => (t === 'meal' ? 'Meal' : (CATEGORY_LABEL[t as keyof typeof CATEGORY_LABEL] ?? t))
const dishLabel = (d: string) => DISH_LABEL[d as DishKind] ?? d
const colourLabel = (c: string) => (c === 'none' ? NO_COLOUR_LABEL : (URINE_LABEL[c as UrineColour] ?? c))
const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
const containerLabel = (c: ContainerKind) => (c === 'other' ? 'Other' : upper(CONTAINER_LABEL[c]))

/** The section opens on the chart (web/ward "Chart or table"). */
export const MODEL_VIEW_DEFAULT = 'chart'
export type ModelView = 'chart' | 'table'

export interface Table {
  headers: string[]
  rows: { label: string; cells: string[] }[]
}

/** Whether any read kind has a draft (or a read with none) in the window. */
export const hasReads = (q: ModelQuality) => q.kinds.some((k) => k.drafts > 0)
/** Whether either tray kind has a draft in the window. */
const hasTrays = (q: Pick<ModelQuality, 'kinds'>) => q.kinds.some((k) => k.kind === 'tray' && k.drafts > 0)

/** The chart's table view: one row per kind with drafts. Decided = accepted + edited + corrected + rejected (the rates' `of`). */
export const kindRows = (q: ModelQuality): Table => ({
  headers: ['Read', 'Decided', 'Accepted', 'Edited at capture', 'Corrected by a nurse', 'Rejected', 'Abandoned'],
  rows: q.kinds
    .filter((k) => k.drafts > 0)
    .map((k) => ({
      label: kindLabel(k),
      cells: [
        String(k.accepted.of),
        rateText(k.accepted),
        rateText(k.edited_at_capture),
        rateText(k.corrected_by_nurse),
        rateText(k.rejected),
        String(k.outcomes.abandoned),
      ],
    })),
})

const CLASS_HEADERS = ['Model read', 'Decided', 'Kept', 'Changed to']
const classTable = (rows: ClassRow[], label: (c: string) => string, to: (c: string) => string = label): Table => ({
  headers: CLASS_HEADERS,
  rows: rows.map((r) => ({
    label: label(r.model),
    cells: [String(r.n), rateText(r.kept), r.corrections.length ? r.corrections.map((x) => `${to(x.to)} ${x.n}`).join(', ') : '—'],
  })),
})

/** The "Drink and fluid" table: what happened when the model read each type. */
export const typeRows = (q: ModelQuality): Table => classTable(q.classes.type, typeLabel)
/** The "Drink kind" table: what happened when the model named each drink kind. `none`: no kind at the end. */
export const drinkRows = (q: ModelQuality): Table =>
  classTable(
    q.drink_kind,
    (d) => DRINK_LABEL[d as DrinkKind] ?? d,
    (d) => (d === 'none' ? 'None' : (DRINK_LABEL[d as DrinkKind] ?? d)),
  )
/** The "Urine colour" table. `none`: no colour drafted, or none charted. */
export const colourRows = (q: ModelQuality): Table => classTable(q.classes.urine_colour, colourLabel)
/** The "Dish" table. A model `none` is a dish staff added; a change to `none` is a dish staff removed. */
export const dishRows = (q: ModelQuality): Table =>
  classTable(
    q.classes.dish_kind,
    (d) => (d === 'none' ? 'Not read (added by staff)' : dishLabel(d)),
    (d) => (d === 'none' ? 'Removed' : dishLabel(d)),
  )

/** The "Container" table: what staff did with drafts of reads that named each container. */
export const containerRows = (q: ModelQuality): Table => ({
  headers: ['Container read', 'Reads', 'Decided', 'Accepted', 'Corrected', 'Rejected', `Within ±${q.tolerance_ml} mL`],
  rows: q.containers.map((c) => ({
    label: containerLabel(c.container),
    cells: [
      String(c.reads),
      String(c.decided),
      rateText(c.accepted),
      rateText(c.corrected),
      rateText(c.rejected),
      rateText(c.volume.within),
    ],
  })),
})

/** Portions in quarters: `Same portion` then `<k> quarter(s) off`. No rows when no pair has both portions. */
export const portionRows = (p: PortionAgreement): Table => ({
  headers: ['Difference', 'Pairs'],
  rows:
    p.of === 0
      ? []
      : p.quarters_off.map((n, k) => ({
          label: k === 0 ? 'Same portion' : `${k} ${k === 1 ? 'quarter' : 'quarters'} off`,
          cells: [String(n)],
        })),
})
/** `Same 40% · 2/5 · within a quarter 60% · 3/5`. */
export const portionText = (p: PortionAgreement) => `Same ${rateText(p.exact)} · within a quarter ${rateText(p.within_quarter)}`

/** The `Table` select's options, in order; the type table first. */
export const CLASS_PICKS = [
  { id: 'type', label: 'Drink and fluid' },
  { id: 'drink_kind', label: 'Drink kind' },
  { id: 'urine_colour', label: 'Urine colour' },
  { id: 'containers', label: 'Container' },
  { id: 'dish_kind', label: 'Dish' },
  { id: 'dish_portion', label: 'Dish portion' },
  { id: 'meal_portion', label: 'Meal portion' },
] as const
export type ClassPick = (typeof CLASS_PICKS)[number]['id']

/** The picked class table, from the one summary: never a request. */
export function classRows(pick: ClassPick, q: ModelQuality): Table {
  switch (pick) {
    case 'type':
      return typeRows(q)
    case 'drink_kind':
      return drinkRows(q)
    case 'urine_colour':
      return colourRows(q)
    case 'containers':
      return containerRows(q)
    case 'dish_kind':
      return dishRows(q)
    case 'dish_portion':
      return portionRows(q.dish_portion)
    case 'meal_portion':
      return portionRows(q.meal_portion)
  }
}

const NOUN: Record<Exclude<ClassPick, 'dish_kind' | 'dish_portion' | 'meal_portion'>, string> = {
  type: 'drink and fluid drafts',
  drink_kind: 'drink drafts',
  urine_colour: 'urine colour drafts',
  containers: 'container reads',
}
/** The one cell under an empty table's header. Tray tables count settled meals only, so open or pending trays say so. */
export function emptyText(pick: ClassPick, q: Pick<ModelQuality, 'kinds'>): string {
  if (pick === 'dish_kind' || pick === 'dish_portion' || pick === 'meal_portion')
    return hasTrays(q) ? `No reviewed tray meals in the last ${MODEL_DAYS} days` : `No tray reads in the last ${MODEL_DAYS} days`
  return `No ${NOUN[pick]} in the last ${MODEL_DAYS} days`
}

const errorText = (v: VolumeError, tol: number) =>
  `${v.mae_ml === null ? '— mean error' : `${v.mae_ml} mL mean error`} · within ±${tol} mL ${rateText(v.within)}`

/** `18 mL mean error · within ±25 mL 83% · 20/24`, plus the drafts with no volume read when there are any. */
export function volumeText(v: VolumeError, tol: number): string {
  return `${errorText(v, tol)}${v.no_volume > 0 ? ` · ${v.no_volume} with no volume read` : ''}`
}

/** `Drafts kept 92% · 46/50 · not kept 8% · 4/50 (3 rejected, 1 abandoned)`, with `, 2 retaken` when above 0. */
export function positivesText(p: Positives): string {
  const retaken = p.retaken > 0 ? `, ${p.retaken} retaken` : ''
  return `Drafts kept ${rateText(p.kept)} · not kept ${rateText(p.not_kept)} (${p.rejected} rejected, ${p.abandoned} abandoned${retaken})`
}

/** The meal fluid line, only when a tray read is in the window. A meal's "no volume read" is a fluid staff added. */
export function mealFluidText(q: Pick<ModelQuality, 'kinds' | 'meal_fluid' | 'tolerance_ml'>): string | null {
  if (!hasTrays(q)) return null
  const { volume, removed } = q.meal_fluid
  const added = volume.no_volume > 0 ? ` · ${volume.no_volume} added by staff` : ''
  return `Fluid with meals: ${errorText(volume, q.tolerance_ml)}${added}${removed > 0 ? ` · ${removed} removed` : ''}`
}

const CORRECTION_LABEL: Record<ClassTable, (from: string, to: string) => string> = {
  type: (from, to) => `${typeLabel(from)} → ${typeLabel(to)}`,
  urine_colour: (from, to) => `Urine ${from} → ${to}`,
  dish_kind: (from, to) => `${from === 'none' ? 'Not read' : dishLabel(from)} → ${to === 'none' ? 'Removed' : dishLabel(to)}`,
}
/** `Most changed: Drink → Food 3 · Urine dark → red 2`, or `Most changed: none`. */
export function correctionsText(q: Pick<ModelQuality, 'top_corrections'>): string {
  const c = q.top_corrections.map((x) => `${CORRECTION_LABEL[x.table](x.from, x.to)} ${x.n}`)
  return `Most changed: ${c.length ? c.join(' · ') : 'none'}`
}

/** `Nothing to chart: 2 confirmed · 1 charted anyway (Drink 1)`, plus the reads with nothing drafted when there are any. */
export function negativesText(neg: ModelQuality['negatives']): string {
  const as = neg.overridden_as.length ? ` (${neg.overridden_as.map((x) => `${typeLabel(x.to)} ${x.n}`).join(', ')})` : ''
  const k = neg.nothing_drafted
  const nothing = k > 0 ? ` · ${k} ${k === 1 ? 'read' : 'reads'} with nothing drafted` : ''
  return `Nothing to chart: ${neg.confirmed.n} confirmed · ${neg.overridden.n} charted anyway${as}${nothing}`
}

/** The Data quality view's data: exactly the ward summary and the model summary, in parallel. No model request. */
export async function dataQualityLoad(
  api: Api,
  wardId: number,
  signal: AbortSignal,
): Promise<{ quality: WardQuality; model: ModelQuality }> {
  const [quality, model] = await Promise.all([api.quality(wardId, signal), api.modelQuality(wardId, MODEL_DAYS, signal)])
  return { quality, model }
}
