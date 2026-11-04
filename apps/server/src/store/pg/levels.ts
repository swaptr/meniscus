/**
 * Area `levels`: jug and bottle levels (a drop charts a pending intake entry) and bag readings (a rise charts an output
 * entry; charting/bag-periods). Every write locks the bed first (design §4.1), so the fall guard, the duplicate check,
 * the neighbour load, `charge` and the read link all see what the previous writer committed.
 *
 * The entry a level or reading charts is written by the entries area's `insertEntry`; the read link is the media area's.
 */
import { and, asc, between, desc, eq, gt, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  BAG_CATEGORY,
  DECIDER_ROLES,
  DUPLICATE_WITHIN_MIN,
  type BagContainer,
  type BagReading,
  type BagReadingResult,
  type Entry,
  type Level,
  type LevelContainer,
  type MediaRef,
  type PhotoEvidence,
  type SourceKind,
} from '@meniscus/shared'
import {
  LATE_READING_MS,
  bagItem,
  bagReadingAfter,
  charge,
  clearsFall,
  duplicateDecision,
  duplicateOf,
  step,
  toBagDuplicate,
  type DuplicatePoint,
  type Point,
  type StoredBagReading,
} from '../../chart/bags.ts'
import type { Db } from '../../db/client.ts'
import { admission, entry, level, media, staff } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { Duplicate, Forbidden, type AfterEmptyingResult } from '../port.ts'
import { at, iso, staffRef, type Ctx } from './context.ts'
import { insertEntry } from './entries.ts'
import { linkRead } from './media.ts'

const DAY_MS = 24 * 3_600_000
const DUPLICATE_MS = DUPLICATE_WITHIN_MIN * 60_000

// ---------- media ----------

const cb = alias(staff, 'cb')
const md = alias(media, 'md')
const pm = alias(media, 'pm')
const lm = alias(media, 'lm')

type MediaTable = typeof md | typeof pm | typeof lm
const mediaCols = (m: MediaTable) => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  duration_ms: m.duration_ms,
  created_at: m.created_at,
  sha256: m.sha256,
  served_meal: m.served_meal,
})
type MediaCols = { [K in keyof ReturnType<typeof mediaCols>]: ReturnType<typeof mediaCols>[K]['_']['data'] | null }
const toMediaRef = (m: MediaCols | null): MediaRef | null =>
  m === null || m.id === null
    ? null
    : {
        id: m.id,
        kind: m.kind as SourceKind,
        mime: m.mime!,
        size: m.size!,
        duration_ms: m.duration_ms,
        created_at: iso(m.created_at!),
        sha256: m.sha256 ?? null,
        served_meal: m.served_meal ?? null,
      }

/** Locks the bed (`FOR NO KEY UPDATE`); false when it does not exist. */
async function lockBed(db: Db, admissionId: number): Promise<boolean> {
  const [a] = await db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId)).for('no key update')
  return a !== undefined
}

// ---------- levels ----------

const levelCols = {
  id: level.id,
  admission_id: level.admission_id,
  container: level.container,
  volume_ml: level.volume_ml,
  created_at: level.created_at,
  md: mediaCols(md),
  lm: mediaCols(lm),
}
const toLevel = (r: {
  id: number
  admission_id: number
  container: string
  volume_ml: number
  created_at: Date
  md: MediaCols | null
  lm: MediaCols | null
}): Level => ({
  id: r.id,
  admission_id: r.admission_id,
  container: r.container as LevelContainer,
  volume_ml: r.volume_ml,
  created_at: iso(r.created_at),
  media: toMediaRef(r.md),
  labeled_media: toMediaRef(r.lm),
})

// ---------- bag readings ----------

/** `FOR … OF` takes an unqualified name, and Drizzle qualifies a schema table's: lock through an alias. */
const bedOf = alias(admission, 'a')
const bagCols = {
  id: level.id,
  admission_id: level.admission_id,
  container: level.container,
  volume_ml: level.volume_ml,
  created_at: level.created_at,
  evidence: level.evidence,
  event: level.event,
  residual_ml: level.residual_ml,
  recorded_at: level.recorded_at,
  created_by: level.created_by,
  source: level.source,
  confirmed_duplicate_of: level.confirmed_duplicate_of,
  cb_name: cb.name,
  cb_role: cb.role,
  md: mediaCols(md),
  lm: mediaCols(lm),
  pm: mediaCols(pm),
  entry_id: entry.id,
  entry_ml: entry.volume_ml,
  entry_status: entry.status,
}
/** Bag readings (levels with an event), with who saved them, their photo and proof photo, and the output entry each charted. */
const bags = (db: Db) =>
  db
    .select(bagCols)
    .from(level)
    .leftJoin(cb, eq(cb.id, level.created_by))
    .leftJoin(md, eq(md.id, level.media_id))
    .leftJoin(lm, eq(lm.id, level.labeled_media_id))
    .leftJoin(pm, eq(pm.id, level.proof_media_id))
    .leftJoin(entry, and(eq(entry.level_id, level.id), eq(entry.direction, 'out')))
type BagRow = Awaited<ReturnType<ReturnType<typeof bags>['where']>>[number]

const toStoredBag = (r: BagRow): StoredBagReading => {
  const created = r.created_at.getTime()
  const recorded = r.recorded_at?.getTime() ?? created
  return {
    id: r.id,
    container: r.container as BagContainer,
    event: r.event!,
    volume_ml: r.volume_ml,
    residual_ml: r.residual_ml,
    source: r.source ?? 'manual',
    media: toMediaRef(r.md),
    labeled_media: toMediaRef(r.lm),
    proof_media: toMediaRef(r.pm),
    evidence: (r.evidence ?? null) as PhotoEvidence | null,
    created_by: staffRef(r.created_by, r.cb_name, r.cb_role),
    created_at: iso(r.created_at),
    recorded_at: iso(new Date(recorded)),
    late: recorded - created > LATE_READING_MS,
    entry: r.entry_id === null ? null : { id: r.entry_id, volume_ml: r.entry_ml!, status: r.entry_status! },
    confirmed_duplicate_of: r.confirmed_duplicate_of,
  }
}
const pointOf = (r: BagRow): Point => ({
  id: r.id,
  event: r.event!,
  volume_ml: r.volume_ml,
  residual_ml: r.residual_ml,
  t: r.created_at.getTime(),
})
const ofBag = (admissionId: number, container: string) =>
  and(eq(level.admission_id, admissionId), eq(level.container, container), isNotNull(level.event))

/** A bag reading charted since `since`, or the newest of its bag before `since` (its predecessor). */
const bagWindow = (since: Date): SQL =>
  and(
    isNotNull(level.event),
    or(
      sql`${level.created_at} >= ${since}`,
      sql`${level.id} = (SELECT m.id FROM ${level} m WHERE m.admission_id = ${level.admission_id} AND m.container = ${level.container}
        AND m.event IS NOT NULL AND m.created_at < ${since} ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`,
    ),
  )!

async function bagRow(db: Db, id: number): Promise<BagRow | undefined> {
  const [r] = await bags(db).where(and(eq(level.id, id), isNotNull(level.event)))
  return r
}
/** The reading as returned: its step from the reading just before it in (charted time, id) order. */
async function bagReadingOf(db: Db, r: BagRow): Promise<BagReading> {
  const [prev] = await bags(db)
    .where(
      and(
        ofBag(r.admission_id, r.container),
        or(lt(level.created_at, r.created_at), and(eq(level.created_at, r.created_at), lt(level.id, r.id))),
      ),
    )
    .orderBy(desc(level.created_at), desc(level.id))
    .limit(1)
  return bagReadingAfter(prev && toStoredBag(prev), toStoredBag(r))
}

export function levelsArea({ db, now }: Ctx) {
  const mayClearFall = async (t: Db, staffId: number | null) => {
    if (staffId === null) return false
    const [s] = await t.select({ role: staff.role }).from(staff).where(eq(staff.id, staffId))
    return s !== undefined && DECIDER_ROLES.includes(s.role)
  }

  return {
    addLevel: (admissionId, input, staffId = null) =>
      db.transaction(async (tx) => {
        if (!(await lockBed(tx, admissionId))) return undefined
        const t = now()
        const [prev] = await tx
          .select({ id: level.id, volume_ml: level.volume_ml })
          .from(level)
          .where(
            and(
              eq(level.admission_id, admissionId),
              eq(level.container, input.container),
              sql`${level.created_at} >= ${at(t - DAY_MS)}`,
              isNull(level.event),
            ),
          )
          .orderBy(desc(level.created_at), desc(level.id))
          .limit(1)
        const [row] = await tx
          .insert(level)
          .values({
            admission_id: admissionId,
            container: input.container,
            volume_ml: input.volume_ml,
            created_at: at(t),
            evidence: input.evidence ?? null,
            media_id: input.media_id ?? null,
            labeled_media_id: input.labeled_media_id ?? null,
          })
          .returning({ id: level.id })
        const id = row!.id
        const [l] = await tx
          .select(levelCols)
          .from(level)
          .leftJoin(md, eq(md.id, level.media_id))
          .leftJoin(lm, eq(lm.id, level.labeled_media_id))
          .where(eq(level.id, id))
        // The level, never its drop entry.
        await linkRead({ db: tx, now }, input.read_id, 0, { level: id })
        let charted: Entry | null = null
        if (prev && input.volume_ml < prev.volume_ml) {
          charted = await insertEntry(
            { db: tx, now },
            admissionId,
            {
              direction: 'in',
              category: 'water',
              volume_ml: prev.volume_ml - input.volume_ml,
              item: `${input.container.replace('_', ' ')}: ${prev.volume_ml} → ${input.volume_ml} mL`,
              // A jug or bottle holds water (LEVEL_CONTAINERS), so its drop is a water drink.
              drink: 'water',
              source: input.source,
              confidence: input.confidence ?? null,
              evidence: input.evidence ?? null,
              // The after level's photo; the level keeps it too, so rejecting the entry leaves it with the level.
              ...(input.media_id !== undefined && { media_id: input.media_id }),
              ...(input.labeled_media_id !== undefined && { labeled_media_id: input.labeled_media_id }),
              level_id: id,
              prev_level_id: prev.id,
            },
            t,
            t,
            staffId,
          )
        }
        return { level: toLevel(l!), previous_ml: prev?.volume_ml ?? null, entry: charted }
      }),

    levels: async (admissionId) => {
      const [a] = await db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId))
      if (!a) return undefined
      const rows = await db
        .select(levelCols)
        .from(level)
        .leftJoin(md, eq(md.id, level.media_id))
        .leftJoin(lm, eq(lm.id, level.labeled_media_id))
        .where(
          and(
            eq(level.admission_id, admissionId),
            isNull(level.event),
            sql`${level.id} = (SELECT m.id FROM ${level} m WHERE m.admission_id = ${level.admission_id}
              AND m.container = ${level.container} AND m.event IS NULL ORDER BY m.created_at DESC, m.id DESC LIMIT 1)`,
          ),
        )
        .orderBy(asc(level.container))
      return rows.map(toLevel)
    },

    addBagReading: (admissionId, input, staffId = null) =>
      db.transaction(async (tx): Promise<BagReadingResult | undefined> => {
        if (!(await lockBed(tx, admissionId))) return undefined
        const t = now()
        const charted = input.charted_at ? Date.parse(input.charted_at) : t
        const [p] = await bags(tx)
          .where(and(ofBag(admissionId, input.container), lte(level.created_at, at(charted))))
          .orderBy(desc(level.created_at), desc(level.id))
          .limit(1)
        const [n] = await bags(tx)
          .where(and(ofBag(admissionId, input.container), gt(level.created_at, at(charted))))
          .orderBy(asc(level.created_at), asc(level.id))
          .limit(1)
        // Sorts after every stored reading charted at the same time, as its id will.
        const r: Point = { id: Number.MAX_SAFE_INTEGER, event: input.event, volume_ml: input.volume_ml, residual_ml: null, t: charted }
        const before = p && pointOf(p)
        const next = n && pointOf(n)
        if (clearsFall(before, r, next) && !(await mayClearFall(tx, staffId))) throw new Forbidden()
        const near = await tx
          .select({ id: level.id, container: level.container, event: level.event, volume_ml: level.volume_ml, t: level.created_at })
          .from(level)
          .where(
            and(ofBag(admissionId, input.container), between(level.created_at, at(charted - DUPLICATE_MS), at(charted + DUPLICATE_MS))),
          )
        const points = near.map((x): DuplicatePoint => ({
          id: x.id,
          container: x.container as BagContainer,
          event: x.event!,
          volume_ml: x.volume_ml,
          t: x.t.getTime(),
        }))
        const decision = duplicateDecision(duplicateOf(points, { ...r, container: input.container }), input.confirm_duplicate_of)
        if (!decision.save) throw new Duplicate(toBagDuplicate(decision.match))
        const delta = charge(before, r, next)
        const photo = input.source === 'photo'
        const [row] = await tx
          .insert(level)
          .values({
            admission_id: admissionId,
            container: input.container,
            volume_ml: input.volume_ml,
            created_at: at(charted),
            evidence: photo ? (input.evidence ?? null) : null,
            media_id: photo ? (input.media_id ?? null) : null,
            labeled_media_id: photo ? (input.labeled_media_id ?? null) : null,
            event: input.event,
            recorded_at: at(t),
            created_by: staffId,
            source: input.source,
            confirmed_duplicate_of: decision.confirmed,
          })
          .returning({ id: level.id })
        const id = row!.id
        // The reading, never the entry it charts, so a rise of 0 still links.
        await linkRead({ db: tx, now }, input.read_id, 0, { level: id })
        let out: Entry | null = null
        if (delta > 0) {
          const urine = input.container === 'urine_bag'
          out = await insertEntry(
            { db: tx, now },
            admissionId,
            {
              direction: 'out',
              category: BAG_CATEGORY[input.container],
              volume_ml: delta,
              item: bagItem(input.container, step(before, r), input.volume_ml),
              notes: input.notes ?? null,
              source: input.source,
              confidence: photo ? (input.confidence ?? null) : null,
              evidence: photo ? (input.evidence ?? null) : null,
              ...(urine && { urine_colour: input.urine_colour ?? null, urine_rgb: input.urine_rgb ?? null }),
              // The reading's photo; the reading keeps it too, so rejecting the entry leaves it with the reading.
              ...(photo && input.media_id !== undefined && { media_id: input.media_id }),
              ...(photo && input.labeled_media_id !== undefined && { labeled_media_id: input.labeled_media_id }),
              level_id: id,
              ...(p && { prev_level_id: p.id }),
            },
            charted,
            t,
            staffId,
          )
        }
        return { reading: bagReadingAfter(p && toStoredBag(p), toStoredBag((await bagRow(tx, id))!)), entry: out }
      }),

    bagReading: async (id) => {
      const r = await bagRow(db, id)
      return r && { admission_id: r.admission_id, reading: await bagReadingOf(db, r) }
    },

    afterEmptying: (readingId, input) =>
      db.transaction(async (tx): Promise<AfterEmptyingResult> => {
        // Keyed by the reading: resolve its bed and lock it in one statement (design §4.1).
        const [bed] = await tx
          .select({ id: bedOf.id })
          .from(level)
          .innerJoin(bedOf, eq(bedOf.id, level.admission_id))
          .where(and(eq(level.id, readingId), isNotNull(level.event)))
          .for('no key update', { of: bedOf })
        if (!bed) return { ok: false, error: 'not_found' }
        const r = (await bagRow(tx, readingId))!
        const [later] = await tx
          .select({ id: level.id })
          .from(level)
          .where(
            and(
              ofBag(r.admission_id, r.container),
              or(gt(level.created_at, r.created_at), and(eq(level.created_at, r.created_at), gt(level.id, r.id))),
            ),
          )
          .limit(1)
        if (later) return { ok: false, error: 'closed' }
        const done = await tx
          .update(level)
          .set({ proof_media_id: input.media_id ?? null, residual_ml: input.residual_ml ?? null })
          .where(and(eq(level.id, readingId), isNull(level.proof_media_id), isNull(level.residual_ml)))
          .returning({ id: level.id })
        if (!done.length) return { ok: false, error: 'closed' }
        return { ok: true, reading: await bagReadingOf(tx, (await bagRow(tx, readingId))!) }
      }),

    bagReadings: async (admissionId, since) => {
      const rows = await bags(db)
        .where(and(eq(level.admission_id, admissionId), bagWindow(at(since))))
        .orderBy(asc(level.created_at), asc(level.id))
      return rows.map(toStoredBag)
    },

    bagReadingsByWard: async (wardId, since) => {
      const rows = await bags(db)
        .innerJoin(admission, eq(admission.id, level.admission_id))
        .where(and(wardId === undefined ? undefined : eq(admission.ward_id, wardId), bagWindow(at(since))))
        .orderBy(asc(level.created_at), asc(level.id))
      const out = new Map<number, StoredBagReading[]>()
      for (const r of rows) out.set(r.admission_id, [...(out.get(r.admission_id) ?? []), toStoredBag(r)])
      return out
    },
  } satisfies Partial<Store>
}
