/**
 * The patient nutrition view `/d/<id>` (web/dietitian), DOM-free: its one load, the food chart's day rows, the diet
 * and referral lines, and its actions, each one request then one reload. No model requests.
 */
import type { CareOrder, CareStatus, Meal, NutritionView, StaffRef } from '@meniscus/shared'
import type { Api } from './api.ts'
import { dietText, historyLine } from './care.ts'
import { isDietitian, referralLines } from './nutrition.ts'
import { dayLabel as fmtDayLabel, isoDate, plural } from './format.ts'

const ymd = (d: Date) => isoDate(d)

/** `Tue 3 Nov` from `2026-11-03` (local date; fixed English names). */
export function dayLabel(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  const t = new Date(y, m - 1, d)
  return fmtDayLabel(t)
}
export { plural }

export const VIEW_ONLY = 'The nutrition view is for dietitians.'
export const NO_DIET = 'No diet order'

/** The view's loader: one GET. */
export const nutritionViewLoad = (api: Api, admissionId: number) => (signal: AbortSignal) => api.nutritionView(admissionId, signal)

export interface DayRow {
  date: string
  /** `Tue 3 Nov · 2 meals · 2 eaten 50% or less`, or `Sun 1 Nov · No meals charted`. */
  title: string
  /** That local date's meals, newest first, as the bed review's Nutrition section lists them. */
  meals: Meal[]
}

/** One row per `days` entry, newest first. */
export const dayRows = (v: Pick<NutritionView, 'days' | 'meals'>): DayRow[] =>
  v.days.map((d) => ({
    date: d.date,
    title: `${dayLabel(d.date)} · ${d.meals === 0 ? 'No meals charted' : `${plural(d.meals, 'meal', 'meals')} · ${d.poor_meals} eaten 50% or less`}`,
    meals: v.meals.filter((m) => ymd(new Date(m.created_at)) === d.date),
  }))

/** `3A-6 · Priya Iyer`. */
export const viewTitle = (v: Pick<NutritionView, 'admission'>) => `${v.admission.ward_code}-${v.admission.bed} · ${v.admission.patient}`

/** The active diet, `Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein`, or `No diet order`. */
export const dietLine = (v: Pick<NutritionView, 'diet'>) => (v.diet ? dietText(v.diet.value) : NO_DIET)

/** The diet orders' history, newest first, as the care plan words it. */
export const dietHistory = (v: Pick<NutritionView, 'diet_history'>, now: number) => v.diet_history.map((o) => historyLine(o, NO_CARE, now))
const NO_CARE: CareStatus = { orders: [], fluid_limit: null, intake_target: null, catheter: null }

/** The diet as the care-order form reads it (one order, or none). */
export const dietCare = (diet: CareOrder<'diet'> | null): CareStatus => ({ ...NO_CARE, orders: diet ? [diet] : [] })

/** The referrals, newest first: their lines and note, and whether the dietitian may act on each. */
export const viewReferrals = (v: Pick<NutritionView, 'referrals'>, now: number) =>
  v.referrals.map((r) => ({ referral: r, ...referralLines(r, now), acknowledge: r.status === 'open', close: r.status !== 'closed' }))

/** The bed review is `/n/<id>`; the dietitian's own bed review links back to `/d/<id>`. */
export const bedReviewHref = (admissionId: number) => `/n/${admissionId}`
export const nutritionViewHref = (staff: Pick<StaffRef, 'role'> | null, admissionId: number) =>
  isDietitian(staff) ? `/d/${admissionId}` : null
