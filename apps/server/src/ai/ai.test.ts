import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { needsReview, toDraft } from './draft.ts'
import { locate, maskGeometry, type SamInstance } from './segmentation.ts'
import { nullableText } from './text.ts'
import type { AudioTooLong, CaptureReadResult, NoteResult } from '@meniscus/shared'
import { createHash } from 'node:crypto'
import { SAM_RECT, dataUrl, imageOf, jpeg, msg, png, reading, resp, silenceWav, testApp, upstream, useBudget } from '../testing.ts'
import { createAi } from './pipeline.ts'
import { ReadingSchema } from './reading.ts'
import { servedCheck } from './compare.ts'
import type { AiPorts } from './ports.ts'
import { parseConfig } from '../config.ts'
import { requestLogLine } from '../model-api.ts'
import { unhandledLogLine } from '../app.ts'
import { MetaApiError } from '@meniscus/meta'

const inst = (box: SamInstance['box'], confidence = 0.9, area = 100): SamInstance => ({
  box,
  confidence,
  maskTop: box.top,
  maskBottom: box.bottom,
  area,
})

describe('MEAL_USE_SAM', () => {
  it('defaults to true, and "false" turns tray SAM off', () => {
    assert.equal(parseConfig({}).MEAL_USE_SAM, true)
    assert.equal(parseConfig({ MEAL_USE_SAM: 'false' }).MEAL_USE_SAM, false)
  })
})

describe('maskGeometry', () => {
  it('finds tight vertical extent and scales to source pixels', () => {
    // 4x4 mask over a 40x40 box; rows 1..2 filled.
    const raster = [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0]
    const g = maskGeometry(raster, 4, 4, { left: 100, top: 200, right: 140, bottom: 240 })
    assert.equal(g.maskTop, 210)
    assert.equal(g.maskBottom, 230)
    assert.equal(g.area, 600) // 6 px × 10 × 10
  })

  it('falls back to box on an empty mask', () => {
    const g = maskGeometry([0, 0, 0, 0], 2, 2, { left: 0, top: 5, right: 10, bottom: 15 })
    assert.deepEqual([g.maskTop, g.maskBottom, g.area], [5, 15, 0])
  })
})

describe('locate', () => {
  const jug = { left: 0, top: 0, right: 100, bottom: 200 }
  it('[capture/photo-reading] Fill fraction from segmentation: half-full jug with liquid elsewhere in the frame', () => {
    const outside = inst({ left: 300, top: 0, right: 400, bottom: 50 }, 0.99)
    const inside = inst({ left: 10, top: 100, right: 90, bottom: 200 }, 0.8)
    const s = locate([inst(jug)], [outside, inside])
    assert.equal(s.fluid?.left, 10)
    assert.equal(s.fill_fraction, 0.5)
  })
  it('[capture/photo-reading] Fill fraction from segmentation: nothing found', () => {
    assert.deepEqual(locate([], []), { container: null, fluid: null, fill_fraction: null })
  })
})

describe('toDraft', () => {
  it('[capture/photo-reading] Draft entry from reading: urine bag', () => {
    assert.deepEqual(toDraft(reading()), {
      direction: 'out',
      category: 'urine',
      volume_ml: 450,
      item: 'urine bag',
      notes: 'pale yellow, clear',
      drink: null,
    })
  })
  it('[capture/photo-reading] Draft entry from reading: tea in a cup', () => {
    const d = toDraft(reading({ container: 'cup', fluid: 'tea', drink_name: null, volume_ml: 200, appearance: null }))
    assert.deepEqual(d, { direction: 'in', category: 'water', volume_ml: 200, item: 'Tea', notes: null, drink: 'tea' })
  })
  it('[capture/photo-reading] Draft entry from reading: masala chai', () => {
    const d = toDraft(reading({ container: 'cup', fluid: 'tea', drink_name: 'masala chai', volume_ml: 150, appearance: 'light brown' }))
    assert.equal(d?.category, 'water')
    assert.equal(d?.item, 'masala chai')
    assert.equal(d?.drink, 'tea')
    assert.ok(Object.values(d ?? {}).every((v) => typeof v !== 'string' || !v.includes('cup')))
  })
  it('[capture/photo-reading] Draft entry from reading: soup in a cup', () => {
    const d = toDraft(reading({ container: 'cup', fluid: 'soup', drink_name: null, volume_ml: 180 }))
    assert.deepEqual(d && { direction: d.direction, category: d.category, item: d.item, drink: d.drink }, {
      direction: 'in',
      category: 'food',
      item: 'Soup',
      drink: 'soup',
    })
  })
  it('[capture/photo-reading] Draft entry from reading: unnamed liquid in a cup', () => {
    const d = toDraft(reading({ container: 'cup', fluid: 'other', drink_name: null, volume_ml: 120 }))
    assert.deepEqual(d && { category: d.category, drink: d.drink, item: d.item }, { category: 'water', drink: 'other', item: null })
  })
  it('[capture/photo-reading] Draft entry from reading: unknown liquid in a stoma bag', () => {
    const d = toDraft(reading({ container: 'stoma_bag', fluid: 'other' }))
    assert.deepEqual(d && { category: d.category, item: d.item, drink: d.drink }, { category: 'stoma', item: 'stoma bag', drink: null })
  })
  it('[capture/photo-reading] Draft entry from reading: nothing chartable', () => {
    assert.equal(toDraft(reading({ container: 'none', fluid: 'none' })), null)
  })
})

describe('needsReview', () => {
  it('[capture/photo-reading] Review gate: confident and consistent', () => {
    assert.deepEqual(needsReview(reading({ volume_ml: 1000, capacity_ml: 2000 }), 0.55), [])
  })
  it('[capture/photo-reading] Review gate: each trigger alone', () => {
    assert.equal(needsReview(reading({ confidence: 0.5 }), null).length, 1)
    assert.equal(needsReview(reading({ marks_visible: false }), null).length, 1)
    assert.equal(needsReview(reading({ volume_ml: null }), null).length, 1)
    assert.equal(needsReview(reading({ volume_ml: 1800, capacity_ml: 2000 }), 0.2).length, 1)
  })
})

describe('nullableText', () => {
  it('[capture/notes] Entries from a note: null-like strings', () => {
    assert.equal(nullableText.parse('null'), null)
    assert.equal(nullableText.parse(' N/A '), null)
    assert.equal(nullableText.parse(null), null)
    assert.equal(nullableText.parse(' cloudy '), 'cloudy')
  })
})

describe('readCapture', () => {
  it('[capture/photo-reading] Grounded reading: urine bag photo', async () => {
    let prompt = ''
    const u = upstream({
      spark: (body) => {
        prompt = body.input[0].content[0].text
        return resp('muse-spark-1.3', [msg(JSON.stringify(reading()))])
      },
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'urine_bag', mode: 'sam+spark' })
    assert.deepEqual(u.requests.sort(), ['sam:liquid', 'sam:urine bag', 'spark:object'])
    assert.ok(r.segmentation?.container && r.segmentation.fluid)
    assert.match(prompt, /Segmentation: container spans/)
    assert.deepEqual(
      r.trace.map((t) => t.step),
      ['sam:container', 'sam:liquid', 'spark:read'],
    )
    assert.equal(r.trace[2]!.input_tokens, 100)
    assert.equal(r.draft?.category, 'urine')
  })

  it('[capture/photo-reading] Spark-only reading: spark mode', async () => {
    const u = upstream()
    await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
  })

  it('[capture/photo-reading] Segmentation failure degrades: SAM overloaded', async () => {
    const u = upstream({ sam: () => Response.json({ error: { message: 'overloaded', code: 'service_overloaded' } }, { status: 503 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'sam+spark' })
    assert.equal(r.segmentation, null)
    assert.match(r.warnings[0] ?? '', /segmentation unavailable/)
    assert.equal(u.requests.filter((x) => x.startsWith('sam:')).length, 2)
    assert.equal(r.reading.volume_ml, 1000)
  })

  it('[capture/photo-reading] Empty segmentation warns: nothing segmented', async () => {
    const u = upstream({ sam: () => resp('sam-3.1', [msg('')]) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'sam+spark' })
    assert.deepEqual(r.warnings.slice(0, 2), ['segmentation found no container', 'segmentation found no liquid'])
  })
})

describe('photo read names its image', () => {
  /** A 48,213-byte JPEG: SOI, zero padding, EOI. */
  const big = (() => {
    const b = new Uint8Array(48_213)
    b.set([0xff, 0xd8, 0xff], 0)
    b.set([0xff, 0xd9], b.length - 2)
    return b
  })()
  const want = createHash('sha256').update(big).digest('hex')
  const read = async (mode: 'sam+spark' | 'spark', log?: (line: string) => void) => {
    const u = upstream({ log })
    const form = new FormData()
    form.append('image', new File([big], 'bag.jpg', { type: 'image/jpeg' }))
    form.append('hint', 'urine_bag')
    form.append('mode', mode)
    const res = await (await testApp({ ai: u.ai })).request('/api/ai/read', { method: 'POST', body: form })
    assert.equal(res.status, 200)
    return { u, body: (await res.json()) as CaptureReadResult }
  }

  it('[capture/photo-reading] Photo read names its image: Urine bag read', async () => {
    const { u, body } = await read('sam+spark')
    assert.match(body.image_sha256, /^[0-9a-f]{64}$/)
    assert.equal(body.image_sha256, want)
    assert.equal(u.requests.length, 3)
  })

  it('[capture/photo-reading] Photo read names its image: Spark mode', async () => {
    const { u, body } = await read('spark')
    assert.equal(body.segmentation, null)
    assert.equal(body.image_sha256, want)
    assert.equal(u.requests.length, 1)
  })

  it('[capture/photo-reading] Photo read names its image: Not in the log', async () => {
    const logged: string[] = []
    const { log, error, info, warn } = console
    const keep = (...a: unknown[]) => void logged.push(a.map(String).join(' '))
    Object.assign(console, { log: keep, error: keep, info: keep, warn: keep })
    let body: CaptureReadResult
    try {
      ;({ body } = await read('sam+spark', keep))
    } finally {
      Object.assign(console, { log, error, info, warn })
    }
    assert.equal(body.image_sha256, want)
    assert.ok(logged.length >= 3, 'the request lines were captured')
    for (const line of logged) assert.ok(!line.includes(want), 'a log line holds the image hash')
  })
})

describe('notes', () => {
  it('[capture/notes] Entries from a note: coconut water', async () => {
    const u = upstream()
    const r = await u.ai.parseNote({ text: 'coconut water 200' })
    assert.deepEqual(u.requests, ['spark:tool'])
    assert.equal(r.entries[0]?.notes, null)
    assert.equal(r.entries[0]?.volume_ml, 200)
  })

  it('[capture/notes] Voice note: recorded note', async () => {
    const u = upstream()
    const r = await u.ai.voiceNote({ audio: silenceWav() })
    assert.deepEqual(u.requests, ['asr', 'spark:tool'])
    assert.equal(r.transcript, 'bed 4 had a coconut water, 200 mL')
    assert.equal(r.trace.length, 2)
  })

  it('[capture/notes] Voice note timing: Two turns', async () => {
    const u = upstream({
      asr: () =>
        Response.json({
          sessionId: 's',
          transcript: 'bed 4 had a coconut water 200 mL',
          audioDurationMs: 4200,
          turns: [
            { turnId: 0, startMs: 0, endMs: 1800, transcript: 'bed 4 had a coconut water' },
            { turnId: 1, startMs: 1900, endMs: 4100, transcript: ' 200 mL ' },
          ],
        }),
    })
    const form = new FormData()
    form.append('audio', new File([silenceWav()], 'note.wav', { type: 'audio/wav' }))
    const res = await (await testApp({ ai: u.ai })).request('/api/ai/voice-note', { method: 'POST', body: form })
    assert.equal(res.status, 200)
    const body = (await res.json()) as NoteResult
    assert.equal(u.asrRequests.length, 1)
    assert.equal(u.asrRequests[0]!.mode, 'ENDPOINTING')
    assert.equal(body.duration_ms, 4200)
    assert.deepEqual(body.turns, [
      { start_ms: 0, end_ms: 1800, text: 'bed 4 had a coconut water' },
      { start_ms: 1900, end_ms: 4100, text: '200 mL' },
    ])
    assert.deepEqual(u.requests, ['asr', 'spark:tool'])
  })

  it('[capture/notes] Voice note timing: no turns detected', async () => {
    const u = upstream()
    const r = await u.ai.voiceNote({ audio: silenceWav() })
    assert.deepEqual([r.duration_ms, r.turns], [2000, []])
    assert.deepEqual(u.requests, ['asr', 'spark:tool'])
  })
})

describe('HTTP', () => {
  const post = (app: Awaited<ReturnType<typeof testApp>>, path: string, body: FormData | object) =>
    app.request(path, {
      method: 'POST',
      ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    })

  it('[capture/photo-reading] Upload validation: text file uploaded', async () => {
    const u = upstream()
    const form = new FormData()
    form.append('image', new File(['x'], 'a.txt', { type: 'text/plain' }))
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/read', form)
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_request')
    assert.equal(u.requests.length, 0)
  })

  it('[capture/photo-reading] Upload validation: Photo over 8 MB', async () => {
    const u = upstream()
    const app = await testApp({ ai: u.ai })
    const send = async (n: number) => {
      const big = new Uint8Array(n)
      big.set(jpeg)
      const form = new FormData()
      form.append('image', new File([big], 'a.jpg', { type: 'image/jpeg' }))
      form.append('mode', 'spark')
      return post(app, '/api/ai/read', form)
    }
    const over = await send(9 * 1024 * 1024)
    assert.equal(over.status, 400)
    const body = (await over.json()) as { error: string; issues: { message: string }[] }
    assert.equal(body.error, 'invalid_request')
    assert.deepEqual(
      body.issues.map((i) => i.message),
      ['image must be 1 B – 8 MB'],
    )
    assert.equal(u.requests.length, 0)
    // Exactly 8 MiB is within the limit (1 Spark request in spark mode).
    assert.equal((await send(8 * 1024 * 1024)).status, 200)
    assert.equal(u.requests.length, 1)
  })

  it('reads an image end to end', async () => {
    const form = new FormData()
    form.append('image', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    form.append('hint', 'urine_bag')
    form.append('mode', 'spark')
    const res = await post(await testApp({ ai: upstream().ai }), '/api/ai/read', form)
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { draft: { category: string } }).draft.category, 'urine')
  })

  it('[model-api/http-errors] Rate limits pass through: spark rate limited', async () => {
    const u = upstream({
      spark: () =>
        Response.json(
          { error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limit_exceeded' } },
          { status: 429, headers: { 'retry-after': '12' } },
        ),
    })
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/note', { text: 'drank tea' })
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('retry-after'), '12')
    const body = (await res.json()) as { retryable: boolean; code: string }
    assert.equal(body.retryable, true)
    assert.equal(body.code, 'rate_limit_exceeded')
  })

  it('[model-api/http-errors] Upstream auth is ours: bad key', async () => {
    const u = upstream({
      spark: () => Response.json({ error: { message: 'bad key', type: 'authentication_error', code: 'invalid_api_key' } }, { status: 401 }),
    })
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/note', { text: 'drank tea' })
    assert.equal(res.status, 502)
  })

  it('[model-api/http-errors] Invalid model output: unknown container', async () => {
    const u = upstream({ spark: () => resp('muse-spark-1.3', [msg('{"container":"spaceship"}')]) })
    const form = new FormData()
    form.append('image', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    form.append('mode', 'spark')
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/read', form)
    assert.equal(res.status, 502)
    const body = (await res.json()) as { error: string; issues: string[] }
    assert.equal(body.error, 'model_output_invalid')
    assert.ok(body.issues.length > 0)
  })

  const voiceForm = (ms: number, admissionId?: number) => {
    const form = new FormData()
    form.append('audio', new File([silenceWav(ms)], 'note.wav', { type: 'audio/wav' }))
    if (admissionId !== undefined) form.append('admission_id', String(admissionId))
    return form
  }
  const bed4 = async (t: Awaited<ReturnType<typeof testApp>>) =>
    (await t.store.admissions()).find((a) => a.ward_code === '3A' && a.bed === '4')!.id

  it('[capture/notes] Recording length limit: Ten minutes and one second', async () => {
    const u = upstream()
    const t = await testApp({ ai: u.ai })
    const res = await post(t, '/api/ai/voice-note', voiceForm(601_000, await bed4(t)))
    assert.equal(res.status, 422)
    const body = (await res.json()) as AudioTooLong
    assert.deepEqual(body, {
      error: 'audio_too_long',
      message: 'audio is 601000 ms; limit is 600000 ms',
      retryable: false,
      duration_ms: 601000,
      limit_ms: 600000,
    })
    assert.deepEqual(u.requests, [])
    assert.equal(await t.store.read(1), undefined, 'no read stored')
  })

  it('[capture/notes] Recording length limit: Ten minutes exactly', async () => {
    const u = upstream()
    const t = await testApp({ ai: u.ai })
    const res = await post(t, '/api/ai/voice-note', voiceForm(600_000, await bed4(t)))
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as NoteResult).transcript, 'bed 4 had a coconut water, 200 mL')
    assert.deepEqual(u.requests, ['asr', 'spark:tool'])
  })

  it('[capture/notes] Recording length limit: Too long while the budget is spent', async () => {
    const u = upstream({ budget: { perHour: 2 } })
    useBudget(u.client.budget, 2)
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/voice-note', voiceForm(601_000))
    assert.equal(res.status, 422)
    assert.equal(((await res.json()) as AudioTooLong).error, 'audio_too_long')
    assert.deepEqual(u.requests, [])
  })

  const upstreamError = (status: number, body: string) => () =>
    new Response(body, { status, headers: body ? { 'content-type': 'application/json' } : {} })
  const serverError = JSON.stringify({ error: { message: 'oops', type: 'server_error' } })

  for (const [name, upstreamStatus, body, status, retryable] of [
    ['Spark unavailable', 503, serverError, 503, true],
    ['Spark internal error', 500, serverError, 502, true],
    ['Bad gateway upstream', 502, '', 502, false],
  ] as const) {
    it(`[model-api/http-errors] Retry verdict passes through: ${name}`, async () => {
      const u = upstream({ spark: upstreamError(upstreamStatus, body) })
      const res = await post(await testApp({ ai: u.ai }), '/api/ai/note', { text: 'drank tea' })
      assert.equal(res.status, status)
      const got = (await res.json()) as { error: string; upstream_status: number; retryable: boolean }
      assert.deepEqual([got.error, got.upstream_status, got.retryable], ['model_api_error', upstreamStatus, retryable])
      assert.deepEqual(u.requests, ['spark:tool'])
    })
  }

  it('[capture/notes] Undecodable audio: not audio', async () => {
    const u = upstream()
    const form = new FormData()
    form.append('audio', new File(['not audio'], 'a.webm', { type: 'audio/webm' }))
    const res = await post(await testApp({ ai: u.ai }), '/api/ai/voice-note', form)
    assert.equal(res.status, 422)
    assert.equal(u.requests.length, 0)
  })
})

describe('urine colour', () => {
  it('[capture/photo-reading] Urine colour read: Dark urine in a bag', async () => {
    let schema: Record<string, any> = {}
    const u = upstream({
      spark: (body) => {
        schema = body.text.format.schema
        return resp('muse-spark-1.3', [msg(JSON.stringify({ ...reading(), urine_colour: 'dark', urine_rgb: '#C9952F' }))])
      },
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'urine_bag', mode: 'sam+spark' })
    assert.deepEqual(u.requests.sort(), ['sam:liquid', 'sam:urine bag', 'spark:object'])
    assert.ok(schema.required.includes('urine_colour') && schema.required.includes('urine_rgb'))
    assert.equal(r.draft?.urine_colour, 'dark')
    assert.equal(r.draft?.urine_rgb, '#c9952f')
    assert.equal(r.reading.urine_rgb, '#c9952f')
  })

  it('[capture/photo-reading] Urine colour read: Not urine', async () => {
    const u = upstream({
      spark: () =>
        resp('muse-spark-1.3', [
          msg(JSON.stringify({ ...reading({ container: 'water_jug', fluid: 'water' }), urine_colour: 'yellow', urine_rgb: '#ecd558' })),
        ]),
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
    assert.equal(r.reading.urine_colour, null)
    assert.equal(r.reading.urine_rgb, null)
    assert.equal(r.draft?.urine_colour ?? null, null)
    assert.equal(r.draft?.urine_rgb ?? null, null)
  })

  it('[capture/photo-reading] Urine colour read: Not a hex colour', async () => {
    const u = upstream({
      spark: () => resp('muse-spark-1.3', [msg(JSON.stringify({ ...reading(), urine_colour: 'dark', urine_rgb: 'amber' }))]),
    })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.equal(r.draft?.urine_colour, 'dark')
    assert.equal(r.draft?.urine_rgb, null)
  })

  const noteCall = (args: Record<string, unknown>) => () =>
    resp('muse-spark-1.3', [{ type: 'function_call', call_id: 'c1', name: 'log_entry', arguments: JSON.stringify(args) }])

  it('[capture/notes] Urine colour from a note: Dark urine noted', async () => {
    let tool: Record<string, any> = {}
    const u = upstream({
      spark: (body) => {
        tool = body.tools[0]
        return noteCall({ direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: 'dark', urine_colour: 'dark' })()
      },
    })
    const r = await u.ai.parseNote({ text: 'bed 3 passed 300 mL dark urine' })
    assert.deepEqual(u.requests, ['spark:tool'])
    assert.ok(tool.parameters.required.includes('urine_colour'))
    assert.equal(r.entries[0]?.urine_colour, 'dark')
    assert.equal(r.entries[0]?.urine_rgb, null)
  })

  it('[capture/notes] Urine colour from a note: Colour on a drink', async () => {
    const u = upstream({
      spark: noteCall({ direction: 'in', category: 'water', volume_ml: 200, item: 'water', notes: null, urine_colour: 'red' }),
    })
    const r = await u.ai.parseNote({ text: 'drank 200 mL water' })
    assert.deepEqual(u.requests, ['spark:tool'])
    assert.equal(r.entries[0]?.urine_colour, null)
  })
})

describe('drink kinds from a note', () => {
  const call = (...entries: Record<string, unknown>[]) =>
    resp(
      'muse-spark-1.3',
      entries.map((args, i) => ({ type: 'function_call', call_id: `c${i}`, name: 'log_entry', arguments: JSON.stringify(args) })),
    )
  const base = { item: null, notes: null, urine_colour: 'none' }

  it('[capture/notes] Drink kind from a note: Coconut water typed', async () => {
    let tool: Record<string, any> = {}
    const u = upstream({
      spark: (body) => {
        tool = body.tools[0]
        return call({ ...base, direction: 'in', category: 'water', volume_ml: 200, item: 'coconut water', drink: 'coconut_water' })
      },
    })
    const r = await u.ai.parseNote({ text: 'coconut water 200' })
    assert.deepEqual(u.requests, ['spark:tool'])
    assert.equal(r.entries[0]?.drink, 'coconut_water')
    assert.equal(r.entries[0]?.item, 'coconut water')
    assert.ok(tool.parameters.required.includes('drink'))
    assert.deepEqual(tool.parameters.properties.drink.enum, [
      'water',
      'tea',
      'coffee',
      'milk',
      'juice',
      'coconut_water',
      'buttermilk',
      'ors',
      'supplement',
      'soup',
      'other',
      'none',
    ])
  })

  it('[capture/notes] Drink kind from a note: Tea and urine spoken', async () => {
    const u = upstream({
      asr: () =>
        Response.json({ sessionId: 's', transcript: 'bed 4 had 200 mL chai and passed 300 mL urine', audioDurationMs: 3000, turns: [] }),
      spark: () =>
        call(
          { ...base, direction: 'in', category: 'water', volume_ml: 200, item: 'chai', drink: 'tea' },
          { ...base, direction: 'out', category: 'urine', volume_ml: 300, drink: 'tea' },
        ),
    })
    const r = await u.ai.voiceNote({ audio: silenceWav() })
    assert.deepEqual(u.requests, ['asr', 'spark:tool'])
    assert.equal(r.entries[0]?.drink, 'tea')
    assert.equal(r.entries[0]?.item, 'chai')
    assert.equal(r.entries[1]?.drink, null)
  })

  it('[capture/notes] Drink kind from a note: Drink not named', async () => {
    const a = upstream({ spark: () => call({ ...base, direction: 'in', category: 'water', volume_ml: 150, drink: 'none' }) })
    const b = upstream({ spark: () => call({ ...base, direction: 'in', category: 'food', volume_ml: null, drink: 'none' }) })
    const ra = await a.ai.parseNote({ text: 'had a drink 150' })
    const rb = await b.ai.parseNote({ text: 'ate half the rice' })
    assert.equal(ra.entries[0]?.drink, 'other')
    assert.equal(rb.entries[0]?.drink, null)
    assert.deepEqual(a.requests, ['spark:tool'])
    assert.deepEqual(b.requests, ['spark:tool'])
  })
})

describe('served and collected tray pipeline', () => {
  const SERVED = png(1000, 800, 1)
  const COLLECTED = png(1000, 800, 2)
  const DISH = { left: 100, top: 80, right: 400, bottom: 480 }
  const rice = {
    dishes: [{ region: 1, name: 'rice', dish_kind: 'rice', eaten: 'quarter' }],
    eaten: 'quarter',
    fluids: [],
    confidence: 0.9,
    issues: [],
    notes: null,
  }

  /**
   * The real client over a fake upstream, behind a SAM port that holds each request on a promise the test settles.
   * `log` records each port call as it starts and ends, so ordering and the in-flight count are visible.
   */
  function gated() {
    const u = upstream({
      sam: (prompt, body) => {
        const served = imageOf(body) === dataUrl(SERVED, 'image/png')
        return resp('sam-3.1', [msg(SAM_RECT(prompt === 'dish' ? DISH : { ...DISH, bottom: served ? 400 : 240 }))])
      },
      spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(rice))]),
    })
    const waiting: { image: string; prompt: string; go: () => void; fail: (e: unknown) => void }[] = []
    const log: string[] = []
    let inFlight = 0
    let peak = 0
    const ports: AiPorts = {
      ...u.client,
      sam: {
        segment: (p, opts) =>
          new Promise((resolve, reject) => {
            const who = `${p.image === dataUrl(SERVED, 'image/png') ? 'served' : 'collected'}:${p.prompt}`
            log.push(`start ${who}`)
            peak = Math.max(peak, ++inFlight)
            const done = () => {
              inFlight--
              log.push(`end ${who}`)
            }
            opts?.signal?.addEventListener('abort', () => {
              done()
              reject(opts.signal!.reason as Error)
            })
            waiting.push({
              image: who,
              prompt: p.prompt,
              go: () => {
                void u.client.sam.segment(p, opts).then(
                  (r) => (done(), resolve(r)),
                  (e: unknown) => (done(), reject(e as Error)),
                )
              },
              fail: reject,
            })
          }),
      },
      responses: {
        ...u.client.responses,
        generateObject: ((...a: Parameters<AiPorts['responses']['generateObject']>) => {
          log.push('spark')
          return u.client.responses.generateObject(...a)
        }) as AiPorts['responses']['generateObject'],
      },
    }
    const ai = createAi(() => ports, { mealUseSam: true })
    const served = {
      bytes: SERVED,
      mime: 'image/png',
      check: servedCheck(COLLECTED, 'image/png', { bytes: SERVED, mime: 'image/png', sha256: null }),
    }
    const tick = () => new Promise((r) => setTimeout(r, 5))
    return { u, ai, served, waiting, log, tick, peak: () => peak }
  }

  it('[capture/meal-reading] Served and collected trays: Lunch served and collected', async () => {
    const g = gated()
    const read = g.ai.readMeal({ image: COLLECTED, mime: 'image/png', served: g.served })
    await g.tick()
    assert.deepEqual(g.log, ['start collected:dish', 'start collected:food'])
    g.waiting[0]!.go()
    await g.tick()
    assert.ok(!g.log.some((l) => l.includes('served')), 'no served request while a collected one is pending')
    g.waiting[1]!.go()
    await g.tick()
    assert.deepEqual(g.log.slice(-2), ['start served:dish', 'start served:food'])
    assert.ok(!g.log.includes('spark'))
    g.waiting[2]!.go()
    await g.tick()
    assert.ok(!g.log.includes('spark'), 'Spark waits for both served replies')
    g.waiting[3]!.go()
    const r = await read
    assert.equal(g.log.at(-1), 'spark')
    assert.equal(g.peak(), 2)
    assert.deepEqual(g.u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(
      r.trace.map((t) => t.step),
      ['sam:dish', 'sam:food', 'sam:served-dish', 'sam:served-food', 'spark:meal'],
    )
    assert.deepEqual(r.comparison?.matches, [{ index: 1, served_index: 1, distance2: 0 }])
    assert.deepEqual([r.reading.dishes[0]!.portion, r.reading.dishes[0]!.basis, r.reading.dishes[0]!.model_portion], [50, 'measured', 25])
  })

  it('[capture/meal-reading] Served photo comparison degrades: Cancelled during the served segmentation', async () => {
    const g = gated()
    const ac = new AbortController()
    const read = g.ai.readMeal({ image: COLLECTED, mime: 'image/png', served: g.served, signal: ac.signal })
    await g.tick()
    g.waiting[0]!.go()
    g.waiting[1]!.go()
    await g.tick()
    assert.deepEqual(g.log.slice(-2), ['start served:dish', 'start served:food'])
    ac.abort(new Error('cancelled'))
    await assert.rejects(read, /cancelled/)
    assert.ok(!g.log.includes('spark'))
    // 2 collected requests sent upstream and 2 served ones started: 4, and no Spark.
    assert.equal(g.log.filter((l) => l.startsWith('start')).length, 4)
    assert.deepEqual(g.u.requests, ['sam:dish', 'sam:food'])
  })
})

describe('server log lines', () => {
  const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const
  /** Replaces every console method with a capturing stub for the duration of `fn`, then restores them. */
  async function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
    const lines: string[] = []
    const saved = METHODS.map((m) => [m, Object.getOwnPropertyDescriptor(console, m)!] as const)
    for (const m of METHODS) console[m] = (...args: unknown[]) => void lines.push(args.map(String).join(' '))
    try {
      return { result: await fn(), lines }
    } finally {
      for (const [m, d] of saved) Object.defineProperty(console, m, d)
    }
  }
  const note = async (app: Awaited<ReturnType<typeof testApp>>, text: string) =>
    app.request('/api/ai/note', { method: 'POST', body: JSON.stringify({ text }), headers: { 'content-type': 'application/json' } })
  const LOG = { budget: { perHour: 120 }, log: (line: string) => console.log(line) }
  const badInput = () =>
    Response.json(
      { error: { type: 'invalid_request_error', code: 'invalid_value', message: 'bad input: bed 4 had coconut water' } },
      { status: 400 },
    )

  it('[model-api/client] Server log lines: Line format from given inputs', () => {
    const error = new MetaApiError(
      'POST /responses → 429: slow down',
      429,
      'rate_limit_error',
      'rate_limit_exceeded',
      undefined,
      undefined,
      'POST /responses',
    )
    assert.equal(
      requestLogLine(
        { method: 'POST', path: '/responses', model: 'muse-spark-1.3', status: 429, ms: 812, rateLimit: { remainingRequests: 0 }, error },
        { total: 3, lastHour: 2, perHour: 120 },
      ),
      '[model-api] POST /responses muse-spark-1.3 429 812ms (#3, 2/120 per h) upstream 0/? req ✗ MetaApiError rate_limit_exceeded',
    )
  })

  it('[model-api/client] Server log lines: Note with headroom', async () => {
    const u = upstream({
      ...LOG,
      spark: (body) => {
        const r = resp('muse-spark-1.3', [
          {
            type: 'function_call',
            call_id: 'c1',
            name: 'log_entry',
            arguments: JSON.stringify({ direction: 'in', category: 'water', volume_ml: 200, item: 'coconut water', notes: 'null' }),
          },
        ])
        assert.ok(body.tools)
        for (const [k, v] of Object.entries({
          'x-ratelimit-limit-requests': '150',
          'x-ratelimit-remaining-requests': '149',
          'x-ratelimit-limit-tokens': '3000000',
          'x-ratelimit-remaining-tokens': '2990000',
        }))
          r.headers.set(k, v)
        return r
      },
    })
    const { result: res, lines } = await captureConsole(async () => note(await testApp({ ai: u.ai }), 'bed 4 had coconut water 200'))
    assert.equal(res.status, 200)
    const logged = lines.filter((l) => l.startsWith('[model-api]'))
    assert.equal(logged.length, 1)
    assert.match(
      logged[0]!,
      /^\[model-api\] POST \/responses muse-spark-1\.3 200 \d+ms \(#1, 1\/120 per h\) upstream 149\/150 req 2990000\/3000000 tok$/,
    )
    assert.equal(u.requests.length, 1)
    assert.ok(lines.every((l) => !l.includes('coconut')))
  })

  it('[model-api/client] Server log lines: Failure without the upstream message', async () => {
    const u = upstream({ ...LOG, spark: badInput })
    const { lines } = await captureConsole(async () => note(await testApp({ ai: u.ai }), 'bed 4 had coconut water 200'))
    const logged = lines.filter((l) => l.startsWith('[model-api]'))
    assert.equal(logged.length, 1)
    assert.match(logged[0]!, / 400 \d+ms \(#1, 1\/120 per h\) ✗ MetaApiError invalid_value$/)
    assert.ok(lines.every((l) => !l.includes('coconut')))
    assert.equal(u.requests.length, 1)
  })

  it('[model-api/client] Server log lines: Unhandled error with a multi-line message', () => {
    const err = new TypeError('x\nbed 4 had coconut water')
    const line = unhandledLogLine(err)
    assert.ok(line.startsWith('[app] unhandled TypeError'))
    const rest = line.split('\n').slice(1)
    assert.ok(rest.length > 0)
    for (const l of rest) assert.match(l, /^\s+at /)
    assert.ok(!line.includes('coconut'))
  })

  it('[model-api/client] Server log lines: App error line without the upstream message', async () => {
    const u = upstream({ ...LOG, spark: badInput })
    const { result: res, lines } = await captureConsole(async () => note(await testApp({ ai: u.ai }), 'bed 4 had coconut water 200'))
    assert.equal(res.status, 502)
    assert.equal(((await res.json()) as { error: string }).error, 'model_api_error')
    assert.deepEqual(
      lines.filter((l) => l.startsWith('[ai]')),
      ['[ai] 502 model_api_error MetaApiError invalid_value'],
    )
    assert.ok(lines.every((l) => !l.includes('coconut')))
    assert.equal(u.requests.length, 1)
  })
})

describe('bedpans and commode pans', () => {
  const read = (over: Parameters<typeof reading>[0]) => resp('muse-spark-1.3', [msg(JSON.stringify(reading(over)))])

  it('[capture/photo-reading] Bedpan and commode reads: Commode pan, grounded', async () => {
    const u = upstream({ spark: () => read({ container: 'commode_pan', fluid: 'urine', volume_ml: 250 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'commode_pan', mode: 'sam+spark' })
    assert.deepEqual(u.requests.sort(), ['sam:commode pan', 'sam:liquid', 'spark:object'])
    assert.deepEqual(
      r.draft && { direction: r.draft.direction, category: r.draft.category, volume_ml: r.draft.volume_ml, item: r.draft.item },
      { direction: 'out', category: 'urine', volume_ml: 250, item: 'commode pan' },
    )
  })

  it('[capture/photo-reading] Bedpan and commode reads: Bedpan, Spark only', async () => {
    const u = upstream({ spark: () => read({ container: 'bedpan', fluid: 'other', volume_ml: 180 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'bedpan', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
    assert.deepEqual(
      r.draft && { direction: r.draft.direction, category: r.draft.category, volume_ml: r.draft.volume_ml, item: r.draft.item },
      { direction: 'out', category: 'urine', volume_ml: 180, item: 'bedpan' },
    )
  })

  it('[capture/photo-reading] Bedpan and commode reads: Unknown hint', async () => {
    const u = upstream()
    const form = new FormData()
    form.append('image', new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))
    form.append('hint', 'commode')
    const res = await (await testApp({ ai: u.ai })).request('/api/ai/read', { method: 'POST', body: form })
    assert.equal(res.status, 400)
    assert.equal(((await res.json()) as { error: string }).error, 'invalid_request')
    assert.deepEqual(u.requests, [])
  })

  it('the Spark reading request names bedpans and commode pans, in its instructions and its container enum', async () => {
    const u = upstream()
    await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.equal(u.requests.length, 1)
    const body = u.bodies[0]!
    assert.match(body.instructions as string, /\(urinals, bedpans, commode pans, urine\/stoma\/drain bags,/)
    const containers = body.text.format.schema.properties.container.enum as string[]
    assert.ok(containers.includes('bedpan') && containers.includes('commode_pan'))
  })
})

describe('drink kinds in a photo read', () => {
  const read = (over: Record<string, unknown>) => resp('muse-spark-1.3', [msg(JSON.stringify({ ...reading(), ...over }))])

  it('[capture/photo-reading] Drink identified in the reading: Filter coffee, grounded', async () => {
    const u = upstream({ spark: () => read({ container: 'cup', fluid: 'coffee', drink_name: 'filter coffee', volume_ml: 150 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', hint: 'cup', mode: 'sam+spark' })
    assert.deepEqual(u.requests.sort(), ['sam:cup', 'sam:liquid', 'spark:object'])
    assert.equal(r.reading.fluid, 'coffee')
    assert.equal(r.reading.drink_name, 'filter coffee')
    assert.equal(r.draft?.drink, 'coffee')
    assert.equal(r.draft?.item, 'filter coffee')
    const spark = u.bodies.find((b) => b.model !== 'sam-3.1')!
    const schema = spark.text.format.schema
    for (const k of ['coffee', 'coconut_water', 'buttermilk', 'ors', 'supplement']) assert.ok(schema.properties.fluid.enum.includes(k), k)
    assert.ok(schema.required.includes('drink_name'))
    assert.deepEqual(schema.properties.drink_name.type, ['string', 'null'])
    for (const w of [/coffee/, /ORS/, /buttermilk/, /coconut water/, /supplement drink/]) assert.match(spark.instructions as string, w)
    assert.match(spark.instructions as string, /\(urinals, bedpans, commode pans, urine\/stoma\/drain bags,/)
  })

  it('[capture/photo-reading] Drink identified in the reading: ORS, Spark only', async () => {
    const u = upstream({ spark: () => read({ container: 'water_bottle', fluid: 'ors', drink_name: null, volume_ml: 300 }) })
    const r = await u.ai.readCapture({ image: jpeg, mime: 'image/jpeg', mode: 'spark' })
    assert.deepEqual(u.requests, ['spark:object'])
    assert.deepEqual(r.draft && { category: r.draft.category, drink: r.draft.drink, item: r.draft.item }, {
      category: 'water',
      drink: 'ors',
      item: 'ORS',
    })
  })

  const parsed = (over: Record<string, unknown>) => {
    const r = ReadingSchema.parse({ ...reading(), ...over })
    return { name: r.drink_name, item: toDraft(r)?.item }
  }

  it('[capture/photo-reading] Drink name bounds: Cleaned', () => {
    assert.deepEqual(parsed({ container: 'cup', fluid: 'tea', drink_name: '  masala\n\tchai ' }), {
      name: 'masala chai',
      item: 'masala chai',
    })
    assert.deepEqual(parsed({ container: 'cup', fluid: 'tea', drink_name: 'masala\u0007 chai\u0085' }), {
      name: 'masala chai',
      item: 'masala chai',
    })
  })

  it('[capture/photo-reading] Drink name bounds: Too long', () => {
    const long = 'sweet lime juice with a little rock salt and sugar, less ice'
    assert.equal(long.length, 60)
    const r = parsed({ container: 'cup', fluid: 'juice', drink_name: long })
    assert.deepEqual(r, { name: 'sweet lime juice with a little rock salt', item: 'sweet lime juice with a little rock salt' })
    assert.equal(r.name?.length, 40)
  })

  it('[capture/photo-reading] Drink name bounds: Not a drink', () => {
    assert.deepEqual(parsed({ container: 'urinal', fluid: 'urine', drink_name: 'pale' }), { name: null, item: 'urinal' })
    assert.deepEqual(parsed({ container: 'stoma_bag', fluid: 'other', drink_name: 'brown liquid' }), { name: null, item: 'stoma bag' })
    assert.deepEqual(parsed({ container: 'cup', fluid: 'water', drink_name: ' N/A ' }), { name: null, item: 'Water' })
  })

  it('a reading without drink_name (an older reply) parses with drink_name null', () => {
    const r = ReadingSchema.parse({ ...reading({ container: 'cup', fluid: 'tea' }) })
    assert.equal(r.drink_name, null)
  })
})
