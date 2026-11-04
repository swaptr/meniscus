/**
 * Who works where, DOM-free: your wards first, the nurse in charge, each bed's nurse, and the reason asked before a ward
 * outside your wards opens (break-the-glass). Role policy reads the shared lists only. None of it calls a model.
 */
import {
  IN_CHARGE_ROLES,
  OVERSEER_ROLES,
  shiftStart,
  type AdmissionSummary,
  type BedAssignment,
  type Staff,
  type WardAccessInput,
  type WardSummary,
  type WardTeam,
} from '@meniscus/shared'
import { ApiError, errorText, type Api } from './api.ts'
import { shortName } from './staff.ts'

type Person = Pick<Staff, 'id' | 'role' | 'wards'>
const onWard = (wardId: number, staff: Pick<Staff, 'wards'>) => staff.wards.some((w) => w.id === wardId)

/** The signed-in person's wards (in their order, home first), then the rest in code order. */
export function splitWards(wards: readonly WardSummary[], staff: Pick<Staff, 'wards'> | null) {
  const mine = staff?.wards ?? []
  const yours = mine.map((m) => wards.find((w) => w.id === m.id)).filter((w): w is WardSummary => w !== undefined)
  const others = wards
    .filter((w) => !onWard(w.id, { wards: mine }))
    .toSorted((x, y) => x.code.localeCompare(y.code, 'en', { numeric: true }))
  return { yours, others }
}

/** The ward card's line. */
export const inChargeLine = (w: Pick<WardSummary, 'in_charge'>) =>
  w.in_charge ? `In charge: ${shortName(w.in_charge.name)}` : 'No nurse in charge'

/** The notice on a ward dashboard or bed review outside the person's wards; null on their own. */
export const outsideTeam = (wardId: number, wardName: string, staff: Pick<Staff, 'wards'> | null) =>
  staff && !onWard(wardId, staff) ? `You are not on the ${wardName} team. Changes are recorded in your name.` : null

/** The team was loaded in the shift that is still on: its nurse in charge and assignments hold. */
const current = (team: WardTeam, now: number) => shiftStart(now).start === Date.parse(team.shift_start)
const inChargeNow = (team: WardTeam, now: number) => (current(team, now) ? team.in_charge : null)

export function inChargeText(team: WardTeam, now: number): string {
  const who = inChargeNow(team, now)
  return who ? `In charge: ${shortName(who.name)} · ${shiftStart(now).name} shift` : 'No nurse in charge this shift'
}

const mayBeInCharge = (team: WardTeam, staff: Pick<Staff, 'id' | 'role'>) =>
  IN_CHARGE_ROLES.includes(staff.role) && team.team.some((m) => m.id === staff.id)

/** A nurse on the team who is not in charge this shift. */
export const canTakeCharge = (team: WardTeam, staff: Person | null, now: number) =>
  staff !== null && mayBeInCharge(team, staff) && inChargeNow(team, now)?.id !== staff.id

/** One PUT; the response is the ward team. */
export const takeCharge = (api: Api, wardId: number, staffId: number) => api.setInCharge(wardId, { staff_id: staffId })

/** The current shift's assignments: none once the team's shift has ended. */
export const assignmentsNow = (team: WardTeam, now: number): BedAssignment[] => (current(team, now) ? team.assignments : [])

export function bedNurse(team: WardTeam, admissionId: number, now: number): string {
  const a = assignmentsNow(team, now).find((x) => x.admission_id === admissionId)
  const who = a && team.team.find((m) => m.id === a.staff_id)
  return who ? `Nurse: ${shortName(who.name)}` : 'Unassigned'
}

/** "My beds": null when the person has no beds here this shift; else theirs, plus the beds with prompts when in charge. */
export function myBeds(beds: readonly AdmissionSummary[], team: WardTeam, staff: Person | null, now: number): AdmissionSummary[] | null {
  if (!staff) return null
  const mine = new Set(
    assignmentsNow(team, now)
      .filter((a) => a.staff_id === staff.id)
      .map((a) => a.admission_id),
  )
  if (mine.size === 0) return null
  const inCharge = inChargeNow(team, now)?.id === staff.id
  return beds.filter((b) => mine.has(b.id) || (inCharge && b.alerts.length > 0))
}

/** What the bed list shows: "My beds" when on and the person has beds; else every bed. */
export const visibleBeds = (beds: readonly AdmissionSummary[], mine: AdmissionSummary[] | null, on: boolean) =>
  on && mine ? mine : [...beds]

/** The ward's nurse in charge this shift, or the overseer of the ward. */
export const canAssign = (team: WardTeam, staff: Person | null, now: number) =>
  staff !== null && (inChargeNow(team, now)?.id === staff.id || (OVERSEER_ROLES.includes(staff.role) && onWard(team.ward_id, staff)))

/** The bed picker's choices: `Unassigned`, then the team's nurses. */
export const nurseOptions = (team: WardTeam): { value: number | null; label: string }[] => [
  { value: null, label: 'Unassigned' },
  ...team.team.filter((m) => mayBeInCharge(team, m)).map((m) => ({ value: m.id, label: m.name })),
]

/** One PUT with every bed's assignment and the one change (null: unassigned). The response is the ward team. */
export function assignBed(api: Api, team: WardTeam, admissionId: number, staffId: number | null, now: number) {
  const beds = assignmentsNow(team, now).flatMap((a) =>
    a.admission_id !== admissionId ? [a] : staffId === null ? [] : [{ admission_id: admissionId, staff_id: staffId }],
  )
  if (staffId !== null && !beds.some((a) => a.admission_id === admissionId)) beds.push({ admission_id: admissionId, staff_id: staffId })
  return api.assignBeds(team.ward_id, { beds })
}

// ---------- break-the-glass ----------

export const ACCESS_KEY = 'meniscus.access'
export const REASON_MAX = 200

/** A reason given on this device: that person, that ward, that shift. */
export interface AccessGrant {
  staff_id: number
  ward_id: number
  shift_start: number
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** Grants kept in localStorage; earlier shifts' grants are dropped on each write. */
export function accessGrants(storage: Storage | null) {
  const listeners = new Set<() => void>()
  const list = (): AccessGrant[] => {
    try {
      const v: unknown = JSON.parse(storage?.getItem(ACCESS_KEY) ?? '[]')
      return Array.isArray(v)
        ? v.filter(
            (g): g is AccessGrant =>
              typeof g === 'object' &&
              g !== null &&
              [(g as AccessGrant).staff_id, (g as AccessGrant).ward_id, (g as AccessGrant).shift_start].every(Number.isInteger),
          )
        : []
    } catch {
      return []
    }
  }
  return {
    list,
    has: (staffId: number, wardId: number, shift: number) =>
      list().some((g) => g.staff_id === staffId && g.ward_id === wardId && g.shift_start === shift),
    add(grant: AccessGrant) {
      try {
        storage?.setItem(ACCESS_KEY, JSON.stringify([...list().filter((g) => g.shift_start >= grant.shift_start), grant]))
      } catch {
        // Private mode or full storage: asked again on the next visit.
      }
      for (const l of listeners) l()
    },
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
  }
}

export type AccessGrants = ReturnType<typeof accessGrants>

/** True for a ward outside the person's wards with no reason given by them, on this device, this shift. */
export const needsReason = (wardId: number, staff: Pick<Staff, 'id' | 'wards'>, now: number, grants: Pick<AccessGrants, 'has'>) =>
  !onWard(wardId, staff) && !grants.has(staff.id, wardId, shiftStart(now).start)

/** The request body, or null while "Open ward" stays disabled (a blank field, or a reason over 200 characters). */
export function reasonBody(reason: string, password: string): WardAccessInput | null {
  const r = reason.trim()
  return r && r.length <= REASON_MAX && password ? { reason: r, password } : null
}

/** One `POST /api/wards/:id/access`; the grant is kept only when it is accepted. */
export async function grantAccess(
  api: Api,
  wardId: number,
  staffId: number,
  input: WardAccessInput,
  now: number,
  grants: Pick<AccessGrants, 'add'>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api.recordAccess(wardId, input)
  } catch (err) {
    return { ok: false, error: err instanceof ApiError && err.code === 'invalid_credentials' ? 'Wrong password' : errorText(err) }
  }
  grants.add({ staff_id: staffId, ward_id: wardId, shift_start: shiftStart(now).start })
  return { ok: true }
}

/** Cancelling the reason: back one page, or `fallback` (the ward list; `/d` from a patient nutrition view) when there is none. */
export const cancelTo = <F extends '/n' | '/d' = '/n'>(canGoBack: boolean, fallback: F = '/n' as F): 'back' | F =>
  canGoBack ? 'back' : fallback
