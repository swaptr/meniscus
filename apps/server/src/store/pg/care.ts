/** Area `care`: care orders and catheter reviews, dietitian referrals and assignments, diets. */
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  CARE_KINDS,
  DIETITIAN_ROLES,
  catheterSince,
  chartDay,
  type CareKind,
  type CareOrder,
  type CareReview,
  type DietitianAssignment,
  type Referral,
  type ReferralOutcome,
  type ReferralReason,
} from '@meniscus/shared'
import { careJson, careValue } from '../../chart/care.ts'
import type { Db } from '../../db/client.ts'
import { admission, admission_dietitian, care_order, care_review, referral, staff, staff_ward } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import type {
  AcknowledgeResult,
  AssignResult,
  CareResult,
  CareReviewResult,
  CloseReferralResult,
  HandBackResult,
  ReferResult,
} from '../port.ts'
import { at, iso, isoOrNull, staffRef, type Ctx } from './context.ts'
import { wardsArea } from './wards.ts'

// ---------- care orders ----------

const sb = alias(staff, 'sb')
const eb = alias(staff, 'eb')
const careCols = {
  id: care_order.id,
  admission_id: care_order.admission_id,
  kind: care_order.kind,
  value: care_order.value,
  start_at: care_order.start_at,
  end_at: care_order.end_at,
  set_by: care_order.set_by,
  ended_by: care_order.ended_by,
  sb_name: sb.name,
  sb_role: sb.role,
  eb_name: eb.name,
  eb_role: eb.role,
}
const careRows = (db: Db) =>
  db.select(careCols).from(care_order).leftJoin(sb, eq(sb.id, care_order.set_by)).leftJoin(eb, eq(eb.id, care_order.ended_by))
/** The same, joined to the admission so a ward filter can apply. */
const careRowsByWard = (db: Db) => careRows(db).innerJoin(admission, eq(admission.id, care_order.admission_id))
type CareRow = Awaited<ReturnType<typeof careRows>>[number]

const isCareKind = (k: string): k is CareKind => (CARE_KINDS as readonly string[]).includes(k)
/** Rows of a kind this build does not know (a newer build's) are skipped. */
const toCareOrders = (rows: CareRow[]): CareOrder[] =>
  rows.flatMap((r) => {
    const kind = r.kind
    if (!isCareKind(kind)) return []
    // `value` was written by careJson for this kind, so kind and value correspond.
    const order = {
      id: r.id,
      admission_id: r.admission_id,
      kind,
      value: careValue(kind, JSON.stringify(r.value)),
      start_at: iso(r.start_at),
      end_at: isoOrNull(r.end_at),
      set_by: staffRef(r.set_by, r.sb_name, r.sb_role),
      ended_by: staffRef(r.ended_by, r.eb_name, r.eb_role),
    } as CareOrder
    return [order]
  })
const byAdmission = (orders: CareOrder[]) => {
  const out = new Map<number, CareOrder[]>()
  for (const o of orders) out.set(o.admission_id, [...(out.get(o.admission_id) ?? []), o])
  return out
}
const wardIs = (wardId: number | undefined) => (wardId === undefined ? undefined : eq(admission.ward_id, wardId))

async function careOrder(db: Db, id: number) {
  const [r] = await careRows(db).where(eq(care_order.id, id))
  return toCareOrders([r!])[0]!
}
async function activeCare(db: Db, admissionId: number, kind: CareKind) {
  const [r] = await careRows(db).where(and(eq(care_order.admission_id, admissionId), eq(care_order.kind, kind), isNull(care_order.end_at)))
  return r
}
const catheterOrdersOf = async (db: Db, admissionId: number) =>
  toCareOrders(
    await careRows(db)
      .where(and(eq(care_order.admission_id, admissionId), eq(care_order.kind, 'catheter')))
      .orderBy(asc(care_order.start_at), asc(care_order.id)),
  )

// ---------- reviews ----------

const rs = alias(staff, 's')
const reviewRows = (db: Db) =>
  db
    .select({
      id: care_review.id,
      order_id: care_review.order_id,
      at: care_review.at,
      staff_id: care_review.staff_id,
      s_name: rs.name,
      s_role: rs.role,
    })
    .from(care_review)
    .leftJoin(rs, eq(rs.id, care_review.staff_id))
type ReviewRow = Awaited<ReturnType<typeof reviewRows>>[number]
const toReview = (r: ReviewRow): CareReview => ({
  id: r.id,
  order_id: r.order_id,
  at: iso(r.at),
  by: staffRef(r.staff_id, r.s_name, r.s_role),
})

// ---------- referrals ----------

const cb = alias(staff, 'cb')
const ab = alias(staff, 'ab')
const xb = alias(staff, 'xb')
const referralRows = (db: Db) =>
  db
    .select({
      id: referral.id,
      admission_id: referral.admission_id,
      reason: referral.reason,
      note: referral.note,
      created_at: referral.created_at,
      created_by: referral.created_by,
      acknowledged_at: referral.acknowledged_at,
      acknowledged_by: referral.acknowledged_by,
      closed_at: referral.closed_at,
      closed_by: referral.closed_by,
      outcome: referral.outcome,
      next_review: referral.next_review,
      cb_name: cb.name,
      cb_role: cb.role,
      ab_name: ab.name,
      ab_role: ab.role,
      xb_name: xb.name,
      xb_role: xb.role,
    })
    .from(referral)
    .leftJoin(cb, eq(cb.id, referral.created_by))
    .leftJoin(ab, eq(ab.id, referral.acknowledged_by))
    .leftJoin(xb, eq(xb.id, referral.closed_by))
type ReferralRow = Awaited<ReturnType<typeof referralRows>>[number]
const toReferral = (r: ReferralRow): Referral => ({
  id: r.id,
  admission_id: r.admission_id,
  reason: r.reason as ReferralReason,
  note: r.note,
  status: r.closed_at !== null ? 'closed' : r.acknowledged_at !== null ? 'acknowledged' : 'open',
  created_at: iso(r.created_at),
  created_by: staffRef(r.created_by, r.cb_name, r.cb_role),
  acknowledged_at: isoOrNull(r.acknowledged_at),
  acknowledged_by: staffRef(r.acknowledged_by, r.ab_name, r.ab_role),
  closed_at: isoOrNull(r.closed_at),
  closed_by: staffRef(r.closed_by, r.xb_name, r.xb_role),
  outcome: r.outcome as ReferralOutcome | null,
  next_review: r.next_review,
})
async function referralOf(db: Db, id: number) {
  const [r] = await referralRows(db).where(eq(referral.id, id))
  return r && toReferral(r)
}
/** The admission's newest referral: by creation time, then id. A correlated subquery, so raw `sql` (design §4.2a). */
const latestReferral = sql`${referral.id} = (SELECT x.id FROM ${referral} x WHERE x.admission_id = ${referral.admission_id}
  ORDER BY x.created_at DESC, x.id DESC LIMIT 1)`
const inProgress = async (db: Db, admissionId: number) =>
  (
    await db
      .select({ id: referral.id })
      .from(referral)
      .where(and(eq(referral.admission_id, admissionId), isNull(referral.closed_at)))
  ).length > 0
const coveredWardsOf = async (db: Db) =>
  new Set(
    (
      await db
        .selectDistinct({ ward_id: staff_ward.ward_id })
        .from(staff_ward)
        .innerJoin(staff, eq(staff.id, staff_ward.staff_id))
        .where(inArray(staff.role, [...DIETITIAN_ROLES]))
    ).map((r) => r.ward_id),
  )

// ---------- dietitian assignments ----------

const ds = alias(staff, 's')
const dab = alias(staff, 'ab')
const deb = alias(staff, 'eb')
const assignmentRows = (db: Db) =>
  db
    .select({
      id: admission_dietitian.id,
      admission_id: admission_dietitian.admission_id,
      staff_id: admission_dietitian.staff_id,
      s_name: ds.name,
      s_role: ds.role,
      assigned_at: admission_dietitian.assigned_at,
      assigned_by: admission_dietitian.assigned_by,
      ab_name: dab.name,
      ab_role: dab.role,
      ended_at: admission_dietitian.ended_at,
      ended_by: admission_dietitian.ended_by,
      eb_name: deb.name,
      eb_role: deb.role,
    })
    .from(admission_dietitian)
    .innerJoin(ds, eq(ds.id, admission_dietitian.staff_id))
    .leftJoin(dab, eq(dab.id, admission_dietitian.assigned_by))
    .leftJoin(deb, eq(deb.id, admission_dietitian.ended_by))
type AssignmentRow = Awaited<ReturnType<typeof assignmentRows>>[number]
const toAssignment = (r: AssignmentRow): DietitianAssignment => ({
  id: r.id,
  admission_id: r.admission_id,
  staff: { id: r.staff_id, name: r.s_name, role: r.s_role },
  assigned_at: iso(r.assigned_at),
  assigned_by: staffRef(r.assigned_by, r.ab_name, r.ab_role),
  ended_at: isoOrNull(r.ended_at),
  ended_by: staffRef(r.ended_by, r.eb_name, r.eb_role),
})
const currentAssignment = async (db: Db, admissionId: number) => {
  const [r] = await assignmentRows(db).where(and(eq(admission_dietitian.admission_id, admissionId), isNull(admission_dietitian.ended_at)))
  return r
}
const assignmentOf = async (db: Db, id: number) => {
  const [r] = await assignmentRows(db).where(eq(admission_dietitian.id, id))
  return toAssignment(r!)
}

/** The admission, aliased: `FOR … OF` names a table without its schema, so the locked table needs an alias. */
const bed = alias(admission, 'a')

export function careArea(ctx: Ctx) {
  const { db, now } = ctx
  const { admission: admissionOf } = wardsArea(ctx)

  /**
   * A bed-level write: one transaction that first locks the admission row (design §4.1, `FOR NO KEY UPDATE`), so two
   * writers on one bed queue. `missing` when the admission does not exist, with nothing written.
   */
  const bedWrite = <T, M>(admissionId: number, missing: M, write: (t: Db) => Promise<T>) =>
    db.transaction(async (t): Promise<T | M> => {
      const [a] = await t.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId)).for('no key update')
      if (!a) return missing
      return write(t)
    })
  /** The same keyed by a referral: resolves and locks its bed in one statement (`FOR NO KEY UPDATE OF admission`). */
  const referralWrite = <T>(referralId: number, write: (t: Db) => Promise<T>) =>
    db.transaction(async (t): Promise<T | { ok: false; error: 'not_found' }> => {
      const [a] = await t
        .select({ id: bed.id })
        .from(referral)
        .innerJoin(bed, eq(bed.id, referral.admission_id))
        .where(eq(referral.id, referralId))
        .for('no key update', { of: bed })
      if (!a) return { ok: false, error: 'not_found' }
      return write(t)
    })

  return {
    setCare: (admissionId, kind, value, staffId = null, opts = {}) =>
      bedWrite(admissionId, undefined, async (t): Promise<CareResult | 'forbidden'> => {
        const json = careJson(kind, value)
        const cur = await activeCare(t, admissionId, kind)
        if (opts.keepTargets && kind === 'diet') {
          const have = cur ? careValue('diet', JSON.stringify(cur.value)) : { kcal: null, protein_g: null }
          const keep = opts.keepTargets
          if (keep.kcal !== have.kcal || keep.protein_g !== have.protein_g) return 'forbidden'
        }
        // Compared as this build normalises them, so a row stored with other key order or extra keys still matches.
        if (cur && careJson(kind, careValue(kind, JSON.stringify(cur.value))) === json)
          return { order: toCareOrders([cur])[0]!, created: false }
        // The same instant ends one and starts the other: an entry charted then is judged by the new order.
        const ts = at(now())
        if (cur) await t.update(care_order).set({ end_at: ts, ended_by: staffId }).where(eq(care_order.id, cur.id))
        const [row] = await t
          .insert(care_order)
          .values({ admission_id: admissionId, kind, value: JSON.parse(json) as unknown, start_at: ts, set_by: staffId, created_at: ts })
          .returning({ id: care_order.id })
        return { order: await careOrder(t, row!.id), created: true }
      }),
    endCare: (admissionId, kind, staffId = null, opts = {}) =>
      bedWrite(admissionId, undefined, async (t): Promise<CareOrder | 'forbidden' | undefined> => {
        const cur = await activeCare(t, admissionId, kind)
        if (!cur) return undefined
        if (opts.keepTargets && kind === 'diet') {
          const v = careValue('diet', JSON.stringify(cur.value))
          if (v.kcal !== null || v.protein_g !== null) return 'forbidden'
        }
        await t
          .update(care_order)
          .set({ end_at: at(now()), ended_by: staffId })
          .where(and(eq(care_order.id, cur.id), isNull(care_order.end_at)))
        return careOrder(t, cur.id)
      }),
    careOrders: async (admissionId, since) =>
      toCareOrders(
        await careRows(db)
          .where(and(eq(care_order.admission_id, admissionId), or(isNull(care_order.end_at), gt(care_order.end_at, at(since)))))
          .orderBy(asc(care_order.start_at), asc(care_order.id)),
      ),
    careOrdersByWard: async (wardId, since) =>
      byAdmission(
        toCareOrders(
          await careRowsByWard(db)
            .where(and(wardIs(wardId), or(isNull(care_order.end_at), gt(care_order.end_at, at(since)))))
            .orderBy(asc(care_order.start_at), asc(care_order.id)),
        ),
      ),
    careHistory: async (admissionId, limit) =>
      toCareOrders(
        await careRows(db)
          .where(eq(care_order.admission_id, admissionId))
          .orderBy(desc(care_order.start_at), desc(care_order.id))
          .limit(limit),
      ),
    reviewCatheter: (admissionId, staffId = null) =>
      bedWrite(admissionId, { ok: false, error: 'not_found' } as const, async (t): Promise<CareReviewResult> => {
        const order = await activeCare(t, admissionId, 'catheter')
        if (!order) return { ok: false, error: 'not_found' }
        const ms = now()
        const day = at(chartDay(ms).start)
        // Once per catheter and chart day: any order of its chain counts (design.md §7).
        const [active] = toCareOrders([order]) as [CareOrder<'catheter'>]
        const chain = catheterSince(await catheterOrdersOf(t, admissionId), active).map((o) => o.id)
        const [seen] = await t
          .select({ id: care_review.id })
          .from(care_review)
          .where(and(inArray(care_review.order_id, chain), eq(care_review.chart_day, day)))
          .limit(1)
        if (seen) return { ok: false, error: 'already_reviewed' }
        const [row] = await t
          .insert(care_review)
          .values({ order_id: order.id, chart_day: day, at: at(ms), staff_id: staffId })
          .onConflictDoNothing()
          .returning({ id: care_review.id })
        if (!row) return { ok: false, error: 'already_reviewed' }
        const [r] = await reviewRows(t).where(eq(care_review.id, row.id))
        return { ok: true, review: toReview(r!) }
      }),
    lastReview: async (orderId) => {
      const [r] = await reviewRows(db).where(eq(care_review.order_id, orderId)).orderBy(desc(care_review.at), desc(care_review.id)).limit(1)
      return r ? toReview(r) : null
    },
    lastReviewOf: async (orderIds) => {
      if (!orderIds.length) return null
      const [r] = await reviewRows(db)
        .where(inArray(care_review.order_id, [...orderIds]))
        .orderBy(desc(care_review.at), desc(care_review.id))
        .limit(1)
      return r ? toReview(r) : null
    },
    catheterOrders: (admissionId) => catheterOrdersOf(db, admissionId),
    catheterOrdersByWard: async (wardId) =>
      byAdmission(
        toCareOrders(
          await careRowsByWard(db)
            .where(and(wardIs(wardId), eq(care_order.kind, 'catheter')))
            .orderBy(asc(care_order.start_at), asc(care_order.id)),
        ),
      ),

    refer: (admissionId, { reason, note }, staffId) =>
      bedWrite(admissionId, { ok: false, error: 'not_found' } as const, async (t): Promise<ReferResult> => {
        if (await inProgress(t, admissionId)) return { ok: false, error: 'referral_open' }
        const [row] = await t
          .insert(referral)
          .values({ admission_id: admissionId, reason, note, created_at: at(now()), created_by: staffId })
          .returning({ id: referral.id })
        return { ok: true, referral: (await referralOf(t, row!.id))! }
      }),
    acknowledgeReferral: (referralId, staffId) =>
      referralWrite(referralId, async (t): Promise<AcknowledgeResult> => {
        // Guarded: a step only fills columns still NULL.
        const done = await t
          .update(referral)
          .set({ acknowledged_at: at(now()), acknowledged_by: staffId })
          .where(and(eq(referral.id, referralId), isNull(referral.closed_at), isNull(referral.acknowledged_at)))
          .returning({ id: referral.id })
        if (!done.length) return { ok: false, error: 'not_open' }
        return { ok: true, referral: (await referralOf(t, referralId))! }
      }),
    closeReferral: (referralId, { outcome, next_review }, staffId) =>
      referralWrite(referralId, async (t): Promise<CloseReferralResult> => {
        const done = await t
          .update(referral)
          .set({ closed_at: at(now()), closed_by: staffId, outcome, next_review })
          .where(and(eq(referral.id, referralId), isNull(referral.closed_at)))
          .returning({ id: referral.id })
        if (!done.length) return { ok: false, error: 'already_closed' }
        return { ok: true, referral: (await referralOf(t, referralId))! }
      }),
    referral: (id) => referralOf(db, id),
    latestReferral: async (admissionId) => {
      const [r] = await referralRows(db).where(and(eq(referral.admission_id, admissionId), latestReferral))
      return r ? toReferral(r) : null
    },
    latestReferralsByWard: async (wardId) => {
      const rows = await referralRows(db)
        .innerJoin(admission, eq(admission.id, referral.admission_id))
        .where(and(wardIs(wardId), latestReferral))
      return new Map(rows.map((r) => [r.admission_id, toReferral(r)] as const))
    },
    referralsInProgress: async (wardIds) => {
      if (!wardIds.length) return []
      const rows = await referralRows(db)
        .innerJoin(admission, eq(admission.id, referral.admission_id))
        .where(and(isNull(referral.closed_at), inArray(admission.ward_id, wardIds)))
        .orderBy(asc(referral.created_at), asc(referral.id))
      return Promise.all(rows.map(async (r) => ({ admission: (await admissionOf(r.admission_id))!, referral: toReferral(r) })))
    },
    coveredWards: () => coveredWardsOf(db),
    assignDietitian: (admissionId, staffId, byStaffId) =>
      bedWrite(admissionId, { ok: false, error: 'not_found' } as const, async (t): Promise<AssignResult> => {
        const cur = await currentAssignment(t, admissionId)
        if (cur?.staff_id === staffId) return { ok: true, assignment: toAssignment(cur), created: false }
        const ts = at(now())
        await t
          .update(admission_dietitian)
          .set({ ended_at: ts, ended_by: byStaffId })
          .where(and(eq(admission_dietitian.admission_id, admissionId), isNull(admission_dietitian.ended_at)))
        const [row] = await t
          .insert(admission_dietitian)
          .values({ admission_id: admissionId, staff_id: staffId, assigned_at: ts, assigned_by: byStaffId })
          .returning({ id: admission_dietitian.id })
        return { ok: true, assignment: await assignmentOf(t, row!.id), created: true }
      }),
    handBack: (admissionId, byStaffId) =>
      db.transaction(async (t): Promise<HandBackResult> => {
        const [a] = await t.select({ ward_id: admission.ward_id }).from(admission).where(eq(admission.id, admissionId)).for('no key update')
        const cur = a && (await currentAssignment(t, admissionId))
        if (!a || !cur) return { ok: false, error: 'not_assigned' }
        if ((await inProgress(t, admissionId)) && !(await coveredWardsOf(t)).has(a.ward_id)) return { ok: false, error: 'no_dietitian' }
        await t
          .update(admission_dietitian)
          .set({ ended_at: at(now()), ended_by: byStaffId })
          .where(and(eq(admission_dietitian.admission_id, admissionId), isNull(admission_dietitian.ended_at)))
        return { ok: true, assignment: await assignmentOf(t, cur.id) }
      }),
    currentAssignments: async (wardId) => {
      const rows = await assignmentRows(db)
        .innerJoin(admission, eq(admission.id, admission_dietitian.admission_id))
        .where(and(wardIs(wardId), isNull(admission_dietitian.ended_at)))
      return new Map(rows.map((r) => [r.admission_id, toAssignment(r)] as const))
    },
    assignmentHistory: async (admissionId, limit) =>
      (
        await assignmentRows(db)
          .where(eq(admission_dietitian.admission_id, admissionId))
          .orderBy(desc(admission_dietitian.assigned_at), desc(admission_dietitian.id))
          .limit(limit)
      ).map(toAssignment),
    activeDiets: async (wardIds) => {
      if (!wardIds.length) return new Map()
      const rows = await careRowsByWard(db).where(
        and(eq(care_order.kind, 'diet'), isNull(care_order.end_at), inArray(admission.ward_id, wardIds)),
      )
      return new Map((toCareOrders(rows) as CareOrder<'diet'>[]).map((o) => [o.admission_id, o] as const))
    },
    dietHistory: async (admissionId, limit) =>
      toCareOrders(
        await careRows(db)
          .where(and(eq(care_order.admission_id, admissionId), eq(care_order.kind, 'diet')))
          .orderBy(desc(care_order.start_at), desc(care_order.id))
          .limit(limit),
      ) as CareOrder<'diet'>[],
    referrals: async (admissionId, limit) =>
      (
        await referralRows(db)
          .where(eq(referral.admission_id, admissionId))
          .orderBy(desc(referral.created_at), desc(referral.id))
          .limit(limit)
      ).map(toReferral),
  } satisfies Partial<Store>
}
