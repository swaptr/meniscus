/** Photo evidence bound to its raw photo, and the labeled copy kept beside it (labeled-photo-copy). No model requests on save. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  BagReadingResult,
  CaptureReadResult,
  Entry,
  EntryList,
  LevelResult,
  MediaRef,
  PhotoEvidence,
} from '@meniscus/shared'
import { reading, testApp, testStore, upstream } from './testing.ts'

const HOUR = 3_600_000
/** 2 Nov 2026, 09:00 UTC; demo patients are admitted two days earlier. */
const NOV2_9 = Date.UTC(2026, 10, 2, 9)
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** Synthetic JPEGs (markers around filler): a raw photo and labeled copies. No real image. */
const jpegOf = (...fill: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...fill, 0xff, 0xd9])
const RAW = jpegOf(0x52)
const LABELED = jpegOf(0x4c, 0x41)
const OTHER = jpegOf(0x4f)
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0, 0, 0])

/** A `sam+spark` read as the server emits it, with segmentation; `image_sha256` only when given. */
const segmented = (over: Partial<PhotoEvidence> = {}): PhotoEvidence => ({
  kind: 'photo',
  mode: 'sam+spark',
  reading: reading(),
  segmentation: {
    container: { left: 100, top: 80, right: 400, bottom: 900, confidence: 0.94 },
    fluid: { left: 110, top: 520, right: 390, bottom: 890, confidence: 0.91 },
    fill_fraction: 0.463,
  },
  review_reasons: [],
  trace: [{ step: 'spark:read', model: 'muse-spark-1.3', ms: 4500 }],
  colour: '#d9b44a',
  ...over,
})
const sparkOnly = (over: Partial<PhotoEvidence> = {}): PhotoEvidence => segmented({ mode: 'spark', segmentation: null, ...over })

async function setup() {
  const clock = { t: NOV2_9 - 48 * HOUR }
  const store = await testStore(() => clock.t)
  clock.t = NOV2_9
  const u = upstream()
  const app = await testApp({ ai: u.ai, store })
  const json = async <T>(path: string, body?: unknown) => {
    const res = await app.request(path, {
      method: body === undefined ? 'GET' : 'POST',
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
    })
    return { status: res.status, body: (await res.json()) as T & { error?: string } }
  }
  const bed = async (n: string) =>
    (await json<AdmissionSummary[]>('/api/admissions')).body.find((a) => a.bed === n && a.ward_code === '5B')!.id
  const upload = async (admissionId: number, bytes: Uint8Array, kind = 'photo', extra: Record<string, string> = {}) => {
    const form = new FormData()
    form.set('file', new File([bytes], 'upload', { type: kind === 'voice' ? 'audio/webm' : 'image/jpeg' }))
    form.set('kind', kind)
    for (const [k, v] of Object.entries(extra)) form.set(k, v)
    const res = await app.request(`/api/admissions/${admissionId}/media`, { method: 'POST', body: form })
    assert.equal(res.status, 201)
    return (await res.json()) as MediaRef
  }
  const entry = (admissionId: number, body: object) =>
    json<Entry>(`/api/admissions/${admissionId}/entries`, { direction: 'out', category: 'urine', volume_ml: 450, source: 'photo', ...body })
  const entries = async (admissionId: number) => (await json<EntryList>(`/api/admissions/${admissionId}/entries`)).body.entries
  const status = async (path: string) => (await app.request(path)).status
  const reject = (entryId: number) => json<Entry>(`/api/entries/${entryId}/review`, { action: 'reject', reason: 'duplicate' })
  /** A raw photo, its labeled copy and an entry linking both. */
  const withCopy = async (admissionId: number) => {
    const raw = await upload(admissionId, RAW)
    const copy = await upload(admissionId, LABELED)
    const saved = await entry(admissionId, {
      media_id: raw.id,
      labeled_media_id: copy.id,
      evidence: segmented({ image_sha256: raw.sha256! }),
    })
    assert.equal(saved.status, 201)
    return { raw, copy, saved: saved.body }
  }
  return { clock, u, app, store, json, bed, upload, entry, entries, status, reject, withCopy }
}

describe('photo evidence bound to its photo', () => {
  it('[charting/photo-evidence] Photo evidence bound to its photo: Read and photo of the same bytes', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const form = new FormData()
    form.set('image', new File([RAW], 'bag.jpg', { type: 'image/jpeg' }))
    form.set('hint', 'urine_bag')
    form.set('mode', 'sam+spark')
    const read = (await (await t.app.request('/api/ai/read', { method: 'POST', body: form })).json()) as CaptureReadResult
    const sent = t.u.requests.length
    assert.equal(sent, 3)
    const raw = await t.upload(id, RAW)
    const res = await t.entry(id, {
      media_id: raw.id,
      evidence: {
        kind: 'photo',
        mode: read.mode,
        image_sha256: read.image_sha256,
        reading: read.reading,
        segmentation: read.segmentation,
        review_reasons: [],
        trace: read.trace,
        colour: null,
      },
    })
    assert.equal(res.status, 201)
    assert.equal((res.body.evidence as PhotoEvidence).image_sha256, res.body.media?.sha256)
    assert.equal(((await t.entries(id))[0]!.evidence as PhotoEvidence).image_sha256, sha256(RAW))
    assert.equal(t.u.requests.length, sent)
  })

  it('[charting/photo-evidence] Photo evidence bound to its photo: Read of another photo', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const a = await t.upload(id, RAW)
    const b = await t.upload(id, OTHER)
    const res = await t.entry(id, { media_id: b.id, evidence: segmented({ image_sha256: a.sha256! }) })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    // Levels and bag readings check it the same way.
    const level = await t.json(`/api/admissions/${id}/levels`, {
      container: 'water_jug',
      volume_ml: 600,
      source: 'photo',
      media_id: b.id,
      evidence: segmented({ image_sha256: a.sha256! }),
    })
    assert.equal(level.status, 400)
    const bag = await t.json(`/api/admissions/${id}/bag-readings`, {
      container: 'urine_bag',
      event: 'check',
      volume_ml: 380,
      source: 'photo',
      media_id: b.id,
      evidence: segmented({ image_sha256: a.sha256! }),
    })
    assert.equal(bag.status, 400)
    assert.deepEqual(await t.entries(id), [])
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Photo evidence bound to its photo: Malformed fingerprint', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const res = await t.entry(id, { evidence: segmented({ image_sha256: 'ABC' }) })
    assert.equal(res.status, 400)
    assert.equal(res.body.error, 'invalid_request')
    assert.deepEqual(await t.entries(id), [])
  })

  it('[charting/photo-evidence] Photo evidence bound to its photo: Evidence without a fingerprint', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const raw = await t.upload(id, RAW)
    const ev = segmented()
    const res = await t.entry(id, { media_id: raw.id, evidence: ev })
    assert.equal(res.status, 201)
    assert.deepEqual((await t.entries(id))[0]!.evidence, ev)
    assert.ok(!('image_sha256' in (res.body.evidence as object)))
    assert.deepEqual(t.u.requests, [])
  })
})

describe('labeled copy linked with the photo', () => {
  it('[charting/photo-evidence] Labeled copy linked with the photo: Urine bag entry with its copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const { raw, copy, saved } = await t.withCopy(id)
    assert.equal(saved.media?.id, raw.id)
    assert.equal(saved.labeled_media?.id, copy.id)
    assert.equal(saved.labeled_media?.sha256, sha256(LABELED))
    assert.equal((await t.entries(id))[0]!.labeled_media?.id, copy.id)
    const res = await t.app.request(`/api/media/${copy.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/jpeg')
    assert.match(res.headers.get('cache-control') ?? '', /no-store/)
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), LABELED)
    // A bag reading links its copy the same way, and its entry carries it.
    const bagRaw = await t.upload(id, jpegOf(0x42))
    const bagCopy = await t.upload(id, jpegOf(0x42, 0x4c))
    const bag = await t.json<BagReadingResult>(`/api/admissions/${id}/bag-readings`, {
      container: 'urine_bag',
      event: 'check',
      volume_ml: 380,
      source: 'photo',
      media_id: bagRaw.id,
      labeled_media_id: bagCopy.id,
      evidence: segmented({ image_sha256: bagRaw.sha256! }),
    })
    assert.equal(bag.status, 201)
    assert.equal(bag.body.reading.labeled_media?.id, bagCopy.id)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Labeled copy linked with the photo: Jug level with its copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const level = (body: object) =>
      t.json<LevelResult>(`/api/admissions/${id}/levels`, { container: 'water_jug', source: 'photo', ...body })
    assert.equal((await level({ volume_ml: 1000 })).status, 201)
    const raw = await t.upload(id, RAW)
    const copy = await t.upload(id, LABELED)
    const r = await level({
      volume_ml: 600,
      media_id: raw.id,
      labeled_media_id: copy.id,
      evidence: segmented({ reading: reading({ container: 'water_jug', fluid: 'water' }) }),
    })
    assert.equal(r.status, 201)
    assert.equal(r.body.level.labeled_media?.id, copy.id)
    assert.equal(r.body.entry?.volume_ml, 400)
    assert.equal(r.body.entry?.levels?.after.labeled_media?.id, copy.id)
    const listed = (await t.entries(id)).find((e) => e.id === r.body.entry!.id)!
    assert.equal(listed.levels?.after.labeled_media?.id, copy.id)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Labeled copy linked with the photo: Refused links', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const other = await t.bed('2')
    const raw = await t.upload(id, RAW)
    const copy = await t.upload(id, LABELED)
    const foreign = await t.upload(other, jpegOf(0x32))
    const voice = await t.upload(id, webm, 'voice')
    const linked = await t.upload(id, jpegOf(0x4b))
    assert.equal((await t.entry(id, { media_id: linked.id })).status, 201)
    const served = await t.upload(id, jpegOf(0x53), 'photo', { served_meal: 'lunch' })
    const ev = segmented()
    const cases: [string, object][] = [
      ['no media_id', { labeled_media_id: copy.id, evidence: ev }],
      ['same as media_id', { media_id: raw.id, labeled_media_id: raw.id, evidence: ev }],
      ['another bed', { media_id: raw.id, labeled_media_id: foreign.id, evidence: ev }],
      ['a recording', { media_id: raw.id, labeled_media_id: voice.id, evidence: ev }],
      ['already linked', { media_id: raw.id, labeled_media_id: linked.id, evidence: ev }],
      ['a served tray photo', { media_id: raw.id, labeled_media_id: served.id, evidence: ev }],
      ['no segmentation', { media_id: raw.id, labeled_media_id: copy.id, evidence: sparkOnly() }],
      ['no evidence', { media_id: raw.id, labeled_media_id: copy.id }],
    ]
    for (const [name, body] of cases) {
      const r = await t.entry(id, body)
      assert.equal(r.status, 400, name)
      assert.equal(r.body.error, 'invalid_request', name)
    }
    assert.equal((await t.entries(id)).length, 1, 'only the entry linking the already-linked photo')
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Labeled copy linked with the photo: Without a copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const raw = await t.upload(id, RAW)
    const r = await t.entry(id, { media_id: raw.id, evidence: sparkOnly() })
    assert.equal(r.status, 201)
    assert.equal(r.body.labeled_media, null)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/photo-evidence] Rejected entries drop their photo: Reject with a labeled copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const { raw, copy, saved } = await t.withCopy(id)
    const r = await t.reject(saved.id)
    assert.equal(r.status, 200)
    assert.equal(r.body.media, null)
    assert.equal(r.body.labeled_media, null)
    assert.equal(await t.status(`/api/media/${raw.id}`), 404)
    assert.equal(await t.status(`/api/media/${copy.id}`), 404)
  })
})

describe('labeled copy lifecycle', () => {
  it('[charting/media] Media goes with its record: Rejected entry with its labeled copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const { raw, copy, saved } = await t.withCopy(id)
    await t.reject(saved.id)
    assert.equal(await t.status(`/api/media/${raw.id}`), 404)
    assert.equal(await t.status(`/api/media/${copy.id}`), 404)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Media goes with its record: Level keeps its labeled copy', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const level = (body: object) =>
      t.json<LevelResult>(`/api/admissions/${id}/levels`, { container: 'water_jug', source: 'photo', ...body })
    await level({ volume_ml: 1000 })
    const raw = await t.upload(id, RAW)
    const copy = await t.upload(id, LABELED)
    const r = await level({ volume_ml: 600, media_id: raw.id, labeled_media_id: copy.id, evidence: segmented() })
    assert.equal(r.body.entry?.volume_ml, 400)
    assert.equal(r.body.entry?.labeled_media?.id, copy.id)
    const rejected = await t.reject(r.body.entry.id)
    assert.equal(rejected.body.labeled_media, null)
    assert.equal(await t.status(`/api/media/${raw.id}`), 200)
    assert.equal(await t.status(`/api/media/${copy.id}`), 200)
    assert.deepEqual(t.u.requests, [])
  })

  it('[charting/media] Unlinked media expires: Labeled copy in use', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const raw = await t.upload(id, RAW)
    const copy = await t.upload(id, LABELED)
    t.clock.t = NOV2_9 + 60_000
    assert.equal((await t.entry(id, { media_id: raw.id, labeled_media_id: copy.id, evidence: segmented() })).status, 201)
    t.clock.t = NOV2_9 + 24 * HOUR + 60_000
    // An upload runs the sweep; the linked copy survives it.
    await t.upload(id, OTHER)
    assert.equal(await t.status(`/api/media/${copy.id}`), 200)
  })

  it('[charting/media] Unlinked media expires: Labeled copy never saved', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const raw = await t.upload(id, RAW)
    const copy = await t.upload(id, LABELED)
    // The entry post fails (refused: Spark-only evidence cannot take a copy), so the copy is never linked.
    assert.equal((await t.entry(id, { media_id: raw.id, labeled_media_id: copy.id, evidence: sparkOnly() })).status, 400)
    t.clock.t = NOV2_9 + 24 * HOUR + 60_000
    assert.equal(await t.status(`/api/media/${copy.id}`), 404)
  })

  it('[charting/media] Media SHA-256 fingerprint: Labeled copy fingerprint', async () => {
    const t = await setup()
    const id = await t.bed('1')
    const { saved } = await t.withCopy(id)
    assert.equal(saved.labeled_media?.sha256, sha256(LABELED))
    assert.equal(saved.media?.sha256, sha256(RAW))
    assert.notEqual(saved.labeled_media?.sha256, saved.media?.sha256)
    assert.deepEqual(t.u.requests, [])
  })
})
