import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  Entry,
  EntryEvent,
  EntryInput,
  EntryList,
  Explanation,
  HospitalSummary,
  LevelResult,
} from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { msg, resp, testApp, testDb, testStore, upstream } from './testing.ts'

const HOUR = 3_600_000

async function setup(store?: Store) {
  const clock = { t: Date.UTC(2026, 10, 2, 12) }
  const s = store ?? (await testStore(() => clock.t))
  const u = upstream()
  const app = await testApp({ ai: u.ai, store: s })
  const json = async <T>(path: string, init?: { method?: string; body?: unknown }) => {
    const res = await app.request(path, {
      method: init?.method ?? 'GET',
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
    })
    return { status: res.status, body: (await res.json()) as T }
  }
  /** Beds default to ward 5B, the story ward. */
  const bed = async (n: string, ward = '5B') =>
    (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.bed === n && a.ward_code === ward)!
  const add = (id: number, e: Partial<EntryInput>) =>
    json<Entry>(`/api/admissions/${id}/entries`, {
      method: 'POST',
      body: { direction: 'in', category: 'water', volume_ml: 200, source: 'manual', ...e },
    })
  const review = (id: number, body: object) => json<Entry & { error?: string }>(`/api/entries/${id}/review`, { method: 'POST', body })
  return { clock, store: s, u, app, json, bed, add, review }
}

describe('charting', () => {
  it('[charting/entries] Persistent store: Restart keeps entries', async () => {
    const h = await testDb()
    const a = await setup(await openPgStore(h.db))
    const id = (await a.bed('1')).id
    assert.equal((await a.add(id, { volume_ml: 200 })).status, 201)
    await a.store.close()
    const b = await setup(await openPgStore(h.db))
    const list = await b.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(
      list.body.entries.map((e) => [e.category, e.volume_ml]),
      [['water', 200]],
    )
    await b.store.close()
  })

  it('[charting/wards] Demo hospital: Fresh store', async () => {
    const { json, u } = await setup()
    const wards = await json<HospitalSummary>('/api/wards')
    const res = await json<AdmissionSummary[]>('/api/admissions')
    assert.equal(wards.status, 200)
    assert.equal(res.status, 200)
    assert.equal(wards.body.hospital, 'Meniscus Demo Hospital')
    assert.deepEqual(
      wards.body.wards.map((w) => [w.code, w.capacity, w.occupied]),
      [
        ['2C', 6, 5],
        ['3A', 8, 7],
        ['5B', 6, 6],
        ['HDU', 4, 3],
      ],
    )
    assert.equal(res.body.length, 21)
    assert.equal(new Set(res.body.map((a) => a.qr_token)).size, 21)
    assert.equal(new Set(res.body.map((a) => a.mrn)).size, 21)
    assert.ok(res.body.every((a) => a.qr_token.length >= 22 && a.pending === 0 && a.mrn.length > 0))
    assert.deepEqual(Object.keys(res.body[0]!).sort(), [
      'acuity',
      'admitted_at',
      'alerts',
      'bag_levels',
      'bed',
      'care',
      'devices',
      'hourly',
      'id',
      'mrn',
      'nutrition',
      'patient',
      'pending',
      'qr_token',
      'totals',
      'urine_seen',
      'ward_code',
      'ward_id',
      'ward_name',
      'weight_kg',
    ])
    assert.ok(res.body.every((a) => a.urine_seen === null))
    assert.deepEqual(u.requests, [])
  })

  it('[charting/wards] Demo hospital: Seeding happens once', async () => {
    const h = await testDb()
    const first = await openPgStore(h.db)
    const tokens = (await first.admissions()).map((a) => a.qr_token)
    await first.close()
    const second = await openPgStore(h.db)
    assert.equal(tokens.length, 21)
    assert.deepEqual(
      (await second.admissions()).map((a) => a.qr_token),
      tokens,
    )
    await second.close()
  })

  it('[charting/wards] Ward summary: Pending entry on 5B', async () => {
    const { json, bed, add, u } = await setup()
    const entry = (await add((await bed('1')).id, { volume_ml: 200 })).body
    const { body } = await json<HospitalSummary>('/api/wards')
    for (const w of body.wards) {
      if (w.code === '5B') {
        assert.equal(w.pending, 1)
        assert.equal(w.last_entry_at, entry.created_at)
      } else {
        assert.equal(w.pending, 0)
        assert.equal(w.last_entry_at, null)
      }
    }
    assert.deepEqual(u.requests, [])
  })

  it('[charting/wards] Ward summary: Bed with a prompt', async () => {
    const { json, bed, add, review } = await setup()
    const r = await add((await bed('2')).id, { category: 'iv', volume_ml: 2000 })
    await review(r.body.id, { action: 'approve' })
    const { body } = await json<HospitalSummary>('/api/wards')
    assert.deepEqual(
      body.wards.map((w) => [w.code, w.beds_with_alerts]),
      [
        ['2C', 0],
        ['3A', 0],
        ['5B', 1],
        ['HDU', 0],
      ],
    )
  })

  it('[charting/wards] Ward summary: Worst prompt tone', async () => {
    const { json, bed, add, review, store, u } = await setup()
    const r = await add((await bed('2')).id, { category: 'iv', volume_ml: 2000 })
    await review(r.body.id, { action: 'approve' })
    const tones = async () => (await json<HospitalSummary>('/api/wards')).body.wards.map((w) => [w.code, w.worst_tone])
    assert.deepEqual(await tones(), [
      ['2C', null],
      ['3A', null],
      ['5B', 'warn'],
      ['HDU', null],
    ])
    const b3 = (await bed('3')).id
    await store.setCare(b3, 'nil_by_mouth', {}, 6)
    const w = await add(b3, { volume_ml: 100 })
    await review(w.body.id, { action: 'approve' })
    assert.equal((await tones()).find(([c]) => c === '5B')![1], 'danger')
    assert.deepEqual(u.requests, [])
  })

  it('[charting/wards] Ward summary: Hourly sums', async () => {
    const { json, bed, add, review, u } = await setup()
    const a = await add((await bed('1')).id, { volume_ml: 200 })
    await review(a.body.id, { action: 'approve' })
    const b = await add((await bed('2')).id, { direction: 'out', category: 'urine', volume_ml: 300 })
    await review(b.body.id, { action: 'approve' })
    const { body } = await json<HospitalSummary>('/api/wards')
    for (const w of body.wards) {
      assert.equal(w.hourly?.in_ml.length, 24)
      assert.equal(w.hourly?.out_ml.length, 24)
      if (w.code === '5B') {
        assert.equal(w.hourly.in_ml[23], 200)
        assert.equal(w.hourly.out_ml[23], 300)
        assert.equal(
          w.hourly.in_ml.slice(0, 23).reduce((x, y) => x + y, 0),
          0,
        )
      } else {
        assert.deepEqual([...w.hourly.in_ml, ...w.hourly.out_ml], Array(48).fill(0))
      }
    }
    assert.deepEqual(u.requests, [])
  })

  it('[charting/wards] Admissions by ward: One ward', async () => {
    const { json } = await setup()
    const b5 = (await json<HospitalSummary>('/api/wards')).body.wards.find((w) => w.code === '5B')!
    const res = await json<AdmissionSummary[]>(`/api/admissions?ward=${b5.id}`)
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.map((a) => a.bed),
      ['1', '2', '3', '4', '5', '6'],
    )
    assert.ok(res.body.every((a) => a.ward_code === '5B'))
  })

  it('[charting/wards] Admissions by ward: Whole hospital', async () => {
    const { json } = await setup()
    const res = await json<AdmissionSummary[]>('/api/admissions')
    assert.equal(res.status, 200)
    assert.equal(res.body.length, 21)
    assert.equal(res.body[0]!.ward_code, '2C')
    assert.equal(res.body.at(-1)!.ward_code, 'HDU')
  })

  it('[charting/wards] Admissions by ward: Unknown ward', async () => {
    const { json } = await setup()
    for (const q of ['999', 'abc']) {
      const res = await json<{ error: string }>(`/api/admissions?ward=${q}`)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
  })

  it('[charting/wards] Admissions carry their ward: Bed lookup', async () => {
    const { json, bed } = await setup()
    const res = await json<AdmissionSummary>(`/api/beds/${(await bed('4')).qr_token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.bed, '4')
    assert.equal(res.body.ward_code, '5B')
    assert.equal(res.body.ward_name, 'Neurology Ward 5B')
    assert.ok(res.body.mrn.length > 0)
    const list = await json<EntryList>(`/api/admissions/${res.body.id}/entries`)
    assert.equal(list.body.admission.ward_code, '5B')
    assert.equal(list.body.admission.mrn, res.body.mrn)
  })

  it('[charting/entries] Bed QR lookup: Known token', async () => {
    const { json, bed } = await setup()
    const b4 = await bed('4')
    const res = await json<AdmissionSummary>(`/api/beds/${b4.qr_token}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.bed, '4')
  })

  it('[charting/entries] Bed QR lookup: Unknown token', async () => {
    const { json } = await setup()
    const res = await json<{ error: string }>('/api/beds/nope')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'not_found')
  })

  it('[charting/entries] Recorded volume kept: Corrected on approval', async () => {
    const { bed, add, review, json } = await setup()
    const id = (await bed('2')).id
    const e = await add(id, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo' })
    assert.equal(e.body.recorded_ml, 450)
    const r = await review(e.body.id, { action: 'approve', volume_ml: 400 })
    assert.equal(r.body.volume_ml, 400)
    assert.equal(r.body.recorded_ml, 450)
    const list = await json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual([list.body.entries[0]!.volume_ml, list.body.entries[0]!.recorded_ml], [400, 450])
  })

  it('[charting/entries] Record an entry: Confirmed photo draft', async () => {
    const { bed, add, u } = await setup()
    const res = await add((await bed('1')).id, { item: 'coconut water', source: 'voice' })
    assert.equal(res.status, 201)
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.volume_ml, 200)
    assert.equal(res.body.item, 'coconut water')
    assert.ok(res.body.id > 0)
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Record an entry: Invalid entries', async () => {
    const { bed, add, json } = await setup()
    const id = (await bed('1')).id
    for (const bad of [
      { direction: 'in', category: 'urine' },
      { direction: 'out', category: 'urine', volume_ml: 0 },
      { volume_ml: 5001 },
      { volume_ml: 12.5 },
    ] as Partial<EntryInput>[]) {
      const res = await add(id, bad)
      assert.equal(res.status, 400, JSON.stringify(bad))
      assert.equal((res.body as unknown as { error: string }).error, 'invalid_request')
    }
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.length, 0)
  })

  it('[charting/entries] Record an entry: Unknown admission', async () => {
    const { add } = await setup()
    const res = await add(999, {})
    assert.equal(res.status, 404)
    assert.equal((res.body as unknown as { error: string }).error, 'not_found')
  })

  it('[charting/entries] 24-hour totals: Mixed entries', async () => {
    const { clock, bed, add, review, json } = await setup()
    const id = (await bed('1')).id
    const old = await add(id, { volume_ml: 1000 })
    await review(old.body.id, { action: 'approve' })
    clock.t += 25 * HOUR
    const water = await add(id, { volume_ml: 500 })
    await review(water.body.id, { action: 'approve' })
    clock.t += 1000
    const urine = await add(id, { direction: 'out', category: 'urine', volume_ml: 300 })
    await review(urine.body.id, { action: 'approve' })
    clock.t += 1000
    const rejected = await add(id, { volume_ml: 900 })
    await review(rejected.body.id, { action: 'reject' })
    clock.t += 1000
    const tea = await add(id, { volume_ml: 200, item: 'tea' })

    const list = await json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(list.body.totals, { in_ml: 500, out_ml: 300, balance_ml: 200, pending_ml: 200 })
    assert.equal(list.body.entries[0]!.id, tea.body.id)
    assert.equal(list.body.entries.length, 5)

    const ward = await json<AdmissionSummary[]>('/api/admissions')
    const b1 = ward.body.find((a) => a.id === id)!
    assert.deepEqual(b1.totals, list.body.totals)
    assert.equal(b1.pending, 1)
  })

  it('[charting/entries] Hourly series: Three entries', async () => {
    const { clock, bed, add, review, json, u } = await setup()
    const id = (await bed('1')).id
    const T = clock.t
    const at = async (minutesAgo: number, e: Partial<EntryInput>, approve: boolean) => {
      clock.t = T - minutesAgo * 60_000
      const r = await add(id, e)
      if (approve) await review(r.body.id, { action: 'approve' })
    }
    await at(25 * 60, { volume_ml: 500 }, true)
    await at(5.5 * 60, { direction: 'out', category: 'urine', volume_ml: 400 }, true)
    await at(30, { volume_ml: 300 }, true)
    await at(10, { volume_ml: 200, item: 'tea' }, false)
    clock.t = T

    const b1 = (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.id === id)!
    const only = (i: number, v: number) => Array.from({ length: 24 }, (_, j) => (j === i ? v : 0))
    assert.deepEqual(b1.hourly.in_ml, only(23, 300))
    assert.deepEqual(b1.hourly.out_ml, only(18, 400))
    assert.deepEqual(b1.hourly.in_logged, only(23, 2))
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Hourly series: Bucket edge', async () => {
    const { clock, bed, add, review, json, u } = await setup()
    const id = (await bed('1')).id
    const T = clock.t
    clock.t = T - 60 * 60_000
    await review((await add(id, { volume_ml: 250 })).body.id, { action: 'approve' })
    clock.t = T - 20 * 60_000
    await review((await add(id, { volume_ml: 100 })).body.id, { action: 'reject' })
    clock.t = T

    const { hourly } = (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.id === id)!
    assert.equal(hourly.in_ml[22], 250)
    assert.equal(hourly.in_ml[23], 0)
    assert.equal(hourly.in_logged[22], 1)
    assert.equal(hourly.in_logged[23], 0)
    assert.equal(
      hourly.in_ml.reduce((a, b) => a + b),
      250,
    )
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Nurse review: Approve with correction', async () => {
    const { bed, add, review } = await setup()
    const e = await add((await bed('2')).id, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo', confidence: 0.9 })
    const res = await review(e.body.id, { action: 'approve', volume_ml: 400 })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'approved')
    assert.equal(res.body.volume_ml, 400)
    assert.ok(res.body.reviewed_at)
  })

  it('[charting/entries] Nurse review: Review twice', async () => {
    const { bed, add, review, json } = await setup()
    const id = (await bed('2')).id
    const e = await add(id, { direction: 'out', category: 'urine', volume_ml: 450 })
    await review(e.body.id, { action: 'approve', volume_ml: 400 })
    const res = await review(e.body.id, { action: 'reject' })
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'not_pending')
    const stored = (await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!
    assert.equal(stored.status, 'approved')
    assert.equal(stored.volume_ml, 400)
  })

  it('[charting/entries] Nurse review: unknown entry is 404', async () => {
    const { review } = await setup()
    const res = await review(999, { action: 'approve' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'not_found')
  })
})

describe('alerts over HTTP', () => {
  const overload = async (t: Awaited<ReturnType<typeof setup>>) => {
    const id = (await t.bed('1')).id
    for (const e of [{ category: 'iv', volume_ml: 2500 } as const, { direction: 'out', category: 'urine', volume_ml: 800 } as const]) {
      const r = await t.add(id, e)
      await t.review(r.body.id, { action: 'approve' })
    }
    return id
  }

  it('[charting/alerts] Alerts on chart reads: Ward list', async () => {
    const t = await setup()
    const id = await overload(t)
    const ward = (await t.json<AdmissionSummary[]>('/api/admissions')).body
    for (const a of ward)
      assert.equal(
        a.alerts.some((x) => x.kind === 'overload'),
        a.id === id,
      )
    const list = (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body
    assert.ok(list.alerts.some((x) => x.kind === 'overload'))
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/alerts] Explain alerts: Explanation', async () => {
    const t = await setup()
    const sent: string[] = []
    const u = upstream({
      spark: (body) => {
        sent.push(JSON.stringify(body))
        return resp('muse-spark-1.3', [msg('Balance is +1700 mL from IV 2500 mL. Review fluid status.')])
      },
    })
    const app = await testApp({ ai: u.ai, store: t.store })
    const id = await overload(t)
    const res = await app.request('/api/ai/explain', {
      method: 'POST',
      body: JSON.stringify({ admission_id: id }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as Explanation
    assert.match(body.text, /Review fluid status/)
    assert.equal(u.requests.length, 1)
    assert.match(sent[0]!, /overload/)
    const a = (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.admission
    assert.ok(!sent[0]!.includes(a.patient), 'patient name sent upstream')
    assert.ok(!sent[0]!.includes(a.mrn), 'MRN sent upstream')
    assert.match(sent[0]!, /"store":false/)
  })

  it('[charting/alerts] Explain alerts: Nothing to explain', async () => {
    const t = await setup()
    const id = (await t.bed('2')).id
    const res = await t.app.request('/api/ai/explain', {
      method: 'POST',
      body: JSON.stringify({ admission_id: id }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { error: string }).error, 'no_alerts')
    assert.deepEqual(t.u.requests, [])
    const missing = await t.app.request('/api/ai/explain', {
      method: 'POST',
      body: JSON.stringify({ admission_id: 999 }),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(missing.status, 404)
  })
})

describe('urine colour', () => {
  const urine = (over: Partial<EntryInput> = {}): Partial<EntryInput> => ({ direction: 'out', category: 'urine', volume_ml: 300, ...over })

  it('[charting/entries] Urine colour on the entry: Urine with its colour', async () => {
    const { bed, add, json, u } = await setup()
    const id = (await bed('1')).id
    const e = await add(id, urine({ urine_colour: 'dark', urine_rgb: '#c9952f' }))
    assert.equal(e.status, 201)
    const list = await json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual([list.body.entries[0]!.urine_colour, list.body.entries[0]!.urine_rgb], ['dark', '#c9952f'])
    const water = (await add(id, {})).body
    assert.deepEqual([water.urine_colour, water.urine_rgb], [null, null])
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Urine colour on the entry: Misplaced colour', async () => {
    const { bed, add, json, u } = await setup()
    const id = (await bed('1')).id
    for (const body of [
      { urine_colour: 'yellow' },
      urine({ urine_rgb: '#c9952f' }),
      urine({ urine_colour: 'dark', urine_rgb: '#fff' }),
      { ...urine(), urine_colour: 'green' },
    ] as object[]) {
      const r = await add(id, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal((r.body as unknown as { error: string }).error, 'invalid_request')
    }
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.length, 0)
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Latest urine colour: Newest colour wins', async () => {
    const { clock, bed, add, review, json, u } = await setup()
    const id = (await bed('1')).id
    clock.t = Date.UTC(2026, 10, 2, 8)
    const yellow = await add(id, urine({ urine_colour: 'yellow' }))
    await review(yellow.body.id, { action: 'approve' })
    clock.t = Date.UTC(2026, 10, 2, 12)
    await add(id, urine({ urine_colour: 'dark', urine_rgb: '#c9952f' }))
    clock.t = Date.UTC(2026, 10, 2, 13)
    const red = await add(id, urine({ urine_colour: 'red' }))
    await review(red.body.id, { action: 'reject' })
    const want = { colour: 'dark', rgb: '#c9952f', charted_at: new Date(Date.UTC(2026, 10, 2, 12)).toISOString(), status: 'pending' }
    assert.deepEqual((await json<EntryList>(`/api/admissions/${id}/entries`)).body.urine_seen, want)
    const ward = await json<AdmissionSummary[]>('/api/admissions')
    assert.deepEqual(ward.body.find((a) => a.id === id)!.urine_seen, want)
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Latest urine colour: No colour today', async () => {
    const { clock, bed, add, review, json } = await setup()
    const id = (await bed('1')).id
    const old = await add(id, urine({ urine_colour: 'dark' }))
    await review(old.body.id, { action: 'approve' })
    await add(id, urine())
    clock.t += 25 * HOUR
    await add(id, urine())
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.urine_seen, null)
  })
})

describe('drink consistency', () => {
  it('[charting/entries] Drink consistency on the entry: Mildly thick drink', async () => {
    const { bed, add, json, u } = await setup()
    const id = (await bed('6')).id
    const r = await add(id, { direction: 'in', category: 'water', volume_ml: 150, source: 'manual', iddsi_level: 2 })
    assert.equal(r.status, 201)
    assert.equal(r.body.iddsi_level, 2)
    const list = await json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(
      list.body.entries.map((e) => [e.id, e.iddsi_level]),
      [[r.body.id, 2]],
    )
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Drink consistency on the entry: No consistency given', async () => {
    const { bed, add, json } = await setup()
    const id = (await bed('6')).id
    const r = await add(id, { volume_ml: 200 })
    assert.equal(r.status, 201)
    assert.equal(r.body.iddsi_level, null)
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!.iddsi_level, null)
  })

  it('[charting/entries] Drink consistency on the entry: Misplaced consistency', async () => {
    const { bed, add, json, u } = await setup()
    const id = (await bed('6')).id
    for (const body of [
      { category: 'food', volume_ml: 150, iddsi_level: 2 },
      { direction: 'out', category: 'urine', volume_ml: 300, iddsi_level: 0 },
      { iddsi_level: 5 },
      { iddsi_level: 1.5 },
    ] as Partial<EntryInput>[]) {
      const r = await add(id, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal((r.body as unknown as { error: string }).error, 'invalid_request')
    }
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.length, 0)
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Drink consistency on the entry: Amended to food', async () => {
    const { bed, add, review, json, u } = await setup()
    const id = (await bed('6')).id
    const e = await add(id, { volume_ml: 150, iddsi_level: 2 })
    await review(e.body.id, { action: 'approve' })
    const r = await json<Entry>(`/api/entries/${e.body.id}/amend`, { method: 'POST', body: { category: 'food', reason: 'it was soup' } })
    assert.equal(r.status, 200)
    assert.deepEqual([r.body.category, r.body.iddsi_level], ['food', null])
    const last = (await json<EntryEvent[]>(`/api/entries/${e.body.id}/events`)).body.at(-1)!
    assert.deepEqual([last.kind, last.from_iddsi, last.to_iddsi], ['amended', 2, null])
    assert.deepEqual(u.requests, [])
  })
})

describe('drink kind', () => {
  it('[charting/entries] Drink kind on the entry: Tea posted', async () => {
    const h = await testDb()
    const { bed, add, json, u, store } = await setup(await openPgStore(h.db))
    const id = (await bed('1')).id
    const r = await add(id, { direction: 'in', category: 'water', volume_ml: 200, item: 'masala chai', drink: 'tea', source: 'photo' })
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.drink, r.body.item], ['tea', 'masala chai'])
    const listed = (await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === r.body.id)!
    assert.equal(listed.drink, 'tea')
    assert.deepEqual(u.requests, [])
    await store.close()
    const again = await setup(await openPgStore(h.db))
    const after = (await again.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === r.body.id)!
    assert.deepEqual([after.drink, after.item], ['tea', 'masala chai'])
    await again.store.close()
  })

  it('[charting/entries] Drink kind on the entry: No kind given', async () => {
    const { bed, add, json } = await setup()
    const id = (await bed('1')).id
    const r = await add(id, { volume_ml: 200 })
    assert.equal(r.status, 201)
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!.drink, null)
  })

  it('[charting/entries] Drink kind on the entry: Jug drop', async () => {
    const { bed, json, u } = await setup()
    const id = (await bed('1')).id
    const post = (volume_ml: number) =>
      json<LevelResult>(`/api/admissions/${id}/levels`, { method: 'POST', body: { container: 'water_jug', volume_ml, source: 'manual' } })
    await post(1000)
    const r = await post(600)
    assert.equal(r.status, 201)
    assert.deepEqual([r.body.entry?.volume_ml, r.body.entry?.drink], [400, 'water'])
    const listed = (await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === r.body.entry!.id)!
    assert.equal(listed.drink, 'water')
    assert.deepEqual(u.requests, [])
  })

  it('[charting/entries] Drink kind on the entry: Misplaced kind', async () => {
    const { bed, add, json, u } = await setup()
    const id = (await bed('1')).id
    for (const body of [
      { direction: 'out', category: 'urine', volume_ml: 300, drink: 'tea' },
      { drink: 'lassi' },
      { drink: 'urine' },
      { drink: 'none' },
    ] as unknown as Partial<EntryInput>[]) {
      const r = await add(id, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      assert.equal((r.body as unknown as { error: string }).error, 'invalid_request')
    }
    assert.equal((await json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.length, 0)
    assert.deepEqual(u.requests, [])
  })
})
