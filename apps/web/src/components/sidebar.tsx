/**
 * The sidebar (DESIGN.md 4.1; web/interface "Sidebar sections and links"): headed sections, each shown only when it has
 * a link, counts from the routes' own loads (lib/snapshot.ts). It sends no request of its own. The More drawer on
 * phones renders the same `SidebarSections`.
 */
import * as stylex from '@stylexjs/stylex'
import type { NavLink, NavSection } from '../lib/nav.ts'
import { useSections } from '../lib/use-sections.ts'
import { color, layout, radius, space, text, weight } from '../tokens.stylex.ts'
import { BrandMark } from './brand-mark.tsx'
import { HrefLink } from './href-link.tsx'
import { ToneGlyph } from './ui.tsx'

export function SidebarSections({ list, onNavigate }: { list: NavSection[]; onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" {...stylex.props(s.nav)}>
      {list.map((sec) => (
        <section key={sec.id} aria-labelledby={`nav-${sec.id}`} {...stylex.props(s.section)}>
          <h2 id={`nav-${sec.id}`} {...stylex.props(s.heading)}>
            {sec.title}
          </h2>
          <ul {...stylex.props(s.list)}>
            {sec.links.map((l) => (
              <li key={l.href}>
                <Item link={l} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}

function Item({ link, onNavigate }: { link: NavLink; onNavigate?: () => void }) {
  const p = link.pips
  return (
    <HrefLink href={link.href} current={link.current} onNavigate={onNavigate} xstyle={[s.link, link.current && s.current]}>
      {link.tone && <ToneGlyph tone={link.tone} />}
      <span {...stylex.props(s.label)}>
        {link.label}
        {link.detail && (
          <span translate={link.tone ? 'no' : undefined} {...stylex.props(s.detail)}>
            {' '}
            {link.detail}
          </span>
        )}
      </span>
      {p && (
        <span {...stylex.props(s.pips)}>
          {p.review > 0 && (
            <span {...stylex.props(s.pip)} title={`${p.review} to review`}>
              <ToneGlyph tone={p.tone ?? 'warn'} />
              <span>
                {p.review}
                <span {...stylex.props(s.hidden)}> to review</span>
              </span>
            </span>
          )}
          {p.pending > 0 && (
            <span {...stylex.props(s.pip, s.pending)} title={`${p.pending} pending`}>
              {p.pending}
              <span {...stylex.props(s.hidden)}> pending</span>
            </span>
          )}
        </span>
      )}
    </HrefLink>
  )
}

/** The persistent column from 768 px. */
export function Sidebar() {
  const list = useSections()
  return (
    <aside data-app-chrome {...stylex.props(s.aside)}>
      <div {...stylex.props(s.brand)}>
        <BrandMark />
      </div>
      <SidebarSections list={list} />
    </aside>
  )
}

const s = stylex.create({
  aside: {
    position: 'sticky',
    top: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    width: layout.sidebar,
    height: '100dvh',
    flexShrink: 0,
    paddingBlock: space.lg,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.border,
    backgroundColor: color.rail,
  },
  brand: { display: 'flex', alignItems: 'center', minHeight: 44, paddingInline: space.lg },
  nav: { display: 'flex', flexDirection: 'column', gap: space.lg },
  section: { display: 'flex', flexDirection: 'column', gap: space.xs },
  heading: {
    margin: 0,
    paddingInline: space.lg,
    fontSize: text.xs,
    fontWeight: weight.bold,
    color: color.muted,
    fontVariantNumeric: 'tabular-nums',
  },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  link: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    // Inset by the ring's width and offset, so the 2 px focus ring outside the link stays inside the rail.
    marginInline: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.fg,
    fontSize: text.md,
    fontWeight: weight.regular,
    textDecoration: 'none',
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  current: { backgroundColor: color.bg, fontWeight: weight.semibold, boxShadow: `inset 3px 0 0 ${color.accent}` },
  label: { flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  detail: { color: color.muted, fontSize: text.sm },
  pips: { display: 'inline-flex', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  pip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.xs,
    fontSize: text.xs,
    fontWeight: weight.bold,
    fontVariantNumeric: 'tabular-nums',
  },
  pending: { color: color.pending, paddingInline: space.sm, borderRadius: radius.pill, backgroundColor: color.pendingBg },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' },
})
