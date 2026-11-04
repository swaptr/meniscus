/**
 * Nutrition rules (charting/nutrition). Pure: meals, orders, referrals and the clock in; the dietitian line, the
 * `poor_meal_intake` prompt and the worklist order out. It documents and routes; it never diagnoses. No model requests.
 */
import {
  DIETITIAN_ROLES,
  FOOD_CHART_DAYS,
  POOR_INTAKE_MEALS,
  POOR_INTAKE_PORTION,
  POOR_INTAKE_WINDOW_H,
  type Admission,
  type Alert,
  type CareOrder,
  type DietitianAssignment,
  type FoodChartDay,
  type Meal,
  type NutritionStatus,
  type NutritionWorklist,
  type Referral,
  type Staff,
  type WorklistPatient,
} from '@meniscus/shared'
import { inForce } from './care.ts'
import { mayNameInCharge } from './staffing.ts'
import { localDate } from './time.ts'

const HOUR_MS = 3_600_000

/** The current assignment while its staff is still a dietitian; otherwise null (routed to the ward's dietitians). */
export const currentDietitian = (a: DietitianAssignment | null | undefined): DietitianAssignment | null =>
  a && DIETITIAN_ROLES.includes(a.staff.role) ? a : null

/** Whether a dietitian is assigned or covers the admission's ward, the assignment, and its latest referral. */
export const nutritionStatus = (
  wardId: number,
  covered: ReadonlySet<number>,
  referral: Referral | null,
  assignment: DietitianAssignment | null = null,
): NutritionStatus => {
  const dietitian = currentDietitian(assignment)
  return { dietitian_available: dietitian !== null || covered.has(wardId), dietitian, referral }
}

/**
 * Routing (charting/nutrition "Referral routing"): the assigned dietitian, if still a dietitian; otherwise every
 * dietitian whose `wards` include the admission's ward. Computed at read time.
 */
export const routedTo = (
  staff: Pick<Staff, 'id' | 'role' | 'wards'>,
  wardId: number,
  current: DietitianAssignment | null | undefined,
): boolean => {
  if (!DIETITIAN_ROLES.includes(staff.role)) return false
  const assigned = currentDietitian(current)
  return assigned ? assigned.staff.id === staff.id : staff.wards.some((w) => w.id === wardId)
}

/** May assign a dietitian or hand a patient back: a decider on the ward (as "Name the nurse in charge"), or any dietitian. */
export const mayAssignDietitian = (staff: Staff, wardId: number): boolean =>
  mayNameInCharge(staff, wardId) || DIETITIAN_ROLES.includes(staff.role)

const at = (m: Meal) => Date.parse(m.created_at)
/** A cup of tea charted as a snack: nothing eaten, a fluid drunk. Not a refused meal. */
const drinkOnly = (m: Meal) => m.meal === 'snack' && m.portion === 0 && (m.fluid_ml ?? 0) > 0
/** Open or acknowledged. */
export const inProgress = (r: Referral | null): boolean => r !== null && r.status !== 'closed'

/**
 * The meals `poor_meal_intake` counts, oldest first (charted time, then id): not voided, charted at or after now − the
 * window, not while a nil-by-mouth order was in force, not drink-only snacks, and after `since` (exclusive) when given.
 */
export function countedMeals(meals: Meal[], now: number, orders: CareOrder[], since: number | null = null): Meal[] {
  const fasting = orders.filter((o) => o.kind === 'nil_by_mouth')
  return meals
    .filter(
      (m) =>
        m.voided_at === null &&
        at(m) >= now - POOR_INTAKE_WINDOW_H * HOUR_MS &&
        (since === null || at(m) > since) &&
        !fasting.some((o) => inForce(o, at(m))) &&
        !drinkOnly(m),
    )
    .toSorted((a, b) => at(a) - at(b) || a.id - b.id)
}

/**
 * `poor_meal_intake`: the latest POOR_INTAKE_MEALS counted meals were each eaten POOR_INTAKE_PORTION or less. Held while
 * nil by mouth is in force or a referral is in progress; after a close, only meals charted after it count.
 */
export function poorMealIntake(
  meals: Meal[],
  now: number,
  { orders, referral }: { orders: CareOrder[]; referral: Referral | null },
): Alert | null {
  if (inProgress(referral)) return null
  if (orders.some((o) => o.kind === 'nil_by_mouth' && inForce(o, now))) return null
  const since = referral?.closed_at ? Date.parse(referral.closed_at) : null
  const last = countedMeals(meals, now, orders, since).slice(-POOR_INTAKE_MEALS)
  if (last.length < POOR_INTAKE_MEALS || last.some((m) => m.portion > POOR_INTAKE_PORTION)) return null
  const parts = last.map((m) => `${m.meal} ${m.portion}%`).join(', ')
  return {
    kind: 'poor_meal_intake',
    message: `Poor meal intake: the last ${POOR_INTAKE_MEALS} meals were ${POOR_INTAKE_PORTION}% eaten or less (${parts}). Review.`,
  }
}

/** One referral in progress with its admission, as the store reads them. */
export interface WorklistRow {
  admission: Admission
  referral: Referral
}

/** The worklist's inputs, each loaded with one query (design.md §6). */
export interface WorklistInput {
  /** Referrals in progress, with their admissions. */
  referrals: WorklistRow[]
  /** Current assignments, by admission id. */
  assignments: ReadonlyMap<number, DietitianAssignment>
  /** Active diet orders, by admission id. */
  diets: ReadonlyMap<number, CareOrder<'diet'>>
  /** Every admission named by an assignment or a diet order. */
  admissions: ReadonlyMap<number, Admission>
  /** The latest referral of each admission. */
  latest: ReadonlyMap<number, Referral>
  covered: ReadonlySet<number>
  meals: ReadonlyMap<number, Meal[]>
  now: number
}

/** By ward id, then bed label in natural order (bed 2 before bed 10). */
const byWardBed = (a: Admission, b: Admission) =>
  a.ward_id - b.ward_id || a.bed.localeCompare(b.bed, 'en', { numeric: true }) || a.id - b.id

/**
 * The signed-in dietitian's worklist (charting/nutrition "Dietitian worklist"), each patient once, in the first list
 * that applies: `patients`, referrals in progress routed to them, open then acknowledged, each oldest first (ties by
 * referral id); `assigned`, the rest assigned to them; `diets`, the rest routed to them with a diet order. Each with its
 * intake since now − POOR_INTAKE_WINDOW_H.
 */
export function worklistFor(staff: Pick<Staff, 'id' | 'role' | 'wards'>, input: WorklistInput): NutritionWorklist {
  const { referrals, assignments, diets, admissions, latest, covered, meals, now } = input
  const since = now - POOR_INTAKE_WINDOW_H * HOUR_MS
  const routed = (a: Admission) => routedTo(staff, a.ward_id, assignments.get(a.id))
  const row = (admission: Admission, referral: Referral | null): WorklistPatient => {
    const counted = (meals.get(admission.id) ?? []).filter((m) => m.voided_at === null && !drinkOnly(m) && at(m) >= since)
    return {
      admission,
      nutrition: nutritionStatus(admission.ward_id, covered, referral, assignments.get(admission.id) ?? null),
      diet: diets.get(admission.id) ?? null,
      intake: { meals: counted.length, poor_meals: counted.filter((m) => m.portion <= POOR_INTAKE_PORTION).length },
    }
  }
  const rank = (r: Referral) => (r.status === 'open' ? 0 : 1)
  const first = referrals
    .filter((r) => inProgress(r.referral) && routed(r.admission))
    .toSorted(
      (a, b) =>
        rank(a.referral) - rank(b.referral) ||
        Date.parse(a.referral.created_at) - Date.parse(b.referral.created_at) ||
        a.referral.id - b.referral.id,
    )
  const listed = new Set(first.map((r) => r.admission.id))
  const rest = (ids: Iterable<number>, keep: (a: Admission) => boolean): Admission[] => {
    const out = [...ids].flatMap((id) => {
      const a = admissions.get(id)
      return a && !listed.has(id) && keep(a) ? [a] : []
    })
    for (const a of out) listed.add(a.id)
    return out.toSorted(byWardBed)
  }
  const patients = first.map(({ admission, referral }) => row(admission, referral))
  const assigned = rest(
    [...assignments.values()].filter((a) => currentDietitian(a)?.staff.id === staff.id).map((a) => a.admission_id),
    () => true,
  ).map((a) => row(a, latest.get(a.id) ?? null))
  const dietRows = rest(diets.keys(), routed).map((a) => row(a, latest.get(a.id) ?? null))
  return { since: new Date(since).toISOString(), patients, assigned, diets: dietRows }
}

/**
 * The food chart (charting/nutrition "Patient nutrition read"): `since`, 00:00 local on the first of the last
 * FOOD_CHART_DAYS local dates (local-time constructors, so DST-safe), and one count per local date, newest first, of
 * the meals not voided and not drink-only snacks, and those eaten POOR_INTAKE_PORTION or less.
 */
export function foodChart(meals: readonly Meal[], now: number): { since: number; days: FoodChartDay[] } {
  const d = new Date(now)
  const dates = Array.from({ length: FOOD_CHART_DAYS }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime())
  const since = dates.at(-1)!
  const pad = (n: number) => String(n).padStart(2, '0')
  const days = dates.map((t): FoodChartDay => {
    const x = new Date(t)
    const date = `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
    const counted = meals.filter((m) => m.voided_at === null && !drinkOnly(m) && localDate(at(m)) === t)
    return { date, meals: counted.length, poor_meals: counted.filter((m) => m.portion <= POOR_INTAKE_PORTION).length }
  })
  return { since, days }
}
