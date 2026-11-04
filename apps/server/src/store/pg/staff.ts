/** Area `staff`: the roster, ward teams and shifts, break-the-glass access, and sessions. */
import { and, eq, lte, ne, or, sql } from 'drizzle-orm'
import { SESSION_IDLE_MS, shiftStart, type Staff, type TeamMember, type WardRef, type WardTeam } from '@meniscus/shared'
import { bed_assignment, admission, session, staff, staff_ward, ward, ward_access, ward_shift } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { at, bedOrder, iso, type Ctx } from './context.ts'

const ref = { id: staff.id, name: staff.name, role: staff.role }

async function memberOf({ db }: Ctx, id: number): Promise<Staff | undefined> {
  const [s] = await db.select(ref).from(staff).where(eq(staff.id, id))
  if (!s) return undefined
  const wards = await db
    .select({ id: ward.id, code: ward.code })
    .from(staff_ward)
    .innerJoin(ward, eq(ward.id, staff_ward.ward_id))
    .where(eq(staff_ward.staff_id, id))
    .orderBy(staff_ward.rank)
  return { ...s, wards }
}

async function teamOf({ db, now }: Ctx, wardId: number): Promise<WardTeam | undefined> {
  const [w] = await db.select({ id: ward.id }).from(ward).where(eq(ward.id, wardId))
  if (!w) return undefined
  const shift = at(shiftStart(now()).start)
  const [ic] = await db
    .select(ref)
    .from(ward_shift)
    .innerJoin(staff, eq(staff.id, ward_shift.staff_id))
    .where(and(eq(ward_shift.ward_id, wardId), eq(ward_shift.shift_start, shift)))
  const members = await db
    .select({ ...ref, home: sql<boolean>`${staff_ward.rank} = 0` })
    .from(staff_ward)
    .innerJoin(staff, eq(staff.id, staff_ward.staff_id))
    .where(eq(staff_ward.ward_id, wardId))
    .orderBy(sql`${staff_ward.rank} > 0`, staff.id)
  const assignments = await db
    .select({ admission_id: bed_assignment.admission_id, staff_id: bed_assignment.staff_id })
    .from(bed_assignment)
    .innerJoin(admission, eq(admission.id, bed_assignment.admission_id))
    .where(and(eq(bed_assignment.ward_id, wardId), eq(bed_assignment.shift_start, shift)))
    .orderBy(...bedOrder())
  return {
    ward_id: wardId,
    shift_start: iso(shift),
    in_charge: ic ? { id: ic.id, name: ic.name, role: ic.role } : null,
    team: members.map((m): TeamMember => ({ id: m.id, name: m.name, role: m.role, home: m.home })),
    assignments,
  }
}

export function staffArea(ctx: Ctx) {
  const { db, now } = ctx
  /** Start of the shift `now()` is in: in-charge and bed assignments belong to it. */
  const shiftNow = () => at(shiftStart(now()).start)

  const member = (id: number) => memberOf(ctx, id)
  const team = (wardId: number) => teamOf(ctx, wardId)

  /**
   * A ward-level write: one transaction that first locks the ward row (design §4.1, `FOR NO KEY UPDATE`), so two writers
   * on one ward queue. undefined, with nothing written, when the ward does not exist.
   */
  const wardWrite = (wardId: number, write: (t: Ctx) => Promise<void>) =>
    db.transaction(async (t) => {
      const [w] = await t.select({ id: ward.id }).from(ward).where(eq(ward.id, wardId)).for('no key update')
      if (!w) return undefined
      const inner = { db: t, now }
      await write(inner)
      return teamOf(inner, wardId)
    })

  const endSession = async (tokenHash: string) => {
    await db.delete(session).where(eq(session.token_hash, tokenHash))
  }

  return {
    staff: async () => {
      const wards = new Map<number, WardRef[]>()
      const rows = await db
        .select({ staff_id: staff_ward.staff_id, id: ward.id, code: ward.code })
        .from(staff_ward)
        .innerJoin(ward, eq(ward.id, staff_ward.ward_id))
        .orderBy(staff_ward.staff_id, staff_ward.rank)
      for (const w of rows) wards.set(w.staff_id, [...(wards.get(w.staff_id) ?? []), { id: w.id, code: w.code }])
      const people = await db.select(ref).from(staff).orderBy(staff.id)
      return people.map((s) => ({ ...s, wards: wards.get(s.id) ?? [] }))
    },
    member,
    credentials: async (username) => {
      const [r] = await db
        .select({ ...ref, password_hash: staff.password_hash })
        .from(staff)
        .where(eq(staff.username, username))
      return r && { staff: { id: r.id, name: r.name, role: r.role }, password_hash: r.password_hash }
    },
    username: async (staffId) => {
      const [r] = await db.select({ username: staff.username }).from(staff).where(eq(staff.id, staffId))
      return r?.username ?? null
    },
    team,
    setInCharge: (wardId, staffId, setBy) =>
      wardWrite(wardId, async ({ db: t }) => {
        const shift = shiftNow()
        await t
          .delete(ward_shift)
          .where(and(eq(ward_shift.staff_id, staffId), eq(ward_shift.shift_start, shift), ne(ward_shift.ward_id, wardId)))
        await t
          .insert(ward_shift)
          .values({ ward_id: wardId, shift_start: shift, staff_id: staffId, set_by: setBy, set_at: at(now()) })
          .onConflictDoUpdate({
            target: [ward_shift.ward_id, ward_shift.shift_start],
            set: { staff_id: staffId, set_by: setBy, set_at: at(now()) },
          })
      }),
    assignBeds: (wardId, beds, setBy) =>
      wardWrite(wardId, async ({ db: t }) => {
        const shift = shiftNow()
        await t.delete(bed_assignment).where(and(eq(bed_assignment.ward_id, wardId), eq(bed_assignment.shift_start, shift)))
        if (!beds.length) return
        await t.insert(bed_assignment).values(
          beds.map((b) => ({
            ward_id: wardId,
            shift_start: shift,
            admission_id: b.admission_id,
            staff_id: b.staff_id,
            set_by: setBy,
            set_at: at(now()),
          })),
        )
      }),
    recordAccess: async (wardId, staffId, reason) => {
      const t = now()
      const [row] = await db
        .insert(ward_access)
        .values({ ward_id: wardId, staff_id: staffId, reason, created_at: at(t) })
        .returning({ id: ward_access.id })
      const s = (await member(staffId))!
      return { id: row!.id, ward_id: wardId, created_by: { id: s.id, name: s.name, role: s.role }, reason, created_at: iso(at(t)) }
    },
    createSession: async (tokenHash, staffId) => {
      const t = now()
      await db.insert(session).values({
        token_hash: tokenHash,
        staff_id: staffId,
        created_at: at(t),
        last_seen_at: at(t),
        expires_at: at(shiftStart(t).end),
      })
    },
    sessionStaff: async (tokenHash) => {
      const [s] = await db
        .select({ staff_id: session.staff_id, last_seen_at: session.last_seen_at, expires_at: session.expires_at })
        .from(session)
        .where(eq(session.token_hash, tokenHash))
      if (!s) return null
      const t = now()
      if (s.expires_at.getTime() <= t || s.last_seen_at.getTime() + SESSION_IDLE_MS <= t) {
        await endSession(tokenHash)
        return null
      }
      await db
        .update(session)
        .set({ last_seen_at: at(t) })
        .where(eq(session.token_hash, tokenHash))
      return (await member(s.staff_id)) ?? null
    },
    endSession,
  } satisfies Partial<Store>
}

/** On open: sessions past their shift's end or idle too long go. */
export async function endEndedSessions({ db, now }: Ctx) {
  const t = now()
  await db.delete(session).where(or(lte(session.expires_at, at(t)), lte(session.last_seen_at, at(t - SESSION_IDLE_MS))))
}
