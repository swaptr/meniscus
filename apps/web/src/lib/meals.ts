/** Meals: the capture form's rules and the bed review's rows. Pure over an injected api; no model requests except `readMeal`. */
import {
  AUTO_CONFIRM_CONFIDENCE,
  MAX_MEAL_ITEMS,
  trayDrafts,
  type DishValue,
  type ReadRef,
  type Meal,
  type MealFluid,
  type MealInput,
  type MealIssue,
  type MealKind,
  type MealReadResult,
  type Portion,
  type ServedTray,
} from '@meniscus/shared'
import type { Api } from './api.ts'
import { alreadyLinked, decideRead, readStamp, type ReadStamp } from './capture.ts'
import { mealFluidLine } from './drinks.ts'
import { STEP_LABEL } from './labels.ts'
import { linkMedia, type MediaSource } from './media.ts'
import { isPhotoRefusal, photoTooLargeMessage } from './photo.ts'
import type { ChartedAt } from './resolve.ts'
import { MIN_REASON } from './resolve-rules.ts'
import { shortName } from './staff.ts'
import { clock } from './format.ts'

export const MEAL_LABEL: Record<MealKind, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
/** How much was eaten, in words. */
export const PORTION_LABEL: Record<Portion, string> = { 0: 'None', 25: 'A quarter', 50: 'Half', 75: 'Three quarters', 100: 'All' }
/** The capture form's chips. */
export const PORTION_CHIP: Record<Portion, string> = { 0: 'None', 25: '¼', 50: '½', 75: '¾', 100: 'All' }
const ISSUE_TEXT: Record<MealIssue, string> = {
  not_a_meal: 'not a meal',
  blurred: 'blurred',
  partly_hidden: 'partly hidden',
  tray_empty_unclear: 'cannot tell eaten from not served',
}
const hhmm = (iso: string) => clock(iso)
const STATUS_TEXT = { pending: 'pending', approved: 'approved', rejected: 'rejected' } as const

/** The meal for this local time: breakfast 05:00–10:29, lunch 10:30–14:59, snack 15:00–17:59, otherwise dinner. */
export function defaultMeal(d: Date): MealKind {
  const m = d.getHours() * 60 + d.getMinutes()
  if (m >= 5 * 60 && m < 10 * 60 + 30) return 'breakfast'
  if (m >= 10 * 60 + 30 && m < 15 * 60) return 'lunch'
  if (m >= 15 * 60 && m < 18 * 60) return 'snack'
  return 'dinner'
}

export interface MealForm {
  meal: MealKind
  portion: Portion
  items: string
  fluid_ml: number | null
  /** A tray read's dishes, as edited; empty for a meal by hand or a read with none (then `items` is used). */
  dishes: DishValue[]
  /** The tray read this form was filled from, if any. */
  read: MealReadResult | null
  /** That read's log row; `send` is fixed at the first save attempt (`decideMeal`) and kept for a retry. */
  stamp?: ReadStamp | undefined
}

export const emptyMealForm = (now: Date): MealForm => ({
  meal: defaultMeal(now),
  portion: 100,
  items: '',
  fluid_ml: null,
  dishes: [],
  read: null,
})

/** What opening Meal preselects: the waiting served photo's meal, else the meal for the time of day. */
export interface MealOpen {
  meal: MealKind
  /** `Served lunch tray from 14:30 waiting`, or null. */
  waiting: string | null
}

/** Pure. `servedTray` null: the lookup failed, so it is the time of day, as for `media: null`. */
export function mealOnOpen(now: Date, servedTray: ServedTray | null): MealOpen {
  const m = servedTray?.media
  if (!m?.served_meal) return { meal: defaultMeal(now), waiting: null }
  return { meal: m.served_meal, waiting: `Served ${MEAL_LABEL[m.served_meal].toLowerCase()} tray from ${hhmm(m.created_at)} waiting` }
}

/** One `GET /served-tray` when Meal opens; a failure falls back to the time of day and is never resent. No model request. */
export async function openMeal(api: Api, admissionId: number, now: Date, signal?: AbortSignal): Promise<MealOpen> {
  const served = await api.servedTray(admissionId, signal).catch(() => null)
  return mealOnOpen(now, served)
}

/**
 * "Served tray": one `POST /media` with `served_meal`, then the message. No model request, no meal, never resent.
 */
export async function uploadServed(
  api: Api,
  admissionId: number,
  meal: MealKind,
  file: Blob,
  now: Date,
): Promise<{ ok: boolean; text: string }> {
  try {
    await api.uploadMedia(admissionId, 'photo', file, null, meal)
  } catch (err) {
    if (isPhotoRefusal(err)) return { ok: false, text: photoTooLargeMessage() }
    return { ok: false, text: 'Served tray photo not kept. You can still photograph the tray when it is collected.' }
  }
  return {
    ok: true,
    text: `Served ${MEAL_LABEL[meal].toLowerCase()} kept at ${hhmm(now.toISOString())}. Photograph the tray again when it is collected.`,
  }
}

/** The tray read's fields besides the image: the bed and the selected meal, which find its served photo. */
export const mealReadForm = (admissionId: number, f: Pick<MealForm, 'meal'>) => ({ admissionId, meal: f.meal })

/** One `/api/ai/meal` request for the bed and the selected meal; the form filled from it. */
export async function readTray(api: Api, admissionId: number, f: MealForm, photo: Blob, signal?: AbortSignal): Promise<MealForm> {
  return formFromRead(f, await api.readMeal(photo, mealReadForm(admissionId, f), signal))
}

/** `Compared with the served tray from 12:40`, `Served tray from 12:40 kept with the meal`, or null without a served photo. */
export function comparisonNote(read: MealReadResult | null): string | null {
  const c = read?.comparison
  if (!c) return null
  return c.served ? `Compared with the served tray from ${hhmm(c.served_at)}` : `Served tray from ${hhmm(c.served_at)} kept with the meal`
}

/** The meal chips are fixed while a read with a served photo is on the form: the save binds it to that meal. */
export const mealLocked = (f: Pick<MealForm, 'read'>) => !!f.read?.comparison

/** Said under the fixed meal chips (DESIGN.md 4.10), or null when they are not fixed. */
export const mealLockedReason = (f: Pick<MealForm, 'read' | 'meal'>) =>
  mealLocked(f) ? `Meal fixed to ${MEAL_LABEL[f.meal].toLowerCase()} by the served tray. Retake to change it.` : null

/** "Retake": the read and its dishes cleared, so the meal chips are free again; the meal, portion and fluid stay. */
export const retakeMeal = (f: MealForm): MealForm => ({ ...f, read: null, dishes: [], stamp: undefined })

/** Fill the form from a tray read; the meal kind stays as chosen. `at`: the device clock when the read answered. */
export const formFromRead = (f: MealForm, read: MealReadResult & Partial<ReadRef>, at = Date.now()): MealForm => ({
  ...f,
  portion: read.draft.portion,
  items: read.draft.items,
  fluid_ml: read.draft.fluid_ml,
  dishes: read.draft.dishes,
  read,
  stamp: readStamp(read, 0, at),
})

/**
 * Fixes once whether the save carries the tray read's `read_id`: not when the read is stale (`decideRead`) or drafted
 * nothing (`trayDrafts`), so a meal charted by hand on an empty read's photo is saved unlinked. Kept when already fixed.
 */
export function decideMeal(f: MealForm, now = Date.now()): MealForm {
  if (!f.stamp || f.stamp.send !== undefined) return f
  const stamp = decideRead(f.stamp, now)!
  return { ...f, stamp: f.read && trayDrafts(f.read.draft) === 0 ? { ...stamp, send: false } : stamp }
}

/** The form with dish `i` changed (its name, kind or portion). */
export const editDish = (f: MealForm, i: number, patch: Partial<Omit<DishValue, 'index'>>): MealForm => ({
  ...f,
  dishes: f.dishes.map((d, k) => (k === i ? { ...d, ...patch } : d)),
})

/** Why the form cannot be saved yet, or null: every dish needs a name. */
export const dishError = (f: Pick<MealForm, 'dishes'>) => (f.dishes.some((d) => !d.name.trim()) ? 'Name each dish.' : null)

/** "Check the tray: low confidence (0.60), partly hidden", or null when the read needs no check. */
export function mealReviewText(read: MealReadResult): string | null {
  if (!read.needs_review) return null
  const reasons = [
    ...(read.reading.confidence < AUTO_CONFIRM_CONFIDENCE ? [`low confidence (${read.reading.confidence.toFixed(2)})`] : []),
    ...read.reading.issues.map((i) => ISSUE_TEXT[i]),
  ]
  return `Check the tray: ${reasons.join(', ')}`
}

/**
 * The request body. A by-hand meal carries no confidence or evidence. With dishes, `items` is their names joined, and
 * the read goes unchanged as evidence; without, no `dishes` key is sent.
 */
export function toMealInput(f: MealForm, chartedIso: string | null): MealInput {
  const dishes = f.dishes.map((d) => ({ ...d, name: d.name.trim().slice(0, 80) }))
  const items = (dishes.length ? dishes.map((d) => d.name).join(', ') : f.items.trim()).slice(0, MAX_MEAL_ITEMS)
  return {
    meal: f.meal,
    portion: f.portion,
    items: items || null,
    fluid_ml: f.fluid_ml,
    source: f.read ? 'photo' : 'manual',
    ...(dishes.length ? { dishes } : {}),
    ...(f.read
      ? {
          confidence: f.read.reading.confidence,
          evidence: {
            mode: f.read.mode,
            image_sha256: f.read.image_sha256,
            reading: f.read.reading,
            segmentation: f.read.segmentation,
            comparison: f.read.comparison,
            warnings: f.read.warnings,
            trace: f.read.trace,
          },
        }
      : {}),
    ...(chartedIso ? { charted_at: chartedIso } : {}),
    ...(f.stamp?.send ? { read_id: f.stamp.id } : {}),
  }
}

export type SavedMeal = Pick<Meal, 'meal' | 'portion' | 'fluid_ml'> & { warning?: string }

/**
 * No model call. A meal filled from a tray read uploads its tray photo once, then posts with its `media_id`; a meal by
 * hand is one request. A refused time sends nothing. `warning` says when the tray photo was not kept: the meal is then
 * posted without evidence (it is bound to the photo), keeping its dishes. The post carries `read_id` as `decideMeal`
 * fixed it; the caller keeps the decided form for a retry. A retry answered `already linked` means an earlier attempt
 * saved the meal, so the posted input is returned as saved.
 */
export async function saveMeal(
  api: Api,
  admissionId: number,
  form: MealForm,
  charted: ChartedAt | null,
  tray?: MediaSource,
): Promise<SavedMeal> {
  if (charted && 'error' in charted) throw new Error(charted.error)
  const f = decideMeal(form)
  const input = toMealInput(f, charted ? charted.iso : null)
  const copy = f.read?.segmentation
    ? { kind: 'tray' as const, tray: { segmentation: f.read.segmentation, dishes: f.dishes, fluids: f.read.reading.fluids } }
    : null
  const { media_id, labeled_media_id, warning } = await linkMedia(api, admissionId, f.read ? tray : undefined, copy)
  let meal: SavedMeal
  try {
    meal = await api.addMeal(admissionId, mealPost(input, f.read, media_id, labeled_media_id))
  } catch (err) {
    if (!(input.read_id !== undefined && alreadyLinked(err))) throw err
    meal = { meal: input.meal, portion: input.portion, fluid_ml: input.fluid_ml ?? null }
  }
  return warning ? { ...meal, warning } : meal
}

/**
 * Pure. With the tray's `media_id`, the evidence goes too, and `served_media_id` when the read has a comparison;
 * without it (no photo, or it was not kept), all three are dropped together.
 */
export function mealPost(input: MealInput, read: MealReadResult | null, mediaId: number | undefined, labeledId?: number): MealInput {
  const { evidence, ...rest } = input
  if (mediaId === undefined) return rest
  return {
    ...rest,
    ...(evidence && { evidence }),
    media_id: mediaId,
    ...(labeledId !== undefined && evidence && { labeled_media_id: labeledId }),
    ...(read?.comparison && { served_media_id: read.comparison.served_media_id }),
  }
}

export const saveMealText = (m: Pick<Meal, 'meal' | 'portion' | 'fluid_ml'>) =>
  `Saved ${MEAL_LABEL[m.meal].toLowerCase()}, ${PORTION_LABEL[m.portion].toLowerCase()} eaten.` +
  (m.fluid_ml ? ` ${m.fluid_ml} mL waiting for nurse approval.` : '')

export interface MealRow {
  time: string
  meal: string
  portion: string
  /** Filled quarters of the four-part bar. */
  parts: number
  items: string
  fluid: string | null
  by: string
  voided: string | null
}

export function mealRow(m: Meal): MealRow {
  const how = m.source === 'photo' ? 'Tray photo' : 'By hand'
  return {
    time: hhmm(m.created_at),
    meal: MEAL_LABEL[m.meal],
    portion: PORTION_LABEL[m.portion],
    parts: m.portion / 25,
    items: m.items ?? '',
    fluid: m.fluid_ml ? `+${m.fluid_ml} mL · ${m.entry_status ? STATUS_TEXT[m.entry_status] : 'not charted'}` : null,
    by: m.created_by ? `${how} by ${shortName(m.created_by.name)}` : how,
    voided: m.voided_at ? `Voided: ${m.void_reason ?? ''}${m.voided_by ? ` · ${shortName(m.voided_by.name)}` : ''}` : null,
  }
}

/** "What the AI read" for a photo meal: items, fluids, then each model step with its time. */
export function aiReadLines(m: Meal): { items: string[]; fluids: string[]; steps: string[]; notes: string | null } | null {
  if (!m.evidence) return null
  const { reading, trace } = m.evidence
  return {
    items: reading.items.map((i) => `${i.name} · ${PORTION_LABEL[i.portion]}`),
    fluids: reading.fluids.map(mealFluidLine),
    steps: trace.map((t) => `${STEP_LABEL[t.step] ?? t.step} · ${(t.ms / 1000).toFixed(1)} s`),
    notes: reading.notes,
  }
}

/** "What the AI read"'s fluids with their kind, for the icon (web/ward "Meal fluids with their kind"). */
export function aiReadFluids(m: Meal): { kind: MealFluid['fluid_kind']; text: string }[] {
  return (m.evidence?.reading.fluids ?? []).map((f) => ({ kind: f.fluid_kind, text: mealFluidLine(f) }))
}

/** The void request, or null while the reason is too short (nothing is sent). */
export function voidBody(reason: string): { reason: string } | null {
  const r = reason.trim()
  return r.replace(/\s+/g, '').length >= MIN_REASON ? { reason: r.slice(0, 200) } : null
}

/** One request in the name of whoever is on shift; null without sending when the reason is too short. */
export async function voidMeal(api: Api, mealId: number, reason: string): Promise<Meal | null> {
  const body = voidBody(reason)
  return body ? api.voidMeal(mealId, body) : null
}
