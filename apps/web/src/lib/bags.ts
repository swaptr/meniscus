/**
 * Bag readings on the web: the check screen's preview and saved text, the save plans (by photo read, by hand, after
 * emptying), the bed review's periods and rows, and the missed-emptying form rules. DOM-free; nothing here calls a
 * model. The rise rule is the server's (lib/bag-rise.ts); what was charted always comes back from the server.
 */
import {
  BAG_CAPACITY_ML,
  BAG_CATEGORY,
  BAG_CONTAINERS,
  BAG_MAX_ML,
  BAG_NEARLY_FULL,
  emptiedByDefault,
  readingInterval,
  type Admission,
  type BagChart,
  type BagContainer,
  type BagDuplicate,
  type BagEvent,
  type BagPeriod,
  type BagReading,
  type BagReadingInput,
  type BagReadingResult,
  type CaptureReadResult,
  type CareStatus,
  type ContainerReading,
  type EntryCategory,
  type MediaRef,
  type OutputDevices,
  type PhotoEvidence,
  type ReadRef,
  type UrineColour,
} from '@meniscus/shared'
import { ApiError, type Api } from './api.ts'
import { baselineAfter } from './bag-rise.ts'
import { decideRead, readFields, readStamp, urineItem, type Pending, type ReadStamp } from './capture.ts'
import { when, withCategory } from './care.ts'
import { lateText } from './flags.ts'
import { BAG_EVENT_LABEL, BAG_NAME } from './labels.ts'
import { linkMedia, photoCopy, type MediaSource } from './media.ts'
import { shortName } from './staff.ts'
import { colourFields } from './urine.ts'
import { readingsOf, type Fall } from './bag-prompts.ts'

// The bed review's prompt helpers live in bag-prompts.ts, so the review's first paint skips the save plans.
export { bagMismatch, fallsOf, offersMissedEmptying, promptDevice, readingsOf, type BagMismatch, type Fall } from './bag-prompts.ts'

const DAY_MS = 24 * 3_600_000
const MAX_NOTES = 200

const t = (r: Pick<BagReading, 'created_at'>) => Date.parse(r.created_at)

/** A bag read with a volume is a bag reading; anything else (a urinal, a jug) is not. */
export function bagContainer(reading: ContainerReading): BagContainer | null {
  const c = reading.container as BagContainer
  return BAG_CONTAINERS.includes(c) && reading.volume_ml !== null ? c : null
}

/**
 * The bag an output category is measured in, for "Bag level" on the by-hand form: only a bag on record
 * (`devices.bags`, web/capture "Bag level by hand"); null for the rest.
 */
export const bagOfCategory = (category: EntryCategory, devices: Pick<OutputDevices, 'bags'>): BagContainer | null =>
  devices.bags.find((c) => BAG_CATEGORY[c] === category) ?? null

/**
 * By hand, the type changed: urine takes the bed's urine container as its `item` (none when not measured), any other
 * type none; `bagOn` is whether "Bag level" is offered, and so on at first (a bag on record).
 */
export function byHandCategory(
  p: Pending,
  category: EntryCategory,
  care: CareStatus,
  devices: OutputDevices,
): { pending: Pending; bagOn: boolean } {
  const next = withCategory(p, category, care)
  return {
    pending: { ...next, draft: { ...next.draft, item: category === 'urine' ? urineItem(devices) : null } },
    bagOn: bagOfCategory(category, devices) !== null,
  }
}

// ---------- the check screen ----------

/** A bag level being confirmed, from a photo read or typed. */
export interface BagDraft {
  container: BagContainer
  volume_ml: number
  /** "Emptied after photo". */
  emptied: boolean
  /** "Bag changed": wins over `emptied`. */
  changed: boolean
  source: 'photo' | 'manual'
  confidence: number | null
  /** The read's evidence; none for a typed level. */
  evidence: PhotoEvidence | null
  notes: string | null
  urine_colour: UrineColour | null
  urine_rgb: string | null
  /** When it was read, if earlier than now (ISO). */
  charted_at: string | null
  /** The photo read it came from; none for a typed level (with or without a photo). */
  read?: ReadStamp | undefined
}

export const bagEvent = (d: Pick<BagDraft, 'emptied' | 'changed'>): BagEvent =>
  d.changed ? 'bag_changed' : d.emptied ? 'emptied' : 'check'

/** The bed's interval as the chart read returns it (a catheter order's included); `bags` absent: the ward default. */
type BedInterval = Pick<BagChart, 'interval_h' | 'interval_from'>
/** The event's default: "Emptied after photo" when the bed's reading interval is 4 hours or more, else "Check". */
export const emptiedDefault = (admission: Pick<Admission, 'ward_code'>, bags?: BedInterval) =>
  emptiedByDefault(bags ? { h: bags.interval_h, from: bags.interval_from } : readingInterval(admission))

/** The bag reading a photo read becomes, or null when it is not a bag with a volume. `at`: when the read answered. */
export function draftFromRead(
  r: CaptureReadResult & Partial<ReadRef>,
  evidence: PhotoEvidence,
  admission: Pick<Admission, 'ward_code'>,
  at = Date.now(),
  bags?: BedInterval,
): BagDraft | null {
  const container = bagContainer(r.reading)
  if (!container) return null
  const colour = r.draft && container === 'urine_bag' ? colourFields(r.draft) : {}
  const read = readStamp(r, 0, at)
  return {
    container,
    volume_ml: r.reading.volume_ml!,
    emptied: emptiedDefault(admission, bags),
    changed: false,
    source: 'photo',
    confidence: r.reading.confidence,
    evidence,
    notes: r.draft?.notes ?? null,
    urine_colour: colour.urine_colour ?? null,
    urine_rgb: colour.urine_rgb ?? null,
    charted_at: null,
    ...(read && { read }),
  }
}

/** "Bag level" on the by-hand form: a typed level, with a photo when one was taken (logged, not read). */
export function byHandDraft(
  container: BagContainer,
  volumeMl: number,
  admission: Pick<Admission, 'ward_code'>,
  chartedIso: string | null,
  photo = false,
  bags?: BedInterval,
): BagDraft {
  return {
    container,
    volume_ml: volumeMl,
    emptied: emptiedDefault(admission, bags),
    changed: false,
    source: photo ? 'photo' : 'manual',
    confidence: null,
    evidence: null,
    notes: null,
    urine_colour: null,
    urine_rgb: null,
    charted_at: chartedIso,
  }
}

export interface CheckView {
  /** "Last reading 260 mL at 10:00"; null for the bag's first. */
  last: string | null
  /** What saving charts. */
  preview: string
  /** Below the baseline: saving charts the whole level and flags it. Save stays enabled. */
  fell: boolean
  /** "The next reading starts from 0 mL." */
  next: string
}

/** The check screen's lines, from the chart read's `bags` (no request). */
export function checkView(d: BagDraft, bags: BagChart, now: number): CheckView {
  const at = d.charted_at ? Date.parse(d.charted_at) : now
  const prev = readingsOf(bags, d.container)
    .filter((r) => t(r) <= at)
    .at(-1)
  const v = Math.round(d.volume_ml)
  const next = `The next reading starts from ${d.changed || d.emptied ? 0 : v} mL.`
  if (!prev) return { last: null, preview: `First reading of this bag: saving charts ${v} mL`, fell: false, next }
  const time = when(prev.created_at, now)
  const last = `Last reading ${prev.volume_ml} mL at ${time}`
  const base = baselineAfter(prev)
  if (v > base) return { last, preview: `+${v - base} mL since ${time}`, fell: false, next }
  if (v === base) return { last, preview: `No rise since ${time}: saving charts nothing`, fell: false, next }
  const below = prev.event === 'emptied' ? `Below the ${base} mL left at ${time}` : `Below the ${time} reading (${base} mL)`
  const charts = v > 0 ? `Saving charts ${v} mL` : 'Saving charts nothing'
  return { last, preview: `${below} with no emptying recorded. ${charts} and asks the nurse to review.`, fell: true, next }
}

/** `Nearly full: 1650 of 2000 mL. Empty it now?` for a check at BAG_NEARLY_FULL of the bag's capacity; else null. */
export function nearlyFullLine(d: Pick<BagDraft, 'container' | 'volume_ml' | 'emptied' | 'changed'>): string | null {
  const capacity = BAG_CAPACITY_ML[d.container]
  const v = Math.round(d.volume_ml)
  return bagEvent(d) === 'check' && v >= BAG_NEARLY_FULL * capacity ? `Nearly full: ${v} of ${capacity} mL. Empty it now?` : null
}

// ---------- saving ----------

/** The request body; a photo without a kept upload or a read is sent as by hand. `read_id` only from a read, as decided. */
export function bagInput(d: BagDraft, mediaId?: number, labeledId?: number): BagReadingInput {
  const photo = d.source === 'photo' && (mediaId !== undefined || d.evidence !== null)
  const { read_id } = photo && d.evidence ? readFields(d.read) : {}
  return {
    container: d.container,
    event: bagEvent(d),
    volume_ml: Math.min(BAG_MAX_ML, Math.max(0, Math.round(d.volume_ml))),
    source: photo ? 'photo' : 'manual',
    ...(photo && mediaId !== undefined && { media_id: mediaId }),
    ...(photo && mediaId !== undefined && d.evidence && labeledId !== undefined && { labeled_media_id: labeledId }),
    ...(photo && d.confidence !== null && { confidence: d.confidence }),
    ...(photo && d.evidence && { evidence: d.evidence }),
    ...(d.notes?.trim() && { notes: d.notes.trim().slice(0, MAX_NOTES) }),
    ...(d.container === 'urine_bag' && d.urine_colour && { urine_colour: d.urine_colour, ...(d.urine_rgb && { urine_rgb: d.urine_rgb }) }),
    ...(d.charted_at && { charted_at: d.charted_at }),
    ...(read_id !== undefined && { read_id }),
  }
}

export interface BagSaved {
  result: BagReadingResult
  /** The photo could not be kept; the reading was saved without it. */
  warning?: string
}

/**
 * The photo first (once), then the reading with its `media_id`. Two requests with a photo, one without. A read draft
 * carries its `read_id` as decided at the first save attempt (the caller keeps that decision for a retry).
 */
export async function saveBagReading(api: Api, admissionId: number, d: BagDraft, source?: MediaSource): Promise<BagSaved> {
  const { media_id, labeled_media_id, warning } = await linkMedia(api, admissionId, source, photoCopy(d.evidence))
  const result = await api.addBagReading(admissionId, bagInput({ ...d, read: decideRead(d.read) }, media_id, labeled_media_id))
  return warning ? { result, warning } : { result }
}

// ---------- duplicates (web/capture "Duplicate bag reading at the bed") ----------

/** A post answered 409 `duplicate_reading`: the reading it repeats, and the body to resend on "Save anyway". */
export interface BagRefused {
  duplicate: BagDuplicate
  /** The first attempt's body (its `media_id` and `read_id` as decided then), without any confirmation. */
  resend: BagReadingInput
}
export type BagOutcome = { saved: BagSaved } | BagRefused

/** The reading a 409 names, from a failed post; null for any other failure. */
export const duplicateIn = (err: unknown): BagDuplicate | null =>
  err instanceof ApiError && err.status === 409 && err.duplicate ? err.duplicate : null

/** One bag-reading post; a 409 `duplicate_reading` comes back as `BagRefused`, any other failure throws. */
export async function postBagReading(api: Api, admissionId: number, input: BagReadingInput, warning?: string): Promise<BagOutcome> {
  const { confirm_duplicate_of: _, ...resend } = input
  try {
    const result = await api.addBagReading(admissionId, input)
    return { saved: warning ? { result, warning } : { result } }
  } catch (err) {
    const duplicate = duplicateIn(err)
    if (duplicate) return { duplicate, resend }
    throw err
  }
}

/** As saveBagReading (the photo once, then the reading), answering a 409 with `BagRefused` instead of throwing. */
export async function trySaveBag(api: Api, admissionId: number, d: BagDraft, source?: MediaSource): Promise<BagOutcome> {
  const { media_id, labeled_media_id, warning } = await linkMedia(api, admissionId, source, photoCopy(d.evidence))
  return postBagReading(api, admissionId, bagInput({ ...d, read: decideRead(d.read) }, media_id, labeled_media_id), warning)
}

/** "Save anyway": the same body once, confirming the shown reading's id; no upload. A new 409 names the new match. */
export const saveAnyway = (api: Api, admissionId: number, refused: BagRefused): Promise<BagOutcome> =>
  postBagReading(api, admissionId, { ...refused.resend, confirm_duplicate_of: refused.duplicate.id })

const REPEATED: Record<BagEvent, string> = { check: 'checked', emptied: 'emptied', bag_changed: 'bag changed' }
/** `Same as the reading at 11:00: emptied at 380 mL.` */
export const duplicateText = (d: BagDuplicate, now: number) =>
  `Same as the reading at ${when(d.created_at, now)}: ${REPEATED[d.event]} at ${d.volume_ml} mL.`
/** After "Discard": `Not saved. The reading at 11:00 stands.` */
export const discardedText = (d: BagDuplicate, now: number) => `Not saved. The reading at ${when(d.created_at, now)} stands.`

const VERB: Record<BagEvent, string> = { check: 'checked', emptied: 'emptied', bag_changed: 'changed' }

/** "Urine bag emptied at 380 mL". */
export const savedHead = (r: Pick<BagReading, 'container' | 'event' | 'volume_ml'>) =>
  `${BAG_NAME[r.container]} ${VERB[r.event]} at ${r.volume_ml} mL`

/** "Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval." */
export function savedText({ reading: r, entry }: BagReadingResult): string {
  const head = savedHead(r)
  if (!entry) return r.fell ? `${head}: nothing charted, flagged for review, as the level fell.` : `${head}: nothing new to chart.`
  const flagged = r.fell ? ' and flagged for review, as the level fell' : ''
  return `${head}: ${entry.volume_ml} mL charted${flagged}. Waiting for nurse approval.`
}

// ---------- after emptying ----------

export interface AfterView {
  /** The primary button first, then "Done". */
  actions: [string, string]
  /** "Left in bag": an emptying only. */
  residual: boolean
}
export const afterView = (r: Pick<BagReading, 'event'>): AfterView => ({
  actions: [r.event === 'check' ? 'Emptied it now? Add after-emptying photo' : 'Add after-emptying photo', 'Done'],
  residual: r.event === 'emptied',
})

/** The body of "Emptied it now?" after a check: an emptying at the check's level (rise 0, no entry), by hand. */
export const emptiedNowInput = (check: Pick<BagReading, 'container' | 'volume_ml'>): BagReadingInput => ({
  container: check.container,
  event: 'emptied',
  volume_ml: check.volume_ml,
  source: 'manual',
})
/** "Emptied it now?": one request. */
export const emptiedNow = (api: Api, admissionId: number, check: Pick<BagReading, 'container' | 'volume_ml'>) =>
  api.addBagReading(admissionId, emptiedNowInput(check))

export interface AfterInput {
  photo?: Blob
  /** "Left in bag"; 0 sends nothing. */
  residual_ml?: number
}

/**
 * "Done": the photo uploaded once, then one after-emptying request with it and any residual. Null when nothing was
 * sent: a check, or neither a photo nor a residual.
 */
export async function finishAfterEmptying(
  api: Api,
  admissionId: number,
  reading: Pick<BagReading, 'id' | 'event' | 'volume_ml'>,
  input: AfterInput,
): Promise<{ reading: BagReading | null; warning?: string } | null> {
  if (reading.event === 'check') return null
  const ml = reading.event === 'emptied' ? Math.min(reading.volume_ml, Math.max(0, Math.round(input.residual_ml ?? 0))) : 0
  const residual = ml > 0 ? ml : undefined
  if (!input.photo && residual === undefined) return null
  const { media_id, warning } = await linkMedia(api, admissionId, input.photo && { kind: 'photo', blob: input.photo })
  if (media_id === undefined && residual === undefined) return { reading: null, ...(warning && { warning }) }
  const saved = await api.afterEmptying(reading.id, {
    ...(media_id !== undefined && { media_id }),
    ...(residual !== undefined && { residual_ml: residual }),
  })
  return warning ? { reading: saved, warning } : { reading: saved }
}

// ---------- the bed review's "Bags" section ----------

export interface ReadingRow {
  id: number
  /** "10:00 · Check · 150 mL · +150 mL", then any fall and lateness: the parts below, in this order. */
  text: string
  time: string
  /** `Check`, `Emptied`, `Bag changed`. */
  event: string
  /** "150 mL · +150 mL". */
  change: string
  /** "Level fell from 500 mL": the `Level fell` chip, then "from 500 mL" as plain text. */
  fall: { chip: string; from: string } | null
  /** "Late · 90 min". */
  lateness: string | null
  /** Where a late reading's rise was charted: "charted with 11:00". */
  note: string | null
  fell: boolean
  late: boolean
  /** The reading's photo, then its after-emptying photo. */
  /** `labeled`: the before photo's labeled copy, when one was kept (the viewer opens on it). */
  photos: { media_id: number; label: string; labeled?: MediaRef }[]
  /** "Left in bag 30 mL". */
  residual: string | null
  /** "Saved anyway · same as 11:00" (web/ward "Readings saved anyway"). */
  anyway: string | null
  /** "by Ravi K.". */
  by: string | null
  reading: BagReading
}
export interface PeriodView {
  key: string
  header: string
  /** Not yet closed by an emptying, a bag change or a fall. */
  open: boolean
  rows: ReadingRow[]
}
export interface BagSection {
  container: BagContainer
  title: string
  /** Newest first. */
  periods: PeriodView[]
}

const CLOSED: Record<'emptied' | 'bag_changed', string> = { emptied: 'emptied', bag_changed: 'bag changed' }
const plural = (n: number) => `${n} reading${n === 1 ? '' : 's'}`

/** `08:00 → 12:00: 380 mL (3 readings, emptied 12:00) · 95 mL/h`, `Since 12:00: 150 mL so far (1 reading)`. */
export function periodHeader(p: BagPeriod, now: number): string {
  const n = plural(p.readings.length)
  if (p.end_at === null) {
    const from = p.start_at ? `Since ${when(p.start_at, now)}` : 'Start not known'
    return `${from}: ${p.total_ml} mL so far (${n})`
  }
  const end = when(p.end_at, now)
  const span = p.start_at ? `${when(p.start_at, now)} → ${end}` : `Until ${end}`
  const how = p.closed_by ? `${CLOSED[p.closed_by]} ${end}` : 'then the level fell'
  // A known start with no rate (a period under 15 minutes) shows a dash; an unknown start shows none.
  const rate = p.rate_ml_h !== null ? ` · ${p.rate_ml_h} mL/h` : p.start_at ? ' · — mL/h' : ''
  return `${span}: ${p.total_ml} mL (${n}, ${how})${rate}`
}

const PHOTO_LABEL: Record<BagEvent, [string, string]> = {
  check: ['Photo', 'After photo'],
  emptied: ['Before emptying', 'After emptying'],
  bag_changed: ['Before the change', 'After the change'],
}

/** What a late reading's own entry holds, when that differs from its rise: the rest sits in the next reading's entry. */
function charged(r: BagReading, next: BagReading | undefined, now: number): string | null {
  const ml = r.entry?.volume_ml ?? 0
  if (!r.late || ml === r.rise_ml) return null
  if (ml > r.rise_ml || !next) return `charted ${ml} mL`
  return ml === 0 ? `charted with ${when(next.created_at, now)}` : `charted ${ml} mL, the rest with ${when(next.created_at, now)}`
}

/** `Saved anyway · same as 11:00`: the time of the reading it repeats, found among `readings`. */
function anywayText(r: BagReading, readings: readonly BagReading[], now: number): string | null {
  if (r.confirmed_duplicate_of === null) return null
  const of = readings.find((x) => x.id === r.confirmed_duplicate_of)
  return of ? `Saved anyway · same as ${when(of.created_at, now)}` : 'Saved anyway'
}

/** `readings`: where to find the reading one saved anyway repeats (its period's, then its bag's). */
export function readingRow(r: BagReading, next: BagReading | undefined, now: number, readings: readonly BagReading[] = []): ReadingRow {
  const time = when(r.created_at, now)
  const event = BAG_EVENT_LABEL[r.event]
  const change = `${r.volume_ml} mL · +${r.rise_ml} mL`
  const fall = r.fell ? { chip: 'Level fell', from: `from ${r.fell_from_ml} mL` } : null
  const lateness = r.late ? `Late · ${lateText(r)}` : null
  const note = charged(r, next, now)
  const [before, after] = PHOTO_LABEL[r.event]
  const anyway = anywayText(r, readings, now)
  return {
    id: r.id,
    text: [time, event, change, fall && `${fall.chip} ${fall.from}`, lateness, note, anyway].filter(Boolean).join(' · '),
    time,
    event,
    change,
    fall,
    lateness,
    note,
    fell: r.fell,
    late: r.late,
    photos: [
      ...(r.media?.kind === 'photo' ? [{ media_id: r.media.id, label: before, ...(r.labeled_media && { labeled: r.labeled_media }) }] : []),
      ...(r.proof_media?.kind === 'photo' ? [{ media_id: r.proof_media.id, label: after }] : []),
    ],
    residual: r.residual_ml === null ? null : `Left in bag ${r.residual_ml} mL`,
    anyway,
    by: r.created_by ? `by ${shortName(r.created_by.name)}` : null,
    reading: r,
  }
}

/** One section per bag with a reading, in BAG_CONTAINERS order; empty when the bed has none (no section shown). */
export function bagSections(bags: BagChart, now: number): BagSection[] {
  return BAG_CONTAINERS.flatMap((container) => {
    const periods = bags.periods.filter((p) => p.container === container)
    if (!periods.length) return []
    const all = readingsOf(bags, container)
    const nextOf = (r: BagReading) => all[all.indexOf(r) + 1]
    return [
      {
        container,
        title: BAG_NAME[container],
        periods: periods.map((p) => ({
          key: `${container}:${p.readings[0]?.id ?? 0}`,
          header: periodHeader(p, now),
          open: p.end_at === null,
          rows: p.readings.map((r) => readingRow(r, nextOf(r), now, [...p.readings, ...all])),
        })),
      },
    ]
  })
}

// ---------- missed emptying (nurses and matrons) ----------

export interface MissedForm {
  container: BagContainer
  /** Starts at the level it fell from. */
  level: number
  floor: number
  /** The open window, ms: after the previous reading (or 24 h ago, or the admission), before the fall. */
  from: number
  to: number
  now: number
}

export function missedForm(fall: Fall, now: number, admittedAt: string): MissedForm {
  const floor = fall.reading.fell_from_ml ?? 0
  const prev = fall.prev_at === null ? -Infinity : Date.parse(fall.prev_at)
  return {
    container: fall.reading.container,
    level: floor,
    floor,
    from: Math.max(prev, now - DAY_MS, Date.parse(admittedAt)),
    to: t(fall.reading),
    now,
  }
}

/** The request for a time of day and a level, on the one date that puts the time inside the window; or why not. */
export function missedSubmit(form: MissedForm, hhmm: string, level: number): { input: BagReadingInput } | { error: string } {
  if (!Number.isInteger(level) || level < form.floor) return { error: `Below ${form.floor} mL, the level it fell from` }
  if (level > BAG_MAX_ML) return { error: `At most ${BAG_MAX_ML} mL` }
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm)
  if (!m) return { error: 'Pick a time' }
  const end = new Date(form.to)
  // The window is under 24 h, so the time falls on the fall's date or the day before, if on either.
  const at = [0, 1]
    .map((back) => new Date(end.getFullYear(), end.getMonth(), end.getDate() - back, Number(m[1]), Number(m[2])).getTime())
    .find((x) => x > form.from && x < form.to)
  if (at === undefined) return { error: `Between ${when(form.from, form.now)} and ${when(form.to, form.now)}` }
  return {
    input: { container: form.container, event: 'emptied', volume_ml: level, source: 'manual', charted_at: new Date(at).toISOString() },
  }
}
