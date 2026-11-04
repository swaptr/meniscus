/**
 * Area `media`: media rows (the bytes are in the media store under their `sha256`), their 24 h expiry while unlinked,
 * and the read log with its links (charting/media, charting/model-accuracy). Also the media helpers the entries, levels
 * and meals areas share: `unlinked`, `liveMedia`, `toMediaRef`, `insertMedia`, `gcMedia` and `linkRead`.
 */
import { and, eq, getTableColumns, isNull, lt, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { MediaRef, SourceKind } from '@meniscus/shared'
import type { StoredRead } from '../../ai/read-log.ts'
import { admission, entry, level, meal, media, model_read, read_link } from '../../db/schema.ts'
import type { Store } from '../port.ts'
import { MEDIA_UNLINKED_TTL_MS, ReadLinkTaken, type MediaInput } from '../port.ts'
import { at, iso, writeTx, type Ctx, type WriteCtx } from './context.ts'

/**
 * Unlinked media: no entry, level (its photo or after-emptying photo) or meal (its tray or served photo)
 * links the media `id` (default the `media` table's own row; pass an alias's column in a join).
 */
export const unlinked = (id: AnyPgColumn = media.id): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${entry} WHERE ${entry.media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${level} WHERE ${level.media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${level} WHERE ${level.proof_media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${meal} WHERE ${meal.media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${meal} WHERE ${meal.served_media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${entry} WHERE ${entry.labeled_media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${level} WHERE ${level.labeled_media_id} = ${id})
    AND NOT EXISTS (SELECT 1 FROM ${meal} WHERE ${meal.labeled_media_id} = ${id})`

/**
 * Never-linked media, by `linked_at` (set by the `media_linked` triggers when a record first names the row; backfilled
 * by migration 0004). The same rows as `unlinked()` while every unlink runs `gcMedia`, which deletes a row losing its
 * last link at once; read through the partial index `media_unlinked`. `unlinked()` stays the exact check for `gcMedia`.
 */
export const neverLinked = (): SQL => isNull(media.linked_at)

export type MediaDbRow = typeof media.$inferSelect

export const toMediaRef = (m: Pick<MediaDbRow, keyof MediaRef>): MediaRef => ({
  id: m.id,
  kind: m.kind as SourceKind,
  mime: m.mime,
  size: m.size,
  duration_ms: m.duration_ms,
  created_at: iso(m.created_at),
  sha256: m.sha256,
  served_meal: m.served_meal,
})

/** The row, unless it is unlinked and past its TTL (expired: no longer served or linkable). */
export async function liveMedia({ db, now }: Ctx, id: number): Promise<MediaDbRow | undefined> {
  const [r] = await db
    .select({ ...getTableColumns(media), unlinked: sql<boolean>`${neverLinked()}` })
    .from(media)
    .where(eq(media.id, id))
  if (!r) return undefined
  const { unlinked: free, ...row } = r
  return free && now() - row.created_at.getTime() > MEDIA_UNLINKED_TTL_MS ? undefined : row
}

/** Deletes unlinked media older than the TTL; their hashes go to `ctx.gone` (after COMMIT inside a `writeTx`). */
export async function expireMedia(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .delete(media)
    .where(and(lt(media.created_at, at(ctx.now() - MEDIA_UNLINKED_TTL_MS)), neverLinked()))
    .returning({ sha256: media.sha256 })
  const shas = rows.map((r) => r.sha256)
  ctx.gone?.report(shas)
  return shas
}

/** Inside a `writeTx`: expires stale uploads first, then inserts the row (a photo keeps no duration, a recording no meal). */
export async function insertMedia(t: WriteCtx, admissionId: number, m: MediaInput, staffId: number | null): Promise<MediaRef> {
  await expireMedia(t)
  const [row] = await t.db
    .insert(media)
    .values({
      admission_id: admissionId,
      kind: m.kind,
      mime: m.mime,
      size: m.size,
      duration_ms: m.kind === 'voice' ? (m.duration_ms ?? null) : null,
      created_at: at(t.now()),
      created_by: staffId,
      sha256: m.sha256,
      served_meal: m.kind === 'photo' ? (m.served_meal ?? null) : null,
    })
    .returning()
  return toMediaRef(row!)
}

/**
 * Inside a `writeTx`, after the unlinking UPDATE: deletes each of these media that nothing links any more, and reports
 * their hashes once the transaction commits. Fresh uploads are never passed in.
 */
export async function gcMedia(t: WriteCtx, ids: (number | null | undefined)[]): Promise<void> {
  for (const id of ids) {
    if (id == null) continue
    const rows = await t.db
      .delete(media)
      .where(and(eq(media.id, id), unlinked()))
      .returning({ sha256: media.sha256 })
    t.gone.report(rows.map((r) => r.sha256))
  }
}

/**
 * Inside a transaction, after the record: links a read's draft to it. A taken draft (the `read_link_once` key) throws
 * ReadLinkTaken, so the transaction rolls back. `ON CONFLICT DO NOTHING` on that key alone, so no error aborts the
 * transaction first; any other constraint still raises.
 */
export async function linkRead(
  { db, now }: Ctx,
  readId: number | undefined,
  draft: number,
  to: { entry?: number; level?: number; meal?: number },
): Promise<void> {
  if (readId === undefined) return
  const rows = await db
    .insert(read_link)
    .values({
      read_id: readId,
      draft,
      entry_id: to.entry ?? null,
      level_id: to.level ?? null,
      meal_id: to.meal ?? null,
      linked_at: at(now()),
    })
    .onConflictDoNothing({ target: [read_link.read_id, read_link.draft] })
    .returning({ read_id: read_link.read_id })
  if (!rows.length) throw new ReadLinkTaken()
}

const toRead = (r: typeof model_read.$inferSelect): StoredRead => ({
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
})

export function mediaArea(ctx: Ctx) {
  const { db, now } = ctx

  const ref = async (id: number) => {
    const m = await liveMedia(ctx, id)
    return m && toMediaRef(m)
  }

  return {
    watchMediaGone: (fn) => (ctx.gone ? ctx.gone.watch(fn) : () => {}),
    sizes: async () => {
      const [s] = await db
        .select({ bytes: sql<string | null>`sum(pg_total_relation_size(c.oid))` })
        .from(sql`pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace`)
        .where(sql`n.nspname = 'meniscus' AND c.relkind IN ('r', 'm', 'p')`)
      const [m] = await db.select({ count: sql<number>`count(*)::int`, bytes: sql<string | null>`sum(${media.size})` }).from(media)
      return { store: { bytes: Number(s?.bytes ?? 0) }, media: { count: m?.count ?? 0, bytes: Number(m?.bytes ?? 0) } }
    },
    addMedia: (admissionId, input, staffId = null) =>
      writeTx(ctx, async (t) => {
        const [a] = await t.db.select({ id: admission.id }).from(admission).where(eq(admission.id, admissionId))
        if (!a) return undefined
        return insertMedia(t, admissionId, input, staffId)
      }),
    media: ref,
    hasMediaSha: async (sha256) => {
      const [r] = await db
        .select({ hit: sql<number>`1` })
        .from(media)
        .where(eq(media.sha256, sha256))
        .limit(1)
      return r !== undefined
    },
    mediaRef: ref,
    linkable: async (mediaId, admissionId, kind) => {
      const m = await liveMedia(ctx, mediaId)
      return m?.admission_id === admissionId && m.kind === kind
    },
    copyLinkable: async (mediaId, admissionId) => {
      const [r] = await db
        .select({ ...getTableColumns(media), unlinked: sql<boolean>`${neverLinked()}` })
        .from(media)
        .where(eq(media.id, mediaId))
      // Unlinked and live: an expired upload is no longer linkable.
      return (
        r?.admission_id === admissionId &&
        r.kind === 'photo' &&
        r.served_meal === null &&
        r.unlinked &&
        now() - r.created_at.getTime() <= MEDIA_UNLINKED_TTL_MS
      )
    },
    recordRead: async (row) => {
      const [r] = await db
        .insert(model_read)
        .values({ ...row, created_at: at(now()) })
        .returning({ id: model_read.id })
      return r!.id
    },
    read: async (id) => {
      const [r] = await db.select().from(model_read).where(eq(model_read.id, id))
      return r && toRead(r)
    },
    linked: async (readId, draft) => {
      const [r] = await db
        .select({ hit: sql<number>`1` })
        .from(read_link)
        .where(and(eq(read_link.read_id, readId), eq(read_link.draft, draft)))
      return r !== undefined
    },
  } satisfies Partial<Store>
}
