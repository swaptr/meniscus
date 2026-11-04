/**
 * Dietitians on screen (charting/nutrition, web/dietitian): the bed review's Nutrition lines, the bed-card chip, who sees
 * which action, the worklist rows and the request bodies. DOM-free so it can be tested. Role policy reads the shared
 * lists only. No model requests.
 */
import {
  DECIDER_ROLES,
  DIETITIAN_ROLES,
  POOR_INTAKE_PORTION,
  POOR_INTAKE_WINDOW_H,
  REFERRAL_NOTE_MAX,
  REFERRAL_REVIEW_MAX_DAYS,
  REFERRER_ROLES,
  type CloseReferralInput,
  type DietitianAssignment,
  type NutritionStatus,
  type NutritionWorklist,
  type Referral,
  type ReferralInput,
  type ReferralOutcome,
  type ReferralReason,
  type ReferralStatus,
  type Staff,
  type StaffRef,
  type WorklistPatient,
} from '@meniscus/shared'
import { ApiError, type Api } from './api.ts'
import { dietText, when } from './care.ts'
import { shortName } from './staff.ts'
import { dayMonth as fmtDayMonth, isoDate } from './format.ts'

type Who = Pick<StaffRef, 'role'> | null

export const REFERRAL_REASON_LABEL: Record<ReferralReason, string> = {
  poor_intake: 'Poor intake',
  weight_loss: 'Weight loss',
  swallowing: 'Swallowing',
  diet_query: 'Diet query',
  other: 'Other',
}
export const REFERRAL_OUTCOME_LABEL: Record<ReferralOutcome, string> = {
  diet_changed: 'Diet changed',
  supplements_started: 'Supplements started',
  monitoring: 'Monitoring',
  no_action_needed: 'No action needed',
}
/** The referral's state chip (DESIGN.md 7.4). */
export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = { open: 'Open', acknowledged: 'Acknowledged', closed: 'Closed' }
export const REFERRAL_STATUS_TONE: Record<ReferralStatus, 'warn' | 'info' | 'neutral'> = {
  open: 'warn',
  acknowledged: 'info',
  closed: 'neutral',
}

export const REFER = 'Refer to dietitian'
export const WORKLIST_EMPTY = 'Nothing on your worklist'
export const WORKLIST_ONLY = 'The nutrition worklist is for dietitians.'

/** `YYYY-MM-DD` of `t`'s local date, `days` on (local-time constructor, so DST-safe). */
const ymd = (t: number, days = 0) => {
  const d = new Date(t)
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  return isoDate(x)
}
/** `5 Nov` from `2026-11-05`. */
const dayMonth = (date: string) => {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number)
  return fmtDayMonth(new Date(y, m - 1, d))
}
const by = (s: StaffRef | null) => (s ? shortName(s.name) : 'unknown')

export const isDietitian = (staff: Who) => staff !== null && DIETITIAN_ROLES.includes(staff.role)
/** Open or acknowledged. */
export const referralInProgress = (r: Referral | null) => r !== null && r.status !== 'closed'

/** `Dietitian: Sana M. · assigned 14:40 by Anita T.`, else `Dietitian: ward dietitians`, or `No dietitian covers <ward name>`. */
export const dietitianLine = (n: NutritionStatus, wardName: string, now = Date.now()) =>
  n.dietitian
    ? `Dietitian: ${shortName(n.dietitian.staff.name)} · ${assignedText(n.dietitian, now, 'assigned')}`
    : n.dietitian_available
      ? 'Dietitian: ward dietitians'
      : `No dietitian covers ${wardName}`

/** `Assigned 09:00 by Sana M.`: the worklist's "Your patients" line. */
const assignedText = (a: DietitianAssignment, now: number, word = 'Assigned') =>
  `${word} ${when(a.assigned_at, now)}${a.assigned_by ? ` by ${shortName(a.assigned_by.name)}` : ''}`

/** `Sana M. · assigned 09:00 by Divya K. · ended 11:00 by Joel M.`: the patient view's assignment history. */
export const assignmentLine = (a: DietitianAssignment, now: number) =>
  `${shortName(a.staff.name)} · ${assignedText(a, now, 'assigned')}${
    a.ended_at ? ` · ended ${when(a.ended_at, now)}${a.ended_by ? ` by ${shortName(a.ended_by.name)}` : ''}` : ' · current'
  }`

type WardPerson = Pick<Staff, 'role' | 'wards'> | null

/** The server's rule (charting/nutrition "Assign a dietitian"): a nurse or matron on the bed's ward, or any dietitian. */
export const mayAssignDietitian = (staff: WardPerson, wardId: number) =>
  staff !== null &&
  (DIETITIAN_ROLES.includes(staff.role) || (DECIDER_ROLES.includes(staff.role) && staff.wards.some((w) => w.id === wardId)))

/** The bed review's dietitian actions: "Assign dietitian…" ("Change…" once assigned) and "Hand back…" when assigned. */
export function bedDietitianActions(staff: WardPerson, wardId: number, n: NutritionStatus): { assign: string | null; handBack: boolean } {
  if (!mayAssignDietitian(staff, wardId)) return { assign: null, handBack: false }
  return { assign: n.dietitian ? 'Change…' : 'Assign dietitian…', handBack: n.dietitian !== null }
}

/** The patient view's: "Take on", "Take over…" (from another), "Hand back…" (their own) and "Assign…". */
export function assignmentActions(
  n: NutritionStatus,
  staff: Pick<StaffRef, 'id' | 'role'> | null,
): { takeOn: boolean; takeOver: string | null; handBack: boolean; assign: boolean } {
  if (!isDietitian(staff)) return { takeOn: false, takeOver: null, handBack: false, assign: false }
  const current = n.dietitian?.staff ?? null
  return {
    takeOn: current === null,
    takeOver: current && current.id !== staff!.id ? `Take over from ${shortName(current.name)}?` : null,
    handBack: current?.id === staff!.id,
    assign: true,
  }
}
export const HAND_BACK_CONFIRM = 'Hand back to the ward dietitians?'
export const handBackRefused = (wardName: string) => `No dietitian covers ${wardName} to take the referral.`

/** The dialog's choices: the dietitians, those covering the ward first (`Sana Mirza · covers Renal HDU`), each in roster order. */
export function dietitianChoices(roster: readonly Staff[], wardId: number, wardName: string): { id: number; label: string }[] {
  const dietitians = roster.filter((s) => isDietitian(s))
  const covers = (s: Staff) => s.wards.some((w) => w.id === wardId)
  return [
    ...dietitians.filter(covers).map((s) => ({ id: s.id, label: `${s.name} · covers ${wardName}` })),
    ...dietitians.filter((s) => !covers(s)).map((s) => ({ id: s.id, label: s.name })),
  ]
}

/**
 * Assign or hand back: one request, then `reload`. A refused hand back (409 `no_dietitian`) says which ward is left
 * uncovered and sends nothing more; other failures are thrown.
 */
export async function dietitianAction(
  api: Api,
  action: { op: 'assign'; admissionId: number; staffId: number } | { op: 'handBack'; admissionId: number; wardName: string },
  reload: () => unknown,
): Promise<{ ok: boolean; text: string }> {
  try {
    if (action.op === 'assign') await api.assignDietitian(action.admissionId, action.staffId)
    else await api.handBack(action.admissionId)
  } catch (err) {
    if (action.op === 'handBack' && err instanceof ApiError && err.code === 'no_dietitian')
      return { ok: false, text: handBackRefused(action.wardName) }
    throw err
  }
  await reload()
  return { ok: true, text: action.op === 'assign' ? 'Dietitian assigned.' : 'Handed back to the ward dietitians.' }
}

/**
 * The referral as the bed review and the worklist read it: who referred, when and why, with its acknowledgement on the
 * same line; a close on a second line (outcome, next review); and its note.
 */
export function referralLines(r: Referral, now: number): { lines: string[]; note: string | null } {
  let first = `Referred ${when(r.created_at, now)} by ${by(r.created_by)} · ${REFERRAL_REASON_LABEL[r.reason]}`
  if (r.acknowledged_at && r.status !== 'closed') first += ` · Acknowledged ${when(r.acknowledged_at, now)} · ${by(r.acknowledged_by)}`
  const lines = [first]
  if (r.closed_at && r.outcome) {
    const review = r.next_review ? ` · next review ${dayMonth(r.next_review)}` : ''
    lines.push(`Closed ${when(r.closed_at, now)} by ${by(r.closed_by)} · ${REFERRAL_OUTCOME_LABEL[r.outcome]}${review}`)
  }
  return { lines, note: r.note }
}

/** The bed card's chip while a referral is in progress, naming the dietitian who acknowledged it; else null. */
export function referralChip(n: NutritionStatus): string | null {
  const r = n.referral
  if (!r || !referralInProgress(r)) return null
  return r.acknowledged_by ? `Referred to dietitian · ${shortName(r.acknowledged_by.name)}` : 'Referred to dietitian'
}

/** A nurse or matron, a dietitian covering the ward, and no referral in progress. */
export const canRefer = (staff: Who, n: NutritionStatus) =>
  staff !== null && REFERRER_ROLES.includes(staff.role) && n.dietitian_available && !referralInProgress(n.referral)
/** Acknowledge and close: dietitians only. */
export const canActOnReferral = (staff: Who) => isDietitian(staff)

/** The referral request, or null until a reason is picked or while the note is too long. An empty note is left out. */
export function referBody(reason: ReferralReason | null, note: string): ReferralInput | null {
  const n = note.trim()
  if (reason === null || n.length > REFERRAL_NOTE_MAX) return null
  return n ? { reason, note: n } : { reason }
}
/** The close request, or null until an outcome is picked. No date picked leaves `next_review` out. */
export function closeBody(outcome: ReferralOutcome | null, nextReview: string): CloseReferralInput | null {
  if (outcome === null) return null
  return nextReview ? { outcome, next_review: nextReview } : { outcome }
}
/** The date picker's range: today to REFERRAL_REVIEW_MAX_DAYS on, local dates. */
export const reviewBounds = (now: number) => ({ min: ymd(now), max: ymd(now, REFERRAL_REVIEW_MAX_DAYS) })

/** `<n> of <m> meals 50% eaten or less · last 24 h`, or `No meals charted · last 24 h`. */
export const intakeLine = ({ meals, poor_meals }: { meals: number; poor_meals: number }) =>
  meals === 0
    ? `No meals charted · last ${POOR_INTAKE_WINDOW_H} h`
    : `${poor_meals} of ${meals} meal${meals === 1 ? '' : 's'} ${POOR_INTAKE_PORTION}% eaten or less · last ${POOR_INTAKE_WINDOW_H} h`

export interface WorklistRow {
  admissionId: number
  /** `3A-6 · Priya Iyer`. */
  title: string
  /** The referral, the assignment or the diet order, by section. */
  referral: string
  intake: string
  status: ReferralStatus | null
  /** The patient nutrition view, `/d/<admission id>`. */
  href: string
  /** For the row's bed badge and meal pips. */
  ward: string
  bed: string
  patient: string
  meals: number
  poorMeals: number
  /** The row's peek (DESIGN.md 7.9): the referral's lines and note, the diet order, the intake line. No request. */
  peek: { lines: string[]; note: string | null }
}
type Section = 'patients' | 'assigned' | 'diets'
export const WORKLIST_SECTIONS: Record<Section, string> = { patients: 'Referrals', assigned: 'Your patients', diets: 'Diet orders' }

const setBy = (s: StaffRef | null) => (s ? ` · set by ${shortName(s.name)}` : '')
const SECTION_LINE: Record<Section, (p: WorklistPatient, now: number) => string> = {
  patients: (p, now) => (p.nutrition.referral ? referralLines(p.nutrition.referral, now).lines[0]! : ''),
  assigned: (p, now) => (p.nutrition.dietitian ? assignedText(p.nutrition.dietitian, now) : ''),
  diets: (p) => (p.diet ? `${dietText(p.diet.value)}${setBy(p.diet.set_by)}` : ''),
}
const row = (section: Section, p: WorklistPatient, now: number): WorklistRow => ({
  admissionId: p.admission.id,
  title: `${p.admission.ward_code}-${p.admission.bed} · ${p.admission.patient}`,
  referral: SECTION_LINE[section](p, now),
  intake: intakeLine(p.intake),
  status: section === 'patients' ? (p.nutrition.referral?.status ?? null) : null,
  href: `/d/${p.admission.id}`,
  ward: p.admission.ward_code,
  bed: String(p.admission.bed),
  patient: p.admission.patient,
  meals: p.intake.meals,
  poorMeals: p.intake.poor_meals,
  peek: worklistPeek(p, now),
})

/** What a worklist row's peek lists, from the worklist's own load. */
export function worklistPeek(p: WorklistPatient, now: number): { lines: string[]; note: string | null } {
  const r = p.nutrition.referral ? referralLines(p.nutrition.referral, now) : { lines: [], note: null }
  return {
    lines: [...r.lines, p.diet ? `${dietText(p.diet.value)}${setBy(p.diet.set_by)}` : 'No diet order', intakeLine(p.intake)],
    note: r.note,
  }
}
/** The "Referrals" rows, in the server's order. */
export const worklistRows = (w: NutritionWorklist, now: number): WorklistRow[] => w.patients.map((p) => row('patients', p, now))
/** The worklist's sections in order, in the server's order within each, leaving out empty ones. */
export const worklistSections = (w: NutritionWorklist, now: number): { key: Section; title: string; rows: WorklistRow[] }[] =>
  (['patients', 'assigned', 'diets'] as const)
    .map((key) => ({ key, title: WORKLIST_SECTIONS[key], rows: w[key].map((p) => row(key, p, now)) }))
    .filter((sec) => sec.rows.length > 0)

/** The worklist's loader: one GET. */
export const worklistLoad = (api: Api) => (signal: AbortSignal) => api.worklist(signal)

/** One request, then the bed review's reload. */
export async function referralAction(
  api: Api,
  action:
    | { op: 'refer'; admissionId: number; body: ReferralInput }
    | { op: 'acknowledge'; id: number }
    | { op: 'close'; id: number; body: CloseReferralInput },
  reload: () => void,
): Promise<string> {
  if (action.op === 'refer') await api.refer(action.admissionId, action.body)
  else if (action.op === 'acknowledge') await api.acknowledgeReferral(action.id)
  else await api.closeReferral(action.id, action.body)
  reload()
  return action.op === 'refer' ? 'Referred to dietitian.' : action.op === 'acknowledge' ? 'Referral acknowledged.' : 'Referral closed.'
}
