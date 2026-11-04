/** Route helpers shared by the chart, media and session routes, and the app-level session check. */
import type { Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import { DECIDER_ROLES, SOURCE_KINDS, type Admission, type SourceKind, type Staff, type StaffRole } from '@meniscus/shared'
import { tokenHash } from '../auth.ts'
import { linkProblem, type LinkRecord } from '../chart/model-accuracy.ts'
import type { Store } from '../store/port.ts'

/** Positive integer ids; anything else cannot exist. */
export const id = (raw: string) => (/^[1-9]\d{0,15}$/.test(raw) ? Number(raw) : undefined)
export const notFound = { error: 'not_found' } as const
/** The signed-in person's role or ward does not allow this. */
export const forbidden = { error: 'forbidden' } as const
export const signInRequired = { error: 'sign_in_required' } as const
export const invalidCredentials = { error: 'invalid_credentials' } as const
export const invalid = (c: Context, path: string, message: string) => c.json({ error: 'invalid_request', issues: [{ path, message }] }, 400)

/** Allowed clock skew between the device and the server, for `charted_at` and a catheter's `inserted_at`. */
export const SKEW_MS = 60_000

/** `charted_at` may be up to a minute ahead (clock skew) and no earlier than admission or 24 h ago. Entries, meals and bag readings. */
export function chartedError(admission: Admission, chartedAt: string | undefined, now: number): string | null {
  if (chartedAt === undefined) return null
  const charted = Date.parse(chartedAt)
  if (charted > now + SKEW_MS) return 'charted_at is in the future'
  if (charted < Math.max(Date.parse(admission.admitted_at), now - 24 * 3_600_000)) {
    return 'charted_at is before admission or more than 24 h ago'
  }
  return null
}

/** JSON bodies of chart changes and sign-in: 16 KB at most. */
export const smallJson = () => bodyLimit({ maxSize: 16 * 1024 })

/** `staff` is the signed-in person (or null); `staffId` their id, which every change records. */
export type Env = { Variables: { staff: Staff | null; staffId: number | null } }

export const SESSION_COOKIE = 'meniscus_session'
const STAFF_ID = /^[1-9]\d{0,5}$/
const SESSION_PATH = '/api/session'

/**
 * Who is signed in, from the `meniscus_session` cookie (reads keep a session alive). Every request other than to
 * /api/session, reads included, needs a live session, else 401 `sign_in_required` (server/security "Signed-in reads",
 * "Signed-in changes"; /api/health is outside this guard). With one, an `X-Staff-Id` that is malformed or
 * off the roster is a 400, and one naming anyone else a 401: identity comes from the session, never the header.
 * /api/session ignores the header, so a stale one never blocks signing in again or out. Time is the store's clock.
 */
export const session = (store: Store) =>
  createMiddleware<Env>(async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE)
    const staff = token ? await store.sessionStaff(tokenHash(token)) : null
    c.set('staff', staff)
    c.set('staffId', staff?.id ?? null)
    if (c.req.path === SESSION_PATH) return next()
    if (!staff) return c.json(signInRequired, 401)
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next()
    const raw = c.req.header('x-staff-id')
    if (raw !== undefined) {
      const named = STAFF_ID.test(raw) ? Number(raw) : undefined
      if (named === undefined || !(await store.member(named))) return invalid(c, 'X-Staff-Id', 'not on the staff roster')
      if (named !== staff.id) return c.json(signInRequired, 401)
    }
    return next()
  })

/**
 * 403 unless the signed-in role is in `roles`. It runs before the body and the target are read, so a refused request
 * learns nothing about the target and changes nothing.
 */
export const requireRole = (roles: readonly StaffRole[]) =>
  createMiddleware<Env>(async (c, next) => {
    const staff = c.get('staff')
    if (!staff || !roles.includes(staff.role)) return c.json(forbidden, 403)
    await next()
    return undefined
  })

/** Approving, rejecting, amending and voiding (DECIDER_ROLES). */
export const requireDecider = requireRole(DECIDER_ROLES)

/** The media kind a record's source can link: `photo` and `voice` sources; text and manual records take none. */
export const mediaKindOf = (source: string): SourceKind | null =>
  (SOURCE_KINDS as readonly string[]).includes(source) ? (source as SourceKind) : null

/** A read link that fails its checks (charting/model-accuracy "Link checks"): the 400, or null. No read_id, no check. */
export async function readLinkError(
  c: Context<Env>,
  store: Store,
  admissionId: number,
  record: LinkRecord,
  body: { read_id?: number | undefined; read_draft?: number | undefined; source: string },
) {
  if (body.read_id === undefined) return null
  const draft = body.read_draft ?? 0
  const p = linkProblem(await store.read(body.read_id), await store.linked(body.read_id, draft), {
    staffId: c.get('staffId'),
    admissionId,
    record,
    source: body.source,
    draft,
    now: store.now(),
  })
  return p && invalid(c, p.path, p.message)
}

/** The read_link primary key's backstop (`ReadLinkTaken`), as the same 400 the check gives. */
export const alreadyLinked = (c: Context) => invalid(c, 'read_id', 'already linked')

/** A photo record's media links as posted: the photo, its labeled copy and the read's evidence (entries, levels, bag readings). */
interface PhotoLinks {
  media_id?: number | undefined
  labeled_media_id?: number | undefined
  evidence?: { kind: string; image_sha256?: string | undefined; segmentation?: unknown } | null | undefined
}

/**
 * Null when the photo evidence and labeled copy link, else the 400 to send (charting/photo-evidence "Photo evidence bound to
 * its photo", "Labeled copy linked with the photo"). Run after `media_id` itself was checked. No model request.
 */
export async function photoLinkError(c: Context, store: Store, admissionId: number, b: PhotoLinks) {
  const sha = b.evidence?.kind === 'photo' ? b.evidence.image_sha256 : undefined
  if (sha !== undefined && b.media_id !== undefined && (await store.mediaRef(b.media_id))?.sha256 !== sha) {
    return invalid(c, 'evidence.image_sha256', 'evidence was read from another photo')
  }
  return labeledCopyError(c, store, admissionId, b)
}

/** Null when `labeled_media_id` is absent or may link as the copy of `media_id`; else the 400 to send (entries, levels, bag readings, meals). */
export async function labeledCopyError(
  c: Context,
  store: Store,
  admissionId: number,
  b: {
    media_id?: number | undefined
    labeled_media_id?: number | undefined
    served_media_id?: number | undefined
    evidence?: { segmentation?: unknown } | null | undefined
  },
) {
  const copy = b.labeled_media_id
  if (copy === undefined) return null
  if (b.media_id === undefined) return invalid(c, 'labeled_media_id', 'a labeled copy needs its photo as media_id')
  if (copy === b.media_id || copy === b.served_media_id) return invalid(c, 'labeled_media_id', 'the labeled copy is another photo')
  if (!b.evidence?.segmentation) return invalid(c, 'labeled_media_id', 'a labeled copy needs evidence with segmentation')
  if (!(await store.copyLinkable(copy, admissionId))) return invalid(c, 'labeled_media_id', 'not an unlinked photo upload of this bed')
  return null
}
