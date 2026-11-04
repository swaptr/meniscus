import * as stylex from '@stylexjs/stylex'
import { color, radius, space } from '../tokens.stylex.ts'

/**
 * 24 cells, oldest first: filled when intake was logged that hour. Quiet hours since the last intake turn amber
 * after 3 h, only within the admission, as the logging-gap prompt does. Its own module (not in charts.tsx), so the ward
 * dashboard loads it without the bed charts.
 */
export function ActivityStrip({ cells, hoursAdmitted }: { cells: boolean[]; hoursAdmitted: number }) {
  const lastOn = cells.lastIndexOf(true)
  const quiet = Math.min(lastOn === -1 ? 24 : 23 - lastOn, hoursAdmitted)
  const gap = quiet >= 3
  const label = `Intake logged in ${cells.filter(Boolean).length} of the last 24 hours${gap ? `; none in the last ${quiet} h` : ''}`
  return (
    <div role="img" aria-label={label} title={label} {...stylex.props(s.strip)}>
      {cells.map((on, i) => (
        <span key={i} {...stylex.props(s.cell, on ? s.cellOn : gap && i > 23 - quiet ? s.cellGap : s.cellOff)} />
      ))}
    </div>
  )
}

const s = stylex.create({
  strip: { display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)', gap: space.xs, height: 12 },
  cell: { borderRadius: radius.sm },
  cellOn: { backgroundColor: color.intake },
  cellOff: { backgroundColor: color.border },
  cellGap: { backgroundColor: color.warnBg, boxShadow: `inset 0 0 0 1px ${color.warn}` },
})
