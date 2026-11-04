import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { BudgetRefusal, CaptureReadResult, NoteResult } from '@meniscus/shared'
import { parseConfig, routineCeiling } from '../config.ts'
import type { MealReadResult } from '@meniscus/shared'
import {
  SAM_EMPTY,
  SAM_TEXT,
  dataUrl,
  holdInFlight,
  imageOf,
  jpeg,
  msg,
  png,
  resp,
  silenceWav,
  testApp,
  upstream,
  useBudget,
  testStore,
  type Upstream,
} from '../testing.ts'
import { LIQUID_CONCEPT } from './segmentation.ts'

describe('config', () => {
  it('[capture/read-budget] Critical reserve: Ceiling from config', () => {
    const at = (pct?: string) => parseConfig({ MODEL_API_MAX_REQUESTS_PER_HOUR: '120', CRITICAL_RESERVE_PCT: pct })
    assert.equal(at().CRITICAL_RESERVE_PCT, 30)
    assert.equal(routineCeiling(at()), 84)
    assert.equal(routineCeiling(at('0')), 120)
    assert.equal(routineCeiling(at('90')), 12)
    assert.throws(() => at('95'), /CRITICAL_RESERVE_PCT/)
  })

  it('[capture/read-budget] Read mode fits the budget: In-flight minimum from config', () => {
    assert.throws(() => parseConfig({ MODEL_API_MAX_CONCURRENT: '1' }), /MODEL_API_MAX_CONCURRENT/)
    assert.equal(parseConfig({ MODEL_API_MAX_CONCURRENT: '2' }).MODEL_API_MAX_CONCURRENT, 2)
    assert.equal(parseConfig({}).MODEL_API_MAX_CONCURRENT, 4)
  })

  it('[capture/read-budget] Reads under budget pressure: point from config', () => {
    assert.equal(parseConfig({}).BUDGET_PRESSURE_PCT, 50)
    assert.equal(parseConfig({ BUDGET_PRESSURE_PCT: '100' }).BUDGET_PRESSURE_PCT, 100)
    assert.throws(() => parseConfig({ BUDGET_PRESSURE_PCT: '0' }), /BUDGET_PRESSURE_PCT/)
    assert.throws(() => parseConfig({ BUDGET_PRESSURE_PCT: '101' }), /BUDGET_PRESSURE_PCT/)
  })
})

// ---------- the budget over HTTP (capture/read-budget, model-api/http-errors) ----------

/** Local time on 3 Nov 2026. */
const at = (h: number, m = 0, s = 0) => new Date(2026, 10, 3, h, m, s).getTime()
const ANITA = 4
/** The default cap of 120 an hour, with the default 30 % reserve (routine ceiling 84). */
const DEFAULTS = { perHour: 120, maxConcurrent: 4, reservePct: 30 }

type Refusal = BudgetRefusal & { error: string }

/** The demo store and the fake upstream on one clock, opened at 10:00 on 3 Nov (no bed has a prompt yet). */
async function setup(over: Upstream = {}) {
  const clock = { t: at(10) }
  const now = () => clock.t
  const u = upstream({ budget: DEFAULTS, clock: now, ...over })
  const store = await testStore(now)
  const { request, keep } = await testApp({ ai: u.ai, store, statusClient: () => u.client, rateLimitPerMinute: 1000 })
  const budget = u.client.budget
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)!
  const send = async <T>(path: string, body?: FormData | object) => {
    const res = await request(
      path,
      body === undefined
        ? {}
        : {
            method: 'POST',
            ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
          },
      { staff: ANITA },
    )
    return { status: res.status, retryAfter: res.headers.get('retry-after'), body: (await res.json()) as T & Partial<Refusal> }
  }
  const form = (fields: Record<string, string | Blob>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    return f
  }
  const photo = (admissionId?: number, mode = 'sam+spark') =>
    send<CaptureReadResult>(
      '/api/ai/read',
      form({
        image: new File([jpeg], 'a.jpg', { type: 'image/jpeg' }),
        mode,
        ...(admissionId !== undefined && { admission_id: String(admissionId) }),
      }),
    )
  const note = (admissionId: number) => send<NoteResult>('/api/ai/note', { text: 'coconut water 200', admission_id: admissionId })
  const voice = (admissionId: number) =>
    send<NoteResult>(
      '/api/ai/voice-note',
      form({ audio: new File([silenceWav()], 'a.wav', { type: 'audio/wav' }), admission_id: String(admissionId) }),
    )
  /** The upstream requests made by `fn`. */
  const sent = async <T>(fn: () => Promise<T>): Promise<[T, string[]]> => {
    const before = u.requests.length
    const r = await fn()
    return [r, u.requests.slice(before)]
  }
  /** Gives 3A bed 2 an overload prompt (1600 mL IV in, approved), so it is `stable` with `suggested: critical`. */
  const overload = async (id: number) => {
    const r = await request(
      `/api/admissions/${id}/entries`,
      {
        method: 'POST',
        body: JSON.stringify({ direction: 'in', category: 'iv', volume_ml: 1600, source: 'manual' }),
        headers: { 'content-type': 'application/json' },
      },
      { staff: ANITA },
    )
    const entry = (await r.json()) as { id: number }
    await request(
      `/api/entries/${entry.id}/review`,
      { method: 'POST', body: JSON.stringify({ action: 'approve' }), headers: { 'content-type': 'application/json' } },
      { staff: ANITA },
    )
  }
  const inUse = () => budget.stats().lastHour + budget.stats().held
  return { clock, u, store, budget, bed, send, photo, note, voice, sent, overload, inUse, request, keep }
}

describe('read budget', () => {
  it('[capture/read-budget] Budget class of a model action: Classes at the routine ceiling', async () => {
    const t = await setup()
    const bed2 = (await t.bed('3A', '2')).id
    await t.overload(bed2)
    const ac = (await (await t.request('/api/admissions')).json()) as { id: number; acuity: { level: string; suggested: string } }[]
    assert.deepEqual(ac.find((a) => a.id === bed2)!.acuity.suggested, 'critical')
    useBudget(t.budget, 84)
    for (const id of [(await t.bed('HDU', '1')).id, bed2]) {
      const [r, reqs] = await t.sent(() => t.photo(id))
      assert.equal(r.status, 200)
      assert.equal(r.body.mode, 'sam+spark')
      assert.equal(reqs.filter((q) => q.startsWith('sam:')).length, 2)
      assert.deepEqual(
        reqs.filter((q) => q.startsWith('spark')),
        ['spark:object'],
      )
    }
    const meal = () =>
      t.send(
        '/api/ai/meal',
        (() => {
          const f = new FormData()
          f.append('image', new File([jpeg], 'tray.jpg', { type: 'image/jpeg' }))
          f.append('mode', 'sam+spark')
          return f
        })(),
      )
    for (const fn of [async () => t.photo((await t.bed('3A', '4')).id), () => t.photo(), meal, () => t.send('/api/ai/status')]) {
      const [r, reqs] = await t.sent(fn)
      assert.equal(r.status, 429)
      assert.equal(r.body.budget_class, 'routine')
      assert.deepEqual(reqs, [])
    }
  })

  it('[capture/read-budget] Critical reserve: Reserve boundary', async () => {
    const t = await setup()
    useBudget(t.budget, 82)
    const bed4 = (await t.bed('3A', '4')).id
    for (let i = 0; i < 2; i++) {
      const [r, reqs] = await t.sent(() => t.note(bed4))
      assert.equal(r.status, 200)
      assert.equal(reqs.length, 1)
    }
    const [third, none] = await t.sent(() => t.note(bed4))
    assert.equal(third.status, 429)
    assert.equal(third.body.budget_class, 'routine')
    assert.deepEqual(none, [])
    const [hdu, one] = await t.sent(async () => t.note((await t.bed('HDU', '1')).id))
    assert.equal(hdu.status, 200)
    assert.equal(one.length, 1)
    assert.equal(t.inUse(), 85)
  })

  it('[capture/read-budget] Critical reserve: Cap reached for critical', async () => {
    const t = await setup()
    useBudget(t.budget, 119)
    const [r, reqs] = await t.sent(async () => t.voice((await t.bed('HDU', '1')).id))
    assert.equal(r.status, 429)
    assert.equal(r.body.budget_class, 'critical')
    assert.deepEqual(reqs, [])
  })

  it('[capture/read-budget] Whole action admitted up front: Voice note at the edge', async () => {
    const t = await setup()
    useBudget(t.budget, 83)
    const [r, reqs] = await t.sent(async () => t.voice((await t.bed('3A', '4')).id))
    assert.equal(r.status, 429)
    assert.deepEqual(reqs, [])
  })

  it('[capture/read-budget] Whole action admitted up front: Too many in flight', async () => {
    const t = await setup()
    const release = holdInFlight(t.budget, 4)
    const [r, reqs] = await t.sent(async () => t.note((await t.bed('3A', '4')).id))
    release()
    assert.equal(r.status, 429)
    assert.equal(r.body.limit, 'concurrent')
    assert.deepEqual(reqs, [])
  })

  it('[capture/read-budget] Whole action admitted up front: Failed segmentation keeps its read', async () => {
    const t = await setup({
      sam: (prompt) =>
        prompt === LIQUID_CONCEPT
          ? resp('sam-3.1', [msg(SAM_TEXT)])
          : Response.json({ error: { message: 'boom', type: 'server_error', code: 'server_error' } }, { status: 500 }),
    })
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('HDU', '1')).id))
    assert.equal(reqs.length, 3)
    assert.deepEqual(
      reqs.filter((q) => q.startsWith('spark')),
      ['spark:object'],
    )
    assert.equal(r.status, 200)
    assert.equal(r.body.segmentation, null)
    assert.ok(r.body.warnings.some((w) => w.startsWith('segmentation unavailable')))
  })

  it('[capture/read-budget] Whole action admitted up front: Unsent requests returned', async () => {
    const t = await setup({
      asr: () => Response.json({ error: { message: 'busy', type: 'server_error', code: 'overloaded' } }, { status: 503 }),
    })
    useBudget(t.budget, 10)
    const [r, reqs] = await t.sent(async () => t.voice((await t.bed('HDU', '1')).id))
    assert.equal(r.status, 503)
    assert.deepEqual(reqs, ['asr'])
    assert.equal(t.inUse(), 11)
    assert.equal(t.budget.stats().held, 0)
  })

  it('[capture/read-budget] Read mode fits the budget: Room for three', async () => {
    const t = await setup()
    const b1 = (await t.bed('5B', '1')).id
    await t.store.setCare(b1, 'acuity', { level: 'watch' }, ANITA)
    useBudget(t.budget, 81)
    const [r, reqs] = await t.sent(() => t.photo(b1))
    assert.equal(r.body.mode, 'sam+spark')
    assert.equal(reqs.filter((q) => q.startsWith('sam:')).length, 2)
    assert.deepEqual(
      reqs.filter((q) => q.startsWith('spark')),
      ['spark:object'],
    )
  })

  it('[capture/read-budget] Read mode fits the budget: Room for one request only', async () => {
    const t = await setup()
    const b1 = (await t.bed('5B', '1')).id
    await t.store.setCare(b1, 'acuity', { level: 'watch' }, ANITA)
    useBudget(t.budget, 82)
    const [watch, a] = await t.sent(() => t.photo(b1))
    useBudget(t.budget, 118 - t.inUse())
    assert.equal(t.inUse(), 118)
    const [hdu, b] = await t.sent(async () => t.photo((await t.bed('HDU', '1')).id))
    for (const [r, reqs] of [
      [watch, a],
      [hdu, b],
    ] as const) {
      assert.equal(r.status, 200)
      assert.deepEqual(reqs, ['spark:object'])
      assert.equal(r.body.mode, 'spark')
      assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
    }
  })

  it('[capture/read-budget] Read mode fits the budget: Spark requested', async () => {
    const t = await setup()
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('HDU', '1')).id, 'spark'))
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.ok(!r.body.warnings.some((w) => w.startsWith('budget pressure')))
  })

  it('[capture/read-budget] Read mode fits the budget: Busy, not downgraded', async () => {
    const t = await setup()
    useBudget(t.budget, 7)
    const release = holdInFlight(t.budget, 3)
    assert.equal(t.inUse(), 10)
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('HDU', '1')).id))
    release()
    assert.equal(r.status, 429)
    assert.deepEqual([r.body.limit, r.body.budget_class, r.body.retry_after_ms], ['concurrent', 'critical', 5000])
    assert.deepEqual(reqs, [])
  })
})

describe('local budget refusal', () => {
  it('[model-api/http-errors] Local budget refusal: Routine read refused', async () => {
    const t = await setup()
    useBudget(t.budget, 1)
    t.clock.t = at(10, 20)
    useBudget(t.budget, 83)
    t.clock.t = at(10, 40)
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('3A', '4')).id))
    assert.equal(r.status, 429)
    assert.deepEqual(
      { ...r.body, message: undefined },
      {
        error: 'request_budget_exceeded',
        message: undefined,
        limit: 'hourly',
        budget_class: 'routine',
        retry_after_ms: 1_200_000,
        retryable: true,
      },
    )
    assert.equal(r.retryAfter, '1200')
    assert.deepEqual(reqs, [])
  })

  it('[model-api/http-errors] Local budget refusal: Busy rather than spent', async () => {
    const t = await setup()
    const release = holdInFlight(t.budget, 4)
    const [r, reqs] = await t.sent(async () => t.voice((await t.bed('HDU', '1')).id))
    release()
    assert.equal(r.status, 429)
    assert.deepEqual([r.body.limit, r.body.budget_class, r.body.retry_after_ms], ['concurrent', 'critical', 5000])
    assert.equal(r.retryAfter, '5')
    assert.deepEqual(reqs, [])
  })
})

describe('reads name their bed', () => {
  it('[charting/model-accuracy] Reads name their bed: Bed picks the class', async () => {
    const t = await setup()
    useBudget(t.budget, 84)
    const hdu = await t.bed('HDU', '1')
    const [ok, a] = await t.sent(() => t.photo(hdu.id))
    assert.equal(ok.status, 200)
    assert.equal(ok.body.mode, 'sam+spark')
    assert.equal(a.length, 3)
    const reads = (await t.store.readOutcomeRows(0)).length
    const [refused, b] = await t.sent(async () => t.photo((await t.bed('3A', '4')).id))
    assert.equal(refused.status, 429)
    assert.equal(refused.body.budget_class, 'routine')
    assert.deepEqual(b, [])
    assert.equal((await t.store.readOutcomeRows(0)).length, reads)
    const spark = JSON.stringify(t.u.bodies.find((x) => x.model !== 'sam-3.1'))
    assert.ok(!spark.includes(hdu.patient) && !spark.includes('admission'))
  })
})

// ---------- tray reads with a bed and a served photo (tray-comparison) ----------

const SERVED = png(1000, 800, 1)
const COLLECTED = png(1000, 800, 2)

describe('served tray reads and the budget', () => {
  /** `await setup()` plus a served lunch photo on `bed` (bytes `served`) and a collected tray read for that bed. */
  async function trays(over: Upstream = {}) {
    const rice = {
      dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' }],
      eaten: 'half',
      fluids: [],
      confidence: 0.9,
      issues: [],
      notes: null,
    }
    const t = await setup({ spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(rice))]), ...over })
    const serve = async (admissionId: number, bytes: Uint8Array = SERVED, mime = 'image/png') =>
      (await t.keep(admissionId, { kind: 'photo', mime, bytes, served_meal: 'lunch' }, ANITA))!
    const tray = (admissionId: number | undefined, mode = 'sam+spark') => {
      const f = new FormData()
      f.append('image', new File([COLLECTED], 'tray.png', { type: 'image/png' }))
      f.append('mode', mode)
      if (admissionId !== undefined) {
        f.append('admission_id', String(admissionId))
        f.append('meal', 'lunch')
      }
      return t.send<MealReadResult>('/api/ai/meal', f)
    }
    /** 5B bed 1 with an order `watch`, so budget pressure leaves its reads alone. */
    const watchBed = async () => {
      const id = (await t.bed('5B', '1')).id
      await t.store.setCare(id, 'acuity', { level: 'watch' }, ANITA)
      return id
    }
    return { ...t, serve, tray, watchBed }
  }

  it('[capture/read-budget] Budget class of a model action: Tray read for a critical bed', async () => {
    const t = await trays()
    useBudget(t.budget, 84)
    const [ok, a] = await t.sent(async () => t.tray((await t.bed('HDU', '1')).id))
    assert.deepEqual([ok.status, ok.body.mode, a.length], [200, 'sam+spark', 3])
    const [refused, b] = await t.sent(async () => t.tray((await t.bed('3A', '4')).id))
    assert.deepEqual([refused.status, refused.body.budget_class, b], [429, 'routine', []])
  })

  it('[capture/read-budget] Whole action admitted up front: Served tray admitted for five, sends three', async () => {
    const t = await trays({
      sam: (prompt, body) =>
        resp('sam-3.1', [msg(prompt === 'dish' && imageOf(body) === dataUrl(COLLECTED, 'image/png') ? SAM_EMPTY : SAM_TEXT)]),
    })
    const hdu = (await t.bed('HDU', '1')).id
    await t.serve(hdu)
    useBudget(t.budget, 10)
    const [r, reqs] = await t.sent(() => t.tray(hdu))
    assert.equal(r.status, 200)
    assert.deepEqual(reqs, ['sam:dish', 'sam:food', 'spark:object'])
    assert.equal(t.inUse(), 13)
    assert.equal(t.budget.stats().held, 0)
  })

  it('[capture/read-budget] Served tray reads fit the budget: Room for five', async () => {
    const t = await trays()
    const bed = await t.watchBed()
    await t.serve(bed)
    useBudget(t.budget, 79)
    const [r, reqs] = await t.sent(() => t.tray(bed))
    assert.deepEqual(reqs, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
    assert.equal(r.body.mode, 'sam+spark')
    assert.ok(!r.body.warnings.some((w) => w.startsWith('budget pressure')))
  })

  it('[capture/read-budget] Served tray reads fit the budget: Room for four', async () => {
    const t = await trays()
    const bed = await t.watchBed()
    await t.serve(bed)
    useBudget(t.budget, 80)
    const [r, reqs] = await t.sent(() => t.tray(bed))
    assert.deepEqual(reqs, ['sam:dish', 'sam:food', 'spark:object'])
    assert.ok(t.u.bodies.filter((b) => b.model === 'sam-3.1').every((b) => imageOf(b) === dataUrl(COLLECTED, 'image/png')))
    assert.equal(r.body.mode, 'sam+spark')
    assert.equal(r.body.comparison?.served, null)
    assert.ok(r.body.reading.dishes.every((d) => d.basis === 'model'))
    assert.ok(r.body.warnings.includes('budget pressure: read without comparison'))
  })

  it('[capture/read-budget] Served tray reads fit the budget: Room for four, photo size unknown', async () => {
    const t = await trays()
    const bed = await t.watchBed()
    await t.serve(bed, jpeg, 'image/jpeg')
    useBudget(t.budget, 80)
    const [r, reqs] = await t.sent(() => t.tray(bed))
    assert.deepEqual(reqs, ['sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(r.body.warnings, ['comparison unavailable: photo size unknown'])
  })

  it('[capture/read-budget] Served tray reads fit the budget: Room for two', async () => {
    const t = await trays()
    const bed = await t.watchBed()
    const served = await t.serve(bed)
    useBudget(t.budget, 82)
    const [r, reqs] = await t.sent(() => t.tray(bed))
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'))
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served], [served.id, null])
  })

  it('[capture/read-budget] Served tray reads fit the budget: None left', async () => {
    const t = await trays()
    const bed = await t.watchBed()
    await t.serve(bed)
    useBudget(t.budget, 84)
    const [r, reqs] = await t.sent(() => t.tray(bed))
    assert.deepEqual([r.status, r.body.error, r.body.budget_class, reqs], [429, 'request_budget_exceeded', 'routine', []])
  })

  it('[capture/read-budget] Reads under budget pressure: Trays under pressure', async () => {
    const t = await trays()
    useBudget(t.budget, 60)
    for (const fn of [() => t.tray(undefined), async () => t.tray((await t.bed('3A', '4')).id)]) {
      const [r, reqs] = await t.sent(fn)
      assert.equal(r.status, 200)
      assert.deepEqual(reqs, ['spark:object'])
      assert.equal(r.body.mode, 'spark')
      assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
    }
    const [hdu, a] = await t.sent(async () => t.tray((await t.bed('HDU', '1')).id))
    assert.deepEqual([hdu.status, hdu.body.mode, a], [200, 'sam+spark', ['sam:dish', 'sam:food', 'spark:object']])
    const t2 = await trays()
    useBudget(t2.budget, 59)
    const [last, b] = await t2.sent(() => t2.tray(undefined))
    assert.deepEqual([last.status, last.body.mode, b], [200, 'sam+spark', ['sam:dish', 'sam:food', 'spark:object']])
  })

  it('[capture/read-budget] Reads under budget pressure: Served tray under pressure', async () => {
    const t = await trays()
    const bed4 = (await t.bed('3A', '4')).id
    const hdu = (await t.bed('HDU', '1')).id
    const served = await t.serve(bed4)
    await t.serve(hdu)
    useBudget(t.budget, 60)
    const [r, reqs] = await t.sent(() => t.tray(bed4))
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served], [served.id, null])
    const [h, five] = await t.sent(() => t.tray(hdu))
    assert.equal(five.length, 5)
    assert.equal(h.body.mode, 'sam+spark')
    assert.ok(!h.body.warnings.some((w) => w.startsWith('budget pressure')))
  })

  it('[capture/meal-reading] Served and collected trays: Stable bed under pressure', async () => {
    const t = await trays()
    const bed4 = (await t.bed('3A', '4')).id
    const served = await t.serve(bed4)
    useBudget(t.budget, 60)
    const [r, reqs] = await t.sent(() => t.tray(bed4))
    assert.equal(r.status, 200)
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
    assert.deepEqual([r.body.comparison?.served_media_id, r.body.comparison?.served], [served.id, null])
  })
})

describe('budget pressure', () => {
  it('[capture/read-budget] Reads under budget pressure: Stable bed under pressure', async () => {
    const t = await setup()
    useBudget(t.budget, 60)
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('3A', '4')).id))
    assert.equal(r.status, 200)
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
  })

  it('[capture/read-budget] Reads under budget pressure: Below the pressure point', async () => {
    const t = await setup()
    useBudget(t.budget, 59)
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('3A', '4')).id))
    assert.equal(r.body.mode, 'sam+spark')
    assert.equal(reqs.filter((q) => q.startsWith('sam:')).length, 2)
    assert.deepEqual(
      reqs.filter((q) => q.startsWith('spark')),
      ['spark:object'],
    )
  })

  it('[capture/read-budget] Reads under budget pressure: Watch and critical keep segmentation', async () => {
    const t = await setup()
    const b1 = (await t.bed('5B', '1')).id
    await t.store.setCare(b1, 'acuity', { level: 'watch' }, ANITA)
    const bed2 = (await t.bed('3A', '2')).id
    await t.overload(bed2)
    useBudget(t.budget, 70 - t.inUse())
    assert.equal(t.inUse(), 70)
    for (const id of [b1, (await t.bed('HDU', '1')).id, bed2]) {
      const [r, reqs] = await t.sent(() => t.photo(id))
      assert.equal(r.status, 200)
      assert.equal(r.body.mode, 'sam+spark')
      assert.equal(reqs.length, 3)
    }
  })

  it('[capture/read-budget] Reads under budget pressure: Pressure, not concurrency', async () => {
    const t = await setup()
    useBudget(t.budget, 57)
    const release = holdInFlight(t.budget, 3)
    assert.equal(t.inUse(), 60)
    const [r, reqs] = await t.sent(async () => t.photo((await t.bed('3A', '4')).id))
    release()
    assert.equal(r.status, 200)
    assert.deepEqual(reqs, ['spark:object'])
    assert.equal(r.body.mode, 'spark')
    assert.equal(r.body.limit, undefined)
    assert.ok(r.body.warnings[0]!.startsWith('budget pressure'), r.body.warnings.join())
  })
})
