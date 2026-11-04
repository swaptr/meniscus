/**
 * Bag readings and their after-emptying record (charting/bag-periods). No model requests. Checks on a reading, in order:
 * the body, the admission, `charted_at`, the photo, the read link, then in the store the fall guard (403) and the
 * duplicate check (409).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { BAG_CONTAINERS, BAG_EVENTS, BAG_MAX_ML, HEX_COLOUR, URINE_COLOURS } from '@meniscus/shared'
import { Duplicate, Forbidden, ReadLinkTaken, type Store } from '../store/port.ts'
import {
  alreadyLinked,
  chartedError,
  forbidden,
  id,
  invalid,
  notFound,
  photoLinkError,
  readLinkError,
  smallJson,
  type Env,
} from './common.ts'
import { PhotoEvidence } from './evidence.ts'
import { validate } from './validate.ts'

/** An upload of the same admission (POST /api/admissions/:id/media); checked against the store in the handler. */
const MediaId = z.number().int().positive().optional()
const Level = z.number().int().min(0).max(BAG_MAX_ML)

const BagReadingBody = z
  .object({
    container: z.enum(BAG_CONTAINERS),
    event: z.enum(BAG_EVENTS),
    volume_ml: Level,
    source: z.enum(['photo', 'manual']),
    media_id: MediaId,
    /** The labeled copy of `media_id`; checked against the store in the handler. */
    labeled_media_id: MediaId,
    confidence: z.number().min(0).max(1).nullable().optional(),
    evidence: PhotoEvidence.nullable().optional(),
    notes: z.string().trim().max(200).nullable().optional(),
    urine_colour: z.enum(URINE_COLOURS).nullable().optional(),
    urine_rgb: z.string().regex(HEX_COLOUR).nullable().optional(),
    /** When it was read, if earlier than now; the range is checked against the admission, as for entries. */
    charted_at: z.iso.datetime({ offset: true }).optional(),
    /** The photo read this reading was drafted from (charting/model-accuracy); checked in the handler. */
    read_id: z.number().int().positive().optional(),
    /** The reading a 409 `duplicate_reading` named, saved anyway; it must still be the nearest match (in the store). */
    confirm_duplicate_of: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (r) =>
      r.source === 'photo' || (r.media_id === undefined && r.labeled_media_id === undefined && r.evidence == null && r.confidence == null),
    {
      path: ['source'],
      message: 'a photo, its evidence and confidence are for photo readings',
    },
  )
  .refine((r) => r.container === 'urine_bag' || (!r.urine_colour && !r.urine_rgb), {
    path: ['urine_colour'],
    message: 'urine colour is for urine bags',
  })
  .refine((r) => !r.urine_rgb || Boolean(r.urine_colour), { path: ['urine_rgb'], message: 'urine_rgb needs urine_colour' })

const AfterEmptyingBody = z
  .object({ media_id: MediaId, residual_ml: Level.optional() })
  .strict()
  .refine((b) => b.media_id !== undefined || b.residual_ml !== undefined, { path: ['media_id'], message: 'a photo or a residual' })

export function bagRoutes(store: Store) {
  return new Hono<Env>()
    .post('/admissions/:id/bag-readings', smallJson(), validate('json', BagReadingBody), async (c) => {
      const admissionId = id(c.req.param('id'))
      const admission = admissionId === undefined ? undefined : await store.admission(admissionId)
      if (!admission) return c.json(notFound, 404)
      const body = c.req.valid('json')
      const late = chartedError(admission, body.charted_at, store.now())
      if (late) return invalid(c, 'charted_at', late)
      if (body.media_id !== undefined && !(await store.linkable(body.media_id, admission.id, 'photo'))) {
        return invalid(c, 'media_id', 'not a kept photo of this bed')
      }
      // Before the photo links (a retried save answers `already linked`) and the fall guard: a re-post stores nothing. The guard's 403 rolls a link back too.
      const link = await readLinkError(c, store, admission.id, 'bag', body)
      if (link) return link
      const photoLinks = await photoLinkError(c, store, admission.id, body)
      if (photoLinks) return photoLinks
      try {
        const r = await store.addBagReading(admission.id, body, c.get('staffId'))
        return r ? c.json(r, 201) : c.json(notFound, 404)
      } catch (err) {
        // An attendant's emptying or bag change inside a fall's gap: only a nurse clears a fall.
        if (err instanceof Forbidden) return c.json(forbidden, 403)
        if (err instanceof ReadLinkTaken) return alreadyLinked(c)
        // A repeat of a stored reading: nothing stored or linked until staff confirm that reading's id.
        if (err instanceof Duplicate) return c.json({ error: 'duplicate_reading', duplicate_of: err.duplicate }, 409)
        throw err
      }
    })
    .post('/bag-readings/:id/after-emptying', smallJson(), validate('json', AfterEmptyingBody), async (c) => {
      const readingId = id(c.req.param('id'))
      const found = readingId === undefined ? undefined : await store.bagReading(readingId)
      if (!found) return c.json(notFound, 404)
      const { reading } = found
      const body = c.req.valid('json')
      if (reading.event === 'check') return invalid(c, 'id', 'an after-emptying record is for an emptying or a bag change')
      if (body.residual_ml !== undefined && reading.event !== 'emptied') return invalid(c, 'residual_ml', 'a residual is for an emptying')
      if (body.residual_ml !== undefined && body.residual_ml > reading.volume_ml) {
        return invalid(c, 'residual_ml', 'more than the bag held before emptying')
      }
      if (body.media_id !== undefined && !(await store.linkable(body.media_id, found.admission_id, 'photo'))) {
        return invalid(c, 'media_id', 'not a kept photo of this bed')
      }
      const r = await store.afterEmptying(reading.id, body)
      if (r.ok) return c.json(r.reading)
      return r.error === 'not_found' ? c.json(notFound, 404) : c.json({ error: 'after_emptying_closed' }, 409)
    })
}
