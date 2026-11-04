import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MealDish } from '@meniscus/shared'
import { createAi } from '../ai/pipeline.ts'
import { SAM_TEXT, dataUrl, imageOf, msg, png, resp, upstream } from '../testing.ts'
import { rateText } from './lab.ts'
import {
  aloneText,
  outcomeLine,
  planTray,
  runTrayJob,
  skippedTrayText,
  synthLabels,
  trayEvalArgs,
  trayJobs,
  trayLabels,
  trayManifest,
  trayReport,
  traySummary,
  type TrayRead,
  type TrayRow,
  type TrayTruth,
} from './tray-lab.ts'

const line = (r: object) => JSON.stringify(r)
const TRAY_002 = {
  id: 'tray-002',
  record_type: 'original',
  file: 'images/food_tray/tray-002.jpg',
  expected_items: [
    { name: 'peas', dish_kind: 'curry_vegetables', portion_eaten_pct: 0 },
    { name: 'mashed potato', dish_kind: 'curry_vegetables', portion_eaten_pct: 0 },
    { name: 'meat with gravy', dish_kind: 'meat_fish_egg', portion_eaten_pct: 0 },
  ],
  meal_portion_eaten: 0,
  expected_fluids: [],
  expected_outcome: 'positive',
}
const HARD_041 = {
  id: 'hard-041',
  record_type: 'original',
  expected_container: 'food_tray',
  expected_items: [],
  expected_outcome: 'negative',
  expected_issues: ['not_a_meal'],
}
const UBAG = { id: 'ubag-001', record_type: 'original', expected_items: null, expected_outcome: 'positive' }
const AUGMENTED = { ...TRAY_002, id: 'tray-002__blur_gauss_strong', record_type: 'augmented', expected_outcome_after: 'degraded' }
const MANIFEST = [TRAY_002, HARD_041, UBAG, AUGMENTED].map(line).join('\n')
const beside = (f: string) => `../dataset/${f}`

const truth = (over: Partial<TrayTruth> = {}): TrayTruth => ({ dishes: [], meal_portion: null, fluids: [], outcome: null, ...over })
const read = (over: Partial<TrayRead> = {}): TrayRead => ({ dishes: [], portion: 0, fluids: [], needs_review: false, issues: [], ...over })
const row = (t: TrayTruth, r: TrayRead | null, over: Partial<TrayRow> = {}): TrayRow => ({
  file: 'f.jpg',
  source: 'real',
  pair: false,
  mode: 'sam+spark',
  truth: t,
  read: r,
  ...over,
})
const VERIFIED = { synthetic: true, label_status: 'verified', verified_by: 'dev-1' }

describe('tray eval labels', () => {
  it('[charting/model-accuracy] Tray eval labels from the dataset: Tray labels', () => {
    const files = ['other-0-tray-002.jpg', 'other-0-hard-041.jpg', 'urine_bag-1700-ubag-001.jpg', 'tray-002__blur_gauss_strong.jpg']
    const plan = trayJobs(files, trayManifest(MANIFEST), new Map(), beside)
    assert.deepEqual(
      plan.jobs.map((j) => j.file),
      ['other-0-tray-002.jpg', 'other-0-hard-041.jpg'],
    )
    assert.equal(planTray(plan.jobs, ['sam+spark']), 6)
    assert.equal(planTray(plan.jobs, ['spark']), 2)
    assert.equal(skippedTrayText(plan.skipped), '2 photos without tray labels, skipped')
    const [tray, hard] = plan.jobs
    assert.deepEqual(tray!.truth, {
      dishes: [
        { dish_kind: 'curry_vegetables', portion: 0 },
        { dish_kind: 'curry_vegetables', portion: 0 },
        { dish_kind: 'meat_fish_egg', portion: 0 },
      ],
      meal_portion: 0,
      fluids: [],
      outcome: 'positive',
    })
    assert.deepEqual([hard!.truth.dishes, hard!.truth.outcome], [[], 'negative'])
    // The augmented record's labels are never read.
    const trap = new Proxy(AUGMENTED, {
      get: (o, k) => {
        if (k === 'expected_items' || k === 'expected_outcome_after') throw new Error(`read ${String(k)}`)
        return o[k as keyof typeof o]
      },
    })
    assert.equal(trayLabels(trap), null)
  })

  it('[charting/model-accuracy] Tray eval labels from the dataset: Flags that do not apply to trays', () => {
    const a = trayEvalArgs({ trayLabels: 'manifest.jsonl', containerLabels: 'manifest.jsonl' })
    const b = trayEvalArgs({ trayLabels: 'manifest.jsonl', noHint: true })
    assert.deepEqual([a?.exit, b?.exit], [2, 2])
    assert.match(a!.message, /--container-labels/)
    assert.match(b!.message, /--no-hint/)
    assert.equal(trayEvalArgs({ trayLabels: 'manifest.jsonl' }), null)
  })
})

describe('tray eval report', () => {
  it('[charting/model-accuracy] Tray eval report: Dishes paired by kind', () => {
    const t = truth({
      dishes: [
        { dish_kind: 'rice', portion: 0 },
        { dish_kind: 'dal_lentils', portion: 0 },
      ],
    })
    const r = read({
      dishes: [
        { dish_kind: 'dal_lentils', portion: 0, basis: 'model' },
        { dish_kind: 'rice', portion: 25, basis: 'model' },
      ],
    })
    assert.deepEqual(trayReport([row(t, r)]).dish_pairs, [
      ['dal_lentils', 'dal_lentils', 0],
      ['rice', 'rice', 1],
    ])
  })

  it('[charting/model-accuracy] Tray eval report: Portions by basis', () => {
    const t = truth({
      dishes: [
        { dish_kind: 'rice', portion: 50 },
        { dish_kind: 'curry_vegetables', portion: 0 },
      ],
    })
    const r = read({
      dishes: [
        { dish_kind: 'rice', portion: 50, basis: 'measured' },
        { dish_kind: 'curry_vegetables', portion: 25, basis: 'model' },
      ],
    })
    const p = trayReport([row(t, r)]).portions
    assert.equal(`${p.measured!.exact.pct ?? '—'} · ${p.measured!.exact.n}/${p.measured!.exact.of}`, '— · 1/1')
    assert.equal(`${p.model!.exact.pct ?? '—'} · ${p.model!.exact.n}/${p.model!.exact.of}`, '— · 0/1')
    assert.equal(`${p.model!.within_quarter.pct ?? '—'} · ${p.model!.within_quarter.n}/${p.model!.within_quarter.of}`, '— · 1/1')
  })

  it('[charting/model-accuracy] Tray eval report: Unscored values', () => {
    const rec = trayLabels({
      record_type: 'original',
      expected_items: [{ name: 'x', dish_kind: 'rice', portion_eaten_pct: null }],
      expected_fluids: [{ name: 'water', fluid_kind: 'none', volume_ml_estimate: 200 }],
    })!
    assert.deepEqual(rec.fluids, [])
    const r1 = trayReport([row(rec, read({ dishes: [{ dish_kind: 'rice', portion: 50, basis: 'model' }] }))])
    assert.equal(r1.dish_kinds[0]!.n, 1)
    assert.deepEqual(r1.portions, {})
    const soup = trayLabels({
      record_type: 'original',
      expected_items: [],
      expected_fluids: [{ name: 'soup', fluid_kind: 'soup', volume_ml_estimate: null }],
    })!
    const r2 = trayReport([row(soup, read({ fluids: [{ fluid_kind: 'soup', ml: 150 }] }))])
    assert.deepEqual(
      r2.fluid_kinds.map((k) => [k.model, k.n]),
      [['soup', 1]],
    )
    assert.equal(r2.fluid_ml.of, 0)
  })

  it('[charting/model-accuracy] Tray eval report: Tray outcomes', () => {
    const report = trayReport([
      row(truth({ outcome: 'negative' }), read({ issues: ['not_a_meal'] })),
      row(truth({ outcome: 'positive', dishes: [{ dish_kind: 'rice', portion: 0 }] }), read()),
    ])
    const by = Object.fromEntries(report.outcomes.map((o) => [o.outcome, outcomeLine(o)]))
    assert.equal(by.negative, '1 | 0 | 0 | 1 | — · 1/1')
    assert.equal(by.positive, '1 | 0 | 0 | 1 | — · 0/1')
  })
})

describe('tray eval report, scored like the ward', () => {
  /** A fake fetch that fails the test if any request is sent: every scenario here is pure. */
  const uncalled = upstream({
    sam: () => assert.fail('no SAM request'),
    spark: () => assert.fail('no Spark request'),
  })

  it('[charting/model-accuracy] Tray eval report: Left-over dishes paired in order', () => {
    const t = truth({
      dishes: [
        { dish_kind: 'rice', portion: 0 },
        { dish_kind: 'curry_vegetables', portion: 0 },
      ],
    })
    const r = read({
      dishes: [
        { dish_kind: 'rice', portion: 0, basis: 'model' },
        { dish_kind: 'bread', portion: 25, basis: 'model' },
      ],
    })
    const report = trayReport([row(t, r)])
    assert.deepEqual(report.dish_pairs, [
      ['rice', 'rice', 0],
      ['curry_vegetables', 'bread', 1],
    ])
    assert.deepEqual(
      report.dish_kinds.map((k) => [k.model, k.kept.n, k.kept.of, k.corrections]),
      [
        ['curry_vegetables', 0, 1, [{ to: 'bread', n: 1 }]],
        ['rice', 1, 1, []],
      ],
    )
    assert.equal(uncalled.requests.length, 0)
  })

  it('[charting/model-accuracy] Tray eval report: Same tolerance and floors', () => {
    const fluid = (ml: number) => row(truth({ fluids: [{ fluid_kind: 'soup', ml: 150 }] }), read({ fluids: [{ fluid_kind: 'soup', ml }] }))
    const near = trayReport([fluid(175)]).fluid_ml
    const far = trayReport([fluid(176)]).fluid_ml
    assert.deepEqual([near.within.n, near.within.of, far.within.n, far.within.of], [1, 1, 0, 1])
    const dishRows = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      row(
        truth({ dishes: [{ dish_kind: 'rice', portion: 50 }] }),
        read({ dishes: [{ dish_kind: 'rice', portion: i < 3 ? 50 : 100, basis: 'model' }] }),
      ),
    )
    assert.equal(rateText(trayReport(dishRows).portions.model!.exact), '42% · 3/7')
    assert.equal(uncalled.requests.length, 0)
  })

  it('[charting/model-accuracy] Tray eval report: Out-of-vocabulary values', () => {
    const rec = trayLabels({
      record_type: 'original',
      expected_items: [
        { name: 'rice', dish_kind: 'rice', portion_eaten_pct: 0 },
        { name: 'pizza', dish_kind: 'pizza', portion_eaten_pct: 0 },
        { name: 'bread', dish_kind: 'bread', portion_eaten_pct: 30 },
      ],
      expected_fluids: [{ name: 'kombucha', fluid_kind: 'kombucha', volume_ml_estimate: 150 }],
    })!
    const r = read({
      dishes: [
        { dish_kind: 'rice', portion: 0, basis: 'model' },
        { dish_kind: 'other', portion: 25, basis: 'model' },
        { dish_kind: 'bread', portion: 50, basis: 'model' },
      ],
      fluids: [{ fluid_kind: 'other', ml: 150 }],
    })
    const report = trayReport([row(rec, r)])
    const kind = (k: string) => report.dish_kinds.find((x) => x.model === k)!
    assert.deepEqual([kind('other').kept.n, kind('other').kept.of], [1, 1])
    assert.deepEqual(report.dish_pairs, [
      ['rice', 'rice', 0],
      ['other', 'other', 1],
      ['bread', 'bread', null],
    ])
    assert.deepEqual([kind('bread').n, report.portions.model!.exact.of], [1, 2])
    assert.deepEqual(
      report.fluid_kinds.map((k) => [k.model, k.kept.n, k.kept.of]),
      [['other', 1, 1]],
    )
    assert.deepEqual([report.fluid_ml.of, report.fluid_ml.within.n], [1, 1])
    assert.equal(uncalled.requests.length, 0)
  })
})

describe('drink kinds in the tray eval', () => {
  it('[charting/model-accuracy] Drink kinds in the lab evals: Coffee labelled', () => {
    const uncalled = upstream()
    const rec = trayLabels({
      record_type: 'original',
      expected_items: [],
      expected_fluids: [{ name: 'coconut water', fluid_kind: 'coconut_water', volume_ml_estimate: 200 }],
    })!
    const report = trayReport([row(rec, read({ fluids: [{ fluid_kind: 'coconut_water', ml: 200 }] }))])
    assert.deepEqual(
      report.fluid_kinds.map((k) => [k.model, k.kept.n, k.kept.of]),
      [['coconut_water', 1, 1]],
    )
    assert.equal(uncalled.requests.length, 0)
  })
})

describe('synthetic trays and pairs', () => {
  const synthGen = {
    ...VERIFIED,
    labels: { meal_portion_eaten: 75, truth: { expected_items: [{ dish_kind: 'rice', portion_eaten_pct: 75 }], expected_fluids: [] } },
  }

  it('[charting/model-accuracy] Synthetic trays in the tray eval: Synthetic labels', () => {
    assert.deepEqual(synthLabels(synthGen), truth({ dishes: [{ dish_kind: 'rice', portion: 75 }], meal_portion: 75 }))
    const plan = trayJobs(['synth-gen-tray-02.png'], new Map(), new Map([['synth-gen-tray-02', synthGen]]), beside)
    assert.equal(plan.jobs.length, 1)
    assert.equal(planTray(plan.jobs, ['sam+spark']), 3)
    const r = trayReport([
      row(plan.jobs[0]!.truth, read({ dishes: [{ dish_kind: 'rice', portion: 75, basis: 'model' }] }), { source: 'synthetic' }),
    ])
    assert.deepEqual(r.outcomes, [])
    // A draft sidecar is not scored.
    assert.equal(trayJobs(['synth-x.png'], new Map(), new Map([['synth-x', { ...synthGen, verified_by: null }]]), beside).jobs.length, 0)
  })

  it('[charting/model-accuracy] Synthetic trays in the tray eval: Real and synthetic apart', () => {
    const one = (source: 'real' | 'synthetic') =>
      row(truth({ dishes: [{ dish_kind: 'rice', portion: 0 }] }), read({ dishes: [{ dish_kind: 'rice', portion: 0, basis: 'model' }] }), {
        source,
      })
    const s = traySummary([one('real'), one('synthetic')])
    assert.equal(s.real['sam+spark']!.dish_kinds[0]!.n, 1)
    assert.equal(s.synthetic['sam+spark']!.dish_kinds[0]!.n, 1)
    assert.deepEqual(s.pairs, {})
  })

  const after = (sourceIds: string[]) => ({
    ...VERIFIED,
    source_ids: sourceIds,
    labels: { pair_id: 'pair-tray-001', pair_role: 'after', truth: { expected_items: [{ dish_kind: 'bread', portion_eaten_pct: 100 }] } },
  })
  const TRAY_001 = { ...TRAY_002, id: 'tray-001', file: 'images/food_tray/tray-001.jpg' }
  const manifest = trayManifest([TRAY_001].map(line).join('\n'))

  it('[charting/model-accuracy] Served and collected pairs in the tray eval: Pair planned', () => {
    const plan = trayJobs(
      ['tray-001.jpg', 'synth-gen-tray-01.png'],
      manifest,
      new Map([['synth-gen-tray-01', after(['tray-001'])]]),
      beside,
    )
    assert.equal(planTray(plan.jobs, ['sam+spark']), 8)
    assert.equal(planTray(plan.jobs, ['spark']), 2)
    assert.equal(plan.jobs[1]!.before, '../dataset/images/food_tray/tray-001.jpg')
    // An unreadable size is planned at 3.
    assert.equal(planTray([{ ...plan.jobs[1]!, sizesKnown: false }], ['sam+spark']), 3)
  })

  it('[charting/model-accuracy] Served and collected pairs in the tray eval: Pair read', async () => {
    const AFTER = png(1000, 800, 1)
    const BEFORE = png(1000, 800, 2)
    const meal = {
      dishes: [{ region: 1, name: 'bread', dish_kind: 'bread', eaten: 'all' }],
      eaten: 'all',
      fluids: [],
      confidence: 0.9,
      issues: [],
      notes: null,
    }
    const u = upstream({ sam: () => resp('sam-3.1', [msg(SAM_TEXT)]), spark: () => resp('muse-spark-1.3', [msg(JSON.stringify(meal))]) })
    const ai = createAi(() => u.client, { mealUseSam: true })
    const plan = trayJobs(['synth-gen-tray-01.png'], manifest, new Map([['synth-gen-tray-01', after(['tray-001'])]]), beside)
    const files: Record<string, Uint8Array> = { 'synth-gen-tray-01.png': AFTER, '../dataset/images/food_tray/tray-001.jpg': BEFORE }
    const r = await runTrayJob(ai, plan.jobs[0]!, 'sam+spark', (f) => Promise.resolve({ bytes: files[f]!, mime: 'image/png' }))
    assert.deepEqual(u.requests, ['sam:dish', 'sam:food', 'sam:dish', 'sam:food', 'spark:object'])
    assert.deepEqual(
      u.bodies.map((b) => (imageOf(b) === dataUrl(AFTER, 'image/png') ? 'after' : 'before')),
      ['after', 'after', 'before', 'before', 'after'],
    )
    const s = traySummary([r])
    assert.equal(s.pairs['sam+spark']!.n, 1)
    // Scored with the after photo's labels (bread, all eaten); the same SAM fixture on both photos measures it as 0.
    assert.deepEqual(s.pairs['sam+spark']!.dish_pairs, [['bread', 'bread', 4]])
    assert.deepEqual([s.real, s.synthetic], [{}, {}])
  })

  it('[charting/model-accuracy] Served and collected pairs in the tray eval: Before not found', () => {
    const plan = trayJobs(['synth-gen-tray-01.png'], manifest, new Map([['synth-gen-tray-01', after(['tray-999'])]]), beside)
    assert.equal(planTray(plan.jobs, ['sam+spark']), 3)
    assert.equal(aloneText(plan.alone), '1 pair without its before, read alone')
  })

  it('pairs read dishes whose basis is measured', () => {
    const d: Pick<MealDish, 'dish_kind' | 'portion' | 'basis'> = { dish_kind: 'rice', portion: 50, basis: 'measured' }
    assert.ok(trayReport([row(truth({ dishes: [{ dish_kind: 'rice', portion: 50 }] }), read({ dishes: [d] }))]).portions.measured)
  })
})
