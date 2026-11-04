/** The ward's model accuracy summary (charting/model-accuracy "Model accuracy summary"). A GET: no session, no model requests. */
import { Hono } from 'hono'
import { z } from 'zod'
import { QUALITY_DAYS, QUALITY_MAX_DAYS } from '@meniscus/shared'
import { modelQuality } from '../chart/model-accuracy.ts'
import type { Store } from '../store/port.ts'
import { id, notFound, type Env } from './common.ts'
import { validate } from './validate.ts'

const DAY_MS = 24 * 3_600_000

const ModelQuery = z.object({ days: z.coerce.number().int().min(1).max(QUALITY_MAX_DAYS).optional(), ward: z.string().optional() }).strict()

export function qualityRoutes(store: Store) {
  return new Hono<Env>().get('/quality/model', validate('query', ModelQuery), async (c) => {
    const { days = QUALITY_DAYS, ward: raw } = c.req.valid('query')
    const wardId = raw === undefined ? undefined : id(raw)
    const ward = wardId === undefined ? null : ((await store.ward(wardId)) ?? null)
    if (raw !== undefined && !ward) return c.json(notFound, 404)
    const now = store.now()
    return c.json(modelQuality(await store.readOutcomeRows(now - days * DAY_MS, ward?.id), now, { ward, days }))
  })
}
