import * as stylex from '@stylexjs/stylex'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { StaffAvatar } from './staff-avatar.tsx'
import { SwitchUserButton } from './switch-user.tsx'

/** Header: who is signed in (from the server session) and "Switch user". Compact on phones: the avatar and an icon. */
export function StaffBadge({ compact }: { compact: boolean }) {
  const staff = useStaff()
  if (!staff) return null
  const label = staffLabel(staff)
  return (
    <div {...stylex.props(s.row)}>
      <span title={label} {...stylex.props(s.who, compact && s.whoCompact)}>
        <StaffAvatar name={staff.name} role={staff.role} size="sm" />
        <span {...stylex.props(compact ? s.hidden : s.text)}>{label}</span>
      </span>
      <SwitchUserButton icon={compact} />
    </div>
  )
}

const s = stylex.create({
  row: { display: 'flex', alignItems: 'center', gap: space.md, flexShrink: 0 },
  who: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    maxWidth: 260,
    minHeight: 44,
    paddingInlineStart: space.sm,
    paddingInlineEnd: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.subtle,
    color: color.fg,
    fontSize: text.sm,
    fontWeight: weight.semibold,
  },
  whoCompact: { paddingInline: 0, minHeight: 0, backgroundColor: 'transparent' },
  text: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // Read by screen readers on phones, where only the avatar shows.
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    clipPath: 'inset(50%)',
    whiteSpace: 'nowrap',
  },
})
