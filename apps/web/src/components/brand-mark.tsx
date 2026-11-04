import * as stylex from '@stylexjs/stylex'
import { PRODUCT } from '../lib/brand.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { DropIcon } from './icons.tsx'

/** The drop on an accent tile, then the product name unless `markOnly` (DESIGN.md 4.1). */
export function BrandMark({ markOnly = false, size = 'md' }: { markOnly?: boolean; size?: 'md' | 'lg' }) {
  return (
    <span {...stylex.props(s.brand)}>
      <span
        aria-hidden={!markOnly}
        aria-label={markOnly ? PRODUCT : undefined}
        role={markOnly ? 'img' : undefined}
        {...stylex.props(s.tile, size === 'lg' && s.tileLg)}
      >
        <DropIcon size={size === 'lg' ? 24 : 16} strokeWidth={2.25} />
      </span>
      {!markOnly && <span {...stylex.props(s.name)}>{PRODUCT}</span>}
    </span>
  )
}

const s = stylex.create({
  brand: { display: 'inline-flex', alignItems: 'center', gap: space.md, color: color.fg },
  tile: {
    display: 'inline-grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: radius.md,
    color: color.onAccent,
    backgroundColor: color.accent,
  },
  tileLg: { width: 44, height: 44 },
  name: { fontSize: text.lg, fontWeight: weight.heavy, letterSpacing: '-0.01em' },
})
