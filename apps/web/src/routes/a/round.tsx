import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { Button } from '../../components/button.tsx'
import { NoPhoto } from '../../components/no-photo.tsx'
import {
  BedIcon,
  CameraIcon,
  MicIcon,
  OkIcon,
  QrIcon,
  RecordingIcon,
  ReviewIcon,
  SparkIcon,
  StopIcon,
  UploadIcon,
  XIcon,
} from '../../components/icons.tsx'
import { RecordingStatus } from '../../components/recording-status.tsx'
import { BedBadge, Chip, Notice, Reserve, Section, Stepper, ConfidenceChip } from '../../components/ui.tsx'
import { UrineSwatch } from '../../components/urine-swatch.tsx'
import { ui } from '../../components/ui.styles.ts'
import { api } from '../../lib/api.ts'
import { bagContainer, duplicateText, savedText } from '../../lib/bags.ts'
import { canSave, levelContainer } from '../../lib/capture.ts'
import { BAG_NAME, CATEGORY_LABEL, CONTAINER_LABEL } from '../../lib/labels.ts'
import { PhotoTooLargeError, photoTooLargeMessage, shrinkPhoto, sampleColour, thumbUrl } from '../../lib/photo.ts'
import { decodeQr } from '../../lib/qr-decode.ts'
import { startRecording, type Recording } from '../../lib/recorder.ts'
import {
  Round,
  autoSavable,
  bagWarning,
  readLabel,
  retryView,
  roundBed,
  type ImportOutcome,
  type ImportResult,
  type PhotoOutcome,
  type Reading,
  type RoundState,
} from '../../lib/round.ts'
import { ACCEPT_ALL, formatClock } from '../../lib/sources.ts'
import { swatchOf } from '../../lib/urine.ts'
import { holdUnsaved } from '../../lib/unsaved.ts'
import { useNow } from '../../lib/use-access.ts'
import { useResource } from '../../lib/use-resource.ts'
import { color, layout, radius, space, text, weight } from '../../tokens.stylex.ts'
import { SwitchField } from '../../components/switch-field.tsx'
import { failureGoesTo, flash as showToast } from '../../lib/toast.ts'
import { lazyPart } from '../../lib/lazy-part.ts'

// The photo viewer and audio player load with the first reading checked.
const CapturedSource = lazy(() => import('../../components/source-view.tsx').then((m) => ({ default: m.CapturedSource })))
// A ready read's chips (a bag's "What was done", a urine colour): never on the round's first paint (DESIGN.md 10).
const loadChips = () => import('../../components/check-fields.ts')
const ChoiceChips = lazyPart(loadChips, 'ChoiceChips')
const UrineColourPicker = lazyPart(loadChips, 'UrineColourPicker')

export const Route = createFileRoute('/a/round')({
  staticData: { title: 'Ward round' },
  validateSearch: (search: Record<string, unknown>): { ward?: number } => {
    const ward = Number(search.ward)
    return Number.isInteger(ward) && ward > 0 ? { ward } : {}
  },
  component: WardRound,
})

type Flash = { tone: 'ok' | 'warn' | 'danger'; text: string }

const OUTCOME: Record<Exclude<PhotoOutcome, 'bed' | 'reading' | 'other_ward'>, Flash> = {
  no_bed: { tone: 'warn', text: 'Scan a bed card first, then photograph its containers.' },
  foreign_qr: { tone: 'warn', text: 'That QR code is not a Meniscus bed card.' },
  unknown_bed: { tone: 'danger', text: 'Bed card not recognised. It may be from another ward or reprinted.' },
}
const RECORD_FIRST: Flash = { tone: 'warn', text: 'Scan a bed card first, then record.' }

/** Why an imported file was skipped. */
const SKIPPED: Partial<Record<ImportOutcome, string>> = {
  no_bed: 'before any bed card',
  foreign_qr: 'QR code is not a bed card',
  unknown_bed: 'bed card not recognised',
  unsupported: 'not a photo or recording',
  unreadable: 'could not be opened',
  too_large: photoTooLargeMessage(),
}

/** "Imported 6: 2 bed cards, 3 to read. Skipped notes.txt (not a photo or recording)." */
function importText(report: ImportResult[]): Flash {
  const cards = report.filter((r) => r.outcome === 'bed' || r.outcome === 'other_ward').length
  const waiting = report.filter((r) => r.outcome === 'waiting').length
  const skipped = report.filter((r) => SKIPPED[r.outcome])
  const parts = [cards && `${cards} bed card${cards === 1 ? '' : 's'}`, waiting && `${waiting} to read`].filter(Boolean)
  const text =
    `Imported ${report.length - skipped.length} of ${report.length}${parts.length ? `: ${parts.join(', ')}` : ''}.` +
    (skipped.length ? ` Skipped ${skipped.map((r) => `${r.name} (${SKIPPED[r.outcome]})`).join(', ')}.` : '')
  return { tone: skipped.length ? 'warn' : 'ok', text }
}

function WardRound() {
  const { ward: wardId } = Route.useSearch()
  const [round] = useState(() => new Round(api, { sampleColour, prepare: shrinkPhoto }))
  const state = useSyncExternalStore(round.subscribe, round.getState)
  // The round's ward (progress grid): one local request, no model requests.
  const wardBeds = useResource(`round-ward:${wardId ?? 'none'}`, (signal) =>
    wardId === undefined ? Promise.resolve([]) : api.admissions(wardId, signal),
  )
  useEffect(() => {
    const beds = wardBeds.data
    if (!beds?.length) return round.setWard(null)
    round.setWard({
      id: beds[0]!.ward_id,
      code: beds[0]!.ward_code,
      name: beds[0]!.ward_name,
      // Each bed's bag reading interval comes from its active catheter order (care.orders), else the ward default.
      beds: beds.map(roundBed),
    })
  }, [round, wardBeds.data])
  const [inline, setInline] = useState<Flash | null>(null)
  /** Results go to the one toast; a refusal about what was sent, or a device problem, stays inline here. */
  const setFlash = (f: Flash | null, err?: unknown) => {
    if (f && (f.tone !== 'danger' || (err !== undefined && failureGoesTo(err) === 'toast'))) {
      setInline(null)
      showToast(f)
    } else setInline(f)
  }
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  const recRef = useRef<Recording | null>(null)
  /** False once the screen is gone; a microphone prompt answered after that must not start a recording. */
  const mountedRef = useRef(false)
  /** True while waiting for the microphone, so a second tap cannot start a second recording. */
  const startingRef = useRef(false)
  // Leaving the screen mid-recording drops the audio: nothing is queued later by the 1:00 auto-stop.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const rec = recRef.current
      recRef.current = null
      rec?.cancel()
    }
  }, [])

  const unsaved = state.readings.filter((r) => r.status !== 'saved').length
  const savable = state.readings.filter(autoSavable).length
  const inFlight = state.readings.filter((r) => r.status === 'queued' || r.status === 'reading').length
  const waiting = readLabel(state)

  // Unsaved readings: "Switch user" asks first.
  useEffect(() => (unsaved ? holdUnsaved() : undefined), [unsaved])
  // Code only, no data: the reading chips load after the first paint.
  useEffect(() => void loadChips(), [])
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  const onPhoto = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const photo = await shrinkPhoto(file)
      const outcome = await round.onPhoto(photo, await decodeQr(photo))
      const b = round.getState().current
      if (outcome === 'bed' && b) {
        setFlash({ tone: 'ok', text: `${b.ward_code} · Bed ${b.bed} · ${b.patient}. Now photograph its bag, urinal or jug.` })
      } else if (outcome === 'other_ward' && b) {
        setFlash({
          tone: 'warn',
          text: `Bed ${b.bed} is on Ward ${b.ward_code}, not this round's ward. Photos now go to ${b.ward_code} · Bed ${b.bed}.`,
        })
      } else if (outcome === 'reading') setFlash(null)
      else if (outcome === 'bed' || outcome === 'other_ward') setFlash(null)
      else setFlash(OUTCOME[outcome])
    } catch (err) {
      // Over the photo cap after shrinking: nothing was sent.
      setFlash({
        tone: 'danger',
        text: err instanceof PhotoTooLargeError ? photoTooLargeMessage() : 'Could not open that photo. Try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  /** Stop: the recording joins the current bed and is read at once (1 voice-note request = 2 model requests). */
  const stopRecording = async (rec: Recording) => {
    if (recRef.current !== rec) return
    recRef.current = null
    setRecording(null)
    const duration = rec.elapsedMs()
    try {
      const outcome = round.onRecording(await rec.stop(), duration)
      setFlash(outcome === 'no_bed' ? RECORD_FIRST : null)
    } catch {
      setFlash({ tone: 'danger', text: 'The recording could not be kept. Try again.' })
    }
  }

  const onRecord = async () => {
    if (recording) return stopRecording(recording)
    // No bed: ask for the card first and do not open the microphone.
    if (!round.getState().current) return setFlash(RECORD_FIRST)
    if (startingRef.current || recRef.current) return
    startingRef.current = true
    setFlash(null)
    try {
      // The auto-stop closes over this recording, not over this render's state.
      let rec: Recording | null = null
      rec = await startRecording(() => {
        if (rec) void stopRecording(rec)
      })
      if (!mountedRef.current) return rec.cancel()
      recRef.current = rec
      setRecording(rec)
    } catch {
      setFlash({ tone: 'danger', text: 'Microphone not available. Allow microphone access, or photograph instead.' })
    } finally {
      startingRef.current = false
    }
  }

  /** Gallery import, in order: no model request until Read is tapped. */
  const onImport = async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    try {
      setFlash(importText(await round.import(files, decodeQr)))
    } catch {
      setFlash({ tone: 'danger', text: 'Could not import those files. Try again.' })
    } finally {
      setBusy(false)
    }
  }

  const onSaveAll = async () => {
    setBusy(true)
    try {
      const n = await round.saveHighConfidence()
      setFlash({ tone: 'ok', text: `Saved ${n} reading${n === 1 ? '' : 's'}. They wait for nurse approval.` })
    } catch {
      setFlash({ tone: 'danger', text: 'Some readings were not saved. Check the list and save them one by one.' })
    } finally {
      setBusy(false)
    }
  }

  const groups = groupByBed(state.readings)

  return (
    <div {...stylex.props(ui.stack)}>
      <Section
        icon={<QrIcon />}
        title={
          state.current ? `${state.current.ward_code} · Bed ${state.current.bed} · ${state.current.patient}` : 'Scan a bed card to start'
        }
        actions={
          <Button variant="ghost" nativeButton={false} render={<Link to="/a" />}>
            Single bed
          </Button>
        }
      >
        <p {...stylex.props(ui.muted)}>
          Keep going: a bed card switches the bed; every other photo, and every recording, is read for that bed, one at a time in the
          background. Or import a batch from the gallery and read it in one go.
        </p>
        <div {...stylex.props(s.capture)}>
          <Button size="lg" onClick={() => fileRef.current?.click()} disabled={busy || recording !== null}>
            <CameraIcon size={20} />
            {state.current ? 'Next photo' : 'Photograph bed card'}
          </Button>
          <Button
            size="lg"
            variant={recording ? 'danger' : 'secondary'}
            onClick={() => void onRecord()}
            disabled={busy}
            aria-pressed={recording !== null}
          >
            {recording ? <StopIcon size={20} /> : <MicIcon size={20} />}
            {recording ? 'Stop' : 'Record'}
          </Button>
          <Button size="lg" variant="secondary" onClick={() => importRef.current?.click()} disabled={busy || recording !== null}>
            <UploadIcon size={20} />
            Import
          </Button>
        </div>
        {recording && <RecordingStatus rec={recording} />}
        <SwitchField checked={state.fast} onChange={(on) => round.setFast(on)}>
          Fast mode
        </SwitchField>
        <span {...stylex.props(ui.muted)}>1 model request per photo instead of 3, with less checking. Recordings always take 2.</span>
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
        <input
          ref={importRef}
          type="file"
          accept={ACCEPT_ALL}
          multiple
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            void onImport(files)
          }}
          {...stylex.props(ui.hiddenInput)}
          tabIndex={-1}
          aria-hidden
        />
      </Section>

      {inline && <Notice tone={inline.tone}>{inline.text}</Notice>}

      {waiting && (
        <Section icon={<SparkIcon />} title="Imported, not read yet" tone="info">
          <p {...stylex.props(ui.muted)}>
            Nothing has been sent to the AI. Check the list below, discard what you do not need, then read them one at a time.
          </p>
          <span>
            <Button size="lg" disabled={busy} onClick={() => round.readWaiting()}>
              <SparkIcon size={20} />
              {waiting}
            </Button>
          </span>
        </Section>
      )}

      {state.ward && <WardGrid state={state} />}

      {state.readings.length > 0 && (
        <div {...stylex.props(ui.row)}>
          <span aria-live="polite" {...stylex.props(ui.grow)}>
            {state.readings.length} reading{state.readings.length === 1 ? '' : 's'} ·{' '}
            {inFlight ? `${inFlight} reading…` : 'none in progress'} · {unsaved} unsaved
          </span>
          <Button disabled={busy || !savable} onClick={() => void onSaveAll()}>
            Save {savable} high-confidence
          </Button>
        </div>
      )}

      {groups.map(([key, readings]) => (
        <Section
          key={key}
          icon={<BedIcon />}
          title={`${readings[0]!.bed.ward_code} · Bed ${readings[0]!.bed.bed} · ${readings[0]!.bed.patient}`}
        >
          <ul {...stylex.props(ui.stack)}>
            {readings.map((r) => (
              <ReadingCard key={r.id} reading={r} round={round} busy={busy} onFlash={setFlash} />
            ))}
          </ul>
        </Section>
      ))}
    </div>
  )
}

/** Keyed by admission id: bed labels repeat across wards. */
function groupByBed(readings: Reading[]): [number, Reading[]][] {
  const groups = new Map<number, Reading[]>()
  for (const r of readings) groups.set(r.bed.id, [...(groups.get(r.bed.id) ?? []), r])
  return [...groups]
}

function ReadingCard({ reading: r, round, busy, onFlash }: { reading: Reading; round: Round; busy: boolean; onFlash: (f: Flash) => void }) {
  if (r.source.kind === 'voice') return <VoiceCard reading={r} round={round} busy={busy} onFlash={onFlash} />
  return <PhotoCard reading={r} round={round} busy={busy} onFlash={onFlash} />
}

/** Queued, reading, failed or waiting: the same for every kind. */
function Progress({ reading: r, round }: { reading: Reading; round: Round }) {
  if (r.status === 'waiting')
    return (
      <div {...stylex.props(ui.row)}>
        <Chip tone="info">Not read yet</Chip>
        <span {...stylex.props(ui.grow)} />
        <Button variant="ghost" onClick={() => round.discard(r.id)}>
          Discard
        </Button>
      </div>
    )
  if (r.status === 'queued' || r.status === 'reading')
    return <span {...stylex.props(ui.muted)}>{r.status === 'queued' ? 'Waiting…' : 'Reading…'}</span>
  if (r.status === 'failed' && r.refusal) return <Refused reading={r} round={round} />
  if (r.status === 'failed')
    return (
      <div {...stylex.props(ui.row)}>
        <Chip tone="danger">Not read</Chip>
        <span {...stylex.props(ui.muted, ui.grow)}>{r.error}</span>
        <Button variant="secondary" onClick={() => round.retry(r.id)}>
          Retry
        </Button>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link to="/a/bed/$token" params={{ token: r.bed.qr_token }} target="_blank" />}
        >
          Enter by hand
        </Button>
        <Button variant="ghost" onClick={() => round.discard(r.id)}>
          Discard
        </Button>
      </div>
    )
  return null
}

/**
 * A reading the server's request budget refused (0 model requests): the refusal notice inline, and Retry disabled until
 * its `Retry-After` time (DESIGN.md 7.6). The clock only re-renders this row; nothing is sent without a tap.
 */
function Refused({ reading: r, round }: { reading: Reading; round: Round }) {
  const now = useNow(1000)
  const retry = retryView(r, now)
  return (
    <div {...stylex.props(ui.stack)}>
      <Notice tone="warn">{r.error}</Notice>
      <div {...stylex.props(ui.row)}>
        <Button
          variant="secondary"
          nativeButton={false}
          render={<Link to="/a/bed/$token" params={{ token: r.bed.qr_token }} target="_blank" />}
        >
          Enter by hand
        </Button>
        <span {...stylex.props(ui.grow)} />
        <Button variant="secondary" disabled={retry.disabled} onClick={() => round.retry(r.id)}>
          {retry.label}
        </Button>
        <Button variant="ghost" onClick={() => round.discard(r.id)}>
          Discard
        </Button>
      </div>
    </div>
  )
}

/** A recording: its player and transcript, then one row per drafted entry. Never saved in bulk. */
function VoiceCard({ reading: r, round, busy, onFlash }: { reading: Reading; round: Round; busy: boolean; onFlash: (f: Flash) => void }) {
  if (r.source.kind !== 'voice') return null
  const source = r.source
  const note = r.voice
  const drafts = note?.drafts ?? []
  const savable = drafts.filter(canSave).length
  const durationMs = source.duration_ms ?? note?.result.duration_ms ?? null
  const save = async () => {
    try {
      const saved = await round.save(r.id)
      if (saved?.warning) onFlash({ tone: 'warn', text: saved.warning })
    } catch {
      onFlash({ tone: 'danger', text: `Bed ${r.bed.bed}: not saved. Try again.` })
    }
  }
  return (
    <li {...stylex.props(s.card)}>
      <span {...stylex.props(s.thumb, s.voiceThumb)}>
        <RecordingIcon size={24} />
        <span {...stylex.props(s.thumbTime)}>{durationMs === null ? 'Audio' : formatClock(durationMs)}</span>
      </span>
      <div {...stylex.props(ui.stack, ui.grow, s.body)}>
        <strong>Recording</strong>
        <Progress reading={r} round={round} />
        {r.status === 'saved' && (
          <span>
            <Chip tone="ok">Saved</Chip>{' '}
            {(r.saved?.entries ?? []).map((e) => `${e.volume_ml} mL ${CATEGORY_LABEL[e.category].toLowerCase()}`).join(', ')}
          </span>
        )}
        {r.status === 'ready' && note && (
          <>
            <Suspense fallback={<span {...stylex.props(ui.muted)}>Loading the player…</span>}>
              <CapturedSource
                source={{
                  kind: 'voice',
                  blob: source.blob,
                  duration_ms: durationMs,
                  turns: note.result.turns,
                  transcript: note.result.transcript ?? '',
                }}
              />
            </Suspense>
            {note.result.reply && <Notice>{note.result.reply}</Notice>}
            {drafts.length === 0 && <span {...stylex.props(ui.muted)}>Nothing to chart was heard.</span>}
            <ul {...stylex.props(s.drafts)}>
              {drafts.map((d, i) => (
                <li key={i} {...stylex.props(s.draft)}>
                  <strong {...stylex.props(s.draftLabel)}>
                    {d.draft.direction === 'in' ? 'In' : 'Out'} · {CATEGORY_LABEL[d.draft.category]}
                    {d.draft.item ? ` · ${d.draft.item}` : ''}
                  </strong>
                  <Stepper label="Volume" min={0} value={d.draft.volume_ml ?? 0} onChange={(v) => round.setDraftVolume(r.id, i, v)} />
                  <Button variant="ghost" icon size="lg" aria-label="Leave out" onClick={() => round.dropDraft(r.id, i)}>
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
            <div {...stylex.props(ui.row)}>
              <Button disabled={busy || !savable} onClick={() => void save()}>
                Save {savable} entr{savable === 1 ? 'y' : 'ies'}
              </Button>
              <Button variant="ghost" onClick={() => round.discard(r.id)}>
                Discard
              </Button>
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** A bag photo's event: one choice-chip radio group (DESIGN.md 4.8), no switch beside it. */
const BAG_EVENT_CHOICES = [
  ['check', 'Check'],
  ['emptied', 'Emptied'],
  ['bag_changed', 'Bag changed'],
] as const

function PhotoCard({ reading: r, round, busy, onFlash }: { reading: Reading; round: Round; busy: boolean; onFlash: (f: Flash) => void }) {
  // Object URL lives exactly as long as the effect (StrictMode-safe), set without re-rendering.
  const img = useRef<HTMLImageElement>(null)
  const [open, setOpen] = useState(false)
  const blob = r.source.blob
  useEffect(() => {
    // A 144 px bitmap, not the full photo (DESIGN.md 7.4); the open view decodes the photo itself.
    let url: string | null = null
    let gone = false
    void thumbUrl(blob).then((u) => {
      if (gone) return URL.revokeObjectURL(u)
      url = u
      if (img.current) img.current.src = u
    })
    return () => {
      gone = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [blob])
  const result = r.result
  const container = result ? levelContainer(result.reading) : null
  const urine = !container && result?.draft?.category === 'urine' ? result.draft : null
  const bag = result ? bagContainer(result.reading) : null
  const label = result
    ? container
      ? `${CONTAINER_LABEL[container]} level`
      : bag
        ? `${BAG_NAME[bag]} reading`
        : result.draft
          ? `${result.draft.direction === 'in' ? 'In' : 'Out'} · ${CATEGORY_LABEL[result.draft.category]}`
          : 'Nothing to chart'
    : ''

  const now = useNow(60_000)
  const save = async (anyway = false) => {
    try {
      const saved = anyway ? await round.saveAnyway(r.id) : await round.save(r.id)
      if (saved?.warning) onFlash({ tone: 'warn', text: saved.warning })
    } catch {
      onFlash({ tone: 'danger', text: `Bed ${r.bed.bed}: not saved. Try again.` })
    }
  }

  return (
    <li {...stylex.props(s.card, open && s.cardOpen)}>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Hide the photo' : 'Show the photo'}
        onClick={() => setOpen(!open)}
        {...stylex.props(s.thumbButton)}
      >
        <img ref={img} alt="" {...stylex.props(s.thumb)} />
      </button>
      <div {...stylex.props(ui.stack, ui.grow, s.body)}>
        {r.status !== 'ready' && r.status !== 'saved' && <strong>Photo</strong>}
        <Progress reading={r} round={round} />
        {r.status === 'saved' && (
          <span>
            <Chip tone="ok">Saved</Chip>{' '}
            {r.saved?.bag ? (
              savedText(r.saved.bag)
            ) : (
              <>
                {label} · {r.volume_ml} mL
                {r.saved?.entry && container ? ` (drank ${r.saved.entry.volume_ml} mL)` : ''}
              </>
            )}
          </span>
        )}
        {r.status === 'ready' && result && (
          <>
            <div {...stylex.props(ui.row)}>
              <strong {...stylex.props(ui.grow)}>{label}</strong>
              <ConfidenceChip source="Photo" confidence={result.reading.confidence} />
            </div>
            {result.warnings.slice(0, 2).map((w) => (
              <span key={w} {...stylex.props(ui.muted)}>
                {w}
              </span>
            ))}
            {urine && (
              <div {...stylex.props(s.colour)}>
                <div {...stylex.props(s.colourHead)}>
                  <span {...stylex.props(s.colourLabel)}>Colour</span>
                  {urine.urine_colour ? (
                    <UrineSwatch swatch={swatchOf(urine.urine_colour, urine.urine_rgb)} />
                  ) : (
                    <span {...stylex.props(ui.muted)}>Not read</span>
                  )}
                </div>
                <Suspense fallback={<Reserve h={72} />}>
                  <UrineColourPicker value={urine.urine_colour} onChange={(c) => round.setColour(r.id, c)} />
                </Suspense>
              </div>
            )}
            {bagWarning(r) && <Notice tone="warn">{bagWarning(r)}</Notice>}
            {r.bag && (
              <Suspense fallback={<Reserve h={72} />}>
                <ChoiceChips
                  legend="What was done"
                  options={BAG_EVENT_CHOICES}
                  value={r.bag.event}
                  onChange={(event) => round.setBagEvent(r.id, event)}
                />
              </Suspense>
            )}
            {r.duplicate ? (
              <div {...stylex.props(ui.stack)}>
                <Notice tone="warn">{duplicateText(r.duplicate, now)}</Notice>
                <div {...stylex.props(ui.row)}>
                  <Button variant="secondary" disabled={busy} onClick={() => void save(true)}>
                    {busy ? 'Saving…' : 'Save anyway'}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => round.discard(r.id)}>
                    Discard
                  </Button>
                </div>
              </div>
            ) : r.volume_ml !== null && (result.draft || container) ? (
              <div {...stylex.props(ui.row)}>
                <Stepper label="Volume" min={container ? 0 : 1} value={r.volume_ml} onChange={(v) => round.setVolume(r.id, v)} />
                <Button disabled={busy} onClick={() => void save()}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => round.discard(r.id)}>
                  Discard
                </Button>
              </div>
            ) : (
              <div {...stylex.props(ui.row)}>
                <span {...stylex.props(ui.muted, ui.grow)}>{result.reading.reading_basis}</span>
                <Button variant="ghost" onClick={() => round.discard(r.id)}>
                  Discard
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {open && (
        <div {...stylex.props(s.full)}>
          <Suspense fallback={<NoPhoto aspect="3 / 4" />}>
            <CapturedSource source={{ kind: 'photo', blob, segmentation: result?.segmentation ?? null }} />
          </Suspense>
        </div>
      )}
    </li>
  )
}

const s = stylex.create({
  capture: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(3, minmax(0, max-content))', '@media (max-width: 520px)': 'minmax(0, 1fr)' },
    gap: space.md,
  },
  card: { display: 'flex', flexWrap: 'wrap', gap: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: color.subtle },
  cardOpen: { paddingBottom: space.lg },
  body: { minWidth: 0, flexBasis: 0 },
  full: { flexBasis: '100%', minWidth: 0 },
  thumbButton: {
    flexShrink: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
    cursor: 'zoom-in',
    lineHeight: 0,
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  thumb: { width: 72, height: 96, objectFit: 'cover', borderRadius: radius.md, flexShrink: 0, backgroundColor: color.bg },
  voiceThumb: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    color: color.accent,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
  },
  thumbTime: { fontSize: text.sm, fontWeight: weight.semibold, color: color.fg, fontVariantNumeric: 'tabular-nums' },
  drafts: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, padding: 0, listStyle: 'none' },
  draft: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  draftLabel: { flexGrow: 1, minWidth: 120 },
  colour: { display: 'flex', flexDirection: 'column', gap: space.sm },
  colourHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  colourLabel: { fontSize: text.sm, fontWeight: weight.semibold, color: color.muted },
})

/**
 * The round's ward (DESIGN.md 7.4): a progress strip of one cell per bed (visited, current, to do) with `<n> of <m> beds`,
 * then one tile per bed: its badge, a check once its card was scanned, and how many readings it has.
 */
function WardGrid({ state }: { state: RoundState }) {
  const ward = state.ward!
  const visited = new Set(state.visited)
  const readings = (id: number) => state.readings.filter((r) => r.bed.id === id).length
  return (
    <Section icon={<ReviewIcon />} title={ward.name} subtitle={`${visited.size} of ${ward.beds.length} beds visited`}>
      <div aria-hidden {...stylex.props(g.strip)}>
        {ward.beds.map((b) => (
          <span key={b.id} {...stylex.props(g.cell, visited.has(b.id) && g.cellDone, state.current?.id === b.id && g.cellNow)} />
        ))}
      </div>
      <ul {...stylex.props(g.grid)}>
        {ward.beds.map((b) => {
          const done = visited.has(b.id)
          const now = state.current?.id === b.id
          const n = readings(b.id)
          return (
            <li
              key={b.id}
              aria-label={`Bed ${b.bed}: ${done ? 'visited' : 'not visited'}${now ? ', current' : ''}`}
              {...stylex.props(g.tile, done && g.done, now && g.current)}
            >
              <span {...stylex.props(g.top)}>
                <BedBadge bed={b.bed} size="sm" />
                {done && (
                  <span {...stylex.props(g.check)}>
                    <OkIcon size={16} aria-hidden />
                  </span>
                )}
              </span>
              <span {...stylex.props(g.meta, done && g.metaDone)}>
                {now ? 'Now · ' : ''}
                {n ? `${n} reading${n === 1 ? '' : 's'}` : done ? 'Card scanned' : 'To do'}
              </span>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

const g = stylex.create({
  strip: { display: 'flex', gap: space.xs, height: space.md },
  cell: { flexGrow: 1, flexBasis: 0, borderRadius: radius.sm, backgroundColor: color.grid },
  cellDone: { backgroundColor: color.ok },
  cellNow: { backgroundColor: color.accent },
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(3, minmax(0, 1fr))', '@media (min-width: 641px)': 'repeat(6, minmax(0, 1fr))' },
    gap: space.md,
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  tile: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    minHeight: layout.tapGloved,
    padding: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  done: { borderColor: color.ok, backgroundColor: color.okBg },
  current: { borderColor: color.accent, boxShadow: `inset 0 0 0 1px ${color.accent}` },
  top: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' },
  check: { display: 'flex', color: color.ok },
  meta: { fontSize: text.sm, color: color.muted, fontWeight: weight.semibold },
  metaDone: { color: color.ok },
})
