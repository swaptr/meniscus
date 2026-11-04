import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pairDishes, portionAgreement, rate, summariseVolume, tallyClasses, topCorrections, volumeError } from './scoring.ts'

describe('scoring (pure)', () => {
  it('rate is floored, and withheld below MIN_N', () => {
    assert.deepEqual(rate(4, 4), { n: 4, of: 4, pct: null })
    assert.deepEqual(rate(5, 5), { n: 5, of: 5, pct: 100 })
    assert.deepEqual(rate(3, 7), { n: 3, of: 7, pct: 42 })
    assert.deepEqual(rate(199, 200), { n: 199, of: 200, pct: 99 })
    assert.deepEqual(rate(0, 0), { n: 0, of: 0, pct: null })
    assert.deepEqual(rate(1, 2, 1), { n: 1, of: 2, pct: 50 })
  })

  it('volumeError is inclusive at the tolerance, and null with a null side', () => {
    assert.deepEqual(volumeError(425, 400), { abs_ml: 25, within: true })
    assert.deepEqual(volumeError(374, 400), { abs_ml: 26, within: false })
    assert.deepEqual(volumeError(426, 400, 25), { abs_ml: 26, within: false })
    assert.equal(volumeError(null, 400), null)
    assert.equal(volumeError(400, null), null)
  })

  it('summariseVolume: rounded mean, withheld below MIN_N, no_volume apart', () => {
    const five = [400, 410, 425, 426, 500].map((model) => ({ model, final: 400 }))
    assert.deepEqual(summariseVolume(five), { of: 5, mae_ml: 32, within: { n: 3, of: 5, pct: 60 }, no_volume: 0 })
    assert.deepEqual(summariseVolume(five.slice(0, 4)), { of: 4, mae_ml: null, within: { n: 3, of: 4, pct: null }, no_volume: 0 })
    assert.deepEqual(summariseVolume([{ model: null, final: 200 }, { model: 300, final: null }, ...five]), {
      of: 5,
      mae_ml: 32,
      within: { n: 3, of: 5, pct: 60 },
      no_volume: 1,
    })
  })

  it('tallyClasses by model: decided n, kept over settled, corrections most first then by name', () => {
    const rows = [
      { model: 'water', final: 'water', settled: true },
      { model: 'water', final: 'food', settled: true },
      { model: 'water', final: 'iv', settled: true },
      { model: 'water', final: 'iv', settled: true },
      { model: 'water', final: null, settled: false },
      { model: 'urine', final: 'urine', settled: true },
      { model: 'urine', final: 'stoma', settled: true },
      { model: 'vomit', final: 'vomit', settled: true },
      { model: 'drain', final: 'drain', settled: true },
    ]
    assert.deepEqual(tallyClasses(rows, 'model'), [
      {
        model: 'water',
        n: 5,
        kept: { n: 1, of: 4, pct: null },
        corrections: [
          { to: 'iv', n: 2 },
          { to: 'food', n: 1 },
        ],
      },
      { model: 'urine', n: 2, kept: { n: 1, of: 2, pct: null }, corrections: [{ to: 'stoma', n: 1 }] },
      { model: 'drain', n: 1, kept: { n: 1, of: 1, pct: null }, corrections: [] },
      { model: 'vomit', n: 1, kept: { n: 1, of: 1, pct: null }, corrections: [] },
    ])
  })

  it('tallyClasses by final: one row per true class, with what the model read instead', () => {
    const rows = [
      { model: 'urine_bag', final: 'urine_bag', settled: true },
      { model: 'urinal', final: 'urine_bag', settled: true },
      { model: 'cup', final: 'water_jug', settled: true },
      { model: 'cup', final: null, settled: true },
    ]
    assert.deepEqual(tallyClasses(rows, 'final'), [
      { model: 'urine_bag', n: 2, kept: { n: 1, of: 2, pct: null }, corrections: [{ to: 'urinal', n: 1 }] },
      { model: 'water_jug', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'cup', n: 1 }] },
    ])
  })

  const d = (dish_kind: string, portion: number | null = 50) => ({ dish_kind, portion }) as Parameters<typeof pairDishes>[0][number]
  const kinds = (ps: ReturnType<typeof pairDishes>) => ps.map((p) => [p.model?.dish_kind ?? null, p.final?.dish_kind ?? null])

  it('pairDishes: same kind first, then the rest in order, left-overs paired with none', () => {
    assert.deepEqual(kinds(pairDishes([d('rice'), d('dal_lentils')], [d('bread'), d('dal_lentils')])), [
      ['dal_lentils', 'dal_lentils'],
      ['rice', 'bread'],
    ])
    assert.deepEqual(kinds(pairDishes([d('rice'), d('dal_lentils'), d('fruit')], [d('rice'), d('dal_lentils')])), [
      ['rice', 'rice'],
      ['dal_lentils', 'dal_lentils'],
      ['fruit', null],
    ])
    assert.deepEqual(kinds(pairDishes([d('rice')], [d('rice'), d('dairy')])), [
      ['rice', 'rice'],
      [null, 'dairy'],
    ])
    assert.deepEqual(kinds(pairDishes([], [])), [])
  })

  it('pairDishes: the same kind twice takes the first unpaired final dish', () => {
    const pairs = pairDishes([d('rice', 100), d('rice', 25)], [d('rice', 25)])
    assert.deepEqual(
      pairs.map((p) => [p.model?.portion ?? null, p.final?.portion ?? null]),
      [
        [100, 25],
        [25, null],
      ],
    )
  })

  it('portionAgreement: quarters apart, unknown portions left out, floored at MIN_N', () => {
    const pairs = (xs: [number | null, number | null][]) =>
      xs.map(([model, final]) => ({ model, final })) as Parameters<typeof portionAgreement>[0]
    assert.deepEqual(
      portionAgreement(
        pairs([
          [50, 50],
          [50, 75],
          [100, 50],
          [0, 100],
          [25, 25],
          [null, 50],
          [50, null],
        ]),
      ),
      { of: 5, exact: { n: 2, of: 5, pct: 40 }, within_quarter: { n: 3, of: 5, pct: 60 }, quarters_off: [2, 1, 1, 0, 1] },
    )
    assert.deepEqual(portionAgreement(pairs([[50, 25]])), {
      of: 1,
      exact: { n: 0, of: 1, pct: null },
      within_quarter: { n: 1, of: 1, pct: null },
      quarters_off: [0, 1, 0, 0, 0],
    })
    assert.deepEqual(portionAgreement([]), { of: 0, exact: rate(0, 0), within_quarter: rate(0, 0), quarters_off: [0, 0, 0, 0, 0] })
  })

  it('topCorrections: n descending, then table order, then from, then to; at most k', () => {
    const row = (model: string, corrections: { to: string; n: number }[]) => ({ model, n: 9, kept: rate(0, 0), corrections })
    const classes = {
      type: [row('water', [{ to: 'food', n: 3 }]), row('urine', [{ to: 'stoma', n: 1 }])],
      urine_colour: [row('yellow', [{ to: 'dark', n: 1 }]), row('dark', [{ to: 'red', n: 2 }])],
      dish_kind: [row('rice', [{ to: 'bread', n: 2 }]), row('fruit', [{ to: 'none', n: 1 }])],
    }
    assert.deepEqual(
      topCorrections(classes).map((c) => [c.table, c.from, c.to, c.n]),
      [
        ['type', 'water', 'food', 3],
        ['urine_colour', 'dark', 'red', 2],
        ['dish_kind', 'rice', 'bread', 2],
        ['type', 'urine', 'stoma', 1],
        ['urine_colour', 'yellow', 'dark', 1],
      ],
    )
    // Ties within one table: by from, then to.
    const tie = {
      type: [
        row('water', [
          { to: 'iv', n: 1 },
          { to: 'food', n: 1 },
        ]),
        row('drain', [{ to: 'urine', n: 1 }]),
      ],
      urine_colour: [],
      dish_kind: [],
    }
    assert.deepEqual(
      topCorrections(tie, 2).map((c) => [c.from, c.to]),
      [
        ['drain', 'urine'],
        ['water', 'food'],
      ],
    )
    assert.deepEqual(topCorrections({ type: [], urine_colour: [], dish_kind: [] }), [])
  })
})
