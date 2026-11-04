/**
 * Dev-only fake server for browser checks (tray-comparison design §16): the real app over `testing.ts`' fake upstream,
 * so no model request leaves the machine. `scripts/fake-server.ts` points the Model API base URL at 127.0.0.1:9 before
 * this module (and `src/config.ts`) loads, so even `GET /api/ai/status`, which uses the live client, stays on loopback.
 * It logs only step names and statuses; never images, prompts or outputs.
 */
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createApp } from '../app.ts'
import { config } from '../config.ts'
import { createMediaStore } from '../store/media/create.ts'
import type { MediaStore } from '../store/media/port.ts'
import type { Store } from '../store/port.ts'
import { SAM_RECT, msg, reading, resp, upstream } from '../testing.ts'

const DISH = { left: 100, top: 80, right: 400, bottom: 480 }
const MEAL = {
  dishes: [
    { region: 1, name: 'rice', dish_kind: 'rice', eaten: 'quarter' },
    { region: 0, name: 'dal', dish_kind: 'dal_lentils', eaten: 'all' },
  ],
  eaten: 'half',
  fluids: [],
  confidence: 0.86,
  issues: [],
  notes: null,
}

/** A cup of masala chai, 150 mL: the drink a cup-hinted photo reads as. */
const CHAI = reading({
  container: 'cup',
  fluid: 'tea',
  volume_ml: 150,
  capacity_ml: 200,
  marks_visible: true,
  reading_basis: 'cup three quarters full',
  appearance: 'light brown',
  drink_name: 'masala chai',
})

/**
 * SAM answers one dish at 100,80–400,480. Within one tray read the second SAM pair is the served photo's (the pipeline
 * sends it only after the collected pair settled), so its food covers 0.8 of the dish, and the collected tray's 0.4.
 */
export function fakeUpstream(log: (line: string) => void = console.log) {
  let pairs = 0
  return upstream({
    budget: { perHour: 120, maxConcurrent: 4, reservePct: 30 },
    sam: (prompt) => {
      if (prompt === 'dish') pairs++
      const served = pairs >= 2
      log(`fake upstream: sam:${prompt} 200`)
      if (prompt === 'dish') return resp('sam-3.1', [msg(SAM_RECT(DISH))])
      return resp('sam-3.1', [msg(SAM_RECT({ ...DISH, bottom: served ? 400 : 240 }))])
    },
    spark: (body) => {
      pairs = 0
      const format = (body.text as { format?: { name?: string } } | undefined)?.format?.name
      log(`fake upstream: spark:${body.tools ? 'tool' : 'object'} 200`)
      if (body.tools) {
        const entry = { direction: 'in', category: 'water', volume_ml: 200, item: 'water', notes: 'null' }
        return resp('muse-spark-1.3', [{ type: 'function_call', call_id: 'c1', name: 'log_entry', arguments: JSON.stringify(entry) }])
      }
      if (format === 'meal_reading') return resp('muse-spark-1.3', [msg(JSON.stringify(MEAL))])
      // A cup (the staff hint) reads as masala chai (drink-types), anything else as the urine bag fixture.
      const text = JSON.stringify(body.input ?? '')
      return resp('muse-spark-1.3', [msg(JSON.stringify(text.includes('container type: cup') ? CHAI : reading()))])
    },
  })
}

/**
 * Serves the app over the fake upstream on `config.HOST:PORT`, on `store` (scripts/fake-server.ts: `DATABASE_URL`, or a
 * fresh in-process database) and its media in the configured media store (`MEDIA_STORE`: the local bucket with s3).
 */
export function startFakeServer(store: Store, log: (line: string) => void = console.log, media: MediaStore = createMediaStore(config)) {
  const u = fakeUpstream(log)
  const app = createApp({
    ai: u.ai,
    store,
    media,
    demoLogin: true,
    secureCookie: false,
    rateLimitPerMinute: 1000,
  })
  // Method, path with ids masked, and status only.
  const logged = new Hono()
    .use('*', async (c, next) => {
      await next()
      log(`${c.req.method} ${c.req.path.replace(/\/\d+(?=\/|$)/g, '/:id')} ${c.res.status}`)
    })
    .route('/', app)
  return serve({ fetch: logged.fetch, hostname: config.HOST, port: config.PORT }, (info) => {
    log(`fake server on http://${config.HOST}:${info.port} (Model API ${config.MODEL_API_BASE_URL})`)
  })
}
