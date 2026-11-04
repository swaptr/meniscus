/** One dense row per entry (web/ward "Dense entry rows", DESIGN.md 5.7): the strings and tones, pure. */
import type { DrinkKind, Entry } from '@meniscus/shared'
import { drinkTitle } from './drinks.ts'
import { clock, confidenceChip } from './format.ts'
import { CATEGORY_LABEL, ENTRY_STATUS_LABEL, ENTRY_STATUS_TONE, SOURCE_LABEL } from './labels.ts'
import { shortName } from './staff.ts'

export interface EntryRow {
  time: string
  /** ▲ in, ▼ out. */
  glyph: '▲' | '▼'
  /** The drink kind's label, else the category's. */
  kind: string
  /** For the icon: the drink kind, or null (the category is shown). */
  drink: DrinkKind | null
  volume: string
  /** `▲ Tea 150 mL`. */
  head: string
  /** The item when it is not the kind's label (`masala chai`). */
  name: string | null
  source: { text: string; tone: 'warn' | 'neutral' }
  status: { text: string; tone: 'pending' | 'ok' | 'neutral' }
  who: string | null
  /** Rejected: the volume is struck through (and the status says so in words). */
  struck: boolean
  /** Has a photo, shown only in its peek, never on the row. */
  photo: boolean
  /** The row button's accessible name. */
  label: string
  peekTitle: string
}

export function entryRow(e: Entry): EntryRow {
  const time = clock(e.created_at)
  const glyph = e.direction === 'in' ? '▲' : '▼'
  const t = drinkTitle(e)
  const kind = t?.label ?? CATEGORY_LABEL[e.category]
  const volume = `${e.volume_ml} mL`
  const name = t ? t.name : e.item && e.item.trim().toLowerCase() !== kind.toLowerCase() ? e.item : null
  const source =
    e.source !== 'manual' && e.confidence !== null
      ? confidenceChip(SOURCE_LABEL[e.source], e.confidence)
      : { text: SOURCE_LABEL[e.source], tone: 'neutral' as const }
  const status = { text: ENTRY_STATUS_LABEL[e.status], tone: ENTRY_STATUS_TONE[e.status] }
  const who = e.created_by ? shortName(e.created_by.name) : null
  const head = `${glyph} ${kind} ${volume}`
  return {
    time,
    glyph,
    kind,
    drink: t?.kind ?? null,
    volume,
    head,
    name,
    source,
    status,
    who,
    struck: e.status === 'rejected',
    photo: e.media?.kind === 'photo' || e.has_photo,
    label: [time, `${e.direction === 'in' ? 'In' : 'Out'} ${kind} ${volume}`, name, source.text, status.text, who]
      .filter(Boolean)
      .join(', '),
    peekTitle: `Entry ${time}`,
  }
}

/** A pending row keeps its actions on the row, never only in its peek. */
export const pendingActions = (e: Pick<Entry, 'status'>): string[] => (e.status === 'pending' ? ['Reject…', 'Approve'] : [])
