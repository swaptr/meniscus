/**
 * Area `entries`: chart entries, their append-only events, reviews and amendments, the photo attached to a pending
 * entry, the read link of an entry drafted from a read, and the entry side of media GC (a rejected entry lets go of its
 * media). `insertEntry` and `entryById` are plain functions over `Ctx`, so the levels and meals areas chart their
 * entries through them.
 */
import { and, desc, eq, gte, ne, isNotNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  CATEGORY_DIRECTION,
  DRINK_LABEL,
  LATE_ENTRY_MINUTES,
  type DrinkKind,
  type Entry,
  type EntryCategory,
  type EntryEvent,
  type EntryEvidence,
  type EntryInput,
  type EventKind,
  type IddsiLevel,
  type LevelSnapshot,
  type PhotoEvidence,
  type RejectReason,
  type Totals,
  type UrineColour,
  type UrineSeen,
} from '@meniscus/shared'
import { admission, entry, entry_event, level, media, staff } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import type { AmendResult, PhotoResult, ReviewResult } from '../port.ts'
import { at, iso, isoOrNull, staffRef, writeTx, type Ctx, type WriteCtx } from './context.ts'
import { gcMedia, insertMedia, linkRead, toMediaRef } from './media.ts'

const DAY_MS = 24 * 3_600_000
const LATE_MS = LATE_ENTRY_MINUTES * 60_000

// ---------- entries ----------

const cb = alias(staff, 'cb')
const rb = alias(staff, 'rb')
const md = alias(media, 'md')
const la = alias(level, 'la')
const lb = alias(level, 'lb')
const lam = alias(media, 'lam')
const lbm = alias(media, 'lbm')
const lm = alias(media, 'lm')
const lal = alias(media, 'lal')
const lbl = alias(media, 'lbl')
/** `FOR … OF` takes an unqualified name, and Drizzle qualifies a table with its schema: lock through an alias. */
const bed = alias(admission, 'bed')

/** Entries with who recorded and reviewed them, their media, and a level drop's after and before levels with photos. */
const selectEntries = (db: Ctx['db']) =>
  db
    .select({
      e: entry,
      cb_name: cb.name,
      cb_role: cb.role,
      rb_name: rb.name,
      rb_role: rb.role,
      md,
      lm,
      la,
      lam,
      lal,
      lb,
      lbm,
      lbl,
    })
    .from(entry)
    .leftJoin(cb, eq(cb.id, entry.created_by))
    .leftJoin(rb, eq(rb.id, entry.reviewed_by))
    .leftJoin(md, eq(md.id, entry.media_id))
    .leftJoin(lm, eq(lm.id, entry.labeled_media_id))
    .leftJoin(la, eq(la.id, entry.level_id))
    .leftJoin(lam, eq(lam.id, la.media_id))
    .leftJoin(lal, eq(lal.id, la.labeled_media_id))
    .leftJoin(lb, eq(lb.id, entry.prev_level_id))
    .leftJoin(lbm, eq(lbm.id, lb.media_id))
    .leftJoin(lbl, eq(lbl.id, lb.labeled_media_id))

type EntryRow = Awaited<ReturnType<typeof selectEntries>>[number]

const levelOf = (
  l: typeof level.$inferSelect | null,
  m: typeof media.$inferSelect | null,
  lab: typeof media.$inferSelect | null,
): LevelSnapshot | null =>
  l && {
    id: l.id,
    volume_ml: l.volume_ml,
    created_at: iso(l.created_at),
    media: m && toMediaRef(m),
    labeled_media: lab && toMediaRef(lab),
    // Validated on the way in; stored as one jsonb value.
    evidence: (l.evidence as PhotoEvidence | null) ?? null,
    event: l.event ?? null,
    residual_ml: l.residual_ml ?? null,
  }

export const toEntry = ({ e: r, ...j }: EntryRow): Entry => {
  const m = j.md && toMediaRef(j.md)
  const after = levelOf(j.la, j.lam, j.lal)
  return {
    id: r.id,
    admission_id: r.admission_id,
    direction: r.direction,
    category: r.category as EntryCategory,
    volume_ml: r.volume_ml,
    item: r.item,
    notes: r.notes,
    source: r.source as Entry['source'],
    confidence: r.confidence,
    status: r.status,
    created_at: iso(r.created_at),
    reviewed_at: isoOrNull(r.reviewed_at),
    has_photo: m?.kind === 'photo',
    recorded_ml: r.recorded_ml,
    evidence: (r.evidence as EntryEvidence | null) ?? null,
    recorded_at: iso(r.recorded_at),
    late: r.recorded_at.getTime() - r.created_at.getTime() > LATE_MS,
    created_by: staffRef(r.created_by, j.cb_name, j.cb_role),
    reviewed_by: staffRef(r.reviewed_by, j.rb_name, j.rb_role),
    approved_ml: r.approved_ml,
    amended_at: isoOrNull(r.amended_at),
    reject_reason: r.reject_reason as RejectReason | null,
    urine_colour: (r.urine_colour as UrineColour | null) ?? null,
    urine_rgb: r.urine_rgb ?? null,
    media: m,
    labeled_media: j.lm && toMediaRef(j.lm),
    levels: after ? { before: levelOf(j.lb, j.lbm, j.lbl), after } : null,
    iddsi_level: (r.iddsi_level as IddsiLevel | null) ?? null,
    drink: (r.drink as DrinkKind | null) ?? null,
  }
}

const entryRow = async ({ db }: Ctx, id: number) => (await selectEntries(db).where(eq(entry.id, id)))[0]

/** One entry as the API returns it. */
export const entryById = async (ctx: Ctx, id: number): Promise<Entry | undefined> => {
  const r = await entryRow(ctx, id)
  return r && toEntry(r)
}

interface Change {
  from_ml?: number
  to_ml?: number
  from_category?: EntryCategory
  to_category?: EntryCategory
  from_colour?: UrineColour | null
  to_colour?: UrineColour | null
  from_iddsi?: IddsiLevel | null
  to_iddsi?: IddsiLevel | null
  from_drink?: DrinkKind | null
  to_drink?: DrinkKind | null
  from_item?: string | null
  to_item?: string | null
}

async function addEvent(
  { db }: Ctx,
  entryId: number,
  kind: EventKind,
  t: number,
  staffId: number | null,
  c: Change = {},
  reason: string | null = null,
  note: string | null = null,
) {
  await db.insert(entry_event).values({
    entry_id: entryId,
    kind,
    at: at(t),
    staff_id: staffId,
    from_ml: c.from_ml ?? null,
    to_ml: c.to_ml ?? null,
    from_category: c.from_category ?? null,
    to_category: c.to_category ?? null,
    reason,
    note,
    from_colour: c.from_colour ?? null,
    to_colour: c.to_colour ?? null,
    from_iddsi: c.from_iddsi ?? null,
    to_iddsi: c.to_iddsi ?? null,
    from_drink: c.from_drink ?? null,
    to_drink: c.to_drink ?? null,
    from_item: c.from_item ?? null,
    to_item: c.to_item ?? null,
  })
}

/** Inside a transaction (the bed locked): the entry and its `recorded` event. */
export async function insertEntry(
  ctx: Ctx,
  admissionId: number,
  e: Omit<EntryInput, 'charted_at'> & { item?: string | null; level_id?: number; prev_level_id?: number },
  chartedAt: number,
  t: number,
  staffId: number | null,
): Promise<Entry> {
  const [row] = await ctx.db
    .insert(entry)
    .values({
      admission_id: admissionId,
      direction: e.direction,
      category: e.category,
      volume_ml: e.volume_ml,
      item: e.item ?? null,
      notes: e.notes ?? null,
      source: e.source,
      confidence: e.confidence ?? null,
      created_at: at(chartedAt),
      recorded_ml: e.volume_ml,
      evidence: e.evidence ?? null,
      recorded_at: at(t),
      created_by: staffId,
      urine_colour: e.category === 'urine' ? (e.urine_colour ?? null) : null,
      urine_rgb: e.category === 'urine' && e.urine_colour ? (e.urine_rgb ?? null) : null,
      media_id: e.media_id ?? null,
      labeled_media_id: e.labeled_media_id ?? null,
      level_id: e.level_id ?? null,
      prev_level_id: e.prev_level_id ?? null,
      iddsi_level: e.category === 'water' ? (e.iddsi_level ?? null) : null,
      drink: e.category === 'water' || e.category === 'food' ? (e.drink ?? null) : null,
    })
    .returning({ id: entry.id })
  await addEvent(ctx, row!.id, 'recorded', t, staffId, { to_ml: e.volume_ml, to_category: e.category })
  return (await entryById(ctx, row!.id))!
}

/** Newest coloured, pending or approved urine in the window. */
async function urineSeen({ db }: Ctx, admissionId: number, since: number): Promise<UrineSeen | null> {
  const [r] = await db
    .select({ urine_colour: entry.urine_colour, urine_rgb: entry.urine_rgb, created_at: entry.created_at, status: entry.status })
    .from(entry)
    .where(
      and(
        eq(entry.admission_id, admissionId),
        eq(entry.category, 'urine'),
        isNotNull(entry.urine_colour),
        ne(entry.status, 'rejected'),
        gte(entry.created_at, at(since)),
      ),
    )
    .orderBy(desc(entry.created_at), desc(entry.id))
    .limit(1)
  return r
    ? {
        colour: r.urine_colour as UrineColour,
        rgb: r.urine_rgb,
        charted_at: iso(r.created_at),
        status: r.status as UrineSeen['status'],
      }
    : null
}

async function totalsOf({ db }: Ctx, admissionId: number, since: number): Promise<Totals> {
  const [r] = await db
    .select({
      in_ml: sql<number>`coalesce(sum(${entry.volume_ml}) FILTER (WHERE ${entry.status} = 'approved' AND ${entry.direction} = 'in'), 0)::int`,
      out_ml: sql<number>`coalesce(sum(${entry.volume_ml}) FILTER (WHERE ${entry.status} = 'approved' AND ${entry.direction} = 'out'), 0)::int`,
      pending_ml: sql<number>`coalesce(sum(${entry.volume_ml}) FILTER (WHERE ${entry.status} = 'pending'), 0)::int`,
    })
    .from(entry)
    .where(and(eq(entry.admission_id, admissionId), gte(entry.created_at, at(since))))
  return { in_ml: r!.in_ml, out_ml: r!.out_ml, balance_ml: r!.in_ml - r!.out_ml, pending_ml: r!.pending_ml }
}

/** Inside a transaction: locks the bed (admission row) first; false when it does not exist. */
async function lockBed({ db }: Ctx, admissionId: number) {
  const [a] = await db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId)).for('no key update')
  return a !== undefined
}

/** Inside a transaction: resolves the entry's bed and locks it in one statement; false when the entry does not exist. */
async function lockEntryBed({ db }: Ctx, entryId: number) {
  const [a] = await db
    .select({ id: bed.id })
    .from(entry)
    .innerJoin(bed, eq(bed.id, entry.admission_id))
    .where(eq(entry.id, entryId))
    .for('no key update', { of: bed })
  return a !== undefined
}

export function entriesArea(ctx: Ctx) {
  const { db, now } = ctx
  const exists = async (admissionId: number) =>
    (await db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId))).length > 0

  /** A bed write: one transaction; the media it deleted reach `onMediaGone` after COMMIT. */
  const write = <T>(fn: (t: WriteCtx) => Promise<T>): Promise<T> => writeTx(ctx, fn)

  /** Whether a photo may be attached to this entry, and the entry's bed when it may. */
  const photoCheck = async (c: Ctx, entryId: number): Promise<{ result: PhotoResult; admissionId?: number }> => {
    const [e] = await c.db
      .select({ status: entry.status, media_id: entry.media_id, admission_id: entry.admission_id })
      .from(entry)
      .where(eq(entry.id, entryId))
    if (!e) return { result: 'not_found' }
    if (e.status !== 'pending') return { result: 'not_pending' }
    // Any kept media, a recording too: a photo never replaces it.
    if (e.media_id !== null) return { result: 'photo_exists' }
    return { result: 'ok', admissionId: e.admission_id }
  }

  return {
    addEntry: async (admissionId, e, staffId = null) => {
      if (!(await exists(admissionId))) return undefined
      return write(async (t) => {
        if (!(await lockBed(t, admissionId))) return undefined
        const tm = now()
        const created = await insertEntry(t, admissionId, e, e.charted_at ? Date.parse(e.charted_at) : tm, tm, staffId)
        await linkRead(t, e.read_id, e.read_draft ?? 0, { entry: created.id })
        return created
      })
    },
    entries: async (admissionId) => {
      if (!(await exists(admissionId))) return undefined
      const since = now() - DAY_MS
      const rows = await selectEntries(db).where(eq(entry.admission_id, admissionId)).orderBy(desc(entry.created_at), desc(entry.id))
      return {
        entries: rows.map(toEntry),
        totals: await totalsOf(ctx, admissionId, since),
        urine_seen: await urineSeen(ctx, admissionId, since),
      }
    },
    recent: async (admissionId, since) => {
      const rows = await selectEntries(db)
        .where(and(eq(entry.admission_id, admissionId), gte(entry.created_at, at(since ?? now() - DAY_MS))))
        .orderBy(desc(entry.created_at), desc(entry.id))
      return rows.map(toEntry)
    },
    review: (entryId, action, { volumeMl, staffId = null, reason, note } = {}) =>
      write(async (t): Promise<ReviewResult> => {
        if (!(await lockEntryBed(t, entryId))) return { ok: false, error: 'not_found' }
        const before = (await entryRow(t, entryId))!.e
        const approve = action === 'approve'
        const tm = now()
        const vol = approve ? (volumeMl ?? null) : null
        const kept = vol ?? sql`${entry.volume_ml}`
        // Guarded on status so concurrent reviews cannot both apply.
        const done = await t.db
          .update(entry)
          .set({
            status: approve ? 'approved' : 'rejected',
            volume_ml: kept,
            reviewed_at: at(tm),
            ...(approve ? { approved_ml: kept } : { media_id: null, labeled_media_id: null, evidence: null, approved_ml: null }),
            reviewed_by: staffId,
            reject_reason: approve ? null : (reason ?? null),
          })
          .where(and(eq(entry.id, entryId), eq(entry.status, 'pending')))
          .returning({ id: entry.id })
        if (!done.length) return { ok: false, error: 'not_pending' }
        if (approve) {
          const to = volumeMl ?? before.volume_ml
          if (to === before.volume_ml) await addEvent(t, entryId, 'approved', tm, staffId, { to_ml: to })
          else await addEvent(t, entryId, 'corrected', tm, staffId, { from_ml: before.volume_ml, to_ml: to })
        } else {
          await gcMedia(t, [before.media_id, before.labeled_media_id])
          await addEvent(t, entryId, 'rejected', tm, staffId, {}, reason ?? null, note ?? null)
        }
        return { ok: true, entry: (await entryById(t, entryId))! }
      }),
    amend: (entryId, input, staffId = null) =>
      write(async (t): Promise<AmendResult> => {
        if (!(await lockEntryBed(t, entryId))) return { ok: false, error: 'not_found' }
        const cur = (await entryRow(t, entryId))!.e
        if (cur.status !== 'approved') return { ok: false, error: 'not_approved' }
        const curCategory = cur.category as EntryCategory
        const curColour = (cur.urine_colour as UrineColour | null) ?? null
        const curDrink = (cur.drink as DrinkKind | null) ?? null
        const category = input.category ?? curCategory
        const volume = input.volume_ml ?? cur.volume_ml
        const bad = (path: 'category' | 'iddsi_level' | 'drink', message: string): AmendResult => ({
          ok: false,
          error: 'invalid',
          path,
          message,
        })
        const sameType = 'change the volume, or the type within the same direction'
        if (CATEGORY_DIRECTION[category] !== cur.direction) return bad('category', sameType)
        if (input.urine_colour && category !== 'urine') return bad('category', sameType)
        if (input.iddsi_level !== undefined && category !== 'water') return bad('iddsi_level', 'a consistency is for drinks only')
        const drinkable = category === 'water' || category === 'food'
        if (input.drink !== undefined && !drinkable) return bad('drink', 'a drink kind is for drinks and food only')
        // Leaving urine clears the colour; a new colour name drops the photo colour.
        const colour = category === 'urine' ? (input.urine_colour ?? curColour) : null
        const rgb = category === 'urine' && colour === curColour ? (cur.urine_rgb ?? null) : null
        // Leaving water clears the consistency.
        const was = (cur.iddsi_level as IddsiLevel | null) ?? null
        const lvl = category === 'water' ? (input.iddsi_level ?? was) : null
        // Leaving water and food clears the drink kind.
        const drink = drinkable ? (input.drink ?? curDrink) : null
        if (category === curCategory && volume === cur.volume_ml && colour === curColour && lvl === was && drink === curDrink) {
          if (input.drink !== undefined) return bad('drink', 'the drink already has this kind')
          return input.iddsi_level === undefined ? bad('category', sameType) : bad('iddsi_level', 'the drink already has this consistency')
        }
        // A new drink kind renames the item to the kind's label, so the entry never reads "Coffee · masala chai".
        const item = drink !== null && drink !== curDrink ? DRINK_LABEL[drink] : (cur.item ?? null)
        const tm = now()
        await t.db
          .update(entry)
          .set({ volume_ml: volume, category, amended_at: at(tm), urine_colour: colour, urine_rgb: rgb, iddsi_level: lvl, drink, item })
          .where(and(eq(entry.id, entryId), eq(entry.status, 'approved')))
        const recolour = colour !== curColour ? { from_colour: curColour, to_colour: colour } : {}
        const relevel = lvl !== was ? { from_iddsi: was, to_iddsi: lvl } : {}
        const redrink = drink !== curDrink ? { from_drink: curDrink, to_drink: drink } : {}
        const rename = item !== (cur.item ?? null) ? { from_item: cur.item ?? null, to_item: item } : {}
        await addEvent(
          t,
          entryId,
          'amended',
          tm,
          staffId,
          {
            from_ml: cur.volume_ml,
            to_ml: volume,
            from_category: curCategory,
            to_category: category,
            ...recolour,
            ...relevel,
            ...redrink,
            ...rename,
          },
          input.reason,
        )
        return { ok: true, entry: (await entryById(t, entryId))! }
      }),
    events: async (entryId) => {
      const [e] = await db.select({ id: entry.id }).from(entry).where(eq(entry.id, entryId))
      if (!e) return undefined
      const rows = await db
        .select({ v: entry_event, s_name: staff.name, s_role: staff.role })
        .from(entry_event)
        .leftJoin(staff, eq(staff.id, entry_event.staff_id))
        .where(eq(entry_event.entry_id, entryId))
        .orderBy(entry_event.at, entry_event.id)
      return rows.map(({ v, s_name, s_role }): EntryEvent => ({
        kind: v.kind,
        at: iso(v.at),
        by: staffRef(v.staff_id, s_name, s_role),
        from_ml: v.from_ml,
        to_ml: v.to_ml,
        from_category: v.from_category as EntryCategory | null,
        to_category: v.to_category as EntryCategory | null,
        reason: v.reason,
        note: v.note,
        from_colour: (v.from_colour as UrineColour | null) ?? null,
        to_colour: (v.to_colour as UrineColour | null) ?? null,
        from_iddsi: (v.from_iddsi as IddsiLevel | null) ?? null,
        to_iddsi: (v.to_iddsi as IddsiLevel | null) ?? null,
        from_drink: (v.from_drink as DrinkKind | null) ?? null,
        to_drink: (v.to_drink as DrinkKind | null) ?? null,
        from_item: v.from_item ?? null,
        to_item: v.to_item ?? null,
      }))
    },
    photoAllowed: async (entryId) => (await photoCheck(ctx, entryId)).result,
    attachPhoto: (entryId, mime, sha256, size) =>
      write(async (t): Promise<PhotoResult> => {
        if (!(await lockEntryBed(t, entryId))) return 'not_found'
        const { result, admissionId } = await photoCheck(t, entryId)
        if (admissionId === undefined) return result
        const m = await insertMedia(t, admissionId, { kind: 'photo', mime, sha256, size }, null)
        await t.db.update(entry).set({ media_id: m.id }).where(eq(entry.id, entryId))
        return 'ok'
      }),
    // A linked media is never unlinked, so never expired: the join is the whole check.
    photo: async (entryId) => {
      const [m] = await db.select({ m: media }).from(entry).innerJoin(media, eq(media.id, entry.media_id)).where(eq(entry.id, entryId))
      return m?.m.kind === 'photo' ? toMediaRef(m.m) : undefined
    },
  } satisfies Partial<Store>
}
