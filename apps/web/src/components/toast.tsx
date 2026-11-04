import { useEffect } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Toast } from '@base-ui/react/toast'
import { attachToasts, TOAST_LIMIT, toastOptions, type ToastTone } from '../lib/toast.ts'
import { color, layer, layout, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { XIcon } from './icons.tsx'
import { bars } from './ui.styles.ts'
import { ToneGlyph } from './ui.tsx'
import { ui } from './ui.styles.ts'

const manager = Toast.createToastManager()

/**
 * The one result area (DESIGN.md 5.3): a Base UI toast fixed above the tab bar (viewport bottom on desktop), one at a
 * time, polite for 6 s, a failure assertive until dismissed. Loaded lazily by `ToastHost`; results come from `flash()`.
 */
export function ToastViewport() {
  useEffect(() => attachToasts((t) => manager.add(toastOptions(t))), [])
  return (
    <Toast.Provider toastManager={manager} limit={TOAST_LIMIT}>
      <Toast.Portal>
        <Toast.Viewport {...stylex.props(s.viewport)}>
          <Toasts />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function Toasts() {
  const { toasts } = Toast.useToastManager()
  return toasts.map((t) => {
    const tone = (t.type ?? 'ok') as ToastTone
    return (
      <Toast.Root key={t.id} toast={t} swipeDirection={['down', 'right']} {...stylex.props(s.toast, bars[tone])}>
        <ToneGlyph tone={tone} size={20} />
        <Toast.Content {...stylex.props(s.content)}>
          <Toast.Title {...stylex.props(s.title)} />
        </Toast.Content>
        <Toast.Close aria-label="Dismiss" {...stylex.props(s.close, ui.focus)}>
          <XIcon size={16} aria-hidden />
        </Toast.Close>
      </Toast.Root>
    )
  })
}

const s = stylex.create({
  viewport: {
    position: 'fixed',
    zIndex: layer.toast,
    left: '50%',
    translate: '-50% 0',
    bottom: {
      default: `calc(${layout.tabBar} + ${space.md} + env(safe-area-inset-bottom))`,
      '@media (min-width: 768px)': space.xl,
    },
    width: 'min(520px, calc(100vw - 24px))',
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    outline: 'none', // focus-ok: landmark region; its toasts' close buttons carry the ring
  },
  toast: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    paddingBlock: space.md,
    paddingInlineStart: space.lg,
    paddingInlineEnd: space.xs,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
    color: color.fg,
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transform: { default: 'none', ':is([data-starting-style],[data-ending-style])': 'translateY(8px)' },
    transitionProperty: 'opacity, transform',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  content: { flexGrow: 1, minWidth: 0 },
  title: { fontSize: text.md, fontWeight: weight.semibold, lineHeight: text.leading },
  close: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: layout.tap,
    height: layout.tap,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    color: color.muted,
    cursor: 'pointer',
  },
})
