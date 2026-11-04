import type { StaffRef, StaffRole } from '@meniscus/shared'
import { DIETITIAN_ROLES } from '@meniscus/shared'
import type { MenuItem } from './components/menu-list.tsx'
import { BedIcon, CameraIcon, MealIcon } from './components/icons.tsx'

/** A navigation item; with `roles`, shown only to those roles. */
export type NavItem = MenuItem & { roles?: readonly StaffRole[] }

export const NAV: NavItem[] = [
  { to: '/d', label: 'Nutrition', icon: MealIcon, roles: DIETITIAN_ROLES },
  { to: '/a', label: 'Capture', icon: CameraIcon },
  { to: '/n', label: 'Wards', icon: BedIcon },
]

/** The items the signed-in person sees. */
export const navFor = (staff: Pick<StaffRef, 'role'> | null, items: readonly NavItem[] = NAV): MenuItem[] =>
  items.filter((i) => !i.roles || (staff !== null && i.roles.includes(staff.role))).map(({ roles: _, ...item }) => item)
