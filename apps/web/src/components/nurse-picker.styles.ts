import * as stylex from '@stylexjs/stylex'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

/** The bed nurse picker's trigger: shared by its stand-in (`nurse-picker.tsx`) and the select itself (`nurse-select.tsx`). */
export const picker = stylex.create({
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    maxWidth: '100%',
    minHeight: 44,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.muted },
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  compact: { gap: space.xs, paddingInline: space.sm, fontSize: text.xs },
  value: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  chevron: { display: 'flex', color: color.muted, marginInlineStart: 'auto' },
})
