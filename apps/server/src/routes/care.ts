/**
 * Care orders (charting/care-plan): set, change and end an admission's orders, and record a catheter's daily necessity
 * review. Roles per kind from CARE_ORDER_ROLES (nurses and the matron; dietitians for `diet`). Checks, in order: 401
 * (app-level session), 403 (role), 404 (admission or kind), 413, 400 (any object), 403 (diet targets), 400 (value).
 * No model requests, and no log line carries an order value.
 */
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import {
  ACUITY_LEVELS,
  CARE_KINDS,
  CARE_ORDER_ROLES,
  DECIDER_ROLES,
  DIET_TARGET_ROLES,
  CATHETER_MAX_AGE_DAYS,
  CATHETER_TYPES,
  DIET_KCAL_RANGE,
  DIET_PROTEIN_RANGE,
  DIET_TYPES,
  IDDSI_FOOD_LEVELS,
  FLUID_LIMIT_RANGE,
  FLUID_SCOPES,
  IDDSI_DRINK_LEVELS,
  INTAKE_TARGET_RANGE,
  MEASURE_EVERY_H,
  NIL_BY_MOUTH_MAX_HOURS,
  DRAIN_SITES,
  STOMA_TYPES,
  VOIDING_METHODS,
  type CareInput,
  type CareKind,
  type CareOrder,
} from '@meniscus/shared'
import type { KeepTargets, Store } from '../store/port.ts'
import { SKEW_MS, forbidden, id, invalid, notFound, smallJson, type Env } from './common.ts'
import { validate } from './validate.ts'

const HOUR_MS = 3_600_000
const Instant = z.iso.datetime({ offset: true })
const Ml = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max)
const THICKENED = IDDSI_DRINK_LEVELS.flatMap((l) => (l.level === 0 ? [] : [z.literal(l.level)]))
const TEXTURES = IDDSI_FOOD_LEVELS.map((l) => z.literal(l.level))
/** Any integer in range; the form's steps are a UI concern. */
const Target = (range: { min: number; max: number }) => z.number().int().min(range.min).max(range.max).nullable().optional()

/** Each kind's value, strict, from the shared ranges. Time checks take the store's clock. */
const careValues = (now: () => number): { [K in CareKind]: z.ZodType<CareInput<K>> } => ({
  acuity: z.object({ level: z.enum(ACUITY_LEVELS) }).strict(),
  nil_by_mouth: z
    .object({ until: Instant.nullable().optional() })
    .strict()
    .refine((v) => v.until == null || (Date.parse(v.until) > now() && Date.parse(v.until) <= now() + NIL_BY_MOUTH_MAX_HOURS * HOUR_MS), {
      path: ['until'],
      message: `must be after now and at most ${NIL_BY_MOUTH_MAX_HOURS} h ahead`,
    }),
  thickened_fluids: z.object({ level: z.union(THICKENED) }).strict(),
  fluid_limit: z.object({ ml: Ml(FLUID_LIMIT_RANGE), scope: z.enum(FLUID_SCOPES) }).strict(),
  intake_target: z.object({ ml: Ml(INTAKE_TARGET_RANGE) }).strict(),
  catheter: z
    .object({
      type: z.enum(CATHETER_TYPES),
      inserted_at: Instant,
      measure_every_h: z.union([...MEASURE_EVERY_H.map((h) => z.literal(h)), z.null()]).optional(),
    })
    .strict()
    .refine(
      (v) => Date.parse(v.inserted_at) <= now() + SKEW_MS && Date.parse(v.inserted_at) >= now() - CATHETER_MAX_AGE_DAYS * 24 * HOUR_MS,
      { path: ['inserted_at'], message: `must be no later than now and within ${CATHETER_MAX_AGE_DAYS} days` },
    ),
  stoma: z.object({ type: z.enum(STOMA_TYPES) }).strict(),
  drain: z.object({ site: z.enum(DRAIN_SITES) }).strict(),
  voiding: z.object({ method: z.enum(VOIDING_METHODS) }).strict(),
  diet: z
    .object({
      type: z.enum(DIET_TYPES),
      texture: z.union(TEXTURES),
      kcal: Target(DIET_KCAL_RANGE),
      protein_g: Target(DIET_PROTEIN_RANGE),
    })
    .strict(),
})

/** Any JSON object; the kind's own schema, read from the path, runs in the handler. */
const AnyCareBody = z.record(z.string(), z.unknown())

const isCareKind = (k: string): k is CareKind => (CARE_KINDS as readonly string[]).includes(k)

/**
 * 403 unless the role may change the path's kind (CARE_ORDER_ROLES). A decider passes for any kind, so an unknown kind
 * still gets careTarget's 404; any other role passes only for a care kind that lists it. The review route is `catheter`.
 */
const careRole = createMiddleware<Env>(async (c, next) => {
  const role = c.get('staff')?.role
  const kind = c.req.param('kind') ?? 'catheter'
  const allowed = role !== undefined && (DECIDER_ROLES.includes(role) || (isCareKind(kind) && CARE_ORDER_ROLES[kind].includes(role)))
  if (!allowed) return c.json(forbidden, 403)
  await next()
  return undefined
})

/** The raw body's targets, absent = null, for a role outside DIET_TARGET_ROLES on a diet; else undefined (no check). */
const keepTargetsFor = (role: string | undefined, kind: CareKind, body?: Record<string, unknown>): KeepTargets | undefined =>
  kind === 'diet' && !DIET_TARGET_ROLES.some((r) => r === role)
    ? { kcal: body?.kcal ?? null, protein_g: body?.protein_g ?? null }
    : undefined

export function careRoutes(store: Store) {
  const CARE_VALUE = careValues(() => store.now())

  /**
   * Diet targets (charting/care-plan "Diet targets need a dietitian"), before the value schema so a nurse's targets
   * change gets 403 whatever else is wrong. This only orders the answers; the store decides inside its transaction.
   */
  const targetsChanged = async (admissionId: number, keep: KeepTargets | undefined, ending: boolean): Promise<boolean> => {
    if (!keep) return false
    const active = (await store.careOrders(admissionId, store.now())).find(
      (o): o is CareOrder<'diet'> => o.kind === 'diet' && o.end_at === null,
    )
    const have = active?.value ?? { kcal: null, protein_g: null }
    if (ending) return have.kcal !== null || have.protein_g !== null
    return keep.kcal !== have.kcal || keep.protein_g !== have.protein_g
  }

  /** 404 for an unknown admission or a kind outside CARE_KINDS (the review route names `catheter` in its path). */
  const careTarget = createMiddleware<Env>(async (c, next) => {
    const admissionId = id(c.req.param('id') ?? '')
    if (admissionId === undefined || !(await store.admission(admissionId)) || !isCareKind(c.req.param('kind') ?? 'catheter')) {
      return c.json(notFound, 404)
    }
    await next()
    return undefined
  })

  /** A target above the active limit, or a limit below the active target: the message names the other order. */
  const conflict = async (admissionId: number, kind: CareKind, ml: number): Promise<string | null> => {
    const active = (await store.careOrders(admissionId, store.now())).filter((o) => o.end_at === null)
    for (const o of active) {
      if (kind === 'intake_target' && o.kind === 'fluid_limit' && ml > o.value.ml) return `above the active fluid limit of ${o.value.ml} mL`
      if (kind === 'fluid_limit' && o.kind === 'intake_target' && ml < o.value.ml)
        return `below the active intake target of ${o.value.ml} mL`
    }
    return null
  }

  return new Hono<Env>()
    .put('/admissions/:id/care/:kind', careRole, careTarget, smallJson(), validate('json', AnyCareBody), async (c) => {
      const admissionId = id(c.req.param('id'))!
      const kind = c.req.param('kind') as CareKind // checked by careTarget
      const keepTargets = keepTargetsFor(c.get('staff')?.role, kind, c.req.valid('json'))
      if (await targetsChanged(admissionId, keepTargets, false)) return c.json(forbidden, 403)
      const parsed = CARE_VALUE[kind].safeParse(c.req.valid('json'))
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        return c.json({ error: 'invalid_request', issues }, 400)
      }
      const value = parsed.data
      const clash = 'ml' in value ? await conflict(admissionId, kind, value.ml) : null
      if (clash) return invalid(c, 'ml', clash)
      const r = await store.setCare(admissionId, kind, value, c.get('staffId'), keepTargets ? { keepTargets } : {})
      if (!r) return c.json(notFound, 404)
      if (r === 'forbidden') return c.json(forbidden, 403)
      return r.created ? c.json(r.order, 201) : c.json(r.order, 200)
    })
    .delete('/admissions/:id/care/:kind', careRole, careTarget, async (c) => {
      const admissionId = id(c.req.param('id'))!
      const kind = c.req.param('kind') as CareKind
      const keep = keepTargetsFor(c.get('staff')?.role, kind) !== undefined
      if (await targetsChanged(admissionId, keep ? { kcal: null, protein_g: null } : undefined, true)) return c.json(forbidden, 403)
      const order = await store.endCare(admissionId, kind, c.get('staffId'), { keepTargets: keep })
      if (order === 'forbidden') return c.json(forbidden, 403)
      return order ? c.json(order) : c.json(notFound, 404)
    })
    .post('/admissions/:id/care/catheter/review', careRole, careTarget, async (c) => {
      const r = await store.reviewCatheter(id(c.req.param('id'))!, c.get('staffId'))
      if (r.ok) return c.json(r.review, 201)
      return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: 'already_reviewed' }, 409)
    })
}
