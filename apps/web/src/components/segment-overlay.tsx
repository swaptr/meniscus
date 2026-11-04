/**
 * SAM's segmentation on the photo as it really was (DESIGN.md §5.22): the surround dimmed, each element's mask
 * contour with a white halo in its tint, the fill line, and HTML labels (`Urine bag`, `Liquid · 46% full ≈ 930 mL`).
 * Evidence without masks falls back to boxes; a Spark-only read draws nothing. The first time a photo is shown with
 * `reveal`, the overlay traces in once (signature moment 2), container first, then the liquid or dishes, then the
 * labels, in `motion.signature`; reduced motion and later shows draw the final state at once. No requests.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { originalSize } from '../lib/media-cache.ts'
import type { ContainerKind, DrinkKind, Segmentation } from '@meniscus/shared'
import { CATEGORY_HUE, SLOT } from '../lib/hues.ts'
import { overlayAlt, overlayView, type LayerKind } from '../lib/overlay.ts'
import { hasShown, markShown, REVEAL_TOTAL, revealSchedule } from '../lib/reveal.ts'
import type { TrayView } from '../lib/tray.ts'
import { color, motion, radius, space, text, weight } from '../tokens.stylex.ts'

/** Contour tints by element (identity, never status); `liquid` follows the container's direction. */
const TINT: Record<Exclude<LayerKind, 'liquid'>, string> & { in: string; out: string } = {
  container: color.bg,
  dish: CATEGORY_HUE.food,
  // Food on a dish: the validated tray slot (CATEGORY_HUE.urine's amber) at 28 %.
  food: SLOT[3],
  drink: CATEGORY_HUE.water,
  in: color.intake,
  out: color.output,
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** `M10 8L40 8…` in percent of both sides, to user units of a `0 0 100 100k` viewBox (k = height / width), so strokes stay round. */
/** Scales every y by k. Paths must use only absolute M, L and Z (pairs of numbers); H and V would shift the pairing. */
const toUser = (d: string, k: number) => {
  let i = 0
  return d.replace(/-?\d+(?:\.\d+)?/g, (n) => (i++ % 2 === 1 ? String(Math.round(Number(n) * k * 100) / 100) : n))
}

/** A fraction of the signature duration, as CSS, so reduced motion (0ms) zeroes it too. */
const sig = (ms: number) => `calc(${motion.signature} * ${(ms / REVEAL_TOTAL).toFixed(4)})`

export function SegmentOverlay({
  src,
  seg,
  alt,
  container = null,
  drink = null,
  tray = null,
  outline = true,
  fit = 'inline',
  reveal = null,
  caption,
}: {
  src: string
  seg: Segmentation | null
  /** Used when the overlay cannot name what SAM outlined (a tray, or no container kind). */
  alt: string
  /** The read's container kind: names the container and tints the liquid by direction. */
  container?: ContainerKind | null
  /** The entry's or draft's drink kind: names the liquid. */
  drink?: DrinkKind | null
  /** A tray photo's dish regions and what names them. */
  tray?: TrayView | null
  outline?: boolean
  /** `inline` (up to 360 px high), `peek` (up to 260 px, in a peek), `screen` (the whole photo in the viewport) or `natural` (its own pixel size). */
  fit?: 'inline' | 'peek' | 'screen' | 'natural'
  /** A key for the first-show reveal (`media:<id>` or the capture's blob); null never animates. */
  reveal?: string | object | null
  caption?: ReactNode
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(0)
  useLayoutEffect(() => {
    const el = frame.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setShown(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const view = size ? overlayView({ seg, image: { width: size.w, height: size.h }, container, drink, tray, on: outline }) : null
  // Decided once per mount: only a photo's first show traces in.
  const [animate] = useState(() => reveal !== null && !reducedMotion() && !hasShown(reveal))
  useEffect(() => {
    if (reveal !== null) markShown(reveal)
  }, [reveal])
  const schedule = view ? revealSchedule(animate ? view.layers.map((l) => l.kind) : [], !animate) : null
  const k = size ? size.h / size.w : 1
  // Stroke widths in px of the shown photo: one user unit is shown / 100 px.
  const px = (n: number) => (shown > 0 ? (n * 100) / shown : n * 0.3)
  const named = container && !tray?.segmentation?.regions.length ? overlayAlt(seg, container, drink) : alt
  const steps = schedule?.steps ?? []
  const animated = steps.length > 0
  return (
    <figure {...stylex.props(s.figure, fit !== 'inline' && fit !== 'peek' && s.figureFull)}>
      <div ref={frame} {...stylex.props(s.frame, fit !== 'inline' && fit !== 'peek' && s.frameFull)}>
        <img
          src={src}
          alt={named}
          onLoad={(e) => setSize(originalSize(src) ?? { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          {...stylex.props(fit === 'inline' ? s.img : fit === 'peek' ? s.imgPeek : fit === 'screen' ? s.imgScreen : s.imgNatural)}
        />
        {view && view.mode !== 'none' && (
          <>
            <svg viewBox={`0 0 100 ${100 * k}`} preserveAspectRatio="none" aria-hidden {...stylex.props(s.svg)}>
              {view.dim && (
                <path
                  d={toUser(view.dim, k)}
                  fillRule="evenodd"
                  {...stylex.props(s.dim, animated && s.fadeIn)}
                  style={animated ? { animationDuration: sig(160) } : undefined}
                />
              )}
              {view.layers.map((l, i) => {
                const d = toUser(l.d, k)
                const step = steps[i]
                const tint = l.kind === 'liquid' ? TINT[view.layerTone] : TINT[l.kind]
                const timing = step ? { animationDelay: sig(step.delay), animationDuration: sig(step.duration) } : undefined
                if (l.kind === 'food')
                  return (
                    <path key={l.key} d={d} fillRule="evenodd" fill={tint} {...stylex.props(s.food, step && s.fadeIn)} style={timing} />
                  )
                return (
                  <g key={l.key}>
                    <path d={d} fillRule="evenodd" strokeWidth={px(6)} {...stylex.props(s.halo, step && s.fadeIn)} style={timing} />
                    <path
                      d={d}
                      fillRule="evenodd"
                      stroke={tint}
                      strokeWidth={px(2)}
                      pathLength={step ? 1 : undefined}
                      {...stylex.props(s.contour, step && s.trace)}
                      style={timing}
                    />
                  </g>
                )
              })}
              {view.surface && (
                <line
                  x1={view.surface.x1}
                  x2={view.surface.x2}
                  y1={view.surface.y * k}
                  y2={view.surface.y * k}
                  strokeWidth={px(1.5)}
                  strokeDasharray={`${px(4)} ${px(2)}`}
                  {...stylex.props(s.surface, animated && s.drop)}
                  style={animated ? { animationDelay: sig(steps.at(-1)!.delay + 120), animationDuration: sig(160) } : undefined}
                />
              )}
            </svg>
            <div {...stylex.props(s.labels)}>
              {view.labels.map((l) => (
                <span
                  key={l.key}
                  {...stylex.props(s.label, l.kind === 'liquid' && s.labelBelow, animated && s.fadeIn)}
                  // Kept inside the photo: a label near the right edge wraps before its volume instead of widening the page.
                  style={{
                    left: `${l.left}%`,
                    top: `${l.top}%`,
                    maxWidth: `calc(${100 - l.left}% - 4px)`,
                    ...(animated ? { animationDelay: sig(schedule!.labelsAt), animationDuration: sig(schedule!.labelsFor) } : {}),
                  }}
                >
                  {l.lines.map((line) => (
                    <span key={line} {...stylex.props(s.line)}>
                      {/* Wraps only before `≈`, so a narrow photo shows the volume on a second line, never an ellipsis. */}
                      {line.replace(/ (?!≈)/g, '\u00a0')}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {caption && (fit === 'inline' || fit === 'peek') && <figcaption {...stylex.props(s.caption)}>{caption}</figcaption>}
    </figure>
  )
}

const trace = stylex.keyframes({ from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 } })
const fade = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
const drop = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(-4px)' }, to: { opacity: 1, transform: 'none' } })

const s = stylex.create({
  figure: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0 },
  figureFull: { alignItems: 'center' },
  frame: {
    position: 'relative',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    lineHeight: 0,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.subtle,
  },
  frameFull: { alignSelf: 'center', maxWidth: 'none', borderRadius: 0 },
  img: { display: 'block', maxWidth: '100%', maxHeight: 360 },
  imgPeek: { display: 'block', maxWidth: '100%', maxHeight: 260 },
  imgScreen: { display: 'block', maxWidth: '100%', maxHeight: 'calc(100dvh - 120px)', objectFit: 'contain' },
  imgNatural: { display: 'block', maxWidth: 'none' },
  svg: { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' },
  // fg at 42 % outside the container, so the subject stays bright.
  dim: { fill: color.fg, fillOpacity: 0.42, stroke: 'none' },
  halo: { fill: 'none', stroke: color.bg, strokeOpacity: 0.55, strokeLinejoin: 'round' },
  contour: { fill: 'none', strokeLinejoin: 'round', strokeLinecap: 'round' },
  food: { fillOpacity: 0.28, stroke: 'none' },
  surface: { stroke: color.bg },
  trace: {
    strokeDasharray: 1,
    animationName: trace,
    animationTimingFunction: motion.ease,
    animationFillMode: 'backwards',
  },
  fadeIn: { animationName: fade, animationTimingFunction: motion.ease, animationFillMode: 'backwards' },
  drop: { animationName: drop, animationTimingFunction: motion.ease, animationFillMode: 'backwards' },
  labels: { position: 'absolute', inset: 0, pointerEvents: 'none', lineHeight: 'normal' },
  // xs/600 bg text on an fg tag at 90 %, radius.sm; never coloured text on the photo.
  label: {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    marginTop: space.xs,
    marginLeft: space.xs,
    paddingBlock: space.xs,
    paddingInline: space.sm,
    borderRadius: radius.sm,
    backgroundColor: `color-mix(in srgb, ${color.fg} 90%, transparent)`,
    color: color.bg,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: text.leadingTight,
  },
  labelBelow: { marginTop: space.sm },
  line: { whiteSpace: 'normal' },
  caption: { fontSize: text.xs, color: color.muted },
})
