/**
 * What the bed review's peeks say, from data the route already loaded (web/ward "Entry peek", "Read drawn on the peek
 * photo", "Metric peeks on stats", "Photo strip"; DESIGN.md 5.1, 5.8). Pure: no request is made here or by the peeks,
 * except the one photo an entry peek fetches through the media cache when it opens.
 */
import type { DrinkKind, Entry, EntryCategory } from '@meniscus/shared'
import { photoStrip } from './charts.ts'
import { drinkTitle, drinkTotals, kindLabel } from './drinks.ts'
import { clock, confidenceChip } from './format.ts'
import { CATEGORY_LABEL, ENTRY_STATUS_LABEL, ENTRY_STATUS_TONE, MODE_LABEL, SOURCE_LABEL } from './labels.ts'
import { photoLabeled, photoMediaId } from './media-cache.ts'
import { pendingActions } from './rows.ts'
import { shortName } from './staff.ts'
import type { MediaState } from './use-media.ts'

export interface EntryPeek {
  /** `10:42 · Tea 150 mL`: the charted time, the drink kind (else category) and the volume. */
  head: string
  drink: DrinkKind | null
  /** The item when it is not the kind's label (`masala chai`). */
  name: string | null
  status: { text: string; tone: 'pending' | 'ok' | 'neutral' }
  source: { text: string; tone: 'warn' | 'neutral' }
  /** `SAM + Spark` or `Spark only` for a photo read; null otherwise. */
  mode: string | null
  /** `AI read 450 mL · Saved 430 mL · Approved 375 mL`; parts without a value are left out. */
  volumes: string
  /** Who recorded and reviewed it, and any amendment. */
  trail: string[]
  /** A voice or typed note's transcript, in curly quotes. */
  quote: string | null
  /** The photo the peek fetches when it opens (null: no photo, nothing is fetched). */
  mediaId: number | null
  /** The row's actions, repeated in the peek: `Reject…` and `Approve` while pending. */
  actions: string[]
  /** `Details` opens the entry details (always offered). */
  details: true
}

const by = (s: Entry['created_by']) => (s ? ` by ${shortName(s.name)}` : '')

/** The AI's own volume before any edit: the photo read's, or a note's draft. */
export function aiVolume(e: Entry): number | null {
  const ev = e.evidence
  if (!ev) return null
  return ev.kind === 'photo' ? ev.reading.volume_ml : ev.draft_ml
}

export function entryPeek(e: Entry): EntryPeek {
  const t = drinkTitle(e)
  const kind = t?.label ?? CATEGORY_LABEL[e.category]
  const name = t ? t.name : e.item && e.item.trim().toLowerCase() !== kind.toLowerCase() ? e.item : null
  const source =
    e.source !== 'manual' && e.confidence !== null
      ? confidenceChip(SOURCE_LABEL[e.source], e.confidence)
      : { text: SOURCE_LABEL[e.source], tone: 'neutral' as const }
  const ai = aiVolume(e)
  const volumes = [
    ai !== null ? `AI read ${ai} mL` : null,
    `Saved ${e.recorded_ml} mL`,
    e.approved_ml !== null ? `Approved ${e.approved_ml} mL` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const trail = [`Recorded ${clock(e.recorded_at)}${by(e.created_by)}`]
  if (e.reviewed_at && e.status === 'approved') trail.push(`Approved ${clock(e.reviewed_at)}${by(e.reviewed_by)}`)
  if (e.reviewed_at && e.status === 'rejected') trail.push(`Rejected ${clock(e.reviewed_at)}${by(e.reviewed_by)}`)
  if (e.amended_at) trail.push(`Amended ${clock(e.amended_at)}`)
  const ev = e.evidence
  return {
    head: `${clock(e.created_at)} · ${kind} ${e.volume_ml} mL`,
    drink: t?.kind ?? null,
    name,
    status: { text: ENTRY_STATUS_LABEL[e.status], tone: ENTRY_STATUS_TONE[e.status] },
    source,
    mode: ev?.kind === 'photo' ? MODE_LABEL[ev.mode] : null,
    volumes,
    trail,
    quote: ev && ev.kind !== 'photo' && ev.transcript.trim() ? `“${ev.transcript.trim()}”` : null,
    mediaId: photoMediaId(e),
    actions: pendingActions(e),
    details: true,
  }
}

export interface ReadMark {
  /** `AI read 450`, `Saved 430`, `Approved 375`. */
  label: string
  kind: 'ai' | 'saved' | 'approved'
  ml: number
  /** 0..1 up the scale. */
  at: number
}

/**
 * The scale beside the peek's photo: 0 to the container's capacity with the AI's, the saved and (when approved) the
 * approved volume marked, so a correction is seen against the photo. Null without a photo read or a capacity.
 */
export function readScale(e: Entry): { capacity: number; ticks: number[]; marks: ReadMark[] } | null {
  const ev = e.evidence
  if (ev?.kind !== 'photo') return null
  const cap = ev.reading.capacity_ml
  if (!cap || cap <= 0) return null
  const at = (ml: number) => Math.min(1, Math.max(0, ml / cap))
  const marks: ReadMark[] = []
  if (ev.reading.volume_ml !== null)
    marks.push({ label: `AI read ${ev.reading.volume_ml}`, kind: 'ai', ml: ev.reading.volume_ml, at: at(ev.reading.volume_ml) })
  marks.push({ label: `Saved ${e.recorded_ml}`, kind: 'saved', ml: e.recorded_ml, at: at(e.recorded_ml) })
  if (e.status === 'approved' && e.approved_ml !== null)
    marks.push({ label: `Approved ${e.approved_ml}`, kind: 'approved', ml: e.approved_ml, at: at(e.approved_ml) })
  const step = cap <= 300 ? 50 : cap <= 1000 ? 250 : 500
  const ticks: number[] = []
  for (let v = 0; v <= cap; v += step) ticks.push(v)
  if (ticks.at(-1) !== cap) ticks.push(cap)
  return { capacity: cap, ticks, marks }
}

/** The metric peek's own short names (the spec writes `IV 400 mL`); every other category keeps its label. */
const PEEK_CATEGORY: Record<EntryCategory, string> = { ...CATEGORY_LABEL, iv: 'IV' }

export interface ShareRow {
  label: string
  ml: number
  /** 0..1 of the figure's total. */
  share: number
  /** A drink's kind for its icon (`other` for a drink with no kind); null for any other category. */
  drink: DrinkKind | null
}

/**
 * The `In` vital's peek: approved intake, drinks by drink kind (largest first, from `drinkTotals`), then the other
 * categories largest first, each with its share of the total.
 */
export function bedInPeek(entries: readonly Entry[]): { total: number; rows: ShareRow[] } {
  const approved = entries.filter((e) => e.status === 'approved' && e.direction === 'in')
  const total = approved.reduce((n, e) => n + e.volume_ml, 0)
  const share = (ml: number) => (total > 0 ? ml / total : 0)
  const drinks: ShareRow[] = drinkTotals(approved).map((d) => ({
    label: kindLabel(d.kind),
    ml: d.ml,
    share: share(d.ml),
    drink: d.kind ?? 'other',
  }))
  return {
    total,
    rows: [
      ...drinks,
      ...byCategory(
        approved.filter((e) => e.category !== 'water'),
        share,
      ),
    ],
  }
}

/** The `Out` vital's peek: approved output by category, largest first. */
export function bedOutPeek(entries: readonly Entry[]): { total: number; rows: ShareRow[] } {
  const approved = entries.filter((e) => e.status === 'approved' && e.direction === 'out')
  const total = approved.reduce((n, e) => n + e.volume_ml, 0)
  return { total, rows: byCategory(approved, (ml) => (total > 0 ? ml / total : 0)) }
}

function byCategory(list: readonly Entry[], share: (ml: number) => number): ShareRow[] {
  const sums = new Map<EntryCategory, number>()
  for (const e of list) sums.set(e.category, (sums.get(e.category) ?? 0) + e.volume_ml)
  return [...sums].sort((a, b) => b[1] - a[1]).map(([c, ml]) => ({ label: PEEK_CATEGORY[c], ml, share: share(ml), drink: null }))
}

/** The `Pending` vital's peek: each pending entry `10:42 · Tea · 150 mL`, oldest first. */
export function bedPendingPeek(entries: readonly Entry[]): { id: number; line: string }[] {
  return entries
    .filter((e) => e.status === 'pending')
    .toSorted((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((e) => ({ id: e.id, line: `${clock(e.created_at)} · ${drinkTitle(e)?.label ?? CATEGORY_LABEL[e.category]} · ${e.volume_ml} mL` }))
}

/** The photo strip's thumbnails, newest first, each with the media it fetches: none while the strip is closed. */
export function stripThumbs(entries: readonly Entry[], now: number, open: boolean): { entry: Entry; mediaId: number | null }[] {
  if (!open) return []
  // The labeled copy when one was kept, else the photo (web/ward "Photo strip").
  return photoStrip(entries, now).map((entry) => ({ entry, mediaId: photoLabeled(entry)?.id ?? photoMediaId(entry) }))
}

/** A photo box never shows empty: the no-photo icon while loading, without a photo, or when it failed. */
export function peekPhotoBox(m: MediaState): { show: 'photo'; url: string } | { show: 'no-photo'; label: string } {
  if (m.status === 'ready') return { show: 'photo', url: m.url }
  return { show: 'no-photo', label: m.status === 'failed' ? 'Photo not available' : m.status === 'none' ? 'No photo' : 'Loading photo' }
}
