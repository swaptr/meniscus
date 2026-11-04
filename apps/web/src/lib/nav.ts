/**
 * The sidebar's sections and the phone bottom bar (web/interface "Sidebar sections and links", "Navigation on phones";
 * DESIGN.md 4.1, 4.3). Pure: counts come from the snapshot the routes wrote, so navigation sends no request.
 */
import { DIETITIAN_ROLES, type AlertTone, type Staff, type StaffRole } from '@meniscus/shared'
import { bedTone } from './labels.ts'
import { clock } from './format.ts'
import type { Snapshot } from './snapshot.ts'

export type NavTone = AlertTone | 'pending' | 'ok'

export interface NavLink {
  label: string
  /** A secondary line or suffix (`Medical Ward 3A`), muted. */
  detail?: string
  href: string
  current: boolean
  /** Ward links: pending entries and beds to review, only once a load has filled them. */
  pips?: { pending: number; review: number; tone: AlertTone | null }
  /** Bed links: the bed's status tone, for its glyph pip. */
  tone?: NavTone
}

export type SectionId = 'capture' | 'wards' | 'this-ward' | 'insights' | 'nutrition'
export interface NavSection {
  id: SectionId
  title: string
  links: NavLink[]
}

export interface Place {
  pathname: string
  /** The search string, with or without `?`. */
  search?: string
}

const OVERSEERS: readonly StaffRole[] = ['nurse', 'matron']
/** At most this many beds under This ward. */
export const THIS_WARD_BEDS = 6

const norm = (search = '') => {
  const p = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  p.sort()
  const s = p.toString()
  return s ? `?${s}` : ''
}
const same = (href: string, place: Place) => {
  const [path, q = ''] = href.split('?')
  return path === place.pathname.replace(/\/$/, '') && norm(q) === norm(place.search)
}

/** The ward this place belongs to: `/n/w/<id>`, or the open bed review's ward. */
export function placeWard(place: Place, snap: Snapshot): number | null {
  const w = /^\/n\/w\/(\d+)/.exec(place.pathname)
  if (w) return Number(w[1])
  if (/^\/n\/\d+(\/|$)/.test(place.pathname)) return snap.bedWard
  return null
}

export function sections(staff: Staff | null, place: Place, snap: Snapshot): NavSection[] {
  if (!staff) return []
  const link = (l: Omit<NavLink, 'current'>): NavLink => ({ ...l, current: same(l.href, place) })
  const out: NavSection[] = []
  const home = staff.wards[0]
  if (home)
    out.push({
      id: 'capture',
      title: 'Capture',
      links: [link({ label: 'Bed picker', href: '/a' }), link({ label: 'Ward round', href: `/a/round?ward=${home.id}` })],
    })
  out.push({
    id: 'wards',
    title: snap.at === null ? 'Wards' : `Wards · as of ${clock(snap.at)}`,
    links: [
      ...staff.wards.map((w) => {
        const f = snap.wards[w.id]
        return link({
          label: w.code,
          ...(f?.name && { detail: f.name }),
          href: `/n/w/${w.id}`,
          ...(f && { pips: { pending: f.pending, review: f.review, tone: f.worst_tone } }),
        })
      }),
      link({ label: 'All wards', href: '/n' }),
    ],
  })
  const overseer = OVERSEERS.includes(staff.role)
  const wardId = placeWard(place, snap)
  if (overseer && wardId !== null) {
    const beds = snap.beds?.wardId === wardId ? snap.beds.items.filter((b) => b.alerts.length > 0).slice(0, THIS_WARD_BEDS) : []
    out.push({
      id: 'this-ward',
      title: 'This ward',
      links: [
        ...beds.map((b) => link({ label: `Bed ${b.bed}`, detail: b.patient, href: `/n/${b.id}`, tone: bedTone(b.alerts, b.pending) })),
        link({ label: 'Data quality', href: `/n/w/${wardId}?view=quality` }),
        link({ label: 'QR cards', href: `/n/w/${wardId}?view=qr` }),
      ],
    })
  }
  if (overseer) out.push({ id: 'insights', title: 'Insights', links: [link({ label: 'Model accuracy', href: '/n?view=model' })] })
  if (DIETITIAN_ROLES.includes(staff.role))
    out.push({ id: 'nutrition', title: 'Nutrition', links: [link({ label: 'Worklist', href: '/d' })] })
  return out
}

export { bottomCurrent, bottomItems, type BottomId, type BottomItem } from './nav-bottom.ts'
