/**
 * Ward data quality: which entries were fixed after the fact, and by whom. Pure; one definition of each
 * flag, shared with the entry fields. No model requests.
 */
import type { Entry, QualityFlag, QualityTotals, StaffRef, Ward, WardQuality } from '@meniscus/shared'

export interface QualityRow {
  entry: Entry
  admission_id: number
  bed: string
  patient: string
}

export const FLAGGED_MAX = 100

/** Approved with a volume other than the one it was saved with. */
export const isCorrected = (e: Entry) => e.approved_ml !== null && e.approved_ml !== e.recorded_ml

export function qualityFlags(e: Entry): QualityFlag[] {
  const flags: QualityFlag[] = []
  if (isCorrected(e)) flags.push('corrected')
  if (e.amended_at !== null) flags.push('amended')
  if (e.late) flags.push('late')
  if (e.status === 'rejected') flags.push('rejected')
  return flags
}

type Recorder = WardQuality['recorders'][number]
type Reviewer = WardQuality['reviewers'][number]

/** Most first, then by staff id; "not recorded" last. */
const byCount =
  <T extends { staff: StaffRef | null }>(count: (x: T) => number) =>
  (a: T, b: T) =>
    count(b) - count(a) || (a.staff?.id ?? Infinity) - (b.staff?.id ?? Infinity)

/** `rows` are the ward's entries charted since `since`, newest charted first. */
export function wardQuality(ward: Ward, since: string, rows: QualityRow[]): WardQuality {
  const totals: QualityTotals = { entries: 0, corrected: 0, amended: 0, late: 0, rejected: 0, manual: 0 }
  const rejected_by_reason: WardQuality['rejected_by_reason'] = {}
  const recorders = new Map<number | null, Recorder>()
  const reviewers = new Map<number | null, Reviewer>()
  const flagged: WardQuality['flagged'] = []

  for (const row of rows) {
    const e = row.entry
    const flags = qualityFlags(e)
    totals.entries++
    if (e.source === 'manual') totals.manual++
    for (const f of flags) totals[f]++
    if (e.status === 'rejected') {
      const reason = e.reject_reason ?? 'unspecified'
      rejected_by_reason[reason] = (rejected_by_reason[reason] ?? 0) + 1
    }

    const rk = e.created_by?.id ?? null
    const rec = recorders.get(rk) ?? { staff: e.created_by, recorded: 0, corrected: 0, amended: 0, late: 0, rejected: 0 }
    rec.recorded++
    for (const f of flags) rec[f]++
    recorders.set(rk, rec)

    if (e.reviewed_at !== null) {
      const vk = e.reviewed_by?.id ?? null
      const rev = reviewers.get(vk) ?? { staff: e.reviewed_by, reviewed: 0 }
      rev.reviewed++
      reviewers.set(vk, rev)
    }

    // Ward-wide lists carry no transcripts or read details.
    if (flags.length && flagged.length < FLAGGED_MAX) flagged.push({ ...row, entry: { ...e, evidence: null }, flags })
  }

  return {
    ward,
    since,
    totals,
    rejected_by_reason,
    recorders: [...recorders.values()].sort(byCount((r) => r.recorded)),
    reviewers: [...reviewers.values()].sort(byCount((r) => r.reviewed)),
    flagged,
  }
}
