/** Nurse dashboard logic, DOM-free so it can be tested. */
import {
  ACUITY_LEVELS,
  AUTO_CONFIRM_CONFIDENCE,
  type AcuityLevel,
  type AdmissionSummary,
  type Entry,
  type WardSummary,
} from '@meniscus/shared'
import { ALERT_RULES, type OutputDevices } from '@meniscus/shared'
import type { Api } from './api.ts'
import { STATUS_LABEL } from './labels.ts'
import { inChargeLine } from './rota.ts'

export { signed } from './volume.ts'

const bedNo = (a: AdmissionSummary) => Number.parseInt(a.bed, 10) || 0

/** The bed's acuity group: the higher of its level and its suggestion (never stored, never applied). */
export function groupLevel(a: Pick<AdmissionSummary, 'acuity'>): AcuityLevel {
  const { level, suggested } = a.acuity
  return suggested && ACUITY_LEVELS.indexOf(suggested) < ACUITY_LEVELS.indexOf(level) ? suggested : level
}

/** Acuity groups (critical, watch, stable); within each, alerts first (most first), then pending, then the rest; bed order. */
export function wardOrder(ward: AdmissionSummary[]): AdmissionSummary[] {
  const rank = (a: AdmissionSummary) => ACUITY_LEVELS.indexOf(groupLevel(a))
  const group = (a: AdmissionSummary) => (a.alerts.length ? 0 : a.pending ? 1 : 2)
  return ward.toSorted((a, b) => rank(a) - rank(b) || group(a) - group(b) || b.alerts.length - a.alerts.length || bedNo(a) - bedNo(b))
}

export type AcuityFilter = AcuityLevel | 'all'
/** The dashboard filter: only the beds placed in that group. Pure; no request. */
export const filterByAcuity = <T extends Pick<AdmissionSummary, 'acuity'>>(beds: T[], filter: AcuityFilter): T[] =>
  filter === 'all' ? beds : beds.filter((b) => groupLevel(b) === filter)

export const batchApprovable = (entries: Entry[]): Entry[] =>
  entries.filter((e) => e.status === 'pending' && e.confidence !== null && e.confidence >= AUTO_CONFIRM_CONFIDENCE)

/** One review request per entry, sequentially; returns how many were approved. */
export async function approveBatch(api: Api, entries: Entry[]): Promise<number> {
  let n = 0
  for (const e of batchApprovable(entries)) {
    await api.review(e.id, { action: 'approve' })
    n++
  }
  return n
}

/** Only on an explicit tap, and only when there is something to explain: 1 model request. */
export async function requestExplanation(api: Api, admission: { id: number; alerts: unknown[] }, signal?: AbortSignal) {
  if (!admission.alerts.length) return null
  return api.explain(admission.id, signal)
}

/** Relative time for "last activity". `iso` null = nothing in the last 24 h. */
export function ago(iso: string | null, now: number): string {
  if (iso === null) return 'No entries today'
  const min = Math.floor((now - Date.parse(iso)) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.floor(min / 60)} h ago`
}

/** Strings for one ward card on the nurse home. */
export function wardCard(w: WardSummary, now: number) {
  return {
    title: w.name,
    beds: `${w.occupied}/${w.capacity} beds`,
    pending: w.pending ? `${w.pending} pending` : 'All reviewed',
    review: w.beds_with_alerts ? `${w.beds_with_alerts} to review` : null,
    activity: ago(w.last_entry_at, now),
    in_charge: inChargeLine(w),
  }
}

/**
 * The bed review's loader: the chart and the meals, together (two requests). Its first answer names the ward, which
 * decides whether the review needs a reason first; the route refreshes it only once the ward is open.
 */
export const bedLoad = (api: Api, admissionId: number) => async (signal: AbortSignal) => {
  const [chart, meals] = await Promise.all([api.entries(admissionId, signal), api.meals(admissionId, signal)])
  return { ...chart, meals, at: Date.now() }
}

/** The ward dashboard's two loaders: the beds (refreshed by the route) and the ward team (loaded once per visit). */
export const wardLoads = (api: Api, wardId: number) => ({
  beds: (signal: AbortSignal) => api.admissions(wardId, signal),
  team: (signal: AbortSignal) => api.team(wardId, signal),
})

/** A ward's status on the ward list (web/interface "Ward status from its beds"): its worst open prompt, else pending, else on track. */
export function wardTone(w: Pick<WardSummary, 'worst_tone' | 'pending'>): {
  tone: 'danger' | 'warn' | 'info' | 'pending' | 'ok'
  label: string
} {
  const tone = w.worst_tone ?? (w.pending > 0 ? 'pending' : 'ok')
  return { tone, label: STATUS_LABEL[tone] }
}

/** The balance figure's tone: warn past the overload rule, never while urine is not measured (charting/alerts "Fluid overload"). */
export function overloadTone(balanceMl: number, devices: Pick<OutputDevices, 'urine_measured'> | null | undefined): 'warn' | 'neutral' {
  if (devices && !devices.urine_measured) return 'neutral'
  return balanceMl > ALERT_RULES.overloadBalanceMl ? 'warn' : 'neutral'
}
