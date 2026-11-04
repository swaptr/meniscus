/**
 * Who is using the app, as the server's session says (lib/session.ts), and what their role means on screen. Role policy
 * comes from the shared lists (`DECIDER_ROLES`) or an exhaustive per-role map, never a role compared to a string.
 */
import { DECIDER_ROLES, type DemoAccount, type StaffRef, type StaffRole } from '@meniscus/shared'

export const ROLE_LABEL: Record<StaffRole, string> = { attendant: 'Attendant', nurse: 'Nurse', matron: 'Matron', dietitian: 'Dietitian' }
/** Avatar tint per role (a `tints` key in components/ui.styles.ts). */
export const ROLE_AVATAR: Record<StaffRole, 'info' | 'pending' | 'ok' | 'in'> = {
  attendant: 'info',
  nurse: 'pending',
  matron: 'ok',
  dietitian: 'in',
}
/** Where `/` takes each role once signed in. */
export const LANDING: Record<StaffRole, '/a' | '/n' | '/d'> = { attendant: '/a', nurse: '/n', matron: '/n', dietitian: '/d' }

export const SWITCH_USER = 'Switch user'
export const DEMO_HINT = 'Demo: the password is the first name in lowercase'
export const DECISION_NOTICE = 'Only a nurse can approve or change entries. Ask the nurse in charge.'

export const staffLabel = (s: Pick<StaffRef, 'name' | 'role'> | null) => (s ? `${s.name} · ${ROLE_LABEL[s.role]}` : 'Nobody signed in')
/** "Ravi K.": enough to tell staff apart in a narrow column. */
export const shortName = (name: string) => {
  const [first, ...rest] = name.split(/\s+/)
  return rest.length ? `${first} ${rest.at(-1)![0]}.` : (first ?? name)
}
export const firstName = (name: string) => name.split(/\s+/)[0] ?? name
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** The sign-in page (web/staff "Sign-in page"). */
export const LOGIN = '/login'

/** `next` when it is a path on this site (one leading `/`, not `/login`), else null: never another site. */
export const safeNext = (next: string | null | undefined): string | null => {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  if (next === LOGIN || next.startsWith(`${LOGIN}?`) || next.startsWith(`${LOGIN}/`)) return null
  return next
}

/** Signed out: `/` shows the landing page, `/login` the sign-in screen, any other URL redirects to sign-in with it as `next`. */
export const signedOutRoute = (
  pathname: string,
  href: string,
): { show: 'landing' | 'sign_in' } | { redirect: { to: typeof LOGIN; next: string } } =>
  pathname === '/' ? { show: 'landing' } : pathname === LOGIN ? { show: 'sign_in' } : { redirect: { to: LOGIN, next: href } }

/** The path to open once signed in: the one asked for, a safe `next` from `/login`, or the role's landing page. */
export const landingPath = (path: string, staff: Pick<StaffRef, 'role'>, next?: string | null) =>
  path === '/' ? LANDING[staff.role] : path === LOGIN ? (safeNext(next) ?? LANDING[staff.role]) : path

/** May approve, reject, amend and void. */
export const canDecide = (staff: Pick<StaffRef, 'role'> | null) => staff !== null && DECIDER_ROLES.includes(staff.role)
/** What the review section says instead of the decision buttons; null when they are shown. */
export const decisionNotice = (staff: Pick<StaffRef, 'role'> | null) => (canDecide(staff) ? null : DECISION_NOTICE)

export interface DemoGroup {
  /** The home ward's code; null for those with none (the matron, the dietitian). */
  ward: string | null
  /** The ward's code, or the role of those with no home ward. */
  title: string
  accounts: DemoAccount[]
}

/** Demo accounts by home ward in code order, nurses first within a ward; those with no home ward last. */
export function demoGroups(accounts: readonly DemoAccount[]): DemoGroup[] {
  const byWard = new Map<string, DemoAccount[]>()
  const none: DemoAccount[] = []
  for (const a of accounts) {
    if (a.ward === null) none.push(a)
    else byWard.set(a.ward, [...(byWard.get(a.ward) ?? []), a])
  }
  const deciderFirst = (list: DemoAccount[]) => list.toSorted((x, y) => Number(!canDecide(x)) - Number(!canDecide(y)))
  const groups = [...byWard]
    .sort(([x], [y]) => x.localeCompare(y, 'en', { numeric: true }))
    .map(([ward, list]): DemoGroup => ({ ward, title: ward, accounts: deciderFirst(list) }))
  const roles = [...new Set(none.map((a) => a.role))]
  for (const role of roles) groups.push({ ward: null, title: ROLE_LABEL[role], accounts: none.filter((a) => a.role === role) })
  return groups
}
