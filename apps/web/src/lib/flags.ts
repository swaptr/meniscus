/** Badges for entries fixed after the fact: corrected, amended, late, rejected, by hand. Pure. */
import type { Entry } from '@meniscus/shared'
import type { Tone } from '../components/ui.tsx'
import { REJECT_LABEL } from './labels.ts'

export interface Badge {
  tone: Tone
  text: string
}

/** How late an entry was saved: whole hours, or minutes under 2 hours. */
export function lateText(e: Pick<Entry, 'created_at' | 'recorded_at'>): string {
  const min = Math.max(0, Math.floor((Date.parse(e.recorded_at) - Date.parse(e.created_at)) / 60_000))
  return min < 120 ? `${min} min` : `${Math.floor(min / 60)} h`
}

export const isCorrected = (e: Entry) => e.approved_ml !== null && e.approved_ml !== e.recorded_ml

/** Corrected, amended, late or rejected (by hand alone is not a fault). */
export const isFlagged = (e: Entry) => isCorrected(e) || e.amended_at !== null || e.late || e.status === 'rejected'

export function entryFlags(e: Entry): Badge[] {
  const out: Badge[] = []
  if (isCorrected(e)) out.push({ tone: 'warn', text: `Corrected ${e.recorded_ml} → ${e.approved_ml} mL` })
  if (e.amended_at !== null) out.push({ tone: 'warn', text: 'Amended' })
  if (e.late) out.push({ tone: 'info', text: `Late · ${lateText(e)}` })
  if (e.status === 'rejected')
    out.push({ tone: 'danger', text: e.reject_reason ? `Rejected: ${REJECT_LABEL[e.reject_reason]}` : 'Rejected' })
  if (e.source === 'manual') out.push({ tone: 'neutral', text: 'By hand' })
  return out
}
