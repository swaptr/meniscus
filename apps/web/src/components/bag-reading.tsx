/**
 * A bag's level on the capture screen: what saving charts, the event (Check · Emptied after photo · Bag changed, one
 * radio group) with its effect on the next reading, and, once saved, the after-emptying step. No model requests; Save
 * is never disabled by a bag rule.
 */
import { useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { PHOTO_MAX_BYTES, type BagChart, type BagReading, type BagReadingResult } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import {
  afterView,
  bagEvent,
  checkView,
  discardedText,
  duplicateText,
  emptiedNowInput,
  finishAfterEmptying,
  nearlyFullLine,
  postBagReading,
  saveAnyway,
  type BagDraft,
  type BagOutcome,
  type BagRefused,
} from '../lib/bags.ts'
import { PhotoTooLargeError, photoTooLargeMessage, shrinkPhoto } from '../lib/photo.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { CameraIcon } from './icons.tsx'
import { Chip, Notice, Stepper } from './ui.tsx'
import { ui } from './ui.styles.ts'
import { ChoiceChips } from './choice-chips.tsx'
import { BAG_EVENT_CHOICES } from '../lib/choice.ts'

/** "Emptied after photo" is the emptying's meaning on the check screen (web/capture). */
/** The last reading, what saving charts, the event as one radio group, and its effect on the next reading. */
export function BagEventFields({
  draft,
  bags,
  now,
  onChange,
}: {
  draft: BagDraft
  bags: BagChart
  now: number
  onChange: (d: BagDraft) => void
}) {
  const v = checkView(draft, bags, now)
  const event = bagEvent(draft)
  const full = nearlyFullLine(draft)
  return (
    <div {...stylex.props(s.block)}>
      {v.last && <span {...stylex.props(ui.muted)}>{v.last}</span>}
      {v.fell ? <Notice tone="warn">{v.preview}</Notice> : <p {...stylex.props(s.preview)}>{v.preview}</p>}
      {full && <Notice tone="warn">{full}</Notice>}
      <ChoiceChips
        legend="What was done"
        options={BAG_EVENT_CHOICES}
        value={event}
        onChange={(value) => onChange({ ...draft, emptied: value === 'emptied', changed: value === 'bag_changed' })}
      />
      <span {...stylex.props(ui.muted)}>{v.next}</span>
    </div>
  )
}

/**
 * A bag reading answered 409 `duplicate_reading`: the line, then "Save anyway" (secondary) and the safe choice,
 * "Discard" on the bed screen or "Cancel" in the nurse's sheet (primary). Disabled while "Save anyway" is in flight.
 */
export function DuplicatePanel({
  line,
  busy,
  onAnyway,
  onDiscard,
  discardLabel = 'Discard',
}: {
  line: string
  busy: boolean
  onAnyway: () => void
  onDiscard: () => void
  discardLabel?: string
}) {
  return (
    <div {...stylex.props(s.block)}>
      <Notice tone="warn">{line}</Notice>
      <div {...stylex.props(ui.row)}>
        <Button size="lg" variant="secondary" disabled={busy} onClick={onAnyway}>
          {busy ? 'Saving…' : 'Save anyway'}
        </Button>
        <Button size="lg" disabled={busy} onClick={onDiscard}>
          {discardLabel}
        </Button>
      </div>
    </div>
  )
}

/** A camera button with its own hidden input; the photo is shrunk on the device. */
export function PhotoButton({
  label,
  onPhoto,
  variant = 'secondary',
  onOpen,
}: {
  label: string
  onPhoto: (photo: Blob) => void
  variant?: 'primary' | 'secondary'
  /** Runs on the tap, before the camera opens. */
  onOpen?: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  // A photo still over the cap after shrinking is never handed on (so never sent): it shows the photo message.
  const [tooLarge, setTooLarge] = useState<string | null>(null)
  return (
    <>
      <Button
        size="lg"
        variant={variant}
        onClick={() => {
          setTooLarge(null)
          onOpen?.()
          ref.current?.click()
        }}
      >
        <CameraIcon size={20} />
        {label}
      </Button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          // A photo the browser cannot decode goes as picked, unless it is over the cap.
          if (f)
            void shrinkPhoto(f).then(onPhoto, (err: unknown) =>
              err instanceof PhotoTooLargeError || f.size > PHOTO_MAX_BYTES ? setTooLarge(photoTooLargeMessage()) : onPhoto(f),
            )
        }}
        {...stylex.props(ui.hiddenInput)}
        tabIndex={-1}
        aria-hidden
      />
      {tooLarge && <Notice tone="danger">{tooLarge}</Notice>}
    </>
  )
}

/**
 * The saved screen's after-emptying step. After an emptying or bag change: the photo first, "Left in bag" for an
 * emptying, then "Done". After a check: "Emptied it now?", which on "Done" saves the emptying first.
 */
export function AfterEmptyingStep({
  admissionId,
  saved,
  onDone,
}: {
  admissionId: number
  saved: BagReadingResult
  /** `text` is what was kept, or null when nothing was sent. */
  onDone: (result: { tone: 'ok' | 'warn' | 'danger'; text: string } | null) => void
}) {
  const [emptying, setEmptying] = useState(false)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [residual, setResidual] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** "Emptied it now?" answered 409: shown until "Save anyway" or "Discard". */
  const [refused, setRefused] = useState<{ refused: BagRefused; line: string } | null>(null)
  const reading = saved.reading
  const view = afterView(emptying ? { event: 'emptied' } : reading)
  const [primary] = view.actions

  /** The emptying's post (or its "Save anyway"), then the after-emptying step; null while refused as a repeat. */
  const emptied = async (post: () => Promise<BagOutcome>): Promise<BagReading | null> => {
    const o = await post()
    if ('duplicate' in o) {
      setRefused({ refused: o, line: duplicateText(o.duplicate, Date.now()) })
      setBusy(false)
      return null
    }
    setRefused(null)
    return o.saved.result.reading
  }

  const done = async (anyway?: BagRefused) => {
    setBusy(true)
    setError(null)
    try {
      // One request for "Emptied it now?" (or its "Save anyway"), then at most an upload and one after-emptying request.
      const target: Pick<BagReading, 'id' | 'event' | 'volume_ml'> | null = anyway
        ? await emptied(() => saveAnyway(api, admissionId, anyway))
        : emptying
          ? await emptied(() => postBagReading(api, admissionId, emptiedNowInput(reading)))
          : reading
      if (!target) return
      const r = await finishAfterEmptying(api, admissionId, target, { ...(photo && { photo }), residual_ml: residual })
      if (r?.warning) return onDone({ tone: 'warn', text: r.warning })
      const kept = [
        r?.reading?.proof_media && 'after-emptying photo',
        r?.reading?.residual_ml != null && `${r.reading.residual_ml} mL left in the bag`,
      ]
      const what = kept.filter(Boolean).join(' and ')
      if (what) return onDone({ tone: 'ok', text: `Kept the ${what}.` })
      onDone(emptying ? { tone: 'ok', text: `Emptying at ${reading.volume_ml} mL saved.` } : null)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <div {...stylex.props(s.block)}>
      <div {...stylex.props(ui.row)}>
        {photo ? (
          <Chip tone="ok" dot>
            After-emptying photo added
          </Chip>
        ) : (
          <PhotoButton
            label={primary}
            variant="primary"
            onOpen={() => reading.event === 'check' && setEmptying(true)}
            onPhoto={(p) => setPhoto(p)}
          />
        )}
      </div>
      {view.residual && (
        <div {...stylex.props(s.block)}>
          <span {...stylex.props(s.label)}>Left in bag</span>
          <Stepper label="Left in bag" min={0} max={reading.volume_ml} step={10} value={residual} onChange={setResidual} />
        </div>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {refused ? (
        <DuplicatePanel
          line={refused.line}
          busy={busy}
          onAnyway={() => void done(refused.refused)}
          onDiscard={() => onDone({ tone: 'ok', text: discardedText(refused.refused.duplicate, Date.now()) })}
        />
      ) : (
        <div {...stylex.props(ui.row)}>
          <Button size="lg" variant="secondary" disabled={busy} onClick={() => void done()}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}

const s = stylex.create({
  block: { display: 'flex', flexDirection: 'column', gap: space.md },
  preview: { fontSize: text.md, fontWeight: weight.regular, color: color.fg },
  label: { fontSize: text.sm, fontWeight: weight.semibold, color: color.fg },
})
