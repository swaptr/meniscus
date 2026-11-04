/**
 * The shell (DESIGN.md 4): the sidebar from 768 px, the bottom bar and More drawer below; the app bar with the
 * breadcrumb and the h1 naming the place; the quick jump (`/`, Ctrl/Cmd+K, `Jump to`). Nothing here sends a request
 * of its own: counts come from lib/snapshot.ts, the place from lib/place.ts.
 */
import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation, useMatches } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { LucideProvider } from 'lucide-react'
import { PRODUCT } from '../lib/brand.ts'
import { isJumpKey } from '../lib/jump-key.ts'
import { usePlaceTitle } from '../lib/place.ts'
import { snapshot } from '../lib/snapshot.ts'
import { useApiStatus } from '../lib/use-api-status.ts'
import { useSession, useStaff } from '../lib/use-staff.ts'
import { color, layer, layout, radius, space, text, weight } from '../tokens.stylex.ts'
import { BottomNav } from './bottom-nav.tsx'
import { BrandMark } from './brand-mark.tsx'
import { ConnectionStatus } from './connection-status.tsx'
import { HrefLink } from './href-link.tsx'
import { ChevronRightIcon } from './icons.tsx'
import { StaffBadge } from './staff-badge.tsx'
import { ToastHost } from './toast-host.tsx'

// The sidebar body is a lazy chunk behind a same-width rail, so the shell stays under 120 KB (design.md D9).
const Sidebar = lazy(() => import('./sidebar.tsx').then((m) => ({ default: m.Sidebar })))
const QuickJump = lazy(() => import('./quick-jump.tsx').then((m) => ({ default: m.QuickJump })))

// Layout breakpoint in CSS px, so browser zoom crosses it too. Chosen in JS (not CSS) so exactly one nav exists:
// crossing it unmounts the other, which also closes an open drawer. Client-only app, so no server snapshot.
const wideQuery = matchMedia('(min-width: 768px)')
const subscribeWide = (onChange: () => void) => {
  wideQuery.addEventListener('change', onChange)
  return () => wideQuery.removeEventListener('change', onChange)
}
const isWide = () => wideQuery.matches

/** Forms and capture read best at 1080 px; boards and the bed review use up to 1400 px. */
const narrowPage = (pathname: string) => pathname.startsWith('/a')

export function AppShell({ children }: { children: ReactNode }) {
  // One title source: the place a route set, else the deepest route's staticData, or the failure state.
  // Only the root matching means no route did ('/' redirects), i.e. a 404.
  const routeTitle = useMatches({
    select: (matches) =>
      matches.some((m) => m.status === 'error')
        ? 'Error'
        : matches.length === 1
          ? 'Not found'
          : matches.findLast((m) => m.staticData.title)?.staticData.title,
  })
  const place = usePlaceTitle()
  const title = place?.title ?? routeTitle
  const { pathname } = useLocation()
  const wide = useSyncExternalStore(subscribeWide, isWide)
  // The health check pauses while locked, with every other refresh.
  const apiStatus = useApiStatus(useSession().status === 'locked')
  const staff = useStaff()
  const [jump, setJump] = useState(false)
  const [jumpLoaded, setJumpLoaded] = useState(false)

  // Another person's counts never show: the snapshot is cleared when the signed-in person changes.
  const staffId = staff?.id ?? null
  useEffect(() => () => snapshot.reset(), [staffId])

  useEffect(() => {
    document.title = title ? `${title} · ${PRODUCT}` : PRODUCT
  }, [title])

  useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => {
      if (!isJumpKey(e, e.target instanceof HTMLElement ? e.target : null)) return
      e.preventDefault()
      setJumpLoaded(true)
      setJump(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide])

  return (
    <LucideProvider size={16} strokeWidth={1.75}>
      <div {...stylex.props(s.shell)}>
        <a href="#main" {...stylex.props(s.skip)}>
          Skip to content
        </a>
        {wide && (
          <Suspense fallback={<div aria-hidden {...stylex.props(s.rail)} />}>
            <Sidebar />
          </Suspense>
        )}
        <div {...stylex.props(s.column)}>
          <header data-app-chrome {...stylex.props(s.bar)}>
            <div {...stylex.props(s.barStart)}>
              {!wide && <BrandMark markOnly />}
              <div {...stylex.props(s.titles)}>
                {wide && place && place.crumbs.length > 0 && (
                  <nav aria-label="Breadcrumb">
                    <ol {...stylex.props(s.crumbs)}>
                      {place.crumbs.map((c) => (
                        <li key={c.href} {...stylex.props(s.crumb)}>
                          <HrefLink href={c.href} xstyle={s.crumbLink}>
                            <span aria-hidden {...stylex.props(s.crumbHit)} />
                            {c.label}
                          </HrefLink>
                          <ChevronRightIcon size={14} aria-hidden />
                        </li>
                      ))}
                    </ol>
                  </nav>
                )}
                <h1 {...stylex.props(s.barTitle)}>{title}</h1>
              </div>
            </div>
            <div {...stylex.props(s.barEnd)}>
              {wide && staff && (
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-keyshortcuts="/ Control+K Meta+K"
                  onClick={() => {
                    setJumpLoaded(true)
                    setJump(true)
                  }}
                  {...stylex.props(s.jump)}
                >
                  Jump to…
                  <kbd {...stylex.props(s.kbd)}>/</kbd>
                </button>
              )}
              <span {...stylex.props(s.status)}>
                <ConnectionStatus status={apiStatus.status} />
              </span>
              <StaffBadge compact={!wide} />
            </div>
          </header>
          <main id="main" tabIndex={-1} {...stylex.props(s.main, narrowPage(pathname) && s.mainNarrow, !wide && s.mainPhone)}>
            {children}
          </main>
          {!wide && <BottomNav staff={staff} />}
          <ToastHost />
        </div>
        {jumpLoaded && (
          <Suspense fallback={null}>
            <QuickJump open={jump} onOpenChange={setJump} />
          </Suspense>
        )}
      </div>
    </LucideProvider>
  )
}

const s = stylex.create({
  shell: {
    // Base UI: own stacking context so portalled popups (tooltips, drawer) always paint above app content.
    isolation: 'isolate',
    display: 'flex',
    minHeight: '100dvh',
    fontSize: text.md,
    lineHeight: text.leading,
    color: color.fg,
    backgroundColor: color.canvas,
  },
  skip: {
    position: 'fixed',
    top: space.md,
    insetInlineStart: space.md,
    zIndex: layer.tabBar,
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.md,
    color: color.onAccent,
    backgroundColor: color.accent,
    transform: { default: 'translateY(-200%)', ':focus-visible': 'none' },
  },
  rail: {
    position: 'sticky',
    top: 0,
    width: layout.sidebar,
    height: '100dvh',
    flexShrink: 0,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: 'solid',
    borderInlineEndColor: color.border,
    backgroundColor: color.rail,
  },
  column: { display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 },
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: layer.appBar,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: layout.appBar,
    paddingTop: 'env(safe-area-inset-top)',
    paddingInline: { default: space.lg, '@media (min-width: 768px)': space.xl },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    // Solid, no backdrop-filter: blur re-renders every frame behind a sticky bar, which janks low-end phones.
    backgroundColor: color.canvas,
  },
  barStart: { display: 'flex', alignItems: 'center', gap: space.md, minWidth: 0 },
  titles: { display: 'flex', flexDirection: 'column', minWidth: 0 },
  crumbs: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontSize: text.sm,
    color: color.muted,
  },
  crumb: { display: 'inline-flex', alignItems: 'center', gap: space.xs },
  crumbLink: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 20,
    paddingBlock: space.xs,
    color: color.accent,
    fontWeight: weight.semibold,
    textDecoration: { default: 'none', ':hover': 'underline' },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  // A 44 px hit area around the short crumb (web/interface "Targets big enough for gloved hands").
  crumbHit: { position: 'absolute', insetBlock: -12, insetInline: -4 },
  barEnd: { display: 'flex', alignItems: 'center', gap: space.md, flexShrink: 0 },
  status: { fontSize: text.sm, fontWeight: weight.semibold, flexShrink: 0 },
  jump: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingInline: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.muted,
    font: 'inherit',
    fontSize: text.sm,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  kbd: {
    paddingInline: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.sm,
    fontFamily: 'inherit',
    fontSize: text.xs,
    color: color.muted,
  },
  barTitle: {
    overflow: 'hidden',
    fontSize: text.lg,
    fontWeight: weight.bold,
    letterSpacing: '-0.01em',
    lineHeight: text.leadingTight,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Page content: centered, capped width; every route renders inside it.
  main: {
    width: '100%',
    maxWidth: layout.wide,
    marginInline: 'auto',
    padding: { default: space.lg, '@media (min-width: 768px)': space.xl },
    outline: 'none', // focus-ok: skip-link target, focused by script only
  },
  mainNarrow: { maxWidth: layout.content },
  // Clear the fixed tab bar and the home indicator.
  mainPhone: { paddingBottom: `calc(${layout.tabBar} + env(safe-area-inset-bottom) + ${space.xl})` },
})
