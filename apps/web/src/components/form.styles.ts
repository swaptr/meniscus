import * as stylex from '@stylexjs/stylex'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

/** The form row (DESIGN.md 5.17): label `sm`/600, a 48 px control with 17 px text and a `borderStrong` edge, hint or error. */
export const f = stylex.create({
  field: { display: 'flex', flexDirection: 'column', gap: space.sm, minWidth: 0 },
  label: { fontSize: text.sm, fontWeight: weight.semibold, color: color.fg },
  optional: { fontWeight: weight.regular, color: color.muted },
  hint: { fontSize: text.xs, color: color.muted },
  fieldError: { fontSize: text.sm, fontWeight: weight.semibold, color: color.danger },
  wrap: { position: 'relative', display: 'flex' },
  input: {
    width: '100%',
    minHeight: 48,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.borderStrong, ':hover': color.fg, ':focus-visible': color.accent },
    borderRadius: radius.md,
    backgroundColor: color.bg,
    color: color.fg,
    fontSize: text.lg,
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineColor: color.accent,
    outlineOffset: 2,
    fontFamily: 'inherit',
    '::placeholder': { color: color.muted },
  },
  withToggle: { paddingInlineEnd: `calc(${space.xxl} * 2)` },
  /** A textarea: the input's box, taller. */
  textarea: { minHeight: 96, paddingBlock: space.md, lineHeight: text.leading, resize: 'vertical' },
  /** `Set to 21:38` beside a native time input (24 h echo). */
  echo: { fontSize: text.sm, color: color.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  /** A native select: the input's box with the strong boundary (DESIGN.md 2.1). */
  select: { borderColor: { default: color.borderStrong, ':focus-visible': color.accent }, cursor: 'pointer' },
  toggle: {
    position: 'absolute',
    insetInlineEnd: space.xs,
    top: space.xs,
    bottom: space.xs,
    display: 'grid',
    placeItems: 'center',
    width: 44,
    borderWidth: 0,
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    color: color.muted,
    cursor: 'pointer',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineColor: color.accent,
  },
  /** A field kept for password managers (the username on a password-only form): out of sight and out of reach. */
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' },
  error: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    paddingBlock: space.md,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.dangerBg,
    color: color.danger,
    fontSize: text.sm,
    fontWeight: weight.semibold,
  },
})
