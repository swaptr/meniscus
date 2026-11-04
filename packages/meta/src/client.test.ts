import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AudioTooLongError,
  InvalidAudioError,
  InvalidImageRequestError,
  MetaApiError,
  MetaBudgetError,
  MetaConnectionError,
  MetaContentPolicyError,
  MetaOutputError,
  MetaResponseError,
  MetaTimeoutError,
  RequestBudget,
  checkWav,
  createMetaClient,
  type RequestEvent,
  type StandardSchema,
} from './index.ts'
import { parseRetryAfter } from './transport.ts'

// ---------- helpers ----------

interface Sent {
  url: string
  init: RequestInit
  json?: Record<string, unknown>
}

function fakeFetch(...replies: (Response | Error | ((signal: AbortSignal) => Promise<Response>))[]) {
  const sent: Sent[] = []
  const fn = (async (url: string, init: RequestInit) => {
    sent.push({ url, init, json: typeof init.body === 'string' ? JSON.parse(init.body) : undefined })
    const r = replies.shift()
    if (!r) throw new Error('unexpected request')
    if (r instanceof Error) throw r
    if (typeof r === 'function') return r(init.signal!)
    return r
  }) as unknown as typeof fetch
  return { fn, sent }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const response = (output: unknown[], over: Record<string, unknown> = {}) => ({
  id: 'resp_1',
  object: 'response',
  status: 'completed',
  model: 'muse-spark-1.3',
  output,
  error: null,
  incomplete_details: null,
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, output_tokens_details: { reasoning_tokens: 2 } },
  ...over,
})

const message = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] })

/** Tiny Standard Schema: object with numeric `ml`. */
const MlSchema: StandardSchema<{ ml: number }> = {
  '~standard': {
    version: 1,
    validate: (v) =>
      typeof v === 'object' && v !== null && typeof (v as { ml?: unknown }).ml === 'number'
        ? { value: v as { ml: number } }
        : { issues: [{ message: 'expected number', path: ['ml'] }] },
  },
}

const client = (f: typeof fetch, extra: Partial<Parameters<typeof createMetaClient>[0]> = {}) =>
  createMetaClient({ apiKey: 'LLM_test', fetch: f, ...extra })

const output = { name: 'reading', jsonSchema: { type: 'object' }, schema: MlSchema }

// ---------- transport ----------

describe('transport', () => {
  it('[model-api/client] No upstream retention: structured reading', async () => {
    const { fn, sent } = fakeFetch(json(response([message('{"ml":450}')])))
    const events: RequestEvent[] = []
    const r = await client(fn, { onRequest: (e) => events.push(e) }).responses.generateObject({
      model: 'muse-spark-1.3',
      input: 'x',
      output,
    })
    assert.equal(r.object.ml, 450)
    assert.equal(sent[0]!.url, 'https://api.meta.ai/v1/responses')
    assert.equal((sent[0]!.init.headers as Record<string, string>).Authorization, 'Bearer LLM_test')
    assert.equal(sent[0]!.json!.store, false)
    assert.deepEqual(sent[0]!.json!.text, { format: { type: 'json_schema', name: 'reading', schema: { type: 'object' }, strict: true } })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.status, 200)
    assert.equal(events[0]!.model, 'muse-spark-1.3')
  })

  it('[model-api/client] Upstream headroom on the request hook: Spark reading with headroom', async () => {
    const { fn, sent } = fakeFetch(
      json(response([message('{"ml":450}')]), 200, {
        'x-ratelimit-limit-requests': '150',
        'x-ratelimit-remaining-requests': '149',
        'x-ratelimit-limit-tokens': '3000000',
        'x-ratelimit-remaining-tokens': '2990000',
      }),
    )
    const events: RequestEvent[] = []
    await client(fn, { onRequest: (e) => events.push(e) }).responses.generateObject({ model: 'muse-spark-1.3', input: 'x', output })
    assert.equal(events.length, 1)
    assert.deepEqual(events[0]!.rateLimit, { limitRequests: 150, remainingRequests: 149, limitTokens: 3000000, remainingTokens: 2990000 })
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Upstream headroom on the request hook: Rate limited with none left', async () => {
    const { fn, sent } = fakeFetch(
      json({ error: { message: 'slow down', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, 429, {
        'retry-after': '7',
        'x-ratelimit-remaining-requests': '0',
      }),
    )
    const events: RequestEvent[] = []
    const err = await client(fn, { onRequest: (e) => events.push(e) })
      .responses.generateObject({ model: 'muse-spark-1.3', input: 'x', output })
      .catch((e) => e)
    assert.ok(err instanceof MetaApiError)
    assert.equal(events.length, 1)
    assert.equal(events[0]!.status, 429)
    assert.deepEqual(events[0]!.rateLimit, { remainingRequests: 0 })
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Upstream headroom on the request hook: Transcription has no headers', async () => {
    const { fn, sent } = fakeFetch(json({ sessionId: 's1', transcript: 'ok', audioDurationMs: 1000, turns: [] }))
    const events: RequestEvent[] = []
    await client(fn, { onRequest: (e) => events.push(e) }).asr.transcribe({ audio: wav() })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.status, 200)
    assert.equal(events[0]!.rateLimit, undefined)
    assert.ok(!Object.hasOwn(events[0]!, 'rateLimit'))
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Upstream headroom on the request hook: Unreadable value', async () => {
    const { fn, sent } = fakeFetch(
      json(response([message('{"ml":450}')]), 200, { 'x-ratelimit-remaining-tokens': 'lots', 'x-ratelimit-limit-tokens': '-5' }),
    )
    const events: RequestEvent[] = []
    await client(fn, { onRequest: (e) => events.push(e) }).responses.generateObject({ model: 'muse-spark-1.3', input: 'x', output })
    assert.equal(events.length, 1)
    assert.equal(events[0]!.rateLimit, undefined)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Typed upstream errors: invalid key', async () => {
    const { fn } = fakeFetch(
      json({ error: { message: 'bad key', type: 'authentication_error', code: 'invalid_api_key', param: null } }, 401),
    )
    const err = await client(fn)
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaApiError)
    assert.equal(err.status, 401)
    assert.equal(err.code, 'invalid_api_key')
    assert.equal(err.type, 'authentication_error')
    assert.equal(err.retryable, false)
  })

  it('[model-api/client] Typed upstream errors: rate limited', async () => {
    const { fn, sent } = fakeFetch(
      json({ error: { message: 'slow', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }, 429, { 'retry-after': '7' }),
    )
    const err = await client(fn)
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaApiError)
    assert.equal(err.retryable, true)
    assert.equal(err.retryAfterMs, 7000)
    assert.equal(sent.length, 1, 'never retried')
  })

  it('[model-api/client] Typed upstream errors: empty 404', async () => {
    const { fn } = fakeFetch(new Response('', { status: 404, statusText: 'Not Found' }))
    const err = await client(fn)
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaApiError)
    assert.match(err.message, /404: Not Found/)
  })

  it('[model-api/client] Typed upstream errors: Transient statuses', async () => {
    const a = fakeFetch(json({ error: { message: 'oops', type: 'server_error' } }, 500))
    const e500 = await client(a.fn)
      .models.list()
      .catch((e) => e)
    assert.ok(e500 instanceof MetaApiError)
    assert.equal(e500.status, 500)
    assert.equal(e500.retryable, true)
    assert.equal(a.sent.length, 1)
    const b = fakeFetch(json({ error: { message: 'busy', type: 'server_error' } }, 503, { 'retry-after': '60' }))
    const e503 = await client(b.fn)
      .models.list()
      .catch((e) => e)
    assert.ok(e503 instanceof MetaApiError)
    assert.equal(e503.retryable, true)
    assert.equal(e503.retryAfterMs, 60000)
    assert.equal(b.sent.length, 1)
  })

  // https://dev.meta.ai/docs/error-handling (fetched 2026-11-04): 413 payload_too_large is a request fault; a 503 with
  // no code (retryable image-generation failure) is still transient.
  it('classifies 413 payload_too_large as final and an uncoded 503 as transient', async () => {
    const a = fakeFetch(json({ error: { message: 'too big', type: 'invalid_request_error', code: 'payload_too_large', param: null } }, 413))
    const e413 = await client(a.fn)
      .models.list()
      .catch((e) => e)
    assert.ok(e413 instanceof MetaApiError)
    assert.deepEqual([e413.status, e413.code, e413.param, e413.retryable], [413, 'payload_too_large', undefined, false])
    const b = fakeFetch(json({ error: { message: 'try again', type: 'server_error', code: null } }, 503))
    const e503 = await client(b.fn)
      .models.list()
      .catch((e) => e)
    assert.ok(e503 instanceof MetaApiError)
    assert.deepEqual([e503.code, e503.retryable], [undefined, true])
    assert.equal(a.sent.length + b.sent.length, 2)
  })

  it('[model-api/client] Typed upstream errors: Bad gateway is not transient', async () => {
    for (const status of [502, 504]) {
      const { fn, sent } = fakeFetch(new Response('', { status }))
      const err = await client(fn)
        .models.list()
        .catch((e) => e)
      assert.ok(err instanceof MetaApiError, `${status} is a MetaApiError`)
      assert.equal(err.status, status)
      assert.equal(err.retryable, false, `${status} is not retryable`)
      assert.equal(sent.length, 1, `${status}: one request`)
    }
  })

  it('[model-api/client] Transport failures: network down', async () => {
    const { fn } = fakeFetch(new TypeError('fetch failed'))
    const err = await client(fn)
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaConnectionError && err.retryable)
  })

  it('[model-api/client] Transport failures: hung upstream', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<Response>((_, rej) => signal.addEventListener('abort', () => rej(signal.reason as Error)))
    const { fn } = fakeFetch(hang)
    const err = await client(fn, { timeoutMs: 20 })
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaTimeoutError)
  })

  it('[model-api/client] Transport failures: pre-aborted signal', async () => {
    const { fn, sent } = fakeFetch()
    const ac = new AbortController()
    ac.abort(new Error('user left'))
    await assert.rejects(client(fn).models.list({ signal: ac.signal }), /user left/)
    assert.equal(sent.length, 0)
  })

  it('parses Retry-After seconds and HTTP dates', () => {
    assert.equal(parseRetryAfter('60'), 60_000)
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6_000)
    assert.equal(parseRetryAfter('soon'), undefined)
    assert.equal(parseRetryAfter(null), undefined)
  })
})

// ---------- budget ----------

describe('budget', () => {
  it('[model-api/client] Request budget: hourly cap of 2', async () => {
    const { fn, sent } = fakeFetch(json({ data: [] }), json({ data: [] }))
    const c = client(fn, { budget: { perHour: 2, maxConcurrent: 2 } })
    await c.models.list()
    await c.models.list()
    const err = await c.models.list().catch((e) => e)
    assert.ok(err instanceof MetaBudgetError && err.limit === 'hourly' && err.retryable)
    assert.equal(sent.length, 2)
  })

  it('[model-api/client] Request budget: one in flight', async () => {
    let release!: (r: Response) => void
    const held = () => new Promise<Response>((r) => (release = r))
    const { fn } = fakeFetch(held, json({ data: [] }))
    const c = client(fn, { budget: { perHour: 10, maxConcurrent: 1 } })
    const first = c.models.list()
    await assert.rejects(c.models.list(), MetaBudgetError)
    release(json({ data: [] }))
    await first
    await c.models.list()
    assert.equal(c.budget.stats().inFlight, 0)
  })

  it('[model-api/client] Request budget: window rolls', () => {
    let now = 0
    const b = new RequestBudget({ perHour: 1, maxConcurrent: 1 }, () => now)
    b.acquire()()
    assert.throws(() => b.acquire(), MetaBudgetError)
    now = 3_600_001
    b.acquire()()
  })

  /** Sends n requests through acquire() at time `now`. */
  const send = (b: RequestBudget, n: number) => {
    for (let i = 0; i < n; i++) b.acquire()()
  }
  const budgetError = (fn: () => unknown) => {
    try {
      fn()
    } catch (err) {
      if (err instanceof MetaBudgetError) return err
      throw err
    }
    assert.fail('expected MetaBudgetError')
  }

  it('[model-api/client] Request budget: Whole action or nothing', async () => {
    const { fn, sent } = fakeFetch(json({ data: [] }), json({ data: [] }))
    const budget = new RequestBudget({ perHour: 10, maxConcurrent: 4 })
    send(budget, 8)
    const c = client(fn, { budget })
    const err = budgetError(() => budget.reserve(3))
    assert.equal(err.limit, 'hourly')
    assert.equal(budget.stats().held, 0)
    const ticket = budget.reserve(2)
    await c.models.list({ ticket })
    await c.models.list({ ticket })
    ticket.release()
    assert.equal(sent.length, 2)
    assert.deepEqual([budget.stats().lastHour, budget.stats().held], [10, 0])
  })

  it('[model-api/client] Request budget: Reserve for high priority', () => {
    const budget = new RequestBudget({ perHour: 10, maxConcurrent: 4, reservePct: 30 })
    send(budget, 7)
    assert.equal(budget.fits(1, 'normal'), false)
    assert.equal(budget.fits(3, 'high'), true)
    const err = budgetError(() => budget.reserve(1, { priority: 'normal' }))
    assert.deepEqual([err.limit, err.priority], ['hourly', 'normal'])
    const ticket = budget.reserve(3, { priority: 'high' })
    assert.deepEqual([ticket.priority, ticket.left], ['high', 3])
    assert.deepEqual(budget.stats().remaining, { high: 0, normal: 0 })
  })

  it('[model-api/client] Request budget: Retry time', () => {
    const t0 = new Date(2026, 10, 3, 10, 0, 0).getTime()
    let now = t0
    const budget = new RequestBudget({ perHour: 2, maxConcurrent: 4 }, () => now)
    send(budget, 1)
    now = t0 + 20 * 60_000
    send(budget, 1)
    now = t0 + 40 * 60_000
    const err = budgetError(() => budget.reserve(1))
    assert.deepEqual([err.limit, err.retryAfterMs, err.retryable], ['hourly', 1_200_000, true])
  })

  it('[model-api/client] Request budget: Retry time when the excess is held', () => {
    const { fn, sent } = fakeFetch()
    const budget = new RequestBudget({ perHour: 2, maxConcurrent: 4 })
    client(fn, { budget })
    budget.reserve(2)
    const err = budgetError(() => budget.reserve(1))
    assert.deepEqual([err.limit, err.retryAfterMs, err.retryable], ['hourly', 60_000, true])
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Request budget: Retry time when the action exceeds its ceiling', () => {
    const budget = new RequestBudget({ perHour: 10, maxConcurrent: 4, reservePct: 30 })
    const err = budgetError(() => budget.reserve(8, { priority: 'normal' }))
    assert.deepEqual([err.limit, err.retryAfterMs, err.retryable], ['hourly', 3_600_000, true])
    assert.equal(budget.stats().lastHour, 0)
    assert.equal(budget.reserve(8, { priority: 'high' }).left, 8)
  })

  it('[model-api/client] Request budget: Unsent requests returned', async () => {
    const { fn, sent } = fakeFetch(json({ data: [] }))
    const budget = new RequestBudget({ perHour: 4, maxConcurrent: 4 })
    const c = client(fn, { budget })
    const first = budget.reserve(3)
    await c.models.list({ ticket: first })
    first.release()
    first.release()
    assert.deepEqual([budget.stats().lastHour, budget.stats().held, budget.stats().inFlight], [1, 0, 0])
    const second = budget.reserve(3)
    assert.equal(second.left, 3)
    assert.equal(budgetError(() => budget.reserve(1)).limit, 'hourly')
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Request budget: tickets take per request, from their own budget', async () => {
    const { fn, sent } = fakeFetch(json({ data: [] }), json({ data: [] }), json({ data: [] }))
    const budget = new RequestBudget({ perHour: 10, maxConcurrent: 4 })
    const c = client(fn, { budget })
    const ticket = budget.reserve(3)
    for (let i = 0; i < 3; i++) await c.models.list({ ticket })
    assert.equal(sent.length, 3)
    assert.deepEqual([budget.stats().lastHour, budget.stats().held], [3, 0])
    assert.throws(
      () => ticket.take(),
      (e: Error) => !(e instanceof MetaBudgetError),
    )
    ticket.release()

    const other = new RequestBudget({ perHour: 10, maxConcurrent: 4 })
    const { fn: fnB, sent: sentB } = fakeFetch(json({ data: [] }))
    const b = client(fnB, { budget: other })
    const foreign = budget.reserve(1)
    await assert.rejects(
      b.models.list({ ticket: foreign }),
      (e: Error) => !(e instanceof MetaBudgetError) && /another budget/.test(e.message),
    )
    assert.equal(sentB.length, 0)
    assert.equal(other.stats().lastHour, 0)
  })

  it('[model-api/client] Request budget: a ticket holds its peak in flight', () => {
    const budget = new RequestBudget({ perHour: 10, maxConcurrent: 4 })
    const a = budget.reserve(3, { peak: 2 })
    budget.reserve(1, { peak: 2 })
    const err = budgetError(() => budget.reserve(1))
    assert.deepEqual([err.limit, err.retryAfterMs], ['concurrent', 5_000])
    a.release()
    assert.equal(budget.stats().inFlight, 2)
    budget.reserve(1)
  })
})

// ---------- responses ----------

describe('responses', () => {
  it('[model-api/client] Validated output: wrong type', async () => {
    const { fn } = fakeFetch(json(response([message('{"ml":"lots"}')])))
    const err = await client(fn)
      .responses.generateObject({ model: 'm', input: 'x', output })
      .catch((e) => e)
    assert.ok(err instanceof MetaOutputError)
    assert.deepEqual(err.issues, ['ml: expected number'])
  })

  it('[model-api/client] Validated output: incomplete and refused', async () => {
    const inc = fakeFetch(json(response([], { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })))
    const e1 = await client(inc.fn)
      .responses.generateObject({ model: 'm', input: 'x', output })
      .catch((e) => e)
    assert.ok(e1 instanceof MetaResponseError && e1.code === 'max_output_tokens')

    const ref = fakeFetch(json(response([{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }])))
    const e2 = await client(ref.fn)
      .responses.generateObject({ model: 'm', input: 'x', output })
      .catch((e) => e)
    assert.ok(e2 instanceof MetaResponseError && e2.status === 'refused')
  })

  it('[model-api/client] Validated output: two tool calls', async () => {
    const { fn, sent } = fakeFetch(
      json(
        response([
          { type: 'reasoning', id: 'rs_1', summary: [] },
          { type: 'function_call', call_id: 'c1', name: 'log', arguments: '{"ml":200}' },
          { type: 'function_call', call_id: 'c2', name: 'log', arguments: '{"ml":350}' },
        ]),
      ),
    )
    const r = await client(fn).responses.callTool({
      model: 'm',
      input: 'x',
      tool: { name: 'log', description: 'd', parameters: { type: 'object' }, schema: MlSchema },
    })
    assert.deepEqual(
      r.calls.map((c) => c.input.ml),
      [200, 350],
    )
    assert.equal(sent[0]!.json!.tool_choice, 'auto')
    assert.deepEqual(sent[0]!.json!.tools, [
      { type: 'function', name: 'log', description: 'd', parameters: { type: 'object' }, strict: true },
    ])
  })

  // Fields from https://dev.meta.ai/docs/api-reference/responses/schemas (fetched 2026-11-04): created_at, message phase,
  // function_call namespace, reasoning content/status. Extra fields must not disturb text or tool-call extraction.
  it('reads a docs-shaped response with every documented item field', async () => {
    const { fn, sent } = fakeFetch(
      json(
        response(
          [
            { type: 'reasoning', id: 'rs_1', summary: [], content: [], encrypted_content: null, status: 'completed' },
            {
              type: 'function_call',
              id: 'fc_1',
              call_id: 'c1',
              namespace: null,
              name: 'log',
              arguments: '{"ml":120}',
              status: 'completed',
            },
            { ...message('done'), id: 'msg_1', phase: 'final_answer', status: 'completed' },
          ],
          {
            created_at: 1793750400,
            completed_at: 1793750401,
            usage: {
              input_tokens: 10,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 5,
              output_tokens_details: { reasoning_tokens: 2 },
              total_tokens: 15,
            },
          },
        ),
      ),
    )
    const r = await client(fn).responses.callTool({
      model: 'm',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'x' }] }],
      tool: { name: 'log', description: 'd', parameters: { type: 'object' }, schema: MlSchema },
    })
    assert.deepEqual(
      r.calls.map((c) => c.input.ml),
      [120],
    )
    assert.equal(r.text, 'done')
    assert.equal(r.response.created_at, 1793750400)
    assert.equal(r.usage?.input_tokens_details?.cached_tokens, 0)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Validated output: no tool call', async () => {
    const { fn } = fakeFetch(json(response([message('nothing to log')])))
    const r = await client(fn).responses.callTool({
      model: 'm',
      input: 'x',
      tool: { name: 'log', description: 'd', parameters: {}, schema: MlSchema },
    })
    assert.deepEqual(r.calls, [])
    assert.equal(r.text, 'nothing to log')
  })
})

// ---------- SAM ----------

describe('sam', () => {
  const samText =
    '<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334;c=0.9|>' +
    "<|mask;x=0;y=0;c=0.9;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>\n"

  it('[model-api/client] No upstream retention: SAM request', async () => {
    const { fn, sent } = fakeFetch(json(response([message(samText)], { model: 'sam-3.1' })))
    const r = await client(fn).sam.segment({ image: 'data:image/jpeg;base64,AA==', prompt: 'urine bag' })
    assert.equal(r.masks.length, 1)
    assert.equal(r.masks[0]!.confidence, 0.9)
    assert.deepEqual(r.masks[0]!.bounds, { left: 211, top: 228, right: 271, bottom: 255 })
    const body = sent[0]!.json!
    assert.equal(body.model, 'sam-3.1')
    assert.deepEqual(body.metadata, { include_confidence: 'true', mask_encoding: 'lossless' })
    assert.equal(body.store, false)
  })

  it('treats empty output as zero matches', async () => {
    const { fn } = fakeFetch(json(response([message('')])))
    const r = await client(fn).sam.segment({ image: 'https://x/y.jpg', prompt: 'cup' })
    assert.equal(r.masks.length, 0)
  })

  // https://dev.meta.ai/docs/sam/reading-segmentation: "Zero matches produce an empty output_text with no delta events".
  it('treats a reply with no output items as zero matches', async () => {
    const { fn, sent } = fakeFetch(json(response([], { model: 'sam-3.1' })))
    const r = await client(fn).sam.segment({ image: 'https://x/y.jpg', prompt: 'cup' })
    assert.equal(r.masks.length, 0)
    assert.equal(r.boxes.length, 0)
    assert.equal(sent.length, 1)
  })
})

// ---------- prompt cache ----------

describe('prompt cache', () => {
  const samText = '<0f>0<|box;x1=1;y1=1;x2=2;y2=2;w=4;h=4;c=0.9|>\n'

  it('[model-api/client] No extended prompt cache: Reading and segmenting', async () => {
    const { fn, sent } = fakeFetch(json(response([message('{"ml":450}')])), json(response([message(samText)], { model: 'sam-3.1' })))
    const c = client(fn)
    await c.responses.generateObject({ model: 'muse-spark-1.3', input: 'x', output })
    await c.sam.segment({ image: 'data:image/jpeg;base64,AA==', prompt: 'urine bag' })
    assert.equal(sent.length, 2)
    for (const s of sent) assert.ok(!('prompt_cache_retention' in s.json!), 'no prompt_cache_retention key')
  })

  it('[model-api/client] No extended prompt cache: Caller asks for 24 hours', async () => {
    const { fn, sent } = fakeFetch(json(response([message('ok')])))
    const params = { model: 'muse-spark-1.3', input: 'x', prompt_cache_retention: '24h' } as unknown as Parameters<
      ReturnType<typeof client>['responses']['create']
    >[0]
    await client(fn).responses.create(params)
    assert.equal(sent.length, 1)
    assert.ok(!('prompt_cache_retention' in sent[0]!.json!), 'no prompt_cache_retention key')
    assert.equal(sent[0]!.json!.store, false)
  })
})

// ---------- ASR ----------

/**
 * Mono-or-not PCM WAV: RIFF/WAVE, `fmt `, optional chunk of `extra` bytes (as `toWav`
 * writes a `LIST`), then `data` holding `dataBytes` zero bytes and declaring `declared`.
 */
function wav({
  rate = 16000,
  channels = 1,
  bits = 16,
  dataBytes = 4,
  declared = dataBytes,
  extra = 0,
  noData = false,
}: {
  rate?: number
  channels?: number
  bits?: number
  dataBytes?: number
  declared?: number
  extra?: number
  noData?: boolean
} = {}): Uint8Array {
  const head = 36 + (extra ? 8 + extra : 0)
  const b = new Uint8Array(head + (noData ? 0 : 8 + dataBytes))
  const v = new DataView(b.buffer)
  const put = (o: number, s: string) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  v.setUint32(4, b.byteLength - 8, true)
  put(8, 'WAVE')
  put(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, channels, true)
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, bits, true)
  if (extra) {
    put(36, 'LIST')
    v.setUint32(40, extra, true)
  }
  if (!noData) {
    put(head, 'data')
    v.setUint32(head + 4, declared, true)
  }
  return b
}

const asrOk = () => json({ sessionId: 's1', transcript: 'ok', audioDurationMs: 1000, turns: [] })

describe('asr', () => {
  it('[model-api/client] Audio checked locally: format check', () => {
    checkWav(wav())
    checkWav(wav({ rate: 24000 }))
    assert.throws(() => checkWav(wav({ channels: 2 })), InvalidAudioError)
    assert.throws(() => checkWav(wav({ rate: 44100 })), InvalidAudioError)
    assert.throws(() => checkWav(new TextEncoder().encode('OggS....')), InvalidAudioError)
  })

  it('[model-api/client] Audio checked locally: invalid audio never sent', async () => {
    const { fn, sent } = fakeFetch()
    await assert.rejects(client(fn).asr.transcribe({ audio: wav({ bits: 8 }) }), InvalidAudioError)
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Audio checked locally: valid upload', async () => {
    const { fn, sent } = fakeFetch(json({ sessionId: 's1', transcript: ' hello ', audioDurationMs: 900, turns: [] }))
    const r = await client(fn).asr.transcribe({ audio: wav(), languageBias: ['en', 'hi'] })
    assert.equal(r.transcript, 'hello')
    assert.equal(sent[0]!.url, 'https://api.meta.ai/v1/asr/transcribe')
    const form = sent[0]!.init.body as FormData
    const req = JSON.parse(await (form.get('request') as Blob).text())
    assert.deepEqual(req, { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', languageBias: ['en', 'hi'] })
    assert.ok(form.get('audio') instanceof Blob)
  })

  it('[model-api/client] Audio checked locally: Ten minutes exactly', async () => {
    const { fn, sent } = fakeFetch(asrOk(), asrOk())
    const c = client(fn)
    await c.asr.transcribe({ audio: wav({ dataBytes: 19_200_000 }) })
    await c.asr.transcribe({ audio: wav({ rate: 24000, dataBytes: 28_800_000 }) })
    assert.equal(sent.length, 2)
  })

  it('[model-api/client] Audio checked locally: Over ten minutes never sent', async () => {
    const { fn, sent } = fakeFetch()
    const err = await client(fn)
      .asr.transcribe({ audio: wav({ dataBytes: 19_200_032 }) })
      .catch((e) => e)
    assert.ok(err instanceof AudioTooLongError)
    assert.ok(err instanceof InvalidAudioError)
    assert.equal(err.durationMs, 600001)
    assert.equal(err.limitMs, 600000)
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Audio checked locally: Over ten minutes and over 32 MB', async () => {
    const { fn, sent } = fakeFetch()
    const err = await client(fn)
      .asr.transcribe({ audio: wav({ rate: 24000, dataBytes: 34_000_000 }) })
      .catch((e) => e)
    assert.ok(err instanceof AudioTooLongError, 'length error, not the size error')
    assert.equal(err.durationMs, 708333)
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Audio checked locally: Header claims more than the file holds', async () => {
    const audio = wav({ dataBytes: 32_000, declared: 40_000_000 })
    checkWav(audio)
    const { fn, sent } = fakeFetch(asrOk())
    await client(fn).asr.transcribe({ audio })
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Audio checked locally: Chunk between fmt and data', async () => {
    const audio = wav({ dataBytes: 19_200_032, extra: 26 })
    assert.equal(String.fromCharCode(...audio.subarray(70, 74)), 'data')
    const { fn, sent } = fakeFetch()
    const err = await client(fn)
      .asr.transcribe({ audio })
      .catch((e) => e)
    assert.ok(err instanceof AudioTooLongError)
    assert.equal(err.durationMs, 600001)
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Audio checked locally: No data chunk', async () => {
    const { fn, sent } = fakeFetch()
    const err = await client(fn)
      .asr.transcribe({ audio: wav({ noData: true }) })
      .catch((e) => e)
    assert.ok(err instanceof InvalidAudioError)
    assert.ok(!(err instanceof AudioTooLongError))
    assert.equal(sent.length, 0)
  })
})

// ---------- images ----------

describe('images', () => {
  const PNG8 = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const reply = (over: Record<string, unknown> = {}) => json({ created: 1793750400, data: [{ b64_json: 'iVBORw0KGgo=' }], ...over })
  const blocked = (status: number, param: string) =>
    json({ error: { type: 'invalid_request_error', code: 'content_policy_violation', param, message: 'blocked' } }, status)

  it('[model-api/client] Image requests: Generate with defaults', async () => {
    const { fn, sent } = fakeFetch(
      reply({ data: [{ b64_json: 'iVBORw0KGgo=', revised_prompt: 'a drainage bag on a bed rail' }], output_format: 'png' }),
    )
    const r = await client(fn).images.generate({ model: 'muse-image-1.0', prompt: 'a urine drainage bag hanging on a bed frame' })
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.url, 'https://api.meta.ai/v1/images/generations')
    assert.equal(sent[0]!.init.method, 'POST')
    assert.deepEqual(sent[0]!.json, {
      model: 'muse-image-1.0',
      prompt: 'a urine drainage bag hanging on a bed frame',
      n: 1,
      response_format: 'b64_json',
      reasoning_strength: 'low',
      tool_enablement: { enable_image_search: false, enable_web_search: false, enable_shell: false },
    })
    assert.equal(r.images.length, 1)
    assert.deepEqual([...r.images[0]!.bytes], PNG8)
    assert.equal(r.images[0]!.revisedPrompt, 'a drainage bag on a bed rail')
    assert.equal(r.created, 1793750400)
    assert.equal(r.outputFormat, 'png')
    assert.equal(r.model, 'muse-image-1.0')
  })

  it('[model-api/client] Image requests: Edit one image', async () => {
    const { fn, sent } = fakeFetch(reply({ output_format: 'webp' }))
    const r = await client(fn).images.edit({
      prompt: 'show the bag about one quarter full',
      images: [{ image_url: 'data:image/jpeg;base64,/9j/4AAQ' }],
      outputFormat: 'webp',
    })
    assert.equal(r.images.length, 1)
    assert.equal(sent.length, 1)
    assert.equal(sent[0]!.url, 'https://api.meta.ai/v1/images/edits')
    assert.equal((sent[0]!.init.headers as Record<string, string>)['Content-Type'], 'application/json')
    const body = sent[0]!.json!
    assert.deepEqual(body.images, [{ image_url: 'data:image/jpeg;base64,/9j/4AAQ' }])
    assert.equal(body.output_format, 'webp')
    assert.equal(body.n, 1)
    assert.equal(body.response_format, 'b64_json')
    for (const k of ['stream', 'moderation', 'mask', 'input_fidelity', 'partial_images', 'store']) assert.ok(!(k in body), k)
  })

  it('[model-api/client] Image requests: Server error not retried', async () => {
    const { fn, sent } = fakeFetch(json({ error: { type: 'server_error', message: 'transient image failure' } }, 503))
    const err = await client(fn)
      .images.generate({ prompt: 'a jug' })
      .catch((e) => e)
    assert.ok(err instanceof MetaApiError)
    assert.equal(err.status, 503)
    assert.equal(err.retryable, true)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Image requests: No image in the reply', async () => {
    const { fn, sent } = fakeFetch(reply({ data: [{ url: 'https://cdn.example/img.webp' }] }))
    const err = await client(fn)
      .images.generate({ prompt: 'a jug' })
      .catch((e) => e)
    assert.ok(err instanceof MetaOutputError)
    assert.equal(sent.length, 1, 'the URL is never fetched')
  })

  it('[model-api/client] Image calls checked locally: Bad calls never sent', async () => {
    const { fn, sent } = fakeFetch()
    const c = client(fn)
    const img = { image_url: 'data:image/png;base64,' }
    const bad: (() => Promise<unknown>)[] = [
      () => c.images.generate({ prompt: '   ' }),
      () => c.images.generate({ prompt: 'a jug', n: 0 }),
      () => c.images.generate({ prompt: 'a jug', n: 11 }),
      () => c.images.generate({ prompt: 'a jug', n: 1.5 }),
      () => c.images.generate({ prompt: 'a jug', temperature: 2.5 }),
      () => c.images.generate({ prompt: 'a jug', size: '1700x100' }),
      () => c.images.generate({ prompt: 'a jug', size: 'square' }),
      () => c.images.generate({ prompt: 'a jug', timeoutMs: 0 }),
      () => c.images.generate({ prompt: 'a jug', timeoutMs: 1.5 }),
      () => c.images.edit({ prompt: 'a jug', images: [] }),
      () => c.images.edit({ prompt: 'a jug', images: Array.from({ length: 11 }, () => img) }),
      () => c.images.edit({ prompt: 'a jug', images: [{ image_url: 'data:image/png;base64,', file_id: 'file_1' } as never] }),
    ]
    for (const call of bad) await assert.rejects(call(), InvalidImageRequestError)
    assert.equal(sent.length, 0)
  })

  it('[model-api/client] Image calls checked locally: Limits allowed', async () => {
    const { fn, sent } = fakeFetch(reply(), reply())
    const c = client(fn)
    await c.images.generate({ prompt: 'a jug', n: 10, temperature: 2, size: '1600x100' })
    await c.images.edit({ prompt: 'a jug', images: Array.from({ length: 10 }, () => ({ image_url: 'data:image/png;base64,' })) })
    assert.equal(sent.length, 2)
  })

  it('[model-api/client] Content policy refusals: Blocked prompt', async () => {
    const { fn, sent } = fakeFetch(blocked(400, 'prompt'))
    const err = await client(fn)
      .images.generate({ prompt: 'a jug' })
      .catch((e) => e)
    assert.ok(err instanceof MetaContentPolicyError)
    assert.ok(err instanceof MetaApiError)
    assert.equal(err.name, 'MetaContentPolicyError')
    assert.equal(err.status, 400)
    assert.equal(err.code, 'content_policy_violation')
    assert.equal(err.param, 'prompt')
    assert.equal(err.retryable, false)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Content policy refusals: Any endpoint', async () => {
    const { fn, sent } = fakeFetch(blocked(400, 'input'))
    const err = await client(fn)
      .responses.create({ model: 'muse-spark-1.3', input: 'x' })
      .catch((e) => e)
    assert.ok(err instanceof MetaContentPolicyError)
    assert.equal(err.status, 400)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Content policy refusals: Retryable status', async () => {
    const { fn, sent } = fakeFetch(blocked(503, 'prompt'))
    const err = await client(fn)
      .images.generate({ prompt: 'a jug' })
      .catch((e) => e)
    assert.ok(err instanceof MetaContentPolicyError)
    assert.equal(err.status, 503)
    assert.equal(err.retryable, false)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Image calls take their own timeout: Longer for one call', async () => {
    const slow = (signal: AbortSignal) =>
      new Promise<Response>((res, rej) => {
        const t = setTimeout(() => res(reply()), 100)
        signal.addEventListener('abort', () => (clearTimeout(t), rej(signal.reason as Error)))
      })
    const { fn, sent } = fakeFetch(slow)
    const r = await client(fn, { timeoutMs: 20 }).images.generate({ prompt: 'a jug', timeoutMs: 500 })
    assert.equal(r.images.length, 1)
    assert.equal(sent.length, 1)
  })

  it('[model-api/client] Image calls take their own timeout: Others keep the client timeout', async () => {
    const hang = (signal: AbortSignal) =>
      new Promise<Response>((_, rej) => signal.addEventListener('abort', () => rej(signal.reason as Error)))
    const { fn, sent } = fakeFetch(hang)
    const err = await client(fn, { timeoutMs: 20 })
      .models.list()
      .catch((e) => e)
    assert.ok(err instanceof MetaTimeoutError)
    assert.equal(err.timeoutMs, 20)
    assert.equal(sent.length, 1)
  })
})
