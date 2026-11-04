/**
 * Source kinds on the web: how each is captured, read and counted, and how a record's source is shown. DOM-free.
 * Adding a kind (video) is one entry in SOURCES plus its viewer in components/source-view.tsx.
 */
import {
  SOURCE_KINDS,
  type Entry,
  type LevelSnapshot,
  type MediaRef,
  type Meal,
  type PhotoEvidence,
  type Segmentation,
  type SourceKind,
  type TranscriptTurn,
} from '@meniscus/shared'
import { bagDrop, isBagEntry } from './bag-rise.ts'
import { overlayBoxes } from './evidence.ts'
import { BAG_EVENT_LABEL } from './labels.ts'
import { shortName } from './staff.ts'
import { clock, duration } from './format.ts'

export interface SourceDef<K extends SourceKind> {
  kind: K
  /** "Photo", "Recording". */
  label: string
  /** In sentences: "photo", "recording". */
  noun: string
  /** File input `accept`. */
  accept: string
  /** The most model requests one read can make (fast = Spark-only photo mode); the server may make fewer, never more. */
  requests: (fast: boolean) => number
  /** Whether an imported file is of this kind (by type, else by extension). */
  matches: (file: { type: string; name: string }) => boolean
}

const extOf = (name: string) => /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ''
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'])
const AUDIO_EXT = new Set(['m4a', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'webm', 'aac'])

export const SOURCES: { [K in SourceKind]: SourceDef<K> } = {
  photo: {
    kind: 'photo',
    label: 'Photo',
    noun: 'photo',
    accept: 'image/*',
    // SAM container + SAM liquid + Spark read; Spark only in fast mode.
    requests: (fast) => (fast ? 1 : 3),
    matches: (f) => f.type.startsWith('image/') || (!f.type && PHOTO_EXT.has(extOf(f.name))),
  },
  voice: {
    kind: 'voice',
    label: 'Recording',
    noun: 'recording',
    accept: 'audio/*',
    // Speech-to-text + Spark.
    requests: () => 2,
    matches: (f) => f.type.startsWith('audio/') || (!f.type && AUDIO_EXT.has(extOf(f.name))),
  },
}

/** `accept` for an import that takes every kind. */
export const ACCEPT_ALL = SOURCE_KINDS.map((k) => SOURCES[k].accept).join(',')

export const sourceOfFile = (f: { type: string; name: string }): SourceKind | null =>
  SOURCE_KINDS.find((k) => SOURCES[k].matches(f)) ?? null

/** The most model requests reading these can make, one read each (a `spark` read makes 1, a refused one 0). */
export const requestsFor = (kinds: SourceKind[], fast: boolean) => kinds.reduce((n, k) => n + SOURCES[k].requests(fast), 0)

/** Index of the turn playing at `ms` (the last one started), or null before the first. */
export function turnAt(turns: Pick<TranscriptTurn, 'start_ms'>[], ms: number): number | null {
  let at: number | null = null
  turns.forEach((t, i) => {
    if (t.start_ms <= ms) at = i
  })
  return at
}

/** `m:ss`, whole seconds rounded down. */
export function formatClock(ms: number): string {
  return duration(Math.max(0, Math.floor(ms / 1000)) * 1000)
}

/** "1000 mL → 600 mL · −400 mL". */
export const dropLine = (before: number, after: number) => `${before} mL → ${after} mL · −${before - after} mL`

const hhmm = (iso: string) => clock(iso)

export interface LevelPhoto {
  media_id: number | null
  /** The photo's fingerprint (null when not recorded or not kept). */
  sha256: string | null
  /** The labeled copy kept with the photo; null when none. */
  labeled: MediaRef | null
  evidence: PhotoEvidence | null
  /** "1000 mL". */
  label: string
  /** "08:00". */
  time: string
  /** A bag reading's event ("Check"); null for jugs and bottles. */
  event: string | null
}
const levelPhoto = (l: LevelSnapshot): LevelPhoto => ({
  media_id: l.media?.kind === 'photo' ? l.media.id : null,
  sha256: l.media?.kind === 'photo' ? l.media.sha256 : null,
  labeled: l.media?.kind === 'photo' ? (l.labeled_media ?? null) : null,
  evidence: l.evidence,
  label: `${l.volume_ml} mL`,
  time: hhmm(l.created_at),
  event: l.event ? BAG_EVENT_LABEL[l.event] : null,
})
/** "150 mL · Check · 10:00" for a bag reading, "1000 mL · 08:00" for a jug. */
export const photoTitle = (p: LevelPhoto) => [p.label, p.event, p.time].filter(Boolean).join(' · ')

/** How an entry's source is shown: which viewer, and the media it loads (one GET each), if any. */
export type SourceShown =
  | { kind: 'levels'; photos: LevelPhoto[]; drop: string | null }
  | { kind: 'photo'; media_id: number; evidence: PhotoEvidence | null }
  | { kind: 'voice'; media_id: number; duration_ms: number | null; turns: TranscriptTurn[]; timed: boolean }
  | { kind: 'text'; transcript: string }
  | { kind: 'manual'; label: string }
  /** A capture whose photo or recording was not kept. */
  | { kind: 'none'; transcript: string | null }

export function sourceOf(e: Entry): SourceShown {
  const ev = e.evidence
  if (e.levels) {
    const { before, after } = e.levels
    return {
      kind: 'levels',
      photos: [...(before ? [levelPhoto(before)] : []), levelPhoto(after)],
      drop: isBagEntry(e) ? bagDrop(before, after) : before ? dropLine(before.volume_ml, after.volume_ml) : null,
    }
  }
  if (e.media?.kind === 'photo') return { kind: 'photo', media_id: e.media.id, evidence: ev?.kind === 'photo' ? ev : null }
  if (e.media?.kind === 'voice') {
    const note = ev?.kind === 'voice' ? ev : null
    const duration = e.media.duration_ms ?? note?.duration_ms ?? null
    const timed = !!note?.turns?.length
    // Older evidence, or no turns detected: the whole transcript as one untimed turn.
    const turns = timed ? note.turns! : note?.transcript ? [{ start_ms: 0, end_ms: duration ?? 0, text: note.transcript }] : []
    return { kind: 'voice', media_id: e.media.id, duration_ms: duration, turns, timed }
  }
  if (ev?.kind === 'text') return { kind: 'text', transcript: ev.transcript }
  if (e.source === 'manual')
    return { kind: 'manual', label: e.created_by ? `Entered by hand by ${shortName(e.created_by.name)}` : 'Entered by hand' }
  return { kind: 'none', transcript: ev?.kind === 'voice' ? ev.transcript : null }
}

/** The tray photo of a photo meal, or null. */
export const mealSource = (m: Pick<Meal, 'source' | 'media'>): { media_id: number } | null =>
  m.source === 'photo' && m.media?.kind === 'photo' ? { media_id: m.media.id } : null

/** The outline starts on when SAM found the container or the liquid. */
export const outlineDefault = (r: { segmentation: Segmentation | null } | null) => !!(r?.segmentation?.container || r?.segmentation?.fluid)

/** Overlay boxes (percent of the photo) when the outline is on and there is one to draw; null otherwise. */
export function outlineFor(r: { segmentation: Segmentation | null } | null, on: boolean, width: number, height: number) {
  return on && r && outlineDefault(r) ? overlayBoxes(r.segmentation!, width, height) : null
}

// Its own module, so the bed review's first paint skips the source viewer's helpers.
export { rejectSourceText } from './reject-source.ts'
