/**
 * The demo hospital (charting/wards "Demo hospital"), seeded on open into empty tables only:
 * staff missing from the roster (with their committed password hashes), then wards, beds and the demo shift when there is
 * no admission, then ward teams when `staff_ward` is empty. One transaction, under an advisory lock, so two servers
 * starting on one database seed once.
 */
import { randomBytes } from 'node:crypto'
import { and, eq, isNull, notExists, sql } from 'drizzle-orm'
import { shiftStart } from '@meniscus/shared'
import { admission, bed_assignment, staff, staff_ward, ward, ward_shift } from '../../db/schema.ts'
import type { Db } from '../../db/client.ts'
import { DEMO_ASSIGNMENTS, DEMO_HOSPITAL, DEMO_IN_CHARGE, DEMO_STAFF, DEMO_TEAMS } from '../demo-hospital.ts'
import { DEMO_PASSWORD_HASHES } from '../demo-passwords.ts'
import { at } from './context.ts'

/** Transaction-scoped advisory lock key for seeding (two int4s: 'MNSC', 2). */
const SEED_LOCK = sql`SELECT pg_advisory_xact_lock(1296978755, 2)`

export async function seedDemo(db: Db, nowMs: number) {
  await db.transaction(async (t) => {
    await t.execute(SEED_LOCK)
    for (const s of DEMO_STAFF) {
      await t.insert(staff).values({ id: s.id, name: s.name, role: s.role }).onConflictDoNothing({ target: staff.id })
      // Credentials only for a demo member without any, and never a username someone else holds.
      const taken = t
        .select({ one: sql`1` })
        .from(staff)
        .where(eq(staff.username, s.username))
      await t
        .update(staff)
        .set({ username: s.username, password_hash: DEMO_PASSWORD_HASHES[s.id] ?? null })
        .where(and(eq(staff.id, s.id), eq(staff.name, s.name), isNull(staff.password_hash), notExists(taken)))
    }

    const [anyBed] = await t.select({ id: admission.id }).from(admission).limit(1)
    if (!anyBed) {
      const shift = at(shiftStart(nowMs).start)
      const wards = new Map<string, number>()
      const beds = new Map<string, number>()
      for (const w of DEMO_HOSPITAL) {
        const [row] = await t
          .insert(ward)
          .values({
            code: w.code,
            name: w.name,
            specialty: w.specialty,
            capacity: w.capacity,
            default_acuity: w.default_acuity ?? 'stable',
          })
          .onConflictDoUpdate({ target: ward.code, set: { name: w.name } })
          .returning({ id: ward.id })
        wards.set(w.code, row!.id)
        for (const p of w.patients) {
          const [a] = await t
            .insert(admission)
            .values({
              ward_id: row!.id,
              bed: p.bed,
              patient: p.patient,
              weight_kg: p.weight_kg,
              mrn: p.mrn,
              qr_token: randomBytes(16).toString('base64url'),
              admitted_at: at(nowMs),
            })
            .returning({ id: admission.id })
          beds.set(`${w.code}:${p.bed}`, a!.id)
        }
      }
      // The demo shift starts staffed; later shifts start with nobody in charge and no bed assigned.
      for (const [code, staffId] of Object.entries(DEMO_IN_CHARGE)) {
        await t.insert(ward_shift).values({ ward_id: wards.get(code)!, shift_start: shift, staff_id: staffId, set_at: at(nowMs) })
      }
      if (DEMO_ASSIGNMENTS.length) {
        await t.insert(bed_assignment).values(
          DEMO_ASSIGNMENTS.map((b) => ({
            ward_id: wards.get(b.ward)!,
            shift_start: shift,
            admission_id: beds.get(`${b.ward}:${b.bed}`)!,
            staff_id: b.staff_id,
            set_at: at(nowMs),
          })),
        )
      }
    }

    const [anyTeam] = await t.select({ id: staff_ward.staff_id }).from(staff_ward).limit(1)
    if (!anyTeam) {
      for (const s of DEMO_STAFF) {
        for (const [rank, code] of (DEMO_TEAMS[s.id] ?? []).entries()) {
          // Only for the demo member and ward actually present (a roster or ward renamed by hand is left alone).
          await t.execute(sql`
            INSERT INTO ${staff_ward} (staff_id, ward_id, rank)
            SELECT ${staff.id}, ${ward.id}, ${rank} FROM ${staff}, ${ward}
            WHERE ${staff.id} = ${s.id} AND ${staff.name} = ${s.name} AND ${ward.code} = ${code}`)
        }
      }
    }
  })
}
