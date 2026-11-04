import * as stylex from '@stylexjs/stylex'
import { color, layer, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'

// lib/sheet.ts SHEET_MAX: a bottom sheet up to 640 px, a centred card from 641 px.
const PHONE = '@media (max-width: 640px)'

/** The one dialog recipe (DESIGN.md 5.2): same backdrop, 16 px padding, `radius.lg`, opacity + transform at 150 ms. */
export const sheet = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: 'rgba(19, 33, 47, 0.4)',
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transitionProperty: 'opacity',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  popup: {
    position: 'fixed',
    zIndex: layer.dialog,
    top: { default: '50%', [PHONE]: 'auto' },
    bottom: { default: 'auto', [PHONE]: 0 },
    left: '50%',
    translate: { default: '-50% -50%', [PHONE]: '-50% 0' },
    display: 'flex',
    flexDirection: 'column',
    gap: space.xl,
    width: { default: 'min(520px, calc(100vw - 32px))', [PHONE]: '100vw' },
    maxHeight: { default: 'calc(100dvh - 48px)', [PHONE]: 'calc(92dvh - env(safe-area-inset-top))' },
    padding: space.xl,
    paddingBottom: { default: space.xl, [PHONE]: `calc(${space.xl} + env(safe-area-inset-bottom))` },
    borderRadius: { default: radius.lg, [PHONE]: `${radius.lg} ${radius.lg} 0 0` },
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
    color: color.fg,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    outline: 'none', // focus-ok: dialog popup; focus moves to its first control
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transform: {
      default: 'none',
      ':is([data-starting-style],[data-ending-style])': 'scale(0.97)',
      [PHONE]: { default: 'none', ':is([data-starting-style],[data-ending-style])': 'translateY(8px)' },
    },
    transitionProperty: 'opacity, transform',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  /** A dialog opened from inside another (DESIGN.md 2.7: 12/13). */
  nestedBackdrop: { zIndex: layer.nestedBackdrop },
  nested: { zIndex: layer.nested },
  /** A dialog over the lock screen (110/111). */
  overLockBackdrop: { zIndex: layer.overLockBackdrop },
  overLock: { zIndex: layer.overLock },
  wide: { width: { default: 'min(720px, calc(100vw - 32px))', [PHONE]: '100vw' } },
  head: { display: 'flex', alignItems: 'flex-start', gap: space.md },
  headMain: { display: 'flex', flexDirection: 'column', gap: space.xs, flexGrow: 1, minWidth: 0 },
  title: { fontSize: text.lg, fontWeight: weight.bold, letterSpacing: '-0.01em' },
  sub: { fontSize: text.sm, color: color.muted },
  body: { display: 'flex', flexDirection: 'column', gap: space.lg },
  section: { display: 'flex', flexDirection: 'column', gap: space.md },
  h3: { fontSize: text.xs, fontWeight: weight.bold, color: color.muted },
  field: { display: 'flex', flexDirection: 'column', gap: space.sm, fontSize: text.sm, fontWeight: weight.semibold },
  error: { fontSize: text.sm, fontWeight: weight.semibold, color: color.danger },
  savedAs: { fontSize: text.xs, color: color.muted },
  actions: { display: 'flex', gap: space.md, justifyContent: 'flex-end', flexWrap: 'wrap' },
})
