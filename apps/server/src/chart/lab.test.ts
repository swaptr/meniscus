import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ReadMode } from '@meniscus/shared'
import { upstream } from '../testing.ts'
import {
  decision,
  labReport,
  labSections,
  labSummary,
  parseLabels,
  parseSidecar,
  planRequests,
  samplesFrom,
  type LabLabel,
  type LabRead,
  type LabRow,
  type Sample,
} from './lab.ts'
import { volumeError } from './scoring.ts'

// Fields copied from the real-world dataset's manifest records (attend-realworld-dataset/manifest.jsonl, 2026-11-03).
const UBAG_001 = {
  id: 'ubag-001',
  record_type: 'original',
  category: 'urine_bag',
  container_type: 'urine_bag',
  fluid: 'urine',
  liquid_colour: 'yellow',
  expected_ml: 1700,
  ml_tolerance: 100,
  capacity_ml: 2500,
  expected_container: 'urine_bag',
  expected_fluid: 'urine',
  expected_outcome: 'positive',
  expected_issues: [],
  synthetic: false,
  eval_files: ['eval/graduated-1/urine_bag-1700-ubag-001.jpg', 'eval/classify-drinks-2/other-1700-ubag-001.jpg'],
}
const HARD_007 = {
  id: 'hard-007',
  record_type: 'original',
  category: 'hard_negative',
  container_type: 'other',
  fluid: 'other',
  liquid_colour: 'pale',
  expected_ml: null,
  ml_tolerance: null,
  capacity_ml: null,
  expected_container: 'other',
  expected_fluid: 'other',
  expected_outcome: 'negative',
  expected_issues: ['no_marks'],
  synthetic: false,
  eval_files: ['eval/negatives-1/other-0-hard-007.jpg'],
}
const jsonl = (...records: object[]) => records.map((r) => JSON.stringify(r)).join('\n')

/** A sidecar as image-synthesis writes it (its `SynthSidecar`: draft labels), with `over` applied. */
const sidecar = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id,
    synthetic: true,
    label_status: 'draft',
    verified_by: null,
    generator: 'image-model',
    plan_item: 'bags',
    kind: 'generate',
    image: `${id}.webp`,
    index: 1,
    prompt: 'a staged urine bag on a bed frame',
    revised_prompt: null,
    created: 1_762_300_000,
    output_format: 'webp',
    sha256: 'ab'.repeat(32),
    labels: {},
    ...over,
  })

const label = (over: Partial<LabLabel> = {}): LabLabel => ({
  id: 'x',
  container: null,
  fluid: null,
  urine_colour: null,
  expected_ml: null,
  ml_tolerance: null,
  outcome: null,
  synthetic: false,
  verified: false,
  ...over,
})
const read = (over: Partial<LabRead> = {}): LabRead => ({
  container: 'urine_bag',
  fluid: 'urine',
  volume_ml: 450,
  urine_colour: null,
  drafted: true,
  needs_review: false,
  issues: [],
  ...over,
})
const rowOf = (s: Sample, r: LabRead | null, mode: ReadMode = 'sam+spark'): LabRow => ({
  file: s.file,
  source: s.source,
  mode,
  label: s.label,
  read: r,
})
const NONE = new Map<string, LabLabel | null>()

describe('lab eval (pure; no model requests)', () => {
  it('[charting/model-accuracy] Lab eval scored like the ward: Same tolerance', () => {
    const u = upstream()
    const truth = label({ expected_ml: 450 })
    const rows: LabRow[] = [475, 476].map((v, i) => ({
      file: `cup-450-${i}.jpg`,
      source: 'real',
      mode: 'sam+spark',
      label: truth,
      read: read({ volume_ml: v }),
    }))
    const r = labReport(rows, { hinted: true })
    assert.equal(r.volume.of, 2)
    assert.deepEqual(r.volume.within, { n: 1, of: 2, pct: null })
    // The ward's own function and tolerance give the same answer.
    assert.deepEqual([volumeError(475, 450)?.within, volumeError(476, 450)?.within], [true, false])
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Lab eval scored like the ward: Hinted container', () => {
    const u = upstream()
    const ubag2 = { ...UBAG_001, id: 'ubag-002', expected_ml: 1100, liquid_colour: 'dark' }
    const labels = parseLabels(jsonl(UBAG_001, ubag2, HARD_007))
    const files = ['urine_bag-1700-ubag-001.jpg', 'urine_bag-1100-ubag-002.jpg', 'other-0-hard-007.jpg']
    const run = (hint: boolean) => {
      const { samples } = samplesFrom(files, labels, NONE, { hint })
      const rows = samples.map((s) => rowOf(s, read({ container: s.label.id === 'ubag-002' ? 'urinal' : s.label.container! })))
      return { samples, md: labSections(labSummary(rows, { hinted: hint, skippedSynthetic: 0 })) }
    }

    const hinted = run(true)
    assert.deepEqual(
      hinted.samples.map((s) => s.hint),
      ['urine_bag', 'urine_bag', 'other'],
    )
    assert.match(hinted.md, /Container hinted: not scored/)
    assert.doesNotMatch(hinted.md, /\| Expected container \|/)

    const unhinted = run(false)
    assert.deepEqual(
      unhinted.samples.map((s) => s.hint),
      [undefined, undefined, undefined],
    )
    assert.doesNotMatch(unhinted.md, /Container hinted/)
    assert.match(unhinted.md, /\| Expected container \| Photos \| Read right \| Read instead \|/)
    assert.match(unhinted.md, /\| urine_bag \| 2 \| — · 1\/2 \| urinal 1 \|/)
    assert.match(unhinted.md, /\| other \| 1 \| — · 1\/1 \| {2}\|/)
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Lab eval scored like the ward: Plan', () => {
    const u = upstream()
    const files = Array.from({ length: 30 }, (_, i) => `cup-${100 + i}-p${i}.jpg`)
    const { samples, skipped } = samplesFrom(files, null, NONE)
    assert.equal(samples.length, 30)
    assert.deepEqual(skipped, { synthetic: 0, unlabelled: 0 })
    assert.equal(planRequests(samples, ['sam+spark']), 90)
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Lab eval labels from the dataset: Labels', () => {
    const u = upstream()
    const labels = parseLabels(jsonl(UBAG_001, HARD_007))
    const { samples, skipped } = samplesFrom(['urine_bag-1700-ubag-001.jpg', 'hard-007.jpg'], labels, NONE)
    assert.deepEqual(skipped, { synthetic: 0, unlabelled: 0 })
    assert.deepEqual(samples, [
      {
        file: 'urine_bag-1700-ubag-001.jpg',
        source: 'real',
        hint: 'urine_bag',
        label: label({
          id: 'ubag-001',
          container: 'urine_bag',
          fluid: 'urine',
          urine_colour: 'yellow',
          expected_ml: 1700,
          ml_tolerance: 100,
          outcome: 'positive',
        }),
      },
      {
        file: 'hard-007.jpg',
        source: 'real',
        label: label({ id: 'hard-007', container: 'other', fluid: 'other', outcome: 'negative' }),
      },
    ])
    assert.equal(planRequests(samples, ['sam+spark']), 6)
    assert.equal(planRequests(samples, ['spark']), 2)
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Lab eval labels from the dataset: Positives and negatives', () => {
    const u = upstream()
    const pos = (i: number): Sample => ({ file: `p${i}.jpg`, source: 'real', label: label({ id: `p${i}`, outcome: 'positive' }) })
    const neg = (i: number): Sample => ({ file: `n${i}.jpg`, source: 'real', label: label({ id: `n${i}`, outcome: 'negative' }) })
    const rows = [
      rowOf(pos(1), read()),
      rowOf(pos(2), read()),
      rowOf(pos(3), read()),
      rowOf(pos(4), read({ needs_review: true })),
      rowOf(pos(5), read({ drafted: false })),
      rowOf(neg(1), read({ container: 'none', fluid: 'none', volume_ml: null, drafted: false, issues: ['no_container'] })),
      rowOf(neg(2), read({ needs_review: true })),
      rowOf(neg(3), read()),
    ]
    assert.deepEqual(
      rows.map((r) => decision(r.read!)),
      ['drafted', 'drafted', 'drafted', 'flagged', 'refused', 'refused', 'flagged', 'drafted'],
    )
    const report = labReport(rows, { hinted: true })
    assert.deepEqual(report.outcomes, [
      { outcome: 'positive', n: 5, drafted: 3, flagged: 1, refused: 1, right: { n: 4, of: 5, pct: 80 } },
      { outcome: 'negative', n: 3, drafted: 1, flagged: 1, refused: 1, right: { n: 2, of: 3, pct: null } },
    ])
    const md = labSections(labSummary(rows, { hinted: true, skippedSynthetic: 0 }))
    assert.match(md, /\| Expected \| Photos \| Drafted \| Flagged \| Refused \| Right call \|/)
    assert.ok(md.includes('| positive | 5 | 3 | 1 | 1 | 80% · 4/5 |'), md)
    assert.ok(md.includes('| negative | 3 | 1 | 1 | 1 | — · 2/3 |'), md)
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Synthetic photos in the lab eval: Sidecars', () => {
    const u = upstream()
    const files = ['synth-bag-a.webp', 'synth-bag-b.webp', 'synth-bag-c.webp', 'synth-bag-d.webp']
    const sidecars = new Map([
      [
        'synth-bag-a',
        parseSidecar(
          sidecar('synth-bag-a', {
            label_status: 'verified',
            verified_by: 'dev-1',
            labels: { expected_container: 'urine_bag', expected_fluid: 'urine', liquid_colour: 'dark', expected_ml: 1000 },
          }),
        ),
      ],
      ['synth-bag-b', parseSidecar(sidecar('synth-bag-b'))],
      ['synth-bag-c', parseSidecar(sidecar('synth-bag-c', { label_status: 'verified', verified_by: null }))],
    ])
    const { samples, skipped } = samplesFrom(files, null, sidecars)
    assert.deepEqual(skipped, { synthetic: 3, unlabelled: 0 })
    assert.deepEqual(samples, [
      {
        file: 'synth-bag-a.webp',
        source: 'synthetic',
        hint: 'urine_bag',
        label: label({
          id: 'synth-bag-a',
          container: 'urine_bag',
          fluid: 'urine',
          urine_colour: 'dark',
          expected_ml: 1000,
          synthetic: true,
          verified: true,
        }),
      },
    ])
    assert.equal(planRequests(samples, ['sam+spark']), 3)
    assert.match(
      labSections(labSummary([], { hinted: true, skippedSynthetic: skipped.synthetic })),
      /3 synthetic photos without verified labels, skipped/,
    )
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Synthetic photos in the lab eval: File name is not truth', () => {
    const u = upstream()
    const sidecars = new Map([
      [
        'urine_bag-450-x',
        parseSidecar(sidecar('urine_bag-450-x', { label_status: 'verified', verified_by: 'dev-1', labels: { expected_ml: 1000 } })),
      ],
      ['water_jug-600-y', parseSidecar(sidecar('water_jug-600-y'))],
    ])
    const { samples, skipped } = samplesFrom(['urine_bag-450-x.webp', 'water_jug-600-y.webp'], null, sidecars)
    assert.deepEqual(skipped, { synthetic: 1, unlabelled: 0 })
    assert.equal(samples.length, 1)
    assert.equal(samples[0]!.source, 'synthetic')
    assert.equal(samples[0]!.label.expected_ml, 1000)
    assert.ok(!samples.some((s) => s.source === 'real'))
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Synthetic photos in the lab eval: Synthetic photos apart', () => {
    const u = upstream()
    const synth = (id: string, over: Record<string, unknown>) => ({
      id,
      record_type: 'original',
      expected_container: 'urine_bag',
      expected_fluid: 'urine',
      liquid_colour: 'dark',
      expected_ml: 1000,
      ml_tolerance: 50,
      expected_outcome: 'positive',
      synthetic: true,
      ...over,
    })
    const labels = parseLabels(
      jsonl(
        UBAG_001,
        synth('synth-001', { label_status: 'verified', verified_by: 'dev-1' }),
        synth('synth-002', { label_status: 'draft' }),
        synth('synth-003', { label_status: 'verified' }),
      ),
    )
    const files = ['urine_bag-1700-ubag-001.jpg', 'synth-001.webp', 'synth-002.webp', 'synth-003.webp']
    const { samples, skipped } = samplesFrom(files, labels, NONE)
    assert.equal(samples.length, 2)
    assert.equal(skipped.synthetic, 2)
    assert.deepEqual(
      samples.map((s) => [s.file, s.source]),
      [
        ['urine_bag-1700-ubag-001.jpg', 'real'],
        ['synth-001.webp', 'synthetic'],
      ],
    )
    const rows = [rowOf(samples[0]!, read({ volume_ml: 1700 })), rowOf(samples[1]!, read({ volume_ml: 900 }))]
    const summary = labSummary(rows, { hinted: true, skippedSynthetic: skipped.synthetic })
    assert.equal(summary.real['sam+spark']!.n, 1)
    assert.equal(summary.synthetic['sam+spark']!.n, 1)
    assert.deepEqual(summary.real['sam+spark']!.volume.within, { n: 1, of: 1, pct: null })
    assert.deepEqual(summary.synthetic['sam+spark']!.volume.within, { n: 0, of: 1, pct: null })
    const md = labSections(summary)
    const real = md.indexOf('## Real photos')
    const synthetic = md.indexOf('## Synthetic photos (verified labels)')
    assert.ok(real >= 0 && synthetic > real, md)
    assert.match(md.slice(real, synthetic), /within ±25 mL — · 1\/1/)
    assert.match(md.slice(synthetic), /within ±25 mL — · 0\/1/)
    assert.match(md, /2 synthetic photos without verified labels, skipped/)
    assert.equal(u.requests.length, 0)
  })
})

describe('lab eval labels (uncited extras)', () => {
  it('parseLabels skips a malformed line and nulls values outside our vocabularies', () => {
    const bad: number[] = []
    const labels = parseLabels(
      [
        JSON.stringify({ ...UBAG_001, liquid_colour: 'clear' }),
        '{not json',
        JSON.stringify({ id: 'cup-9', expected_container: 'teapot', expected_fluid: 'water', liquid_colour: 'dark', expected_ml: 'x' }),
        '',
      ].join('\n'),
      (line) => bad.push(line),
    )
    assert.deepEqual(bad, [2])
    assert.equal(labels.get('ubag-001')!.urine_colour, null)
    assert.deepEqual(labels.get('cup-9'), label({ id: 'cup-9', fluid: 'water' }))
  })

  it('parseSidecar accepts tray keys and ignores them, and refuses invalid JSON', () => {
    const tray = parseSidecar(
      sidecar('synth-tray-1', {
        labels: { meal_portion_eaten: 50, truth: { dishes: [] }, pair_id: 'p1', pair_role: 'before', expected_outcome: 'positive' },
      }),
    )
    assert.deepEqual(tray, label({ id: 'synth-tray-1', outcome: 'positive', synthetic: true }))
    assert.equal(parseSidecar('{'), null)
  })

  it('a real file matched only by id has no hint; unmatched names fall back to the name rule; others are skipped', () => {
    const labels = parseLabels(jsonl(HARD_007))
    const { samples, skipped } = samplesFrom(['hard-007.jpg', 'water_jug-600.jpg', 'holiday.jpg'], labels, NONE)
    assert.deepEqual(
      samples.map((s) => [s.file, s.hint, s.label.expected_ml]),
      [
        ['hard-007.jpg', undefined, null],
        ['water_jug-600.jpg', 'water_jug', 600],
      ],
    )
    assert.deepEqual(skipped, { synthetic: 0, unlabelled: 1 })
  })
})

describe('drink kinds in the photo eval (pure; no model requests)', () => {
  it('[charting/model-accuracy] Drink kinds in the lab evals: Coffee labelled', () => {
    const u = upstream()
    const coffee = label({ container: 'cup', fluid: 'coffee', expected_ml: 150 })
    const rows: LabRow[] = ['coffee', 'tea'].map((fluid, i) => ({
      file: `cup-150-c${i}.jpg`,
      source: 'real',
      mode: 'sam+spark',
      label: coffee,
      read: read({ container: 'cup', fluid: fluid as LabRead['fluid'], volume_ml: 150 }),
    }))
    const r = labReport(rows, { hinted: true })
    const row = r.classes.fluid.find((c) => c.model === 'coffee')!
    assert.deepEqual([row.n, row.kept.n, row.kept.of, row.corrections], [2, 1, 2, [{ to: 'tea', n: 1 }]])
    assert.equal(parseLabels(jsonl({ ...UBAG_001, id: 'c-1', expected_fluid: 'coconut_water' })).get('c-1')!.fluid, 'coconut_water')
    assert.equal(parseLabels(jsonl({ ...UBAG_001, id: 'k-1', expected_fluid: 'kombucha' })).get('k-1')!.fluid, null)
    assert.equal(u.requests.length, 0)
  })

  it('[charting/model-accuracy] Drink kinds in the lab evals: Plan', () => {
    const u = upstream()
    const records = Array.from({ length: 10 }, (_, i) => ({
      ...UBAG_001,
      id: `cup-${i}`,
      container_type: 'cup',
      expected_container: 'cup',
      expected_fluid: i < 4 ? 'ors' : 'water',
      expected_ml: 200,
    }))
    const labels = parseLabels(jsonl(...records))
    assert.equal([...labels.values()].filter((l) => l.fluid === 'ors').length, 4)
    const { samples } = samplesFrom(
      records.map((r) => `cup-200-${r.id}.jpg`),
      labels,
      NONE,
    )
    assert.equal(samples.length, 10)
    assert.equal(planRequests(samples, ['sam+spark']), 30)
    assert.equal(u.requests.length, 0)
  })
})
