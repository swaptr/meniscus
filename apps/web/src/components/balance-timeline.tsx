/**
 * The bed review's main chart (DESIGN.md §5.11): one 24 h hour rail with an alert lane, the cumulative approved step
 * lines with the gap between them shaded, care orders (limit band and rule, or target rule and checks, with the intake
 * counted since the chart day began), photo marks, and mirrored hourly bars with pending drawn outlined. Pointer, tap
 * and Left/Right drive an hour readout; `Chart | Table` swaps in the same numbers as a table. Hand-built SVG; text is
 * HTML so it never scales. Approval pours in (signature moment 1): a newly approved hour's bars grow from the midline.
 * No requests.
 */
import { useState, type KeyboardEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { Alert, CareStatus, Entry, OutputDevices } from '@meniscus/shared'
import { balanceName, balanceTable } from '../lib/chart-text.ts'
import { careRails, cumulative, hourBuckets, railStart, roundHourTicks, type HourBucket, type Point } from '../lib/charts.ts'
import { clock, ml, signedMl } from '../lib/format.ts'
import { ALERT_LABEL, ALERT_TONE } from '../lib/labels.ts'
import { hourReadout, moveHour } from '../lib/timeline-readout.ts'
import { color, motion, radius, space, text, weight } from '../tokens.stylex.ts'
import { DrinkIcon } from './drink-label.tsx'
import { PopoverTrigger } from './popover.tsx'
import type { PopoverList } from './use-popover-list.ts'
import { Segmented } from './segmented.tsx'

const HOUR = 3_600_000
const W = 240 // 24 columns of 10 user units
const COL = W / 24
const TOP_H = 100
const BAR_H = 60

const niceMax = (v: number, step: number) => Math.max(step, Math.ceil(v / step) * step)

/** A step line, held flat to `end`. */
const stepPath = (pts: Point[], x: (t: number) => number, y: (v: number) => number, end: number) => {
  let d = `M${x(pts[0]!.t)},${y(pts[0]!.v)}`
  for (let i = 1; i < pts.length; i++) d += `H${x(pts[i]!.t)}V${y(pts[i]!.v)}`
  return `${d}H${x(end)}`
}
const valueAt = (pts: Point[], t: number) => pts.findLast((p) => p.t <= t)?.v ?? 0

/** The gap between the two step lines, one rect per interval, tinted by which side leads. */
function gapRects(a: Point[], b: Point[], from: number, to: number) {
  const ts = [...new Set([from, ...a.map((p) => p.t), ...b.map((p) => p.t), to])].filter((t) => t >= from && t <= to).sort((p, q) => p - q)
  return ts.slice(0, -1).map((t, i) => ({ t0: t, t1: ts[i + 1]!, a: valueAt(a, t), b: valueAt(b, t) }))
}

const MARK: Record<'danger' | 'warn' | 'info', string> = { danger: color.danger, warn: color.warn, info: color.info }

export function BalanceTimeline({
  entries,
  now,
  devices,
  care = null,
  alerts = [],
  onOpenEntry,
  peek,
  still = false,
}: {
  entries: Entry[]
  now: number
  devices: Pick<OutputDevices, 'urine_measured'>
  /** The bed's care read: a fluid limit or intake target is drawn against the intake counted since 08:00. */
  care?: CareStatus | null
  /** The bed's open prompts, marked on the lane above the lines. */
  alerts?: readonly Alert[]
  /** Opens an entry's peek (photo marks and the readout's entries). */
  onOpenEntry?: (entry: Entry) => void
  /** The bed review's entry peek: photo marks and the readout's entries open it (web/ward "Entry peek"). */
  peek?: PopoverList<Entry>
  /** The printed chart: the chart only, with no view switch, readout, focus or tap targets. */
  still?: boolean
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hour, setHour] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const buckets = hourBuckets(entries, now)
  const lines = cumulative(entries, now, devices)
  const rails = careRails(care, entries, now)
  const from = railStart(now)
  const to = from + 24 * HOUR
  const x = (t: number) => ((Math.min(Math.max(t, from), to) - from) / (to - from)) * W

  // Signature 1: hours whose approved total grew since the last render pour in.
  const approvedKey = buckets.map((b) => `${b.inMl}/${b.outMl}`).join(',')
  const [seen, setSeen] = useState<{ key: string; grew: Set<number> }>({ key: approvedKey, grew: new Set() })
  if (seen.key !== approvedKey) {
    const before = seen.key.split(',').map((p) => p.split('/').map(Number) as [number, number])
    const grew = new Set(buckets.flatMap((b, i) => (before[i] && (b.inMl > before[i][0] || b.outMl > before[i][1]) ? [i] : [])))
    setSeen({ key: approvedKey, grew })
  }

  const inTotal = lines.in.at(-1)!.v
  const outTotal = lines.out.at(-1)!.v
  const topMax = niceMax(Math.max(inTotal, outTotal, rails.limit?.ml ?? 0, rails.target?.ml ?? 0, rails.counted?.at(-1)?.v ?? 0), 500)
  const y = (v: number) => TOP_H - (v / topMax) * TOP_H
  const barMax = Math.max(1, ...buckets.flatMap((b) => [b.inMl + b.pendingIn, b.outMl + b.pendingOut]))
  const half = BAR_H / 2
  const bh = (v: number) => (v > 0 ? Math.max(1, (v / barMax) * (half - 2)) : 0)
  const name = balanceName({
    inMl: inTotal,
    outMl: outTotal,
    limit: rails.limit && care?.fluid_limit ? { ml: rails.limit.ml, counted: care.fluid_limit.ml } : null,
    measured: devices.urine_measured,
  })
  const photos = entries.filter((e) => e.has_photo && e.status !== 'rejected' && Date.parse(e.created_at) >= from)
  const lane = laneMarks(alerts, entries, now, x)
  const readout = hour !== null ? hourReadout(buckets[hour]!) : null

  const hourAt = (e: { currentTarget: HTMLDivElement; clientX: number }) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.min(23, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * 24)))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const next = moveHour(hour ?? 23, e.key, 24)
    if (next === undefined) return
    e.preventDefault()
    setHour(next)
    setPinned(next !== null)
  }

  return (
    <figure {...stylex.props(s.figure)}>
      <figcaption {...stylex.props(s.head)}>
        <span {...stylex.props(s.title)}>Fluid balance, 24 h</span>
        <span {...stylex.props(s.balance)}>Balance {signedMl(inTotal - outTotal)}</span>
        {lines.note && <span {...stylex.props(s.note)}>{lines.note}</span>}
        <span {...stylex.props(s.grow)} />
        {!still && (
          <Segmented
            label="Fluid balance view"
            value={view}
            options={[
              ['chart', 'Chart'],
              ['table', 'Table'],
            ]}
            onChange={setView}
          />
        )}
      </figcaption>
      <div {...stylex.props(s.legend)}>
        <span {...stylex.props(s.key)}>
          <span {...stylex.props(s.swatchLine, s.inBg)} /> In {ml(inTotal)}
        </span>
        <span {...stylex.props(s.key)}>
          <span {...stylex.props(s.swatchLine, s.outBg)} /> {lines.outLabel} {ml(outTotal)}
        </span>
        {rails.counted && (
          <span {...stylex.props(s.key)}>
            <span {...stylex.props(s.swatchDash)} /> Counted since {clock(rails.counted[0]!.t)}
          </span>
        )}
        {rails.limit && (
          <span {...stylex.props(s.key)}>
            <span {...stylex.props(s.swatchBand)} /> {rails.limit.label}
          </span>
        )}
        {rails.target && (
          <span {...stylex.props(s.key)}>
            <span {...stylex.props(s.swatchTarget)} /> {rails.target.label}
          </span>
        )}
      </div>

      {view === 'table' ? (
        <div tabIndex={0} role="region" aria-label="Fluid balance by hour, scrolls sideways" {...stylex.props(s.tableWrap)}>
          <table {...stylex.props(s.table)}>
            <caption {...stylex.props(s.srOnly)}>{name}</caption>
            <thead>
              <tr>
                {['Hour', 'In', 'Out', 'Pending', 'Balance'].map((h) => (
                  <th key={h} scope="col" {...stylex.props(s.th, h !== 'Hour' && s.num)}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {balanceTable(buckets).map((r) => (
                <tr key={r.hour}>
                  <th scope="row" {...stylex.props(s.td, s.rowHead)}>
                    {r.hour}
                  </th>
                  <td {...stylex.props(s.td, s.num)}>{r.in}</td>
                  <td {...stylex.props(s.td, s.num)}>{r.out}</td>
                  <td {...stylex.props(s.td, s.num)}>{r.pending}</td>
                  <td {...stylex.props(s.td, s.num)}>{r.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div
          role="img"
          aria-label={name}
          tabIndex={still ? undefined : 0}
          onKeyDown={still ? undefined : onKey}
          onBlur={() => !pinned && setHour(null)}
          {...stylex.props(s.plot)}
        >
          {/* First, so the marks after it sit on top. Whole hour columns are the hit areas; pan-y keeps the page scrolling on touch. */}
          {!still && (
            <div
              aria-hidden
              onPointerMove={(e) => !pinned && e.pointerType === 'mouse' && setHour(hourAt(e))}
              onPointerLeave={() => !pinned && setHour(null)}
              onClick={(e) => {
                const h = hourAt(e)
                const same = pinned && hour === h
                setHour(same ? null : h)
                setPinned(!same)
              }}
              {...stylex.props(s.hit)}
            />
          )}
          {/* Alert lane: prompts at the hour they apply to. */}
          <div aria-hidden {...stylex.props(s.lane)}>
            {lane.map((m, i) => (
              <span
                key={i}
                title={m.label}
                {...stylex.props(s.laneMark)}
                style={{ left: `${(m.x / W) * 100}%`, backgroundColor: MARK[m.tone] }}
              />
            ))}
          </div>

          <div {...stylex.props(s.panel)}>
            <svg viewBox={`0 0 ${W} ${TOP_H}`} preserveAspectRatio="none" aria-hidden {...stylex.props(s.svgTop)}>
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1={0} x2={W} y1={TOP_H * f} y2={TOP_H * f} vectorEffect="non-scaling-stroke" {...stylex.props(s.grid)} />
              ))}
              {rails.limit && (
                <>
                  <rect
                    x={0}
                    width={W}
                    y={y(rails.limit.band[1])}
                    height={y(rails.limit.band[0]) - y(rails.limit.band[1])}
                    {...stylex.props(s.band)}
                  />
                  <line
                    x1={0}
                    x2={W}
                    y1={y(rails.limit.ml)}
                    y2={y(rails.limit.ml)}
                    vectorEffect="non-scaling-stroke"
                    {...stylex.props(s.limit)}
                  />
                </>
              )}
              {rails.target && (
                <>
                  <line
                    x1={0}
                    x2={W}
                    y1={y(rails.target.ml)}
                    y2={y(rails.target.ml)}
                    vectorEffect="non-scaling-stroke"
                    {...stylex.props(s.target)}
                  />
                  {rails.target.checks.map((c) => (
                    <line
                      key={c.t}
                      x1={x(c.t)}
                      x2={x(c.t)}
                      y1={y(c.ml) - 4}
                      y2={y(c.ml) + 4}
                      vectorEffect="non-scaling-stroke"
                      {...stylex.props(s.check)}
                    />
                  ))}
                </>
              )}
              {gapRects(lines.in, lines.out, from, Math.min(now, to)).map((g) => (
                <rect
                  key={g.t0}
                  x={x(g.t0)}
                  width={Math.max(0, x(g.t1) - x(g.t0))}
                  y={y(Math.max(g.a, g.b))}
                  height={Math.abs(y(g.a) - y(g.b))}
                  {...stylex.props(g.a >= g.b ? s.gapIn : s.gapOut)}
                />
              ))}
              {rails.counted && rails.counted[0]!.t >= from && (
                <line
                  x1={x(rails.counted[0]!.t)}
                  x2={x(rails.counted[0]!.t)}
                  y1={0}
                  y2={TOP_H}
                  vectorEffect="non-scaling-stroke"
                  {...stylex.props(s.dayRule)}
                />
              )}
              {rails.counted && (
                <path d={stepPath(rails.counted, x, y, now)} vectorEffect="non-scaling-stroke" {...stylex.props(s.counted)} />
              )}
              <path d={stepPath(lines.out, x, y, now)} vectorEffect="non-scaling-stroke" {...stylex.props(s.line, s.outStroke)} />
              <path d={stepPath(lines.in, x, y, now)} vectorEffect="non-scaling-stroke" {...stylex.props(s.line, s.inStroke)} />
              <line x1={x(now)} x2={x(now)} y1={0} y2={TOP_H} vectorEffect="non-scaling-stroke" {...stylex.props(s.now)} />
              {hour !== null && <rect x={hour * COL} width={COL} y={0} height={TOP_H} {...stylex.props(s.hourBand)} />}
            </svg>
            <span aria-hidden {...stylex.props(s.yMax)}>
              {ml(topMax)}
            </span>
            {rails.limit && (
              <span aria-hidden {...stylex.props(s.railLabel, s.limitText)} style={{ top: `${(y(rails.limit.ml) / TOP_H) * 100}%` }}>
                {rails.limit.label} · 80%
              </span>
            )}
            {rails.target?.checks.map((c) => (
              <span
                key={c.t}
                aria-hidden
                {...stylex.props(s.railLabel, s.checkText)}
                style={{ top: `${(y(c.ml) / TOP_H) * 100}%`, left: `${(x(c.t) / W) * 100}%` }}
              >
                {c.label}
              </span>
            ))}
          </div>

          {!still && photos.length > 0 && (
            <div {...stylex.props(s.photoRow)}>
              {photos.map((e) => (
                <span key={e.id} {...stylex.props(s.photoAt)} style={{ left: `${(x(Date.parse(e.created_at)) / W) * 100}%` }}>
                  {peek ? (
                    <PopoverTrigger
                      list={peek}
                      payload={e}
                      label={`Photo entry at ${clock(Date.parse(e.created_at))}`}
                      xstyle={s.photoMark}
                    >
                      <span {...stylex.props(s.photoFrame)} />
                    </PopoverTrigger>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Photo entry at ${clock(Date.parse(e.created_at))}`}
                      onClick={() => onOpenEntry?.(e)}
                      {...stylex.props(s.photoMark)}
                    >
                      <span {...stylex.props(s.photoFrame)} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          <div {...stylex.props(s.panel)}>
            <svg viewBox={`0 0 ${W} ${BAR_H}`} preserveAspectRatio="none" aria-hidden {...stylex.props(s.svgBars)}>
              <line x1={0} x2={W} y1={half} y2={half} vectorEffect="non-scaling-stroke" {...stylex.props(s.midline)} />
              {buckets.map((b, i) => (
                <Bars key={b.start} b={b} i={i} half={half} bh={bh} pour={seen.grew.has(i)} />
              ))}
              <line x1={x(now)} x2={x(now)} y1={0} y2={BAR_H} vectorEffect="non-scaling-stroke" {...stylex.props(s.now)} />
              {hour !== null && <rect x={hour * COL} width={COL} y={0} height={BAR_H} {...stylex.props(s.hourBand)} />}
            </svg>
          </div>

          <div aria-hidden {...stylex.props(s.ticks)}>
            {roundHourTicks(now).map((t) => (
              <span key={t.t} {...stylex.props(s.tick)} style={{ left: `${(x(t.t) / W) * 100}%` }}>
                {t.label}
              </span>
            ))}
            <span {...stylex.props(s.tick, s.tickNow)}>Now</span>
          </div>
        </div>
      )}

      {view === 'chart' && readout && (
        <div role="status" {...stylex.props(s.readout)}>
          <div {...stylex.props(s.readoutHead)}>
            <strong {...stylex.props(s.readoutTitle)}>{readout.title}</strong>
            {readout.lines.map((l) => (
              <span key={l} {...stylex.props(s.readoutLine)}>
                {l}
              </span>
            ))}
          </div>
          {readout.entries.length > 0 && (
            <ul {...stylex.props(s.readoutList)}>
              {readout.entries.map((r) => {
                const e = entries.find((x) => x.id === r.id)!
                return (
                  <li key={r.id}>
                    {peek ? (
                      <PopoverTrigger list={peek} payload={e} xstyle={s.readoutEntry}>
                        {r.drink && <DrinkIcon kind={r.drink} size={14} />}
                        {r.label}
                        {r.pending && <span {...stylex.props(s.pendingTag)}>Pending</span>}
                      </PopoverTrigger>
                    ) : (
                      <button type="button" onClick={() => onOpenEntry?.(e)} disabled={!onOpenEntry} {...stylex.props(s.readoutEntry)}>
                        {r.drink && <DrinkIcon kind={r.drink} size={14} />}
                        {r.label}
                        {r.pending && <span {...stylex.props(s.pendingTag)}>Pending</span>}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {lane
            .filter((m) => m.hour === hour)
            .map((m, i) => (
              <p key={i} {...stylex.props(s.readoutLine)}>
                {m.label}
              </p>
            ))}
        </div>
      )}
    </figure>
  )
}

/** One hour's mirrored bars: approved filled, pending outlined and stacked beyond them. */
function Bars({ b, i, half, bh, pour }: { b: HourBucket; i: number; half: number; bh: (v: number) => number; pour: boolean }) {
  const x0 = i * COL + 1
  const w = COL - 2
  const inA = bh(b.inMl)
  const inP = bh(b.inMl + b.pendingIn) - inA
  const outA = bh(b.outMl)
  const outP = bh(b.outMl + b.pendingOut) - outA
  return (
    <g>
      {inA > 0 && <rect x={x0} width={w} y={half - inA} height={inA} {...stylex.props(s.inFill, pour && s.pourUp)} />}
      {b.pendingIn > 0 && (
        <rect
          x={x0}
          width={w}
          y={half - inA - inP}
          height={inP}
          vectorEffect="non-scaling-stroke"
          {...stylex.props(s.pending, s.inStroke)}
        />
      )}
      {outA > 0 && <rect x={x0} width={w} y={half} height={outA} {...stylex.props(s.outFill, pour && s.pourDown)} />}
      {b.pendingOut > 0 && (
        <rect x={x0} width={w} y={half + outA} height={outP} vectorEffect="non-scaling-stroke" {...stylex.props(s.pending, s.outStroke)} />
      )}
    </g>
  )
}

/** Prompt markers: record prompts at their entries' times, the others at the `now` edge. */
function laneMarks(alerts: readonly Alert[], entries: readonly Entry[], now: number, x: (t: number) => number) {
  const from = railStart(now)
  return alerts.map((a) => {
    const times = 'entry_ids' in a ? entries.filter((e) => a.entry_ids.includes(e.id)).map((e) => Date.parse(e.created_at)) : []
    const t = times.length ? Math.max(...times) : now
    return {
      x: x(t),
      hour: Math.min(23, Math.max(0, Math.floor((t - from) / HOUR))),
      tone: ALERT_TONE[a.kind],
      label: `${ALERT_LABEL[a.kind]}: review`,
    }
  })
}

const grow = stylex.keyframes({ from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } })

const s = stylex.create({
  figure: { margin: 0, display: 'flex', flexDirection: 'column', gap: space.sm, minWidth: 0 },
  head: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: space.md },
  title: { fontSize: text.sm, fontWeight: weight.semibold, color: color.muted },
  balance: { fontSize: text.lg, fontWeight: weight.bold, color: color.fg, fontVariantNumeric: 'tabular-nums' },
  note: { fontSize: text.sm, color: color.muted },
  grow: { flexGrow: 1 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: space.lg, fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  key: { display: 'inline-flex', alignItems: 'center', gap: space.sm },
  swatchLine: { display: 'inline-block', width: 14, height: 2, borderRadius: radius.sm },
  inBg: { backgroundColor: color.intake },
  outBg: { backgroundColor: color.output },
  swatchDash: { display: 'inline-block', width: 14, height: 0, borderTopWidth: 2, borderTopStyle: 'dashed', borderTopColor: color.intake },
  swatchBand: {
    display: 'inline-block',
    width: 14,
    height: 8,
    backgroundColor: color.warnBg,
    borderTopWidth: 2,
    borderTopStyle: 'solid',
    borderTopColor: color.warn,
  },
  swatchTarget: { display: 'inline-block', width: 14, height: 0, borderTopWidth: 2, borderTopStyle: 'dashed', borderTopColor: color.info },
  plot: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    borderRadius: radius.md,
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
    touchAction: 'pan-y',
  },
  // Above the hit layer in paint order but transparent to the pointer, so hover and tap reach the hour columns.
  lane: { position: 'relative', height: 14, pointerEvents: 'none' },
  laneMark: {
    position: 'absolute',
    top: 1,
    width: 12,
    height: 12,
    marginLeft: -6,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: color.bg,
  },
  panel: { position: 'relative', pointerEvents: 'none' },
  svgTop: { display: 'block', width: '100%', height: 140, overflow: 'visible' },
  svgBars: { display: 'block', width: '100%', height: 72 },
  grid: { stroke: color.grid, strokeWidth: 1 },
  midline: { stroke: color.border, strokeWidth: 1 },
  band: { fill: color.warnBg },
  limit: { stroke: color.warn, strokeWidth: 1.5 },
  target: { stroke: color.info, strokeWidth: 1.5, strokeDasharray: '4 3' },
  check: { stroke: color.info, strokeWidth: 2 },
  gapIn: { fill: color.intakeBg },
  gapOut: { fill: color.outputBg },
  dayRule: { stroke: color.borderStrong, strokeWidth: 1, strokeDasharray: '1 3' },
  counted: { fill: 'none', stroke: color.intake, strokeWidth: 1.5, strokeDasharray: '4 3' },
  line: { fill: 'none', strokeWidth: 2 },
  inStroke: { stroke: color.intake },
  outStroke: { stroke: color.output },
  now: { stroke: color.fg, strokeWidth: 1, strokeDasharray: '2 2' },
  hourBand: { fill: color.fg, fillOpacity: 0.06 },
  inFill: { fill: color.intake, transformBox: 'fill-box', transformOrigin: 'bottom' },
  outFill: { fill: color.output, transformBox: 'fill-box', transformOrigin: 'top' },
  pending: { fill: color.bg, strokeWidth: 1.5, strokeDasharray: '3 2' },
  pourUp: { animationName: grow, animationDuration: motion.signature, animationTimingFunction: motion.ease },
  pourDown: { animationName: grow, animationDuration: motion.signature, animationTimingFunction: motion.ease },
  yMax: { position: 'absolute', top: 0, left: space.xs, fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  railLabel: {
    position: 'absolute',
    right: 0,
    transform: 'translateY(-120%)',
    fontSize: text.xs,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  limitText: { color: color.warnText },
  checkText: { right: 'auto', transform: 'translate(-50%, -130%)', color: color.info },
  photoRow: { position: 'relative', height: 20, pointerEvents: 'none' },
  // A 44 px hit area around the 20 px frame (web/interface "Targets big enough for gloved hands").
  photoAt: { position: 'absolute', top: -12, marginLeft: -22, pointerEvents: 'auto' },
  photoMark: {
    position: 'relative',
    width: 44,
    height: 44,
    padding: 0,
    display: 'grid',
    placeItems: 'center',
    borderWidth: 0,
    backgroundColor: 'transparent',
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  photoFrame: {
    width: 10,
    height: 8,
    borderWidth: 1.5,
    borderStyle: 'solid',
    borderColor: color.fg,
    borderRadius: radius.sm,
    backgroundColor: color.bg,
  },
  ticks: { position: 'relative', height: 16, pointerEvents: 'none' },
  tick: {
    position: 'absolute',
    top: 0,
    transform: 'translateX(-50%)',
    fontSize: text.xs,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  tickNow: { right: 0, transform: 'none', fontWeight: weight.semibold, color: color.fg },
  hit: { position: 'absolute', top: 14, left: 0, right: 0, bottom: 16, cursor: 'crosshair' },
  readout: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.tip,
    color: color.onTip,
    fontSize: text.sm,
    fontVariantNumeric: 'tabular-nums',
  },
  readoutHead: { display: 'flex', flexWrap: 'wrap', gap: space.md, alignItems: 'baseline' },
  readoutTitle: { fontWeight: weight.bold },
  readoutLine: { margin: 0 },
  readoutList: { display: 'flex', flexWrap: 'wrap', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  readoutEntry: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in srgb, ${color.onTip} 40%, transparent)`,
    backgroundColor: 'transparent',
    color: color.onTip,
    font: 'inherit',
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.onTip}` },
    outlineOffset: 2,
  },
  pendingTag: { fontSize: text.xs, fontWeight: weight.semibold, opacity: 0.85 },
  tableWrap: {
    overflowX: 'auto',
    maxHeight: 420,
    overflowY: 'auto',
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: text.sm, fontVariantNumeric: 'tabular-nums' },
  th: {
    position: 'sticky',
    top: 0,
    padding: space.md,
    textAlign: 'left',
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
    backgroundColor: color.subtle,
  },
  td: { paddingBlock: space.sm, paddingInline: space.md, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: color.grid },
  rowHead: { textAlign: 'left', fontWeight: weight.semibold },
  num: { textAlign: 'right' },
  srOnly: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' },
})
