/**
 * Ward round: bulk capture across beds, from every source kind. DOM-free (QR text comes in already decoded).
 *
 *   bed card photo    ─► current bed (no model request)
 *   other photo       ─► reading for the current bed ┐
 *   recording         ─► reading for the current bed ┴► read one at a time, once each, in order
 *   import (gallery)  ─► the same, in the order given, but waiting for "Read n · k model requests"
 *
 * A failed read is only re-sent when the user taps Retry; nothing here retries on its own.
 */
import {
  AUTO_CONFIRM_CONFIDENCE,
  emptiedByDefault,
  readingInterval,
  type AdmissionSummary,
  type BagDuplicate,
  type BagEvent,
  type BagReadingInput,
  type CaptureReadResult,
  type CareOrder,
  type Entry,
  type NoteResult,
  type OutputDevices,
  type PhotoEvidence,
  type ReadingInterval,
  type Segmentation,
  type SourceKind,
  type UrineColour,
} from '@meniscus/shared'
import type { Api, Refusal } from './api.ts'
import { errorText, refusalOf } from './api.ts'
import { PhotoTooLargeError, photoErrorText } from './photo.ts'
import { bagContainer, bagMismatch, draftFromRead, saveAnyway, trySaveBag, type BagOutcome } from './bags.ts'
import {
  alreadyLinked,
  canSave,
  decideRead,
  levelContainer,
  noteDrafts,
  readStamp,
  saveEntry,
  saveLevel,
  refusalView,
  type Pending,
  type ReadStamp,
  type SaveResult,
} from './capture.ts'
import { toEvidence } from './evidence.ts'
import { requestsFor, sourceOfFile } from './sources.ts'
import { withColour } from './urine.ts'

export interface RoundBed {
  id: number
  bed: string
  patient: string
  qr_token: string
  ward_id: number
  ward_code: string
  /** The bed's bag reading interval, a catheter order's included; absent: the ward default. */
  interval?: ReadingInterval
  /** The bed's devices, from the round's ward list; absent for a bed outside it (no warning then). */
  devices?: OutputDevices
}

/** A ward-list item as a round bed, its interval from its active catheter order (`care.orders`). */
export function roundBed(
  a: Pick<AdmissionSummary, 'id' | 'bed' | 'patient' | 'qr_token' | 'ward_id' | 'ward_code' | 'care'> &
    Partial<Pick<AdmissionSummary, 'devices'>>,
): RoundBed {
  const catheter = a.care.orders.find((o): o is CareOrder<'catheter'> => o.kind === 'catheter' && o.end_at === null)
  return {
    id: a.id,
    bed: a.bed,
    patient: a.patient,
    qr_token: a.qr_token,
    ward_id: a.ward_id,
    ward_code: a.ward_code,
    interval: readingInterval(a, catheter?.value ?? null),
    ...(a.devices && { devices: a.devices }),
  }
}

/**
 * A bag photo reading of a bag not in its bed's `devices.bags` (web/ward-round "Bag readings on beds without the bag"):
 * `No catheter on the care plan: saving asks the nurse to review.` Null otherwise. It saves as any bag reading.
 */
export function bagWarning(r: Pick<Reading, 'bed' | 'result'>): string | null {
  const bag = r.result ? bagContainer(r.result.reading) : null
  return bag && r.bed.devices ? (bagMismatch(bag, r.bed.devices)?.round ?? null) : null
}
const intervalOf = (bed: RoundBed): ReadingInterval => bed.interval ?? readingInterval(bed, null)

/** The ward a round was started for: its beds make the progress grid. */
export interface RoundWard {
  id: number
  code: string
  name: string
  beds: RoundBed[]
}

/** Mean liquid colour of a photo (browser canvas); injected so this module stays DOM-free. */
export type SampleColour = (photo: Blob, seg: Segmentation | null) => Promise<string | null>

/** `waiting`: imported, read only once the user taps Read. */
export type ReadingStatus = 'waiting' | 'queued' | 'reading' | 'ready' | 'failed' | 'saved'

/** What a reading was captured from. Video would be one more member here. */
export type RoundSource = { kind: 'photo'; blob: Blob } | { kind: 'voice'; blob: Blob; duration_ms: number | null }

/** One draft of a recording, with its index in the model's order (kept when another draft is dropped). */
export type VoiceDraft = Pending & { index: number }

export interface Reading {
  id: number
  bed: RoundBed
  source: RoundSource
  status: ReadingStatus
  /** Photo: volume shown to the user; starts at the model's reading. */
  volume_ml: number | null
  /** Photo: the read. */
  result?: CaptureReadResult
  /** Photo: built from the read (with the sampled liquid colour); sent with the save. */
  evidence?: PhotoEvidence
  /**
   * Recording: the note's read and one draft per entry it found. `saved` holds the indexes of drafts already saved (or
   * already linked), and `entries` what those posts returned, so saving again posts only the rest.
   */
  voice?: { result: NoteResult; drafts: VoiceDraft[]; saved: number[]; entries: Entry[] }
  /** Bag photo: the event picked on it, starting at `emptied` when the bed's interval is 4 h or more, else `check`. */
  bag?: { event: BagEvent }
  /** Bag photo: the save answered 409 `duplicate_reading` with this reading; left for "Save anyway" (never resent on its own). */
  duplicate?: BagDuplicate
  /** With `duplicate`: the first attempt's body (its `media_id` and `read_id`), resent by "Save anyway". */
  resend?: BagReadingInput
  /** The read behind it; `send` is fixed at the first save attempt and kept for retries. */
  read?: ReadStamp
  error?: string
  /** A read refused by the server's request budget (0 model requests): Retry stays disabled until `until`. */
  refusal?: Refusal
  saved?: SaveResult
}

/** The failed reading's Retry: disabled until a refusal's `Retry-After` time; a tap is still needed after it. */
export function retryView(r: Reading, now: number): { label: string; disabled: boolean } {
  if (!r.refusal) return { label: 'Retry', disabled: false }
  const v = refusalView(r.refusal, now).readAgain
  return { label: v.disabled ? v.label.replace('Read again', 'Retry') : 'Retry', disabled: v.disabled }
}

export interface RoundState {
  current: RoundBed | null
  readings: Reading[]
  fast: boolean
  ward: RoundWard | null
  /** Admission ids of the round's ward whose card was scanned. */
  visited: number[]
}

export type PhotoOutcome = 'bed' | 'other_ward' | 'reading' | 'foreign_qr' | 'unknown_bed' | 'no_bed'
export type ImportOutcome = Exclude<PhotoOutcome, 'reading'> | 'waiting' | 'unsupported' | 'unreadable' | 'too_large'
export interface ImportResult {
  name: string
  kind: SourceKind | null
  outcome: ImportOutcome
}

const TOKEN = /\/a\/bed\/([A-Za-z0-9_-]{16,})\/?$/

/** Token of a Meniscus bed link (any origin, since cards may be printed from another host), else null. */
export function parseBedToken(text: string): string | null {
  try {
    const m = TOKEN.exec(new URL(text.trim()).pathname)
    return m ? decodeURIComponent(m[1]!) : null
  } catch {
    return null
  }
}

/** A high-confidence photo reading with something to save. Recordings, and readings refused as a repeat, are reviewed one by one. */
export const autoSavable = (r: Reading) =>
  r.source.kind === 'photo' &&
  r.status === 'ready' &&
  !r.duplicate &&
  !!r.result &&
  r.result.reading.confidence >= AUTO_CONFIRM_CONFIDENCE &&
  r.volume_ml !== null &&
  (!!r.result.draft || !!levelContainer(r.result.reading) || !!bagContainer(r.result.reading))

/** Readings waiting for the Read tap, as kinds. */
const waitingKinds = (s: RoundState) => s.readings.filter((r) => r.status === 'waiting').map((r) => r.source.kind)

/**
 * "Read 5 · 13 model requests" for the imported readings, or null when none wait. k is the most the reads can make:
 * each photo makes 3 in `sam+spark` mode or 1 in `spark` (its response says which), each recording 2, and a refused
 * read 0.
 */
export function readLabel(s: RoundState): string | null {
  const kinds = waitingKinds(s)
  if (!kinds.length) return null
  const k = requestsFor(kinds, s.fast)
  return `Read ${kinds.length} · ${k} model request${k === 1 ? '' : 's'}`
}

export class Round {
  #state: RoundState
  #listeners = new Set<() => void>()
  #nextId = 1
  #pumping: Promise<void> | null = null
  #sampleColour: SampleColour | undefined
  #prepare: (photo: Blob) => Promise<Blob>
  #now: () => number

  private readonly api: Api

  constructor(
    api: Api,
    /** `prepare` shrinks an imported photo before it is decoded and kept (browser canvas). `now`: the device clock. */
    opts: { fast?: boolean; sampleColour?: SampleColour; prepare?: (photo: Blob) => Promise<Blob>; now?: () => number } = {},
  ) {
    this.api = api
    this.#sampleColour = opts.sampleColour
    this.#prepare = opts.prepare ?? ((b) => Promise.resolve(b))
    this.#now = opts.now ?? Date.now
    this.#state = { current: null, readings: [], fast: opts.fast ?? false, ward: null, visited: [] }
  }

  subscribe = (fn: () => void) => {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }
  getState = () => this.#state

  #set(next: Partial<RoundState>) {
    this.#state = { ...this.#state, ...next }
    for (const fn of this.#listeners) fn()
  }
  #patch(id: number, patch: Partial<Reading>) {
    this.#set({ readings: this.#state.readings.map((r) => (r.id === id ? { ...r, ...patch } : r)) })
  }
  #reading = (id: number) => this.#state.readings.find((x) => x.id === id)

  setFast(fast: boolean) {
    this.#set({ fast })
  }

  /** Scope the round to a ward (progress grid); null for a round without one. */
  setWard(ward: RoundWard | null) {
    this.#set({ ward, visited: [] })
  }

  #add(source: RoundSource, status: 'queued' | 'waiting') {
    const bed = this.#state.current!
    this.#set({ readings: [...this.#state.readings, { id: this.#nextId++, bed, source, status, volume_ml: null }] })
  }

  /** One photo of the round, read at once. `qrText` is the decoded QR content, if any. */
  async onPhoto(photo: Blob, qrText: string | null): Promise<PhotoOutcome> {
    const card = await this.#card(qrText)
    if (card) return card
    if (!this.#state.current) return 'no_bed'
    this.#add({ kind: 'photo', blob: photo }, 'queued')
    void this.#pump()
    return 'reading'
  }

  /** A recording made at the current bed, read at once (one voice-note request); none without a bed. */
  onRecording(blob: Blob, durationMs: number | null): 'reading' | 'no_bed' {
    if (!this.#state.current) return 'no_bed'
    this.#add({ kind: 'voice', blob, duration_ms: durationMs }, 'queued')
    void this.#pump()
    return 'reading'
  }

  /**
   * Gallery import, in the order given. A photo with a QR code is a bed card (or reported), never read; every other photo
   * or recording joins the bed current at that point and waits for `readWaiting`. Makes no model request.
   */
  async import(files: File[], decodeQr: (photo: Blob) => Promise<string | null>): Promise<ImportResult[]> {
    const out: ImportResult[] = []
    for (const file of files) {
      const kind = sourceOfFile(file)
      const report = (outcome: ImportOutcome) => out.push({ name: file.name, kind, outcome })
      if (kind === 'voice') {
        if (!this.#state.current) report('no_bed')
        else {
          this.#add({ kind: 'voice', blob: file, duration_ms: null }, 'waiting')
          report('waiting')
        }
      } else if (kind === 'photo') {
        let photo: Blob
        let qr: string | null
        try {
          photo = await this.#prepare(file)
          qr = await decodeQr(photo)
        } catch (err) {
          // Still over the photo cap after shrinking: skipped, never sent.
          report(err instanceof PhotoTooLargeError ? 'too_large' : 'unreadable')
          continue
        }
        const card = await this.#card(qr)
        if (card) report(card)
        else if (!this.#state.current) report('no_bed')
        else {
          this.#add({ kind: 'photo', blob: photo }, 'waiting')
          report('waiting')
        }
      } else report('unsupported')
    }
    return out
  }

  /** The user tapped Read: every waiting reading is read once, one at a time, in order. */
  readWaiting() {
    if (!this.#state.readings.some((r) => r.status === 'waiting')) return
    this.#set({ readings: this.#state.readings.map((r) => (r.status === 'waiting' ? { ...r, status: 'queued' } : r)) })
    void this.#pump()
  }

  /** The most model requests the waiting readings can make: 3 per photo (1 in fast mode), 2 per recording; fewer when a read runs in `spark` mode or is refused. */
  waitingRequests(): number {
    return requestsFor(waitingKinds(this.#state), this.#state.fast)
  }

  /** A bed card switches the bed (or is reported); null when there is no QR code. */
  async #card(qrText: string | null): Promise<Exclude<PhotoOutcome, 'reading' | 'no_bed'> | null> {
    if (qrText !== null) {
      const token = parseBedToken(qrText)
      if (!token) return 'foreign_qr'
      try {
        const a = await this.api.bed(token)
        const { ward, visited } = this.#state
        // A bed of the round's ward keeps its interval from the ward list; one from elsewhere has no care: its ward default.
        const listed = ward?.beds.find((b) => b.id === a.id)
        const current: RoundBed = {
          id: a.id,
          bed: a.bed,
          patient: a.patient,
          qr_token: a.qr_token,
          ward_id: a.ward_id,
          ward_code: a.ward_code,
          interval: listed?.interval ?? readingInterval(a, null),
          ...(listed?.devices && { devices: listed.devices }),
        }
        if (ward && a.ward_id !== ward.id) {
          this.#set({ current })
          return 'other_ward'
        }
        this.#set({ current, visited: ward && !visited.includes(a.id) ? [...visited, a.id] : visited })
        return 'bed'
      } catch {
        return 'unknown_bed'
      }
    }
    return null
  }

  /** User tapped Retry on a failed reading: queue it once more. A refused one only from its `Retry-After` time. */
  retry(id: number) {
    const r = this.#state.readings.find((x) => x.id === id)
    if (r?.status !== 'failed' || retryView(r, this.#now()).disabled) return
    this.#patch(id, { status: 'queued', error: undefined, refusal: undefined })
    void this.#pump()
  }

  discard(id: number) {
    this.#set({ readings: this.#state.readings.filter((r) => r.id !== id || r.status === 'reading') })
  }

  setVolume(id: number, volume_ml: number) {
    this.#patch(id, { volume_ml })
  }

  /** Bag photo: the event it is saved with (one choice of Check, Emptied and Bag changed). */
  setBagEvent(id: number, event: BagEvent) {
    const r = this.#reading(id)
    if (r?.bag) this.#patch(id, { bag: { event } })
  }

  /** Recording: change one draft's volume. */
  setDraftVolume(id: number, index: number, volume_ml: number) {
    const r = this.#state.readings.find((x) => x.id === id)
    if (!r?.voice) return
    const drafts = r.voice.drafts.map((d, i) => (i === index ? { ...d, draft: { ...d.draft, volume_ml } } : d))
    this.#patch(id, { voice: { ...r.voice, drafts } })
  }

  /** Recording: leave one draft out of the save. */
  dropDraft(id: number, index: number) {
    const r = this.#state.readings.find((x) => x.id === id)
    if (!r?.voice) return
    this.#patch(id, { voice: { ...r.voice, drafts: r.voice.drafts.filter((_, i) => i !== index) } })
  }

  /** Staff picked a urine colour: it replaces the read one (and drops the photo colour) in the draft that is saved. */
  setColour(id: number, colour: UrineColour) {
    const r = this.#state.readings.find((x) => x.id === id)
    const draft = r?.result?.draft
    if (!r?.result || draft?.category !== 'urine') return
    this.#patch(id, { result: { ...r.result, draft: withColour(draft, colour) } })
  }

  /** Resolves when no reading is queued or in flight. */
  idle(): Promise<void> {
    return this.#pumping ?? Promise.resolve()
  }

  /** Single worker: reads queued readings one at a time, in capture order: one read request each. */
  #pump(): Promise<void> {
    this.#pumping ??= (async () => {
      for (let next = this.#first(); next; next = this.#first()) {
        this.#patch(next.id, { status: 'reading' })
        try {
          if (next.source.kind === 'voice') {
            // One voice-note request: speech-to-text, then Spark (2 model requests). No read mode. The bed is named, never sent upstream.
            const result = await this.api.voiceNote(next.source.blob, next.bed.id)
            const at = this.#now()
            const drafts = noteDrafts(result, 'voice', result.transcript ?? '', at).map((d, index): VoiceDraft => ({ ...d, index }))
            const read = readStamp(result, 0, at)
            this.#patch(next.id, { status: 'ready', voice: { result, drafts, saved: [], entries: [] }, ...(read && { read }) })
            continue
          }
          const photo = next.source.blob
          const result = await this.api.read(photo, { mode: this.#state.fast ? 'spark' : undefined, admissionId: next.bed.id })
          const read = readStamp(result, 0, this.#now())
          // Colour is best effort and local (canvas); a failure only leaves it out.
          const colour = this.#sampleColour ? await this.#sampleColour(photo, result.segmentation).catch(() => null) : null
          const bag = bagContainer(result.reading) && !levelContainer(result.reading)
          this.#patch(next.id, {
            status: 'ready',
            result,
            evidence: toEvidence(result, colour),
            volume_ml: result.reading.volume_ml ?? result.draft?.volume_ml ?? null,
            ...(read && { read }),
            ...(bag && { bag: { event: emptiedByDefault(intervalOf(next.bed)) ? 'emptied' : 'check' } }),
          })
        } catch (err) {
          // A budget refusal sent nothing upstream; its Retry waits for the refusal's time and a tap.
          const refusal = refusalOf(err, this.#now())
          this.#patch(next.id, {
            status: 'failed',
            error: refusal ? refusalView(refusal, this.#now()).text : next.source.kind === 'voice' ? errorText(err) : photoErrorText(err),
            ...(refusal && { refusal }),
          })
        }
      }
    })().finally(() => {
      this.#pumping = null
    })
    return this.#pumping
  }
  #first = () => this.#state.readings.find((r) => r.status === 'queued')

  /**
   * Save one ready reading: the photo, then the level for jugs and bottles, the bag reading for bags (with the event
   * picked on it; a 409 `duplicate_reading` leaves it ready with `duplicate` set, null returned), or the entry. Whether the save carries the read is
   * decided at the first attempt and kept for retries; a retry answered `already linked` counts as saved.
   */
  async save(id: number): Promise<SaveResult | null> {
    const found = this.#reading(id)
    if (found?.status !== 'ready' || found.duplicate) return null
    const read = decideRead(found.read, this.#now())
    if (read !== found.read) this.#patch(id, { read })
    const r = { ...found, ...(read && { read }) }
    if (r.source.kind === 'voice') return this.#saveVoice(r, r.source)
    if (!r.result || r.volume_ml === null) return null
    const { reading, draft } = r.result
    const container = levelContainer(reading)
    const photo = { kind: 'photo' as const, blob: r.source.blob }
    const bag = r.evidence ? draftFromRead(r.result, r.evidence, r.bed) : null
    if (!container && !bag && !draft) return null
    let saved: SaveResult
    try {
      if (container) saved = await saveLevel(this.api, r.bed.id, container, r.volume_ml, reading.confidence, photo, r.evidence, read)
      else if (bag) {
        const event = r.bag?.event ?? (bag.emptied ? 'emptied' : 'check')
        const d = { ...bag, volume_ml: r.volume_ml, read, emptied: event === 'emptied', changed: event === 'bag_changed' }
        return this.#bagOutcome(id, await trySaveBag(this.api, r.bed.id, d, photo))
      } else
        saved = await saveEntry(
          this.api,
          r.bed.id,
          {
            draft: { ...draft!, volume_ml: r.volume_ml },
            source: 'photo',
            confidence: reading.confidence,
            evidence: r.evidence,
            ...(read && { read }),
          },
          photo,
        )
    } catch (err) {
      // An earlier attempt reached the server and only its answer was lost.
      if (!alreadyLinked(err)) throw err
      saved = { entry: null }
    }
    this.#patch(id, { status: 'saved', saved })
    return saved
  }

  /** "Save anyway" on a reading refused as a repeat: the same body once, confirming the shown reading; no new upload. */
  async saveAnyway(id: number): Promise<SaveResult | null> {
    const r = this.#reading(id)
    if (r?.status !== 'ready' || !r.duplicate || !r.resend) return null
    return this.#bagOutcome(id, await saveAnyway(this.api, r.bed.id, { duplicate: r.duplicate, resend: r.resend }))
  }

  #bagOutcome(id: number, o: BagOutcome): SaveResult | null {
    if ('duplicate' in o) {
      this.#patch(id, { duplicate: o.duplicate, resend: o.resend })
      return null
    }
    const saved: SaveResult = { entry: o.saved.result.entry, bag: o.saved.result, ...(o.saved.warning && { warning: o.saved.warning }) }
    this.#patch(id, { status: 'saved', saved, duplicate: undefined, resend: undefined })
    return saved
  }

  /**
   * A recording: one entry per kept draft, one after another; the first uploads the recording, the rest reuse it. Each
   * draft is marked saved as its post lands, so after a failure, saving again posts only the drafts not yet saved.
   */
  async #saveVoice(r: Reading, source: Extract<RoundSource, { kind: 'voice' }>): Promise<SaveResult | null> {
    const voice = r.voice
    if (!voice) return null
    const send = r.read?.send
    const todo = voice.drafts.filter((d) => canSave(d) && !voice.saved.includes(d.index))
    if (!todo.length && !voice.saved.length) return null
    const recording = { kind: 'voice' as const, blob: source.blob, duration_ms: source.duration_ms ?? voice.result.duration_ms ?? null }
    let warning: string | undefined
    /** Marks one draft saved (with its entry, unless the post was refused as already linked) on the reading as it now stands. */
    const mark = (index: number, entry: Entry | null) => {
      const v = this.#reading(r.id)?.voice
      if (v) this.#patch(r.id, { voice: { ...v, saved: [...v.saved, index], entries: entry ? [...v.entries, entry] : v.entries } })
    }
    for (const d of todo) {
      // Every draft of the recording shares the reading's one decision.
      const p: Pending = d.read ? { ...d, read: { ...d.read, ...(send !== undefined && { send }) } } : d
      try {
        const s = await saveEntry(this.api, r.bed.id, p, recording)
        mark(d.index, s.entry)
        warning ??= s.warning
      } catch (err) {
        if (!alreadyLinked(err)) throw err
        mark(d.index, null)
      }
    }
    const entries = this.#reading(r.id)?.voice?.entries ?? []
    const saved: SaveResult = { entry: entries[0] ?? null, entries, ...(warning && { warning }) }
    this.#patch(r.id, { status: 'saved', saved })
    return saved
  }

  /** Saves every high-confidence reading, one after another; returns how many were saved. */
  async saveHighConfidence(): Promise<number> {
    let n = 0
    for (const r of this.#state.readings.filter(autoSavable)) if (await this.save(r.id)) n++
    return n
  }
}
