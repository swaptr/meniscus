/**
 * Dietitian referrals, assignments, the patient nutrition read and the worklist (charting/nutrition). HTTP only: validation and error → status mapping; the rules
 * live in chart/nutrition.ts. Checks, in order: 401 (app-level session), 403 (role), 404, 413, 400, 409. No model
 * requests, and no log line carries a note, reason or outcome. The ward check of assigning (403) comes after the 404, as
 * in "Name the nurse in charge", since it needs the admission.
 */
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import {
  DECIDER_ROLES,
  DIETITIAN_ROLES,
  NUTRITION_HISTORY_LIMIT,
  REFERRAL_NOTE_MAX,
  REFERRAL_OUTCOMES,
  REFERRAL_REASONS,
  REFERRAL_REVIEW_MAX_DAYS,
  REFERRER_ROLES,
  type CareOrder,
  type NutritionView,
} from '@meniscus/shared'
import { foodChart, mayAssignDietitian, nutritionStatus } from '../chart/nutrition.ts'
import { worklistView } from '../chart/view.ts'
import type { Store } from '../store/port.ts'
import { forbidden, id, invalid, notFound, requireRole, signInRequired, smallJson, type Env } from './common.ts'
import { validate } from './validate.ts'

// zod issues carry paths and messages, never the values, so a note never reaches a log or an error body.
const ReferralBody = z
  .object({
    reason: z.enum(REFERRAL_REASONS),
    note: z.string().trim().min(1).max(REFERRAL_NOTE_MAX).nullable().optional(),
  })
  .strict()

const AssignBody = z.object({ staff_id: z.number().int() }).strict()

const pad = (n: number) => String(n).padStart(2, '0')
/** The local calendar date `days` after `t`'s, as YYYY-MM-DD (DST-safe: local-time constructor). */
const localDate = (t: number, days = 0) => {
  const d = new Date(t)
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

/** `next_review`: a local date from today to REFERRAL_REVIEW_MAX_DAYS on, compared as calendar dates. */
const closeBody = (now: () => number) =>
  z
    .object({
      outcome: z.enum(REFERRAL_OUTCOMES),
      next_review: z.iso
        .date()
        .refine((d) => d >= localDate(now()) && d <= localDate(now(), REFERRAL_REVIEW_MAX_DAYS), {
          message: `must be from today to ${REFERRAL_REVIEW_MAX_DAYS} days on`,
        })
        .nullable()
        .optional(),
    })
    .strict()

export function nutritionRoutes(store: Store) {
  /** 404 for an unknown referral, before the body is read. */
  const referralFound = createMiddleware<Env>(async (c, next) => {
    const referralId = id(c.req.param('id') ?? '')
    if (referralId === undefined || !(await store.referral(referralId))) return c.json(notFound, 404)
    await next()
    return undefined
  })
  /** 404 for an unknown admission, before the body is read. */
  const admissionFound = createMiddleware<Env>(async (c, next) => {
    const admissionId = id(c.req.param('id') ?? '')
    if (admissionId === undefined || !(await store.admission(admissionId))) return c.json(notFound, 404)
    await next()
    return undefined
  })
  const dietitian = requireRole(DIETITIAN_ROLES)
  /** 403 unless a decider on the bed's ward, or any dietitian; after admissionFound. */
  const mayAssign = createMiddleware<Env>(async (c, next) => {
    const admission = (await store.admission(id(c.req.param('id') ?? '')!))!
    if (!mayAssignDietitian(c.get('staff')!, admission.ward_id)) return c.json(forbidden, 403)
    await next()
    return undefined
  })
  const assigner = requireRole([...DECIDER_ROLES, ...DIETITIAN_ROLES])
  /** The admission's nutrition status as the chart reads give it. */
  const statusOf = async (admissionId: number, wardId: number) =>
    nutritionStatus(
      wardId,
      await store.coveredWards(),
      await store.latestReferral(admissionId),
      (await store.currentAssignments(wardId)).get(admissionId) ?? null,
    )

  return new Hono<Env>()
    .post(
      '/admissions/:id/referrals',
      requireRole(REFERRER_ROLES),
      admissionFound,
      smallJson(),
      validate('json', ReferralBody),
      async (c) => {
        const admission = (await store.admission(id(c.req.param('id'))!))!
        const { reason, note } = c.req.valid('json')
        if (!(await statusOf(admission.id, admission.ward_id)).dietitian_available) return c.json({ error: 'no_dietitian' }, 409)
        const r = await store.refer(admission.id, { reason, note: note ?? null }, c.get('staffId'))
        if (!r.ok) return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: r.error }, 409)
        return c.json(r.referral, 201)
      },
    )
    .put('/admissions/:id/dietitian', assigner, admissionFound, mayAssign, smallJson(), validate('json', AssignBody), async (c) => {
      const { staff_id } = c.req.valid('json')
      const member = await store.member(staff_id)
      if (!member || !DIETITIAN_ROLES.includes(member.role)) return invalid(c, 'staff_id', 'not a dietitian')
      const r = await store.assignDietitian(id(c.req.param('id'))!, staff_id, c.get('staffId'))
      if (!r.ok) return c.json(notFound, 404)
      return c.json(r.assignment, r.created ? 201 : 200)
    })
    .delete('/admissions/:id/dietitian', assigner, admissionFound, mayAssign, async (c) => {
      const r = await store.handBack(id(c.req.param('id'))!, c.get('staffId'))
      if (!r.ok) return c.json({ error: r.error }, 409)
      return c.json(r.assignment)
    })
    .get('/admissions/:id/nutrition', admissionFound, async (c) => {
      const admission = (await store.admission(id(c.req.param('id'))!))!
      const now = store.now()
      const all = (await store.meals(admission.id, foodChart([], now).since)) ?? []
      const { since, days } = foodChart(all, now)
      const diet_history = await store.dietHistory(admission.id, NUTRITION_HISTORY_LIMIT)
      const view: NutritionView = {
        admission,
        nutrition: await statusOf(admission.id, admission.ward_id),
        referrals: await store.referrals(admission.id, NUTRITION_HISTORY_LIMIT),
        assignments: await store.assignmentHistory(admission.id, NUTRITION_HISTORY_LIMIT),
        diet: diet_history.find((o): o is CareOrder<'diet'> => o.end_at === null) ?? null,
        diet_history,
        since: new Date(since).toISOString(),
        meals: all,
        days,
      }
      return c.json(view)
    })
    .post('/referrals/:id/acknowledge', dietitian, referralFound, async (c) => {
      const r = await store.acknowledgeReferral(id(c.req.param('id'))!, c.get('staffId'))
      if (!r.ok) return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: r.error }, 409)
      return c.json(r.referral)
    })
    .post(
      '/referrals/:id/close',
      dietitian,
      referralFound,
      smallJson(),
      validate(
        'json',
        closeBody(() => store.now()),
      ),
      async (c) => {
        const { outcome, next_review } = c.req.valid('json')
        const r = await store.closeReferral(id(c.req.param('id'))!, { outcome, next_review: next_review ?? null }, c.get('staffId'))
        if (!r.ok) return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: r.error }, 409)
        return c.json(r.referral)
      },
    )
    .get(
      '/nutrition/worklist',
      // GETs pass the app-level session check; this one is for the signed-in dietitian.
      createMiddleware<Env>(async (c, next) => {
        if (!c.get('staff')) return c.json(signInRequired, 401)
        await next()
        return undefined
      }),
      dietitian,
      async (c) => {
        return c.json(await worklistView(store, c.get('staff')!))
      },
    )
}
