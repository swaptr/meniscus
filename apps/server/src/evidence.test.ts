import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdmissionSummary, Entry, EntryList, Level, LevelResult, PhotoEvidence } from '@meniscus/shared'
import { MealEvidenceSchema } from './routes/evidence.ts'
import { sniff } from './routes/validate.ts'
import { jpeg, reading, testApp, testStore, upstream } from './testing.ts'

/** Synthetic PNG: the signature and an IHDR tag, no image. */
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

async function setup() {
  const clock = { t: Date.UTC(2026, 10, 2, 12) }
  const store = await testStore(() => clock.t)
  const u = upstream()
  const app = await testApp({ ai: u.ai, store })
  const json = async <T>(path: string, body?: unknown) => {
    const res = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    })
    return { status: res.status, body: (await res.json()) as T }
  }
  const bed1 = async () => (await json<AdmissionSummary[]>('/api/admissions')).body[0]!.id
  const photo = (entryId: number, bytes: Uint8Array<ArrayBuffer> = jpeg, type = 'image/jpeg') => {
    const form = new FormData()
    form.set('image', new File([bytes], 'p', { type }))
    return app.request(`/api/entries/${entryId}/photo`, { method: 'POST', body: form })
  }
  const level = (id: number, container: string, volume_ml: number) =>
    json<LevelResult>(`/api/admissions/${id}/levels`, { container, volume_ml, source: 'photo' })
  return { clock, u, app, json, bed1, photo, level }
}

const newEntry = async (t: Awaited<ReturnType<typeof setup>>) => {
  const id = await t.bed1()
  const e = await t.json<Entry>(`/api/admissions/${id}/entries`, {
    direction: 'out',
    category: 'urine',
    volume_ml: 450,
    source: 'photo',
  })
  return { admissionId: id, entry: e.body }
}

describe('photo evidence', () => {
  it('[charting/photo-evidence] Attach a photo: Photo of a pending entry', async () => {
    const t = await setup()
    const { admissionId, entry } = await newEntry(t)
    assert.equal(entry.has_photo, false)
    assert.equal((await t.photo(entry.id)).status, 201)
    const list = await t.json<EntryList>(`/api/admissions/${admissionId}/entries`)
    assert.equal(list.body.entries[0]!.has_photo, true)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Attach a photo: Second photo', async () => {
    const t = await setup()
    const { entry } = await newEntry(t)
    await t.photo(entry.id)
    const res = await t.photo(entry.id)
    assert.equal(res.status, 409)
    assert.equal(((await res.json()) as { error: string }).error, 'photo_exists')
  })

  it('[charting/photo-evidence] Attach a photo: Not an image', async () => {
    const t = await setup()
    const { entry } = await newEntry(t)
    const res = await t.photo(entry.id, new TextEncoder().encode('hello'))
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_request')
  })

  it('[charting/photo-evidence] Attach a photo: reviewed or unknown entries', async () => {
    const t = await setup()
    const { entry } = await newEntry(t)
    await t.json(`/api/entries/${entry.id}/review`, { action: 'approve' })
    const reviewed = await t.photo(entry.id)
    assert.equal(reviewed.status, 409)
    assert.equal(((await reviewed.json()) as { error: string }).error, 'not_pending')
    assert.equal((await t.photo(999)).status, 404)
  })

  it('[charting/photo-evidence] Serve the photo: Stored photo', async () => {
    const t = await setup()
    const { entry } = await newEntry(t)
    await t.photo(entry.id)
    const res = await t.app.request(`/api/entries/${entry.id}/photo`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), jpeg)
    // Served with the type sniffed from the bytes, not the one the client declared.
    const second = (await newEntry(t)).entry
    assert.equal((await t.photo(second.id, png, 'image/png')).status, 201)
    const served = await t.app.request(`/api/entries/${second.id}/photo`)
    assert.equal(served.headers.get('content-type'), sniff('photo', png))
    assert.equal(served.headers.get('content-type'), 'image/png')
  })

  it('[charting/photo-evidence] Serve the photo: No photo', async () => {
    const t = await setup()
    const { entry } = await newEntry(t)
    const res = await t.app.request(`/api/entries/${entry.id}/photo`)
    assert.equal(res.status, 404)
    assert.equal(((await res.json()) as { error: string }).error, 'not_found')
  })

  it('[charting/photo-evidence] Rejected entries drop their photo: Reject', async () => {
    const t = await setup()
    const id = await t.bed1()
    const e = await t.json<Entry>(`/api/admissions/${id}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 450,
      source: 'photo',
      evidence: photoEvidence(),
    })
    await t.photo(e.body.id)
    const rejected = await t.json<Entry>(`/api/entries/${e.body.id}/review`, { action: 'reject' })
    assert.equal(rejected.body.has_photo, false)
    assert.equal(rejected.body.evidence, null)
    assert.equal((await t.app.request(`/api/entries/${e.body.id}/photo`)).status, 404)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.equal(list.body.entries[0]!.has_photo, false)
    assert.equal(list.body.entries[0]!.evidence, null)
  })
})

/** A read as the server emits it: three calls, SAM boxes, fill 0.463. */
const photoEvidence = (over: Partial<PhotoEvidence> = {}): PhotoEvidence => ({
  kind: 'photo',
  mode: 'sam+spark',
  reading: reading(),
  segmentation: {
    container: { left: 100, top: 80, right: 400, bottom: 900, confidence: 0.94 },
    fluid: { left: 110, top: 520, right: 390, bottom: 890, confidence: 0.91 },
    fill_fraction: 0.463,
  },
  review_reasons: [],
  trace: [
    { step: 'sam:container', model: 'sam-3.1', ms: 2100 },
    { step: 'sam:liquid', model: 'sam-3.1', ms: 2200 },
    { step: 'spark:read', model: 'muse-spark-1.3', ms: 4500, input_tokens: 1800, output_tokens: 120 },
  ],
  colour: '#d9b44a',
  ...over,
})

describe('read evidence', () => {
  const post = (t: Awaited<ReturnType<typeof setup>>, id: number, body: object) =>
    t.json<Entry & { error?: string }>(`/api/admissions/${id}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 450,
      source: 'photo',
      ...body,
    })

  it('[charting/photo-evidence] Read evidence stored with the entry: Photo evidence round trip', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence()
    const res = await post(t, id, { evidence: ev })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.evidence, ev)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(list.body.entries[0]!.evidence, ev)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: Masala chai photo', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ reading: reading({ container: 'cup', fluid: 'tea', drink_name: 'masala chai', appearance: null }) })
    const res = await post(t, id, { direction: 'in', category: 'water', volume_ml: 150, item: 'masala chai', evidence: ev })
    assert.equal(res.status, 201)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    const got = list.body.entries[0]!.evidence as PhotoEvidence
    assert.deepEqual(got, ev)
    assert.equal(got.reading.drink_name, 'masala chai')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: Evidence without a drink name', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence()
    assert.equal('drink_name' in ev.reading, false)
    const res = await post(t, id, { evidence: ev })
    assert.equal(res.status, 201)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(list.body.entries[0]!.evidence, ev)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: Drink name too long', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ reading: reading({ container: 'cup', fluid: 'tea', drink_name: 'x'.repeat(41) }) })
    const res = await post(t, id, { direction: 'in', category: 'water', volume_ml: 150, evidence: ev })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.equal(list.body.entries.length, 0)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/entries] Urine colour on the entry: Photo evidence with the colour', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ reading: reading({ urine_colour: 'dark', urine_rgb: '#c9952f' }) })
    const res = await post(t, id, { evidence: ev, urine_colour: 'dark', urine_rgb: '#c9952f' })
    assert.equal(res.status, 201)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(list.body.entries[0]!.evidence, ev)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: entries without evidence return null', async () => {
    const t = await setup()
    const id = await t.bed1()
    const res = await post(t, id, { source: 'manual' })
    assert.equal(res.body.evidence, null)
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: Level drop keeps evidence', async () => {
    const t = await setup()
    const id = await t.bed1()
    const first = photoEvidence({ reading: reading({ container: 'water_jug', fluid: 'water', volume_ml: 1000, capacity_ml: 1500 }) })
    const second = photoEvidence({ reading: reading({ container: 'water_jug', fluid: 'water', volume_ml: 600, capacity_ml: 1500 }) })
    const a = await t.json<LevelResult>(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 1000,
      source: 'photo',
      evidence: first,
    })
    assert.equal(a.body.entry, null)
    t.clock.t += 3_600_000
    const b = await t.json<LevelResult>(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 600,
      source: 'photo',
      evidence: second,
    })
    assert.equal(b.body.entry?.volume_ml, 400)
    assert.deepEqual(b.body.entry?.evidence, second)
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.equal(list.body.entries.length, 1)
    assert.deepEqual(list.body.entries[0]!.evidence, second)
    // The first level keeps its own evidence, returned as the entry's "before".
    assert.deepEqual(list.body.entries[0]!.levels?.before?.evidence, first)
    assert.deepEqual(b.body.entry?.levels?.before?.evidence, first)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: text at the size limits is saved', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({
      reading: reading({ reading_basis: 'b'.repeat(300), appearance: 'a'.repeat(200) }),
      review_reasons: ['r'.repeat(200)],
    })
    const res = await post(t, id, { evidence: ev })
    assert.equal(res.status, 201)
    assert.deepEqual(res.body.evidence, ev)
  })

  it('[capture/notes] Voice note timing: voice evidence keeps the turns', async () => {
    const t = await setup()
    const id = await t.bed1()
    const turns = [
      { start_ms: 0, end_ms: 1800, text: 'bed 4 had a coconut water' },
      { start_ms: 1900, end_ms: 4100, text: '200 mL' },
    ]
    const ev = { kind: 'voice', transcript: 'bed 4 had a coconut water 200 mL', draft_ml: 200, trace: [], duration_ms: 4200, turns }
    const voice = { direction: 'in', category: 'water', volume_ml: 200, source: 'voice' }
    const res = await post(t, id, { ...voice, evidence: ev })
    assert.equal(res.status, 201)
    assert.deepEqual((await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!.evidence, ev)
    const many = Array.from({ length: 201 }, (_, i) => ({ start_ms: i * 10, end_ms: i * 10 + 5, text: 'x' }))
    for (const bad of [{ turns: many }, { turns: [{ ...turns[0], text: 'x'.repeat(501) }] }, { duration_ms: 3_600_001 }]) {
      const r = await post(t, id, { ...voice, evidence: { ...ev, ...bad } })
      assert.equal(r.status, 400)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Read evidence stored with the entry: Malformed evidence', async () => {
    const t = await setup()
    const id = await t.bed1()
    const { reading: _omit, ...noReading } = photoEvidence()
    const bad = [
      { evidence: noReading },
      { evidence: photoEvidence({ colour: 'red' }) },
      { source: 'voice', evidence: { kind: 'voice', transcript: 'x'.repeat(2001), draft_ml: 200, trace: [] } },
      { evidence: { kind: 'voice', transcript: 'bed 1 200 mL', draft_ml: 200, trace: [] } },
      { source: 'manual', evidence: photoEvidence() },
    ]
    for (const body of bad) {
      const res = await post(t, id, body)
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80))
      assert.equal(res.body.error, 'invalid_request')
    }
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.equal(list.body.entries.length, 0)
  })
})

describe('level pairing', () => {
  it('[charting/level-pairing] Level drop becomes intake: Jug drops from 1000 to 600 mL', async () => {
    const t = await setup()
    const id = await t.bed1()
    await t.level(id, 'water_jug', 1000)
    t.clock.t += 3_600_000
    const res = await t.level(id, 'water_jug', 600)
    assert.equal(res.status, 201)
    assert.equal(res.body.previous_ml, 1000)
    const e = res.body.entry!
    assert.deepEqual([e.direction, e.category, e.volume_ml, e.status], ['in', 'water', 400, 'pending'])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/level-pairing] Refill resets the baseline: First reading and refill', async () => {
    const t = await setup()
    const id = await t.bed1()
    const first = await t.level(id, 'water_jug', 600)
    const refill = await t.level(id, 'water_jug', 1000)
    assert.deepEqual([first.status, first.body.entry], [201, null])
    assert.deepEqual([refill.status, refill.body.entry], [201, null])
  })

  it('[charting/level-pairing] Refill resets the baseline: Containers are separate', async () => {
    const t = await setup()
    const id = await t.bed1()
    await t.level(id, 'water_jug', 1000)
    assert.equal((await t.level(id, 'water_bottle', 500)).body.entry, null)
  })

  it('[charting/level-pairing] Refill resets the baseline: stale baseline older than 24 h is ignored', async () => {
    const t = await setup()
    const id = await t.bed1()
    await t.level(id, 'water_jug', 1000)
    t.clock.t += 25 * 3_600_000
    assert.equal((await t.level(id, 'water_jug', 600)).body.entry, null)
  })

  it('[charting/level-pairing] Latest levels: Two readings', async () => {
    const t = await setup()
    const id = await t.bed1()
    await t.level(id, 'water_jug', 1000)
    t.clock.t += 1000
    await t.level(id, 'water_jug', 600)
    const res = await t.json<Level[]>(`/api/admissions/${id}/levels`)
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.map((l) => [l.container, l.volume_ml]),
      [['water_jug', 600]],
    )
  })

  it('[charting/level-pairing] Level drop becomes intake: invalid level is rejected', async () => {
    const t = await setup()
    const id = await t.bed1()
    assert.equal((await t.level(id, 'urinal', 500)).status, 400)
    assert.equal((await t.level(id, 'water_jug', -1)).status, 400)
    assert.equal((await t.level(999, 'water_jug', 500)).status, 404)
  })
})

describe('tray evidence bounds', () => {
  const mask = { width: 32, height: 32, bits: Buffer.alloc(128).toString('base64') }
  const region = (index: number) => ({ index, box: { left: 0, top: 0, right: 10, bottom: 10 }, coverage: 0.5, mask, food: mask })
  const step = { step: 'sam:dish', model: 'sam-3.1', ms: 900 }
  const evidence = (over: Record<string, unknown> = {}, dish: Record<string, unknown> = {}) => ({
    mode: 'sam+spark',
    image_sha256: 'a'.repeat(64),
    reading: {
      items: [{ name: 'rice', portion: 50 }],
      dishes: [
        {
          index: 1,
          name: 'rice',
          dish_kind: 'rice',
          portion: 50,
          basis: 'model',
          box: region(1).box,
          coverage: 0.5,
          model_portion: 50,
          measure: null,
          ...dish,
        },
      ],
      portion: 50,
      fluids: [{ index: 0, name: 'tea', fluid_kind: 'tea', volume_ml: 150 }],
      confidence: 0.8,
      issues: [],
      notes: null,
    },
    segmentation: { regions: Array.from({ length: 12 }, (_, i) => region(i + 1)), loose_food: 0 },
    warnings: Array.from({ length: 6 }, () => 'w'.repeat(200)),
    trace: [step, { ...step, step: 'sam:food' }, { ...step, step: 'spark:meal' }],
    ...over,
  })
  const ok = (e: unknown) => MealEvidenceSchema.safeParse(e).success

  it('accepts a 3-step trace, 6 warnings of 200 characters and 12 regions', () => {
    assert.ok(ok(evidence()))
    assert.ok(ok(evidence({ segmentation: null, mode: 'spark', warnings: [] })))
  })

  it('accepts 5 steps and a measured dish with its measure (tray-comparison)', () => {
    assert.ok(ok(evidence({ trace: [step, step, step, step, step] })))
    assert.ok(ok(evidence({}, { basis: 'measured', measure: { served_index: 1, served_coverage: 0.8 } })))
  })

  it('refuses a 6th step, a 7th warning, a 201-character warning, an unknown basis, a measured dish without a measure and a malformed hash', () => {
    assert.ok(!ok(evidence({ trace: [step, step, step, step, step, step] })))
    assert.ok(!ok(evidence({}, { basis: 'guessed' })))
    assert.ok(!ok(evidence({}, { basis: 'model', measure: { served_index: 1, served_coverage: 0.8 } })))
    assert.ok(!ok(evidence({ warnings: Array.from({ length: 7 }, () => 'w') })))
    assert.ok(!ok(evidence({ warnings: ['w'.repeat(201)] })))
    assert.ok(!ok(evidence({}, { basis: 'measured' })))
    for (const h of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), null]) assert.ok(!ok(evidence({ image_sha256: h })))
  })
})

describe('segmentation masks and region volume in evidence', () => {
  const post = (t: Awaited<ReturnType<typeof setup>>, id: number, evidence: object) =>
    t.json<Entry & { error?: string }>(`/api/admissions/${id}/entries`, {
      direction: 'out',
      category: 'urine',
      volume_ml: 450,
      source: 'photo',
      evidence,
    })
  /** A packed mask of w × h cells, every cell set. */
  const mask = (width: number, height: number) => ({
    width,
    height,
    bits: Buffer.alloc(Math.ceil((width * height) / 8), 0xff).toString('base64'),
  })
  const seg = (over: object) => ({ ...photoEvidence().segmentation!, ...over })
  const listed = async (t: Awaited<ReturnType<typeof setup>>, id: number) =>
    (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries

  it('[charting/photo-evidence] Segmentation masks in stored evidence: Masks round trip', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ segmentation: seg({ container_mask: mask(12, 32), fluid_mask: mask(24, 32) }) })
    const res = await post(t, id, ev)
    assert.equal(res.status, 201)
    assert.deepEqual((await listed(t, id))[0]!.evidence, ev)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Segmentation masks in stored evidence: Evidence without masks', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence()
    assert.equal(res201(await post(t, id, ev)), 201)
    const got = (await listed(t, id))[0]!.evidence as PhotoEvidence
    assert.deepEqual(got, ev)
    assert.equal('container_mask' in got.segmentation!, false)
    assert.equal('fluid_mask' in got.segmentation!, false)
  })

  it('[charting/photo-evidence] Segmentation masks in stored evidence: Malformed mask', async () => {
    const t = await setup()
    const id = await t.bed1()
    const wide = await post(t, id, photoEvidence({ segmentation: seg({ container_mask: mask(33, 10) }) }))
    const short = await post(
      t,
      id,
      photoEvidence({ segmentation: seg({ fluid_mask: { width: 24, height: 32, bits: mask(12, 32).bits } }) }),
    )
    for (const r of [wide, short]) {
      assert.equal(r.status, 400)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.equal((await listed(t, id)).length, 0)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Liquid region volume in stored evidence: Volume round trip', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ segmentation: seg({ fluid_volume_ml: 930 }) })
    assert.equal(ev.reading.capacity_ml, 2000)
    assert.equal(res201(await post(t, id, ev)), 201)
    const got = (await listed(t, id))[0]!.evidence as PhotoEvidence
    assert.equal(got.segmentation?.fluid_volume_ml, 930)
    assert.deepEqual(got, ev)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Liquid region volume in stored evidence: Null without a capacity', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence({ reading: reading({ capacity_ml: null }), segmentation: seg({ fluid_volume_ml: null }) })
    assert.equal(res201(await post(t, id, ev)), 201)
    assert.equal(((await listed(t, id))[0]!.evidence as PhotoEvidence).segmentation?.fluid_volume_ml, null)
  })

  it('[charting/photo-evidence] Liquid region volume in stored evidence: Evidence without a volume', async () => {
    const t = await setup()
    const id = await t.bed1()
    const ev = photoEvidence()
    assert.equal(res201(await post(t, id, ev)), 201)
    const got = (await listed(t, id))[0]!.evidence as PhotoEvidence
    assert.deepEqual(got, ev)
    assert.equal('fluid_volume_ml' in got.segmentation!, false)
  })

  it('[charting/photo-evidence] Liquid region volume in stored evidence: Volume that does not match the fill', async () => {
    const t = await setup()
    const id = await t.bed1()
    const off = await post(t, id, photoEvidence({ segmentation: seg({ fluid_volume_ml: 920 }) }))
    const noCap = await post(t, id, photoEvidence({ reading: reading({ capacity_ml: null }), segmentation: seg({ fluid_volume_ml: 930 }) }))
    for (const r of [off, noCap]) {
      assert.equal(r.status, 400)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.equal((await listed(t, id)).length, 0)
    assert.deepEqual(t.u.requests, [])
  })
})

const res201 = (r: { status: number }) => r.status
