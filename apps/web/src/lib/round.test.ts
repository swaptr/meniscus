import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type {
  AdmissionSummary,
  CaptureReadResult,
  CareOrder,
  ContainerKind,
  FluidKind,
  NoteResult,
  OutputDevices,
  UrineColour,
} from '@meniscus/shared'
import { createApi } from './api.ts'
import { savedText } from './bags.ts'
import { fakeCopies, segmentation } from './copy-fixtures.ts'
import { Round, bagWarning, parseBedToken, readLabel, retryView, roundBed, type RoundBed } from './round.ts'

type Bed = { id: number; bed: string; ward_id: number; ward_code: string }
const TOKENS: Record<string, Bed> = {
  abcDEF123_xyz00000001: { id: 1, bed: '1', ward_id: 3, ward_code: '5B' },
  abcDEF123_xyz00000002: { id: 2, bed: '2', ward_id: 3, ward_code: '5B' },
  abcDEF123_xyz00000004: { id: 4, bed: '4', ward_id: 3, ward_code: '5B' },
  ward3Abed3token000000: { id: 31, bed: '3', ward_id: 2, ward_code: '3A' },
  ward3Abed4token000000: { id: 32, bed: '4', ward_id: 2, ward_code: '3A' },
  wardHDUbed1token00000: { id: 41, bed: '1', ward_id: 6, ward_code: 'HDU' },
}
const card = (t: string) => `https://ward.example/a/bed/${t}`

const result = (
  container: ContainerKind,
  fluid: FluidKind,
  ml: number,
  confidence: number,
  colour?: { urine_colour: UrineColour; urine_rgb: string | null },
): CaptureReadResult => ({
  image_sha256: 'c0ffee'.padEnd(64, '0'),
  mode: 'sam+spark',
  reading: {
    container,
    fluid,
    volume_ml: ml,
    capacity_ml: 2000,
    marks_visible: true,
    reading_basis: 'marks',
    appearance: null,
    confidence,
    issues: [],
  },
  segmentation: null,
  draft:
    fluid === 'urine'
      ? { direction: 'out', category: 'urine', volume_ml: ml, item: null, notes: null, ...colour }
      : { direction: 'in', category: 'water', volume_ml: ml, item: null, notes: null },
  needs_review: confidence < 0.75,
  warnings: [],
  trace: [],
  ms: 10,
})

/** A voice note that drafted 200 mL tea and 300 mL urine. */
const teaAndUrine = (): NoteResult => ({
  transcript: 'bed 2 had tea 200 mL and passed 300 mL urine',
  entries: [
    { direction: 'in', category: 'water', volume_ml: 200, item: 'tea', notes: null },
    { direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: null },
  ],
  reply: null,
  trace: [],
  duration_ms: 4200,
  turns: [
    { start_ms: 0, end_ms: 1800, text: 'bed 2 had tea 200 mL' },
    { start_ms: 1900, end_ms: 4100, text: 'and passed 300 mL urine' },
  ],
})

/** Fake server. `reads` answers /api/ai/read calls in order (an Error = HTTP 502); `notes` answers /api/ai/voice-note (a Response as is). */
function fake(
  reads: (CaptureReadResult | Error | Response)[] = [],
  notes: (NoteResult | Response)[] = [],
  /** Answers a bag-reading post instead of the default 201, when it returns a Response. */
  bagAnswer: (body: Record<string, unknown>, admission: string) => Response | undefined = () => undefined,
) {
  const calls: string[] = []
  const modes: (string | null)[] = []
  const entries: Record<string, unknown>[] = []
  const levels: Record<string, unknown>[] = []
  const bags: Record<string, unknown>[] = []
  /** Form fields of each voice-note and media request. */
  const voiceForms: FormData[] = []
  const mediaKinds: string[] = []
  let nextEntry = 100
  let nextMedia = 500
  const api = createApi((url, init) => {
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${url}`)
    const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }))
    const bed = /^\/api\/beds\/(.+)$/.exec(url)
    if (bed) {
      const a = TOKENS[decodeURIComponent(bed[1]!)]
      return a ? json({ ...a, patient: `P${a.bed}`, weight_kg: 60, qr_token: bed[1], admitted_at: '' }) : json({ error: 'not_found' }, 404)
    }
    if (url === '/api/ai/read') {
      modes.push((init?.body as FormData).get('mode') as string | null)
      const r = reads.shift()
      if (r instanceof Response) return Promise.resolve(r)
      return !r || r instanceof Error ? json({ error: 'model_api_error', message: 'upstream failed' }, 502) : json(r)
    }
    if (url === '/api/ai/voice-note') {
      voiceForms.push(init?.body as FormData)
      const n = notes.shift()
      if (n instanceof Response) return Promise.resolve(n)
      return n ? json(n) : json({ error: 'model_api_error', message: 'upstream failed' }, 502)
    }
    if (/\/media$/.test(url)) {
      mediaKinds.push((init?.body as FormData).get('kind') as string)
      return json({ id: nextMedia++, kind: 'photo', mime: 'image/jpeg', size: 4, duration_ms: null, created_at: '', sha256: null }, 201)
    }
    if (/\/entries$/.test(url)) {
      entries.push(JSON.parse(init!.body as string) as Record<string, unknown>)
      return json({ id: nextEntry++, has_photo: false }, 201)
    }
    if (/\/bag-readings$/.test(url)) {
      const body = JSON.parse(init!.body as string) as Record<string, unknown>
      bags.push(body)
      const answer = bagAnswer(body, /admissions\/(\d+)\//.exec(url)![1]!)
      if (answer) return Promise.resolve(answer)
      return json({ reading: { id: 700 + bags.length, ...body }, entry: null }, 201)
    }
    if (/\/levels$/.test(url)) {
      levels.push(JSON.parse(init!.body as string) as Record<string, unknown>)
      return json({ level: {}, previous_ml: null, entry: null }, 201)
    }
    if (/\/photo$/.test(url)) return json({ ok: true }, 201)
    return json({ error: 'not_found' }, 404)
  })
  return { api, calls, modes, entries, levels, bags, voiceForms, mediaKinds }
}

const photo = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const audio = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' })
const aiCalls = (calls: string[]) => calls.filter((c) => c.includes('/api/ai/'))

/** Gallery files: the QR text each image holds (none for plain photos). */
const gallery = (files: [name: string, type: string, qr?: string][]) => {
  const qr = new Map<Blob, string>()
  const list = files.map(([name, type, text]) => {
    const f = new File([new Uint8Array([1, 2, 3, 4])], name, { type })
    if (text !== undefined) qr.set(f, text)
    return f
  })
  return { files: list, decodeQr: (b: Blob) => Promise.resolve(qr.get(b) ?? null) }
}

describe('ward round', () => {
  it('[web/ward-round] Bed card switches the bed: Bed card photo', async () => {
    const t = 'abcDEF123_-xyz0000000'
    assert.equal(parseBedToken(`https://ward.example/a/bed/${t}`), t)
    TOKENS[t] = { id: 4, bed: '4', ward_id: 3, ward_code: '5B' }
    const f = fake()
    const round = new Round(f.api)
    assert.equal(await round.onPhoto(photo(), card(t)), 'bed')
    assert.equal(round.getState().current?.bed, '4')
    assert.deepEqual(f.calls, [`GET /api/beds/${t}`])
  })

  it('[web/ward-round] Bed card switches the bed: Foreign QR', async () => {
    const f = fake()
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    assert.equal(await round.onPhoto(photo(), 'https://example.com/menu'), 'foreign_qr')
    assert.equal(parseBedToken('not a url'), null)
    assert.equal(round.getState().current?.bed, '1')
    assert.equal(await round.onPhoto(photo(), card('unknownToken00000000')), 'unknown_bed')
    assert.equal(round.getState().current?.bed, '1')
  })

  it('[web/ward-round] Readings join the current bed: Two beds', async () => {
    const f = fake([result('urine_bag', 'urine', 450, 0.9), result('urine_bag', 'urine', 300, 0.9), result('water_jug', 'water', 600, 0.9)])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000002'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), null)
    await round.idle()
    assert.deepEqual(
      round.getState().readings.map((r) => r.bed.bed),
      ['1', '2', '2'],
    )
  })

  it('[web/ward-round] Readings join the current bed: No bed yet', async () => {
    const f = fake()
    const round = new Round(f.api)
    assert.equal(await round.onPhoto(photo(), null), 'no_bed')
    assert.equal(round.getState().readings.length, 0)
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward-round] One read per photo, in order: Three photos, one fails', async () => {
    const f = fake([result('urine_bag', 'urine', 450, 0.9), new Error('x'), result('urinal', 'urine', 200, 0.8)])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    for (let i = 0; i < 3; i++) await round.onPhoto(photo(), null)
    await round.idle()
    const reads = f.calls.filter((c) => c === 'POST /api/ai/read')
    assert.equal(reads.length, 3)
    assert.deepEqual(
      round.getState().readings.map((r) => [r.status, r.volume_ml]),
      [
        ['ready', 450],
        ['failed', null],
        ['ready', 200],
      ],
    )
    // Nothing re-sends the failed read until the user taps Retry.
    await round.idle()
    assert.equal(f.calls.filter((c) => c === 'POST /api/ai/read').length, 3)
  })

  it('[web/ward-round] One read per photo, in order: Fast mode', async () => {
    const f = fake([result('urine_bag', 'urine', 450, 0.9), result('urine_bag', 'urine', 300, 0.9)])
    const round = new Round(f.api, { fast: true })
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    await round.onPhoto(photo(), null)
    round.setFast(false)
    await round.idle()
    round.setFast(true)
    await round.onPhoto(photo(), null)
    await round.idle()
    assert.deepEqual(f.modes, ['spark', 'spark'])
  })

  it('[web/ward-round] One read per photo, in order: retry is one more read', async () => {
    const f = fake([new Error('x'), result('urine_bag', 'urine', 450, 0.9)])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    await round.onPhoto(photo(), null)
    await round.idle()
    round.retry(round.getState().readings[0]!.id)
    await round.idle()
    assert.equal(f.calls.filter((c) => c === 'POST /api/ai/read').length, 2)
    assert.equal(round.getState().readings[0]!.status, 'ready')
  })

  it('[web/ward-round] One read per photo, in order: Mode from each response', async () => {
    const clock = { t: new Date(2026, 10, 3, 10, 40).getTime() }
    const spark: CaptureReadResult = {
      ...result('urine_bag', 'urine', 300, 0.9),
      mode: 'spark',
      warnings: ['budget pressure: read without segmentation'],
    }
    const refused = Response.json(
      {
        error: 'request_budget_exceeded',
        message: 'request budget exhausted',
        retryable: true,
        limit: 'hourly',
        budget_class: 'routine',
        retry_after_ms: 1_200_000,
      },
      { status: 429, headers: { 'Retry-After': '1200' } },
    )
    const f = fake([result('urine_bag', 'urine', 450, 0.9), spark, refused])
    const round = new Round(f.api, { now: () => clock.t })
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    for (let i = 0; i < 3; i++) await round.onPhoto(photo(), null)
    await round.idle()
    assert.deepEqual(aiCalls(f.calls), ['POST /api/ai/read', 'POST /api/ai/read', 'POST /api/ai/read'])
    const [first, second, third] = round.getState().readings
    assert.equal(first!.result?.mode, 'sam+spark')
    assert.equal(second!.result?.mode, 'spark')
    assert.ok(second!.result?.warnings.includes('budget pressure: read without segmentation'))
    assert.equal(third!.status, 'failed')
    assert.deepEqual(retryView(third!, clock.t), { label: 'Retry from 11:00', disabled: true })
    // A tap before 11:00 sends nothing; none is sent again on its own.
    round.retry(third!.id)
    await round.idle()
    assert.equal(aiCalls(f.calls).length, 3)
    clock.t = new Date(2026, 10, 3, 11, 0).getTime()
    assert.deepEqual(retryView(round.getState().readings[2]!, clock.t), { label: 'Retry', disabled: false })
    assert.equal(aiCalls(f.calls).length, 3)
  })

  it('[web/ward-round] One read per photo, in order: Photo then recording', async () => {
    const f = fake([result('urine_bag', 'urine', 450, 0.9)], [teaAndUrine()])
    const round = new Round(f.api, { fast: true })
    await round.onPhoto(photo(), card('abcDEF123_xyz00000002'))
    assert.equal(await round.onPhoto(photo(), null), 'reading')
    assert.equal(round.onRecording(audio(), 4200), 'reading')
    await round.idle()
    assert.deepEqual(aiCalls(f.calls), ['POST /api/ai/read', 'POST /api/ai/voice-note'])
    assert.deepEqual(f.modes, ['spark'])
    assert.equal(f.voiceForms[0]!.get('mode'), null)
    assert.deepEqual(
      round.getState().readings.map((r) => [r.bed.bed, r.source.kind, r.status]),
      [
        ['2', 'photo', 'ready'],
        ['2', 'voice', 'ready'],
      ],
    )
  })

  it('[web/capture] Recording too long: Long recording refused', async () => {
    const tooLong = Response.json(
      {
        error: 'audio_too_long',
        message: 'audio is 601000 ms; limit is 600000 ms',
        retryable: false,
        duration_ms: 601000,
        limit_ms: 600000,
      },
      { status: 422 },
    )
    const f = fake([], [tooLong])
    const round = new Round(f.api, { fast: true })
    await round.onPhoto(photo(), card('ward3Abed4token000000'))
    assert.equal(round.onRecording(audio(), 601000), 'reading')
    await round.idle()
    const voice = round.getState().readings.find((r) => r.source.kind === 'voice')!
    assert.equal(voice.status, 'failed')
    assert.equal(voice.error, 'Recording over 10 minutes. Record a shorter note.')
    assert.equal(voice.voice, undefined, 'no drafts')
    assert.deepEqual(aiCalls(f.calls), ['POST /api/ai/voice-note'])
  })

  it('[web/ward-round] Save the round: Mixed round', async () => {
    // The bag read is segmented (a labeled copy too); the jug's is Spark-only (its photo alone).
    const f = fake(
      [
        { ...result('urine_bag', 'urine', 450, 0.9), segmentation: segmentation() },
        { ...result('water_jug', 'water', 600, 0.8), mode: 'spark' },
        result('urinal', 'urine', 200, 0.5),
      ],
      [teaAndUrine()],
    )
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    for (let i = 0; i < 3; i++) await round.onPhoto(photo(), null)
    round.onRecording(audio(), 4200)
    await round.idle()
    f.calls.length = 0
    const copies = fakeCopies()
    assert.equal(await round.saveHighConfidence(), 2)
    copies.restore()
    assert.deepEqual(f.calls, [
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/bag-readings',
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/levels',
    ])
    assert.deepEqual(f.mediaKinds, ['photo', 'photo', 'photo'])
    // Each post links the media uploaded just before it; the bag is a reading, not an entry of its whole level.
    assert.deepEqual(f.entries, [])
    assert.deepEqual(
      f.bags.map((b) => [b.container, b.source, b.volume_ml, b.media_id, b.labeled_media_id]),
      [['urine_bag', 'photo', 450, 500, 501]],
    )
    assert.deepEqual(
      f.levels.map((l) => [l.volume_ml, l.media_id, 'labeled_media_id' in l]),
      [[600, 502, false]],
    )
    assert.deepEqual(
      round.getState().readings.map((r) => r.status),
      ['saved', 'saved', 'ready', 'ready'],
    )
  })

  it('[web/ward-round] Save the round: Two wards', async () => {
    const seg = segmentation()
    const f = fake([
      { ...result('urine_bag', 'urine', 380, 0.9), segmentation: seg },
      { ...result('urine_bag', 'urine', 260, 0.9), segmentation: seg },
    ])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('ward3Abed3token000000'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), card('wardHDUbed1token00000'))
    await round.onPhoto(photo(), null)
    await round.idle()
    f.calls.length = 0
    const copies = fakeCopies()
    assert.equal(await round.saveHighConfidence(), 2)
    copies.restore()
    assert.deepEqual(f.calls, [
      'POST /api/admissions/31/media',
      'POST /api/admissions/31/media',
      'POST /api/admissions/31/bag-readings',
      'POST /api/admissions/41/media',
      'POST /api/admissions/41/media',
      'POST /api/admissions/41/bag-readings',
    ])
    assert.deepEqual(
      f.bags.map((b) => [b.event, b.volume_ml, b.media_id, b.labeled_media_id]),
      [
        ['emptied', 380, 500, 501],
        ['check', 260, 502, 503],
      ],
    )
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Voice in the round: Dictated at bed 2', async () => {
    const f = fake([], [teaAndUrine()])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000002'))
    assert.equal(round.onRecording(audio(), 4200), 'reading')
    await round.idle()
    const [r] = round.getState().readings
    assert.equal(round.getState().readings.length, 1)
    assert.deepEqual([r!.bed.bed, r!.source.kind, r!.status], ['2', 'voice', 'ready'])
    assert.deepEqual(aiCalls(f.calls), ['POST /api/ai/voice-note'])
    assert.deepEqual(
      r!.voice?.drafts.map((d) => [d.draft.category, d.draft.volume_ml]),
      [
        ['water', 200],
        ['urine', 300],
      ],
    )
    f.calls.length = 0
    const saved = await round.save(r!.id)
    assert.equal(saved?.entries?.length, 2)
    assert.deepEqual(f.calls, ['POST /api/admissions/2/media', 'POST /api/admissions/2/entries', 'POST /api/admissions/2/entries'])
    assert.deepEqual(f.mediaKinds, ['voice'])
    assert.deepEqual(
      f.entries.map((e) => [e.source, e.media_id]),
      [
        ['voice', 500],
        ['voice', 500],
      ],
    )
    // Each draft keeps the note's timed turns as evidence.
    assert.deepEqual((f.entries[0]!.evidence as { turns: unknown[] }).turns, teaAndUrine().turns)
    assert.equal(round.getState().readings[0]!.status, 'saved')
  })

  it('[web/ward-round] Voice in the round: Record before any card', async () => {
    const f = fake()
    const round = new Round(f.api)
    assert.equal(round.onRecording(audio(), 3000), 'no_bed')
    assert.equal(round.getState().readings.length, 0)
    await round.idle()
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward-round] Import in bulk: Two beds from the gallery', async () => {
    const f = fake()
    const round = new Round(f.api)
    const g = gallery([
      ['card-2.png', 'image/png', card('abcDEF123_xyz00000002')],
      ['bag.jpg', 'image/jpeg'],
      ['rec1.m4a', ''],
      ['card-4.png', 'image/png', card('abcDEF123_xyz00000004')],
      ['jug.jpg', 'image/jpeg'],
      ['notes.txt', 'text/plain'],
    ])
    const report = await round.import(g.files, g.decodeQr)
    assert.deepEqual(
      report.map((r) => [r.name, r.outcome]),
      [
        ['card-2.png', 'bed'],
        ['bag.jpg', 'waiting'],
        ['rec1.m4a', 'waiting'],
        ['card-4.png', 'bed'],
        ['jug.jpg', 'waiting'],
        ['notes.txt', 'unsupported'],
      ],
    )
    assert.deepEqual(
      round.getState().readings.map((r) => [r.bed.bed, r.source.kind, r.status]),
      [
        ['2', 'photo', 'waiting'],
        ['2', 'voice', 'waiting'],
        ['4', 'photo', 'waiting'],
      ],
    )
    await round.idle()
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Import in bulk: Foreign QR in an import', async () => {
    const f = fake()
    const round = new Round(f.api)
    const g = gallery([
      ['card-2.png', 'image/png', card('abcDEF123_xyz00000002')],
      ['menu.jpg', 'image/jpeg', 'https://example.com/menu'],
      ['bag.jpg', 'image/jpeg'],
    ])
    const report = await round.import(g.files, g.decodeQr)
    assert.deepEqual(
      report.map((r) => r.outcome),
      ['bed', 'foreign_qr', 'waiting'],
    )
    const s = round.getState()
    assert.equal(s.current?.bed, '2')
    assert.deepEqual(
      s.readings.map((r) => [r.bed.bed, r.source.kind]),
      [['2', 'photo']],
    )
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Import in bulk: files before any card are skipped', async () => {
    const f = fake()
    const round = new Round(f.api)
    const g = gallery([
      ['bag.jpg', 'image/jpeg'],
      ['rec1.m4a', 'audio/mp4'],
    ])
    assert.deepEqual(
      (await round.import(g.files, g.decodeQr)).map((r) => r.outcome),
      ['no_bed', 'no_bed'],
    )
    assert.equal(round.getState().readings.length, 0)
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward-round] Requests before reading: Imported queue', async () => {
    const f = fake(
      [result('urine_bag', 'urine', 450, 0.9), result('urine_bag', 'urine', 300, 0.9), result('urinal', 'urine', 200, 0.9)],
      [teaAndUrine(), teaAndUrine()],
    )
    const round = new Round(f.api)
    const g = gallery([
      ['card-2.png', 'image/png', card('abcDEF123_xyz00000002')],
      ['a.jpg', 'image/jpeg'],
      ['b.jpg', 'image/jpeg'],
      ['one.m4a', 'audio/mp4'],
      ['c.jpg', 'image/jpeg'],
      ['two.webm', 'audio/webm'],
    ])
    await round.import(g.files, g.decodeQr)
    assert.equal(round.waitingRequests(), 13)
    assert.equal(readLabel(round.getState()), 'Read 5 · 13 model requests')
    round.setFast(true)
    assert.equal(readLabel(round.getState()), 'Read 5 · 7 model requests')
    await round.idle()
    assert.deepEqual(aiCalls(f.calls), [])
    // The tap: each waiting reading is read once, in order.
    round.readWaiting()
    await round.idle()
    assert.deepEqual(aiCalls(f.calls), [
      'POST /api/ai/read',
      'POST /api/ai/read',
      'POST /api/ai/voice-note',
      'POST /api/ai/read',
      'POST /api/ai/voice-note',
    ])
    assert.equal(readLabel(round.getState()), null)
  })

  it('[web/capture] Urine colour on the check screen: Staff change the colour', async () => {
    const dark = { urine_colour: 'dark', urine_rgb: '#c9952f' } as const
    // Two urinals (entries) and a urine bag (a bag reading, Save the round).
    const f = fake([
      result('urinal', 'urine', 450, 0.9, dark),
      result('urinal', 'urine', 200, 0.9, dark),
      result('urine_bag', 'urine', 300, 0.9, dark),
    ])
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('abcDEF123_xyz00000001'))
    for (let i = 0; i < 3; i++) await round.onPhoto(photo(), null)
    await round.idle()
    const [, second, bag] = round.getState().readings
    f.calls.length = 0
    round.setColour(second!.id, 'red')
    round.setColour(bag!.id, 'red')
    assert.equal(await round.saveHighConfidence(), 3)
    // Read colour kept on the untouched reading; the picked one replaces it and drops the photo colour.
    assert.equal(f.entries[0]!.urine_colour, 'dark')
    assert.equal(f.entries[0]!.urine_rgb, '#c9952f')
    assert.equal(f.entries[1]!.urine_colour, 'red')
    assert.equal('urine_rgb' in f.entries[1]!, false)
    // The bag reading carries the picked colour too.
    assert.equal(f.bags[0]!.urine_colour, 'red')
    assert.equal('urine_rgb' in f.bags[0]!, false)
    assert.deepEqual(f.calls, [
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/entries',
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/entries',
      'POST /api/admissions/1/media',
      'POST /api/admissions/1/bag-readings',
    ])
  })

  describe('ward progress', () => {
    // Ward 5B, beds 1–6 (admission ids 11–16); ward 3A bed 2 is admission 32.
    const b5 = Array.from({ length: 6 }, (_, i): RoundBed => ({
      id: 11 + i,
      bed: String(i + 1),
      patient: `P${i + 1}`,
      qr_token: `ward5Bbed${i + 1}token000000`,
      ward_id: 3,
      ward_code: '5B',
    }))
    for (const b of b5) TOKENS[b.qr_token] = { id: b.id, bed: b.bed, ward_id: 3, ward_code: '5B' }
    TOKENS.ward3Abed2token000000 = { id: 32, bed: '2', ward_id: 2, ward_code: '3A' }
    const start = () => {
      const f = fake()
      const round = new Round(f.api)
      round.setWard({ id: 3, code: '5B', name: 'Neurology Ward 5B', beds: b5 })
      return { f, round }
    }

    it('[web/ward-round] Ward progress: Two beds visited', async () => {
      const { f, round } = start()
      assert.equal(await round.onPhoto(photo(), card(b5[3]!.qr_token)), 'bed')
      assert.equal(await round.onPhoto(photo(), card(b5[0]!.qr_token)), 'bed')
      assert.equal(await round.onPhoto(photo(), card(b5[3]!.qr_token)), 'bed')
      const visited = new Set(round.getState().visited)
      assert.deepEqual(
        b5.filter((b) => visited.has(b.id)).map((b) => b.bed),
        ['1', '4'],
      )
      assert.ok(f.calls.every((c) => !c.includes('/api/ai')))
    })

    it('[web/ward-round] Ward progress: Card from another ward', async () => {
      const { round } = start()
      await round.onPhoto(photo(), card(b5[0]!.qr_token))
      assert.equal(await round.onPhoto(photo(), card('ward3Abed2token000000')), 'other_ward')
      const s = round.getState()
      assert.equal(s.current?.ward_code, '3A')
      assert.equal(s.current?.bed, '2')
      assert.deepEqual(s.visited, [11])
    })
  })
})

describe('bag readings in the round', () => {
  TOKENS.ward3Abed5token000000 = { id: 35, bed: '5', ward_id: 2, ward_code: '3A' }
  const dup101 = () =>
    Response.json(
      {
        error: 'duplicate_reading',
        duplicate_of: { id: 101, event: 'emptied', volume_ml: 380, created_at: new Date(2026, 10, 3, 11).toISOString() },
      },
      { status: 409 },
    )
  /** A 3A round: urine bags read at 0.9 on beds 3 and 5, each with its read. */
  async function bedsThreeAndFive(f: ReturnType<typeof fake>, ward?: Parameters<Round['setWard']>[0]) {
    const round = new Round(f.api)
    if (ward) round.setWard(ward)
    await round.onPhoto(photo(), card('ward3Abed3token000000'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), card('ward3Abed5token000000'))
    await round.onPhoto(photo(), null)
    await round.idle()
    f.calls.length = 0
    const [bed3, bed5] = round.getState().readings
    return { round, bed3: bed3!, bed5: bed5! }
  }
  const read = (id: number) => ({ ...result('urine_bag', 'urine', 380, 0.9), read_id: id })

  it('[web/ward-round] Bag readings in the round: Per-reading event', async () => {
    const f = fake([read(49), read(50)])
    const { round, bed3, bed5 } = await bedsThreeAndFive(f)
    assert.deepEqual([bed3.bag, bed5.bag], [{ event: 'emptied' }, { event: 'emptied' }])
    round.setBagEvent(bed5.id, 'check')
    assert.equal(await round.saveHighConfidence(), 2)
    assert.deepEqual(f.calls, [
      'POST /api/admissions/31/media',
      'POST /api/admissions/31/bag-readings',
      'POST /api/admissions/35/media',
      'POST /api/admissions/35/bag-readings',
    ])
    assert.deepEqual(
      f.bags.map((b) => [b.event, b.media_id]),
      [
        ['emptied', 500],
        ['check', 501],
      ],
    )
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Bag readings in the round: Bag changed', async () => {
    const f = fake([read(49), read(50)])
    const { round, bed3 } = await bedsThreeAndFive(f)
    round.setBagEvent(bed3.id, 'bag_changed')
    assert.deepEqual(round.getState().readings[0]!.bag, { event: 'bag_changed' })
    await round.save(bed3.id)
    assert.equal(f.bags[0]!.event, 'bag_changed')
  })

  it('[web/ward-round] Bag readings in the round: Catheter interval', async () => {
    const f = fake([read(49), read(50)])
    const catheter: CareOrder = {
      id: 9,
      admission_id: 35,
      kind: 'catheter',
      value: { type: 'urethral', inserted_at: new Date(2026, 9, 29).toISOString(), measure_every_h: 1 },
      start_at: new Date(2026, 10, 2).toISOString(),
      end_at: null,
      set_by: null,
      ended_by: null,
    }
    const item = (id: number, bed: string, orders: CareOrder[]) =>
      ({
        id,
        bed,
        patient: `P${bed}`,
        qr_token: id === 31 ? 'ward3Abed3token000000' : 'ward3Abed5token000000',
        ward_id: 2,
        ward_code: '3A',
        care: { orders, fluid_limit: null, intake_target: null, catheter: null },
      }) satisfies Pick<AdmissionSummary, 'id' | 'bed' | 'patient' | 'qr_token' | 'ward_id' | 'ward_code' | 'care'>
    const beds = [roundBed(item(31, '3', [])), roundBed(item(35, '5', [catheter]))]
    assert.deepEqual(beds[1]!.interval, { h: 1, from: 'catheter' })
    const { round, bed3, bed5 } = await bedsThreeAndFive(f, { id: 2, code: '3A', name: 'General medicine 3A', beds })
    assert.deepEqual([bed3.bag, bed5.bag], [{ event: 'emptied' }, { event: 'check' }])
    await round.saveHighConfidence()
    assert.deepEqual(
      f.bags.map((b) => b.event),
      ['emptied', 'check'],
    )
  })

  it('[web/ward-round] Bag readings in the round: Duplicate', async () => {
    const f = fake([read(49), read(50)], [], (_, admission) => (admission === '31' && f.bags.length === 1 ? dup101() : undefined))
    const { round, bed3 } = await bedsThreeAndFive(f)
    assert.equal(await round.save(bed3.id), null)
    const r = round.getState().readings[0]!
    assert.deepEqual([r.status, r.duplicate?.id], ['ready', 101])
    assert.deepEqual(f.calls, ['POST /api/admissions/31/media', 'POST /api/admissions/31/bag-readings'])
    f.calls.length = 0
    const first = f.bags[0]!
    assert.ok(await round.saveAnyway(bed3.id))
    assert.deepEqual(f.calls, ['POST /api/admissions/31/bag-readings'])
    assert.deepEqual([f.bags[1]!.media_id, f.bags[1]!.read_id], [500, 49])
    assert.deepEqual(f.bags[1], { ...first, confirm_duplicate_of: 101 })
    assert.equal(round.getState().readings[0]!.status, 'saved')
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Bag readings in the round: Saved message', async () => {
    const f = fake([read(49)], [], (body) =>
      Response.json(
        {
          reading: { id: 801, container: 'urine_bag', event: body.event, volume_ml: body.volume_ml, fell: false },
          entry: { id: 900, volume_ml: 120, status: 'pending' },
        },
        { status: 201 },
      ),
    )
    const round = new Round(f.api)
    await round.onPhoto(photo(), card('ward3Abed3token000000'))
    await round.onPhoto(photo(), null)
    await round.idle()
    const [bed3] = round.getState().readings
    await round.save(bed3!.id)
    const saved = round.getState().readings[0]!.saved
    assert.equal(savedText(saved!.bag!), 'Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval.')
  })

  it('[web/ward-round] Save the round: Duplicate left for review', async () => {
    const f = fake([read(49), read(50)], [], (_, admission) => (admission === '31' ? dup101() : undefined))
    const { round } = await bedsThreeAndFive(f)
    assert.equal(await round.saveHighConfidence(), 1)
    assert.deepEqual(
      round.getState().readings.map((r) => r.status),
      ['ready', 'saved'],
    )
    f.calls.length = 0
    assert.equal(await round.saveHighConfidence(), 0)
    assert.deepEqual(
      f.calls.filter((c) => c.includes('/admissions/31/')),
      [],
    )
  })
})

describe('bag readings on beds without the bag', () => {
  TOKENS.ward3Abed5token000000 = { id: 35, bed: '5', ward_id: 2, ward_code: '3A' }
  TOKENS.ward2Cbed3token000000 = { id: 23, bed: '3', ward_id: 1, ward_code: '2C' }
  const devices = (bags: OutputDevices['bags']): OutputDevices => ({
    urine: bags.includes('urine_bag') ? 'catheter' : 'urinal',
    urine_from: bags.includes('urine_bag') ? 'catheter' : 'default',
    urine_measured: true,
    bags,
  })
  /** A ward-list item, as the round's ward list returns it. */
  const item = (id: number, bed: string, token: string, ward: [number, string], d: OutputDevices) =>
    roundBed({
      id,
      bed,
      patient: `P${bed}`,
      qr_token: token,
      ward_id: ward[0],
      ward_code: ward[1],
      care: { orders: [], fluid_limit: null, intake_target: null, catheter: null },
      devices: d,
    })
  const read = (container: ContainerKind, id: number) => ({ ...result(container, 'urine', 380, 0.9), read_id: id })

  it('[web/ward-round] Bag readings on beds without the bag: Default urinal bed', async () => {
    const f = fake([read('urine_bag', 49), read('urine_bag', 50)])
    const round = new Round(f.api)
    round.setWard({
      id: 2,
      code: '3A',
      name: 'General medicine 3A',
      beds: [
        item(31, '3', 'ward3Abed3token000000', [2, '3A'], devices(['urine_bag'])),
        item(35, '5', 'ward3Abed5token000000', [2, '3A'], devices([])),
      ],
    })
    await round.onPhoto(photo(), card('ward3Abed3token000000'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), card('ward3Abed5token000000'))
    await round.onPhoto(photo(), null)
    await round.idle()
    const [bed3, bed5] = round.getState().readings
    assert.equal(bagWarning(bed3!), null)
    assert.equal(bagWarning(bed5!), 'No catheter on the care plan: saving asks the nurse to review.')
    assert.deepEqual(aiCalls(f.calls), ['POST /api/ai/read', 'POST /api/ai/read'])
    f.calls.length = 0
    assert.equal(await round.saveHighConfidence(), 2)
    assert.deepEqual(f.calls, [
      'POST /api/admissions/31/media',
      'POST /api/admissions/31/bag-readings',
      'POST /api/admissions/35/media',
      'POST /api/admissions/35/bag-readings',
    ])
    assert.deepEqual(
      f.bags.map((b) => b.container),
      ['urine_bag', 'urine_bag'],
    )
    assert.deepEqual(aiCalls(f.calls), [])
  })

  it('[web/ward-round] Bag readings on beds without the bag: Stoma bed', async () => {
    const f = fake([read('stoma_bag', 51), read('drain_bag', 52)])
    const round = new Round(f.api)
    round.setWard({
      id: 1,
      code: '2C',
      name: 'Surgical 2C',
      beds: [item(23, '3', 'ward2Cbed3token000000', [1, '2C'], devices(['stoma_bag']))],
    })
    await round.onPhoto(photo(), card('ward2Cbed3token000000'))
    await round.onPhoto(photo(), null)
    await round.onPhoto(photo(), null)
    await round.idle()
    const [stoma, drain] = round.getState().readings
    assert.equal(bagWarning(stoma!), null)
    assert.equal(bagWarning(drain!), 'No drain on the care plan: saving asks the nurse to review.')
  })
})
