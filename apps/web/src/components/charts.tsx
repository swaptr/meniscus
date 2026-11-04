import { clock } from '../lib/format.ts'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { breakdownTable } from '../lib/chart-text.ts'
import { rateMessage, roundHourTicks, URINE_THRESHOLD, type RatePoint, type Segment, type UrineRun } from '../lib/charts.ts'
import { CATEGORY_HUE } from '../lib/hues.ts'
import { CATEGORY_LABEL } from '../lib/labels.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import type { Swatch } from '../lib/urine.ts'
import { UrineDot, UrineSwatch } from './urine-swatch.tsx'
import { DrinkIcon } from './drink-label.tsx'
import { Segmented } from './segmented.tsx'
import { kindLabel } from '../lib/drinks.ts'

// Plot geometry: a fixed viewBox stretched to the box; text stays in HTML so it never stretches.
const W = 600
const H = 160
const DAY = 24 * 3_600_000

/** Neutral line for the urine rate; the points carry the urine's own colour. */
const RATE_LINE = color.borderStrong

const hhmm = (t: number) => clock(t)

/** Round-hour ticks on the rate chart's 24 h axis (the same rail as the balance timeline). */
function Ticks({ now }: { now: number }) {
  return (
    <div aria-hidden {...stylex.props(s.xTicks)}>
      {roundHourTicks(now)
        .map((t) => ({ ...t, at: (t.t - (now - DAY)) / DAY }))
        // The narrow rate chart: a tick within the last eighth would run into `Now`.
        .filter((t) => t.at < 0.875)
        .map((t) => (
          <span key={t.t} {...stylex.props(s.xTick)} style={{ left: `${t.at * 100}%` }}>
            {t.label}
          </span>
        ))}
      <span {...stylex.props(s.xTick, s.xTickNow)}>Now</span>
    </div>
  )
}

/** Hourly 6 h urine rate against the 0.5 mL/kg/h line. Points below it are hollow red diamonds: shape, not colour alone. */
export function RateChart({
  points,
  now,
  measured,
  seen = null,
}: {
  points: RatePoint[] | null
  now: number
  /** False while urine is not measured: no plot, rate, line or caption. */
  measured: boolean
  seen?: Swatch | null
}) {
  const [hover, setHover] = useState<RatePoint | null>(null)
  const head = (
    <figcaption {...stylex.props(s.head)}>
      <span {...stylex.props(s.title)}>Urine output rate</span>
      <span {...stylex.props(s.sub)}>mL/kg/h over the previous 6 h</span>
      {seen && (
        <span {...stylex.props(s.seen)}>
          Latest colour <UrineSwatch swatch={seen} size="sm" />
        </span>
      )}
    </figcaption>
  )
  const message = rateMessage(points, measured)
  if (message !== null || !points) {
    return (
      <figure {...stylex.props(s.figure)}>
        {head}
        <p {...stylex.props(s.empty)}>{message}</p>
      </figure>
    )
  }
  const max = Math.max(1, Math.ceil(Math.max(...points.map((p) => p.rate)) * 2) / 2)
  const x = (t: number) => ((t - (now - DAY)) / DAY) * W
  const y = (v: number) => H - (v / max) * H
  const last = points.at(-1)!
  const below = points.filter((p) => p.below).length
  return (
    <figure {...stylex.props(s.figure)}>
      {head}
      <div {...stylex.props(s.legend)}>
        <span {...stylex.props(s.key, last.below && s.danger)}>
          Now {last.rate.toFixed(2)}
          {last.below ? ' · below 0.5' : ''}
        </span>
        <span {...stylex.props(s.key)}>
          <span aria-hidden {...stylex.props(s.diamond)} /> {below} of {points.length} hours below 0.5
        </span>
      </div>
      <div {...stylex.props(s.plotWrap)}>
        <span aria-hidden {...stylex.props(s.yMax)}>
          {max}
        </span>
        <span aria-hidden {...stylex.props(s.thresholdLabel)} style={{ top: `${(y(URINE_THRESHOLD) / H) * 100}%` }}>
          0.5
        </span>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Urine output now ${last.rate.toFixed(2)} mL/kg/h; ${below} of ${points.length} hours below 0.5.`}
          onPointerLeave={() => setHover(null)}
          {...stylex.props(s.svg)}
        >
          <line
            x1={0}
            x2={W}
            y1={y(URINE_THRESHOLD)}
            y2={y(URINE_THRESHOLD)}
            {...stylex.props(s.threshold)}
            vectorEffect="non-scaling-stroke"
          />
          <polyline
            points={points.map((p) => `${x(p.t)},${y(p.rate)}`).join(' ')}
            fill="none"
            stroke={RATE_LINE}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p) => (
            // Wide invisible hit target per hour.
            <rect key={p.t} x={x(p.t) - W / 48} y={0} width={W / 24} height={H} fill="transparent" onPointerEnter={() => setHover(p)} />
          ))}
        </svg>
        {/* Markers in HTML so they stay round and >= 8 px under the stretched viewBox. */}
        {points.map((p) => (
          <span
            key={p.t}
            aria-hidden
            {...stylex.props(s.marker, p.below ? s.markerBelow : s.markerOk, hover?.t === p.t && s.markerHover)}
            // Filled with the urine colour seen by that hour; the outline keeps pale straw visible.
            style={{ left: `${(x(p.t) / W) * 100}%`, top: `${(y(p.rate) / H) * 100}%`, backgroundColor: p.fill }}
          />
        ))}
        {hover && (
          <div role="status" {...stylex.props(s.tip)} style={{ left: `${Math.min(70, (x(hover.t) / W) * 100)}%` }}>
            <strong>{hhmm(hover.t)}</strong>
            <span>
              {hover.rate.toFixed(2)} mL/kg/h{hover.below ? ' · below 0.5' : ''}
            </span>
            <span {...stylex.props(s.tipColour)}>
              <UrineDot fill={hover.fill} size={10} /> {hover.colour}
            </span>
          </div>
        )}
      </div>
      <Ticks now={now} />
    </figure>
  )
}

/** A segment's name: drinks by their kind (`Tea`, `Drink` with none), anything else by its category. */
const segLabel = (g: Segment) => (g.category === 'water' && g.drink !== undefined ? kindLabel(g.drink) : CATEGORY_LABEL[g.category])
const isDrink = (g: Segment) => g.category === 'water' && g.drink !== undefined
const segKey = (g: Segment) => `${g.category}:${g.drink ?? ''}`

function Bar({ label, segs, total, max, runs = [] }: { label: string; segs: Segment[]; total: number; max: number; runs?: UrineRun[] }) {
  /** Urine is drawn in the colours seen (runs, in charted order) instead of its category hue. */
  const urineFill = runs.at(-1)?.fill
  const describe = (g: Segment) =>
    g.category === 'urine' && runs.length
      ? `${CATEGORY_LABEL.urine} ${g.ml} mL (${runs.map((r) => `${r.label.toLowerCase()} ${r.ml} mL`).join(', ')})`
      : `${segLabel(g)} ${g.ml} mL`
  return (
    <div {...stylex.props(s.barRow)}>
      <span {...stylex.props(s.barLabel)}>
        {label} <strong>{total} mL</strong>
      </span>
      <div {...stylex.props(s.track)} role="img" aria-label={`${label}: ${segs.map(describe).join(', ') || 'none'}`}>
        {segs.map((g) =>
          g.category === 'urine' && runs.length ? (
            <span key={g.category} {...stylex.props(s.seg, s.runs)} style={{ width: `${(g.ml / max) * 100}%` }}>
              {runs.map((r, i) => (
                <span
                  key={i}
                  title={`${r.label} ${r.ml} mL`}
                  {...stylex.props(s.run)}
                  style={{ flexGrow: r.ml, backgroundColor: r.fill }}
                />
              ))}
            </span>
          ) : (
            <span
              key={segKey(g)}
              title={`${segLabel(g)} ${g.ml} mL`}
              {...stylex.props(s.seg, isDrink(g) && s.drinkSeg)}
              // Drinks share the one intake-family shade, told apart by icon and label, never by hue (DESIGN.md 2.1).
              style={{ width: `${(g.ml / max) * 100}%`, backgroundColor: isDrink(g) ? undefined : CATEGORY_HUE[g.category] }}
            />
          ),
        )}
      </div>
      <div {...stylex.props(s.segLabels)}>
        {segs.length === 0 && <span {...stylex.props(s.sub)}>Nothing approved</span>}
        {segs.map((g) => (
          <span key={segKey(g)} {...stylex.props(s.key)}>
            {g.category === 'urine' && urineFill ? (
              <UrineDot fill={urineFill} size={10} />
            ) : isDrink(g) ? (
              <DrinkIcon kind={g.drink ?? 'other'} size={14} />
            ) : (
              <span aria-hidden {...stylex.props(s.swatch)} style={{ backgroundColor: CATEGORY_HUE[g.category] }} />
            )}
            <span {...stylex.props(isDrink(g) && s.drinkText)}>
              {segLabel(g)} {g.ml} mL
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

/** Intake and output for 24 h as two stacked bars on one scale, each segment named with its mL; `Table` lists the same rows. */
export function StackBars({
  inSegs,
  outSegs,
  inTotal,
  outTotal,
  urineRuns = [],
}: {
  inSegs: Segment[]
  outSegs: Segment[]
  inTotal: number
  outTotal: number
  urineRuns?: UrineRun[]
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const max = Math.max(inTotal, outTotal, 1)
  const table = breakdownTable({ in: inSegs, out: outSegs })
  return (
    <figure {...stylex.props(s.figure)}>
      <figcaption {...stylex.props(s.head)}>
        <span {...stylex.props(s.title)}>What went in and out</span>
        <span {...stylex.props(s.sub)}>Approved, 24 h</span>
        <span {...stylex.props(s.grow)} />
        <Segmented
          label="Breakdown view"
          value={view}
          options={[
            ['chart', 'Chart'],
            ['table', 'Table'],
          ]}
          onChange={setView}
        />
      </figcaption>
      {view === 'chart' ? (
        <>
          <Bar label="In" segs={inSegs} total={inTotal} max={max} />
          <Bar label="Out" segs={outSegs} total={outTotal} max={max} runs={urineRuns} />
        </>
      ) : (
        <table {...stylex.props(s.table)}>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(s.th)}>
                What
              </th>
              <th scope="col" {...stylex.props(s.th, s.num)}>
                Approved
              </th>
            </tr>
          </thead>
          {(
            [
              ['In', table.in, inTotal],
              ['Out', table.out, outTotal],
            ] as const
          ).map(([dir, rows, total]) => (
            <tbody key={dir}>
              <tr>
                <th scope="rowgroup" {...stylex.props(s.td, s.group)}>
                  {dir}
                </th>
                <td {...stylex.props(s.td, s.num, s.group)}>{total} mL</td>
              </tr>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" {...stylex.props(s.td, s.rowHead)}>
                    {r.label}
                  </th>
                  <td {...stylex.props(s.td, s.num)}>{r.ml} mL</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      )}
    </figure>
  )
}

const s = stylex.create({
  figure: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, minWidth: 0 },
  head: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  title: { fontWeight: weight.bold, fontSize: text.md },
  sub: { fontSize: text.xs, color: color.muted },
  legend: { display: 'flex', flexWrap: 'wrap', gap: space.lg, fontSize: text.sm },
  key: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    color: color.fg,
    fontVariantNumeric: 'tabular-nums',
  },
  danger: { color: color.danger },
  swatch: { width: 10, height: 10, borderRadius: radius.sm },
  plotWrap: { position: 'relative', height: 160, marginInlineStart: 0 },
  svg: { display: 'block', width: '100%', height: '100%', overflow: 'visible', touchAction: 'pan-y' },
  threshold: { stroke: color.danger, strokeWidth: 1.5, strokeDasharray: '6 4' },
  yMax: { position: 'absolute', top: -2, left: 0, fontSize: text.xs, color: color.muted, pointerEvents: 'none' },
  thresholdLabel: {
    position: 'absolute',
    right: 0,
    transform: 'translateY(-120%)',
    fontSize: text.xs,
    fontWeight: weight.bold,
    color: color.danger,
    pointerEvents: 'none',
  },
  xTicks: { position: 'relative', height: 16, fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  xTick: { position: 'absolute', top: 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap' },
  xTickNow: { right: 0, transform: 'none', fontWeight: weight.semibold, color: color.fg },
  tip: {
    position: 'absolute',
    top: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.fg,
    color: color.bg,
    fontSize: text.xs,
    pointerEvents: 'none',
    whiteSpace: 'nowrap',
    transform: 'translateX(8px)',
  },
  marker: {
    position: 'absolute',
    width: 8,
    height: 8,
    transform: 'translate(-50%, -50%)',
    borderRadius: radius.pill,
    pointerEvents: 'none',
  },
  markerOk: {
    width: 10,
    height: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    boxShadow: `0 0 0 2px ${color.bg}`,
  },
  markerBelow: {
    width: 10,
    height: 10,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: color.danger,
    transform: 'translate(-50%, -50%) rotate(45deg)',
  },
  markerHover: { outline: `2px solid ${color.fg}`, outlineOffset: 1 },
  diamond: {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: color.danger,
    transform: 'rotate(45deg)',
  },
  empty: {
    display: 'grid',
    placeItems: 'center',
    height: 160,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.muted,
    fontWeight: weight.semibold,
  },
  barRow: { display: 'flex', flexDirection: 'column', gap: space.sm },
  barLabel: { fontSize: text.sm, color: color.muted },
  tipColour: { display: 'inline-flex', alignItems: 'center', gap: space.sm },
  runs: { display: 'flex', gap: space.xs },
  run: { flexBasis: 0, minWidth: 3, boxShadow: `inset 0 0 0 1px ${color.borderStrong}` },
  seen: { display: 'inline-flex', alignItems: 'center', gap: space.sm, marginInlineStart: 'auto', fontSize: text.xs, color: color.muted },
  track: { display: 'flex', gap: space.xs, height: 22, borderRadius: radius.md, backgroundColor: color.subtle, overflow: 'hidden' },
  seg: { height: '100%', borderRadius: radius.sm, minWidth: 3 },
  segLabels: { display: 'flex', flexWrap: 'wrap', gap: space.md },
  drinkSeg: { backgroundColor: color.intakeBg, borderWidth: 1, borderStyle: 'solid', borderColor: color.intake },
  drinkText: { color: color.intakeText },
  grow: { flexGrow: 1 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: text.sm, fontVariantNumeric: 'tabular-nums' },
  th: { padding: space.sm, textAlign: 'left', fontSize: text.xs, fontWeight: weight.semibold, color: color.muted },
  td: { paddingBlock: space.sm, paddingInline: space.sm, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: color.grid },
  rowHead: { textAlign: 'left', fontWeight: weight.regular, paddingInlineStart: space.xl },
  group: { textAlign: 'left', fontWeight: weight.bold },
  num: { textAlign: 'right' },
})
