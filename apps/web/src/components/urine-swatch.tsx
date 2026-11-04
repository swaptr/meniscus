import * as stylex from '@stylexjs/stylex'
import type { Swatch } from '../lib/urine.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

/** The urine's colour: an outlined dot, so pale straw still shows on white, and always its name. */
export function UrineSwatch({ swatch, size = 'md' }: { swatch: Swatch; size?: 'sm' | 'md' }) {
  return (
    <span {...stylex.props(s.wrap, size === 'sm' && s.wrapSmall)} title={swatch.photo ? `${swatch.label}, as photographed` : swatch.label}>
      <span aria-hidden {...stylex.props(s.dot, size === 'sm' && s.dotSmall, s.fill(swatch.fill))} />
      <span {...stylex.props(s.label)}>{swatch.label}</span>
    </span>
  )
}

/** Just the outlined dot, for places that print the name themselves. */
export function UrineDot({ fill, size = 12 }: { fill: string; size?: number }) {
  return <span aria-hidden {...stylex.props(s.dot, s.fill(fill), s.size(size))} />
}

const s = stylex.create({
  wrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    fontSize: text.sm,
    fontWeight: weight.semibold,
    color: color.fg,
    // No nowrap: long names ("Pale straw · pending") wrap under narrow totals instead of widening them.
    minWidth: 0,
  },
  wrapSmall: { fontWeight: weight.regular, color: color.muted },
  label: { minWidth: 0 },
  dot: {
    display: 'inline-block',
    width: 14,
    height: 14,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    // Dark enough that the palest straw still has an edge on a white card.
    borderColor: 'rgba(15, 23, 42, 0.45)',
  },
  dotSmall: { width: 11, height: 11 },
  fill: (hex: string) => ({ backgroundColor: hex }),
  size: (px: number) => ({ width: px, height: px }),
})
