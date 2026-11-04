/**
 * Mirrored hourly bars and the line sparkline (DESIGN.md §5.10). Mirrored bars: approved intake up and output down
 * from a `border` midline on one scale per screen (pass the ward's `scaleShared`), a dot under each hour with intake
 * logged, and a warn dashed underline under runs of 3 h or more without. HTML, so it stays crisp at any width.
 */
import * as stylex from '@stylexjs/stylex'
import { GAP_HOURS } from '../lib/chart-text.ts'
import { color, radius, space } from '../tokens.stylex.ts'

/** Runs of `GAP_HOURS` or more hours with no intake logged, as [first, last] indexes. */
function gaps(logged: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  let start = -1
  logged.forEach((n, i) => {
    if (n === 0 && start < 0) start = i
    if ((n > 0 || i === logged.length - 1) && start >= 0) {
      const end = n > 0 ? i - 1 : i
      if (end - start + 1 >= GAP_HOURS) out.push([start, end])
      start = -1
    }
  })
  return out
}

export function MirroredBars({
  in_ml,
  out_ml,
  in_logged,
  max,
  name,
  height = 32,
}: {
  in_ml: readonly number[]
  out_ml: readonly number[]
  /** Entries of logged intake per hour: dots, and the gap underline. Leave out to draw bars only. */
  in_logged?: readonly number[]
  /** The shared scale: the largest hour on the screen. */
  max: number
  /** The strip's accessible name (`stripName`), stating its totals. */
  name: string
  /** Total bar height in px (half up, half down). */
  height?: number
}) {
  const n = in_ml.length
  const pct = (v: number) => (v > 0 ? `max(2px, ${Math.min(100, (100 * v) / Math.max(1, max))}%)` : '0')
  return (
    <div role="img" aria-label={name} {...stylex.props(s.wrap)}>
      <div {...stylex.props(s.bars)} style={{ height }}>
        {in_ml.map((v, i) => (
          <div key={i} {...stylex.props(s.col)}>
            <div {...stylex.props(s.half, s.up)}>
              <span {...stylex.props(s.bar, s.inBar)} style={{ height: pct(v) }} />
            </div>
            <div {...stylex.props(s.half, s.down)}>
              <span {...stylex.props(s.bar, s.outBar)} style={{ height: pct(out_ml[i] ?? 0) }} />
            </div>
          </div>
        ))}
      </div>
      {in_logged && (
        <div {...stylex.props(s.dots)}>
          {in_logged.map((c, i) => (
            <span key={i} {...stylex.props(s.dotCol)}>
              {c > 0 && <span {...stylex.props(s.dot)} />}
            </span>
          ))}
          {gaps(in_logged).map(([a, b]) => (
            <span key={a} {...stylex.props(s.gap)} style={{ left: `${(100 * a) / n}%`, width: `${(100 * (b - a + 1)) / n}%` }} />
          ))}
        </div>
      )}
    </div>
  )
}

/** A 96 × 24 line for a time series in a table cell; `aria-hidden`, the row's text carries the value. */
export function Sparkline({ values, width = 96, height = 24 }: { values: readonly number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const top = Math.max(1, ...values)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (width - 4) + 2, height - 2 - (v / top) * (height - 4)] as const)
  const [lx, ly] = pts.at(-1)!
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden {...stylex.props(s.spark)}>
      <polyline points={pts.map((p) => p.join(',')).join(' ')} {...stylex.props(s.sparkLine)} />
      <circle cx={lx} cy={ly} r={3} {...stylex.props(s.sparkDot)} />
    </svg>
  )
}

const s = stylex.create({
  wrap: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0, width: '100%' },
  bars: { display: 'flex', gap: space.xs, alignItems: 'stretch', position: 'relative' },
  col: { flexGrow: 1, flexBasis: 0, minWidth: 0, display: 'flex', flexDirection: 'column' },
  half: { flexGrow: 1, flexBasis: 0, display: 'flex' },
  up: { alignItems: 'flex-end', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: color.border },
  down: { alignItems: 'flex-start' },
  bar: { display: 'block', width: '100%' },
  inBar: { backgroundColor: color.intake, borderTopLeftRadius: radius.sm, borderTopRightRadius: radius.sm },
  outBar: { backgroundColor: color.output, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.sm },
  dots: { position: 'relative', display: 'flex', gap: space.xs, height: 8 },
  dotCol: { flexGrow: 1, flexBasis: 0, display: 'grid', placeItems: 'start center' },
  dot: { width: 4, height: 4, borderRadius: radius.pill, backgroundColor: color.fg },
  gap: { position: 'absolute', bottom: 0, height: 0, borderTopWidth: 2, borderTopStyle: 'dashed', borderTopColor: color.warnText },
  spark: { display: 'block', flexShrink: 0 },
  sparkLine: { fill: 'none', stroke: color.fg, strokeWidth: 1.5, strokeLinejoin: 'round' },
  sparkDot: { fill: color.fg },
})
