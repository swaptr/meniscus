import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdmissionSummary, ContainerReading, Entry, MediaRef, Totals, WardSummary, WardTeam } from '@meniscus/shared'
import { ApiError, createApi, errorText } from './api.ts'
import { canSave, fitWithin, levelContainer, saveEntry, saveLevel, stepVolume, toEntryInput, type Pending } from './capture.ts'
import { stepperNames } from './volume.ts'
import { fakeCopies, mediaAnswers, photoEvidence, SHA } from './copy-fixtures.ts'
import { drawPlan, planTexts } from './labeled-copy.ts'
import { noteEvidence } from './evidence.ts'
import { bedCard } from './qr.ts'
import { approveBatch, filterByAcuity, requestExplanation, wardCard, wardLoads, wardOrder } from './ward.ts'

/** Fake server: records "METHOD path" and answers from `routes`. */
function fake(routes: Record<string, (body: unknown) => Response> = {}) {
  const calls: string[] = []
  const bodies: unknown[] = []
  const api = createApi((url, init) => {
    const key = `${init?.method ?? 'GET'} ${url}`
    calls.push(key)
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    bodies.push(body)
    const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(key))
    return Promise.resolve(hit ? hit[1](body) : Response.json({ error: 'not_found' }, { status: 404 }))
  })
  return { api, calls, bodies }
}

const entry = (over: Partial<Entry> = {}): Entry => ({
  labeled_media: null,
  id: 7,
  admission_id: 1,
  direction: 'out',
  category: 'urine',
  volume_ml: 450,
  item: null,
  notes: null,
  source: 'photo',
  confidence: 0.9,
  status: 'pending',
  created_at: '2026-11-02T12:00:00.000Z',
  reviewed_at: null,
  has_photo: false,
  recorded_ml: 450,
  evidence: null,
  recorded_at: '2026-11-02T12:00:00.000Z',
  late: false,
  created_by: null,
  reviewed_by: null,
  approved_ml: null,
  amended_at: null,
  reject_reason: null,
  urine_colour: null,
  urine_rgb: null,
  media: null,
  levels: null,
  iddsi_level: null,
  drink: null,
  ...over,
})
const photoDraft: Pending = {
  draft: { direction: 'out', category: 'urine', volume_ml: 450, item: null, notes: 'pale yellow' },
  source: 'photo',
  confidence: 0.9,
}
const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })
const mediaRef = (over: Partial<MediaRef> = {}): MediaRef => ({
  id: 31,
  kind: 'photo',
  mime: 'image/jpeg',
  size: 4,
  duration_ms: null,
  created_at: '2026-11-02T12:00:00.000Z',
  sha256: null,
  served_meal: null,
  ...over,
})
/** The form fields of a media upload. */
const fields = (body: unknown) => Object.fromEntries([...(body as FormData).entries()].filter(([, v]) => typeof v === 'string'))

describe('capture', () => {
  it('[web/capture] Photos are shrunk before upload: Large phone photo', () => {
    assert.deepEqual(fitWithin(4032, 3024), { width: 1280, height: 960 })
    assert.deepEqual(fitWithin(3024, 4032), { width: 960, height: 1280 })
  })

  it('[web/capture] Photos are shrunk before upload: Small photo', () => {
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
  })

  it('[web/capture] Draft becomes an entry: Photo draft', () => {
    assert.deepEqual(toEntryInput(photoDraft), {
      direction: 'out',
      category: 'urine',
      volume_ml: 450,
      item: null,
      notes: 'pale yellow',
      source: 'photo',
      confidence: 0.9,
    })
  })

  it('[web/capture] Draft becomes an entry: No volume', () => {
    const p = { ...photoDraft, draft: { ...photoDraft.draft, volume_ml: null } }
    assert.equal(canSave(p), false)
    assert.throws(() => toEntryInput(p))
  })

  it('[web/capture] Draft becomes an entry: Adjust', () => {
    assert.equal(stepVolume(4995, 10), 5000)
    assert.equal(stepVolume(5, -10), 1)
    assert.equal(stepVolume(450, -10), 440)
  })

  it('stepper buttons are named with their field, so two steppers in one form aren\'t both "Less"/"More"', () => {
    assert.deepEqual(stepperNames('Energy target'), { less: 'Less energy target', more: 'More energy target' })
    assert.deepEqual(stepperNames('Protein target'), { less: 'Less protein target', more: 'More protein target' })
    assert.deepEqual(stepperNames('Volume'), { less: 'Less volume', more: 'More volume' })
  })

  it('[web/capture] Photo saved as evidence: Save with photo', async () => {
    const copies = fakeCopies()
    const media = mediaAnswers(31)
    const f = fake({
      'POST /api/admissions/1/media': () => media(),
      'POST /api/admissions/1/entries': (b) =>
        Response.json(entry({ media: mediaRef(), has_photo: true, ...(b as object) }), { status: 201 }),
    })
    const r = await saveEntry(f.api, 1, { ...photoDraft, evidence: photoEvidence('sam+spark') }, { kind: 'photo', blob })
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/media', 'POST /api/admissions/1/entries'])
    assert.equal(fields(f.bodies[0]).kind, 'photo')
    assert.equal(fields(f.bodies[1]).kind, 'photo')
    const body = f.bodies[2] as { media_id?: number; labeled_media_id?: number; evidence?: { image_sha256?: string } }
    assert.equal(body.media_id, 31)
    assert.equal(body.labeled_media_id, 32)
    assert.equal(body.evidence?.image_sha256, SHA)
    // The copy is drawn from the very blob uploaded as the raw.
    assert.equal(copies.draws.length, 1)
    assert.equal(copies.draws[0]!.photo, blob)
    assert.equal(r.entry?.has_photo, true)
    assert.equal(r.warning, undefined)
  })

  it('[web/capture] Labeled copy drawn at the bed: Urine bag copy', async () => {
    const copies = fakeCopies()
    const media = mediaAnswers(31)
    const f = fake({
      'POST /api/admissions/1/media': () => media(),
      'POST /api/admissions/1/entries': (b) => Response.json(entry(b as Partial<Entry>), { status: 201 }),
    })
    await saveEntry(f.api, 1, { ...photoDraft, evidence: photoEvidence('sam+spark') }, { kind: 'photo', blob })
    copies.restore()
    // The second upload is the copy, drawn at the photo's own size with the overlay's labels.
    const plan = drawPlan({ width: 1000, height: 1000 }, copies.draws[0]!.subject)!
    assert.deepEqual([plan.width, plan.height], [1000, 1000])
    assert.deepEqual(planTexts(plan), ['Urine bag', 'Liquid · 46% full ≈ 930 mL'])
    assert.equal((fields(f.bodies[1]) as { kind?: string }).kind, 'photo')
    assert.equal(f.calls.filter((c) => c.includes('/api/ai')).length, 0)
  })

  it('[web/capture] Photo saved as evidence: Save a Spark-only photo', async () => {
    const copies = fakeCopies()
    const media = mediaAnswers(31)
    const f = fake({
      'POST /api/admissions/1/media': () => media(),
      'POST /api/admissions/1/entries': (b) => Response.json(entry(b as Partial<Entry>), { status: 201 }),
    })
    const r = await saveEntry(f.api, 1, { ...photoDraft, evidence: photoEvidence('spark') }, { kind: 'photo', blob })
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/entries'])
    assert.equal((f.bodies[1] as { media_id?: number }).media_id, 31)
    assert.equal('labeled_media_id' in (f.bodies[1] as object), false)
    assert.equal(copies.draws.length, 0)
    assert.equal(r.warning, undefined)
  })

  it('[web/capture] Photo saved as evidence: Photo upload fails', async () => {
    const copies = fakeCopies()
    const f = fake({
      'POST /api/admissions/1/media': () => Response.json({ error: 'internal_error' }, { status: 500 }),
      'POST /api/admissions/1/entries': () => Response.json(entry(), { status: 201 }),
    })
    const r = await saveEntry(f.api, 1, { ...photoDraft, evidence: photoEvidence('sam+spark') }, { kind: 'photo', blob })
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/entries'])
    assert.equal('media_id' in (f.bodies[1] as object), false)
    assert.equal('labeled_media_id' in (f.bodies[1] as object), false)
    assert.equal(copies.draws.length, 0, 'no copy is drawn')
    assert.equal(r.entry?.id, 7)
    assert.match(r.warning ?? '', /photo was not kept/)
  })

  it('[web/capture] Labeled copy drawn at the bed: Copy upload fails', async () => {
    const copies = fakeCopies()
    let n = 0
    const f = fake({
      'POST /api/admissions/1/media': () =>
        n++ === 0 ? Response.json(mediaRef(), { status: 201 }) : Response.json({ error: 'internal_error' }, { status: 500 }),
      'POST /api/admissions/1/entries': () => Response.json(entry(), { status: 201 }),
    })
    const p = { ...photoDraft, evidence: photoEvidence('sam+spark') }
    const r = await saveEntry(f.api, 1, p, { kind: 'photo', blob })
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/media', 'POST /api/admissions/1/entries'])
    assert.equal((f.bodies[2] as { media_id?: number }).media_id, 31)
    assert.equal('labeled_media_id' in (f.bodies[2] as object), false)
    assert.equal(r.warning, 'Labeled copy not kept')
    // A second save of the same photo never resends either upload.
    await saveEntry(f.api, 1, p, { kind: 'photo', blob })
    copies.restore()
    assert.equal(f.calls.filter((c) => c.endsWith('/media')).length, 2)
    // A failed draw is the same: saved with the photo, the copy not kept.
    const drawFails = fakeCopies({ fail: true })
    const g = fake({
      'POST /api/admissions/1/media': () => Response.json(mediaRef(), { status: 201 }),
      'POST /api/admissions/1/entries': () => Response.json(entry(), { status: 201 }),
    })
    const r2 = await saveEntry(g.api, 1, p, { kind: 'photo', blob: new Blob([blob]) })
    drawFails.restore()
    assert.deepEqual(g.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/entries'])
    assert.equal(r2.warning, 'Labeled copy not kept')
  })

  const voiceDrafts = (): Pending[] => {
    const note = { transcript: 'bed 1 had tea 200 mL and passed 300 mL urine', entries: [], reply: null, trace: [] }
    return [
      { direction: 'in', category: 'water', volume_ml: 200, item: 'tea', notes: null },
      { direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: null },
    ].map((draft) => ({
      draft: draft as Pending['draft'],
      source: 'voice' as const,
      confidence: null,
      evidence: noteEvidence(note, 'voice', note.transcript, draft.volume_ml),
    }))
  }
  const audio = () => new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' })

  it('[web/capture] Recording saved as evidence: Two drafts, one recording', async () => {
    const f = fake({
      'POST /api/admissions/1/media': () =>
        Response.json(mediaRef({ id: 44, kind: 'voice', mime: 'audio/webm', duration_ms: 4200 }), { status: 201 }),
      'POST /api/admissions/1/entries': () => Response.json(entry({ source: 'voice' }), { status: 201 }),
    })
    const recording = { kind: 'voice' as const, blob: audio(), duration_ms: 4200 }
    for (const p of voiceDrafts()) assert.equal((await saveEntry(f.api, 1, p, recording)).warning, undefined)
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/entries', 'POST /api/admissions/1/entries'])
    assert.deepEqual(fields(f.bodies[0]), { kind: 'voice', duration_ms: '4200' })
    assert.deepEqual(
      f.bodies.slice(1).map((b) => (b as { media_id?: number }).media_id),
      [44, 44],
    )
  })

  it('[web/capture] Recording saved as evidence: Recording not kept', async () => {
    const f = fake({
      'POST /api/admissions/1/media': () => Response.json({ error: 'internal_error' }, { status: 500 }),
      'POST /api/admissions/1/entries': () => Response.json(entry({ source: 'voice' }), { status: 201 }),
    })
    const recording = { kind: 'voice' as const, blob: audio(), duration_ms: 4200 }
    const results = []
    for (const p of voiceDrafts()) results.push(await saveEntry(f.api, 1, p, recording))
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/entries', 'POST /api/admissions/1/entries'])
    assert.equal(f.calls.filter((c) => c.endsWith('/media')).length, 1)
    assert.ok(f.bodies.slice(1).every((b) => !('media_id' in (b as object))))
    for (const r of results) assert.match(r.warning ?? '', /recording was not kept/)
  })

  it('[web/capture] Recording too long: Long recording refused', async () => {
    const f = fake({
      'POST /api/ai/voice-note': () =>
        Response.json(
          {
            error: 'audio_too_long',
            message: 'audio is 601000 ms; limit is 600000 ms',
            retryable: false,
            duration_ms: 601000,
            limit_ms: 600000,
          },
          { status: 422 },
        ),
    })
    const err = await f.api.voiceNote(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' }), 4).catch((e) => e)
    assert.ok(err instanceof ApiError)
    assert.equal(errorText(err), 'Recording over 10 minutes. Record a shorter note.')
    assert.deepEqual(
      f.calls.filter((c) => c.includes('/api/ai/')),
      ['POST /api/ai/voice-note'],
    )
  })

  it('[web/capture] Jug photos record levels: Volume typed over the read', async () => {
    const f = fake({
      'POST /api/admissions/1/media': (
        (m) => () =>
          m()
      )(mediaAnswers(31)),
      'POST /api/admissions/1/levels': () =>
        Response.json(
          {
            level: { id: 1, admission_id: 1, container: 'water_jug', volume_ml: 550, created_at: '', media: mediaRef() },
            previous_ml: null,
            entry: null,
          },
          { status: 201 },
        ),
    })
    const copies = fakeCopies()
    const evidence = photoEvidence('sam+spark', 'water_jug', 'water', 600)
    await saveLevel(f.api, 1, 'water_jug', 550, 0.85, { kind: 'photo', blob }, evidence)
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/media', 'POST /api/admissions/1/levels'])
    const body = f.bodies[2] as { volume_ml: number; labeled_media_id?: number }
    assert.deepEqual([body.volume_ml, body.labeled_media_id], [550, 32])
    const subject = copies.draws[0]!.subject
    assert.equal(subject.kind === 'photo' && subject.evidence.reading.volume_ml, 600)
  })

  it('[web/capture] Jug photos record levels: Water jug reading', async () => {
    const reading: ContainerReading = {
      container: 'water_jug',
      fluid: 'water',
      volume_ml: 600,
      capacity_ml: 1000,
      marks_visible: true,
      reading_basis: 'at 600 mark',
      appearance: null,
      confidence: 0.85,
      issues: [],
    }
    assert.equal(levelContainer(reading), 'water_jug')
    assert.equal(levelContainer({ ...reading, container: 'urine_bag' }), null)
    const f = fake({
      'POST /api/admissions/1/media': (
        (m) => () =>
          m()
      )(mediaAnswers(31)),
      'POST /api/admissions/1/levels': () =>
        Response.json(
          {
            level: { id: 1, admission_id: 1, container: 'water_jug', volume_ml: 600, created_at: '', media: mediaRef() },
            previous_ml: null,
            entry: null,
          },
          { status: 201 },
        ),
    })
    const copies = fakeCopies()
    const evidence = photoEvidence('sam+spark', 'water_jug', 'water', 600)
    const r = await saveLevel(f.api, 1, 'water_jug', 600, 0.85, { kind: 'photo', blob }, evidence)
    copies.restore()
    assert.deepEqual(f.calls, ['POST /api/admissions/1/media', 'POST /api/admissions/1/media', 'POST /api/admissions/1/levels'])
    assert.equal(fields(f.bodies[0]).kind, 'photo')
    assert.equal(fields(f.bodies[1]).kind, 'photo')
    assert.deepEqual(f.bodies[2], {
      container: 'water_jug',
      volume_ml: 600,
      source: 'photo',
      confidence: 0.85,
      evidence,
      media_id: 31,
      labeled_media_id: 32,
    })
    assert.equal(r.entry, null)
  })
})

const totals: Totals = { in_ml: 0, out_ml: 0, balance_ml: 0, pending_ml: 0 }
const bed = (n: number, alerts: number, pending: number): AdmissionSummary => ({
  id: n,
  bed: String(n),
  patient: `P${n}`,
  weight_kg: 60,
  qr_token: `t${n}`,
  admitted_at: '',
  ward_id: 1,
  ward_code: '5B',
  ward_name: 'Neurology Ward 5B',
  mrn: `AT-10000${n}`,
  totals,
  pending,
  alerts: Array.from({ length: alerts }, () => ({ kind: 'overload' as const, message: '' })),
  hourly: { in_ml: Array<number>(24).fill(0), out_ml: Array<number>(24).fill(0), in_logged: Array<number>(24).fill(0) },
  urine_seen: null,
  care: { orders: [], fluid_limit: null, intake_target: null, catheter: null },
  devices: { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] },
  acuity: { level: 'stable', source: 'ward', order_id: null, suggested: null, reasons: [] },
  nutrition: { dietitian_available: true, dietitian: null, referral: null },
})

describe('ward', () => {
  it('[web/ward] Beds needing attention first: Mixed ward', () => {
    const ward = [bed(1, 0, 0), bed(2, 0, 4), bed(3, 2, 0), bed(4, 0, 0), bed(5, 1, 0), bed(6, 0, 0)]
    assert.deepEqual(
      wardOrder(ward).map((a) => a.bed),
      ['3', '5', '2', '1', '4', '6'],
    )
  })

  /** The ward of "Acuity first". */
  const acuityWard = (): AdmissionSummary[] => {
    const at = (
      b: AdmissionSummary,
      over: Partial<AdmissionSummary['acuity']>,
      kinds: AdmissionSummary['alerts'][number]['kind'][] = [],
    ) => ({
      ...b,
      acuity: { ...b.acuity, ...over },
      alerts: kinds.map((kind) => ({ kind, message: '' }) as AdmissionSummary['alerts'][number]),
    })
    return [
      at(bed(1, 0, 3), { level: 'watch', source: 'order', order_id: 1 }),
      bed(2, 0, 4),
      at(bed(3, 0, 0), {}, ['catheter_review', 'drink_consistency_unrecorded']),
      at(bed(4, 0, 0), { suggested: 'critical', reasons: ['low_urine_output'] }, ['low_urine_output', 'mismatch']),
      bed(5, 0, 0),
      at(bed(6, 0, 0), { level: 'critical', source: 'order', order_id: 2 }),
    ]
  }

  it('[web/ward] Beds needing attention first: Acuity first', () => {
    assert.deepEqual(
      wardOrder(acuityWard()).map((a) => a.bed),
      ['4', '6', '1', '3', '2', '5'],
    )
  })

  it('[web/ward] Acuity on bed cards: Critical filter', () => {
    const f = fake()
    const ordered = wardOrder(acuityWard())
    assert.deepEqual(
      filterByAcuity(ordered, 'critical').map((a) => a.bed),
      ['4', '6'],
    )
    assert.deepEqual(
      filterByAcuity(ordered, 'all').map((a) => a.bed),
      ['4', '6', '1', '3', '2', '5'],
    )
    assert.deepEqual(f.calls, [])
  })

  it('[web/ward] Batch approve high confidence: Queue of four', async () => {
    const f = fake({ 'POST /api/entries/\\d+/review': (b) => Response.json({ ...entry(), ...(b as object), status: 'approved' }) })
    const queue = [
      entry({ id: 1, confidence: 0.9 }),
      entry({ id: 2, confidence: 0.75 }),
      entry({ id: 3, confidence: 0.6 }),
      entry({ id: 4, confidence: null }),
    ]
    assert.equal(await approveBatch(f.api, queue), 2)
    assert.deepEqual(f.calls, ['POST /api/entries/1/review', 'POST /api/entries/2/review'])
    assert.deepEqual(f.bodies, [{ action: 'approve' }, { action: 'approve' }])
  })

  it('[web/ward] Explain on request: Tap explain', async () => {
    const f = fake({ 'POST /api/ai/explain': () => Response.json({ text: 'Review.', trace: [] }) })
    assert.equal(await requestExplanation(f.api, { id: 3, alerts: [] }), null)
    assert.deepEqual(f.calls, [])
    const r = await requestExplanation(f.api, { id: 3, alerts: [{}] })
    assert.equal(r?.text, 'Review.')
    assert.deepEqual(f.calls, ['POST /api/ai/explain'])
    assert.deepEqual(f.bodies, [{ admission_id: 3 }])
  })
})

describe('bed cards', () => {
  it('[web/bed-qr] Bed card link: Bed 4 card', () => {
    const card = bedCard({ bed: '4', qr_token: 'abc_DEF-123', ward_code: '5B', ward_name: 'Neurology Ward 5B' }, 'https://ward.example')
    assert.equal(card.url, 'https://ward.example/a/bed/abc_DEF-123')
    assert.equal(card.label, '5B · Bed 4')
    assert.equal(card.ward, 'Neurology Ward 5B')
    assert.match(card.svg, /^<svg/)
    assert.doesNotMatch(`${card.label} ${card.ward} ${card.svg}`, /Tomas Silva|AT-1005/)
  })
})

describe('hospital wards', () => {
  const NOW = Date.UTC(2026, 10, 2, 12)
  const ward = (over: Partial<WardSummary>): WardSummary => ({
    id: 3,
    code: '5B',
    name: 'Neurology Ward 5B',
    specialty: 'Neurology',
    capacity: 6,
    default_acuity: 'stable',
    occupied: 6,
    pending: 0,
    beds_with_alerts: 0,
    last_entry_at: null,
    in_charge: null,
    ...over,
  })

  it('[web/ward] Hospital ward list: Busy ward', () => {
    const card = wardCard(
      ward({
        pending: 3,
        beds_with_alerts: 4,
        last_entry_at: new Date(NOW - 12 * 60_000).toISOString(),
        in_charge: { id: 5, name: 'Grace Lee', role: 'nurse' },
      }),
      NOW,
    )
    assert.deepEqual(card, {
      title: 'Neurology Ward 5B',
      beds: '6/6 beds',
      pending: '3 pending',
      review: '4 to review',
      activity: '12 min ago',
      in_charge: 'In charge: Grace L.',
    })
  })

  it('[web/ward] Hospital ward list: Quiet ward', () => {
    const card = wardCard(ward({ code: 'HDU', name: 'Renal HDU', capacity: 4, occupied: 3 }), NOW)
    assert.equal(card.beds, '3/4 beds')
    assert.equal(card.pending, 'All reviewed')
    assert.equal(card.review, null)
    assert.equal(card.activity, 'No entries today')
    assert.equal(card.in_charge, 'No nurse in charge')
    assert.equal(wardCard(ward({ last_entry_at: new Date(NOW - 20_000).toISOString() }), NOW).activity, 'just now')
    assert.equal(wardCard(ward({ last_entry_at: new Date(NOW - 3.5 * 3_600_000).toISOString() }), NOW).activity, '3 h ago')
  })

  it('[web/ward] Ward dashboard per ward: Open ward 5B', async () => {
    // Grace Lee (home ward 5B) opens the dashboard of ward 3: its two loaders, as the route runs them.
    const team: WardTeam = { ward_id: 3, shift_start: new Date(NOW).toISOString(), in_charge: null, team: [], assignments: [] }
    const f = fake({ 'GET /api/admissions\\?ward=3': () => Response.json([]), 'GET /api/wards/3/team': () => Response.json(team) })
    const load = wardLoads(f.api, 3)
    const signal = new AbortController().signal
    assert.deepEqual(await Promise.all([load.beds(signal), load.team(signal)]), [[], team])
    assert.deepEqual(f.calls, ['GET /api/admissions?ward=3', 'GET /api/wards/3/team'])
    // A later refresh of the beds repeats only the admissions.
    await load.beds(signal)
    assert.deepEqual(f.calls, ['GET /api/admissions?ward=3', 'GET /api/wards/3/team', 'GET /api/admissions?ward=3'])
  })
})
