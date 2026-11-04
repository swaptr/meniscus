/** A shift heading's approved in and out as two bars on the log's one scale, with the totals in text (web/ward "Shift totals drawn in the log"). */
import * as stylex from '@stylexjs/stylex'
import type { ShiftBar } from '../lib/shifts.ts'
import { color, radius, space, text } from '../tokens.stylex.ts'

export function ShiftBars({ bar }: { bar: ShiftBar }) {
  return (
    <span {...stylex.props(s.row)}>
      <span aria-hidden {...stylex.props(s.bars)}>
        <span {...stylex.props(s.track)}>
          <span {...stylex.props(s.bar, s.in)} style={{ width: `${bar.in * 100}%` }} />
        </span>
        <span {...stylex.props(s.track)}>
          <span {...stylex.props(s.bar, s.out)} style={{ width: `${bar.out * 100}%` }} />
        </span>
      </span>
      <span {...stylex.props(s.text)}>{bar.text}</span>
    </span>
  )
}

const s = stylex.create({
  row: { display: 'inline-flex', alignItems: 'center', gap: space.md, minWidth: 0, flexWrap: 'wrap' },
  bars: { display: 'flex', flexDirection: 'column', gap: space.xs, width: 96, flexShrink: 0 },
  track: { display: 'block', height: 4 },
  bar: { display: 'block', height: '100%', borderRadius: radius.sm },
  in: { backgroundColor: color.intake },
  out: { backgroundColor: color.output },
  text: { fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
})
