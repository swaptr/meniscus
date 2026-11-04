/**
 * Fixing records from the bed review: missed entries, rejection reasons, amendments, late times.
 * Pure over an injected api; none of it calls a model.
 */
import {
  MAX_ENTRY_ML,
  type AmendInput,
  type DraftEntry,
  type DrinkKind,
  type Entry,
  type EntryCategory,
  type IddsiLevel,
  type RejectReason,
  type ReviewInput,
} from '@meniscus/shared'
import type { Api } from './api.ts'
import { saveEntry, toEntryInput, type Pending, type SaveResult } from './capture.ts'
import { MIN_REASON } from './resolve-rules.ts'

export { MIN_REASON, offersMissedEntry } from './resolve-rules.ts'

/**
 * "HH:MM" earlier today, or yesterday when later than now (within 24 h). Refused before the admission.
 * Returns ISO (UTC) for `charted_at`.
 */
export type ChartedAt = { iso: string } | { error: string }

export function chartedAt(hhmm: string, now: Date, admittedAt: string): ChartedAt {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) return { error: 'Pick a time' }
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]))
  if (t.getTime() > now.getTime()) t.setDate(t.getDate() - 1)
  if (t.getTime() < Date.parse(admittedAt)) return { error: 'Before admission' }
  return { iso: t.toISOString() }
}

/**
 * A nurse: two requests, save by hand then approve, both in their name; a failed approve leaves it pending and says so.
 * `approve: false` (an attendant): the save alone, one request, left pending for a nurse.
 */
export async function addMissedEntry(
  api: Api,
  admissionId: number,
  draft: DraftEntry & { volume_ml: number },
  charted: string | null,
  { approve = true, iddsi_level }: { approve?: boolean; iddsi_level?: IddsiLevel } = {},
): Promise<{ entry: Entry; error: unknown }> {
  const saved = await api.addEntry(admissionId, {
    ...toEntryInput({ draft, source: 'manual', confidence: null, ...(iddsi_level !== undefined && { iddsi_level }) }),
    ...(charted ? { charted_at: charted } : {}),
  })
  if (!approve) return { entry: saved, error: null }
  try {
    return { entry: await api.review(saved.id, { action: 'approve' }), error: null }
  } catch (err) {
    return { entry: saved, error: err }
  }
}

/** Enter by hand on the capture screen: `charted` null means now (no `charted_at`). One request. */
/** A refused time never reaches the server: it rejects with the reason and sends nothing. */
export function saveByHand(api: Api, admissionId: number, p: Pending, charted: ChartedAt | null): Promise<SaveResult> {
  if (charted && 'error' in charted) return Promise.reject(new Error(charted.error))
  return saveEntry(api, admissionId, charted ? { ...p, charted_at: charted.iso } : p)
}

export function rejectBody(reason: RejectReason | null, note: string): ReviewInput {
  const n = note.trim()
  return { action: 'reject', ...(reason ? { reason } : {}), ...(n ? { note: n.slice(0, 200) } : {}) }
}

/** Amend offers "Consistency" for drinks only. */
export const offersConsistency = (category: EntryCategory) => category === 'water'
/** Amend offers "Drink" (the kind) for drinks and food. */
export const offersDrink = (category: EntryCategory) => category === 'water' || category === 'food'

/**
 * The amend request, or null while saving must stay disabled (no reason, nothing changed, bad volume). A level is sent
 * only when the result is a drink and the level changed.
 */
export function amendBody(
  e: Entry,
  volumeMl: number,
  category: EntryCategory,
  reason: string,
  iddsi?: IddsiLevel | null,
  drink?: DrinkKind | null,
): AmendInput | null {
  const r = reason.trim()
  if (r.replace(/\s+/g, '').length < MIN_REASON) return null
  if (!Number.isInteger(volumeMl) || volumeMl < 1 || volumeMl > MAX_ENTRY_ML) return null
  const body: AmendInput = { reason: r.slice(0, 200) }
  if (volumeMl !== e.volume_ml) body.volume_ml = volumeMl
  if (category !== e.category) body.category = category
  if (offersConsistency(category) && iddsi != null && iddsi !== e.iddsi_level) body.iddsi_level = iddsi
  if (offersDrink(category) && drink != null && drink !== e.drink) body.drink = drink
  return body.volume_ml === undefined && body.category === undefined && body.iddsi_level === undefined && body.drink === undefined
    ? null
    : body
}
