/** The phone bottom bar's items (web/interface "Navigation on phones"), apart from the sections so the shell stays small. Pure. */
import { DIETITIAN_ROLES, type Staff } from '@meniscus/shared'

export type BottomId = 'capture' | 'wards' | 'nutrition' | 'more'
export interface BottomItem {
  id: BottomId
  label: string
  /** Absent for More, which opens the drawer. */
  href?: string
}

/** The phone bottom bar: none for attendants (their screens are one task each). */
export function bottomItems(staff: Pick<Staff, 'role'> | null): BottomItem[] {
  if (!staff || staff.role === 'attendant') return []
  return [
    { id: 'capture', label: 'Capture', href: '/a' },
    { id: 'wards', label: 'Wards', href: '/n' },
    ...(DIETITIAN_ROLES.includes(staff.role) ? [{ id: 'nutrition' as const, label: 'Nutrition', href: '/d' }] : []),
    { id: 'more', label: 'More' },
  ]
}

/** Which bottom item a path belongs to. */
export function bottomCurrent(pathname: string): BottomId | null {
  if (pathname.startsWith('/a')) return 'capture'
  if (pathname.startsWith('/d')) return 'nutrition'
  if (pathname.startsWith('/n')) return 'wards'
  return null
}
