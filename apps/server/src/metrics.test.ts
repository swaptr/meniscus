import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Admission, OperationalMetrics } from '@meniscus/shared'
import { jpeg, msg, png, reading, resp, silenceWav, testApp, testStore, upstream, useBudget } from './testing.ts'

const ANITA = 4
const LAKSHMI = 10
/** A cap of 120 an hour with the default 30 % reserve (routine ceiling 84). */
const DEFAULTS = { perHour: 120, maxConcurrent: 4, reservePct: 30 }

async function setup(spark?: (body: Record<string, any>) => Response) {
  const u = upstream({ budget: DEFAULTS, ...(spark && { spark }) })
  const store = await testStore()
  const t = await testApp({ ai: u.ai, store, statusClient: () => u.client, modelBudget: () => u.client.budget, rateLimitPerMinute: 1000 })
  const bed = async (ward: string, n: string) => (await store.admissions()).find((a) => a.ward_code === ward && a.bed === n)! as Admission
  const json = (path: string, body: object, staff = ANITA) =>
    t.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, { staff })
  const upload = (path: string, fields: Record<string, string | Blob>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.append(k, v)
    return t.request(path, { method: 'POST', body: f }, { staff: ANITA })
  }
  const photo = (admissionId: number) =>
    upload('/api/ai/read', {
      image: new File([jpeg], 'a.jpg', { type: 'image/jpeg' }),
      mode: 'sam+spark',
      admission_id: String(admissionId),
    })
  const metrics = async () => {
    const before = u.requests.length
    const res = await t.request('/api/metrics', {}, { staff: LAKSHMI })
    assert.equal(u.requests.length, before, 'the metrics call sends no model request')
    return { status: res.status, text: await res.text() }
  }
  return { ...t, u, budget: u.client.budget, bed, json, upload, photo, metrics }
}

const parse = (text: string) => JSON.parse(text) as OperationalMetrics

describe('metrics', () => {
  it('[server/metrics] Operational metrics: Counts after use', async () => {
    const t = await setup()
    useBudget(t.budget, 60)
    const bed4 = (await t.bed('3A', '4')).id
    for (let i = 0; i < 2; i++) {
      const r = await t.json(`/api/admissions/${bed4}/entries`, { direction: 'in', category: 'water', volume_ml: 100, source: 'manual' })
      assert.equal(r.status, 201)
    }
    const read = await t.photo((await t.bed('HDU', '1')).id)
    assert.equal(read.status, 200)
    assert.equal(t.u.requests.length, 3)
    const { status, text } = await t.metrics()
    assert.equal(status, 200)
    const m = parse(text)
    assert.deepEqual(
      m.requests.find((r) => r.method === 'POST' && r.route === '/api/admissions/:id/entries'),
      { method: 'POST', route: '/api/admissions/:id/entries', status: 201, count: 2 },
    )
    const lat = m.latency_ms.find((l) => l.method === 'POST' && l.route === '/api/admissions/:id/entries')!
    assert.ok(lat.p50 >= 0 && lat.p95 >= lat.p50)
    assert.deepEqual(m.model_budget, { cap: 120, used: 63, held: 0, remaining: { critical: 57, routine: 21 } })
    assert.equal(m.model_actions.critical.admitted, 1)
    assert.ok(m.store.bytes > 0)
    assert.deepEqual(Object.keys(m.media).sort(), ['bytes', 'count'])
  })

  it('[server/metrics] Operational metrics: Refusals counted', async () => {
    const t = await setup()
    useBudget(t.budget, 83)
    const bed4 = (await t.bed('3A', '4')).id
    const first = await t.photo(bed4)
    assert.equal(first.status, 200)
    assert.equal(((await first.json()) as { mode: string }).mode, 'spark')
    assert.deepEqual(t.u.requests, ['spark:object'])
    const second = await t.photo(bed4)
    assert.equal(second.status, 429)
    assert.equal(t.u.requests.length, 1)
    const m = parse((await t.metrics()).text)
    assert.equal(m.model_actions.routine.downgraded, 1)
    assert.equal(m.model_actions.routine.refused, 1)
  })

  it('[server/metrics] Operational metrics: Downgrades of both kinds', async () => {
    const rice = {
      dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'half' }],
      eaten: 'half',
      fluids: [],
      confidence: 0.9,
      issues: [],
      notes: null,
    }
    const t = await setup((body) =>
      resp('muse-spark-1.3', [msg(JSON.stringify(JSON.stringify(body).includes('dish_kind') ? rice : reading()))]),
    )
    useBudget(t.budget, 60)
    const bed4 = (await t.bed('3A', '4')).id
    const photoBefore = t.u.requests.length
    const read = await t.photo(bed4)
    assert.equal(t.u.requests.length - photoBefore, 1)
    assert.equal(read.status, 200)
    const b1 = (await t.bed('5B', '1')).id
    await t.store.setCare(b1, 'acuity', { level: 'watch' }, ANITA)
    await t.keep(b1, { kind: 'photo', mime: 'image/png', bytes: png(1000, 800, 1), served_meal: 'lunch' }, ANITA)
    useBudget(t.budget, 80 - (t.budget.stats().lastHour + t.budget.stats().held))
    const trayBefore = t.u.requests.length
    const tray = await t.upload('/api/ai/meal', {
      image: new File([png(1000, 800, 2)], 'tray.png', { type: 'image/png' }),
      mode: 'sam+spark',
      admission_id: String(b1),
      meal: 'lunch',
    })
    assert.equal(tray.status, 200)
    assert.equal(t.u.requests.length - trayBefore, 3)
    const m = parse((await t.metrics()).text)
    assert.equal(m.model_actions.routine.admitted, 2)
    assert.equal(m.model_actions.routine.downgraded, 2)
  })

  it('[server/metrics] Metrics are for the matron: Not the matron', async () => {
    const t = await setup()
    const none = await t.request('/api/metrics', {}, { cookie: '' })
    const nurse = await t.request('/api/metrics', {}, { staff: ANITA })
    assert.deepEqual([none.status, await none.json()], [401, { error: 'sign_in_required' }])
    assert.deepEqual([nurse.status, await nurse.json()], [403, { error: 'forbidden' }])
  })

  it('[server/metrics] Metrics hold no patient data: Nothing identifying', async () => {
    const t = await setup()
    const grace = await t.bed('2C', '2')
    assert.equal(grace.patient, 'Grace Okafor')
    const saved = await t.json(`/api/admissions/${grace.id}/entries`, {
      direction: 'in',
      category: 'water',
      volume_ml: 150,
      source: 'manual',
      notes: 'felt dizzy after tea',
    })
    assert.equal(saved.status, 201)
    assert.equal((await t.request(`/api/beds/${grace.qr_token}`, {}, { staff: ANITA })).status, 200)
    assert.equal((await t.request(`/api/admissions/${grace.id}/nothing-here`, {}, { staff: ANITA })).status, 404)
    const voice = await t.upload('/api/ai/voice-note', {
      audio: new File([silenceWav()], 'a.wav', { type: 'audio/wav' }),
      admission_id: String(grace.id),
    })
    assert.equal(voice.status, 200)
    const { status, text } = await t.metrics()
    assert.equal(status, 200)
    for (const secret of ['Grace Okafor', 'AT-100212', grace.qr_token, 'felt dizzy', 'coconut water', `/${grace.id}/`]) {
      assert.ok(!text.includes(secret), secret)
    }
    const m = parse(text)
    assert.ok(m.requests.some((r) => r.method === 'GET' && r.route === '/api/beds/:token' && r.status === 200))
    assert.ok(m.requests.some((r) => r.method === 'GET' && r.route === 'unmatched' && r.status === 404))
  })
})
