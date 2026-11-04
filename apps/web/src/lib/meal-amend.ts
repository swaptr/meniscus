/**
 * Amend a meal from the bed review (web/ward "Amend a meal from the bed review"): the dialog's rules, DOM-free. One
 * `POST /api/meals/<id>/amend` with what changed and the reason, then the bed's meals reload. No model requests.
 */
import {
  DECIDER_ROLES,
  MAX_MEAL_ITEMS,
  type AmendMealInput,
  type DishValue,
  type Meal,
  type Portion,
  type StaffRef,
} from '@meniscus/shared'
import { ApiError, type Api } from './api.ts'
import { shortName } from './staff.ts'
import { hhmm } from './timeline.ts'

/** The server's bound on an amendment reason. */
export const AMEND_REASON_MIN = 3
export const AMEND_REASON_MAX = 200
export const AMEND_VOIDED = 'This meal was voided. Nothing was changed.'

export interface AmendForm {
  portion: Portion
  /** Used only when the meal has no dishes. */
  items: string
  dishes: DishValue[]
  reason: string
}

/** The dialog opens on the meal's saved values. */
export const amendForm = (m: Meal): AmendForm => ({
  portion: m.portion,
  items: m.items ?? '',
  dishes: m.dishes.map((d) => ({ ...d })),
  reason: '',
})

const sameDish = (a: DishValue, b: DishValue) =>
  a.index === b.index && a.name === b.name && a.dish_kind === b.dish_kind && a.portion === b.portion

/**
 * The request body with only what changed (the dishes whole when any dish changed, was added or removed; the items only
 * for a meal without dishes), or null while nothing changed, a dish has no name, or the reason is under 3 characters.
 */
export function amendBody(m: Meal, f: AmendForm): AmendMealInput | null {
  const reason = f.reason.trim()
  if (reason.length < AMEND_REASON_MIN || reason.length > AMEND_REASON_MAX) return null
  const body: AmendMealInput = { reason }
  if (f.portion !== m.portion) body.portion = f.portion
  if (m.dishes.length || f.dishes.length) {
    const dishes = f.dishes.map((d) => ({ ...d, name: d.name.trim().slice(0, 80) }))
    if (dishes.some((d) => !d.name)) return null
    if (dishes.length !== m.dishes.length || dishes.some((d, i) => !sameDish(d, m.dishes[i]!))) body.dishes = dishes
  } else {
    const items = f.items.trim().slice(0, MAX_MEAL_ITEMS)
    if (items && items !== (m.items ?? '')) body.items = items
  }
  return Object.keys(body).length > 1 ? { ...body, reason } : null
}

/** "Amend…" is offered to nurses and matrons, on a meal not voided. */
export const canAmend = (staff: Pick<StaffRef, 'role'> | null, m: Pick<Meal, 'voided_at'>) =>
  staff !== null && DECIDER_ROLES.includes(staff.role) && m.voided_at === null

/** `Amended 14:30 · Anita T. · tray rechecked` from the last amendment, or null. */
export function amendedLine(m: Pick<Meal, 'amendments'>): string | null {
  const a = m.amendments.at(-1)
  if (!a) return null
  return [`Amended ${hhmm(a.at)}`, ...(a.by ? [shortName(a.by.name)] : []), a.reason].join(' · ')
}

/**
 * One amend request, then `reload` (the bed's meals). Null, sending nothing, while `amendBody` is null. A 409 `voided`
 * is thrown as `AMEND_VOIDED` and never resent.
 */
export async function saveAmend(api: Api, m: Meal, f: AmendForm, reload: () => Promise<unknown> | void): Promise<Meal | null> {
  const body = amendBody(m, f)
  if (!body) return null
  let saved: Meal
  try {
    saved = await api.amendMeal(m.id, body)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.code === 'voided') throw new Error(AMEND_VOIDED, { cause: err })
    throw err
  }
  await reload()
  return saved
}
