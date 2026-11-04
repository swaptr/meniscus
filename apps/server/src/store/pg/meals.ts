/** Area `meals`: meals, served tray photos, amendments (with their `meal_event` history) and voids. */
import { isDeepStrictEqual } from 'node:util'
import { and, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  joinItems,
  LATE_ENTRY_MINUTES,
  SERVED_TRAY_HOURS,
  type DishValue,
  type Meal,
  type MealEvidence,
  type MealKind,
  type MealProof,
  type MealValues,
  type Portion,
  type StaffRole,
} from '@meniscus/shared'
import type { Db } from '../../db/client.ts'
import { admission, entry, entry_event, meal, meal_event, media, staff } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { ServedTaken, type AmendMealResult, type VoidMealResult } from '../port.ts'
import { at, iso, isoOrNull, staffRef, writeTx, type Ctx, type WriteCtx } from './context.ts'
import { insertEntry } from './entries.ts'
import { gcMedia, linkRead, liveMedia, neverLinked, toMediaRef } from './media.ts'

const DAY_MS = 24 * 3_600_000
const LATE_MS = LATE_ENTRY_MINUTES * 60_000

const MEAL_NAME: Record<MealKind, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
/** The fluid entry's item: "Dinner: soup, roti", within the entry's 200 characters. */
const mealItem = (kind: MealKind, items: string | null | undefined) =>
  (items ? `${MEAL_NAME[kind]}: ${items}` : MEAL_NAME[kind]).slice(0, 200)

/** A proof photo as stored in `meal.proof`: staff ids and epoch ms, resolved on the way out. */
type StoredPhoto = { media_id: number; sha256: string; captured_by: number | null; captured_at: number }
interface StoredProof {
  photo: StoredPhoto
  served: StoredPhoto | null
  confirmed: MealProof['confirmed']
  confirmed_by: number | null
  confirmed_at: number
}
/** One `meal_event` as the history subquery builds it (jsonb: `at` is an ISO timestamp string). */
type StoredAmendment = {
  id: number
  at: string
  staff_id: number | null
  name: string | null
  role: StaffRole | null
  reason: string
  before: MealValues
  after: MealValues
}

type MediaCols = Pick<typeof media.$inferSelect, 'id' | 'kind' | 'mime' | 'size' | 'duration_ms' | 'created_at' | 'sha256' | 'served_meal'>
const mediaCols = <M extends typeof media | typeof md | typeof sm | typeof lm>(m: M) => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  duration_ms: m.duration_ms,
  created_at: m.created_at,
  sha256: m.sha256,
  served_meal: m.served_meal,
})
/** A left-joined media: Drizzle gives null when the join found none (its types say each column may be null). */
const joinedMedia = (m: { [K in keyof MediaCols]: MediaCols[K] | null } | null) =>
  m === null || m.id === null ? null : toMediaRef(m as MediaCols)

/** A unique violation (SQLSTATE 23505) on `constraint`: postgres.js names it `constraint_name`, PGlite `constraint`. */
const uniqueViolation = (err: unknown, constraint: string) => {
  const e = (err instanceof Error && err.cause instanceof Error ? err.cause : err) as {
    code?: unknown
    constraint?: unknown
    constraint_name?: unknown
  }
  return e?.code === '23505' && (e.constraint === constraint || e.constraint_name === constraint)
}

/** `FOR … OF` takes an unqualified name, and Drizzle qualifies a table with its schema: lock through an alias. */
const bedRow = alias(admission, 'bed')
/** Locks the meal's bed (design §4.1) in the statement that finds it; undefined when there is no such meal. */
const lockMealBed = async (t: Db, mealId: number) => {
  const [r] = await t
    .select({ id: bedRow.id })
    .from(meal)
    .innerJoin(bedRow, eq(bedRow.id, meal.admission_id))
    .where(eq(meal.id, mealId))
    .for('no key update', { of: bedRow })
  return r
}

const cb = alias(staff, 'cb')
const vb = alias(staff, 'vb')
const pc = alias(staff, 'pc')
const pb = alias(staff, 'pb')
const ps = alias(staff, 'ps')
const md = alias(media, 'md')
const sm = alias(media, 'sm')
const lm = alias(media, 'lm')
const proofStaff = (path: SQL) => sql`(${meal.proof} #>> ${path})::int`

/**
 * Meals with who recorded and voided them, their fluid entry's status, the tray and served photos, who the proof names,
 * and the amendments, oldest first.
 */
const mealQuery = (db: Db) =>
  db
    .select({
      m: meal,
      cb_name: cb.name,
      cb_role: cb.role,
      vb_name: vb.name,
      vb_role: vb.role,
      entry_status: entry.status,
      md: mediaCols(md),
      sm: mediaCols(sm),
      lm: mediaCols(lm),
      pc_name: pc.name,
      pc_role: pc.role,
      pb_name: pb.name,
      pb_role: pb.role,
      ps_name: ps.name,
      ps_role: ps.role,
      amendments: sql<StoredAmendment[]>`(SELECT coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'at', ev.at,
          'staff_id', ev.staff_id, 'name', s.name, 'role', s.role, 'reason', ev.reason, 'before', ev.before,
          'after', ev.after) ORDER BY ev.at, ev.id), '[]'::jsonb)
        FROM ${meal_event} ev LEFT JOIN ${staff} s ON s.id = ev.staff_id WHERE ev.meal_id = ${meal.id})`,
    })
    .from(meal)
    .leftJoin(cb, eq(cb.id, meal.created_by))
    .leftJoin(vb, eq(vb.id, meal.voided_by))
    .leftJoin(entry, eq(entry.id, meal.entry_id))
    .leftJoin(md, eq(md.id, meal.media_id))
    .leftJoin(sm, eq(sm.id, meal.served_media_id))
    .leftJoin(lm, eq(lm.id, meal.labeled_media_id))
    .leftJoin(pc, eq(pc.id, proofStaff(sql`'{photo,captured_by}'`)))
    .leftJoin(pb, eq(pb.id, proofStaff(sql`'{confirmed_by}'`)))
    .leftJoin(ps, eq(ps.id, proofStaff(sql`'{served,captured_by}'`)))
    .$dynamic()

type MealRow = Awaited<ReturnType<typeof mealQuery>>[number]

const photoOf = (p: StoredPhoto, name: string | null, role: StaffRole | null) => ({
  media_id: p.media_id,
  sha256: p.sha256,
  captured_by: staffRef(p.captured_by, name, role),
  captured_at: iso(new Date(p.captured_at)),
})

const toMeal = (r: MealRow): Meal => {
  const m = r.m
  const p = m.proof as StoredProof | null
  return {
    id: m.id,
    admission_id: m.admission_id,
    meal: m.meal,
    portion: m.portion as Portion,
    items: m.items,
    fluid_ml: m.fluid_ml,
    source: m.source,
    confidence: m.confidence,
    // Validated on the way in; stored as one JSON value, never rewritten.
    evidence: m.evidence as MealEvidence | null,
    created_at: iso(m.created_at),
    recorded_at: iso(m.recorded_at),
    late: m.recorded_at.getTime() - m.created_at.getTime() > LATE_MS,
    created_by: staffRef(m.created_by, r.cb_name, r.cb_role),
    entry_id: m.entry_id,
    entry_status: r.entry_status,
    voided_at: isoOrNull(m.voided_at),
    voided_by: staffRef(m.voided_by, r.vb_name, r.vb_role),
    void_reason: m.void_reason,
    media: joinedMedia(r.md),
    dishes: (m.dishes as DishValue[] | null) ?? [],
    proof: p && {
      photo: photoOf(p.photo, r.pc_name, r.pc_role),
      served: p.served ? photoOf(p.served, r.ps_name, r.ps_role) : null,
      confirmed: p.confirmed,
      confirmed_by: staffRef(p.confirmed_by, r.pb_name, r.pb_role),
      confirmed_at: iso(new Date(p.confirmed_at)),
    },
    served_media: joinedMedia(r.sm),
    labeled_media: joinedMedia(r.lm),
    amendments: r.amendments.map((a) => ({
      id: a.id,
      at: iso(new Date(a.at)),
      by: staffRef(a.staff_id, a.name, a.role),
      reason: a.reason,
      before: a.before,
      after: a.after,
    })),
    amended_at: isoOrNull(m.amended_at),
  }
}

async function mealOf(db: Db, id: number) {
  const [r] = await mealQuery(db).where(eq(meal.id, id))
  return r && toMeal(r)
}

/**
 * Inside the bed's `writeTx`: rejects the meal's pending fluid entry with its `rejected` event, as a review's reject
 * does; its media, once unlinked, go after COMMIT.
 */
async function rejectEntry(w: WriteCtx, t: number, entryId: number, staffId: number | null, note: string) {
  const { db } = w
  const [before] = await db.select({ media_id: entry.media_id }).from(entry).where(eq(entry.id, entryId))
  if (!before) return
  const done = await db
    .update(entry)
    .set({
      status: 'rejected',
      reviewed_at: at(t),
      media_id: null,
      evidence: null,
      approved_ml: null,
      reviewed_by: staffId,
      reject_reason: 'other',
    })
    .where(and(eq(entry.id, entryId), eq(entry.status, 'pending')))
    .returning({ id: entry.id })
  if (!done.length) return
  await gcMedia(w, [before.media_id])
  await db.insert(entry_event).values({ entry_id: entryId, kind: 'rejected', at: at(t), staff_id: staffId, reason: 'other', note })
}

export function mealsArea(ctx: Ctx) {
  const { db, now } = ctx
  return {
    addMeal: (admissionId, m, staffId = null) =>
      db.transaction(async (t) => {
        // The bed lock first (design §4.1): proof, served photo and link check see what the previous holder committed.
        const [bed] = await t.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId)).for('no key update')
        if (!bed) return undefined
        const inner = { db: t, now }
        const tNow = now()
        const charted = m.charted_at ? Date.parse(m.charted_at) : tNow
        const items = m.items?.trim() || null
        // A photo meal with evidence keeps a proof built here from its photo's row and the values saved; the client never sets it.
        const photo = m.evidence && m.media_id !== undefined ? await liveMedia(inner, m.media_id) : undefined
        const served = m.evidence && m.served_media_id !== undefined ? await liveMedia(inner, m.served_media_id) : undefined
        const proofOfRow = (r: { id: number; sha256: string; created_by: number | null; created_at: Date }): StoredPhoto => ({
          media_id: r.id,
          sha256: r.sha256,
          captured_by: r.created_by,
          captured_at: r.created_at.getTime(),
        })
        const proof: StoredProof | null = photo
          ? {
              photo: proofOfRow(photo),
              served: served ? proofOfRow(served) : null,
              confirmed: { portion: m.portion, items, fluid_ml: m.fluid_ml ?? null, dishes: m.dishes ?? [] },
              confirmed_by: staffId,
              confirmed_at: tNow,
            }
          : null
        let entryId: number | null = null
        if (m.fluid_ml) {
          // The pending food entry and its `recorded` event.
          const e = await insertEntry(
            inner,
            admissionId,
            {
              direction: 'in',
              category: 'food',
              volume_ml: m.fluid_ml,
              item: mealItem(m.meal, items),
              notes: null,
              source: m.source,
              // A volume guessed from bowl sizes is never batch-approved.
              confidence: null,
              evidence: null,
            },
            charted,
            tNow,
            staffId,
          )
          entryId = e.id
        }
        let id: number
        try {
          const [row] = await t
            .insert(meal)
            .values({
              admission_id: admissionId,
              meal: m.meal,
              portion: m.portion,
              items,
              fluid_ml: m.fluid_ml ?? null,
              source: m.source,
              confidence: m.confidence ?? null,
              evidence: m.evidence ?? null,
              created_at: at(charted),
              recorded_at: at(tNow),
              created_by: staffId,
              entry_id: entryId,
              // Only the meal links the tray; its fluid entry links none.
              media_id: m.media_id ?? null,
              dishes: m.dishes?.length ? m.dishes : null,
              proof,
              served_media_id: m.served_media_id ?? null,
              labeled_media_id: m.labeled_media_id ?? null,
            })
            .returning({ id: meal.id })
          id = row!.id
        } catch (err) {
          if (m.served_media_id !== undefined && uniqueViolation(err, 'meal_served_media')) throw new ServedTaken()
          throw err
        }
        // The link names the meal, never its fluid entry; a taken read rolls back the meal, its entry and its proof.
        await linkRead(inner, m.read_id, 0, { meal: id })
        return (await mealOf(t, id))!
      }),
    meals: async (admissionId, since = now() - DAY_MS) => {
      const [bed] = await db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId))
      if (!bed) return undefined
      const rows = await mealQuery(db)
        .where(and(eq(meal.admission_id, admissionId), gte(meal.created_at, at(since))))
        .orderBy(desc(meal.created_at), desc(meal.id))
      return rows.map(toMeal)
    },
    mealsByWard: async (wardId, since) => {
      const rows = await mealQuery(db)
        .innerJoin(admission, eq(admission.id, meal.admission_id))
        .where(and(wardId === undefined ? undefined : eq(admission.ward_id, wardId), gte(meal.created_at, at(since))))
        .orderBy(desc(meal.created_at), desc(meal.id))
      const out = new Map<number, Meal[]>()
      for (const m of rows.map(toMeal)) out.set(m.admission_id, [...(out.get(m.admission_id) ?? []), m])
      return out
    },
    servedPhoto: async (admissionId, kind) => {
      // The bed enters only through admissionId, so another bed's photo is never found.
      const [r] = await db
        .select(mediaCols(media))
        .from(media)
        .where(
          and(
            eq(media.admission_id, admissionId),
            eq(media.kind, 'photo'),
            kind === null ? isNotNull(media.served_meal) : eq(media.served_meal, kind),
            gte(media.created_at, at(now() - SERVED_TRAY_HOURS * 3_600_000)),
            neverLinked(),
          ),
        )
        .orderBy(desc(media.created_at), desc(media.id))
        .limit(1)
      return r && toMediaRef(r)
    },
    meal: (id) => mealOf(db, id),
    amendMeal: (mealId, input, staffId = null) =>
      db.transaction(async (t): Promise<AmendMealResult> => {
        if (!(await lockMealBed(t, mealId))) return { ok: false, error: 'not_found' }
        const cur = (await mealOf(t, mealId))!
        if (cur.voided_at !== null) return { ok: false, error: 'voided' }
        if (input.items !== undefined && cur.dishes.length) {
          return { ok: false, error: 'invalid', path: 'items', message: 'a meal with dishes takes its items from them' }
        }
        const before: MealValues = { portion: cur.portion, items: cur.items, dishes: cur.dishes }
        const after: MealValues = {
          portion: input.portion ?? before.portion,
          dishes: input.dishes ?? before.dishes,
          // In list order, as the draft joins them; never sorted by index.
          items: input.dishes ? joinItems(input.dishes) || null : input.items !== undefined ? input.items.trim() || null : before.items,
        }
        if (isDeepStrictEqual(before, after))
          return { ok: false, error: 'invalid', path: 'reason', message: 'the amendment changes nothing' }
        const tNow = at(now())
        await t
          .update(meal)
          .set({ portion: after.portion, items: after.items, dishes: after.dishes.length ? after.dishes : null, amended_at: tNow })
          .where(eq(meal.id, mealId))
        await t
          .insert(meal_event)
          .values({ meal_id: mealId, kind: 'amended', at: tNow, staff_id: staffId, reason: input.reason, before, after })
        return { ok: true, meal: (await mealOf(t, mealId))! }
      }),
    voidMeal: (mealId, reason, staffId = null) =>
      writeTx(ctx, async (w): Promise<VoidMealResult> => {
        const t = w.db
        if (!(await lockMealBed(t, mealId))) return { ok: false, error: 'not_found' }
        const [cur] = await t
          .select({
            media_id: meal.media_id,
            served_media_id: meal.served_media_id,
            labeled_media_id: meal.labeled_media_id,
            entry_id: meal.entry_id,
            entry_status: entry.status,
          })
          .from(meal)
          .leftJoin(entry, eq(entry.id, meal.entry_id))
          .where(eq(meal.id, mealId))
        const tNow = now()
        const done = await t
          .update(meal)
          .set({
            voided_at: at(tNow),
            voided_by: staffId,
            void_reason: reason,
            media_id: null,
            served_media_id: null,
            labeled_media_id: null,
          })
          .where(and(eq(meal.id, mealId), sql`${meal.voided_at} IS NULL`))
          .returning({ id: meal.id })
        if (!done.length) return { ok: false, error: 'already_voided' }
        await gcMedia(w, [cur!.media_id, cur!.served_media_id, cur!.labeled_media_id])
        // A pending fluid entry goes with it, through the normal rejection (history, media rules).
        if (cur!.entry_id !== null && cur!.entry_status === 'pending') await rejectEntry(w, tNow, cur!.entry_id, staffId, reason)
        return { ok: true, meal: (await mealOf(t, mealId))! }
      }),
  } satisfies Partial<Store>
}
