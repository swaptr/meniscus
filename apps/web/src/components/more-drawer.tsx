/**
 * The More drawer on phones (DESIGN.md 4.3; web/interface "Navigation on phones"): the sidebar's sections in a Base UI
 * Drawer from the left. Closes on a link, Escape, a tap outside or a swipe. A lazy chunk; sends no request.
 */
import { Drawer } from '@base-ui/react/drawer'
import * as stylex from '@stylexjs/stylex'
import { useSections } from '../lib/use-sections.ts'
import { color, layer, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { BrandMark } from './brand-mark.tsx'
import { SidebarSections } from './sidebar.tsx'

export function MoreDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const list = useSections()
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <Drawer.Portal>
        <Drawer.Backdrop {...stylex.props(s.backdrop)} />
        <Drawer.Viewport {...stylex.props(s.viewport)}>
          <Drawer.Popup {...stylex.props(s.popup)}>
            <div {...stylex.props(s.head)}>
              <Drawer.Title {...stylex.props(s.title)}>
                <BrandMark />
              </Drawer.Title>
              <Drawer.Close {...stylex.props(s.close)}>Close</Drawer.Close>
            </div>
            <SidebarSections list={list} onNavigate={() => onOpenChange(false)} />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

const s = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: layer.drawer,
    backgroundColor: `color-mix(in srgb, ${color.fg} 45%, transparent)`,
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transitionProperty: 'opacity',
    transitionDuration: motion.overlay,
  },
  viewport: { position: 'fixed', inset: 0, zIndex: layer.drawer, display: 'flex', pointerEvents: 'none' },
  popup: {
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    width: 'min(85vw, 320px)',
    height: '100dvh',
    overflowY: 'auto',
    paddingBlock: `calc(${space.lg} + env(safe-area-inset-top)) ${space.xl}`,
    borderStartEndRadius: radius.lg,
    borderEndEndRadius: radius.lg,
    backgroundColor: color.rail,
    boxShadow: shadow.raised,
    transform: {
      default: 'translateX(var(--drawer-swipe-movement-x, 0px))',
      ':is([data-starting-style],[data-ending-style])': 'translateX(-100%)',
    },
    transitionProperty: 'transform',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md, paddingInline: space.lg },
  title: { margin: 0 },
  close: {
    minHeight: 44,
    minWidth: 44,
    paddingInline: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    color: color.fg,
    font: 'inherit',
    fontSize: text.sm,
    fontWeight: weight.semibold,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
})
