/**
 * A tiny store the routes write after their own loads, so the sidebar, quick jump and Next up can show counts with no
 * request of their own (DESIGN.md 4.1, design.md D4). DOM-free; `useSnapshot` lives in `use-snapshot.ts`.
 */
import type { AdmissionSummary, AlertTone, WardSummary } from '@meniscus/shared'

export interface WardFigures {
  id: number
  code: string
  name: string | null
  pending: number
  /** Beds with a review prompt. */
  review: number
  worst_tone: AlertTone | null
}

export interface Snapshot {
  /** Ward figures by id, from `/n`'s `GET /api/wards` or a ward dashboard's beds. */
  wards: Readonly<Record<number, WardFigures>>
  /** When the newest ward figures were loaded (ms), or null before any load. */
  at: number | null
  /** The beds of the last ward dashboard loaded. */
  beds: { wardId: number; items: readonly AdmissionSummary[] } | null
  /** The ward of the bed review open now (written by `/n/$id`), so This ward shows there too. */
  bedWard: number | null
}

export const EMPTY: Snapshot = { wards: {}, at: null, beds: null, bedWard: null }

const TONE_RANK: Record<AlertTone, number> = { danger: 0, warn: 1, info: 2 }

/** The worst tone of a bed list's prompts. */
export function worstOf(tones: readonly (AlertTone | null | undefined)[]): AlertTone | null {
  let w: AlertTone | null = null
  for (const t of tones) if (t && (w === null || TONE_RANK[t] < TONE_RANK[w])) w = t
  return w
}

export function createSnapshot(initial: Snapshot = EMPTY) {
  let state = initial
  const listeners = new Set<() => void>()
  const set = (next: Snapshot) => {
    state = next
    for (const l of listeners) l()
  }
  return {
    get: (): Snapshot => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    /** `/n` after `GET /api/wards`. */
    writeWards(wards: readonly WardSummary[], at: number) {
      const next: Record<number, WardFigures> = { ...state.wards }
      for (const w of wards)
        next[w.id] = {
          id: w.id,
          code: w.code,
          name: w.name,
          pending: w.pending,
          review: w.beds_with_alerts,
          worst_tone: w.worst_tone ?? null,
        }
      set({ ...state, wards: next, at })
    },
    /** `/n/w/$ward` after `GET /api/admissions?ward=<id>`; `tone` maps a prompt kind to its tone. */
    writeWard(wardId: number, beds: readonly AdmissionSummary[], at: number, tone: (a: AdmissionSummary) => AlertTone | null) {
      const prev = state.wards[wardId]
      const first = beds[0]
      const figures: WardFigures = {
        id: wardId,
        code: first?.ward_code ?? prev?.code ?? String(wardId),
        name: first?.ward_name ?? prev?.name ?? null,
        pending: beds.reduce((n, b) => n + b.pending, 0),
        review: beds.filter((b) => b.alerts.length > 0).length,
        worst_tone: worstOf(beds.map(tone)),
      }
      set({ ...state, wards: { ...state.wards, [wardId]: figures }, at, beds: { wardId, items: beds } })
    },
    /** `/n/$id` once its admission is known. */
    writeBedWard(wardId: number | null) {
      if (state.bedWard !== wardId) set({ ...state, bedWard: wardId })
    },
    reset: () => set(EMPTY),
  }
}

export type SnapshotStore = ReturnType<typeof createSnapshot>

/** The app's one store. Cleared on sign-out by the session gate's remount. */
export const snapshot = createSnapshot()
