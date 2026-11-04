/** The ward Data quality view: tiles and flagged rows from GET /api/wards/:id/quality. Pure. */
import type { QualityTotals, WardQuality } from '@meniscus/shared'
import type { Tone } from '../components/ui.tsx'
import { entryFlags, type Badge } from './flags.ts'
import { rate } from './format.ts'
import { CATEGORY_LABEL } from './labels.ts'
import { entrySwatch, type Swatch } from './urine.ts'

export const QUIET_TEXT = 'Nothing flagged in the last 7 days'

export interface Tile {
  label: string
  value: string
  tone: Tone
}

export function qualityTiles(t: QualityTotals): Tile[] {
  const warn = (n: number): Tone => (n > 0 ? 'warn' : 'neutral')
  return [
    { label: 'Entries', value: String(t.entries), tone: 'info' },
    {
      label: 'Corrected at approval',
      value: t.entries ? rate({ n: t.corrected, of: t.entries, pct: (t.corrected / t.entries) * 100 }) : '0',
      tone: warn(t.corrected),
    },
    { label: 'Amended', value: String(t.amended), tone: warn(t.amended) },
    { label: 'Late', value: String(t.late), tone: warn(t.late) },
    { label: 'Rejected', value: String(t.rejected), tone: t.rejected > 0 ? 'danger' : 'neutral' },
    { label: 'By hand', value: String(t.manual), tone: 'neutral' },
  ]
}

export interface FlaggedRow {
  key: number
  href: string
  bed: string
  patient: string
  charted: string
  what: string
  /** The urine colour, for coloured urine entries. */
  swatch: Swatch | null
  badges: Badge[]
}

/** Newest charted first, as served. Each row opens its bed review. */
export function flaggedRows(q: Pick<WardQuality, 'flagged'>): FlaggedRow[] {
  return q.flagged.map((f) => ({
    key: f.entry.id,
    href: `/n/${f.admission_id}`,
    bed: f.bed,
    patient: f.patient,
    charted: f.entry.created_at,
    what: `${f.entry.volume_ml} mL ${CATEGORY_LABEL[f.entry.category].toLowerCase()}`,
    swatch: entrySwatch(f.entry),
    // "By hand" alone is not a fault; keep it off this list's badges.
    badges: entryFlags(f.entry).filter((b) => b.text !== 'By hand'),
  }))
}
