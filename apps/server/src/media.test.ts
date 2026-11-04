import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import type { AdmissionSummary, BagReadingResult, Entry, EntryList, LevelResult, Meal, MediaRef, PhotoEvidence } from '@meniscus/shared'
import type { Store } from './store/port.ts'
import { openPgStore } from './store/pg/store.ts'
import { jpeg, reading, testApp, testDb, testStore, upstream } from './testing.ts'

const HOUR = 3_600_000
/** 2 Nov 2026, 09:00 UTC; demo patients are admitted two days earlier. */
const NOV2_9 = Date.UTC(2026, 10, 2, 9)

/** Synthetic media: file signatures plus filler, no real image or voice. */
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0, 0, 0])
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
/** An ISO-BMFF `ftyp` box: major brand, minor version 0, compatible brands. */
const ftyp = (major: string, ...compatible: string[]) =>
  new Uint8Array([0, 0, 0, 16 + 4 * compatible.length, ...new TextEncoder().encode(`ftyp${major}\0\0\0\0${compatible.join('')}`)])

async function setup(store?: Store) {
  const clock = { t: NOV2_9 - 48 * HOUR }
  const s = store ?? (await testStore(() => clock.t))
  clock.t = NOV2_9
  const u = upstream()
  const app = await testApp({ ai: u.ai, store: s })
  const json = async <T>(path: string, body?: unknown) => {
    const res = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    })
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (n: string) =>
    (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.bed === n && a.ward_code === '5B')!.id
  const upload = async (admissionId: number, bytes: Uint8Array<ArrayBuffer>, kind: string, extra: Record<string, string> = {}) => {
    const form = new FormData()
    form.set('file', new File([bytes], 'upload', { type: kind === 'voice' ? 'audio/webm' : 'image/jpeg' }))
    form.set('kind', kind)
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
    const res = await app.request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form })
    return { status: res.status, body: (await res.json()) as MediaRef & { error?: string } }
  }
  const get = (path: string) => app.request(path)
  const entry = (admissionId: number, body: object) =>
    json<Entry>(`/api/admissions/${admissionId}/entries`, { direction: 'out', category: 'urine', volume_ml: 300, source: 'photo', ...body })
  const voiceEntries = async (admissionId: number, mediaId: number) => [
    await entry(admissionId, { direction: 'in', category: 'water', volume_ml: 200, item: 'tea', source: 'voice', media_id: mediaId }),
    await entry(admissionId, { direction: 'out', category: 'urine', volume_ml: 300, source: 'voice', media_id: mediaId }),
  ]
  return { clock, u, app, store: s, json, bed, upload, get, entry, voiceEntries }
}

const bytesOf = async (res: Response) => new Uint8Array(await res.arrayBuffer())

describe('media', () => {
  it('[charting/media] Upload media: Voice recording', async () => {
    const t = await setup()
    const res = await t.upload(await t.bed('1'), webm, 'voice', { duration_ms: '4200' })
    assert.equal(res.status, 201)
    assert.deepEqual([res.body.kind, res.body.mime, res.body.duration_ms, res.body.size], ['voice', 'audio/webm', 4200, webm.length])
    assert.equal(res.body.created_at, new Date(NOV2_9).toISOString())
    assert.deepEqual(Object.keys(res.body).sort(), ['created_at', 'duration_ms', 'id', 'kind', 'mime', 'served_meal', 'sha256', 'size'])
    assert.equal(res.body.served_meal, null)
    assert.match(res.body.sha256!, /^[0-9a-f]{64}$/)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Media SHA-256 fingerprint: Fingerprint of the served bytes', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const up = await t.upload(id, jpeg, 'photo')
    assert.equal(up.status, 201)
    assert.equal(up.body.sha256, createHash('sha256').update(jpeg).digest('hex'))
    const e = await t.entry(id, { media_id: up.body.id })
    const served = await bytesOf(await t.get(`/api/media/${up.body.id}`))
    assert.equal(createHash('sha256').update(served).digest('hex'), up.body.sha256)
    assert.equal(e.body.media?.sha256, up.body.sha256)
    assert.equal(
      (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((x) => x.id === e.body.id)!.media?.sha256,
      up.body.sha256,
    )
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Upload media: Wrong file', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const asVoice = await t.upload(id, jpeg, 'voice')
    const text = await t.upload(id, new TextEncoder().encode('hello'), 'photo')
    const empty = await t.upload(id, new Uint8Array(0), 'photo')
    const unknownKind = await t.upload(id, jpeg, 'video')
    // An iPhone photo is an ISO-BMFF `ftyp` file too; its brand says image, so it is not a recording.
    const heicAsVoice = await t.upload(id, ftyp('heic', 'mif1', 'heic'), 'voice')
    for (const r of [asVoice, text, empty, unknownKind, heicAsVoice]) {
      assert.equal(r.status, 400)
      assert.equal(r.body.error, 'invalid_request')
    }
    assert.equal((await t.get('/api/media/1')).status, 404)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Upload media: MP4 brands', async () => {
    const t = await setup()
    const id = await t.bed('1')
    // Audio-plausible major brands (Safari and Chrome MediaRecorder write mp42/isom/iso*; .m4a files M4A).
    for (const brand of ['M4A ', 'M4B ', 'isom', 'iso2', 'iso5', 'iso6', 'mp41', 'mp42', 'dash']) {
      const res = await t.upload(id, ftyp(brand, 'isom', 'mp41'), 'voice')
      assert.equal(res.status, 201, brand)
      assert.equal(res.body.mime, 'audio/mp4', brand)
    }
    // Image and QuickTime brands are refused as voice, even with audio-looking compatible brands.
    for (const brand of ['heic', 'heix', 'mif1', 'msf1', 'avif', 'qt  ']) {
      const res = await t.upload(id, ftyp(brand, 'isom', 'mp42'), 'voice')
      assert.equal(res.status, 400, brand)
      assert.equal(res.body.error, 'invalid_request', brand)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Upload media: Unknown bed', async () => {
    const t = await setup()
    const res = await t.upload(9999, jpeg, 'photo')
    assert.equal(res.status, 404)
    assert.equal(res.body.error, 'not_found')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Upload media: Too large', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const big = new Uint8Array(9 * 1024 * 1024)
    big.set(jpeg)
    const over = await t.upload(id, big, 'photo')
    assert.equal(over.status, 400)
    assert.equal(over.body.error, 'invalid_request')
    const huge = new Uint8Array(30 * 1024 * 1024)
    huge.set(webm)
    const form = new FormData()
    form.set('file', new File([huge], 'upload', { type: 'audio/webm' }))
    form.set('kind', 'voice')
    const res = await t.app.request(`/api/admissions/${id}/media`, { method: 'POST', body: form })
    assert.equal(res.status, 413)
    assert.equal((await t.get('/api/media/1')).status, 404)
    assert.equal((await t.get('/api/media/2')).status, 404)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Link media to records: One recording, two entries', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const m = (await t.upload(id, webm, 'voice', { duration_ms: '4200' })).body
    const [tea, urine] = await t.voiceEntries(id, m.id)
    for (const e of [tea!, urine!]) {
      assert.equal(e.status, 201)
      assert.deepEqual(e.body.media, m)
      assert.equal(e.body.has_photo, false)
    }
    const list = await t.json<EntryList>(`/api/admissions/${id}/entries`)
    assert.deepEqual(
      list.body.entries.map((e) => e.media?.id),
      [m.id, m.id],
    )
    assert.deepEqual(t.u.requests, [])
  })

  it("[charting/media] Link media to records: Another bed's media", async () => {
    const t = await setup()
    const [b1, b2] = [await t.bed('1'), await t.bed('2')]
    const m = (await t.upload(b1, jpeg, 'photo')).body
    const res = await t.entry(b2, { media_id: m.id })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    assert.equal((await t.json<EntryList>(`/api/admissions/${b2}/entries`)).body.entries.length, 0)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Link media to records: Kind mismatch', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const voice = (await t.upload(id, webm, 'voice')).body
    const photo = (await t.upload(id, jpeg, 'photo')).body
    const bad = [
      { media_id: voice.id },
      { source: 'voice', media_id: photo.id },
      { source: 'manual', media_id: photo.id },
      { source: 'text', media_id: voice.id },
      { media_id: 9999 },
    ]
    for (const body of bad) {
      const res = await t.entry(id, body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.equal(res.body.error, 'invalid_request')
    }
    const level = await t.json(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 600,
      source: 'photo',
      media_id: voice.id,
    })
    assert.equal(level.status, 400)
    assert.equal((await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.length, 0)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Serve media: Recording served', async () => {
    const t = await setup()
    const m = (await t.upload(await t.bed('1'), webm, 'voice')).body
    const res = await t.get(`/api/media/${m.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'audio/webm')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await bytesOf(res), webm)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Serve media: No such media', async () => {
    const t = await setup()
    for (const path of ['/api/media/9999', '/api/media/abc']) {
      const res = await t.json(path)
      assert.equal(res.status, 404)
      assert.equal(res.body.error, 'not_found')
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Media goes with its record: Shared recording', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const m = (await t.upload(id, webm, 'voice')).body
    const [tea, urine] = await t.voiceEntries(id, m.id)
    const first = await t.json<Entry>(`/api/entries/${tea!.body.id}/review`, { action: 'reject', reason: 'duplicate' })
    assert.equal(first.body.media, null)
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 200)
    await t.json(`/api/entries/${urine!.body.id}/review`, { action: 'reject', reason: 'duplicate' })
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 404)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Media goes with its record: Voided tray', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const tray = (await t.upload(id, jpeg, 'photo')).body
    const meal = await t.json<Meal>(`/api/admissions/${id}/meals`, {
      meal: 'lunch',
      portion: 50,
      fluid_ml: 150,
      source: 'photo',
      media_id: tray.id,
    })
    assert.equal(meal.body.media?.id, tray.id)
    const voided = await t.json<Meal>(`/api/meals/${meal.body.id}/void`, { reason: 'wrong bed' })
    assert.equal(voided.status, 200)
    assert.equal(voided.body.media, null)
    assert.equal((await t.get(`/api/media/${tray.id}`)).status, 404)
    assert.equal((await t.json<Meal[]>(`/api/admissions/${id}/meals`)).body[0]!.media, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Unlinked media expires: Never saved', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const m = (await t.upload(id, jpeg, 'photo')).body
    t.clock.t = NOV2_9 + 24 * HOUR - 60_000
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 200)
    t.clock.t = NOV2_9 + 24 * HOUR + 60_000
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 404)
    // Too late to link, and the next upload deletes it.
    assert.equal((await t.entry(id, { media_id: m.id })).status, 400)
    const next = (await t.upload(id, jpeg, 'photo')).body
    assert.ok(next.id > m.id, 'ids are never reused')
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 404)
    assert.deepEqual(t.u.requests, [])

    // With no further upload, opening the store past the expiry deletes the row and its bytes; linked media stays.
    const h = await testDb()
    const clock = { t: NOV2_9 - 48 * HOUR }
    const f = await setup(await openPgStore(h.db, { now: () => clock.t }))
    clock.t = NOV2_9
    const fid = await f.bed('1')
    const unlinked = (await f.upload(fid, jpeg, 'photo')).body
    const linked = (await f.upload(fid, png, 'photo')).body
    assert.equal((await f.entry(fid, { media_id: linked.id })).status, 201)
    await f.store.close()
    const rows = async () => (await h.pg.query('SELECT id, size FROM meniscus.media ORDER BY id')).rows.map((r) => ({ ...(r as object) }))
    await (await openPgStore(h.db, { now: () => NOV2_9 + 24 * HOUR - 60_000 })).close()
    assert.deepEqual(await rows(), [
      { id: unlinked.id, size: jpeg.length },
      { id: linked.id, size: png.length },
    ])
    await (await openPgStore(h.db, { now: () => NOV2_9 + 24 * HOUR + 60_000 })).close()
    assert.deepEqual(await rows(), [{ id: linked.id, size: png.length }])
    assert.deepEqual(f.u.requests, [])
  })

  it('[charting/media] Unlinked media expires: linked media is kept', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const m = (await t.upload(id, jpeg, 'photo')).body
    await t.entry(id, { media_id: m.id })
    t.clock.t = NOV2_9 + 30 * HOUR
    await t.upload(id, png, 'photo')
    assert.equal((await t.get(`/api/media/${m.id}`)).status, 200)
  })

  it('[charting/media] Entry photo routes: Photo route on other sources', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const photoForm = () => {
      const form = new FormData()
      form.set('image', new File([jpeg], 'p', { type: 'image/jpeg' }))
      return form
    }
    const manual = (await t.entry(id, { direction: 'in', category: 'water', volume_ml: 200, source: 'manual' })).body
    const first = await t.app.request(`/api/entries/${manual.id}/photo`, { method: 'POST', body: photoForm() })
    assert.equal(first.status, 201)
    const list = (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries
    assert.equal(list.find((e) => e.id === manual.id)!.has_photo, true)

    const rec = (await t.upload(id, webm, 'voice')).body
    const [tea] = await t.voiceEntries(id, rec.id)
    const second = await t.app.request(`/api/entries/${tea!.body.id}/photo`, { method: 'POST', body: photoForm() })
    assert.equal(second.status, 409)
    assert.equal(((await second.json()) as { error: string }).error, 'photo_exists')
    const after = (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === tea!.body.id)!
    assert.deepEqual(after.media, rec)
    assert.equal((await t.get(`/api/entries/${tea!.body.id}/photo`)).status, 404)
    assert.deepEqual(t.u.requests, [])
  })
})

/** A jug read as the server emits it (synthetic). */
const jugEvidence = (ml: number): PhotoEvidence => ({
  kind: 'photo',
  mode: 'sam+spark',
  reading: reading({ container: 'water_jug', fluid: 'water', volume_ml: ml, capacity_ml: 1500, appearance: null }),
  segmentation: {
    container: { left: 200, top: 100, right: 700, bottom: 1100 },
    fluid: { left: 210, top: Math.round(1100 - (ml / 1500) * 1000), right: 690, bottom: 1090 },
    fill_fraction: Math.round((ml / 1500) * 1000) / 1000,
  },
  review_reasons: [],
  trace: [{ step: 'spark:read', model: 'muse-spark-1.3', ms: 4000 }],
  colour: null,
})

describe('level photos', () => {
  it('[charting/level-pairing] Before and after: Jug before and after', async () => {
    const t = await setup()
    const id = await t.bed('1')
    t.clock.t = Date.UTC(2026, 10, 2, 8)
    const a = (await t.upload(id, jpeg, 'photo')).body
    const first = await t.json<LevelResult>(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 1000,
      source: 'photo',
      evidence: jugEvidence(1000),
      media_id: a.id,
    })
    assert.deepEqual([first.status, first.body.entry, first.body.level.media], [201, null, a])
    t.clock.t = Date.UTC(2026, 10, 2, 12)
    const b = (await t.upload(id, png, 'photo')).body
    const second = await t.json<LevelResult>(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 600,
      source: 'photo',
      evidence: jugEvidence(600),
      media_id: b.id,
    })
    const e = second.body.entry!
    assert.equal(e.volume_ml, 400)
    for (const got of [e, (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!]) {
      assert.deepEqual(got.levels?.before, {
        id: first.body.level.id,
        volume_ml: 1000,
        created_at: '2026-11-02T08:00:00.000Z',
        media: a,
        labeled_media: null,
        evidence: jugEvidence(1000),
        event: null,
        residual_ml: null,
      })
      assert.deepEqual(
        [got.levels?.after.volume_ml, got.levels?.after.created_at, got.levels?.after.media],
        [600, '2026-11-02T12:00:00.000Z', b],
      )
      assert.deepEqual(got.media, b)
      assert.equal(got.has_photo, true)
    }
    // Other entries carry no levels; rejecting the drop leaves both jug photos with their levels.
    assert.equal((await t.entry(id, {})).body.levels, null)
    await t.json(`/api/entries/${e.id}/review`, { action: 'reject', reason: 'wrong_volume' })
    assert.equal((await t.get(`/api/media/${a.id}`)).status, 200)
    assert.equal((await t.get(`/api/media/${b.id}`)).status, 200)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/level-pairing] Before and after: Bag before and after', async () => {
    const t = await setup()
    const id = await t.bed('1')
    t.clock.t = Date.UTC(2026, 10, 2, 10)
    const a = (await t.upload(id, jpeg, 'photo')).body
    const first = await t.json<BagReadingResult>(`/api/admissions/${id}/bag-readings`, {
      container: 'urine_bag',
      event: 'check',
      volume_ml: 150,
      source: 'photo',
      media_id: a.id,
    })
    t.clock.t = Date.UTC(2026, 10, 2, 11)
    const b = (await t.upload(id, png, 'photo')).body
    const second = await t.json<BagReadingResult>(`/api/admissions/${id}/bag-readings`, {
      container: 'urine_bag',
      event: 'check',
      volume_ml: 260,
      source: 'photo',
      media_id: b.id,
    })
    const e = second.body.entry!
    assert.deepEqual([e.category, e.volume_ml], ['urine', 110])
    for (const got of [e, (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries[0]!]) {
      assert.deepEqual(got.levels?.before, {
        id: first.body.reading.id,
        volume_ml: 150,
        created_at: '2026-11-02T10:00:00.000Z',
        media: a,
        labeled_media: null,
        evidence: null,
        event: 'check',
        residual_ml: null,
      })
      assert.deepEqual(
        [got.levels?.after.id, got.levels?.after.volume_ml, got.levels?.after.created_at, got.levels?.after.event, got.levels?.after.media],
        [second.body.reading.id, 260, '2026-11-02T11:00:00.000Z', 'check', b],
      )
      assert.deepEqual(got.media, b)
    }
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/level-pairing] Before and after: First bag reading', async () => {
    const t = await setup()
    const id = await t.bed('1')
    t.clock.t = Date.UTC(2026, 10, 2, 8)
    const c = (await t.upload(id, jpeg, 'photo')).body
    const r = await t.json<BagReadingResult>(`/api/admissions/${id}/bag-readings`, {
      container: 'urine_bag',
      event: 'emptied',
      volume_ml: 600,
      source: 'photo',
      media_id: c.id,
    })
    const e = r.body.entry!
    assert.equal(e.volume_ml, 600)
    assert.equal(e.levels?.before, null)
    assert.deepEqual([e.levels?.after.volume_ml, e.levels?.after.event, e.levels?.after.media], [600, 'emptied', c])
    assert.deepEqual(t.u.requests, [])
  })
})

describe('tray photos', () => {
  it('[charting/meals] Tray photo kept: Lunch with its tray', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const tray = (await t.upload(id, jpeg, 'photo')).body
    const meal = await t.json<Meal>(`/api/admissions/${id}/meals`, {
      meal: 'lunch',
      portion: 50,
      fluid_ml: 150,
      source: 'photo',
      media_id: tray.id,
    })
    assert.equal(meal.status, 201)
    assert.deepEqual(meal.body.media, tray)
    assert.equal((await t.json<Meal[]>(`/api/admissions/${id}/meals`)).body[0]!.media?.kind, 'photo')
    const fluid = (await t.json<EntryList>(`/api/admissions/${id}/entries`)).body.entries.find((e) => e.id === meal.body.entry_id)!
    assert.deepEqual([fluid.volume_ml, fluid.media, fluid.has_photo], [150, null, false])
    const res = await t.get(`/api/media/${tray.id}`)
    assert.equal(res.status, 200)
    assert.deepEqual(await bytesOf(res), jpeg)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/meals] Tray photo kept: By-hand meal with a photo', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const tray = (await t.upload(id, jpeg, 'photo')).body
    const res = await t.json<Meal>(`/api/admissions/${id}/meals`, { meal: 'breakfast', portion: 100, source: 'manual', media_id: tray.id })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    assert.deepEqual((await t.json<Meal[]>(`/api/admissions/${id}/meals`)).body, [])
    assert.deepEqual(t.u.requests, [])
  })
})
