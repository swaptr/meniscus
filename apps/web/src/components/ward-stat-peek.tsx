/** A ward head figure's peek (web/ward "Metric peeks on stats"): the beds behind it, each linking to the bed. Lazy; no request. */
import * as stylex from '@stylexjs/stylex'
import type { WardStat } from '../lib/ward-board.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { HrefLink } from './href-link.tsx'
import { PeekHead } from './peek.tsx'
import { ui } from './ui.styles.ts'

export default function WardStatPeek({ stat }: { stat: WardStat }) {
  return (
    <div {...stylex.props(s.body)}>
      <PeekHead title={stat.title} />
      <ul {...stylex.props(s.list)}>
        {stat.lines.map((l) => (
          <li key={l.href}>
            <HrefLink href={l.href} xstyle={[s.link, ui.focus]} translate="no">
              {l.label}
            </HrefLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  link: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.fg,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    fontSize: text.sm,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
    textDecoration: 'none',
  },
})
