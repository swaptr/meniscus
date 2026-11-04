/** Area `wards`: wards, their census, and admission (bed) lookups. */
import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm'
import type { AcuityLevel, Admission, Ward } from '@meniscus/shared'
import { shiftStart } from '@meniscus/shared'
import { admission, entry, staff, ward, ward_shift } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { at, iso, isoOrNull, staffRef, type Ctx } from './context.ts'

const DAY_MS = 24 * 3_600_000

const admissionCols = { ...getTableColumns(admission), ward_code: ward.code, ward_name: ward.name }

const toAdmission = (r: typeof admission.$inferSelect & { ward_code: string; ward_name: string }): Admission => ({
  id: r.id,
  bed: r.bed,
  patient: r.patient,
  weight_kg: r.weight_kg,
  qr_token: r.qr_token,
  admitted_at: iso(r.admitted_at),
  ward_id: r.ward_id,
  ward_code: r.ward_code,
  ward_name: r.ward_name,
  mrn: r.mrn,
})

const toWard = (r: typeof ward.$inferSelect): Ward => ({
  id: r.id,
  code: r.code,
  name: r.name,
  specialty: r.specialty,
  capacity: r.capacity,
  default_acuity: r.default_acuity,
})

export function wardsArea({ db, now }: Ctx) {
  const admissions = () => db.select(admissionCols).from(admission).innerJoin(ward, eq(ward.id, admission.ward_id))

  const one = async (id: number): Promise<Admission | undefined> => {
    const [r] = await admissions().where(eq(admission.id, id))
    return r && toAdmission(r)
  }

  return {
    wards: async () => {
      const since = at(now() - DAY_MS)
      const shift = at(shiftStart(now()).start)
      const rows = await db
        .select({
          ...getTableColumns(ward),
          occupied: sql<number>`(SELECT count(*)::int FROM ${admission} WHERE ${admission.ward_id} = ${ward.id})`,
          pending: sql<number>`(SELECT count(*)::int FROM ${entry} JOIN ${admission} ON ${admission.id} = ${entry.admission_id}
            WHERE ${admission.ward_id} = ${ward.id} AND ${entry.status} = 'pending' AND ${entry.created_at} >= ${since})`,
          last_entry_at:
            sql<Date | null>`(SELECT max(${entry.created_at}) FROM ${entry} JOIN ${admission} ON ${admission.id} = ${entry.admission_id}
            WHERE ${admission.ward_id} = ${ward.id} AND ${entry.created_at} >= ${since})`.mapWith(entry.created_at),
          ic_id: staff.id,
          ic_name: staff.name,
          ic_role: staff.role,
        })
        .from(ward)
        .leftJoin(ward_shift, and(eq(ward_shift.ward_id, ward.id), eq(ward_shift.shift_start, shift)))
        .leftJoin(staff, eq(staff.id, ward_shift.staff_id))
        .orderBy(ward.code)
      return rows.map((r) => ({
        ...toWard(r),
        occupied: r.occupied,
        pending: r.pending,
        last_entry_at: isoOrNull(r.last_entry_at),
        in_charge: staffRef(r.ic_id, r.ic_name, r.ic_role),
      }))
    },
    ward: async (id) => {
      const [r] = await db.select().from(ward).where(eq(ward.id, id))
      return r && toWard(r)
    },
    acuityDefaults: async () => {
      const rows = await db.select({ id: ward.id, default_acuity: ward.default_acuity }).from(ward)
      return new Map<number, AcuityLevel>(rows.map((r) => [r.id, r.default_acuity]))
    },
    admission: one,
    admissionsIn: async (ids) => {
      if (!ids.length) return new Map()
      const rows = await admissions().where(inArray(admission.id, [...ids]))
      return new Map(rows.map((r) => [r.id, toAdmission(r)] as const))
    },
    admissionByToken: async (token) => {
      const [r] = await admissions().where(eq(admission.qr_token, token))
      return r && toAdmission(r)
    },
  } satisfies Partial<Store>
}
