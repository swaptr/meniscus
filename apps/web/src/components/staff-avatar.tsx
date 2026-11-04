import * as stylex from '@stylexjs/stylex'
import type { StaffRole } from '@meniscus/shared'
import { initials, ROLE_AVATAR } from '../lib/staff.ts'
import { radius, text, weight } from '../tokens.stylex.ts'
import { tints } from './ui.styles.ts'

/** Initials on the role's tint (decorative: the name is always written next to it). */
export function StaffAvatar({ name, role, size = 'md' }: { name: string; role: StaffRole; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span aria-hidden {...stylex.props(s.avatar, sizes[size], tints[ROLE_AVATAR[role]])}>
      {initials(name)}
    </span>
  )
}

const s = stylex.create({
  avatar: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    borderRadius: radius.pill,
    fontWeight: weight.heavy,
    letterSpacing: '0.02em',
  },
})

const sizes = stylex.create({
  sm: { width: 28, height: 28, fontSize: text.xs },
  md: { width: 36, height: 36, fontSize: text.sm },
  lg: { width: 56, height: 56, fontSize: text.xl },
})
