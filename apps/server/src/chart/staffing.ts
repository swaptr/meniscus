/**
 * Staffing policy (pure): who is listed in a ward team, who may name the nurse in charge, be named, and assign beds.
 * Every rule reads the role lists in @meniscus/shared; none names a role.
 */
import { DECIDER_ROLES, IN_CHARGE_ROLES, OVERSEER_ROLES, TEAM_ROLES, type Staff, type TeamMember, type WardTeam } from '@meniscus/shared'

/** TEAM_ROLES only (no overseer or dietitian); in-charge roles first, otherwise the store's order (home before cover, then id). */
export const orderTeam = (members: TeamMember[]): TeamMember[] =>
  members
    .filter((m) => TEAM_ROLES.includes(m.role))
    .toSorted((a, b) => Number(!IN_CHARGE_ROLES.includes(a.role)) - Number(!IN_CHARGE_ROLES.includes(b.role)))

/** The ward team as the API returns it. */
export const teamView = (team: WardTeam): WardTeam => ({ ...team, team: orderTeam(team.team) })

/** The ward is one of theirs: home, cover, or overseen. */
export const onWard = (staff: Staff, wardId: number) => staff.wards.some((w) => w.id === wardId)

/** A decider on the ward's team, or the overseer over it. */
export const mayNameInCharge = (staff: Staff, wardId: number) => DECIDER_ROLES.includes(staff.role) && onWard(staff, wardId)

/** May be named nurse in charge of the ward, or assigned its beds. */
export const mayTakeCharge = (staff: Staff, wardId: number) => IN_CHARGE_ROLES.includes(staff.role) && onWard(staff, wardId)

/** The ward's nurse in charge this shift, or the overseer over it. */
export const mayAssignBeds = (staff: Staff, team: WardTeam) =>
  team.in_charge?.id === staff.id || (OVERSEER_ROLES.includes(staff.role) && onWard(staff, team.ward_id))
