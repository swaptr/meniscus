import { useEffect, useState, type CSSProperties } from 'react'
import * as stylex from '@stylexjs/stylex'
import { URINE_REFERENCE, type UrineColour } from '@meniscus/shared'
import {
  BITE_AT_MS,
  BITES,
  coverageText,
  draftText,
  emptiedText,
  LANDING_COPY,
  LANDING_READS,
  measureText,
  nextRead,
  pickColour,
  readMs,
  trayDraft,
  type LandingRead,
} from '../lib/landing.ts'
import { color, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { CheckIcon, DropIcon, MealIcon } from './icons.tsx'

/**
 * Geometry of each read in the 240 × 240 frame: the container's outline (and inner wall, for the glass), its bounding
 * box, and `fill`: the y of the container empty and full. Levels are drawn at the read's shares of `fill`, and the
 * labels and chip say `capacity × share`, so what is written is what is drawn.
 */
type Geo = { shape: string; inner?: string; box: readonly [number, number, number, number]; fill: readonly [number, number] }
const GEO: Record<LandingRead['kind'], Geo> = {
  bag: {
    shape: 'M72 34 H168 Q186 34 186 52 V160 Q186 180 166 184 L134 192 V206 H106 V192 L74 184 Q54 180 54 160 V52 Q54 34 72 34 Z',
    box: [54, 34, 186, 206],
    fill: [186, 40],
  },
  iv: {
    shape: 'M86 24 H154 Q168 24 168 38 V138 Q168 154 152 158 L132 164 V172 H108 V164 L88 158 Q72 154 72 138 V38 Q72 24 86 24 Z',
    box: [72, 24, 168, 172],
    fill: [156, 30],
  },
  cup: {
    shape: 'M70 50 H170 L159 194 Q158 202 150 202 H90 Q82 202 81 194 Z',
    inner: 'M75 54 H165 L155 192 Q154 197 149 197 H91 Q86 197 85 192 Z',
    box: [70, 50, 170, 202],
    fill: [197, 54],
  },
  tray: {
    shape: 'M38 70 H202 Q214 70 214 82 V174 Q214 186 202 186 H38 Q26 186 26 174 V82 Q26 70 38 70 Z',
    box: [26, 70, 214, 186],
    fill: [186, 70],
  },
}

/** The y of a level at `share` of the container. */
const levelY = (g: Geo, share: number) => g.fill[0] - share * (g.fill[0] - g.fill[1])

/** The glass's inner right wall at y (it tapers 10 px over its 138 px height), for the graduation ticks. */
const cupWallX = (y: number) => 165 - (10 * (y - 54)) / 138

/** The plate, its food in four portions of a quarter each. */
const PLATE = { cx: 112, cy: 128, r: 50, food: 36 } as const
const portion = (k: number) => {
  const { cx, cy, food: r } = PLATE
  const a0 = ((-90 + 90 * k) * Math.PI) / 180
  const a1 = ((-90 + 90 * (k + 1)) * Math.PI) / 180
  const f = (n: number) => n.toFixed(2)
  return `M${cx} ${cy} L${f(cx + r * Math.cos(a0))} ${f(cy + r * Math.sin(a0))} A${r} ${r} 0 0 1 ${f(cx + r * Math.cos(a1))} ${f(cy + r * Math.sin(a1))} Z`
}

/** A surface wave four periods longer than the frame, so a 240 px slide loops without a seam. */
const wave = (amp: number) => `M0 0 Q15 ${-amp} 30 0 ${Array.from({ length: 15 }, (_, k) => `T${60 + k * 30} 0`).join(' ')} V260 H0 Z`
const WAVE_FRONT = wave(4)
const WAVE_BACK = wave(-3)

/** Frame units to the stage: across, of its width; down, of its height (the stage is 1.18 times as tall as wide). */
const STAGE_H = 240 * 1.18
const pct = (v: number) => `${(v / 240) * 100}%`
const pctY = (v: number) => `${(v / STAGE_H) * 100}%`

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * One frame that plays a read at a time and crossfades to the next: the contents move (a bag fills, an IV bag drains,
 * a glass is drunk, a lunch is eaten bite by bite), then SAM 3.1 detects, outlines and measures it, then Muse Spark's
 * draft chip appears. Under reduced motion the cycle does not run and the first read is one still, finished frame.
 */
export function LandingHero() {
  const [i, setI] = useState(0)
  const [colour, setColour] = useState<UrineColour>(() => pickColour(Math.random()))
  const read = LANDING_READS[i]!
  useEffect(() => {
    if (reducedMotion()) return
    const t = window.setTimeout(() => {
      const n = nextRead(i)
      // Each time the bag comes round, a new urine colour from the app's scale.
      if (n === 0) setColour(pickColour(Math.random()))
      setI(n)
    }, readMs(read))
    return () => window.clearTimeout(t)
  }, [i, read])
  return (
    <figure {...stylex.props(h.figure)} role="img" aria-label={LANDING_COPY.illustration}>
      <div {...stylex.props(h.card)}>
        <Stage key={`${read.kind}-${i}-${colour}`} read={read} colour={colour} />
        <ol {...stylex.props(h.steps)} aria-hidden>
          {LANDING_READS.map((r, k) => (
            <li key={r.kind} {...stylex.props(h.stepPill, k === i && h.stepPillOn)}>
              {r.name}
            </li>
          ))}
        </ol>
      </div>
    </figure>
  )
}

function Stage({ read, colour }: { read: LandingRead; colour: UrineColour }) {
  const g = GEO[read.kind]
  const bag = read.kind === 'bag'
  const tray = read.kind === 'tray'
  const urine = bag ? { fill: URINE_REFERENCE[colour] } : undefined
  const [x1, y1, x2, y2] = g.box
  const out = read.direction === 'output'
  const empty = g.fill[0]
  const toY = levelY(g, read.to)
  // The plate's portions go one bite at a time; the drawing, the coverage label and the chip all read `eaten`.
  const [eaten, setEaten] = useState(() => (tray && reducedMotion() ? BITES : 0))
  useEffect(() => {
    if (!tray || reducedMotion()) return
    const ts = BITE_AT_MS.map((ms, k) => window.setTimeout(() => setEaten(k + 1), ms))
    return () => ts.forEach((t) => window.clearTimeout(t))
  }, [tray])
  const vars = {
    '--from': `${levelY(g, read.from)}px`,
    '--to': `${toY}px`,
    '--rest': `${levelY(g, read.rest)}px`,
    '--scan': `${y2 - y1}px`,
  } as CSSProperties
  const L = 14
  const p = 6
  const [bx1, by1, bx2, by2] = [x1 - p, y1 - p, x2 + p, y2 + p]
  const brackets = `M${bx1} ${by1 + L} V${by1} H${bx1 + L} M${bx2 - L} ${by1} H${bx2} V${by1 + L} M${bx2} ${by2 - L} V${by2} H${bx2 - L} M${bx1 + L} ${by2} H${bx1} V${by2 - L}`
  const clip = `hero-clip-${read.kind}`
  const below = `hero-below-${read.kind}`
  const wall = g.inner ?? g.shape
  return (
    <div {...stylex.props(h.stage, h.cycle, bag && h.cycleLong)} style={vars}>
      <svg viewBox="0 0 240 240" {...stylex.props(h.svg)} aria-hidden focusable="false">
        <defs>
          <clipPath id={clip}>
            <path d={wall} />
          </clipPath>
          <clipPath id={below}>
            <rect x={0} y={toY} width={240} height={240 - toY} />
          </clipPath>
        </defs>

        {/* The container and what is in it. */}
        {tray ? <Tray eaten={eaten} /> : read.kind === 'cup' ? <Glass /> : <path d={g.shape} {...stylex.props(h.vessel)} />}
        {!tray && (
          <g clipPath={`url(#${clip})`}>
            <g {...stylex.props(h.level, bag && h.levelBag, read.kind === 'iv' && h.levelSlow)}>
              <g {...stylex.props(h.slosh)}>
                <path d={WAVE_BACK} {...stylex.props(h.waveBack, out ? h.liquidOut : h.liquidIn)} style={urine} />
                <path d={WAVE_FRONT} {...stylex.props(h.waveFront, out ? h.liquidOut : h.liquidIn)} style={urine} />
              </g>
            </g>
          </g>
        )}
        {read.kind === 'cup' && <GlassFront />}
        {read.kind === 'iv' && <Drip />}

        {/* Detect: a scan sweeps once, then the box. */}
        <g {...stylex.props(h.scan)} transform={`translate(0 ${y1})`}>
          <g {...stylex.props(h.scanMove)}>
            <rect x={x1} y={-14} width={x2 - x1} height={14} {...stylex.props(h.scanBand)} />
            <line x1={x1} x2={x2} y1={0} y2={0} strokeWidth={1.5} {...stylex.props(h.scanLine)} />
          </g>
        </g>
        <path d={brackets} fill="none" strokeWidth={2.5} strokeLinecap="round" {...stylex.props(h.brackets, h.lockOn)} />

        {/* Outline: the container's mask, then the region inside it. */}
        <path d={g.shape} {...stylex.props(h.mask, h.fade, h.atMask)} />
        <path
          d={g.shape}
          pathLength={1}
          fill="none"
          strokeWidth={2.5}
          strokeLinejoin="round"
          {...stylex.props(h.trace, h.traceBox, h.atOutline)}
        />
        <g {...stylex.props(bag && h.untilEmptied)}>
          {tray ? (
            <circle
              cx={PLATE.cx}
              cy={PLATE.cy}
              r={PLATE.food + 4}
              pathLength={1}
              fill="none"
              strokeWidth={2.5}
              {...stylex.props(h.trace, h.traceIn, h.atRegion)}
            />
          ) : (
            <g clipPath={`url(#${below})`}>
              <path d={wall} {...stylex.props(out ? h.regionOut : h.regionIn, h.fade, h.atRegion)} />
              <path
                d={wall}
                pathLength={1}
                fill="none"
                strokeWidth={2}
                strokeDasharray="0.03 0.015"
                {...stylex.props(h.trace, out ? h.traceOut : h.traceIn, h.atRegion)}
              />
            </g>
          )}

          {/* Measure: a scale from empty to full in quarters, the surface, and a span from the bottom up to it. */}
          {!tray && (
            <g {...stylex.props(h.fade, h.atMeasure)}>
              {[0, 0.25, 0.5, 0.75, 1].map((share) => (
                <line
                  key={share}
                  x1={x2 + 8}
                  x2={x2 + (share === 0.5 ? 16 : 13)}
                  y1={levelY(g, share)}
                  y2={levelY(g, share)}
                  strokeWidth={1.5}
                  {...stylex.props(h.tick)}
                />
              ))}
              <line x1={x1} x2={x2 + 16} y1={toY} y2={toY} strokeWidth={1} strokeDasharray="3 3" {...stylex.props(h.surface)} />
              <path
                d={`M${x2 + 20} ${empty} V${toY} M${x2 + 16} ${toY} H${x2 + 24} M${x2 + 16} ${empty} H${x2 + 24}`}
                pathLength={1}
                fill="none"
                strokeWidth={2}
                {...stylex.props(h.trace, out ? h.traceOut : h.traceIn, h.atMeasure)}
              />
            </g>
          )}
        </g>
      </svg>

      <span {...stylex.props(h.label, h.detect, h.pop, h.atLabel)} style={{ left: pct(x1 - 6), bottom: pctY(STAGE_H - y1 + 10) }}>
        {read.detect}
      </span>
      <span {...stylex.props(h.overlay, bag && h.untilEmptied)}>
        <span
          {...stylex.props(h.label, out ? h.regionLabelOut : h.regionLabelIn, h.pop, h.atRegionLabel)}
          style={{ left: pct(tray ? PLATE.cx - 54 : x1 + 8), top: pctY(tray ? y2 + 10 : Math.min(toY + 8, empty - 22)) }}
        >
          {tray ? `${read.region} · ${coverageText(eaten)}` : read.region}
        </span>
        {!tray && (
          <span {...stylex.props(h.label, h.measure, h.pop, h.atMeasureLabel)} style={{ right: pct(240 - x2 - 24), top: pctY(y2 + 10) }}>
            {measureText(read)}
          </span>
        )}
      </span>

      <span {...stylex.props(h.chipAt)}>
        <span {...stylex.props(h.chipSlot)}>
          <span {...stylex.props(h.chip, bag ? h.chipUntilEmptied : [h.pop, tray ? h.atChipEarly : h.atChip])}>
            <span {...stylex.props(h.chipIcon, out ? h.chipIconOut : h.chipIconIn)}>
              {tray ? <MealIcon size={16} aria-hidden /> : <DropIcon size={16} aria-hidden />}
            </span>
            <span {...stylex.props(h.chipText)}>
              <span {...stylex.props(h.chipLabel)}>{LANDING_COPY.chipLabel}</span>
              <span {...stylex.props(h.chipValue)}>{tray ? trayDraft(eaten) : draftText(read, colour)}</span>
            </span>
          </span>
          {bag && (
            <span {...stylex.props(h.chip, h.chipEmptied)}>
              <span {...stylex.props(h.chipIcon, h.chipIconOk)}>
                <CheckIcon size={16} aria-hidden />
              </span>
              <span {...stylex.props(h.chipText)}>
                <span {...stylex.props(h.chipLabel)}>{LANDING_COPY.chipLabel}</span>
                <span {...stylex.props(h.chipValue)}>{emptiedText(read)}</span>
              </span>
            </span>
          )}
        </span>
      </span>
    </div>
  )
}

/** A tapered tumbler behind the water: the glass, its inner wall, and faint graduation ticks at each quarter. */
function Glass() {
  return (
    <g>
      <path d={GEO.cup.shape} {...stylex.props(h.glass)} />
      <path d={GEO.cup.inner} {...stylex.props(h.glassInner)} />
      {[0.25, 0.5, 0.75].map((share) => {
        const y = levelY(GEO.cup, share)
        const x = cupWallX(y)
        return <line key={share} x1={x - 10} x2={x - 2} y1={y} y2={y} strokeWidth={1} {...stylex.props(h.graduation)} />
      })}
    </g>
  )
}

/** The glass in front of the water: the rim and a highlight down the left wall. */
function GlassFront() {
  return (
    <g>
      <ellipse cx={120} cy={52} rx={48} ry={3.5} strokeWidth={1.5} {...stylex.props(h.rim)} />
      <line x1={82} y1={64} x2={91} y2={184} strokeWidth={3} strokeLinecap="round" {...stylex.props(h.highlight)} />
    </g>
  )
}

/** The IV bag's drip chamber, a drop falling in it again and again, and the line out. */
function Drip() {
  return (
    <g>
      <rect x={110} y={176} width={20} height={26} rx={5} {...stylex.props(h.chamber)} />
      <circle cx={120} cy={181} r={3} {...stylex.props(h.drop)} />
      <circle cx={120} cy={181} r={3} {...stylex.props(h.drop, h.dropLate)} />
      <rect x={113} y={196} width={14} height={5} rx={2} {...stylex.props(h.pool)} />
      <line x1={120} x2={120} y1={202} y2={232} strokeWidth={3} {...stylex.props(h.tube)} />
      <line x1={120} x2={120} y1={202} y2={232} strokeWidth={3} {...stylex.props(h.tubeFlow)} />
    </g>
  )
}

/** A lunch tray whose four portions go a bite at a time: `eaten` of them are gone, the rest is what the labels read. */
function Tray({ eaten }: { eaten: number }) {
  return (
    <g>
      <path d={GEO.tray.shape} {...stylex.props(h.vessel)} />
      <circle cx={PLATE.cx} cy={PLATE.cy} r={PLATE.r} {...stylex.props(h.plate)} />
      <circle cx={PLATE.cx} cy={PLATE.cy} r={PLATE.food + 4} {...stylex.props(h.plateRim)} />
      {[0, 1, 2, 3].map((k) => (
        <path key={k} d={portion(k)} strokeWidth={2} {...stylex.props(h.portion, k % 2 ? h.foodDark : h.food, k < eaten && h.bite)} />
      ))}
      <ellipse cx={186} cy={98} rx={7} ry={10} {...stylex.props(h.spoon)} />
      <line x1={186} x2={186} y1={108} y2={164} strokeWidth={4} strokeLinecap="round" {...stylex.props(h.spoon)} />
    </g>
  )
}

const REDUCE = '@media (prefers-reduced-motion: reduce)'

// Only opacity, transform and stroke-dashoffset move (DESIGN.md 2.8); every animation is `none` under reduced motion,
// and each element's resting style is the finished read, so reduced motion shows one still frame.
const cycle = stylex.keyframes({
  '0%': { opacity: 0 },
  '5%': { opacity: 1 },
  '94%': { opacity: 1 },
  '100%': { opacity: 0 },
})
const levelMove = stylex.keyframes({ from: { transform: 'translateY(var(--from))' }, to: { transform: 'translateY(var(--to))' } })
const slide = stylex.keyframes({ from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-240px)' } })
const slideBack = stylex.keyframes({ from: { transform: 'translateX(-240px)' }, to: { transform: 'translateX(0)' } })
const sway = stylex.keyframes({
  '0%': { transform: 'rotate(-1.2deg)' },
  '50%': { transform: 'rotate(1.2deg)' },
  '100%': { transform: 'rotate(-1.2deg)' },
})
const sweep = stylex.keyframes({
  '0%': { opacity: 0, transform: 'translateY(0)' },
  '12%': { opacity: 1 },
  '85%': { opacity: 1, transform: 'translateY(var(--scan))' },
  '100%': { opacity: 0, transform: 'translateY(var(--scan))' },
})
// The SAM box locks on: corners close in from wide while flickering, overshoot a touch, then settle.
const lockOn = stylex.keyframes({
  '0%': { opacity: 0, transform: 'scale(1.35)' },
  '20%': { opacity: 0.7, transform: 'scale(1.3)' },
  '30%': { opacity: 0.2, transform: 'scale(1.24)' },
  '40%': { opacity: 0.9, transform: 'scale(1.18)' },
  '50%': { opacity: 0.4, transform: 'scale(1.1)' },
  '62%': { opacity: 1, transform: 'scale(1.02)' },
  '78%': { opacity: 1, transform: 'scale(0.97)' },
  '100%': { opacity: 1, transform: 'scale(1)' },
})
const traceOn = stylex.keyframes({ from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 } })
const fadeIn = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })
const popIn = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(4px) scale(0.96)' }, to: { opacity: 1, transform: 'none' } })
const fall = stylex.keyframes({
  '0%': { opacity: 0, transform: 'translateY(0) scale(0.2)' },
  '40%': { opacity: 1, transform: 'translateY(0) scale(1)' },
  '55%': { opacity: 1, transform: 'translateY(0) scale(1)' },
  '90%': { opacity: 1, transform: 'translateY(12px) scale(1)' },
  '100%': { opacity: 0, transform: 'translateY(13px) scale(1)' },
})
const pulse = stylex.keyframes({
  '0%': { opacity: 0 },
  '50%': { opacity: 0.6 },
  '100%': { opacity: 0 },
})
const fillThenEmpty = stylex.keyframes({
  '0%': { transform: 'translateY(var(--from))' },
  '20%': { transform: 'translateY(var(--to))' },
  '72%': { transform: 'translateY(var(--to))' },
  '84%': { transform: 'translateY(var(--rest))' },
  '100%': { transform: 'translateY(var(--rest))' },
})
const holdThenHide = stylex.keyframes({
  '0%': { opacity: 1 },
  '72%': { opacity: 1 },
  '76%': { opacity: 0 },
  '100%': { opacity: 0 },
})
const chipThenHide = stylex.keyframes({
  '0%': { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
  '52%': { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
  '57%': { opacity: 1, transform: 'none' },
  '72%': { opacity: 1, transform: 'none' },
  '76%': { opacity: 0, transform: 'translateY(-4px)' },
  '100%': { opacity: 0, transform: 'translateY(-4px)' },
})
const emptiedIn = stylex.keyframes({
  '0%': { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
  '84%': { opacity: 0, transform: 'translateY(4px) scale(0.96)' },
  '89%': { opacity: 1, transform: 'none' },
  '100%': { opacity: 1, transform: 'none' },
})
const biteOff = stylex.keyframes({ from: { opacity: 1, transform: 'scale(1)' }, to: { opacity: 0, transform: 'scale(0.4)' } })

const h = stylex.create({
  figure: { margin: 0, minWidth: 0 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    padding: { default: space.xl, '@media (max-width: 520px)': space.lg },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
    backgroundSize: '20px 20px',
    boxShadow: shadow.raised,
  },
  stage: { position: 'relative', width: '100%', maxWidth: 400, marginInline: 'auto', aspectRatio: '1 / 1.18' }, // as STAGE_H
  cycle: {
    animationName: { default: cycle, [REDUCE]: 'none' },
    animationDuration: '6.5s', // motion-ok: one read on screen, faded in and out (readMs)
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  svg: { position: 'absolute', insetInline: 0, top: 0, width: '100%', height: 'auto', overflow: 'visible' },
  vessel: { fill: color.subtle, stroke: color.borderStrong, strokeWidth: 1.5 },
  glass: { fill: color.subtle, fillOpacity: 0.6, stroke: color.borderStrong, strokeWidth: 1.5, strokeLinejoin: 'round' },
  glassInner: { fill: color.bg, stroke: color.border, strokeWidth: 1 },
  graduation: { stroke: color.borderStrong, opacity: 0.5 },
  rim: { fill: 'none', stroke: color.borderStrong },
  highlight: { stroke: color.bg, opacity: 0.8 },
  surface: { stroke: color.fg, opacity: 0.35 },
  chamber: { fill: color.bg, stroke: color.borderStrong, strokeWidth: 1.5 },
  tube: { stroke: color.borderStrong },
  tick: { stroke: color.borderStrong },
  plate: { fill: color.bg, stroke: color.border, strokeWidth: 1.5 },
  plateRim: { fill: 'none', stroke: color.grid, strokeWidth: 1.5 },
  portion: { stroke: color.bg, transformBox: 'fill-box', transformOrigin: 'center' },
  food: { fill: color.intake1 },
  foodDark: { fill: color.intake2 },
  spoon: { fill: color.borderStrong, stroke: color.borderStrong },
  liquidIn: { fill: color.intake1 },
  liquidOut: { fill: color.output1 },
  cycleLong: { animationDuration: '9s' }, // motion-ok: the urine bag's read, then it is emptied (readMs)
  levelBag: {
    animationName: { default: fillThenEmpty, [REDUCE]: 'none' },
    animationDuration: '9s', // motion-ok: filled, read, then emptied to a residual
    animationDelay: '0s', // motion-ok: one timeline with the frame
  },
  levelSlow: {
    animationDuration: '5.6s', // motion-ok: the IV bag draining slowly
    animationTimingFunction: 'linear',
  },
  untilEmptied: {
    animationName: { default: holdThenHide, [REDUCE]: 'none' },
    animationDuration: '9s', // motion-ok: the read's marks clear as the bag is emptied
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  overlay: { position: 'absolute', inset: 0 },
  chipSlot: { display: 'grid', justifyItems: 'center' },
  chipUntilEmptied: {
    gridRow: 1,
    gridColumn: 1,
    animationName: { default: chipThenHide, [REDUCE]: 'none' },
    animationDuration: '9s', // motion-ok: the read's draft, until the bag is emptied
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  chipEmptied: {
    gridRow: 1,
    gridColumn: 1,
    opacity: 0,
    animationName: { default: emptiedIn, [REDUCE]: 'none' },
    animationDuration: '9s', // motion-ok: the emptying charted, hidden under reduced motion
    animationTimingFunction: 'linear',
    animationFillMode: 'both',
  },
  chipIconOk: { backgroundColor: color.okBg, color: color.ok },
  pool: { fill: color.intake1 },
  tubeFlow: {
    stroke: color.intake,
    opacity: 0,
    animationName: { default: pulse, [REDUCE]: 'none' },
    animationDuration: '1.2s', // motion-ok: the line pulsing with each drop, absent under reduced motion
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  level: {
    transform: 'translateY(var(--to))',
    animationName: { default: levelMove, [REDUCE]: 'none' },
    animationDuration: '1.8s', // motion-ok: the level rising or falling, the read's first beat
    animationDelay: '0.2s', // motion-ok: once the frame is in
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  slosh: {
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: { default: sway, [REDUCE]: 'none' },
    animationDuration: '2.6s', // motion-ok: a slight slosh, still under reduced motion
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
  waveFront: {
    opacity: 0.85,
    animationName: { default: slide, [REDUCE]: 'none' },
    animationDuration: '3.2s', // motion-ok: the travelling surface, still under reduced motion
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  waveBack: {
    opacity: 0.45,
    animationName: { default: slideBack, [REDUCE]: 'none' },
    animationDuration: '4.6s', // motion-ok: the slower back wave, for depth
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  },
  drop: {
    fill: color.intake,
    opacity: 0,
    animationName: { default: fall, [REDUCE]: 'none' },
    animationDuration: '1.2s', // motion-ok: the IV drip, absent under reduced motion
    animationTimingFunction: 'ease-in',
    animationIterationCount: 'infinite',
  },
  dropLate: { animationDelay: '0.6s' }, // motion-ok: two drops, half a beat apart
  bite: {
    opacity: 0,
    animationName: { default: biteOff, [REDUCE]: 'none' },
    animationDuration: '0.36s', // motion-ok: one bite, as `eaten` counts it
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  scan: { opacity: 1 },
  scanMove: {
    opacity: 0,
    animationName: { default: sweep, [REDUCE]: 'none' },
    animationDuration: '0.9s', // motion-ok: the detection scan, once
    animationDelay: '2s', // motion-ok: once the contents have moved
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  scanBand: { fill: color.accent, opacity: 0.12 },
  scanLine: { stroke: color.accent },
  brackets: { stroke: color.accent, transformBox: 'fill-box', transformOrigin: 'center' },
  mask: { fill: color.accent, fillOpacity: 0.08 },
  regionIn: { fill: color.intake, fillOpacity: 0.14 },
  regionOut: { fill: color.output, fillOpacity: 0.16 },
  trace: {
    strokeDasharray: 1,
    strokeDashoffset: 0,
    animationName: { default: traceOn, [REDUCE]: 'none' },
    animationDuration: '0.8s', // motion-ok: an outline drawn on, as SAM finds it
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  traceBox: { stroke: color.accent },
  traceIn: { stroke: color.intake },
  traceOut: { stroke: color.output },
  fade: {
    animationName: { default: fadeIn, [REDUCE]: 'none' },
    animationDuration: motion.signature,
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  pop: {
    animationName: { default: popIn, [REDUCE]: 'none' },
    animationDuration: motion.signature,
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  lockOn: {
    animationName: { default: lockOn, [REDUCE]: 'none' },
    animationDuration: '1.1s', // motion-ok: the box locking on while the scan sweeps
    animationDelay: '2s', // motion-ok: with the detection scan
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  atLabel: { animationDelay: '2.5s' }, // motion-ok: detect label
  atOutline: { animationDelay: '2.8s' }, // motion-ok: outline the container
  atMask: { animationDelay: '3s' }, // motion-ok: its mask
  atRegion: { animationDelay: '3.4s' }, // motion-ok: then the region inside it
  atRegionLabel: { animationDelay: '3.7s' }, // motion-ok: region label
  atMeasure: { animationDelay: '4s' }, // motion-ok: measure
  atMeasureLabel: { animationDelay: '4.3s' }, // motion-ok: the value read
  atChip: { animationDelay: '4.7s' }, // motion-ok: Muse Spark's draft
  atChipEarly: { animationDelay: '0.3s' }, // motion-ok: the lunch's draft, updated with each bite
  label: {
    position: 'absolute',
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: radius.sm,
    fontSize: text.xs,
    fontWeight: weight.bold,
    lineHeight: text.leadingTight,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  detect: { backgroundColor: color.accent, color: color.onAccent },
  regionLabelIn: { backgroundColor: color.intakeText, color: color.onAccent },
  regionLabelOut: { backgroundColor: color.outputText, color: color.onAccent },
  measure: { backgroundColor: color.tip, color: color.onTip },
  chipAt: { position: 'absolute', insetInline: 0, bottom: 0, display: 'flex', justifyContent: 'center' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    maxWidth: '100%',
    paddingBlock: space.sm,
    paddingInlineStart: space.sm,
    paddingInlineEnd: space.xl,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.pill,
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
  },
  chipIcon: { display: 'inline-grid', placeItems: 'center', width: 32, height: 32, flexShrink: 0, borderRadius: radius.pill },
  chipIconIn: { backgroundColor: color.intakeBg, color: color.intakeText },
  chipIconOut: { backgroundColor: color.outputBg, color: color.outputText },
  chipText: { display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: text.leadingTight },
  chipLabel: { fontSize: text.xs, fontWeight: weight.semibold, color: color.pending },
  chipValue: { fontSize: text.md, fontWeight: weight.bold, color: color.fg, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  steps: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, listStyle: 'none', padding: 0, margin: 0 },
  stepPill: {
    paddingBlock: space.xs,
    paddingInline: space.md,
    borderRadius: radius.pill,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
    backgroundColor: 'transparent',
    transitionProperty: 'background-color, color',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  stepPillOn: { backgroundColor: color.accentBg, color: color.accentStrong },
})
