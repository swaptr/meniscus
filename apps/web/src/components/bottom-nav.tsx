/**
 * Phone navigation (DESIGN.md 4.3; web/interface "Navigation on phones"): Capture, Wards, Nutrition (dietitians) and
 * More, each 44 px or more; More opens the lazy drawer. None for attendants. No request.
 */
import { lazy, Suspense, useState, type ComponentType } from 'react'
import { useLocation } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { Staff } from '@meniscus/shared'
import { bottomCurrent, bottomItems, type BottomId } from '../lib/nav-bottom.ts'
import { color, layer, layout, space, text, weight } from '../tokens.stylex.ts'
import { HrefLink } from './href-link.tsx'
import { BedIcon, CameraIcon, MealIcon, MenuIcon } from './icons.tsx'

const MoreDrawer = lazy(() => import('./more-drawer.tsx').then((m) => ({ default: m.MoreDrawer })))

const ICON: Record<BottomId, ComponentType<{ size?: number }>> = {
  capture: CameraIcon,
  wards: BedIcon,
  nutrition: MealIcon,
  more: MenuIcon,
}

export function BottomNav({ staff }: { staff: Staff | null }) {
  const items = bottomItems(staff)
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  // Loaded on the first tap of More, then kept so it can animate closed.
  const [loaded, setLoaded] = useState(false)
  if (!items.length) return null
  const current = bottomCurrent(pathname)
  return (
    <nav aria-label="Main" data-app-chrome {...stylex.props(s.bar)}>
      {items.map((item) => {
        const Icon = ICON[item.id]
        const active = item.id === current
        const body = (
          <>
            <Icon size={24} />
            <span {...stylex.props(s.label)}>{item.label}</span>
            {active && <span aria-hidden {...stylex.props(s.indicator)} />}
          </>
        )
        return item.href ? (
          <HrefLink key={item.id} href={item.href} current={active} xstyle={[s.tab, active && s.active]}>
            {body}
          </HrefLink>
        ) : (
          <button
            key={item.id}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => {
              setLoaded(true)
              setOpen(true)
            }}
            {...stylex.props(s.tab, s.button)}
          >
            {body}
          </button>
        )
      })}
      {loaded && (
        <Suspense fallback={null}>
          <MoreDrawer open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </nav>
  )
}

const s = stylex.create({
  bar: {
    position: 'fixed',
    insetInline: 0,
    bottom: 0,
    zIndex: layer.tabBar,
    display: 'grid',
    gridAutoColumns: '1fr',
    gridAutoFlow: 'column',
    height: `calc(${layout.tabBar} + env(safe-area-inset-bottom))`,
    paddingBottom: 'env(safe-area-inset-bottom)',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
  tab: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    minHeight: 48,
    color: color.muted,
    textDecoration: 'none',
    WebkitTapHighlightColor: 'transparent',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  button: { borderWidth: 0, backgroundColor: 'transparent', font: 'inherit', cursor: 'pointer' },
  active: { color: color.accent },
  label: { fontSize: text.xs, fontWeight: weight.semibold },
  indicator: {
    position: 'absolute',
    top: 0,
    width: 36,
    height: 3,
    backgroundColor: color.accent,
  },
})
