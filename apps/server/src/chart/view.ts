/**
 * One bed's prompt list, care status, bag periods and nutrition status, the single composition point for the chart reads,
 * the ward list's `beds_with_alerts` and Explain, so all three see the same prompts. Reads the store; the rules are pure.
 * No model requests.
 */
import {
  POOR_INTAKE_WINDOW_H,
  catheterSince,
  chartDay,
  outputDevices,
  readingInterval,
  urineWindow,
  type AcuityLevel,
  type AcuityStatus,
  type Admission,
  type Alert,
  type BagChart,
  type BagLevel,
  type CareOrder,
  type CareStatus,
  type DietitianAssignment,
  type Meal,
  type NutritionStatus,
  type NutritionWorklist,
  type OutputDevices,
  type Referral,
  type Staff,
} from '@meniscus/shared'
import type { Store } from '../store/port.ts'
import { acuityFor } from './acuity.ts'
import { BAG_WINDOW_MS, activeCatheter, bagChart, type StoredBagReading } from './bags.ts'
import { careChart } from './care.ts'
import { nutritionStatus, poorMealIntake, worklistFor } from './nutrition.ts'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/** One ward's reads (or the whole hospital's), each in one query, so a ward list makes no query per bed. */
export interface WardReads {
  orders: Map<number, CareOrder[]>
  /** Each admission's full catheter history (the chain `catheterSince` walks). */
  catheterOrders: Map<number, CareOrder[]>
  bagReadings: Map<number, StoredBagReading[]>
  meals: Map<number, Meal[]>
  referrals: Map<number, Referral>
  /** Current dietitian assignments, by admission id. */
  assignmentsByWard: Map<number, DietitianAssignment>
  covered: Set<number>
  /** Each ward's `default_acuity`. */
  acuityDefaults: Map<number, AcuityLevel>
}

/** The reads `chartView` needs for a ward's beds (or every bed), eight queries in all. */
export async function wardReads(store: Store, wardId?: number): Promise<WardReads> {
  const now = store.now()
  const [orders, catheterOrders, bagReadings, meals, referrals, assignmentsByWard, covered, acuityDefaults] = await Promise.all([
    store.careOrdersByWard(wardId, now - DAY_MS),
    store.catheterOrdersByWard(wardId),
    store.bagReadingsByWard(wardId, now - BAG_WINDOW_MS),
    store.mealsByWard(wardId, now - Math.max(DAY_MS, POOR_INTAKE_WINDOW_H * HOUR_MS)),
    store.latestReferralsByWard(wardId),
    store.currentAssignments(wardId),
    store.coveredWards(),
    store.acuityDefaults(),
  ])
  return { orders, catheterOrders, bagReadings, meals, referrals, assignmentsByWard, covered, acuityDefaults }
}

/**
 * Entries since min(now − 24 h, chart day start, the low-output window's start), which covers a 25 h chart day; orders active or ended in the last 24 h;
 * meals of the last 24 h; bag readings of the last 48 h, plus each bag's one before that; the latest referral and the
 * covered wards, and the admission's full catheter history. The care prompts come first, then the bag prompts, then `poor_meal_intake`.
 */
export async function chartView(
  store: Store,
  admission: Admission,
  ward?: WardReads,
): Promise<{
  alerts: Alert[]
  care: CareStatus
  devices: OutputDevices
  acuity: AcuityStatus
  bags: BagChart
  bag_levels: BagLevel[]
  nutrition: NutritionStatus
}> {
  const now = store.now()
  const own = ward ? (ward.orders.get(admission.id) ?? []) : await store.careOrders(admission.id, now - DAY_MS)
  const meals = ward ? (ward.meals.get(admission.id) ?? []) : ((await store.meals(admission.id, now - DAY_MS)) ?? [])
  const referral = ward ? (ward.referrals.get(admission.id) ?? null) : await store.latestReferral(admission.id)
  const assignment = ward
    ? (ward.assignmentsByWard.get(admission.id) ?? null)
    : ((await store.currentAssignments(admission.ward_id)).get(admission.id) ?? null)
  const nutrition = nutritionStatus(admission.ward_id, ward?.covered ?? (await store.coveredWards()), referral, assignment)
  const catheter = activeCatheter(own)
  // The full history, never the 24 h orders, which can miss the catheter's first order (design.md §7).
  const catheterHistory = catheter ? (ward ? (ward.catheterOrders.get(admission.id) ?? []) : await store.catheterOrders(admission.id)) : []
  const chain = catheter ? catheterSince(catheterHistory, catheter) : []
  const review = chain.length ? await store.lastReviewOf(chain.map((o) => o.id)) : null
  const readings = ward ? (ward.bagReadings.get(admission.id) ?? []) : await store.bagReadings(admission.id, now - BAG_WINDOW_MS)
  const interval = readingInterval(admission, catheter?.value)
  const base = Math.min(now - DAY_MS, chartDay(now).start)
  const baseEntries = await store.recent(admission.id, base)
  const window = urineWindow({
    urineBagReadingsAt: readings.filter((r) => r.container === 'urine_bag').map((r) => Date.parse(r.created_at)),
    entries: baseEntries,
    intervalH: interval.h,
    now,
  })
  // A window reaching back past the base (a long interval's old newest reading) needs one wider load.
  const entries = window.from < base ? await store.recent(admission.id, window.from) : baseEntries
  const { alerts, care } = careChart({
    admission,
    entries,
    orders: own,
    meals,
    reviews: review ? [review] : [],
    catheterHistory,
    window,
    now,
  })
  const bag = bagChart({ readings, orders: own, catheterHistory, admission, now })
  // Last, matching ALERT_KINDS: the care prompts, the bag prompts, then poor meal intake.
  const poor = poorMealIntake(meals, now, { orders: own, referral })
  const all = [...alerts, ...bag.alerts, ...(poor ? [poor] : [])]
  const wardDefault =
    (ward ? ward.acuityDefaults.get(admission.ward_id) : (await store.ward(admission.ward_id))?.default_acuity) ?? 'stable'
  const acuity = acuityFor(
    own.find((o): o is CareOrder<'acuity'> => o.kind === 'acuity' && o.end_at === null),
    wardDefault,
    all,
  )
  return { alerts: all, care, devices: outputDevices(own), acuity, bags: bag.bags, bag_levels: bag.levels, nutrition }
}

/**
 * The dietitian's worklist from a fixed number of queries (design.md §6), on their `wards` and the wards of the patients
 * assigned to them: current assignments, those admissions, diet orders, their admissions, referrals in progress, the
 * latest referrals, the covered wards and the meals of the window.
 */
export async function worklistView(store: Store, staff: Staff): Promise<NutritionWorklist> {
  const now = store.now()
  const assignments = await store.currentAssignments()
  const mine = [...assignments.values()].filter((a) => a.staff.id === staff.id).map((a) => a.admission_id)
  const assignedAdmissions = await store.admissionsIn(mine)
  const wards = [...new Set([...staff.wards.map((w) => w.id), ...[...assignedAdmissions.values()].map((a) => a.ward_id)])]
  const diets = await store.activeDiets(wards)
  return worklistFor(staff, {
    referrals: await store.referralsInProgress(wards),
    assignments,
    diets,
    admissions: new Map([...assignedAdmissions, ...(await store.admissionsIn([...diets.keys()]))]),
    latest: await store.latestReferralsByWard(),
    covered: await store.coveredWards(),
    meals: await store.mealsByWard(undefined, now - POOR_INTAKE_WINDOW_H * HOUR_MS),
    now,
  })
}
