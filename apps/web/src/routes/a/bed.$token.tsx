import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import {
  BAG_CAPACITY_ML,
  BAG_MAX_ML,
  ENTRY_CATEGORIES,
  type BagReadingResult,
  type CaptureReadResult,
  type DraftEntry,
  type Entry,
  type EntryCategory,
  type LevelContainer,
  type PhotoEvidence,
  type ServedTray,
  type TranscriptTurn,
} from '@meniscus/shared'
import { AddDevice } from '../../components/add-device.tsx'
import { useStaff } from '../../lib/use-staff.ts'
import { Button } from '../../components/button.tsx'
import { NoPhoto } from '../../components/no-photo.tsx'
import { CareBadges } from '../../components/care-badges.tsx'
import { DrinkIcon } from '../../components/drink-label.tsx'
import { checkTitle, drinkTitle, offersDrinkPicker, withDrink } from '../../lib/drinks.ts'
import { UrineSwatch } from '../../components/urine-swatch.tsx'
import { CameraIcon, CheckIcon, ClockIcon, DropIcon, MealIcon, MicIcon, PencilIcon, StopIcon } from '../../components/icons.tsx'
import { AcuityMark, BedBadge, Chip, Direction, Notice, Reserve, Section, Stepper, ConfidenceChip } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { f } from '../../components/form.styles.ts'
import { ACUITY_LABEL, ALERT_LABEL, ALERT_TONE, BAG_NAME, CATEGORY_LABEL as SHORT_LABEL, SOURCE_LABEL } from '../../lib/labels.ts'
import { api, errorText, refusalOf, type Refusal } from '../../lib/api.ts'
import {
  bagMismatch,
  bagOfCategory,
  byHandCategory,
  byHandDraft,
  discardedText,
  draftFromRead,
  duplicateText,
  emptiedDefault,
  saveAnyway,
  savedHead,
  savedText,
  trySaveBag,
  type BagDraft,
  type BagOutcome,
  type BagRefused,
} from '../../lib/bags.ts'
import {
  hintsFor,
  photoTileHint,
  unmeasuredLine,
  type Hint,
  canSave,
  decidePending,
  decideRead,
  levelContainer,
  noteDrafts,
  photoDraft,
  readStamp,
  refusalView,
  saveEntry,
  saveLevel,
  type Pending,
  type ReadStamp,
} from '../../lib/capture.ts'
import {
  bedScreenLoad,
  mayOrder,
  consistencyDefault,
  nbmWarning,
  saveLabel,
  seedConsistency,
  thinnerNotice,
  withCategory,
} from '../../lib/care.ts'
import { readSummary, toEvidence } from '../../lib/evidence.ts'
import { chartedAt, saveByHand } from '../../lib/resolve.ts'
import { COPY_NOT_KEPT, type MediaSource } from '../../lib/media.ts'
import { photoErrorText, sampleColour, shrinkPhoto } from '../../lib/photo.ts'
import { entrySwatch, seenSwatch, swatchOf, withColour } from '../../lib/urine.ts'
import { startRecording, type Recording } from '../../lib/recorder.ts'
import { RecordingStatus } from '../../components/recording-status.tsx'
import { holdUnsaved } from '../../lib/unsaved.ts'
import { useNow } from '../../lib/use-access.ts'
import { useResource } from '../../lib/use-resource.ts'
import { color, radius, space, text, weight } from '../../tokens.stylex.ts'
import { bagSaveLabel, controlGroups, deviceLine, vitalsLine } from '../../lib/attendant.ts'
import { entryRow } from '../../lib/rows.ts'
import { failureGoesTo, flash as showToast } from '../../lib/toast.ts'
import { lazyPart } from '../../lib/lazy-part.ts'

// Loads on first use, keeping it out of the capture bundle.
// The photo viewer and audio player load with the first capture reviewed.
const CapturedSource = lazy(() => import('../../components/source-view.tsx').then((m) => ({ default: m.CapturedSource })))
const MealForm = lazy(() => import('../../components/meal-form.tsx').then((m) => ({ default: m.MealForm })))
// The check screen's fields: one chunk, started once the bed screen is up, so a read's answer never waits on it.
const loadCheck = () => import('../../components/check-fields.ts')
const AfterEmptyingStep = lazyPart(loadCheck, 'AfterEmptyingStep')
const BagEventFields = lazyPart(loadCheck, 'BagEventFields')
const ChoiceChips = lazyPart(loadCheck, 'ChoiceChips')
const ConsistencyField = lazyPart(loadCheck, 'ConsistencyField')
const DrinkPicker = lazyPart(loadCheck, 'DrinkPicker')
const DuplicatePanel = lazyPart(loadCheck, 'DuplicatePanel')
const Gauge = lazyPart(loadCheck, 'Gauge')
const PhotoButton = lazyPart(loadCheck, 'PhotoButton')
const SwitchField = lazyPart(loadCheck, 'SwitchField')
const UrineColourPicker = lazyPart(loadCheck, 'UrineColourPicker')
const WhenField = lazyPart(loadCheck, 'WhenField')

export const Route = createFileRoute('/a/bed/$token')({
  staticData: { title: 'Capture' },
  component: BedCapture,
})

const CATEGORY_LABEL: Record<EntryCategory, string> = {
  water: 'Drink (in)',
  food: 'Food (in)',
  iv: 'IV (in)',
  urine: 'Urine (out)',
  stoma: 'Stoma (out)',
  drain: 'Drain (out)',
  vomit: 'Vomit (out)',
}

type Level = {
  container: LevelContainer
  volume: number
  confidence: number | null
  evidence: PhotoEvidence
  /** The jug's read; decided at the first save attempt and kept for a retry. */
  read?: ReadStamp | undefined
}
type Review = {
  items: Pending[]
  /** The photo read behind this review, for the overlay and the summary line. */
  read?: CaptureReadResult
  level?: Level
  /** A bag read: saved as a bag reading, not an entry. */
  bag?: BagDraft
  photo?: Blob
  /** The voice note behind this review: kept with each of its entries (one upload). */
  recording?: { blob: Blob; duration_ms: number | null }
  /** Its timed turns, for the player. */
  turns?: TranscriptTurn[]
  warnings: string[]
  transcript?: string
  reply?: string | null
}
/** "Bag level" on the by-hand form: the event and an optional photo (logged, not read). Null while off. */
type ByHandBag = { emptied: boolean; changed: boolean; photo: Blob | null }
type Phase =
  | { k: 'idle' }
  | { k: 'recording'; rec: Recording }
  | { k: 'busy'; what: string }
  /** `served`: the one served-tray lookup, sent when Meal was tapped (null when it failed; never resent). */
  | { k: 'meal'; served: Promise<ServedTray | null> }
  | ({ k: 'review' } & Review)
  /** A bag reading was saved: the after-emptying step. */
  | { k: 'bag-saved'; saved: BagReadingResult }
  /** A bag reading answered 409 `duplicate_reading`: "Save anyway" or "Discard"; nothing more is sent until a tap. */
  | { k: 'bag-duplicate'; refused: BagRefused; busy: boolean }
  /** The server's request budget refused the read: the photo, recording or note is kept, and read again only on a tap. */
  | { k: 'refused'; refusal: Refusal; source: Refused }
/** What a refused read was of, kept so Read again sends the same bytes. */
type Refused = { kind: 'photo'; photo: Blob } | { kind: 'voice'; audio: Blob; duration_ms: number | null } | { kind: 'text'; text: string }

/** The device clock when a read answered (event handlers only; a draft's read is linked while young, see decideRead). */
const answeredAt = () => Date.now()

const describe = (e: Pick<Entry, 'category' | 'volume_ml'>) => `${e.volume_ml} mL ${SHORT_LABEL[e.category].toLowerCase()}`

function BedCapture() {
  const { token } = Route.useParams()
  const bed = useResource(`bed:${token}`, bedScreenLoad(api, token))
  const [phase, setPhase] = useState<Phase>({ k: 'idle' })
  const staff = useStaff()
  const [hint, setHint] = useState<Hint>('')
  const [noteText, setNoteText] = useState('')
  /** Enter by hand: null is now; "HH:MM" is earlier (a late entry). */
  const [when, setWhen] = useState<string | null>(null)
  const [byHandBag, setByHandBag] = useState<ByHandBag | null>(null)
  const [inline, setInline] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null)
  /** Results go to the one toast; a refusal about what was sent, or a device problem, stays inline here. */
  const setFlash = (f: { tone: 'ok' | 'warn' | 'danger'; text: string } | null, err?: unknown) => {
    if (f && (f.tone !== 'danger' || (err !== undefined && failureGoesTo(err) === 'toast'))) {
      setInline(null)
      showToast(f)
    } else setInline(f)
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const recRef = useRef<Recording | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  /** False once the screen is gone; a microphone prompt answered after that must not start a recording. */
  const mountedRef = useRef(false)
  /** True while waiting for the microphone, so a second tap cannot start a second recording. */
  const startingRef = useRef(false)
  // A draft (to check and save), a recording, a read in flight or a typed note is unsaved work: "Switch user" asks first.
  const unsaved = phase.k !== 'idle' || noteText.trim() !== ''
  // While refused, re-reads the clock each second so Read again enables at its time. It only re-renders: no request.
  const tick = useNow(phase.k === 'refused' ? 1000 : 3_600_000)
  useEffect(() => (unsaved ? holdUnsaved() : undefined), [unsaved])
  // Code only, no data: the check screen's fields load after the first paint.
  useEffect(() => void loadCheck(), [])
  // Leaving the screen mid-recording drops the audio: nothing is sent later by the 1:00 auto-stop.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const rec = recRef.current
      recRef.current = null
      rec?.cancel()
    }
  }, [])

  if (bed.error) {
    return (
      <div {...stylex.props(ui.stack)}>
        <Notice tone="danger">{errorText(bed.error)}</Notice>
        <Button nativeButton={false} render={<Link to="/a" />}>
          Pick a bed
        </Button>
      </div>
    )
  }
  if (!bed.data) return <p {...stylex.props(ui.muted)}>Opening bed…</p>
  const { admission, totals, alerts, entries, urine_seen, care, bags, devices, acuity } = bed.data
  // The photo hints follow the bed's devices (web/capture "Capture choices follow the bed's devices").
  const hints = hintsFor(devices)
  /** After "Add catheter": the chart only (one request), as the bed is already known. */
  const refreshChart = async () => bed.set(await api.entries(admission.id))
  /** A water draft entering review starts at the ordered consistency. */
  const seed = (items: Pending[]) => items.map((p) => seedConsistency(p, care))

  const reset = () => {
    setPhase({ k: 'idle' })
  }
  const fail = (err: unknown, source?: Refused) => {
    if (err instanceof DOMException && err.name === 'AbortError') return setPhase({ k: 'idle' })
    // Refused by the request budget: nothing was read. Keep what was captured; Read again waits for its time and a tap.
    const refusal = refusalOf(err, answeredAt())
    if (refusal && source) return setPhase({ k: 'refused', refusal, source })
    // A photo read refused as too large or invalid (413, 400) says so, never a generic failure.
    setFlash({ tone: 'danger', text: source?.kind === 'photo' ? photoErrorText(err) : errorText(err) }, err)
    setPhase({ k: 'idle' })
  }
  const run = async <T,>(what: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const c = new AbortController()
    abortRef.current = c
    setPhase({ k: 'busy', what })
    try {
      return await fn(c.signal)
    } finally {
      abortRef.current = null
    }
  }

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setFlash(null)
    let photo: Blob
    try {
      photo = await shrinkPhoto(file)
    } catch (err) {
      // Over the photo cap after shrinking (or undecodable): nothing is sent.
      setFlash({ tone: 'danger', text: photoErrorText(err) }, err)
      return
    }
    return readPhoto(photo)
  }

  /** One read: 3 model requests in `sam+spark` mode, 1 in `spark` (the response says which), 0 when refused. Never retried automatically. */
  const readPhoto = async (photo: Blob) => {
    setFlash(null)
    try {
      const listed = hints.some((h) => h.value === hint) ? hint : ''
      const r = await run('Reading the photo…', (signal) =>
        api.read(photo, { hint: listed || undefined, admissionId: admission.id }, signal),
      )
      // When the read answered, on this device's clock: a save links it while it is young enough (decideRead).
      const at = answeredAt()
      const container = levelContainer(r.reading)
      const warnings = r.warnings
      // Local canvas read; no network. Best effort: a failure only leaves the colour out.
      const evidence = toEvidence(r, await sampleColour(photo, r.segmentation).catch(() => null))
      if (container) {
        return setPhase({
          k: 'review',
          items: [],
          level: { container, volume: r.reading.volume_ml ?? 0, confidence: r.reading.confidence, evidence, read: readStamp(r, 0, at) },
          read: r,
          photo,
          warnings,
        })
      }
      // A urine, stoma or drain bag with a volume: a bag reading (its rise is charted), never an entry of the whole level.
      const bag = draftFromRead(r, evidence, admission, at, bags)
      if (bag) return setPhase({ k: 'review', items: [], bag, read: r, photo, warnings })
      const draft = photoDraft(r, evidence, at)
      const items = seed(draft ? [draft] : [])
      setPhase({
        k: 'review',
        items,
        read: r,
        photo,
        warnings: r.draft ? warnings : [`Nothing to chart was found (${r.reading.reading_basis}).`, ...warnings],
      })
    } catch (err) {
      fail(err, { kind: 'photo', photo })
    }
  }

  /** Stop and send: 2 model requests (transcription, then parsing). Runs once per recording, by tap or at the 1:00 limit. */
  const finishVoice = async (rec: Recording) => {
    if (recRef.current !== rec) return
    recRef.current = null
    let audio: Blob
    let duration: number | null
    try {
      duration = rec.elapsedMs()
      audio = await rec.stop()
    } catch (err) {
      return fail(err)
    }
    return sendVoice(audio, duration)
  }

  /** 2 model requests (transcription, then parsing), 0 when refused. */
  const sendVoice = async (audio: Blob, duration: number | null) => {
    setFlash(null)
    try {
      const r = await run('Transcribing…', (signal) => api.voiceNote(audio, admission.id, signal))
      setPhase({
        k: 'review',
        items: seed(noteDrafts(r, 'voice', r.transcript ?? '', answeredAt())),
        recording: { blob: audio, duration_ms: r.duration_ms ?? duration },
        turns: r.turns,
        warnings: [],
        transcript: r.transcript,
        reply: r.reply,
      })
    } catch (err) {
      fail(err, { kind: 'voice', audio, duration_ms: duration })
    }
  }

  const onVoice = async () => {
    setFlash(null)
    if (phase.k === 'recording') return finishVoice(phase.rec)
    if (startingRef.current || recRef.current) return
    startingRef.current = true
    try {
      // The auto-stop closes over this recording, not over this render's phase.
      let rec: Recording | null = null
      rec = await startRecording(() => {
        if (rec) void finishVoice(rec)
      })
      // Left the screen while the microphone prompt was open: drop it, send nothing.
      if (!mountedRef.current) return rec.cancel()
      recRef.current = rec
      setPhase({ k: 'recording', rec })
    } catch {
      setFlash({ tone: 'danger', text: 'Microphone not available. Allow microphone access or type the note.' })
    } finally {
      startingRef.current = false
    }
  }

  const onNote = () => {
    const t = noteText.trim()
    if (t) void sendNote(t)
  }

  /** 1 model request, 0 when refused. */
  const sendNote = async (t: string) => {
    setFlash(null)
    try {
      // 1 model request.
      const r = await run('Reading the note…', (signal) => api.note(t, admission.id, signal))
      setNoteText('')
      setPhase({
        k: 'review',
        items: seed(noteDrafts(r, 'text', t, answeredAt())),
        warnings: [],
        reply: r.reply,
      })
    } catch (err) {
      fail(err, { kind: 'text', text: t })
    }
  }

  /** Read again, on a tap only: the same bytes or text as the refused read. */
  const readAgain = (source: Refused) =>
    source.kind === 'photo'
      ? readPhoto(source.photo)
      : source.kind === 'voice'
        ? sendVoice(source.audio, source.duration_ms)
        : sendNote(source.text)

  const now = new Date()
  // A bag reading saved on a bed without that bag: a nurse or matron is offered its order.
  const missing = phase.k === 'bag-saved' ? bagMismatch(phase.saved.reading.container, devices) : null
  const charted = when === null ? null : chartedAt(when, now, admission.admitted_at)
  const whenError = charted && 'error' in charted ? charted.error : null

  const onManual = () => {
    setFlash(null)
    setWhen(null)
    setByHandBag(null)
    setPhase({
      k: 'review',
      items: seed([
        { draft: { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null }, source: 'manual', confidence: null },
      ]),
      warnings: [],
    })
  }

  const updateItem = (i: number, next: Pending) => {
    if (phase.k !== 'review') return
    setPhase({ ...phase, items: phase.items.map((p, j) => (j === i ? next : p)) })
  }
  const dropItem = (i: number) => {
    if (phase.k !== 'review') return
    const items = phase.items.filter((_, j) => j !== i)
    if (!items.length && !phase.level && !phase.bag) return reset()
    setPhase({ ...phase, items })
  }

  const onSaveItem = async (i: number) => {
    if (phase.k !== 'review') return
    const undecided = phase.items[i]
    if (!undecided || !canSave(undecided)) return
    // The first attempt decides whether the read is linked; a retry sends what it sent.
    const p = decidePending(undecided)
    const review = { ...phase, items: phase.items.map((x, j) => (j === i ? p : x)) }
    try {
      // Only the photo's own draft carries the photo; every draft of a voice note carries its recording (uploaded once).
      // Typed in by hand: may be charted for an earlier time; saveByHand refuses a bad time without sending.
      const source: MediaSource | undefined =
        p.source === 'photo' && review.photo
          ? { kind: 'photo', blob: review.photo }
          : p.source === 'voice' && review.recording
            ? { kind: 'voice', ...review.recording }
            : undefined
      const r = await run('Saving…', () =>
        p.source === 'manual' ? saveByHand(api, admission.id, p, charted) : saveEntry(api, admission.id, p, source),
      )
      const savedLine = r.entry ? `Saved ${describe(r.entry)}. Waiting for nurse approval.` : ''
      setFlash({
        tone: r.warning ? 'warn' : 'ok',
        // A copy not kept still saved the entry and its photo: say both.
        text: r.warning === COPY_NOT_KEPT ? `${savedLine} ${COPY_NOT_KEPT}.` : (r.warning ?? savedLine),
      })
      const items = review.items.filter((_, j) => j !== i)
      if (items.length || review.level || review.bag) setPhase({ ...review, items })
      else setPhase({ k: 'idle' })
      bed.reload()
    } catch (err) {
      setPhase(review)
      setFlash({ tone: 'danger', text: errorText(err) }, err)
    }
  }

  /** One bag reading, after its photo's upload; then the after-emptying step. No model request. */
  const onSaveBag = async (undecided: BagDraft, photo: Blob | null | undefined) => {
    if (phase.k !== 'review') return
    const draft = { ...undecided, read: decideRead(undecided.read) }
    const review = phase.bag === undecided ? { ...phase, bag: draft } : phase
    try {
      const o = await run('Saving…', () => trySaveBag(api, admission.id, draft, photo ? { kind: 'photo', blob: photo } : undefined))
      bagOutcome(o)
    } catch (err) {
      setPhase(review)
      setFlash({ tone: 'danger', text: errorText(err) }, err)
    }
  }

  /** Saved: the after-emptying step. Refused as a repeat: the duplicate panel, with the first attempt's body kept. */
  const bagOutcome = (o: BagOutcome) => {
    if ('duplicate' in o) {
      setFlash(null)
      setPhase({ k: 'bag-duplicate', refused: o, busy: false })
      return
    }
    const r = o.saved
    setFlash(
      r.warning
        ? { tone: 'warn', text: `${savedText(r.result)} ${r.warning}${r.warning === COPY_NOT_KEPT ? '.' : ''}` }
        : { tone: 'ok', text: savedText(r.result) },
    )
    setByHandBag(null)
    setPhase({ k: 'bag-saved', saved: r.result })
    bed.reload()
  }

  /** "Save anyway": the same body once, confirming the shown reading. A lost answer leaves the panel for another tap. */
  const onSaveAnyway = async (refused: BagRefused) => {
    setPhase({ k: 'bag-duplicate', refused, busy: true })
    try {
      bagOutcome(await saveAnyway(api, admission.id, refused))
    } catch (err) {
      setPhase({ k: 'bag-duplicate', refused, busy: false })
      setFlash({ tone: 'danger', text: errorText(err) }, err)
    }
  }

  const onSaveLevel = async () => {
    if (phase.k !== 'review' || !phase.level) return
    const level = { ...phase.level, read: decideRead(phase.level.read) }
    const review = { ...phase, level }
    const { container, volume, confidence, evidence, read } = level
    try {
      const r = await run('Saving…', () =>
        saveLevel(api, admission.id, container, volume, confidence, review.photo && { kind: 'photo', blob: review.photo }, evidence, read),
      )
      const name = container.replace('_', ' ')
      setFlash(
        r.warning && r.warning !== COPY_NOT_KEPT
          ? { tone: 'warn', text: r.warning }
          : r.warning
            ? { tone: 'warn', text: `${name[0]!.toUpperCase()}${name.slice(1)} at ${volume} mL saved. ${COPY_NOT_KEPT}.` }
            : r.entry
              ? { tone: 'ok', text: `Drank ${r.entry.volume_ml} mL since the last ${name} reading. Waiting for nurse approval.` }
              : { tone: 'ok', text: `${name[0]!.toUpperCase()}${name.slice(1)} at ${volume} mL recorded as the new starting level.` },
      )
      setPhase({ k: 'idle' })
      bed.reload()
    } catch (err) {
      setPhase(review)
      setFlash({ tone: 'danger', text: errorText(err) }, err)
    }
  }

  // The check screen's groups of controls (web/interface "Attendant screens stay simple").
  const bag = phase.k === 'review' ? phase.bag : null
  const mismatch = bag ? bagMismatch(bag.container, devices) : null
  const bagGroups = bag ? controlGroups({ k: 'check', item: { kind: 'bag', urine: bag.container === 'urine_bag' } }) : []

  return (
    <div {...stylex.props(ui.stack)}>
      <section aria-label="Bed" {...stylex.props(s.banner)}>
        <div {...stylex.props(s.bannerTop)}>
          <BedBadge ward={admission.ward_code} bed={admission.bed} size="lg" />
          <div {...stylex.props(s.who)}>
            <h2 {...stylex.props(s.patient)}>{admission.patient}</h2>
            <p {...stylex.props(s.meta)}>
              <AcuityMark level={acuity.level} label={ACUITY_LABEL[acuity.level]} />
              {[deviceLine(devices), admission.ward_name].filter(Boolean).map((x) => (
                <span key={x}>{x}</span>
              ))}
            </p>
          </div>
          <Button variant="ghost" nativeButton={false} render={<Link to="/a" />}>
            Change bed
          </Button>
        </div>
        <p {...stylex.props(s.vitals)}>
          <span {...stylex.props(s.vitalsLabel)}>Last 24 h</span> {vitalsLine(totals, entries.filter((e) => e.status === 'pending').length)}
          {seenSwatch(urine_seen) && (
            <span {...stylex.props(s.seen)}>
              <UrineSwatch swatch={seenSwatch(urine_seen)!} size="sm" />
            </span>
          )}
        </p>
        <CareBadges care={care} />
        {alerts.length > 0 && (
          <div {...stylex.props(ui.row)}>
            {alerts.map((a, i) => (
              <Chip key={`${a.kind}:${i}`} tone={ALERT_TONE[a.kind]} dot>
                {ALERT_LABEL[a.kind]}
              </Chip>
            ))}
          </div>
        )}
      </section>

      {inline && <Notice tone={inline.tone}>{inline.text}</Notice>}

      {phase.k === 'busy' && (
        <Section>
          <div {...stylex.props(ui.row)}>
            <span aria-live="polite" {...stylex.props(ui.grow)}>
              {phase.what}
            </span>
            <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
              Cancel
            </Button>
          </div>
        </Section>
      )}

      {phase.k === 'refused' && <RefusedRead phase={phase} now={tick} onManual={onManual} onReadAgain={readAgain} onDiscard={reset} />}

      {(phase.k === 'idle' || phase.k === 'recording') && (
        <Section icon={<DropIcon />} title="Record intake or output">
          <div {...stylex.props(s.actions)}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={phase.k === 'recording'}
              {...stylex.props(ui.focus, s.tile, s.tilePrimary)}
            >
              <span {...stylex.props(s.tileIcon, s.tileIconPrimary)}>
                <CameraIcon size={24} />
              </span>
              <span {...stylex.props(s.tileText)}>
                <span {...stylex.props(s.tileTitle)}>Take photo</span>
                <span {...stylex.props(s.tileHint, s.tileHintPrimary)}>{photoTileHint(devices)}</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => void onVoice()}
              aria-pressed={phase.k === 'recording'}
              {...stylex.props(ui.focus, s.tile, phase.k === 'recording' && s.tileRecording)}
            >
              <span {...stylex.props(s.tileIcon, phase.k === 'recording' && s.tileIconRecording)}>
                {phase.k === 'recording' ? <StopIcon size={24} /> : <MicIcon size={24} />}
              </span>
              <span {...stylex.props(s.tileText)}>
                <span {...stylex.props(s.tileTitle)}>{phase.k === 'recording' ? 'Stop and send' : 'Voice note'}</span>
                <span {...stylex.props(s.tileHint)}>{phase.k === 'recording' ? 'Tap to send' : 'Say what was taken'}</span>
              </span>
            </button>
            <button type="button" onClick={onManual} disabled={phase.k === 'recording'} {...stylex.props(ui.focus, s.tile)}>
              <span {...stylex.props(s.tileIcon)}>
                <PencilIcon size={24} />
              </span>
              <span {...stylex.props(s.tileText)}>
                <span {...stylex.props(s.tileTitle)}>Enter by hand</span>
                <span {...stylex.props(s.tileHint)}>Type and volume</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFlash(null)
                // One GET /served-tray per opening: it preselects a waiting served photo's meal. No model request.
                setPhase({ k: 'meal', served: api.servedTray(admission.id).catch(() => null) })
              }}
              disabled={phase.k === 'recording'}
              {...stylex.props(ui.focus, s.tile, s.tileWide)}
            >
              <span {...stylex.props(s.tileIcon)}>
                <MealIcon size={24} />
              </span>
              <span {...stylex.props(s.tileText)}>
                <span {...stylex.props(s.tileTitle)}>Meal</span>
                <span {...stylex.props(s.tileHint)}>Tray photo or by hand</span>
              </span>
            </button>
          </div>
          {phase.k === 'recording' ? (
            <RecordingStatus rec={phase.rec} />
          ) : (
            <label {...stylex.props(s.field)}>
              <span {...stylex.props(s.fieldLabel)}>Container in the photo</span>
              <select
                value={hints.some((h) => h.value === hint) ? hint : ''}
                onChange={(e) => setHint(e.target.value as Hint)}
                {...stylex.props(f.input)}
              >
                {hints.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              void onPhoto(f)
            }}
            {...stylex.props(ui.hiddenInput)}
            tabIndex={-1}
            aria-hidden
          />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onNote()
            }}
            {...stylex.props(ui.row)}
          >
            <input
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Or type a note: “had 2 cups of tea”"
              maxLength={2000}
              aria-label="Note"
              {...stylex.props(f.input, s.noteInput)}
            />
            <Button type="submit" variant="secondary" disabled={!noteText.trim()}>
              Read note
            </Button>
          </form>
        </Section>
      )}

      {phase.k === 'meal' && (
        <Suspense fallback={<p {...stylex.props(ui.muted)}>Opening meal…</p>}>
          <MealForm
            served={phase.served}
            admission={admission}
            care={care}
            onCancel={() => setPhase({ k: 'idle' })}
            onSaved={(text) => {
              setFlash({ tone: 'ok', text })
              setPhase({ k: 'idle' })
              bed.reload()
            }}
          />
        </Suspense>
      )}

      {phase.k === 'review' && (
        <Suspense fallback={<Reserve h={480} />}>
          <Section
            icon={<CheckIcon />}
            title="Check and save"
            actions={
              <Button variant="ghost" onClick={reset}>
                Discard
              </Button>
            }
          >
            {phase.photo && (
              <Suspense fallback={<NoPhoto aspect="3 / 4" />}>
                <CapturedSource
                  source={{
                    kind: 'photo',
                    blob: phase.photo,
                    segmentation: phase.read?.segmentation ?? null,
                    container: phase.read?.reading.container ?? null,
                    drink: phase.items[0]?.draft.drink ?? null,
                  }}
                />
              </Suspense>
            )}
            {phase.recording && (
              <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading the recording…</p>}>
                <CapturedSource source={{ kind: 'voice', ...phase.recording, turns: phase.turns, transcript: phase.transcript ?? '' }} />
              </Suspense>
            )}
            {phase.read && (
              <div {...stylex.props(ui.row)}>
                <Chip tone="info">{readSummary(phase.read)}</Chip>
                <span {...stylex.props(ui.muted)}>
                  {phase.read.mode === 'sam+spark'
                    ? 'SAM 3.1 outlined the container and liquid; Muse Spark read the marks.'
                    : 'Muse Spark read the marks.'}
                </span>
              </div>
            )}
            {phase.transcript !== undefined && !phase.recording && <p {...stylex.props(ui.muted)}>Heard: “{phase.transcript || '…'}”</p>}
            {phase.warnings.map((w) => (
              <Notice key={w} tone="warn">
                {w}
              </Notice>
            ))}
            {phase.reply && <Notice>{phase.reply}</Notice>}

            {phase.level && (
              <div {...stylex.props(s.item)}>
                <div {...stylex.props(s.group)}>
                  <span {...stylex.props(s.levelLabel)}>{phase.level.container === 'water_jug' ? 'Water jug' : 'Water bottle'} level</span>
                  <Stepper
                    label="Level"
                    min={0}
                    value={phase.level.volume}
                    onChange={(volume) => phase.level && setPhase({ ...phase, level: { ...phase.level, volume } })}
                  />
                  <p {...stylex.props(ui.muted)}>The drop since the last reading is charted as intake.</p>
                </div>
                <Button size="lg" block onClick={() => void onSaveLevel()}>
                  Save level
                </Button>
              </div>
            )}

            {phase.bag && (
              <div {...stylex.props(s.item)}>
                {mismatch && <Notice tone="warn">{mismatch.check}</Notice>}
                {bagGroups.map((g) =>
                  g === 'level' && bag ? (
                    <div key={g} {...stylex.props(s.group)}>
                      <span {...stylex.props(s.levelLabel)}>{BAG_NAME[bag.container]} level</span>
                      <div {...stylex.props(s.levelRow)}>
                        <Gauge
                          name={BAG_NAME[bag.container]}
                          level={bag.volume_ml}
                          capacity={BAG_CAPACITY_ML[bag.container]}
                          size="bed"
                          detail={false}
                          fill={bag.urine_rgb ?? undefined}
                        />
                        <Stepper
                          label="Level"
                          min={0}
                          max={BAG_MAX_ML}
                          value={bag.volume_ml}
                          onChange={(volume_ml) => phase.bag && setPhase({ ...phase, bag: { ...phase.bag, volume_ml } })}
                        />
                      </div>
                      {bag.confidence !== null && (
                        <span>
                          <ConfidenceChip source="Photo" confidence={bag.confidence} />
                        </span>
                      )}
                    </div>
                  ) : g === 'bagEvent' && bag ? (
                    <BagEventFields
                      key={g}
                      draft={bag}
                      bags={bags}
                      now={now.getTime()}
                      onChange={(next) => setPhase({ ...phase, bag: next })}
                    />
                  ) : (
                    bag && (
                      <ColourField
                        key={g}
                        draft={bagColour(bag)}
                        byHand={false}
                        onChange={(d) =>
                          phase.bag &&
                          setPhase({
                            ...phase,
                            bag: { ...phase.bag, urine_colour: d.urine_colour ?? null, urine_rgb: d.urine_rgb ?? null },
                          })
                        }
                      />
                    )
                  ),
                )}
                {phase.bag.notes && <span {...stylex.props(ui.muted)}>{phase.bag.notes}</span>}
                <Button size="lg" block onClick={() => phase.bag && void onSaveBag(phase.bag, phase.photo)}>
                  {bagSaveLabel(phase.bag.volume_ml)}
                </Button>
              </div>
            )}

            {phase.items.map((p, i) => {
              const warning = nbmWarning(care, p.draft.category, now.getTime())
              // "Bag level" on the by-hand form: the volume is the bag's level, saved as a bag reading.
              const bagOf = p.source === 'manual' ? bagOfCategory(p.draft.category, devices) : null
              const notMeasured = p.source === 'manual' && p.draft.category === 'urine' ? unmeasuredLine(devices) : null
              const bagDraft: BagDraft | null =
                bagOf && byHandBag
                  ? {
                      ...byHandDraft(
                        bagOf,
                        p.draft.volume_ml ?? 0,
                        admission,
                        charted && 'iso' in charted ? charted.iso : null,
                        !!byHandBag.photo,
                      ),
                      emptied: byHandBag.emptied,
                      changed: byHandBag.changed,
                      urine_colour: p.draft.urine_colour ?? null,
                      urine_rgb: p.draft.urine_rgb ?? null,
                    }
                  : null
              const groups = controlGroups({
                k: 'check',
                item: {
                  kind: 'item',
                  category: p.draft.category,
                  drink: offersDrinkPicker(p),
                  consistency: consistencyDefault(care, p.draft.category) !== undefined,
                  byHand: p.source === 'manual',
                  bagLevel: !!(bagDraft && byHandBag),
                },
              })
              const setCategory = (category: EntryCategory) => {
                if (p.source === 'manual') {
                  // By hand: urine takes the bed's urine container as its item; "Bag level" starts on for a bag on record.
                  const c = byHandCategory(p, category, care, devices)
                  updateItem(i, c.pending)
                  setByHandBag(c.bagOn ? { emptied: emptiedDefault(admission, bags), changed: false, photo: null } : null)
                } else updateItem(i, withCategory(p, category, care))
              }
              const group = (g: (typeof groups)[number]) => {
                switch (g) {
                  case 'what':
                    return (
                      <div key={g} {...stylex.props(s.group)}>
                        {p.draft.drink ? (
                          <div {...stylex.props(s.whatHead)}>
                            <strong {...stylex.props(s.drinkHead)}>
                              <DrinkIcon kind={p.draft.drink} size={20} />
                              {checkTitle(p.draft)}
                            </strong>
                            {drinkTitle(p.draft)?.name && <span {...stylex.props(ui.muted)}>{drinkTitle(p.draft)!.name}</span>}
                          </div>
                        ) : (
                          p.draft.item && <strong {...stylex.props(s.drinkHead)}>{p.draft.item}</strong>
                        )}
                        <ChoiceChips
                          legend="What it was"
                          options={ENTRY_CATEGORIES.map((c) => [c, CATEGORY_LABEL[c]] as const)}
                          value={p.draft.category}
                          onChange={setCategory}
                        />
                        {offersDrinkPicker(p) && (
                          <DrinkPicker value={p.draft.drink} onChange={(kind) => updateItem(i, withDrink(p, kind))} />
                        )}
                        {notMeasured && <p {...stylex.props(ui.muted)}>{notMeasured}</p>}
                        {bagOf && (
                          <SwitchField
                            checked={byHandBag !== null}
                            onChange={(on) =>
                              setByHandBag(on ? { emptied: emptiedDefault(admission, bags), changed: false, photo: null } : null)
                            }
                          >
                            Bag level
                          </SwitchField>
                        )}
                        {p.source === 'manual' && <WhenField value={when} onChange={setWhen} error={whenError} />}
                      </div>
                    )
                  case 'level':
                    return (
                      bagDraft &&
                      byHandBag && (
                        <div key={g} {...stylex.props(s.group)}>
                          <span {...stylex.props(s.levelLabel)}>{BAG_NAME[bagDraft.container]} level</span>
                          <Stepper
                            label="Level"
                            min={0}
                            max={BAG_MAX_ML}
                            value={bagDraft.volume_ml}
                            onChange={(v) => updateItem(i, { ...p, draft: { ...p.draft, volume_ml: v } })}
                          />
                          {byHandBag.photo ? (
                            <div {...stylex.props(ui.row)}>
                              <Chip tone="ok" dot>
                                Photo added
                              </Chip>
                              <Button variant="ghost" onClick={() => setByHandBag({ ...byHandBag, photo: null })}>
                                Remove
                              </Button>
                            </div>
                          ) : (
                            <PhotoButton label="Add photo (optional)" onPhoto={(photo) => setByHandBag({ ...byHandBag, photo })} />
                          )}
                        </div>
                      )
                    )
                  case 'bagEvent':
                    return (
                      bagDraft &&
                      byHandBag && (
                        <BagEventFields
                          key={g}
                          draft={bagDraft}
                          bags={bags}
                          now={now.getTime()}
                          onChange={(d) => setByHandBag({ ...byHandBag, emptied: d.emptied, changed: d.changed })}
                        />
                      )
                    )
                  case 'volume':
                    return p.draft.volume_ml === null ? (
                      <div key={g} {...stylex.props(ui.row)}>
                        <Notice tone="warn">No volume read. Set it before saving.</Notice>
                        <Button variant="secondary" onClick={() => updateItem(i, { ...p, draft: { ...p.draft, volume_ml: 200 } })}>
                          Set volume
                        </Button>
                      </div>
                    ) : (
                      <div key={g} {...stylex.props(s.group)}>
                        <span {...stylex.props(s.levelLabel)}>How much</span>
                        <Stepper
                          label="Volume"
                          value={p.draft.volume_ml}
                          onChange={(v) => updateItem(i, { ...p, draft: { ...p.draft, volume_ml: v } })}
                        />
                        {p.confidence !== null && (
                          <span>
                            <ConfidenceChip source={SOURCE_LABEL[p.source]} confidence={p.confidence} />
                          </span>
                        )}
                      </div>
                    )
                  case 'colour':
                    return (
                      <ColourField
                        key={g}
                        draft={p.draft}
                        byHand={p.source === 'manual'}
                        onChange={(draft) => updateItem(i, { ...p, draft })}
                      />
                    )
                  case 'consistency':
                    return (
                      <ConsistencyField
                        key={g}
                        value={p.iddsi_level}
                        onChange={(iddsi_level) => updateItem(i, { ...p, iddsi_level })}
                        notice={thinnerNotice(p.iddsi_level, care)}
                      />
                    )
                  case 'beds':
                  case 'capture':
                  case 'container':
                  case 'note':
                  case 'readings':
                  case 'photo':
                  case 'meal':
                  case 'eaten':
                  case 'details':
                    return null
                }
              }
              return (
                <div key={i} {...stylex.props(s.item)}>
                  {groups.map(group)}
                  {p.draft.notes && <span {...stylex.props(ui.muted)}>{p.draft.notes}</span>}
                  {warning && <Notice tone="warn">{warning}</Notice>}
                  <div {...stylex.props(s.commit)}>
                    {bagDraft && byHandBag ? (
                      <Button size="lg" block onClick={() => void onSaveBag(bagDraft, byHandBag.photo)} disabled={!!whenError}>
                        {bagSaveLabel(bagDraft.volume_ml)}
                      </Button>
                    ) : (
                      <Button
                        size="lg"
                        block
                        onClick={() => void onSaveItem(i)}
                        disabled={!canSave(p) || (p.source === 'manual' && !!whenError)}
                      >
                        {saveLabel(warning)}
                      </Button>
                    )}
                    <Button size="lg" variant="ghost" block onClick={() => dropItem(i)}>
                      Skip
                    </Button>
                  </div>
                </div>
              )
            })}
            {!phase.items.length && !phase.level && !phase.bag && (
              <Button variant="secondary" onClick={onManual}>
                Enter by hand
              </Button>
            )}
          </Section>
        </Suspense>
      )}

      {phase.k === 'bag-duplicate' && (
        <Suspense fallback={<Reserve h={160} />}>
          <Section icon={<DropIcon />} title="Already recorded?">
            <DuplicatePanel
              line={duplicateText(phase.refused.duplicate, now.getTime())}
              busy={phase.busy}
              onAnyway={() => void onSaveAnyway(phase.refused)}
              onDiscard={() => {
                setFlash({ tone: 'ok', text: discardedText(phase.refused.duplicate, Date.now()) })
                setByHandBag(null)
                setPhase({ k: 'idle' })
              }}
            />
          </Section>
        </Suspense>
      )}

      {phase.k === 'bag-saved' && (
        <Suspense fallback={<Reserve h={240} />}>
          <Section
            icon={<CheckIcon />}
            title={savedHead(phase.saved.reading)}
            subtitle={
              phase.saved.reading.event === 'check'
                ? 'Emptied it now? Add the after-emptying photo, then Done.'
                : 'Add the after-emptying photo, then Done.'
            }
          >
            {missing && mayOrder(missing.kind, staff) && (
              <span>
                <AddDevice
                  kind={missing.kind}
                  label={missing.add}
                  admissionId={admission.id}
                  wardCode={admission.ward_code}
                  care={care}
                  reload={refreshChart}
                  onDone={(text) => setFlash({ tone: 'ok', text })}
                />
              </span>
            )}
            <AfterEmptyingStep
              admissionId={admission.id}
              saved={phase.saved}
              onDone={(r) => {
                if (r) setFlash(r)
                setPhase({ k: 'idle' })
                if (r) bed.reload()
              }}
            />
          </Section>
        </Suspense>
      )}

      <Section icon={<ClockIcon />} title="Recent">
        {entries.length === 0 ? (
          <p {...stylex.props(ui.muted)}>Nothing charted yet.</p>
        ) : (
          <ul {...stylex.props(s.list)}>
            {entries.slice(0, 6).map((e) => {
              const swatch = entrySwatch(e)
              const row = entryRow(e)
              return (
                <li key={e.id} {...stylex.props(s.listRow, e.status === 'rejected' && s.rejected)}>
                  <span {...stylex.props(s.listTime)}>{row.time}</span>
                  <span {...stylex.props(s.listMain)}>
                    <span {...stylex.props(s.listHead)}>
                      <Direction dir={e.direction} />
                      {row.drink && <DrinkIcon kind={row.drink} size={14} />}
                      <span>{row.kind}</span>
                      <span {...stylex.props(s.listVolume, row.struck && s.struck)}>{row.volume}</span>
                    </span>
                    {(row.name || swatch) && (
                      <span {...stylex.props(s.listTags)}>
                        {row.name && <span {...stylex.props(s.listItem)}>{row.name}</span>}
                        {swatch && <UrineSwatch swatch={swatch} size="sm" />}
                      </span>
                    )}
                  </span>
                  <Chip tone={row.status.tone} glyph>
                    {row.status.text}
                  </Chip>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}

/** A bag draft's colour as the colour field's draft. */
const bagColour = (b: BagDraft): DraftEntry => ({
  direction: 'out',
  category: 'urine',
  volume_ml: b.volume_ml,
  item: null,
  notes: null,
  urine_colour: b.urine_colour,
  urine_rgb: b.urine_rgb,
})

/** Urine draft colour: the read one (or "Not read"), and chips that replace it. By hand: optional, none picked. */
/**
 * A read refused by the server's request budget (web/capture "Budget refusal offers manual entry", DESIGN.md 7.6): the
 * photo or recording stays, the notice says until when (or that reads are busy), Enter by hand opens at once, and Read
 * again is enabled only from the refusal's time, and only on a tap. No timer sends anything.
 */
function RefusedRead({
  phase,
  now,
  onManual,
  onReadAgain,
  onDiscard,
}: {
  phase: Extract<Phase, { k: 'refused' }>
  now: number
  onManual: () => void
  onReadAgain: (source: Refused) => Promise<void>
  onDiscard: () => void
}) {
  const view = refusalView(phase.refusal, now)
  const { source } = phase
  return (
    <Section
      icon={<ClockIcon />}
      title="Not read"
      actions={
        <Button variant="ghost" onClick={onDiscard}>
          Discard
        </Button>
      }
    >
      {source.kind === 'photo' && (
        <Suspense fallback={<NoPhoto aspect="3 / 4" />}>
          <CapturedSource source={{ kind: 'photo', blob: source.photo, segmentation: null }} />
        </Suspense>
      )}
      {source.kind === 'voice' && (
        <Suspense fallback={<p {...stylex.props(ui.muted)}>Loading the recording…</p>}>
          <CapturedSource source={{ kind: 'voice', blob: source.audio, duration_ms: source.duration_ms, turns: [], transcript: '' }} />
        </Suspense>
      )}
      {source.kind === 'text' && <p {...stylex.props(ui.muted)}>“{source.text}”</p>}
      <Notice tone="warn">{view.text}</Notice>
      <div {...stylex.props(s.refusedActions)}>
        <Button size="lg" block onClick={onManual}>
          Enter by hand
        </Button>
        <Button size="lg" block variant="secondary" disabled={view.readAgain.disabled} onClick={() => void onReadAgain(source)}>
          {view.readAgain.label}
        </Button>
      </div>
    </Section>
  )
}

function ColourField({ draft, byHand, onChange }: { draft: DraftEntry; byHand: boolean; onChange: (d: DraftEntry) => void }) {
  return (
    <div {...stylex.props(s.field)}>
      <div {...stylex.props(s.colourHead)}>
        <span {...stylex.props(s.fieldLabel)}>{byHand ? 'Colour (optional)' : 'Colour'}</span>
        {draft.urine_colour ? (
          <UrineSwatch swatch={swatchOf(draft.urine_colour, draft.urine_rgb)} />
        ) : (
          !byHand && <span {...stylex.props(ui.muted)}>Not read</span>
        )}
      </div>
      <UrineColourPicker value={draft.urine_colour} onChange={(c) => onChange(withColour(draft, c))} />
    </div>
  )
}

const s = stylex.create({
  refusedActions: { display: 'flex', flexWrap: 'wrap', gap: space.md },
  banner: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    padding: space.xl,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  bannerTop: { display: 'flex', alignItems: 'center', gap: space.lg },
  who: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 },
  patient: { fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em', overflowWrap: 'anywhere' },
  meta: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
    marginTop: space.xs,
    fontSize: text.sm,
    color: color.muted,
  },
  vitals: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.md,
    rowGap: space.xs,
    fontSize: text.md,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
    color: color.fg,
  },
  vitalsLabel: { fontSize: text.xs, fontWeight: weight.bold, color: color.muted },
  seen: { display: 'inline-flex', fontWeight: weight.regular },
  field: { display: 'flex', flexDirection: 'column', gap: space.sm },
  fieldLabel: { fontSize: text.sm, fontWeight: weight.semibold, color: color.muted },
  levelLabel: { fontSize: text.sm, fontWeight: weight.semibold, color: color.fg },
  colourHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.md },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 96,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.borderStrong, ':hover': color.accent },
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    textAlign: 'left',
    cursor: { default: 'pointer', ':disabled': 'not-allowed' },
    opacity: { default: 1, ':disabled': 0.5 },
    WebkitTapHighlightColor: 'transparent',
  },
  tilePrimary: {
    borderColor: { default: color.accent, ':hover': color.accentStrong },
    backgroundColor: { default: color.accent, ':hover': color.accentStrong },
    color: color.onAccent,
  },
  tileWide: {},
  tileRecording: { borderColor: color.danger, backgroundColor: color.dangerBg },
  tileIcon: { display: 'flex', color: color.accent },
  tileIconPrimary: { color: color.onAccent },
  tileIconRecording: { color: color.danger },
  tileText: { display: 'flex', flexDirection: 'column', gap: space.xs },
  tileTitle: { fontSize: text.lg, fontWeight: weight.bold, lineHeight: text.leadingTight },
  tileHint: { fontSize: text.sm, color: color.muted, lineHeight: text.leadingTight },
  tileHintPrimary: { color: color.onAccent },
  noteInput: { flexGrow: 1, flexBasis: 200, width: 'auto' },
  drinkHead: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.lg, fontWeight: weight.bold },
  group: { display: 'flex', flexDirection: 'column', gap: space.sm },
  levelRow: { display: 'flex', alignItems: 'center', gap: space.lg },
  whatHead: { display: 'flex', flexDirection: 'column', gap: space.xs },
  commit: { display: 'flex', flexDirection: 'column', gap: space.sm },
  item: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  list: { display: 'flex', flexDirection: 'column' },
  listRow: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    paddingBlock: space.md,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  rejected: { color: color.muted },
  listTime: { width: 44, flexShrink: 0, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  listMain: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.xs, flexGrow: 1, minWidth: 0 },
  listHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.sm,
    rowGap: 0,
    fontSize: text.md,
    fontWeight: weight.semibold,
    color: color.fg,
  },
  listTags: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  listItem: { fontSize: text.sm, color: color.muted, overflowWrap: 'anywhere' },
  listVolume: { fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  struck: { textDecorationLine: 'line-through' },
})
