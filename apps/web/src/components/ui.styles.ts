import * as stylex from '@stylexjs/stylex'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

/** Layout helpers and shared recipes (DESIGN.md §5). */
export const ui = stylex.create({
  stack: { display: 'flex', flexDirection: 'column', gap: space.lg },
  row: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  muted: { color: color.muted, fontSize: text.sm },
  grow: { flexGrow: 1 },
  /** The one keyboard focus ring (DESIGN.md §9.2): 2 px accent, offset 2 px, on `:focus-visible` only. */
  focus: {
    outlineWidth: { default: 0, ':focus-visible': 2 },
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  /** Section and group headings: sentence case `xs`/700 `muted`, no tracking, no uppercase. */
  overline: { fontSize: text.xs, fontWeight: weight.bold, color: color.muted, lineHeight: text.leadingTight },
  /** An inset panel for a draft or a form group: `subtle`, `radius.md`, padding `lg`, no border. */
  inset: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
  },
  /** Tables (DESIGN.md 5.18). */
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: text.sm },
  th: {
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
    textAlign: 'start',
    backgroundColor: color.subtle,
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
    whiteSpace: 'nowrap',
  },
  td: {
    paddingBlock: space.md,
    paddingInline: space.md,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.grid,
    verticalAlign: 'top',
  },
  num: { textAlign: 'end', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  /** Aligned figures. */
  tabular: { fontVariantNumeric: 'tabular-nums' },
  /** Visually hidden, still read (screen-reader tables, live text). */
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
  },
  hiddenInput: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' },
})

/** Tinted fill with readable coloured text (text on tint ≥ 4.5:1, tokens.test.ts). */
export const tints = stylex.create({
  neutral: { backgroundColor: color.subtle, color: color.fg },
  info: { backgroundColor: color.infoBg, color: color.info },
  ok: { backgroundColor: color.okBg, color: color.ok },
  warn: { backgroundColor: color.warnBg, color: color.warnText },
  danger: { backgroundColor: color.dangerBg, color: color.danger },
  pending: { backgroundColor: color.pendingBg, color: color.pending },
  in: { backgroundColor: color.intakeBg, color: color.intakeText },
  out: { backgroundColor: color.outputBg, color: color.outputText },
})

/** Solid fill (dots, icons, bars). */
export const solids = stylex.create({
  neutral: { backgroundColor: color.muted },
  info: { backgroundColor: color.info },
  ok: { backgroundColor: color.ok },
  warn: { backgroundColor: color.warn },
  danger: { backgroundColor: color.danger },
  pending: { backgroundColor: color.pending },
  in: { backgroundColor: color.intake },
  out: { backgroundColor: color.output },
})

/** A tone's mark colour as text/icon colour (glyphs). */
export const marks = stylex.create({
  neutral: { color: color.muted },
  info: { color: color.info },
  ok: { color: color.ok },
  warn: { color: color.warnText },
  danger: { color: color.danger },
  pending: { color: color.pending },
  in: { color: color.intake },
  out: { color: color.output },
})

/** 4px status bar on the leading edge of a banner, tile or notice. */
export const bars = stylex.create({
  neutral: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.border },
  info: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.info },
  ok: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.ok },
  warn: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.warn },
  danger: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.danger },
  pending: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.pending },
  in: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.intake },
  out: { borderInlineStartWidth: 4, borderInlineStartStyle: 'solid', borderInlineStartColor: color.output },
})
