/**
 * What a record was captured from, by kind: a photo with its outline and a full-screen view, a recording with a
 * player and timed turns, a jug's before and after photos, a typed note or "by hand". Loaded lazily. Each stored
 * photo or recording loads with one `GET /api/media/<id>` (through `api`, so the staff and auth headers apply); a
 * capture under review plays from its in-memory blob with no request. No model requests.
 *
 * Adding a source kind (video): one entry in `lib/sources.ts` SOURCES, then the `never` defaults below fail to
 * compile until it has a viewer here.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Toggle } from '@base-ui/react/toggle'
import * as stylex from '@stylexjs/stylex'
import type { ContainerKind, DrinkKind, Entry, MediaRef, Segmentation, SourceKind, TranscriptTurn } from '@meniscus/shared'
import { api } from '../lib/api.ts'
import { markAmounts } from '../lib/evidence.ts'
import { PHOTO_MODES, photoShown, revealKey, type PhotoMode } from '../lib/photo-view.ts'
import { useMediaUrl as useCachedMedia } from '../lib/use-media.ts'
import { formatClock, outlineDefault, photoTitle, sourceOf, turnAt, type LevelPhoto } from '../lib/sources.ts'
import { fingerprintLine, trayOutlineDefault, type TrayView } from '../lib/tray.ts'
import { color, layer, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { FullScreenIcon, NoPhotoIcon, OutlineIcon, PauseIcon, PencilIcon, PlayIcon, XIcon, ZoomInIcon, ZoomOutIcon } from './icons.tsx'
import { SegmentOverlay } from './segment-overlay.tsx'
import { Segmented } from './segmented.tsx'
import { Notice } from './ui.tsx'

/** A stored media id, or a capture still in memory. */
export type MediaSrc = { media_id: number } | { blob: Blob }
/** What the overlay needs from evidence: the segmentation, and the read's container kind when there was a read. */
type HasSegmentation = { segmentation: Segmentation | null; reading?: { container: ContainerKind } | null } | null

/** Object URL for the media: fetched once per id (or made from the blob), revoked when it changes or unmounts. */
function useMediaUrl(src: MediaSrc | null): { url: string | null; error: boolean } {
  const id = src && 'media_id' in src ? src.media_id : null
  const blob = src && 'blob' in src ? src.blob : null
  const key = id ?? blob
  const [state, setState] = useState<{ key: number | Blob | null; url: string | null; error: boolean } | null>(null)
  useEffect(() => {
    if (id === null && blob === null) return
    const c = new AbortController()
    let url: string | null = null
    const load = blob ? Promise.resolve(blob) : api.media(id!, c.signal)
    load.then(
      (b) => {
        if (c.signal.aborted) return
        url = URL.createObjectURL(b)
        setState({ key: id ?? blob, url, error: false })
      },
      () => !c.signal.aborted && setState({ key: id ?? blob, url: null, error: true }),
    )
    return () => {
      c.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, blob])
  return state?.key === key ? state : { url: null, error: false }
}

/**
 * A kept photo through the app's media cache (design.md D8), so the details reuse the peek's or the strip's request;
 * a capture still in memory from its blob.
 */
function usePhotoUrl(src: MediaSrc): { url: string | null; error: boolean } {
  const cached = useCachedMedia('media_id' in src ? src.media_id : null)
  const local = useMediaUrl('blob' in src ? src : null)
  if (!('media_id' in src)) return local
  return { url: cached.status === 'ready' ? cached.url : null, error: cached.status === 'failed' }
}

/** The entry's source, by kind. */
export function SourceView({ entry }: { entry: Entry }) {
  const src = sourceOf(entry)
  switch (src.kind) {
    case 'levels':
      return <BeforeAfter photos={src.photos} drop={src.drop} />
    case 'photo':
      return (
        <PhotoSource
          src={{ media_id: src.media_id }}
          labeled={entry.labeled_media ?? null}
          evidence={src.evidence}
          drink={entry.drink ?? null}
          alt="Capture photo"
          sha256={entry.media?.sha256 ?? null}
        />
      )
    case 'voice':
      return (
        <VoiceSource
          src={{ media_id: src.media_id }}
          durationMs={src.duration_ms}
          turns={src.turns}
          timed={src.timed}
          sha256={entry.media?.sha256 ?? null}
        />
      )
    case 'text':
      return (
        <blockquote {...stylex.props(s.quote)}>
          <Marked text={src.transcript} />
        </blockquote>
      )
    case 'manual':
      return (
        <p {...stylex.props(s.byHand)}>
          <PencilIcon size={16} />
          {src.label}
        </p>
      )
    case 'none':
      return <p {...stylex.props(s.muted)}>{src.transcript === null ? 'The photo was not kept.' : 'The recording was not kept.'}</p>
    default: {
      const missing: never = src
      return missing
    }
  }
}

/** A capture under review, from its in-memory blob: nothing is fetched. */
export type Captured =
  /** `tray`: a tray read's dish regions, labelled from the form's dishes. */
  | {
      kind: 'photo'
      blob: Blob
      segmentation: Segmentation | null
      tray?: TrayView | null
      /** The read's container and the draft's drink kind, for the overlay's labels. */
      container?: ContainerKind | null
      drink?: DrinkKind | null
    }
  | { kind: 'voice'; blob: Blob; duration_ms: number | null; turns: TranscriptTurn[] | undefined; transcript: string }

export function CapturedSource({ source }: { source: Captured }) {
  const kind: SourceKind = source.kind
  switch (kind) {
    case 'photo': {
      const p = source as Extract<Captured, { kind: 'photo' }>
      return (
        <PhotoSource
          src={{ blob: p.blob }}
          evidence={{ segmentation: p.segmentation, reading: p.container ? { container: p.container } : null }}
          drink={p.drink ?? null}
          tray={p.tray ?? null}
          alt="Captured photo"
        />
      )
    }
    case 'voice': {
      const v = source as Extract<Captured, { kind: 'voice' }>
      const timed = !!v.turns?.length
      const turns = timed ? v.turns! : v.transcript ? [{ start_ms: 0, end_ms: v.duration_ms ?? 0, text: v.transcript }] : []
      return <VoiceSource src={{ blob: v.blob }} durationMs={v.duration_ms} turns={turns} timed={timed} />
    }
    default: {
      const missing: never = kind
      return missing
    }
  }
}

/**
 * A photo with `Labeled | Raw` (web/ward "Raw and labeled views of a kept photo"), Labeled first, and a full-screen view
 * of what is shown. A kept photo's Labeled is its stored labeled copy, else the live SAM overlay over the photo, else
 * the photo under a placeholder line; Raw is the photo alone. Each view fetches its one media id when first shown,
 * through the media cache. A capture still in memory has the live overlay only (Labeled when segmented).
 */
export function PhotoSource({
  src,
  labeled = null,
  evidence,
  tray = null,
  drink = null,
  sha256,
  alt,
  caption,
}: {
  src: MediaSrc
  /** A kept photo's labeled copy, when one was kept. */
  labeled?: Pick<MediaRef, 'id' | 'sha256'> | null
  evidence: HasSegmentation
  /** A tray photo's dish regions and what names them. */
  tray?: TrayView | null
  /** The entry's or draft's drink kind: names the liquid on the photo. */
  drink?: DrinkKind | null
  /** A kept photo's fingerprint, shown after the caption; leave out for a capture not yet kept. */
  sha256?: string | null
  alt: string
  /** Under the photo (level photos: "Before · 08:00", volume; a tray proof: who took it and when). */
  caption?: ReactNode
}) {
  const segmented = outlineDefault(evidence) || trayOutlineDefault(tray)
  const kept = 'media_id' in src
  const [mode, setMode] = useState<PhotoMode>('labeled')
  const shown = kept
    ? photoShown({ media_id: src.media_id, labeled, segmented, mode })
    : { media_id: -1, overlay: segmented && mode === 'labeled', line: null, copy: false }
  const { url, error } = usePhotoUrl(kept ? { media_id: shown.media_id } : src)
  const seg = evidence?.segmentation ?? null
  const shownAlt = shown.copy ? `${alt}, labeled copy` : alt
  const meta = (
    <>
      {caption}
      {shown.line && (
        <p title={shown.line.title} {...stylex.props(s.fingerprint, !shown.copy && s.viewLine)}>
          {shown.line.text}
        </p>
      )}
      {sha256 !== undefined && <Fingerprint kind="photo" sha256={sha256} />}
    </>
  )
  const toggle = (kept || segmented) && <Segmented label={`${alt}: view`} value={mode} options={PHOTO_MODES} onChange={setMode} />
  if (error)
    return (
      <div {...stylex.props(s.photo)}>
        <div {...stylex.props(s.missing)}>
          <NoPhotoIcon size={20} />
          The photo could not be loaded.
        </div>
        {meta}
        <div {...stylex.props(s.controls)}>{toggle}</div>
      </div>
    )
  return (
    <div {...stylex.props(s.photo)}>
      {url ? (
        <SegmentOverlay
          src={url}
          seg={shown.copy ? null : seg}
          container={evidence?.reading?.container ?? null}
          drink={drink}
          tray={shown.copy ? null : tray}
          alt={shownAlt}
          outline={shown.overlay}
          // Only the live overlay traces in on its first show (signature moment 2); a stored copy shows at once.
          reveal={kept ? revealKey(shown) : shown.overlay ? src.blob : null}
        />
      ) : (
        <div aria-busy {...stylex.props(s.loading)}>
          Loading photo…
        </div>
      )}
      {meta}
      <div {...stylex.props(s.controls)}>
        {toggle}
        {url && (
          <FullScreen
            url={url}
            seg={shown.copy ? null : seg}
            container={evidence?.reading?.container ?? null}
            drink={drink}
            tray={shown.copy ? null : tray}
            alt={shownAlt}
            outline={shown.overlay}
            onOutline={null}
          />
        )}
      </div>
    </div>
  )
}

/** `Photo fingerprint: 3f2a…c9` under a kept photo or recording, titled with the full value (DESIGN.md 7.8). */
function Fingerprint({ kind, sha256 }: { kind: SourceKind; sha256: string | null }) {
  const f = fingerprintLine(kind, sha256)
  return (
    <p title={f.title} {...stylex.props(s.fingerprint)}>
      {f.text}
    </p>
  )
}

function OutlineToggle({ on, onChange, dark = false }: { on: boolean; onChange: (on: boolean) => void; dark?: boolean }) {
  return (
    <Toggle pressed={on} onPressedChange={onChange} {...stylex.props(s.ctl, dark && s.ctlDark, on && (dark ? s.ctlOnDark : s.ctlOn))}>
      <OutlineIcon size={16} />
      Outline {on ? 'on' : 'off'}
    </Toggle>
  )
}

/** The same photo, as large as the screen allows; zoom shows it at its own pixel size, and pinch zoom works on touch. */
function FullScreen({
  url,
  seg,
  container,
  drink,
  tray,
  alt,
  outline,
  onOutline,
}: {
  url: string
  seg: Segmentation | null
  container: ContainerKind | null
  drink: DrinkKind | null
  tray: TrayView | null
  alt: string
  outline: boolean
  onOutline: ((on: boolean) => void) | null
}) {
  const [zoom, setZoom] = useState(false)
  return (
    <Dialog.Root onOpenChange={(open) => !open && setZoom(false)}>
      <Dialog.Trigger {...stylex.props(s.ctl)}>
        <FullScreenIcon size={16} />
        Full screen
      </Dialog.Trigger>
      <FullScreenPopup
        url={url}
        seg={seg}
        container={container}
        drink={drink}
        tray={tray}
        alt={alt}
        outline={outline}
        onOutline={onOutline}
        zoom={zoom}
        onZoom={setZoom}
      />
    </Dialog.Root>
  )
}

/** A kept photo opened straight in the full-screen viewer (from a thumbnail): one GET, on open. */
export function PhotoViewer({
  src,
  evidence,
  labeled = null,
  alt,
  onClose,
}: {
  src: { media_id: number }
  evidence: HasSegmentation
  /** The photo's labeled copy: the viewer offers `Labeled | Raw` and opens on the copy (web/ward "Raw and labeled views of a kept photo"). */
  labeled?: Pick<MediaRef, 'id' | 'sha256'> | null
  alt: string
  onClose: () => void
}) {
  const segmented = outlineDefault(evidence)
  const [mode, setMode] = useState<PhotoMode>('labeled')
  const shown = labeled ? photoShown({ media_id: src.media_id, labeled, segmented, mode }) : null
  const { url, error } = useMediaUrl(shown ? { media_id: shown.media_id } : src)
  const [outline, setOutline] = useState(segmented)
  const [zoom, setZoom] = useState(false)
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <FullScreenPopup
        url={url}
        error={error}
        seg={shown?.copy ? null : (evidence?.segmentation ?? null)}
        container={evidence?.reading?.container ?? null}
        alt={shown?.copy ? `${alt}, labeled copy` : alt}
        outline={shown ? shown.overlay : outline}
        onOutline={!shown && segmented ? setOutline : null}
        view={shown && <Segmented label={`${alt}: view`} value={mode} options={PHOTO_MODES} onChange={setMode} />}
        zoom={zoom}
        onZoom={setZoom}
      />
    </Dialog.Root>
  )
}

function FullScreenPopup({
  url,
  error = false,
  seg,
  container = null,
  drink = null,
  tray = null,
  alt,
  outline,
  onOutline,
  view = null,
  zoom,
  onZoom,
}: {
  url: string | null
  error?: boolean
  seg: Segmentation | null
  container?: ContainerKind | null
  drink?: DrinkKind | null
  tray?: TrayView | null
  alt: string
  outline: boolean
  onOutline: ((on: boolean) => void) | null
  /** `Labeled | Raw`, when the photo has a labeled copy. */
  view?: ReactNode
  zoom: boolean
  onZoom: (on: boolean) => void
}) {
  return (
    <Dialog.Portal>
      <Dialog.Backdrop {...stylex.props(s.fsBackdrop)} />
      <Dialog.Popup {...stylex.props(s.fsPopup)}>
        <header {...stylex.props(s.fsHead)}>
          <Dialog.Title {...stylex.props(s.fsTitle)}>{alt}</Dialog.Title>
          {view}
          {onOutline && <OutlineToggle on={outline} onChange={onOutline} dark />}
          <Toggle pressed={zoom} onPressedChange={onZoom} {...stylex.props(s.ctl, s.ctlDark, zoom && s.ctlOnDark)}>
            {zoom ? <ZoomOutIcon size={16} /> : <ZoomInIcon size={16} />}
            {zoom ? 'Fit' : 'Actual size'}
          </Toggle>
          <Dialog.Close aria-label="Close full screen" {...stylex.props(s.ctl, s.ctlDark)}>
            <XIcon size={16} />
          </Dialog.Close>
        </header>
        <div {...stylex.props(s.fsBody, zoom && s.fsBodyZoom)}>
          {url ? (
            <SegmentOverlay
              src={url}
              seg={seg}
              container={container}
              drink={drink}
              tray={tray}
              alt={alt}
              outline={outline}
              fit={zoom ? 'natural' : 'screen'}
            />
          ) : (
            <p role="status" {...stylex.props(s.fsTitle)}>
              {error ? 'The photo could not be loaded.' : 'Loading photo…'}
            </p>
          )}
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  )
}

/** A recording: play/pause, a scrubber, `m:ss / m:ss`, and the transcript's turns (the playing one marked; tap to seek). */
export function VoiceSource({
  src,
  durationMs,
  turns,
  timed,
  sha256,
}: {
  src: MediaSrc
  durationMs: number | null
  turns: TranscriptTurn[]
  /** False when the turns are the whole transcript as one (older evidence, or none detected). */
  timed: boolean
  /** A kept recording's fingerprint, under the player; leave out for a capture not yet kept. */
  sha256?: string | null
}) {
  const { url, error } = useMediaUrl(src)
  const audio = useRef<HTMLAudioElement>(null)
  const [ms, setMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [metaMs, setMetaMs] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  const total = Math.max(durationMs ?? metaMs ?? 0, ms)
  const active = timed && (playing || ms > 0) ? turnAt(turns, ms) : null

  // Smooth position while playing (timeupdate alone is about 4 per second).
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = () => {
      if (audio.current) setMs(audio.current.currentTime * 1000)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  const seek = (to: number) => {
    const a = audio.current
    if (!a) return
    a.currentTime = to / 1000
    setMs(to)
  }
  const play = () => void audio.current?.play().catch(() => setFailed(true))
  const toggle = () => (audio.current?.paused ? play() : audio.current?.pause())
  const unplayable = failed || error

  return (
    <div {...stylex.props(s.voice)}>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          hidden
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setMetaMs(e.currentTarget.duration * 1000)}
          onTimeUpdate={(e) => setMs(e.currentTarget.currentTime * 1000)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setFailed(true)}
        />
      )}
      {unplayable ? (
        <Notice tone="warn">{error ? 'The recording could not be loaded.' : "This browser can't play this recording."}</Notice>
      ) : (
        <div {...stylex.props(s.player)}>
          <Button icon size="lg" onClick={toggle} disabled={!url} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </Button>
          <input
            type="range"
            aria-label="Position in the recording"
            aria-valuetext={`${formatClock(ms)} of ${formatClock(total)}`}
            min={0}
            max={Math.max(total, 1)}
            step={100}
            value={Math.min(ms, total)}
            disabled={!url}
            onChange={(e) => seek(Number(e.currentTarget.value))}
            {...stylex.props(s.scrubber)}
          />
          <span {...stylex.props(s.clock)}>
            {formatClock(ms)} / {formatClock(total)}
          </span>
        </div>
      )}
      {sha256 !== undefined && <Fingerprint kind="voice" sha256={sha256} />}
      {turns.length > 0 && (
        <ol {...stylex.props(s.turns)} aria-label="Transcript">
          {turns.map((t, i) => (
            <li key={i}>
              <button
                type="button"
                aria-current={i === active ? 'true' : undefined}
                disabled={unplayable || !url}
                onClick={() => {
                  seek(t.start_ms)
                  play()
                }}
                {...stylex.props(s.turn, i === active && s.turnOn)}
              >
                {timed && <span {...stylex.props(s.turnAt)}>{formatClock(t.start_ms)}</span>}
                <span {...stylex.props(s.turnText)}>
                  <Marked text={t.text} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {!timed && turns.length > 0 && <p {...stylex.props(s.muted)}>No timing for this recording: the transcript is shown whole.</p>}
    </div>
  )
}

/** A jug's two photos side by side (stacked on a narrow screen), each with its outline, volume and time, and the drop. */
export function BeforeAfter({ photos, drop }: { photos: LevelPhoto[]; drop: string | null }) {
  const [before, after] = photos.length > 1 ? [photos[0]!, photos[1]!] : [null, photos[0]!]
  const one = (p: LevelPhoto, which: 'Before' | 'After') => {
    const caption = (
      <p {...stylex.props(s.levelCaption)}>
        <span {...stylex.props(s.levelWhen)}>{p.event ? which : `${which} · ${p.time}`}</span>
        <strong {...stylex.props(s.levelMl)}>{p.event ? photoTitle(p) : p.label}</strong>
      </p>
    )
    return p.media_id === null ? (
      <div {...stylex.props(s.photo)}>
        <div {...stylex.props(s.missing)}>
          <NoPhotoIcon size={20} />
          Photo not kept
        </div>
        {caption}
      </div>
    ) : (
      <PhotoSource
        src={{ media_id: p.media_id }}
        labeled={p.labeled}
        evidence={p.evidence}
        sha256={p.sha256}
        alt={`${which}: ${p.event ? photoTitle(p) : `${p.label} at ${p.time}`}`}
        caption={caption}
      />
    )
  }
  return <PairLayout before={before && one(before, 'Before')} drop={drop} after={one(after, 'After')} />
}

/**
 * The before/after pair layout (DESIGN.md 7.2): side by side with the stat line over both on wide screens; before, stat
 * line, after on phones. Jug and bag levels, and a served and collected tray.
 */
export function PairLayout({ before, drop, after }: { before: ReactNode; drop: string | null; after: ReactNode }) {
  return (
    <div {...stylex.props(s.pair)}>
      {before && <div {...stylex.props(s.before)}>{before}</div>}
      {drop && <p {...stylex.props(s.drop)}>{drop}</p>}
      <div {...stylex.props(s.after)}>{after}</div>
    </div>
  )
}

/** Text with its amounts ("200 mL") marked. */
function Marked({ text: t }: { text: string }) {
  return markAmounts(t).map((p, i) =>
    p.mark ? (
      <mark key={i} {...stylex.props(s.mark)}>
        {p.text}
      </mark>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  )
}

const NARROW = '@media (max-width: 480px)'

const s = stylex.create({
  muted: { color: color.muted, fontSize: text.sm },
  quote: {
    margin: 0,
    paddingInlineStart: space.lg,
    borderInlineStartWidth: 3,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: color.border,
    fontStyle: 'italic',
  },
  byHand: { display: 'flex', alignItems: 'center', gap: space.md, fontWeight: weight.semibold },
  mark: {
    backgroundColor: color.warnBg,
    color: color.fg,
    fontStyle: 'normal',
    fontWeight: weight.bold,
    paddingInline: space.xs,
    borderRadius: radius.sm,
  },

  photo: { display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 },
  loading: {
    display: 'grid',
    placeItems: 'center',
    height: 200,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.muted,
    fontSize: text.sm,
  },
  missing: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 160,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    backgroundColor: color.subtle,
    color: color.muted,
    fontSize: text.sm,
    textAlign: 'center',
  },
  viewLine: { color: color.fg },
  controls: { display: 'flex', flexWrap: 'wrap', gap: space.md },
  fingerprint: { margin: 0, fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' },
  ctl: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: 44,
    minWidth: 44,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  ctlOn: { borderColor: color.accent, backgroundColor: { default: color.accentBg, ':hover': color.accentBg }, color: color.accentStrong },
  ctlDark: {
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: { default: 'rgba(255,255,255,0.08)', ':hover': 'rgba(255,255,255,0.16)' },
    color: color.bg,
  },
  ctlOnDark: { borderColor: color.accentBg, color: color.accentBg },

  fsBackdrop: { position: 'fixed', inset: 0, zIndex: layer.peek, backgroundColor: 'rgba(2, 6, 23, 0.92)' },
  fsPopup: {
    position: 'fixed',
    inset: 0,
    zIndex: layer.viewer,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: color.fg,
    color: color.bg,
    outline: 'none', // focus-ok: dialog popup, focus moves to its first control
  },
  fsHead: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space.md,
    padding: space.md,
    paddingTop: `max(${space.md}, env(safe-area-inset-top))`,
  },
  fsTitle: {
    flexGrow: 1,
    minWidth: 0,
    fontSize: text.md,
    fontWeight: weight.semibold,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  fsBody: {
    flexGrow: 1,
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    padding: space.md,
    touchAction: 'pan-x pan-y pinch-zoom',
  },
  fsBodyZoom: { alignItems: 'flex-start', justifyContent: 'flex-start' },

  voice: { display: 'flex', flexDirection: 'column', gap: space.lg, minWidth: 0 },
  player: {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: space.lg,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: color.subtle,
  },
  scrubber: { width: '100%', height: 44, margin: 0, accentColor: color.accent, cursor: 'pointer' },
  clock: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: weight.semibold,
    fontSize: text.sm,
    whiteSpace: 'nowrap',
    paddingInlineEnd: space.sm,
  },
  turns: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  turn: {
    display: 'flex',
    alignItems: 'baseline',
    gap: space.lg,
    width: '100%',
    minHeight: 44,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover:not(:disabled)': color.subtle },
    color: color.fg,
    fontSize: text.md,
    textAlign: 'start',
    cursor: { default: 'pointer', ':disabled': 'default' },
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
  },
  turnOn: { borderColor: color.accent, backgroundColor: { default: color.accentBg, ':hover:not(:disabled)': color.accentBg } },
  turnAt: {
    flexShrink: 0,
    minWidth: 34,
    color: color.muted,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
  },
  turnText: { minWidth: 0, overflowWrap: 'anywhere' },

  pair: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr) minmax(0, 1fr)', [NARROW]: 'minmax(0, 1fr)' },
    gap: space.lg,
    alignItems: 'start',
  },
  // Wide: the drop over both photos; narrow: before, drop, after.
  before: { gridRowStart: { default: 2, [NARROW]: 1 }, gridColumnStart: 1, minWidth: 0 },
  after: { gridRowStart: { default: 2, [NARROW]: 3 }, gridColumnStart: { default: 2, [NARROW]: 1 }, minWidth: 0 },
  drop: {
    gridRowStart: { default: 1, [NARROW]: 2 },
    gridColumnStart: 1,
    gridColumnEnd: { default: 3, [NARROW]: 2 },
    justifySelf: 'center',
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 36,
    paddingInline: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.intakeBg,
    color: color.intake,
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
    // A tray's stat line can be longer than a phone is wide: it wraps inside the pill.
    maxWidth: '100%',
    textAlign: 'center',
    overflowWrap: 'anywhere',
  },
  levelCaption: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, margin: 0 },
  levelWhen: { color: color.muted, fontSize: text.sm, fontWeight: weight.semibold },
  levelMl: { fontSize: text.lg, fontVariantNumeric: 'tabular-nums' },
})
