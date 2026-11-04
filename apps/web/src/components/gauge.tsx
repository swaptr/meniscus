/**
 * A measuring cylinder for anything with a capacity (DESIGN.md §5.12): a bag's level, a limit or a target. The fill
 * rises from the bottom, graduation ticks every 25 %, a warn line at 80 % (BAG_NEARLY_FULL); the outline turns warn
 * when a reading is due and danger when overdue, and the word is always beside it. Never the gauge alone.
 */
import * as stylex from '@stylexjs/stylex'
import { BAG_NEARLY_FULL } from '@meniscus/shared'
import { gaugeName } from '../lib/charts.ts'
import { clock, percent } from '../lib/format.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

export type GaugeState = 'ok' | 'due' | 'overdue'
const WORD: Record<GaugeState, string | null> = { ok: null, due: 'Due', overdue: 'Overdue' }

export function Gauge({
  name,
  level,
  capacity,
  at = null,
  state = 'ok',
  fill = color.intake,
  size = 'tile',
  detail = size === 'bed',
}: {
  /** `Urine bag`: names the gauge for assistive tech. */
  name: string
  level: number
  capacity: number
  /** When the level was read (epoch ms). */
  at?: number | null
  state?: GaugeState
  /** The fill: the urine colour seen, a urine bag's straw, a category hue, or `intake`. */
  fill?: string
  /** `tile` 14 × 34, `bed` 26 × 72. */
  size?: 'tile' | 'bed'
  /** Beside it: `840/2000 mL` and the reading's time, as well as the percent and word. */
  detail?: boolean
}) {
  const share = capacity > 0 ? Math.min(1, Math.max(0, level / capacity)) : 0
  const word = WORD[state]
  return (
    <span
      role="img"
      aria-label={`${gaugeName(name, level, capacity, at)}${word ? `, ${word.toLowerCase()}` : ''}`}
      {...stylex.props(s.row)}
    >
      <span {...stylex.props(s.tube, size === 'bed' ? s.bed : s.tile, state === 'due' && s.due, state === 'overdue' && s.overdue)}>
        <span {...stylex.props(s.fill)} style={{ height: `${share * 100}%`, backgroundColor: fill }} />
        {[0.25, 0.5, 0.75].map((f) => (
          <span key={f} {...stylex.props(s.tick)} style={{ bottom: `${f * 100}%` }} />
        ))}
        <span {...stylex.props(s.warnLine)} style={{ bottom: `${BAG_NEARLY_FULL * 100}%` }} />
      </span>
      <span aria-hidden {...stylex.props(s.text)}>
        <span {...stylex.props(s.pct)}>{percent(share)}</span>
        {word && <span {...stylex.props(state === 'overdue' ? s.wordDanger : s.wordWarn)}>{word}</span>}
        {detail && (
          <span {...stylex.props(s.meta)}>
            {level}/{capacity} mL{at !== null ? ` · ${clock(at)}` : ''}
          </span>
        )}
      </span>
    </span>
  )
}

const s = stylex.create({
  row: { display: 'inline-flex', alignItems: 'center', gap: space.sm, minWidth: 0 },
  tube: {
    position: 'relative',
    flexShrink: 0,
    overflow: 'hidden',
    backgroundColor: color.bg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.sm,
  },
  tile: { width: 14, height: 34 },
  bed: { width: 26, height: 72 },
  due: { borderWidth: 2, borderColor: color.warn },
  overdue: { borderWidth: 2, borderColor: color.danger },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  tick: { position: 'absolute', right: 0, width: '35%', height: 1, backgroundColor: color.borderStrong },
  warnLine: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: color.warn },
  text: {
    display: 'inline-flex',
    flexDirection: 'column',
    gap: space.xs,
    lineHeight: text.leadingTight,
    fontVariantNumeric: 'tabular-nums',
  },
  pct: { fontSize: text.sm, fontWeight: weight.bold, color: color.fg },
  wordWarn: { fontSize: text.xs, fontWeight: weight.semibold, color: color.warnText },
  wordDanger: { fontSize: text.xs, fontWeight: weight.semibold, color: color.danger },
  meta: { fontSize: text.xs, color: color.muted },
})
