import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createMetaClient, type BudgetOptions } from '@meniscus/meta'
import { ModelApiNotConfiguredError } from '../model-api.ts'
import { main } from './synth.ts'

// Synthetic inputs: file signatures plus filler. No real photos, no people.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const WEBP = new TextEncoder().encode('RIFF\x08\0\0\0WEBPVP8 ')
const GIF = new TextEncoder().encode('GIF89a\x01\0\x01\0')
/** `RIFF....WEBP` as base64: what the fake API returns by default. */
const WEBP_B64 = 'UklGRgAAAABXRUJQ'
const PNG8_B64 = 'iVBORw0KGgo='

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const img = (over: Record<string, unknown> = {}) => json({ created: 1793750400, data: [{ b64_json: WEBP_B64 }], ...over })
const apiError = (status: number, error: Record<string, unknown>) => json({ error: { message: 'x', ...error } }, status)

function fakeFetch(...replies: Response[]) {
  const sent: { url: string; json: Record<string, unknown> }[] = []
  const fn = ((url: string, init: RequestInit) => {
    sent.push({ url, json: typeof init.body === 'string' ? JSON.parse(init.body) : {} })
    const r = replies.shift()
    return r ? Promise.resolve(r) : Promise.reject(new Error('unexpected request'))
  }) as unknown as typeof fetch
  return { fn, sent }
}

/** One real client over a fake fetch; `deps.client` counts how often the script builds it. */
function harness(replies: Response[] = [], o: { perHour?: number; budget?: BudgetOptions } = {}) {
  const f = fakeFetch(...replies)
  const client = createMetaClient({ apiKey: 'LLM_test', fetch: f.fn, budget: o.budget ?? { perHour: 120, maxConcurrent: 4 } })
  const lines: string[] = []
  let built = 0
  const deps = {
    client: () => (built++, client),
    perHour: o.perHour ?? 120,
    log: (l: string) => void lines.push(l),
  }
  return { deps, client, sent: f.sent, lines, built: () => built, text: () => lines.join('\n') }
}

const dirs: string[] = []
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))))

/** A temp folder holding `plan.json` and the given input files; outputs go to `out/`. */
async function workspace(plan: unknown, files: Record<string, Uint8Array> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'meniscus-synth-'))
  dirs.push(dir)
  for (const [name, bytes] of Object.entries(files)) await writeFile(join(dir, name), bytes)
  await writeFile(join(dir, 'plan.json'), JSON.stringify(plan))
  return { dir, plan: join(dir, 'plan.json'), out: join(dir, 'out') }
}

const gen = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'generate',
  prompt: 'a staged drainage bag on a bed frame, no people',
  ...extra,
})
const edit = (id: string, inputs: unknown[], extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'edit',
  prompt: 'the same container a little fuller',
  inputs,
  ...extra,
})
const plan = (...items: unknown[]) => ({ version: 1, items })
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const ls = async (d: string) => (await readdir(d).catch(() => [] as string[])).sort()

describe('synth: plan file', () => {
  it('[eval/synthetic-images] Plan file: Valid plan', async () => {
    const w = await workspace(
      plan(
        gen('probe-bag-half', { labels: { expected_container: 'urine_bag', liquid_colour: 'dark', expected_ml: 1000 } }),
        edit('gen-tray-01', [{ path: 'tray-001.jpg', id: 'tray-001' }], {
          labels: {
            expected_container: 'food_tray',
            truth: { expected_items: [{ name: 'bread roll', portion_eaten_pct: 100 }] },
            pair_id: 'pair-tray-001',
            pair_role: 'after',
          },
        }),
      ),
      { 'tray-001.jpg': JPEG },
    )
    const h = harness()
    assert.equal(await main([w.plan, w.out], h.deps), 0)
    assert.match(h.text(), /2 requests, 2 images, \$0\.02/)
    assert.equal(h.sent.length, 0)
    assert.equal(h.built(), 0)
  })

  it('[eval/synthetic-images] Plan file: Invalid plans', async () => {
    const cases: [unknown, Record<string, Uint8Array>, string][] = [
      [plan(gen('bag-a', { patient_name: 'Test Person' })), {}, 'invalid plan: bag-a: unknown field patient_name'],
      [plan(gen('bag-a'), gen('bag-a')), {}, 'invalid plan: bag-a: duplicate id'],
      [plan(gen('../bag')), {}, 'invalid plan: ../bag: id must be lowercase letters, digits and hyphens'],
      [plan(gen('bag-a', { prompt: '   ' })), {}, 'invalid plan: bag-a: prompt is blank'],
      [plan(gen('bag-a', { n: 11 })), {}, 'invalid plan: bag-a: n must be an integer from 1 to 10'],
      [plan(gen('bag-a', { size: 'square' })), {}, 'invalid plan: bag-a: size must be <width>x<height> in positive integers'],
      [plan(gen('bag-a', { labels: { liquid_colour: 'amber' } })), {}, 'invalid plan: bag-a: labels.liquid_colour is not allowed'],
      [plan(edit('bag-a', [])), {}, 'invalid plan: bag-a: an edit needs 1 to 10 inputs'],
      [
        plan(gen('bag-a', { inputs: [{ path: 'bag.webp' }] })),
        { 'bag.webp': WEBP },
        'invalid plan: bag-a: a generate item takes no inputs',
      ],
      [plan(edit('bag-a', [{ path: 'missing.jpg' }])), {}, 'invalid plan: bag-a: input missing.jpg not found'],
      [plan(edit('bag-a', [{ path: 'bag.gif' }])), { 'bag.gif': GIF }, 'invalid plan: bag-a: input bag.gif is not JPEG, PNG or WebP'],
      [plan(gen('bag-a', { n: 2 }), gen('bag-a-1')), {}, 'invalid plan: bag-a and bag-a-1 both write synth-bag-a-1.json'],
    ]
    for (const [p, files, expected] of cases) {
      const w = await workspace(p, files)
      const h = harness([img(), img(), img()])
      assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 2, expected)
      assert.deepEqual(h.lines, [expected])
      assert.equal(h.sent.length, 0, expected)
      assert.equal(h.built(), 0, expected)
      assert.deepEqual(await ls(w.out), [], expected)
    }
  })
})

describe('synth: dry run and made items', () => {
  it('[eval/synthetic-images] Dry run by default: Plan of 21', async () => {
    const items = Array.from({ length: 21 }, (_, i) => gen(`bag-${i + 1}`, i === 0 ? { n: 2 } : {}))
    const w = await workspace(plan(...items))
    const h = harness()
    assert.equal(await main([w.plan, w.out], h.deps), 0)
    assert.match(h.text(), /21 requests, 22 images, \$0\.22/)
    assert.match(h.text(), /dry run/)
    assert.equal(h.sent.length, 0)
  })

  it('[eval/synthetic-images] Made items are not remade: One already made', async () => {
    const w = await workspace(plan(gen('bag-a', { prompt: 'bag a' }), gen('bag-b', { prompt: 'bag b' }), gen('bag-c', { prompt: 'bag c' })))
    const placedImage = new TextEncoder().encode('RIFF')
    const placedSidecar = new TextEncoder().encode('{"id":"synth-bag-a"}\n')
    await mkdir(w.out)
    await writeFile(join(w.out, 'synth-bag-a.webp'), placedImage)
    await writeFile(join(w.out, 'synth-bag-a.json'), placedSidecar)

    const dry = harness()
    assert.equal(await main([w.plan, w.out], dry.deps), 0)
    assert.match(dry.text(), /1 already made/)
    assert.match(dry.text(), /2 requests/)
    assert.equal(dry.sent.length, 0)

    const run = harness([img(), img()])
    assert.equal(await main([w.plan, w.out, '--yes'], run.deps), 0)
    assert.equal(run.built(), 1)
    assert.deepEqual(
      run.sent.map((s) => s.json.prompt),
      ['bag b', 'bag c'],
    )
    assert.deepEqual(new Uint8Array(await readFile(join(w.out, 'synth-bag-a.webp'))), placedImage)
    assert.deepEqual(new Uint8Array(await readFile(join(w.out, 'synth-bag-a.json'))), placedSidecar)
  })

  it('[eval/synthetic-images] Made items are not remade: Partly made', async () => {
    const w = await workspace(plan(gen('tray-02', { n: 2 })))
    await mkdir(w.out)
    await writeFile(join(w.out, 'synth-tray-02-1.json'), '{}\n')
    const h = harness()
    assert.equal(await main([w.plan, w.out], h.deps), 0)
    assert.match(h.text(), /0 already made/)
    assert.match(h.text(), /1 request, 2 images, \$0\.02/)
    assert.equal(h.sent.length, 0)
  })
})

describe('synth: budget', () => {
  it('[eval/synthetic-images] Hourly budget checked first: Too big for the hour', async () => {
    const w = await workspace(plan(gen('bag-a'), gen('bag-b'), gen('bag-c')))
    const h = harness([json({ data: [] }), img(), img(), img()], { budget: { perHour: 3, maxConcurrent: 1 } })
    await h.client.models.list()
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 2)
    assert.ok(h.lines.includes('plan needs 3 requests; 2 left this hour'), h.text())
    assert.equal(h.sent.length, 1, 'only the earlier request')
    assert.equal(h.built(), 1)
  })

  it('[eval/synthetic-images] Hourly budget checked first: Reserve kept back', async () => {
    const w = await workspace(plan(...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => gen(`bag-${k}`))))
    const h = harness([json({ data: [] })], { budget: { perHour: 10, maxConcurrent: 1, reservePct: 30 } })
    await h.client.models.list()
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 2)
    assert.ok(h.lines.includes('plan needs 7 requests; 6 left this hour'), h.text())
    assert.equal(h.sent.length, 1, 'only the earlier request')
  })

  it('[eval/synthetic-images] Hourly budget checked first: Dry run without a key', async () => {
    const w = await workspace(plan(gen('bag-a'), gen('bag-b')))
    const lines: string[] = []
    let built = 0
    const deps = {
      client: () => {
        built++
        throw new ModelApiNotConfiguredError('MODEL_API_KEY is not set')
      },
      perHour: 120,
      reservePct: 30,
      log: (l: string) => void lines.push(l),
    }
    assert.equal(await main([w.plan, w.out], deps), 0)
    assert.match(lines.join('\n'), /2 requests/)
    assert.match(lines.join('\n'), /84 left/)
    assert.equal(built, 0)
  })
})

describe('synth: sending', () => {
  it('[eval/synthetic-images] Items sent in order, stop at first failure: All sent', async () => {
    const w = await workspace(
      plan(gen('bag-a'), edit('bag-a-0300', [{ path: 'bag-a.webp' }]), edit('bag-a-0600', [{ path: 'bag-a.webp' }])),
      {
        'bag-a.webp': WEBP,
      },
    )
    const h = harness([img(), img(), img()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.deepEqual(
      h.sent.map((s) => new URL(s.url).pathname),
      ['/v1/images/generations', '/v1/images/edits', '/v1/images/edits'],
    )
    assert.deepEqual(h.sent[1]!.json.images, [{ image_url: `data:image/webp;base64,${Buffer.from(WEBP).toString('base64')}` }])
    assert.deepEqual(await ls(w.out), [
      'synth-bag-a-0300.json',
      'synth-bag-a-0300.webp',
      'synth-bag-a-0600.json',
      'synth-bag-a-0600.webp',
      'synth-bag-a.json',
      'synth-bag-a.webp',
    ])
    assert.ok(h.lines.includes('3 of 3 requests sent'), h.text())
    assert.equal(h.built(), 1)
  })

  it('[eval/synthetic-images] Items sent in order, stop at first failure: Blocked at the second item', async () => {
    const w = await workspace(plan(gen('bag-a'), gen('bag-b'), gen('bag-c')))
    const h = harness([img(), apiError(400, { type: 'invalid_request_error', code: 'content_policy_violation', param: 'prompt' }), img()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 1)
    assert.equal(h.sent.length, 2, 'bag-c never sent')
    assert.deepEqual(await ls(w.out), ['synth-bag-a.json', 'synth-bag-a.webp'])
    assert.ok(h.lines.includes('stopped at bag-b: content_policy_violation; 2 of 3 requests sent'), h.text())
  })

  it('[eval/synthetic-images] Items sent in order, stop at first failure: Retryable error not retried', async () => {
    const w = await workspace(plan(gen('bag-a'), gen('bag-b')))
    const h = harness([apiError(503, { type: 'server_error' }), img(), img()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 1)
    assert.equal(h.sent.length, 1)
    assert.deepEqual(await ls(w.out), [])
  })

  it('[eval/synthetic-images] Items sent in order, stop at first failure: Fewer images than asked', async () => {
    const w = await workspace(plan(gen('tray-02', { n: 2 }), gen('bag-b')))
    const h = harness([img(), img()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 1)
    assert.equal(h.sent.length, 1)
    assert.deepEqual(await ls(w.out), [])
    assert.ok(h.lines.includes('stopped at tray-02: image_count; 1 of 2 requests sent'), h.text())
  })
})

describe('synth: outputs', () => {
  it('[eval/synthetic-images] Image saved as returned: Byte-exact PNG', async () => {
    const w = await workspace(plan(gen('bag-a', { output_format: 'png' })))
    const h = harness([img({ data: [{ b64_json: PNG8_B64 }], output_format: 'png' })])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0]!.json.output_format, 'png')
    assert.deepEqual([...(await readFile(join(w.out, 'synth-bag-a.png')))], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  })

  it('[eval/synthetic-images] Image saved as returned: Two images from one item', async () => {
    const w = await workspace(plan(gen('tray-02', { n: 2, output_format: 'webp' })))
    const h = harness([img({ data: [{ b64_json: WEBP_B64 }, { b64_json: WEBP_B64 }], output_format: 'webp' })])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0]!.json.n, 2)
    assert.deepEqual(await ls(w.out), ['synth-tray-02-1.json', 'synth-tray-02-1.webp', 'synth-tray-02-2.json', 'synth-tray-02-2.webp'])
    const second = JSON.parse(await readFile(join(w.out, 'synth-tray-02-2.json'), 'utf8'))
    assert.equal(second.id, 'synth-tray-02-2')
    assert.equal(second.index, 2)
  })

  it('[eval/synthetic-images] Provenance sidecar: Edit sidecar', async () => {
    const labels = {
      expected_container: 'food_tray',
      truth: { expected_items: [{ name: 'bread roll', portion_eaten_pct: 100 }] },
      pair_id: 'pair-tray-001',
      pair_role: 'after',
    }
    const prompt = 'the same tray after the meal, about half of each dish eaten'
    const w = await workspace(plan(edit('gen-tray-01', [{ path: 'tray-001.jpg', id: 'tray-001' }], { prompt, labels })), {
      'tray-001.jpg': JPEG,
    })
    const h = harness([img({ created: 1793750400, data: [{ b64_json: WEBP_B64, revised_prompt: 'half-eaten hospital tray' }] })])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.equal(h.sent.length, 1)
    const sc = JSON.parse(await readFile(join(w.out, 'synth-gen-tray-01.json'), 'utf8'))
    assert.equal(sc.id, 'synth-gen-tray-01')
    assert.equal(sc.synthetic, true)
    assert.equal(sc.label_status, 'draft')
    assert.equal(sc.verified_by, null)
    assert.equal(sc.generator, 'muse-image-1.0')
    assert.equal(sc.plan_item, 'gen-tray-01')
    assert.equal(sc.kind, 'edit')
    assert.equal(sc.prompt, prompt)
    assert.equal(sc.revised_prompt, 'half-eaten hospital tray')
    assert.equal(sc.created, 1793750400)
    assert.equal(sc.sha256, sha(await readFile(join(w.out, 'synth-gen-tray-01.webp'))))
    assert.deepEqual(sc.source_sha256, [sha(JPEG)])
    assert.deepEqual(sc.source_ids, ['tray-001'])
    assert.deepEqual(sc.labels, labels)
  })

  it('[eval/synthetic-images] Provenance sidecar: Generate sidecar', async () => {
    const labels = { expected_container: 'urine_bag', expected_fluid: 'urine', liquid_colour: 'dark', expected_ml: 1000 }
    const w = await workspace(plan(gen('probe-bag-half', { labels })))
    const h = harness([img()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.equal(h.sent.length, 1)
    const sc = JSON.parse(await readFile(join(w.out, 'synth-probe-bag-half.json'), 'utf8'))
    assert.equal(sc.id, 'synth-probe-bag-half')
    assert.equal(sc.kind, 'generate')
    assert.equal(sc.label_status, 'draft')
    assert.deepEqual(sc.labels, labels)
    assert.ok(!('source_sha256' in sc))
  })

  it('[eval/synthetic-images] Script output carries no image or prompt: Two items sent', async () => {
    const prompt = 'amber urine in a bag on a bed rail'
    const w = await workspace(plan(gen('bag-a', { prompt, labels: { liquid_colour: 'dark' } }), gen('bag-b', { prompt })))
    const reply = () => img({ data: [{ b64_json: PNG8_B64, revised_prompt: 'a bag of amber urine' }] })
    const h = harness([reply(), reply()])
    assert.equal(await main([w.plan, w.out, '--yes'], h.deps), 0)
    assert.equal(h.sent.length, 2)
    for (const l of h.lines) {
      for (const bad of ['amber', 'bed rail', 'iVBORw0KGgo', 'dark']) assert.ok(!l.includes(bad), `${bad} in: ${l}`)
    }
    assert.ok(h.lines.some((l) => l.includes('bag-a')))
    assert.ok(h.lines.some((l) => l.includes('bag-b')))
  })
})
