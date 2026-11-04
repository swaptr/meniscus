import { useLocation } from '@tanstack/react-router'
import { sections, type NavSection } from './nav.ts'
import { useSnapshot } from './use-snapshot.ts'
import { useStaff } from './use-staff.ts'

/** The signed-in person's sections for the current place: no request (counts from the snapshot). */
export function useSections(): NavSection[] {
  const staff = useStaff()
  const snap = useSnapshot()
  const { pathname, searchStr } = useLocation()
  return sections(staff, { pathname, search: searchStr }, snap)
}
