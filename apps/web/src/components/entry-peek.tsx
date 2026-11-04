/**
 * The entry peek's body (web/ward "Entry peek", "Read drawn on the peek photo", "Region quantities on the labeled
 * photo"; DESIGN.md 5.1, 5.22). Lazy: its own chunk, loaded on the first open. Everything comes from the loaded entry,
 * plus the one `GET /api/media/<id>` the media cache sends the first time a photo entry's peek opens.
 */
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import type { Alert, Entry, MediaRef } from '@meniscus/shared'
import { careFlags } from '../lib/care.ts'
import { entryPeek, peekPhotoBox, readScale, type ReadMark } from '../lib/entry-peek.ts'
import { entryFlags } from '../lib/flags.ts'
import { photoLabeled } from '../lib/media-cache.ts'
import { PHOTO_MODES, photoShown, revealKey, type PhotoMode } from '../lib/photo-view.ts'
import { useMediaUrl } from '../lib/use-media.ts'
import { entrySwatch } from '../lib/urine.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { DrinkIcon } from './drink-label.tsx'
import { CheckIcon, NoPhotoIcon, XIcon } from './icons.tsx'
import { PeekFoot, PeekHead } from './peek.tsx'
import { SegmentOverlay } from './segment-overlay.tsx'
import { Segmented } from './segmented.tsx'
import { Chip } from './ui.tsx'
import { UrineSwatch } from './urine-swatch.tsx'

export default function EntryPeekBody({
  entry: e,
  alerts,
  decide,
  busy,
  onDetails,
  onApprove,
  onReject,
}: {
  entry: Entry
  alerts: readonly Alert[]
  /** A nurse or matron: a pending entry's peek repeats the row's Reject… and Approve. */
  decide: boolean
  busy: boolean
  onDetails: () => void
  onApprove: () => void
  onReject: () => void
}) {
  const p = entryPeek(e)
  const scale = readScale(e)
  const ev = e.evidence?.kind === 'photo' ? e.evidence : null
  const flags = [...entryFlags(e), ...careFlags(e, [...alerts])]
  const swatch = entrySwatch(e)
  return (
    <>
      <PeekHead
        title={
          <span {...stylex.props(s.head)}>
            {p.drink && (
              <span {...stylex.props(s.drink)}>
                <DrinkIcon kind={p.drink} size={16} />
              </span>
            )}
            {p.head}
          </span>
        }
        sub={p.name ? <span translate="no">{p.name}</span> : undefined}
        end={
          <Chip tone={p.status.tone} glyph>
            {p.status.text}
          </Chip>
        }
      />

      {p.mediaId !== null && (
        <div {...stylex.props(s.photoRow, !scale && s.photoOnly)}>
          <PeekPhoto
            id={p.mediaId}
            labeled={photoLabeled(e)}
            seg={ev?.segmentation ?? null}
            container={ev?.reading.container ?? null}
            drink={e.drink}
            aspect={ev?.segmentation?.container ? undefined : '3 / 4'}
          />
          {scale && <ReadScale capacity={scale.capacity} ticks={scale.ticks} marks={scale.marks} />}
        </div>
      )}
      {p.mediaId === null && scale && <ReadScale capacity={scale.capacity} ticks={scale.ticks} marks={scale.marks} wide />}

      {p.quote && <blockquote {...stylex.props(s.quote)}>{p.quote}</blockquote>}

      <div {...stylex.props(s.chips)}>
        <Chip tone={p.source.tone}>{p.source.text}</Chip>
        {p.mode && <Chip tone="neutral">{p.mode}</Chip>}
        {swatch && <UrineSwatch swatch={swatch} size="sm" />}
        {flags.slice(0, 3).map((f) => (
          <Chip key={f.text} tone={f.tone}>
            {f.text}
          </Chip>
        ))}
      </div>

      <p {...stylex.props(s.volumes)}>{p.volumes}</p>

      <ol {...stylex.props(s.trail)}>
        {p.trail.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ol>
      {e.notes && <p {...stylex.props(s.note)}>{e.notes}</p>}

      <PeekFoot>
        {decide && p.actions.length > 0 && (
          <>
            <Button variant="danger" disabled={busy} onClick={onReject}>
              <XIcon /> Reject…
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onApprove}>
              <CheckIcon /> Approve
            </Button>
          </>
        )}
        <Button variant={decide && p.actions.length > 0 ? 'ghost' : 'primary'} onClick={onDetails}>
          Details
        </Button>
      </PeekFoot>
    </>
  )
}

/**
 * The photo with `Labeled | Raw`, Labeled first (web/ward "Raw and labeled views of a kept photo"): the stored labeled
 * copy, else SAM's outlines traced in live on its first show, else the photo under a placeholder line. Each view is
 * fetched once through the media cache when first shown.
 */
function PeekPhoto({
  id,
  labeled,
  seg,
  container,
  drink,
  aspect,
}: {
  id: number
  labeled: MediaRef | null
  seg: Parameters<typeof SegmentOverlay>[0]['seg']
  container: Parameters<typeof SegmentOverlay>[0]['container']
  drink: Entry['drink']
  aspect?: string
}) {
  const [mode, setMode] = useState<PhotoMode>('labeled')
  const shown = photoShown({ media_id: id, labeled, segmented: !!(seg?.container || seg?.fluid), mode })
  const media = useMediaUrl(shown.media_id)
  const box = peekPhotoBox(media)
  return (
    <div {...stylex.props(s.photoCol)}>
      {box.show === 'no-photo' ? (
        <div role="img" aria-label={box.label} {...stylex.props(s.placeholder)} style={{ aspectRatio: aspect ?? '3 / 4' }}>
          <NoPhotoIcon size={24} />
        </div>
      ) : (
        <div {...stylex.props(s.photo)}>
          <SegmentOverlay
            src={box.url}
            seg={shown.copy ? null : seg}
            container={container}
            drink={drink}
            alt={shown.copy ? 'Capture photo, labeled copy' : 'Capture photo'}
            fit="peek"
            outline={shown.overlay}
            reveal={revealKey(shown)}
          />
        </div>
      )}
      <div {...stylex.props(s.photoBar)}>
        <Segmented label="Photo view" value={mode} options={PHOTO_MODES} onChange={setMode} />
        {shown.line && (
          <span title={shown.line.title} {...stylex.props(s.photoLine)}>
            {shown.line.text}
          </span>
        )}
      </div>
    </div>
  )
}

const MIN_GAP = 0.12

/** Spreads labels so close marks (AI read 450, Saved 430) never overlap; the tick stays at its true height. */
function spread(marks: readonly ReadMark[]): number[] {
  const order = marks.map((m, i) => ({ i, at: m.at })).sort((a, b) => a.at - b.at)
  const out = new Array<number>(marks.length)
  let last = -Infinity
  for (const o of order) {
    const at = Math.max(o.at, last + MIN_GAP)
    out[o.i] = at
    last = at
  }
  // Pushed past the top: shift the whole stack down.
  const over = Math.max(0, last - 1)
  return out.map((a) => Math.max(0, a - over))
}

/** The graduated scale from 0 to capacity, with the AI's, the saved and the approved volume marked and labelled. */
function ReadScale({ capacity, ticks, marks, wide = false }: { capacity: number; ticks: number[]; marks: ReadMark[]; wide?: boolean }) {
  const labelAt = spread(marks)
  return (
    <figure
      aria-label={`Scale 0 to ${capacity} mL: ${marks.map((m) => `${m.label} mL`).join(', ')}`}
      {...stylex.props(s.scale, wide && s.scaleWide)}
    >
      <div aria-hidden {...stylex.props(s.rail)}>
        {ticks.map((t) => (
          <span key={t} {...stylex.props(s.tick)} style={{ bottom: `${(t / capacity) * 100}%` }}>
            <span {...stylex.props(s.tickLabel)}>{t}</span>
          </span>
        ))}
        {marks.map((m, i) => (
          <span key={m.kind}>
            <span {...stylex.props(s.markLine, MARK[m.kind])} style={{ bottom: `${m.at * 100}%` }} />
            <span {...stylex.props(s.markLabel, LABEL[m.kind])} style={{ bottom: `${labelAt[i]! * 100}%` }}>
              {m.label}
            </span>
          </span>
        ))}
      </div>
      <figcaption {...stylex.props(s.scaleCap)}>mL</figcaption>
    </figure>
  )
}

const s = stylex.create({
  head: { display: 'inline-flex', alignItems: 'center', gap: space.sm },
  drink: { display: 'inline-flex', color: color.intakeText },
  photoRow: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 132px', gap: space.md, alignItems: 'stretch' },
  photoOnly: { gridTemplateColumns: 'minmax(0, 1fr)' },
  photoCol: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: space.sm },
  photoBar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.xs },
  photoLine: { fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
  photo: { minWidth: 0, display: 'flex', justifyContent: 'center', backgroundColor: color.subtle, borderRadius: radius.md },
  placeholder: {
    display: 'grid',
    placeItems: 'center',
    width: '100%',
    maxHeight: 260,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.muted,
  },
  scale: { position: 'relative', display: 'flex', flexDirection: 'column', gap: space.xs, margin: 0, minHeight: 200 },
  scaleWide: { minHeight: 120 },
  rail: {
    position: 'relative',
    flexGrow: 1,
    marginBlock: space.md,
    marginInlineStart: `calc(${space.xxxl} + ${space.xs})`,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: color.borderStrong,
  },
  tick: { position: 'absolute', left: -2, width: 8, height: 1, backgroundColor: color.borderStrong },
  tickLabel: {
    position: 'absolute',
    right: 12,
    top: -7,
    fontSize: text.xs,
    lineHeight: 1,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
  },
  markLine: { position: 'absolute', left: -6, width: 18, height: 2, borderRadius: radius.sm },
  markLabel: {
    position: 'absolute',
    left: 16,
    transform: 'translateY(50%)',
    whiteSpace: 'nowrap',
    fontSize: text.xs,
    lineHeight: 1.1,
    fontVariantNumeric: 'tabular-nums',
  },
  scaleCap: { fontSize: text.xs, color: color.muted, textAlign: 'start', paddingInlineStart: space.xxl },
  quote: {
    margin: 0,
    paddingInlineStart: space.md,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: color.border,
    fontSize: text.md,
  },
  chips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  volumes: { margin: 0, fontSize: text.sm, fontWeight: weight.semibold, fontVariantNumeric: 'tabular-nums' },
  trail: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontSize: text.sm,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
  },
  note: { margin: 0, fontSize: text.sm },
})

const MARK = stylex.create({
  ai: { backgroundColor: color.muted },
  saved: { backgroundColor: color.fg },
  approved: { backgroundColor: color.ok, height: 3 },
})
const LABEL = stylex.create({
  ai: { color: color.muted },
  saved: { color: color.fg, fontWeight: weight.semibold },
  approved: { color: color.ok, fontWeight: weight.bold },
})
