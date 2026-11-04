/**
 * The bed review's small resolve rules, apart from `resolve.ts` (which saves through the capture code), so the review
 * and the meal list can read them without loading the save path.
 */
import type { AlertKind } from '@meniscus/shared'

export const MIN_REASON = 3

/** Prompts a missing record could explain. */
const GAP_PROMPTS: readonly AlertKind[] = ['logging_gap', 'intake_incomplete', 'intake_target_behind']
export const offersMissedEntry = (kind: AlertKind) => GAP_PROMPTS.includes(kind)

/** Prompts a dietitian referral could answer (web/ward "Refer to dietitian"). */
const REFER_PROMPTS: readonly AlertKind[] = ['poor_meal_intake']
export const offersReferral = (kind: AlertKind) => REFER_PROMPTS.includes(kind)
