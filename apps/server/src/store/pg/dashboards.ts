/**
 * Area `dashboards`: the bed list with 24 h totals, hourly series and the urine seen; a ward's quality rows; the read
 * outcome rows. Each is one query: the hot dashboard paths make no per-bed or per-read follow-up queries.
 */
import { and, asc, desc, eq, getTableColumns, gte, sql, type SQL, type Table } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  LATE_ENTRY_MINUTES,
  READ_RETAKE_MINUTES,
  type BagEvent,
  type DishValue,
  type DrinkKind,
  type Entry,
  type EntryCategory,
  type EntryEvidence,
  type EntryStatus,
  type HourlySeries,
  type LevelSnapshot,
  type MealValues,
  type MediaRef,
  type Portion,
  type UrineColour,
} from '@meniscus/shared'
import type { StoredRead } from '../../ai/read-log.ts'
import type { OutcomeLink, OutcomeMeal } from '../../chart/model-accuracy.ts'
import { admission, entry, entry_event, level, meal, meal_event, media, model_read, read_link, staff, ward } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { at, bedOrder, iso, isoOrNull, staffRef, type Ctx } from './context.ts'

const DAY_MS = 24 * 3_600_000

/** An aliased table in a raw `FROM` (`${alias}` alone renders only its name). */
const from = (table: Table, name: string) => sql`${table} AS ${sql.identifier(name)}`
const LATE_MS = LATE_ENTRY_MINUTES * 60_000

// ---------- entries with who recorded and reviewed them, their media, and a level drop's levels ----------

const cb = alias(staff, 'cb')
const rb = alias(staff, 'rb')
const md = alias(media, 'md')
const la = alias(level, 'la')
const lb = alias(level, 'lb')
const lam = alias(media, 'lam')
const lbm = alias(media, 'lbm')
const elm = alias(media, 'elm')
const lal = alias(media, 'lal')
const lbl = alias(media, 'lbl')

const mediaCols = (m: typeof md | typeof lam | typeof lbm | typeof elm | typeof lal | typeof lbl) => ({
  id: m.id,
  kind: m.kind,
  mime: m.mime,
  size: m.size,
  duration_ms: m.duration_ms,
  created_at: m.created_at,
  sha256: m.sha256,
  served_meal: m.served_meal,
})
const levelCols = (l: typeof la | typeof lb) => ({
  id: l.id,
  volume_ml: l.volume_ml,
  created_at: l.created_at,
  evidence: l.evidence,
  event: l.event,
  residual_ml: l.residual_ml,
})
type MediaCols = { [K in keyof ReturnType<typeof mediaCols>]: ReturnType<typeof mediaCols>[K]['_']['data'] | null }
type LevelCols = { [K in keyof ReturnType<typeof levelCols>]: ReturnType<typeof levelCols>[K]['_']['data'] | null }

// A left-joined group of all-null columns may arrive as null itself.
const toMediaRef = (m: MediaCols | null): MediaRef | null =>
  m?.id == null
    ? null
    : {
        id: m.id,
        kind: m.kind as MediaRef['kind'],
        mime: m.mime!,
        size: m.size!,
        duration_ms: m.duration_ms,
        created_at: iso(m.created_at!),
        sha256: m.sha256 ?? null,
        served_meal: m.served_meal ?? null,
      }
const toLevel = (l: LevelCols | null, m: MediaCols | null, lab: MediaCols | null): LevelSnapshot | null =>
  l?.id == null
    ? null
    : {
        id: l.id,
        volume_ml: l.volume_ml!,
        created_at: iso(l.created_at!),
        media: toMediaRef(m),
        labeled_media: toMediaRef(lab),
        evidence: (l.evidence ?? null) as LevelSnapshot['evidence'],
        event: l.event ?? null,
        residual_ml: l.residual_ml ?? null,
      }

/** An entry row with everything `toEntry` reads, as nested column groups. */
const entrySelection = {
  e: getTableColumns(entry),
  cb_name: cb.name,
  cb_role: cb.role,
  rb_name: rb.name,
  rb_role: rb.role,
  md: mediaCols(md),
  elm: mediaCols(elm),
  la: levelCols(la),
  lam: mediaCols(lam),
  lal: mediaCols(lal),
  lb: levelCols(lb),
  lbm: mediaCols(lbm),
  lbl: mediaCols(lbl),
}

type EntryRow = {
  e: typeof entry.$inferSelect
  cb_name: string | null
  cb_role: (typeof staff.$inferSelect)['role'] | null
  rb_name: string | null
  rb_role: (typeof staff.$inferSelect)['role'] | null
  md: MediaCols | null
  elm: MediaCols | null
  la: LevelCols | null
  lam: MediaCols | null
  lal: MediaCols | null
  lb: LevelCols | null
  lbm: MediaCols | null
  lbl: MediaCols | null
}

const toEntry = (r: EntryRow): Entry => {
  const e = r.e
  const media = toMediaRef(r.md)
  const after = toLevel(r.la, r.lam, r.lal)
  return {
    id: e.id,
    admission_id: e.admission_id,
    direction: e.direction,
    category: e.category as EntryCategory,
    volume_ml: e.volume_ml,
    item: e.item,
    notes: e.notes,
    source: e.source as Entry['source'],
    confidence: e.confidence,
    status: e.status,
    created_at: iso(e.created_at),
    reviewed_at: isoOrNull(e.reviewed_at),
    has_photo: media?.kind === 'photo',
    recorded_ml: e.recorded_ml,
    // Validated on the way in; stored as one jsonb value.
    evidence: (e.evidence ?? null) as EntryEvidence | null,
    recorded_at: iso(e.recorded_at),
    late: e.recorded_at.getTime() - e.created_at.getTime() > LATE_MS,
    created_by: staffRef(e.created_by, r.cb_name, r.cb_role),
    reviewed_by: staffRef(e.reviewed_by, r.rb_name, r.rb_role),
    approved_ml: e.approved_ml,
    amended_at: isoOrNull(e.amended_at),
    reject_reason: e.reject_reason as Entry['reject_reason'],
    urine_colour: (e.urine_colour ?? null) as UrineColour | null,
    urine_rgb: e.urine_rgb ?? null,
    media,
    labeled_media: toMediaRef(r.elm),
    levels: after ? { before: toLevel(r.lb, r.lbm, r.lbl), after } : null,
    iddsi_level: (e.iddsi_level ?? null) as Entry['iddsi_level'],
    drink: (e.drink ?? null) as DrinkKind | null,
  }
}

// ---------- the bed list ----------

interface TotalsJson {
  in_ml: number
  out_ml: number
  pending_ml: number
  pending: number
  hourly: HourlySeries
}
interface UrineJson {
  colour: UrineColour
  rgb: string | null
  /** Epoch ms. */
  charted_at: number
  status: 'pending' | 'approved'
}

/**
 * Per bed, over the entries charted since `since`: the 24 h totals (`FILTER`) and the rolling hourly series. Rolling
 * hours, oldest first: index 23 is the last 60 minutes, an entry exactly 60 minutes old is in 22, clamped at both ends
 * so the series sums to the totals. One row per bed: 24 hour slots left-joined to the
 * bed's per-hour sums.
 */
const totalsOf = (now: Date, since: Date) => {
  const h = alias(entry, 'h')
  const hour = sql`least(23, greatest(0, 23 - floor((extract(epoch from ${now}::timestamptz) - extract(epoch from ${h.created_at})) / 3600)::int))`
  return sql<TotalsJson>`(SELECT jsonb_build_object(
      'in_ml', coalesce(sum(b.in_ml), 0), 'out_ml', coalesce(sum(b.out_ml), 0),
      'pending_ml', coalesce(sum(b.pending_ml), 0), 'pending', coalesce(sum(b.pending), 0),
      'hourly', jsonb_build_object(
        'in_ml', jsonb_agg(coalesce(b.in_ml, 0) ORDER BY g.i),
        'out_ml', jsonb_agg(coalesce(b.out_ml, 0) ORDER BY g.i),
        'in_logged', jsonb_agg(coalesce(b.in_logged, 0) ORDER BY g.i)))
    FROM generate_series(0, 23) AS g(i) LEFT JOIN (
      SELECT ${hour} AS i,
        sum(${h.volume_ml}) FILTER (WHERE ${h.status} = 'approved' AND ${h.direction} = 'in') AS in_ml,
        sum(${h.volume_ml}) FILTER (WHERE ${h.status} = 'approved' AND ${h.direction} = 'out') AS out_ml,
        sum(${h.volume_ml}) FILTER (WHERE ${h.status} = 'pending') AS pending_ml,
        count(*) FILTER (WHERE ${h.status} = 'pending') AS pending,
        count(*) FILTER (WHERE ${h.direction} = 'in' AND ${h.status} <> 'rejected') AS in_logged
      FROM ${from(entry, 'h')} WHERE ${h.admission_id} = ${admission.id} AND ${h.created_at} >= ${since}
      GROUP BY 1) AS b ON b.i = g.i)`
}

/** Newest coloured, pending or approved urine since `since`. */
const urineOf = (since: Date) => {
  const u = alias(entry, 'u')
  return sql<UrineJson | null>`(SELECT jsonb_build_object('colour', ${u.urine_colour}, 'rgb', ${u.urine_rgb},
      'charted_at', (extract(epoch from ${u.created_at}) * 1000)::bigint, 'status', ${u.status})
    FROM ${from(entry, 'u')} WHERE ${u.admission_id} = ${admission.id} AND ${u.category} = 'urine' AND ${u.urine_colour} IS NOT NULL
      AND ${u.status} <> 'rejected' AND ${u.created_at} >= ${since}
    ORDER BY ${u.created_at} DESC, ${u.id} DESC LIMIT 1)`
}

// ---------- read outcomes ----------

type Facts = { dish_kind: DishValue['dish_kind']; portion: Portion }
const facts = (ds: readonly DishValue[] | null | undefined): Facts[] =>
  (ds ?? []).map((d) => ({ dish_kind: d.dish_kind, portion: d.portion }))

/** A link as the outcome query returns it; the meal's dishes and history come raw and are reduced to facts here. */
type LinkJson =
  | { draft: number; entry: Extract<OutcomeLink, { entry: object }>['entry'] }
  | { draft: number; level: { volume_ml: number; container: string; event: BagEvent | null } }
  | {
      draft: number
      meal: {
        id: number
        voided: boolean
        portion: Portion
        dishes: DishValue[] | null
        fluid_ml: number | null
        confirmed: { portion: Portion; fluid_ml: number | null; dishes: DishValue[] } | null
        amends: { before: MealValues; after: MealValues }[]
        entry: {
          status: EntryStatus
          volume_ml: number
          recorded_ml: number
          approved_ml: number | null
          amends: { from_ml: number | null; to_ml: number | null }[]
        } | null
      }
    }

const toLink = (k: LinkJson): OutcomeLink => {
  if (!('meal' in k)) return k
  const m = k.meal
  const meal: OutcomeMeal = {
    id: m.id,
    voided: m.voided,
    portion: m.portion,
    dishes: facts(m.dishes),
    fluid_ml: m.fluid_ml,
    confirmed: m.confirmed && { portion: m.confirmed.portion, fluid_ml: m.confirmed.fluid_ml, dishes: facts(m.confirmed.dishes) },
    amends: m.amends.map((a) => ({
      before: { portion: a.before.portion, dishes: facts(a.before.dishes) },
      after: { portion: a.after.portion, dishes: facts(a.after.dishes) },
    })),
    entry: m.entry,
  }
  return { draft: k.draft, meal }
}

/**
 * The read's links, by draft, each as the record now stands: an entry with its type at save and its amends, a level,
 * or a meal with its proof's confirmed values, its amendments and its fluid entry with that entry's amends.
 */
const linksOf = () => {
  const k = alias(read_link, 'k')
  const e = alias(entry, 'le')
  const l = alias(level, 'll')
  const m = alias(meal, 'lm')
  const me = alias(entry, 'lme')
  const v = alias(entry_event, 'v')
  const ev = alias(meal_event, 'ev')
  const amends = (entryId: SQL, cols: SQL) =>
    sql`coalesce((SELECT jsonb_agg(${cols} ORDER BY ${v.at}, ${v.id}) FROM ${from(entry_event, 'v')}
      WHERE ${v.entry_id} = ${entryId} AND ${v.kind} = 'amended'), '[]'::jsonb)`
  const recordedCategory = sql`coalesce((SELECT ${v.to_category} FROM ${from(entry_event, 'v')} WHERE ${v.entry_id} = ${e.id} AND ${v.kind} = 'recorded'
      ORDER BY ${v.at}, ${v.id} LIMIT 1), ${e.category})`
  const entryLink = sql`jsonb_build_object('draft', ${k.draft}, 'entry', jsonb_build_object(
      'status', ${e.status}, 'category', ${e.category}, 'volume_ml', ${e.volume_ml}, 'urine_colour', ${e.urine_colour},
      'drink', ${e.drink}, 'recorded_ml', ${e.recorded_ml}, 'approved_ml', ${e.approved_ml},
      'recorded_category', ${recordedCategory},
      'amends', ${amends(
        sql`${e.id}`,
        sql`jsonb_build_object('from_ml', ${v.from_ml}, 'to_ml', ${v.to_ml}, 'from_category', ${v.from_category},
          'to_category', ${v.to_category}, 'from_colour', ${v.from_colour}, 'to_colour', ${v.to_colour})`,
      )}))`
  const levelLink = sql`jsonb_build_object('draft', ${k.draft}, 'level', jsonb_build_object(
      'volume_ml', ${l.volume_ml}, 'container', ${l.container}, 'event', ${l.event}))`
  const mealLink = sql`jsonb_build_object('draft', ${k.draft}, 'meal', jsonb_build_object(
      'id', ${m.id}, 'voided', ${m.voided_at} IS NOT NULL, 'portion', ${m.portion}, 'dishes', ${m.dishes},
      'fluid_ml', ${m.fluid_ml}, 'confirmed', ${m.proof} -> 'confirmed',
      'amends', coalesce((SELECT jsonb_agg(jsonb_build_object('before', ${ev.before}, 'after', ${ev.after}) ORDER BY ${ev.at}, ${ev.id})
        FROM ${from(meal_event, 'ev')} WHERE ${ev.meal_id} = ${m.id}), '[]'::jsonb),
      'entry', (SELECT jsonb_build_object('status', ${me.status}, 'volume_ml', ${me.volume_ml}, 'recorded_ml', ${me.recorded_ml},
          'approved_ml', ${me.approved_ml},
          'amends', ${amends(sql`${me.id}`, sql`jsonb_build_object('from_ml', ${v.from_ml}, 'to_ml', ${v.to_ml})`)})
        FROM ${from(entry, 'lme')} WHERE ${me.id} = ${m.entry_id})))`
  return sql<LinkJson[]>`coalesce((SELECT jsonb_agg(CASE WHEN ${k.entry_id} IS NOT NULL THEN ${entryLink}
        WHEN ${k.level_id} IS NOT NULL THEN ${levelLink} ELSE ${mealLink} END ORDER BY ${k.draft})
      FROM ${from(read_link, 'k')} LEFT JOIN ${from(entry, 'le')} ON ${e.id} = ${k.entry_id} LEFT JOIN ${from(level, 'll')} ON ${l.id} = ${k.level_id}
        LEFT JOIN ${from(meal, 'lm')} ON ${m.id} = ${k.meal_id}
      WHERE ${k.read_id} = ${model_read.id}), '[]'::jsonb)`
}

/** A later tray read by the same staff member for the same admission within READ_RETAKE_MINUTES ("Retaken tray reads"). */
const retakenOf = () => {
  const n = alias(model_read, 'n')
  return sql<boolean>`${model_read.kind} = 'tray' AND ${model_read.admission_id} IS NOT NULL AND EXISTS (
      SELECT 1 FROM ${from(model_read, 'n')} WHERE ${n.kind} = 'tray' AND ${n.staff_id} = ${model_read.staff_id}
        AND ${n.admission_id} = ${model_read.admission_id} AND ${n.id} > ${model_read.id}
        AND ${n.created_at} >= ${model_read.created_at}
        AND ${n.created_at} <= ${model_read.created_at} + ${READ_RETAKE_MINUTES * 60_000} * interval '1 millisecond')`
}

export function dashboardsArea({ db, now }: Ctx) {
  return {
    admissions: async (wardId) => {
      const t = now()
      const since = at(t - DAY_MS)
      const rows = await db
        .select({
          ...getTableColumns(admission),
          ward_code: ward.code,
          ward_name: ward.name,
          totals: totalsOf(at(t), since),
          urine: urineOf(since),
        })
        .from(admission)
        .innerJoin(ward, eq(ward.id, admission.ward_id))
        .where(wardId === undefined ? undefined : eq(admission.ward_id, wardId))
        .orderBy(ward.code, ...bedOrder())
      return rows.map((r) => ({
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
        totals: {
          in_ml: r.totals.in_ml,
          out_ml: r.totals.out_ml,
          balance_ml: r.totals.in_ml - r.totals.out_ml,
          pending_ml: r.totals.pending_ml,
        },
        pending: r.totals.pending,
        hourly: r.totals.hourly,
        urine_seen: r.urine && {
          colour: r.urine.colour,
          rgb: r.urine.rgb,
          charted_at: iso(new Date(r.urine.charted_at)),
          status: r.urine.status,
        },
      }))
    },

    wardEntries: async (wardId, since) => {
      const rows = await db
        .select({ ...entrySelection, bed: admission.bed, patient: admission.patient })
        .from(entry)
        .innerJoin(admission, eq(admission.id, entry.admission_id))
        .leftJoin(cb, eq(cb.id, entry.created_by))
        .leftJoin(rb, eq(rb.id, entry.reviewed_by))
        .leftJoin(md, eq(md.id, entry.media_id))
        .leftJoin(elm, eq(elm.id, entry.labeled_media_id))
        .leftJoin(la, eq(la.id, entry.level_id))
        .leftJoin(lam, eq(lam.id, la.media_id))
        .leftJoin(lal, eq(lal.id, la.labeled_media_id))
        .leftJoin(lb, eq(lb.id, entry.prev_level_id))
        .leftJoin(lbm, eq(lbm.id, lb.media_id))
        .leftJoin(lbl, eq(lbl.id, lb.labeled_media_id))
        .where(and(eq(admission.ward_id, wardId), gte(entry.created_at, at(since))))
        .orderBy(desc(entry.created_at), desc(entry.id))
      return rows.map((r) => ({ entry: toEntry(r), admission_id: r.e.admission_id, bed: r.bed, patient: r.patient }))
    },

    readOutcomeRows: async (since, wardId) => {
      const rows = await db
        .select({ r: getTableColumns(model_read), ward_id: admission.ward_id, retaken: retakenOf(), links: linksOf() })
        .from(model_read)
        .leftJoin(admission, eq(admission.id, model_read.admission_id))
        .where(and(gte(model_read.created_at, at(since)), wardId === undefined ? undefined : eq(admission.ward_id, wardId)))
        .orderBy(asc(model_read.created_at), asc(model_read.id))
      return rows.map(({ r, ward_id, retaken, links }) => {
        const read: StoredRead = {
          id: r.id,
          kind: r.kind as StoredRead['kind'],
          mode: r.mode as StoredRead['mode'],
          models: r.models,
          hint: r.hint as StoredRead['hint'],
          staff_id: r.staff_id,
          admission_id: r.admission_id,
          created_at: r.created_at.getTime(),
          confidence: r.confidence,
          issues: r.issues as StoredRead['issues'],
          needs_review: r.needs_review,
          drafts: r.drafts,
          output: r.output as StoredRead['output'],
        }
        return { ...read, ward_id, links: links.map(toLink), ...(r.kind === 'tray' ? { retaken } : {}) }
      })
    },
  } satisfies Partial<Store>
}
