/** Kept media: upload a bed's photo or recording, and serve it. No model requests; 1 media store request each. */
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { MEAL_KINDS, MEDIA_TYPES, SOURCE_KINDS } from '@meniscus/shared'
import type { Store } from '../store/port.ts'
import { id, notFound, type Env } from './common.ts'
import { serveBytes, storeBytes, type MediaIo } from './media-io.ts'
import { sniff, validate } from './validate.ts'

const MAX_MEDIA = Math.max(...SOURCE_KINDS.map((k) => MEDIA_TYPES[k].maxBytes))
const MAX_DURATION_MS = 3_600_000
const mb = (n: number) => `${n / 1024 / 1024} MB`

const MediaForm = z
  .object({
    file: z.instanceof(File),
    kind: z.enum(SOURCE_KINDS),
    /** Client-reported; display only. Kept for recordings. */
    duration_ms: z.coerce.number().int().min(0).max(MAX_DURATION_MS).optional(),
    /** A served tray photo's meal (charting/meals "Served tray photo"); photos only. */
    served_meal: z.enum(MEAL_KINDS).optional(),
  })
  .superRefine(async (f, ctx) => {
    if (f.served_meal !== undefined && f.kind !== 'photo') {
      ctx.addIssue({ code: 'custom', path: ['served_meal'], message: 'served_meal is for photos' })
    }
    const cap = MEDIA_TYPES[f.kind].maxBytes
    if (f.file.size === 0 || f.file.size > cap) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: `${f.kind} must be 1 B – ${mb(cap)}` })
    } else if (!sniff(f.kind, new Uint8Array(await f.file.slice(0, 16).arrayBuffer()))) {
      ctx.addIssue({ code: 'custom', path: ['file'], message: `content is not one of ${MEDIA_TYPES[f.kind].mimes.join(', ')}` })
    }
  })

export function mediaRoutes(store: Store, io: MediaIo) {
  return new Hono<Env>()
    .post(
      '/admissions/:id/media',
      // The largest kind's cap plus room for the form; a bigger body is refused before it is read.
      bodyLimit({ maxSize: MAX_MEDIA + 1024 * 1024, onError: (c) => c.json({ error: 'payload_too_large' }, 413) }),
      validate('form', MediaForm),
      async (c) => {
        const admissionId = id(c.req.param('id'))
        if (admissionId === undefined || !(await store.admission(admissionId))) return c.json(notFound, 404)
        const { file, kind, duration_ms, served_meal } = c.req.valid('form')
        const bytes = new Uint8Array(await file.arrayBuffer())
        // The stored type is the sniffed one, never the client's.
        const mime = sniff(kind, bytes)!
        const m = await storeBytes(
          io,
          bytes,
          mime,
          (sha256, size, t) =>
            t.addMedia(
              admissionId,
              { kind, mime, sha256, size, duration_ms: duration_ms ?? null, served_meal: served_meal ?? null },
              c.get('staffId'),
            ),
          (r) => r !== undefined,
        )
        return m ? c.json(m, 201) : c.json(notFound, 404)
      },
    )
    .get('/media/:id', async (c) => {
      const mediaId = id(c.req.param('id'))
      const m = mediaId === undefined ? undefined : await store.media(mediaId)
      if (!m) return c.json(notFound, 404)
      return serveBytes(io, m)
    })
}
