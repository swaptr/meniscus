import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import type { ContainerReading, EntryList } from '@meniscus/shared'
import { jpeg, msg, reading, resp, testApp, upstream } from '../testing.ts'
import { main } from './demo-capture.ts'

// Synthetic only: a JPEG signature per file, staged items, fictional patients.
const ITEMS = [
  { file: 'demo-iv-01.jpg', category: 'iv', container: 'other', fluid: 'other', expected_ml: 1000, liquid_colour: null },
  { file: 'demo-urine-01.jpg', category: 'urine', container: 'urine_bag', fluid: 'urine', expected_ml: 1400, liquid_colour: 'dark' },
  { file: 'demo-water-02.jpg', category: 'water', container: 'water_jug', fluid: 'water', expected_ml: 300, liquid_colour: null },
  {
    file: 'demo-urinal-01.jpg',
    category: 'urine',
    container: 'urinal',
    fluid: 'urine',
    expected_ml: 350,
    liquid_colour: null,
    bed: '5B-6',
  },
].map((it) => ({ ...it, synthetic: true }))

/** Spark's reading for each item, in order. */
const READS: Partial<ContainerReading>[] = [
  { container: 'other', fluid: 'other', volume_ml: 1000, capacity_ml: 1000 },
  { container: 'urine_bag', fluid: 'urine', volume_ml: 1400, capacity_ml: 2000 },
  { container: 'water_jug', fluid: 'water', volume_ml: 300, capacity_ml: 1500 },
  { container: 'urinal', fluid: 'urine', volume_ml: 350, capacity_ml: 1000 },
]

const dirs: string[] = []
after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))))

async function pack(items: Record<string, unknown>[] = ITEMS) {
  const dir = await mkdtemp(join(tmpdir(), 'meniscus-demo-capture-'))
  dirs.push(dir)
  for (const it of items) await writeFile(join(dir, it.file as string), jpeg)
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ pack: 'test', synthetic: true, items }))
  return dir
}

/** The real app over a fake Meta upstream; the script's only way in is `fetch` against it. */
async function harness(o: { failSparkAt?: number } = {}) {
  let sparks = 0
  const u = upstream({
    budget: { perHour: 120 },
    spark: () => {
      const n = sparks++
      if (n === o.failSparkAt) return Response.json({ error: { message: 'boom', type: 'server_error' } }, { status: 500 })
      return resp('muse-spark-1.3', [msg(JSON.stringify(reading(READS[n] ?? {})))])
    },
  })
  const t = await testApp({ ai: u.ai })
  const beds = new Map((await t.store.admissions()).map((a) => [`${a.ward_code}-${a.bed}`, a.id]))
  // The story's prior state: 5B-4's jug at 650 mL, 2C-5's bag checked at 200 mL.
  await t.store.addLevel(beds.get('5B-4')!, { container: 'water_jug', volume_ml: 650, source: 'manual' }, 3)
  await t.store.addBagReading(beds.get('2C-5')!, { container: 'urine_bag', event: 'check', volume_ml: 200, source: 'manual' }, 3)
  const calls: string[] = []
  const lines: string[] = []
  const deps = {
    fetch: (url: string, init?: RequestInit) => {
      const u2 = new URL(url)
      calls.push(`${init?.method ?? 'GET'} ${u2.pathname}`)
      return Promise.resolve(t.app.request(u2.pathname + u2.search, init))
    },
    log: (l: string) => void lines.push(l),
    shrink: (b: Uint8Array) => Promise.resolve(b),
    colour: () => Promise.resolve('#d8b04a'),
  }
  const entries = async (bed: string) => {
    const res = await t.request(`/api/admissions/${beds.get(bed)}/entries`)
    return ((await res.json()) as EntryList).entries
  }
  return { u, t, deps, calls, lines, beds, entries, text: () => lines.join('\n') }
}

describe('demo:capture', () => {
  it('demo:capture: a dry run sends nothing at all, so 0 model requests', async () => {
    const h = await harness()
    const dir = await pack()
    assert.equal(await main(['https://meniscus.example', dir], h.deps), 0)
    assert.deepEqual(h.calls, [])
    assert.equal(h.u.requests.length, 0)
    assert.match(h.text(), /plan: 12 model requests/)
    assert.match(h.text(), /demo-urine-01\.jpg\s+bed 2C-5\s+urine_bag\s+→ bag reading/)
    assert.match(h.text(), /demo-urinal-01\.jpg\s+bed 5B-6/)
    assert.match(h.text(), /dry run/)
  })

  it('demo:capture: refuses an item that is not synthetic, before anything is sent', async () => {
    const h = await harness()
    const dir = await pack([{ ...ITEMS[0]!, synthetic: false }])
    assert.equal(await main(['https://meniscus.example', dir, '--yes'], h.deps), 2)
    assert.deepEqual(h.calls, [])
  })

  it('demo:capture: --yes captures as the web does, 3 model requests per photo, leaving pending entries on the mapped beds', async () => {
    const h = await harness()
    const dir = await pack()
    const before = (await h.entries('5B-1')).length
    assert.equal(await main(['https://meniscus.example/', dir, '--yes'], h.deps), 0, h.text())
    assert.equal(h.u.requests.length, 12)
    assert.deepEqual(
      h.u.requests.map((r) => r.split(':')[0]),
      Array.from({ length: 4 }, () => ['sam', 'sam', 'spark']).flat(),
    )
    assert.ok(
      h.u.bodies.every((b) => b.model === 'sam-3.1' || b.store === false),
      'store: false on every Responses request',
    )
    // The web's sequence: sign in, the ward list, then per photo: open the bed, read, keep the photo, save.
    assert.deepEqual(h.calls.slice(0, 2), ['POST /api/session', 'GET /api/admissions'])
    assert.equal(h.calls.filter((c) => c === 'POST /api/ai/read').length, 4)
    // An IV bag charts nothing from a photo: read and logged, no photo kept, no entry.
    assert.equal((await h.entries('5B-1')).length, before)
    assert.equal(h.calls.filter((c) => c.endsWith('/media')).length, 3)

    const bag = (await h.entries('2C-5')).filter((e) => e.status === 'pending' && e.category === 'urine' && e.source === 'photo')
    assert.equal(bag.length, 1)
    assert.equal(bag[0]!.volume_ml, 1200)
    const jug = (await h.entries('5B-4')).filter((e) => e.status === 'pending' && e.category === 'water' && e.source === 'photo')
    assert.equal(jug.length, 1)
    assert.equal(jug[0]!.volume_ml, 350)
    const urinal = (await h.entries('5B-6')).filter((e) => e.status === 'pending' && e.source === 'photo' && e.volume_ml === 350)
    assert.equal(urinal.length, 1)
    assert.equal(urinal[0]!.created_by?.name, 'Mohan Das')
    assert.equal(urinal[0]!.has_photo, true)
    assert.match(h.text(), /12 model requests sent/)
  })

  it('demo:capture: the first error stops the run, with no retries', async () => {
    const h = await harness({ failSparkAt: 1 })
    const dir = await pack()
    assert.equal(await main(['https://meniscus.example', dir, '--yes'], h.deps), 1)
    // The IV read (3), then the urine bag's SAM pair and its failed Spark: nothing after.
    assert.equal(h.u.requests.length, 6)
    assert.equal(h.calls.filter((c) => c === 'POST /api/ai/read').length, 2)
    assert.match(h.text(), /ERROR POST \/api\/ai\/read → 5\d\d/)
    assert.equal((await h.entries('5B-4')).filter((e) => e.status === 'pending' && e.source === 'photo').length, 0)
  })

  it('demo:capture: a bed not on the deployment stops before any model request', async () => {
    const h = await harness()
    const dir = await pack([{ ...ITEMS[3]!, bed: '9Z-1' }])
    assert.equal(await main(['https://meniscus.example', dir, '--yes'], h.deps), 1)
    assert.equal(h.u.requests.length, 0)
    assert.match(h.text(), /no admission on bed 9Z-1/)
  })
})
