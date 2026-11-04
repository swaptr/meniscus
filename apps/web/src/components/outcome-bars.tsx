/**
 * The Chart view (web/ward "Outcome bars"): small multiples, one panel per read kind (label and rate over one stacked
 * bar), 3 a row from 900 px and 1 below. Each panel is a peek trigger (400 ms rest, tap, Enter); one popup for the list.
 */
import * as stylex from '@stylexjs/stylex'
import type { ModelQuality } from '@meniscus/shared'
import { MODEL_DAYS } from '../lib/model-accuracy.ts'
import { OUTCOME_HUE, OUTCOME_LABEL, OUTCOME_ORDER, OUTCOME_POPUP_DELAY, outcomeBars, type DrawnBar } from '../lib/outcome-bars.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { PopoverRoot, PopoverTrigger } from './popover.tsx'
import { usePopoverList } from './use-popover-list.ts'

const WIDE = '@media (min-width: 900px)'
const FORCED = '@media (forced-colors: active)'

export function OutcomeBars({ q }: { q: Pick<ModelQuality, 'min_n' | 'kinds'> }) {
  const bars = outcomeBars(q)
  const list = usePopoverList<DrawnBar>(OUTCOME_POPUP_DELAY)
  return (
    <figure {...stylex.props(s.figure)}>
      <ul {...stylex.props(s.legend)}>
        {OUTCOME_ORDER.map((o) => (
          <li key={o} {...stylex.props(s.legendItem)}>
            <span aria-hidden {...stylex.props(s.swatch, s.hue(OUTCOME_HUE[o]))} />
            {OUTCOME_LABEL[o]}
          </li>
        ))}
      </ul>
      <ul {...stylex.props(s.panels)}>
        {bars.map((b) => (
          <li key={b.label} {...stylex.props(s.cell)}>
            {'tooFew' in b ? (
              <div {...stylex.props(s.panel, s.few)}>
                <span {...stylex.props(s.label)}>{b.label}</span>
                <span {...stylex.props(s.fewText)}>{b.tooFew}</span>
              </div>
            ) : (
              <PopoverTrigger list={list} payload={b} label={b.ariaLabel} xstyle={[s.panel, s.button]} openStyle={s.open}>
                <span aria-hidden {...stylex.props(s.head)}>
                  <span {...stylex.props(s.label)}>{b.label}</span>
                  <span {...stylex.props(s.rate)}>{b.accepted}</span>
                </span>
                <Bar b={b} />
              </PopoverTrigger>
            )}
          </li>
        ))}
      </ul>
      <PopoverRoot list={list} variant="tip" popupLabel={(b) => `${b.label} outcomes`}>
        {(b) => (
          <ul {...stylex.props(s.popup)}>
            {OUTCOME_ORDER.map((o, i) => (
              <li key={o} {...stylex.props(s.popupLine)}>
                <span aria-hidden {...stylex.props(s.swatch, s.popupSwatch, s.hue(OUTCOME_HUE[o]))} />
                {b.popup[i]}
              </li>
            ))}
          </ul>
        )}
      </PopoverRoot>
      <figcaption {...stylex.props(s.caption)}>Outcomes of decided drafts · last {MODEL_DAYS} days</figcaption>
    </figure>
  )
}

function Bar({ b }: { b: DrawnBar }) {
  const last = b.segments.length - 1
  return (
    <span aria-hidden {...stylex.props(s.track)}>
      {b.segments.map((g, i) => (
        <span
          key={g.outcome}
          {...stylex.props(s.segment, s.hue(OUTCOME_HUE[g.outcome]), s.width(g.widthPct), i === 0 && s.first, i === last && s.last)}
        />
      ))}
    </span>
  )
}

const s = stylex.create({
  figure: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, minWidth: 0 },
  legend: { display: 'flex', flexWrap: 'wrap', gap: `${space.sm} ${space.lg}`, margin: 0, padding: 0, listStyle: 'none' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.sm, color: color.fg },
  swatch: { display: 'inline-block', flexShrink: 0, width: 12, height: 12, borderRadius: radius.sm },
  hue: (hex: string) => ({ backgroundColor: hex }),
  panels: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [WIDE]: 'repeat(3, minmax(0, 1fr))' },
    gap: space.md,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  cell: { minWidth: 0, display: 'flex' },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: space.sm,
    width: '100%',
    minWidth: 0,
    minHeight: 64,
    padding: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  button: {
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    font: 'inherit',
    textAlign: 'start',
    cursor: 'pointer',
    // A vertical swipe that starts on a panel still scrolls the page, and fires no click.
    touchAction: 'pan-y',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  open: { backgroundColor: color.subtle, borderColor: color.accent },
  head: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: `${space.xs} ${space.md}`,
    minWidth: 0,
  },
  few: { gap: space.xs },
  label: { fontSize: text.sm, fontWeight: weight.semibold, color: color.fg, minWidth: 0 },
  fewText: { fontSize: text.sm, color: color.muted },
  rate: { fontSize: text.sm, fontWeight: weight.bold, color: color.fg, fontVariantNumeric: 'tabular-nums' },
  track: {
    display: 'flex',
    gap: space.xs,
    minWidth: 0,
    height: 12,
    borderRadius: radius.sm,
    backgroundColor: color.grid,
  },
  segment: {
    display: 'block',
    flexShrink: 1,
    minWidth: 0,
    height: '100%',
    // Forced colours: a 1 px CanvasText border keeps the gaps between segments.
    borderWidth: { default: 0, [FORCED]: 1 },
    borderStyle: 'solid',
    borderColor: 'CanvasText',
  },
  width: (pct: number) => ({ flexBasis: `${pct}%` }),
  first: { borderStartStartRadius: radius.sm, borderEndStartRadius: radius.sm },
  last: { borderStartEndRadius: radius.sm, borderEndEndRadius: radius.sm },
  caption: { fontSize: text.xs, color: color.muted },
  popup: { display: 'flex', flexDirection: 'column', gap: space.sm, margin: 0, padding: 0, listStyle: 'none' },
  popupLine: { display: 'flex', alignItems: 'center', gap: space.md, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  popupSwatch: { outlineWidth: 1, outlineStyle: 'solid', outlineColor: color.bg },
})
