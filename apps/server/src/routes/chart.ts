import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { createMiddleware } from 'hono/factory'
import { z } from 'zod'
import {
  ALERT_TONE,
  worstTone,
  type AlertTone,
  CARE_HISTORY_LIMIT,
  CATEGORY_DIRECTION,
  DISH_KINDS,
  DRINK_KINDS,
  ENTRY_CATEGORIES,
  ENTRY_DIRECTIONS,
  ENTRY_SOURCES,
  HEX_COLOUR,
  IDDSI_DRINK_LEVELS,
  LEVEL_CONTAINERS,
  MAX_ENTRY_ML,
  MAX_TRAY_REGIONS,
  MAX_MEAL_ITEMS,
  MEAL_KINDS,
  MEAL_SOURCES,
  PORTIONS,
  QUALITY_DAYS,
  REJECT_REASONS,
  REVIEW_ACTIONS,
  URINE_COLOURS,
  type AdmissionSummary,
  type HospitalSummary,
  type Staff,
} from '@meniscus/shared'
import { verifyCredentials } from '../auth.ts'
import { chartView, wardReads } from '../chart/view.ts'
import { wardQuality } from '../chart/quality.ts'
import { mayAssignBeds, mayNameInCharge, mayTakeCharge, teamView } from '../chart/staffing.ts'
import { HOSPITAL_NAME } from '../store/demo-hospital.ts'
import { ReadLinkTaken, ServedTaken, type PhotoResult, type Store } from '../store/port.ts'
import { serveBytes, storeBytes, type MediaIo } from './media-io.ts'
import {
  alreadyLinked,
  chartedError,
  forbidden,
  id,
  invalid,
  invalidCredentials,
  labeledCopyError,
  mediaKindOf,
  notFound,
  photoLinkError,
  readLinkError,
  requireDecider,
  signInRequired,
  smallJson,
  type Env,
} from './common.ts'
import { MEAL_BOUNDS } from '../ai/meal.ts'
import { Evidence, MealEvidenceSchema, PhotoEvidence, evidenceMatchesSource } from './evidence.ts'
import { ImageFile, MAX_IMAGE, sniff, validate } from './validate.ts'

const Volume = z.number().int().min(1).max(MAX_ENTRY_ML)
const Text = z.string().trim().max(200).nullable().optional()
/** IDDSI drink level, 0 (thin) to 4 (extremely thick). */
const IddsiLevel = z.union(IDDSI_DRINK_LEVELS.map((l) => z.literal(l.level)))
/** An upload of the same admission (POST /api/admissions/:id/media); checked against the store in the handler. */
const MediaId = z.number().int().positive().optional()
/** The read a record was drafted from (charting/model-accuracy); checked against the store in the handler. */
const ReadId = z.number().int().positive().optional()
const takesMedia = (r: { source: string; media_id?: number | undefined }) => r.media_id === undefined || mediaKindOf(r.source) !== null

const EntryBody = z
  .object({
    direction: z.enum(ENTRY_DIRECTIONS),
    category: z.enum(ENTRY_CATEGORIES),
    volume_ml: Volume,
    item: Text,
    notes: Text,
    source: z.enum(ENTRY_SOURCES),
    confidence: z.number().min(0).max(1).nullable().optional(),
    evidence: Evidence.nullable().optional(),
    /** When it happened, if earlier than now; the range is checked against the admission. */
    charted_at: z.iso.datetime({ offset: true }).optional(),
    urine_colour: z.enum(URINE_COLOURS).nullable().optional(),
    urine_rgb: z.string().regex(HEX_COLOUR).nullable().optional(),
    media_id: MediaId,
    /** The labeled copy of `media_id`; checked against the store in the handler. */
    labeled_media_id: MediaId,
    iddsi_level: IddsiLevel.nullable().optional(),
    drink: z.enum(DRINK_KINDS).nullable().optional(),
    read_id: ReadId,
    read_draft: z.number().int().min(0).max(49).optional(),
  })
  .strict()
  .refine((e) => e.read_draft === undefined || e.read_id !== undefined, { path: ['read_draft'], message: 'read_draft needs read_id' })
  .refine(takesMedia, { path: ['media_id'], message: 'text and manual entries take no media' })
  .refine((e) => CATEGORY_DIRECTION[e.category] === e.direction, {
    path: ['category'],
    message: 'category does not belong to direction',
  })
  .refine((e) => e.category === 'urine' || (!e.urine_colour && !e.urine_rgb), {
    path: ['urine_colour'],
    message: 'urine colour is for urine entries',
  })
  .refine((e) => !e.urine_rgb || Boolean(e.urine_colour), { path: ['urine_rgb'], message: 'urine_rgb needs urine_colour' })
  .refine((e) => e.category === 'water' || e.iddsi_level == null, { path: ['iddsi_level'], message: 'a consistency is for drinks only' })
  .refine((e) => e.category === 'water' || e.category === 'food' || e.drink == null, {
    path: ['drink'],
    message: 'a drink kind is for drinks and food only',
  })
  .refine(evidenceMatchesSource, { path: ['evidence'], message: 'evidence kind does not match source' })

const ReviewBody = z
  .object({
    action: z.enum(REVIEW_ACTIONS),
    volume_ml: Volume.optional(),
    reason: z.enum(REJECT_REASONS).optional(),
    note: Text,
  })
  .strict()
  .refine((r) => r.action === 'approve' || r.volume_ml === undefined, { path: ['volume_ml'], message: 'volume_ml is for approve only' })
  .refine((r) => r.action === 'reject' || (r.reason === undefined && r.note === undefined), {
    path: ['reason'],
    message: 'reason and note are for reject only',
  })

const AmendBody = z
  .object({
    volume_ml: Volume.optional(),
    category: z.enum(ENTRY_CATEGORIES).optional(),
    urine_colour: z.enum(URINE_COLOURS).optional(),
    iddsi_level: IddsiLevel.optional(),
    drink: z.enum(DRINK_KINDS).optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict()

const LevelBody = z
  .object({
    container: z.enum(LEVEL_CONTAINERS),
    volume_ml: z.number().int().min(0).max(MAX_ENTRY_ML),
    source: z.enum(ENTRY_SOURCES),
    confidence: z.number().min(0).max(1).nullable().optional(),
    evidence: PhotoEvidence.nullable().optional(),
    media_id: MediaId,
    labeled_media_id: MediaId,
    read_id: ReadId,
  })
  .strict()
  .refine((l) => l.media_id === undefined || l.source === 'photo', { path: ['media_id'], message: 'only photo levels take media' })
  .refine(evidenceMatchesSource, { path: ['evidence'], message: 'evidence kind does not match source' })

const Dish = z
  .object({
    index: z.number().int().min(0).max(MAX_TRAY_REGIONS),
    name: z.string().trim().min(1).max(MEAL_BOUNDS.name),
    dish_kind: z.enum(DISH_KINDS),
    portion: z.literal(PORTIONS),
  })
  .strict()

const MealBody = z
  .object({
    meal: z.enum(MEAL_KINDS),
    portion: z.literal(PORTIONS),
    items: Text,
    fluid_ml: Volume.nullable().optional(),
    source: z.enum(MEAL_SOURCES),
    confidence: z.number().min(0).max(1).nullable().optional(),
    /** The tray read as returned, bound to its photo by `image_sha256`; the image itself is the meal's media. */
    evidence: MealEvidenceSchema.nullable().optional(),
    charted_at: z.iso.datetime({ offset: true }).optional(),
    /** The tray photo. */
    media_id: MediaId,
    /** The served tray photo its evidence's comparison names. */
    served_media_id: MediaId,
    /** The tray photo's labeled copy (SAM regions drawn in on the device). */
    labeled_media_id: MediaId,
    /** As staff confirmed them. */
    dishes: z.array(Dish).max(MEAL_BOUNDS.items).optional(),
    /** The tray read it was drafted from; checked against the store in the handler. */
    read_id: ReadId,
  })
  .strict()
  .refine((m) => m.source === 'photo' || !m.evidence, { path: ['evidence'], message: 'evidence is for photo meals' })
  .refine((m) => m.source === 'photo' || m.media_id === undefined, { path: ['media_id'], message: 'media is for photo meals' })
  .refine((m) => m.source === 'photo' || m.labeled_media_id === undefined, {
    path: ['labeled_media_id'],
    message: 'a labeled copy is for photo meals',
  })
  .refine((m) => m.source === 'photo' || m.served_media_id === undefined, {
    path: ['served_media_id'],
    message: 'a served photo is for photo meals',
  })

/**
 * A meal post: up to 64 KB, sized for a worst-case compared tray read as evidence with 3-byte names (design:
 * tray-comparison §9). Zod bounds are the real limit; this only stops parsing early.
 */
const mealJson = bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) })

/** `POST /api/meals/:id/amend`: what changes, and why. `fluid_ml` and any other key is refused. */
const AmendMealBody = z
  .object({
    portion: z.literal(PORTIONS).optional(),
    items: z.string().trim().min(1).max(MAX_MEAL_ITEMS).optional(),
    dishes: z.array(Dish).max(MEAL_BOUNDS.items).optional(),
    reason: z.string().trim().min(3).max(200),
  })
  .strict()
  .refine((b) => b.items === undefined || b.dishes === undefined, { path: ['items'], message: 'items come from the dishes' })

const VoidBody = z.object({ reason: z.string().trim().min(3).max(200) }).strict()

const PhotoForm = z.object({ image: ImageFile })

const InChargeBody = z.object({ staff_id: z.number().int().positive() }).strict()
/** Break-the-glass. Neither field is logged; the password is checked, never stored. */
const AccessBody = z.object({ reason: z.string().trim().min(1).max(200), password: z.string().min(1).max(200) }).strict()
/** The ward's capacity is checked in the handler. */
const AssignBody = z
  .object({
    beds: z.array(z.object({ admission_id: z.number().int().positive(), staff_id: z.number().int().positive() }).strict()).max(200),
  })
  .strict()

const DAY_MS = 24 * 3_600_000

/**
 * Wards and their staffing, admissions, bed QR lookup, entries, review, amendments, history and data quality.
 * No model requests. `demoLogin`: demo passwords count at break-the-glass, as at sign-in.
 */
export function chartRoutes(store: Store, { demoLogin, io }: { demoLogin: boolean; io: MediaIo }) {
  /** Each bed with its prompts, care, acuity and nutrition status (no bag periods); the ward's reads in one query each (`wardReads`). */
  const withChart = async (wardId?: number): Promise<AdmissionSummary[]> => {
    const reads = await wardReads(store, wardId)
    const out: AdmissionSummary[] = []
    for (const a of await store.admissions(wardId)) {
      const { alerts, care, devices, acuity, nutrition, bag_levels } = await chartView(store, a, reads)
      out.push({ ...a, alerts, care, devices, acuity, nutrition, bag_levels })
    }
    return out
  }

  /** Null when `media_id` is absent or links; else the 400 to send. Kind follows the record's source. */
  const badMedia = async (c: Context, mediaId: number | undefined, admissionId: number, source: string) => {
    const kind = mediaKindOf(source)
    if (mediaId === undefined || (kind && (await store.linkable(mediaId, admissionId, kind)))) return null
    return invalid(c, 'media_id', `not a ${kind ?? 'kept'} upload of this bed`)
  }

  // Ward staffing routes check, in order: unknown ward 404, then the caller 403, then the body 400.
  const wardFound = createMiddleware<Env>(async (c, next) => {
    const wardId = id(c.req.param('id') ?? '')
    if (wardId === undefined || !(await store.ward(wardId))) return c.json(notFound, 404)
    await next()
    return undefined
  })
  const allowed = (rule: (staff: Staff, wardId: number) => boolean | Promise<boolean>) =>
    createMiddleware<Env>(async (c, next) => {
      const staff = c.get('staff')
      if (!staff || !(await rule(staff, id(c.req.param('id') ?? '')!))) return c.json(forbidden, 403)
      await next()
      return undefined
    })

  return (
    new Hono<Env>()
      .get('/staff', async (c) => c.json(await store.staff()))
      .get('/wards/:id/quality', async (c) => {
        const wardId = id(c.req.param('id'))
        const ward = wardId === undefined ? undefined : await store.ward(wardId)
        if (!ward) return c.json(notFound, 404)
        const since = store.now() - QUALITY_DAYS * DAY_MS
        return c.json(wardQuality(ward, new Date(since).toISOString(), await store.wardEntries(ward.id, since)))
      })
      .get('/wards', async (c) => {
        // Per ward, from the beds' own chart reads: beds with a prompt, the worst open prompt's tone, and the hourly sums.
        const flagged = new Map<number, number>()
        const tones = new Map<number, AlertTone[]>()
        const hourly = new Map<number, { in_ml: number[]; out_ml: number[] }>()
        for (const a of await withChart()) {
          if (a.alerts.length) flagged.set(a.ward_id, (flagged.get(a.ward_id) ?? 0) + 1)
          tones.set(a.ward_id, [...(tones.get(a.ward_id) ?? []), ...a.alerts.map((x) => ALERT_TONE[x.kind])])
          const h = hourly.get(a.ward_id) ?? { in_ml: Array<number>(24).fill(0), out_ml: Array<number>(24).fill(0) }
          a.hourly.in_ml.forEach((v, i) => (h.in_ml[i]! += v))
          a.hourly.out_ml.forEach((v, i) => (h.out_ml[i]! += v))
          hourly.set(a.ward_id, h)
        }
        const body: HospitalSummary = {
          hospital: HOSPITAL_NAME,
          wards: (await store.wards()).map((w) => ({
            ...w,
            beds_with_alerts: flagged.get(w.id) ?? 0,
            worst_tone: worstTone(tones.get(w.id) ?? []),
            hourly: hourly.get(w.id) ?? { in_ml: Array<number>(24).fill(0), out_ml: Array<number>(24).fill(0) },
          })),
        }
        return c.json(body)
      })
      .get('/wards/:id/team', async (c) => {
        const wardId = id(c.req.param('id'))
        const team = wardId === undefined ? undefined : await store.team(wardId)
        return team ? c.json(teamView(team)) : c.json(notFound, 404)
      })
      .put('/wards/:id/in-charge', wardFound, allowed(mayNameInCharge), smallJson(), validate('json', InChargeBody), async (c) => {
        const wardId = id(c.req.param('id'))!
        const { staff_id } = c.req.valid('json')
        const named = await store.member(staff_id)
        if (!named || !mayTakeCharge(named, wardId)) return invalid(c, 'staff_id', "not a nurse on this ward's team")
        const team = await store.setInCharge(wardId, staff_id, c.get('staffId'))
        return team ? c.json(teamView(team)) : c.json(notFound, 404)
      })
      .put(
        '/wards/:id/assignments',
        wardFound,
        allowed(async (staff, wardId) => mayAssignBeds(staff, (await store.team(wardId))!)),
        smallJson(),
        validate('json', AssignBody),
        async (c) => {
          const ward = (await store.ward(id(c.req.param('id'))!))!
          const { beds } = c.req.valid('json')
          if (beds.length > ward.capacity) return invalid(c, 'beds', 'more beds than the ward has')
          const seen = new Set<number>()
          for (const [i, b] of beds.entries()) {
            if ((await store.admission(b.admission_id))?.ward_id !== ward.id)
              return invalid(c, `beds.${i}.admission_id`, 'not a bed of this ward')
            if (seen.has(b.admission_id)) return invalid(c, `beds.${i}.admission_id`, 'bed listed twice')
            seen.add(b.admission_id)
            const nurse = await store.member(b.staff_id)
            if (!nurse || !mayTakeCharge(nurse, ward.id)) return invalid(c, `beds.${i}.staff_id`, "not a nurse on this ward's team")
          }
          const team = await store.assignBeds(ward.id, beds, c.get('staffId'))
          return team ? c.json(teamView(team)) : c.json(notFound, 404)
        },
      )
      // No team check: the web asks only outside the person's wards, and a record for one's own ward is harmless.
      .post('/wards/:id/access', wardFound, smallJson(), validate('json', AccessBody), async (c) => {
        const wardId = id(c.req.param('id'))!
        const staff = c.get('staff')
        if (!staff) return c.json(signInRequired, 401)
        const { reason, password } = c.req.valid('json')
        const ok = await verifyCredentials(store, (await store.username(staff.id)) ?? '', password, { demoLogin })
        if (ok?.id !== staff.id) return c.json(invalidCredentials, 401)
        return c.json(await store.recordAccess(wardId, staff.id, reason), 201)
      })
      .get('/admissions', async (c) => {
        const raw = c.req.query('ward')
        if (raw === undefined) return c.json(await withChart())
        const wardId = id(raw)
        return wardId !== undefined && (await store.ward(wardId)) ? c.json(await withChart(wardId)) : c.json(notFound, 404)
      })
      .get('/beds/:token', async (c) => {
        const a = await store.admissionByToken(c.req.param('token'))
        return a ? c.json(a) : c.json(notFound, 404)
      })
      .get('/admissions/:id/entries', async (c) => {
        const admissionId = id(c.req.param('id'))
        const admission = admissionId === undefined ? undefined : await store.admission(admissionId)
        const list = admission && (await store.entries(admission.id))
        if (!admission || !list) return c.json(notFound, 404)
        // The entry list carries bag periods; bag levels are the bed list's (bag_levels).
        const { bag_levels: _levels, ...chart } = await chartView(store, admission)
        return c.json({
          admission,
          ...list,
          ...chart,
          care_history: await store.careHistory(admission.id, CARE_HISTORY_LIMIT),
        })
      })
      .post('/admissions/:id/entries', smallJson(), validate('json', EntryBody), async (c) => {
        const admissionId = id(c.req.param('id'))
        const admission = admissionId === undefined ? undefined : await store.admission(admissionId)
        if (!admission) return c.json(notFound, 404)
        const body = c.req.valid('json')
        const late = chartedError(admission, body.charted_at, store.now())
        if (late) return invalid(c, 'charted_at', late)
        const media = await badMedia(c, body.media_id, admission.id, body.source)
        if (media) return media
        // The read link first: a retried save answers `already linked`, which the web takes as saved.
        const link = await readLinkError(c, store, admission.id, 'entry', body)
        if (link) return link
        const photoLinks = await photoLinkError(c, store, admission.id, body)
        if (photoLinks) return photoLinks
        try {
          const entry = await store.addEntry(admission.id, body, c.get('staffId'))
          return entry ? c.json(entry, 201) : c.json(notFound, 404)
        } catch (err) {
          if (err instanceof ReadLinkTaken) return alreadyLinked(c)
          throw err
        }
      })
      .post('/entries/:id/review', requireDecider, smallJson(), validate('json', ReviewBody), async (c) => {
        const entryId = id(c.req.param('id'))
        if (entryId === undefined) return c.json(notFound, 404)
        const { action, volume_ml, reason, note } = c.req.valid('json')
        const r = await store.review(entryId, action, { volumeMl: volume_ml, staffId: c.get('staffId'), reason, note })
        if (r.ok) return c.json(r.entry)
        return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: 'not_pending' }, 409)
      })
      .post('/entries/:id/amend', requireDecider, smallJson(), validate('json', AmendBody), async (c) => {
        const entryId = id(c.req.param('id'))
        if (entryId === undefined) return c.json(notFound, 404)
        const r = await store.amend(entryId, c.req.valid('json'), c.get('staffId'))
        if (r.ok) return c.json(r.entry)
        if (r.error === 'not_found') return c.json(notFound, 404)
        if (r.error === 'not_approved') return c.json({ error: 'not_approved' }, 409)
        return invalid(c, r.path, r.message)
      })
      .get('/entries/:id/events', async (c) => {
        const entryId = id(c.req.param('id'))
        const events = entryId === undefined ? undefined : await store.events(entryId)
        return events ? c.json(events) : c.json(notFound, 404)
      })
      .post('/entries/:id/photo', bodyLimit({ maxSize: MAX_IMAGE + 64 * 1024 }), validate('form', PhotoForm), async (c) => {
        const entryId = id(c.req.param('id'))
        if (entryId === undefined) return c.json(notFound, 404)
        const { image } = c.req.valid('form')
        const refusal = (r: PhotoResult) => (r === 'not_found' ? c.json(notFound, 404) : c.json({ error: r }, 409))
        // The chart's checks before any media store request (charting/media "Refused by the chart before the PUT").
        const allowed = await store.photoAllowed(entryId)
        if (allowed !== 'ok') return refusal(allowed)
        const bytes = new Uint8Array(await image.arrayBuffer())
        // The stored type is the sniffed one, never the client's (ImageFile has already matched it to the bytes).
        const mime = sniff('photo', bytes)!
        const r = await storeBytes(
          io,
          bytes,
          mime,
          (sha256, size, t) => t.attachPhoto(entryId, mime, sha256, size),
          (x) => x === 'ok',
        )
        return r === 'ok' ? c.json({ ok: true }, 201) : refusal(r)
      })
      .get('/entries/:id/photo', async (c) => {
        const entryId = id(c.req.param('id'))
        const p = entryId === undefined ? undefined : await store.photo(entryId)
        if (!p) return c.json(notFound, 404)
        return serveBytes(io, p)
      })
      .post('/admissions/:id/levels', smallJson(), validate('json', LevelBody), async (c) => {
        const admissionId = id(c.req.param('id'))
        if (admissionId === undefined || !(await store.admission(admissionId))) return c.json(notFound, 404)
        const body = c.req.valid('json')
        const media = await badMedia(c, body.media_id, admissionId, body.source)
        if (media) return media
        // The read link first: a retried save answers `already linked`, which the web takes as saved.
        const link = await readLinkError(c, store, admissionId, 'level', body)
        if (link) return link
        const photoLinks = await photoLinkError(c, store, admissionId, body)
        if (photoLinks) return photoLinks
        try {
          const r = await store.addLevel(admissionId, body, c.get('staffId'))
          return r ? c.json(r, 201) : c.json(notFound, 404)
        } catch (err) {
          if (err instanceof ReadLinkTaken) return alreadyLinked(c)
          throw err
        }
      })
      .post('/admissions/:id/meals', mealJson, validate('json', MealBody), async (c) => {
        const admissionId = id(c.req.param('id'))
        const admission = admissionId === undefined ? undefined : await store.admission(admissionId)
        if (!admission) return c.json(notFound, 404)
        const body = c.req.valid('json')
        const late = chartedError(admission, body.charted_at, store.now())
        if (late) return invalid(c, 'charted_at', late)
        const media = await badMedia(c, body.media_id, admission.id, body.source)
        if (media) return media
        // Evidence is bound to its photo: the read's hash must be the stored photo's (0 model requests).
        const photo = body.media_id === undefined ? undefined : await store.mediaRef(body.media_id)
        if (body.evidence) {
          if (!photo) return invalid(c, 'evidence.image_sha256', 'evidence needs its tray photo as media_id')
          if (photo.sha256 !== body.evidence.image_sha256) {
            return invalid(c, 'evidence.image_sha256', 'evidence was read from another photo')
          }
        }
        // A served photo is never the tray photo.
        if (photo?.served_meal) return invalid(c, 'media_id', 'a served tray photo is not the tray photo')
        // The served photo comes exactly with a comparison, and is bound to it by id and fingerprint.
        const comparison = body.evidence?.comparison ?? null
        if ((body.served_media_id !== undefined) !== (comparison !== null)) {
          return invalid(c, 'served_media_id', 'a served photo comes exactly with its comparison')
        }
        if (body.served_media_id !== undefined && comparison) {
          const served = await store.mediaRef(body.served_media_id)
          if (
            !served ||
            served.kind !== 'photo' ||
            !(await store.linkable(served.id, admission.id, 'photo')) ||
            served.served_meal !== body.meal
          ) {
            return invalid(c, 'served_media_id', `not a served ${body.meal} photo of this bed`)
          }
          if (served.id === body.media_id) return invalid(c, 'served_media_id', 'the served photo is the tray photo')
          if (served.sha256 === photo?.sha256) return invalid(c, 'served_media_id', 'same photo as the tray')
          if (comparison.served_media_id !== served.id || comparison.served_sha256 !== served.sha256) {
            return invalid(c, 'evidence.comparison', 'the comparison was read from another served photo')
          }
        }
        // The read it was drafted from (charting/model-accuracy "Link a meal to its read"), before the copy: a retry answers `already linked`.
        const link = await readLinkError(c, store, admission.id, 'meal', body)
        if (link) return link
        // Then the tray's labeled copy (charting/meals "Labeled tray copy kept").
        const copy = await labeledCopyError(c, store, admission.id, body)
        if (copy) return copy
        try {
          const meal = await store.addMeal(admission.id, body, c.get('staffId'))
          return meal ? c.json(meal, 201) : c.json(notFound, 404)
        } catch (err) {
          // Another meal links it (the `meal_served_media` index), including a save racing this one.
          if (err instanceof ServedTaken) return invalid(c, 'served_media_id', 'another meal links this served photo')
          if (err instanceof ReadLinkTaken) return alreadyLinked(c)
          throw err
        }
      })
      .get('/admissions/:id/served-tray', async (c) => {
        const admissionId = id(c.req.param('id'))
        if (admissionId === undefined || !(await store.admission(admissionId))) return c.json(notFound, 404)
        return c.json({ media: (await store.servedPhoto(admissionId, null)) ?? null })
      })
      .post('/meals/:id/amend', requireDecider, smallJson(), validate('json', AmendMealBody), async (c) => {
        const mealId = id(c.req.param('id'))
        if (mealId === undefined) return c.json(notFound, 404)
        const r = await store.amendMeal(mealId, c.req.valid('json'), c.get('staffId'))
        if (r.ok) return c.json(r.meal)
        if (r.error === 'invalid') return invalid(c, r.path, r.message)
        return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: 'voided' }, 409)
      })
      .get('/admissions/:id/meals', async (c) => {
        const admissionId = id(c.req.param('id'))
        const meals = admissionId === undefined ? undefined : await store.meals(admissionId)
        return meals ? c.json(meals) : c.json(notFound, 404)
      })
      .post('/meals/:id/void', requireDecider, smallJson(), validate('json', VoidBody), async (c) => {
        const mealId = id(c.req.param('id'))
        if (mealId === undefined) return c.json(notFound, 404)
        const r = await store.voidMeal(mealId, c.req.valid('json').reason, c.get('staffId'))
        if (r.ok) return c.json(r.meal)
        return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: 'already_voided' }, 409)
      })
      .get('/admissions/:id/levels', async (c) => {
        const admissionId = id(c.req.param('id'))
        const r = admissionId === undefined ? undefined : await store.levels(admissionId)
        return r ? c.json(r) : c.json(notFound, 404)
      })
  )
}
