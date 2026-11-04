/**
 * Next up (DESIGN.md 5.23): the first block of every staff home. A strip of ranked items from 1100 px, a list below
 * (3 shown, then `<n> more next up`). Each item is one 52 px link. From the route's own load; no request.
 */
import * as stylex from '@stylexjs/stylex'
import type { NextUp as NextUpData, ReferralNext, WardNext } from '../lib/next-up.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { HrefLink } from './href-link.tsx'
import { BedBadge, Chip, ToneGlyph } from './ui.tsx'

const WIDE = '@media (min-width: 1100px)'

function Frame({ head, children }: { head?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby="next-up-title" {...stylex.props(s.frame)}>
      <div {...stylex.props(s.headCol)}>
        <h2 id="next-up-title" {...stylex.props(s.title)}>
          Next up
        </h2>
        {head && <p {...stylex.props(s.counts)}>{head}</p>}
      </div>
      {children}
    </section>
  )
}

/** The ward dashboard's Next up. */
export function NextUp({ data }: { data: NextUpData }) {
  if (data.empty)
    return (
      <Frame>
        <p {...stylex.props(s.empty)}>
          <ToneGlyph tone="ok" size={16} />
          {data.empty}
        </p>
      </Frame>
    )
  return (
    <Frame head={data.head}>
      <ol {...stylex.props(s.list)}>
        {data.items.map((i, n) => (
          <li key={`${i.admissionId}:${i.action}`} {...stylex.props(s.cell)}>
            <HrefLink href={i.href} xstyle={s.item}>
              <span aria-hidden {...stylex.props(s.rank)}>
                {n + 1}
              </span>
              <BedBadge ward={i.ward} bed={i.bed} size="sm" />
              <span {...stylex.props(s.body)}>
                <span {...stylex.props(s.line)}>
                  {/* A pending chip carries its own clock (`◷ 3`), so no second glyph. */}
                  <Chip tone={i.tone} glyph={!i.chip.startsWith('◷')}>
                    {i.chip}
                  </Chip>
                  <span {...stylex.props(s.action)}>{i.action}</span>
                </span>
                <span {...stylex.props(s.when)}>
                  <span translate="no">{i.patient}</span>
                  {i.when && ` · ${i.when}`}
                </span>
              </span>
            </HrefLink>
          </li>
        ))}
      </ol>
      {data.more && <p {...stylex.props(s.more)}>{data.more}</p>}
    </Frame>
  )
}

/** The nurse home's Next up: one item per ward. Hidden when no ward has work. */
export function WardsNextUp({ items }: { items: readonly WardNext[] }) {
  if (!items.length) return null
  return (
    <Frame>
      <ol {...stylex.props(s.list)}>
        {items.map((i, n) => (
          <li key={i.wardId} {...stylex.props(s.cell)}>
            <HrefLink href={i.href} xstyle={s.item}>
              <span aria-hidden {...stylex.props(s.rank)}>
                {n + 1}
              </span>
              <ToneGlyph tone={i.tone} size={16} />
              <span {...stylex.props(s.action)}>{i.label}</span>
            </HrefLink>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

/** The dietitian worklist's Next up: open referrals, oldest first. Hidden when none is open. */
export function ReferralsNextUp({ items }: { items: readonly ReferralNext[] }) {
  if (!items.length) return null
  return (
    <Frame>
      <ol {...stylex.props(s.list)}>
        {items.map((i, n) => (
          <li key={i.admissionId} {...stylex.props(s.cell)}>
            <HrefLink href={i.href} xstyle={s.item}>
              <span aria-hidden {...stylex.props(s.rank)}>
                {n + 1}
              </span>
              <span {...stylex.props(s.body)}>
                <span translate="no" {...stylex.props(s.action)}>
                  {i.title}
                </span>
                <span {...stylex.props(s.when)}>{i.detail}</span>
              </span>
            </HrefLink>
          </li>
        ))}
      </ol>
    </Frame>
  )
}

const s = stylex.create({
  frame: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: space.md,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
  },
  headCol: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: space.md, rowGap: space.xs, minWidth: 0 },
  title: { margin: 0, fontSize: text.md, fontWeight: weight.bold },
  counts: { margin: 0, fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  list: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [WIDE]: 'repeat(auto-fill, minmax(208px, 1fr))' },
    gap: space.sm,
    flexGrow: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  cell: { display: 'flex', minWidth: 0 },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    minWidth: 0,
    minHeight: 52,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.fg,
    textDecoration: 'none',
    backgroundColor: { default: color.subtle, ':hover': color.accentBg },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  rank: { fontSize: text.xs, fontWeight: weight.bold, color: color.muted, fontVariantNumeric: 'tabular-nums', minWidth: 12 },
  body: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  line: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.sm },
  action: { fontSize: text.sm, fontWeight: weight.semibold, minWidth: 0 },
  when: { fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' },
  more: { margin: 0, fontSize: text.sm, color: color.muted },
  empty: { display: 'flex', alignItems: 'center', gap: space.sm, margin: 0, fontSize: text.sm, color: color.muted },
})
