/** Attendant capture logic, DOM-free so it can be tested. */
import {
  LEVEL_CONTAINERS,
  READ_ABANDON_HOURS,
  VOIDING_CONTAINER,
  type ContainerKind,
  type OutputDevices,
  type CaptureReadResult,
  type ContainerReading,
  type DraftEntry,
  type Entry,
  type EntryEvidence,
  type EntryInput,
  type EntrySource,
  type IddsiLevel,
  type PhotoEvidence,
  type LevelContainer,
  type LevelResult,
  type BagReadingResult,
  type NoteResult,
  type ReadRef,
} from '@meniscus/shared'
import { ApiError, BUSY_TEXT, type Api, type Refusal } from './api.ts'
import { noteEvidence } from './evidence.ts'
import { linkMedia, photoCopy, type MediaSource } from './media.ts'
import { colourFields } from './urine.ts'
import { clampVolume } from './volume.ts'
import { clock } from './format.ts'

export { VOLUME_STEP, clampVolume, stepVolume } from './volume.ts'

export const MAX_PHOTO_SIDE = 1280

// ---------- capture choices follow the bed's devices (web/capture "Capture choices follow the bed's devices") ----------

/** The photo hint list's labels. `''` is Auto-detect. */
export const HINT_LABEL = {
  '': 'Auto-detect',
  urine_bag: 'Urine bag',
  urinal: 'Urinal',
  bedpan: 'Bedpan',
  commode_pan: 'Commode pan',
  stoma_bag: 'Stoma bag',
  drain_bag: 'Drain bag',
  water_jug: 'Water jug',
  water_bottle: 'Water bottle',
  cup: 'Cup',
  measuring_jug: 'Measuring jug',
  emesis_basin: 'Emesis basin',
} as const satisfies Partial<Record<ContainerKind | '', string>>
export type Hint = keyof typeof HINT_LABEL
const INTAKE_HINTS = ['water_jug', 'water_bottle', 'cup', 'measuring_jug'] as const satisfies readonly Hint[]
const OTHER_OUTPUT_HINTS = ['urinal', 'bedpan', 'commode_pan', 'emesis_basin'] as const satisfies readonly Hint[]

/** The bed's urine container: the urine bag with a catheter, else its voiding method's (null when not measured). */
export const urineContainer = (devices: OutputDevices): ContainerKind | null =>
  devices.urine === 'catheter' ? 'urine_bag' : VOIDING_CONTAINER[devices.urine]

/**
 * The photo hints: Auto-detect, the bed's own output containers (urine, then its stoma and drain bags), the intake
 * containers, then the urinal, bedpan, commode pan and emesis basin not yet listed. Never a bag off the care plan.
 */
export function hintsFor(devices: OutputDevices): { value: Hint; label: string }[] {
  const urine = urineContainer(devices)
  const own: Hint[] = [...(urine && urine !== 'urine_bag' ? [urine as Hint] : []), ...devices.bags.map((b): Hint => b)]
  // The urine bag leads the bags, as devices.bags starts with it.
  const values: Hint[] = ['', ...own, ...INTAKE_HINTS, ...OTHER_OUTPUT_HINTS.filter((h) => !own.includes(h))]
  return values.map((value) => ({ value, label: HINT_LABEL[value] }))
}

/** The Take-photo tile's line: the bed's first output container in `hintsFor`, then the intake containers. */
export function photoTileHint(devices: OutputDevices): string {
  const intake: readonly Hint[] = INTAKE_HINTS
  const first = hintsFor(devices).find((h) => h.value !== '' && !intake.includes(h.value))!
  return `${first.label}, jug, bottle or cup`
}

/** By hand, a urine entry's `item`: the urine method's container in words; null when urine is not measured. */
export function urineItem(devices: OutputDevices): string | null {
  const c = urineContainer(devices)
  return c === null ? null : c.replace(/_/g, ' ')
}

/** The by-hand urine form's line on a bed whose urine is not measured; null otherwise. */
export const unmeasuredLine = (devices: OutputDevices): string | null =>
  devices.urine_measured ? null : `Urine is not measured on this bed (${devices.urine}).`

/** Target size: longest side ≤ max, aspect kept, never enlarged. */
export function fitWithin(width: number, height: number, max = MAX_PHOTO_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// ---------- the read a draft came from (charting/model-accuracy links) ----------

/** Device-side margin under READ_ABANDON_HOURS: covers the latency between the server's `created_at` and `at`. */
export const READ_LINK_MARGIN_MS = 5 * 60_000

/** The read a draft came from: its id, the draft's index in the model's order, and when it answered on this device. */
export interface ReadStamp {
  id: number
  draft: number
  /** Device clock (ms) when the read answered. */
  at: number
  /** Fixed at the first save attempt (`decideRead`); a retry sends what that attempt sent. */
  send?: boolean
}

/** The stamp for draft `draft` of a read that answered at `at`; none when the answer has no `read_id`. */
export const readStamp = (r: Partial<ReadRef>, draft: number, at: number): ReadStamp | undefined =>
  typeof r.read_id === 'number' ? { id: r.read_id, draft, at } : undefined

/** Fixes `send` once: kept when already set, else `now − at < READ_ABANDON_HOURS h − READ_LINK_MARGIN_MS`. */
export function decideRead(read: ReadStamp | undefined, now = Date.now()): ReadStamp | undefined {
  if (!read || read.send !== undefined) return read
  return { ...read, send: now - read.at < READ_ABANDON_HOURS * 3_600_000 - READ_LINK_MARGIN_MS }
}

/** `{ read_id, read_draft }` when `read.send`, else `{}`. Never reads the clock. */
export const readFields = (read: ReadStamp | undefined): { read_id?: number; read_draft?: number } =>
  read?.send ? { read_id: read.id, read_draft: read.draft } : {}

/** The first save attempt fixes whether the draft's read is sent; the caller keeps what this returns for a retry. */
export const decided = <T extends { read?: ReadStamp | undefined }>(x: T, now = Date.now()): T =>
  x.read ? { ...x, read: decideRead(x.read, now) } : x
export const decidePending = (p: Pending, now = Date.now()): Pending => decided(p, now)

/** The server refused the link because this draft is already linked: an earlier attempt reached it. */
export const alreadyLinked = (err: unknown): boolean =>
  err instanceof ApiError && err.status === 400 && !!err.issues?.some((i) => i.path === 'read_id' && i.message === 'already linked')

/** A photo read's one draft, stamped with its read; null when it drafted nothing. */
export function photoDraft(r: CaptureReadResult & Partial<ReadRef>, evidence: EntryEvidence, at: number): Pending | null {
  if (!r.draft) return null
  const read = readStamp(r, 0, at)
  return { draft: r.draft, source: 'photo', confidence: r.reading.confidence, evidence, ...(read && { read }) }
}

/** A note's drafts in the model's order, each stamped with its index, so removing one keeps the others' indexes. */
export function noteDrafts(r: NoteResult & Partial<ReadRef>, source: 'voice' | 'text', transcript: string, at: number): Pending[] {
  return r.entries.map((draft, i) => {
    const read = readStamp(r, i, at)
    return { draft, source, confidence: null, evidence: noteEvidence(r, source, transcript, draft.volume_ml), ...(read && { read }) }
  })
}

/** A draft the attendant is confirming. */
export interface Pending {
  draft: DraftEntry
  source: EntrySource
  confidence: number | null
  /** What the read produced; sent with the entry (none for manual). */
  evidence?: EntryEvidence
  /** When it happened, if earlier than now (ISO). */
  charted_at?: string
  /** A drink's consistency; seeded from a thickened-fluids order, sent for `water` only. */
  iddsi_level?: IddsiLevel
  /** The read it was drafted from; none for a draft entered by hand. */
  read?: ReadStamp
}

export const canSave = (p: Pending): boolean => p.draft.volume_ml !== null && p.draft.volume_ml >= 1

export function toEntryInput(p: Pending, now = Date.now()): EntryInput {
  if (!canSave(p)) throw new Error('volume required')
  return {
    direction: p.draft.direction,
    category: p.draft.category,
    volume_ml: clampVolume(p.draft.volume_ml!),
    item: p.draft.item,
    notes: p.draft.notes,
    source: p.source,
    confidence: p.confidence,
    ...(p.evidence ? { evidence: p.evidence } : {}),
    ...(p.charted_at ? { charted_at: p.charted_at } : {}),
    ...colourFields(p.draft),
    ...(p.draft.category === 'water' && p.iddsi_level !== undefined ? { iddsi_level: p.iddsi_level } : {}),
    // Drinks and food only (web/capture "Drink on the check screen"); an output draft never sends one.
    ...((p.draft.category === 'water' || p.draft.category === 'food') && p.draft.drink ? { drink: p.draft.drink } : {}),
    ...readFields(decideRead(p.read, now)),
  }
}

/** Jug/bottle readings with a volume are level readings (the drop becomes intake on the server). */
export function levelContainer(reading: ContainerReading): LevelContainer | null {
  const c = reading.container as LevelContainer
  return (LEVEL_CONTAINERS as readonly string[]).includes(c) && reading.volume_ml !== null ? c : null
}

export interface SaveResult {
  entry: Entry | null
  level?: LevelResult
  /** A bag read saved as a bag reading (lib/bags.ts). */
  bag?: BagReadingResult
  /** A voice reading saved as several entries (one per draft). */
  entries?: Entry[]
  warning?: string
}

/**
 * The source first (uploaded once, shared by every draft from it), then for a segmented photo read its labeled copy,
 * then the entry with its `media_id` and `labeled_media_id`. A failed upload still saves the entry, with a warning.
 */
export async function saveEntry(api: Api, admissionId: number, p: Pending, source?: MediaSource): Promise<SaveResult> {
  const input = toEntryInput(p)
  const { media_id, labeled_media_id, warning } = await linkMedia(api, admissionId, source, photoCopy(p.evidence, p.draft.drink))
  const entry = await api.addEntry(admissionId, {
    ...input,
    ...(media_id !== undefined && { media_id }),
    ...(labeled_media_id !== undefined && { labeled_media_id }),
  })
  return warning ? { entry, warning } : { entry }
}

/** The jug photo first, then the level with its `media_id`; the level keeps the photo, and so does any drop entry. */
export async function saveLevel(
  api: Api,
  admissionId: number,
  container: LevelContainer,
  volumeMl: number,
  confidence: number | null,
  source?: MediaSource,
  evidence?: PhotoEvidence,
  /** The jug's read; a level sends `read_id` only. */
  read?: ReadStamp,
): Promise<SaveResult> {
  const { read_id } = readFields(decideRead(read))
  const { media_id, labeled_media_id, warning } = await linkMedia(api, admissionId, source, photoCopy(evidence))
  const level = await api.addLevel(admissionId, {
    container,
    volume_ml: clampVolume(volumeMl, 0),
    source: 'photo',
    confidence,
    ...(evidence ? { evidence } : {}),
    ...(media_id !== undefined && { media_id }),
    ...(labeled_media_id !== undefined && { labeled_media_id }),
    ...(read_id !== undefined && { read_id }),
  })
  return warning ? { entry: level.entry, level, warning } : { entry: level.entry, level }
}

// ---------- a read refused by the server's request budget (web/capture "Budget refusal offers manual entry") ----------

/** Local `HH:MM`, so no ICU build can vary it. */
const clockOf = (t: number) => clock(t)

export interface RefusalView {
  /** The notice: when reads come back, or that they are busy. */
  text: string
  /** Read again: disabled until the refusal's `Retry-After` time, and sent only on a tap. */
  readAgain: { label: string; disabled: boolean }
}

/**
 * What the capture screen says after a 429 `request_budget_exceeded`. The photo or recording stays; Enter by hand is
 * offered at once; Read again is enabled only from `until`. Nothing here sends a request or sets a timer.
 */
export function refusalView(r: Refusal, now: number): RefusalView {
  const ready = now >= r.until
  if (r.limit === 'concurrent') return { text: BUSY_TEXT, readAgain: { label: 'Read again', disabled: !ready } }
  const until = clockOf(r.until)
  const who = r.budgetClass === 'routine' ? 'Model reads for routine beds are' : 'Model reads are'
  return {
    text: `${who} used up until ${until}. Enter by hand, or read again from ${until}.`,
    readAgain: { label: ready ? 'Read again' : `Read again from ${until}`, disabled: !ready },
  }
}
