import { lazy, Suspense, useEffect, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import * as stylex from '@stylexjs/stylex'
import type { Alert, Entry, EntryEvent } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { careFlags } from '../lib/care.ts'
import { entryFlags } from '../lib/flags.ts'
import { CATEGORY_LABEL, SOURCE_LABEL } from '../lib/labels.ts'
import { DrinkLabel } from './drink-label.tsx'
import { sourceOf, type SourceShown } from '../lib/sources.ts'
import { canDecide } from '../lib/staff.ts'
import { timeline, who } from '../lib/timeline.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { FocusableWhenDisabled } from './button-context.ts'
import { EvidencePanel } from './evidence-panel.tsx'
import { CheckIcon, PencilIcon, XIcon } from './icons.tsx'
import { AmendDialog, RejectDialog } from './resolve.tsx'
import { sheet } from './sheet.styles.ts'
import { Timeline } from './timeline.tsx'
import { Chip, Notice, type Tone } from './ui.tsx'
import { entrySwatch } from '../lib/urine.ts'
import { UrineSwatch } from './urine-swatch.tsx'
import { dayLabelClock } from '../lib/format.ts'

// The photo viewer and audio player load with the first entry opened.
const SourceView = lazy(() => import('./source-view.tsx').then((m) => ({ default: m.SourceView })))
const SOURCE_TITLE: Record<SourceShown['kind'], string> = {
  levels: 'Before and after',
  photo: 'Photo',
  voice: 'Recording',
  text: 'Typed note',
  manual: 'Source',
  none: 'Source',
}

const STATUS_TONE: Record<Entry['status'], Tone> = { pending: 'pending', approved: 'ok', rejected: 'neutral' }
const STATUS_LABEL: Record<Entry['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }

/**
 * One entry: badges, what happened (timeline), its source (photo with SAM's outline, recording with timed turns, or a
 * jug's before and after) and what the models read, plus the actions that fix it. Loaded lazily. Reads only; no model
 * request.
 */
export function EntryDetails({
  entry: e,
  alerts = [],
  onClose,
  onChanged,
}: {
  entry: Entry
  /** The chart's prompts, for the care flags. */
  alerts?: Alert[]
  onClose: () => void
  onChanged: (message: string) => void
}) {
  const [events, setEvents] = useState<{ key: string; list: EntryEvent[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState<'amend' | 'reject' | null>(null)
  const [busy, setBusy] = useState(false)
  // Approve, reject and amend are a nurse's (or matron's); an attendant sees the entry and its history only.
  const decide = canDecide(useStaff())
  // Refetch when the entry changes (reviewed, amended).
  const key = `${e.id}:${e.status}:${e.amended_at ?? ''}:${e.volume_ml}`

  useEffect(() => {
    const c = new AbortController()
    api.events(e.id, c.signal).then(
      (list) => setEvents({ key, list }),
      (err: unknown) => !c.signal.aborted && setError(errorText(err)),
    )
    return () => c.abort()
  }, [e.id, key])

  const inbound = e.direction === 'in'
  const source = sourceOf(e).kind
  const when = dayLabelClock(e.created_at)
  const steps = events?.key === key ? timeline(e, events.list) : null
  const done = (message: string) => {
    setResolving(null)
    onChanged(message)
  }
  const approve = async () => {
    if (!decide) return
    setBusy(true)
    try {
      await api.review(e.id, { action: 'approve' })
      onChanged(`Approved ${e.volume_ml} mL.`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(sheet.backdrop)} />
        <Dialog.Popup {...stylex.props(sheet.popup, s.popup)}>
          {/* Disabled buttons stay focusable, so Tab cannot leave past a disabled last one (as on the shared Sheet). */}
          <FocusableWhenDisabled value>
            <header {...stylex.props(sheet.head)}>
              <div {...stylex.props(sheet.headMain)}>
                <Dialog.Title {...stylex.props(s.title)}>
                  {e.drink ? (
                    <span {...stylex.props(inbound ? s.inText : s.outText)}>
                      <DrinkLabel drink={e.drink} item={e.item} volume={e.volume_ml} />
                    </span>
                  ) : (
                    <>
                      <span {...stylex.props(inbound ? s.inText : s.outText)}>{e.volume_ml} mL</span>{' '}
                      {CATEGORY_LABEL[e.category].toLowerCase()}
                      {e.item ? ` · ${e.item}` : ''}
                    </>
                  )}
                </Dialog.Title>
                <Dialog.Description {...stylex.props(sheet.sub)}>
                  {SOURCE_LABEL[e.source]} by {who(e.created_by)} · {when}
                </Dialog.Description>
              </div>
              <Dialog.Close render={<Button variant="secondary" />}>Close</Dialog.Close>
            </header>
            <div {...stylex.props(s.chips)}>
              <Chip tone={inbound ? 'in' : 'out'} dot>
                {inbound ? 'In' : 'Out'} · {e.drink ? <DrinkLabel drink={e.drink} item={null} /> : CATEGORY_LABEL[e.category]}
              </Chip>
              {entrySwatch(e) && <UrineSwatch swatch={entrySwatch(e)!} />}
              {e.status !== 'rejected' && (
                <Chip tone={STATUS_TONE[e.status]} dot>
                  {STATUS_LABEL[e.status]}
                </Chip>
              )}
              {[...entryFlags(e), ...careFlags(e, alerts)].map((b) => (
                <Chip key={b.text} tone={b.tone}>
                  {b.text}
                </Chip>
              ))}
            </div>

            {decide && (e.status === 'pending' || e.status === 'approved') && (
              <div {...stylex.props(s.actions)}>
                {e.status === 'pending' ? (
                  <>
                    <Button variant="danger" disabled={busy} onClick={() => setResolving('reject')}>
                      <XIcon /> Reject…
                    </Button>
                    <Button disabled={busy} onClick={() => void approve()}>
                      <CheckIcon /> Approve {e.volume_ml} mL
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={() => setResolving('amend')}>
                    <PencilIcon /> Amend…
                  </Button>
                )}
              </div>
            )}
            {error && <Notice tone="danger">{error}</Notice>}

            <section {...stylex.props(sheet.section)} aria-label="What happened">
              <h3 {...stylex.props(sheet.h3)}>What happened</h3>
              {steps ? <Timeline steps={steps} /> : !error && <p {...stylex.props(sheet.sub)}>Loading history…</p>}
            </section>
            <section {...stylex.props(sheet.section)}>
              <h3 {...stylex.props(sheet.h3)}>{SOURCE_TITLE[source]}</h3>
              <Suspense fallback={<p {...stylex.props(sheet.sub)}>Loading…</p>}>
                <SourceView entry={e} />
              </Suspense>
            </section>
            <section {...stylex.props(sheet.section)}>
              <h3 {...stylex.props(sheet.h3)}>What the AI read</h3>
              <EvidencePanel evidence={e.evidence} />
            </section>

            {decide && resolving === 'reject' && <RejectDialog entry={e} onClose={() => setResolving(null)} onDone={done} />}
            {decide && resolving === 'amend' && <AmendDialog entry={e} onClose={() => setResolving(null)} onDone={done} />}
          </FocusableWhenDisabled>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const s = stylex.create({
  popup: { width: { default: 'min(640px, calc(100vw - 32px))', '@media (max-width: 640px)': '100vw' }, gap: space.xl },
  title: { fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.01em' },
  inText: { color: color.intake },
  outText: { color: color.output },
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.md },
})
