/** A Data quality tile's peek (web/ward "Metric peeks on stats"): its figure by recorder, from the loaded summary. Pure. */
import type { WardQuality } from '@meniscus/shared'

type Recorder = WardQuality['recorders'][number]
const FIELD: Record<string, keyof Omit<Recorder, 'staff'>> = {
  Entries: 'recorded',
  'Corrected at approval': 'corrected',
  Amended: 'amended',
  Late: 'late',
  Rejected: 'rejected',
}

/** `Ravi Kumar · 61` per recorder with any, most first; null for a tile with no per-recorder count (By hand). */
export function tileByRecorder(q: Pick<WardQuality, 'recorders'>, label: string): string[] | null {
  const f = FIELD[label]
  if (!f) return null
  return q.recorders
    .filter((r) => r[f] > 0)
    .toSorted((a, b) => b[f] - a[f])
    .map((r) => `${r.staff?.name ?? 'Not recorded'} · ${r[f]}`)
}
