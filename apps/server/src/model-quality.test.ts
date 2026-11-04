import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  READ_OUTCOMES,
  type ContainerKind,
  type ContainerReading,
  type DishKind,
  type DishValue,
  type EntryCategory,
  type KindRow,
  type Meal,
  type ModelQuality,
  type Portion,
  type ReadOutcome,
  type UrineColour,
} from '@meniscus/shared'
import type { MealModelOutput } from './ai/meal.ts'
import { outcomes } from './chart/model-accuracy.ts'
import { ANITA, LUNCH, RAVI, SUNITA, nov, setup } from './read-fixture.ts'

type Setup = Awaited<ReturnType<typeof setup>>

const URINAL = { container: 'urinal', fluid: 'urine', capacity_ml: 1000 } as const
const NONE: Partial<ContainerReading> = {
  container: 'none',
  volume_ml: null,
  capacity_ml: null,
  marks_visible: false,
  issues: ['no_container'],
}

/** Every outcome 0, except those given. */
const only = (over: Partial<Record<ReadOutcome, number>>) =>
  Object.fromEntries(READ_OUTCOMES.map((o) => [o, over[o] ?? 0])) as Record<ReadOutcome, number>

const row = (q: ModelQuality, kind: KindRow['kind'], mode: KindRow['mode'] = kind === 'photo' || kind === 'tray' ? 'sam+spark' : null) =>
  q.kinds.find((k) => k.kind === kind && k.mode === mode)!

async function summary(t: Setup, query = '?ward=2') {
  const before = t.requests()
  const r = await t.quality(query)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.equal(t.requests(), before)
  return r.body
}

/** A photo read of bed `id` saved as a urine entry of `ml` (default: the drafted volume), linked to the read. */
async function savedPhoto(t: Setup, id: number, draftMl: number, ml = draftMl) {
  const read = await t.photoRead(id, { ...URINAL, volume_ml: draftMl })
  const r = await t.entry(id, { volume_ml: ml, read_id: read })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  return r.body
}

describe('outcome of a saved draft', () => {
  it('[charting/model-accuracy] Outcome of a saved draft: Accepted', async () => {
    const t = await setup()
    const e = await savedPhoto(t, await t.bed('3A', '1'), 450)
    assert.equal((await t.approve(e.id)).status, 200)
    const k = row(await summary(t), 'photo')
    assert.deepEqual(k.outcomes, only({ accepted: 1 }))
    assert.deepEqual([k.volume.of, k.volume.within.n, k.volume.within.of], [1, 1, 1])
  })

  it('[charting/model-accuracy] Outcome of a saved draft: Edited at capture', async () => {
    const t = await setup()
    const e = await savedPhoto(t, await t.bed('3A', '1'), 300, 350)
    assert.equal((await t.approve(e.id)).status, 200)
    const k = row(await summary(t), 'photo')
    assert.deepEqual(k.outcomes, only({ edited_at_capture: 1 }))
    assert.deepEqual([k.volume.of, k.volume.within.n, k.volume.within.of], [1, 0, 1])
  })

  it('[charting/model-accuracy] Outcome of a saved draft: Corrected at approval, rejected and pending', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const corrected = await savedPhoto(t, bed1, 450)
    const rejected = await savedPhoto(t, bed1, 450)
    await savedPhoto(t, bed1, 450)
    assert.equal((await t.approve(corrected.id, { volume_ml: 400 })).status, 200)
    assert.equal((await t.send(`/api/entries/${rejected.id}/review`, { action: 'reject', reason: 'duplicate' }, ANITA)).status, 200)
    const k = row(await summary(t), 'photo')
    assert.deepEqual(k.outcomes, only({ corrected_by_nurse: 1, rejected: 1, pending: 1 }))
    assert.deepEqual([k.volume.of, k.volume.within.n, k.volume.within.of], [1, 0, 1])
  })

  it('[charting/model-accuracy] Outcome of a saved draft: Consistency only', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.textRead(bed1, [{ direction: 'in', category: 'water', volume_ml: 200 }])
    const e = await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, source: 'text', read_id: read })
    assert.equal(e.status, 201, JSON.stringify(e.body))
    assert.equal((await t.approve(e.body.id)).status, 200)
    const amend = await t.send(`/api/entries/${e.body.id}/amend`, { iddsi_level: 2, reason: 'thickened drink' }, ANITA)
    assert.equal(amend.status, 200, JSON.stringify(amend.body))
    assert.deepEqual(row(await summary(t), 'text').outcomes, only({ accepted: 1 }))
  })
})

describe('unsaved drafts', () => {
  it('[charting/model-accuracy] Unsaved drafts: Never saved', async () => {
    const t = await setup(nov(3, 8))
    await t.photoRead(await t.bed('3A', '1'), { ...URINAL, volume_ml: 450 })
    t.at(nov(3, 19, 59))
    assert.deepEqual(row(await summary(t), 'photo').outcomes, only({ open: 1 }))
    t.at(nov(3, 20))
    assert.deepEqual(row(await summary(t), 'photo').outcomes, only({ abandoned: 1 }))
  })

  it('[charting/model-accuracy] Unsaved drafts: One draft of two saved', async () => {
    const t = await setup(nov(3, 8))
    const bed1 = await t.bed('3A', '1')
    const read = await t.voiceRead(bed1, [
      { direction: 'in', category: 'water', volume_ml: 200 },
      { direction: 'out', category: 'urine', volume_ml: 300 },
    ])
    const tea = await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, source: 'voice', read_id: read, read_draft: 0 })
    assert.equal((await t.approve(tea.body.id)).status, 200)
    t.at(nov(3, 20))
    assert.deepEqual(row(await summary(t), 'voice').outcomes, only({ accepted: 1, abandoned: 1 }))
  })
})

describe('negative reads', () => {
  it('[charting/model-accuracy] Negative reads: No container, confirmed', async () => {
    const t = await setup()
    await t.photoRead(await t.bed('3A', '1'), { ...NONE, fluid: 'none' })
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ negative_confirmed: 1 }))
    assert.deepEqual(q.negatives.confirmed, { n: 1, of: 1, pct: null })
  })

  it('[charting/model-accuracy] Negative reads: No container, overridden', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { ...NONE, fluid: 'water' })
    const e = await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, read_id: read })
    assert.equal(e.status, 201, JSON.stringify(e.body))
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ negative_overridden: 1 }))
    assert.deepEqual([q.negatives.overridden.n, q.negatives.confirmed.n], [1, 0])
    assert.deepEqual(q.negatives.overridden_as, [{ to: 'water', n: 1 }])
  })

  it('[charting/model-accuracy] Negative reads: Unsaved negative draft', async () => {
    const t = await setup(nov(3, 8))
    await t.photoRead(await t.bed('3A', '1'), { ...NONE, fluid: 'water' })
    t.at(nov(3, 19, 59))
    assert.deepEqual(row(await summary(t), 'photo').outcomes, only({ open: 1 }))
    t.at(nov(3, 20))
    assert.deepEqual(row(await summary(t), 'photo').outcomes, only({ negative_confirmed: 1 }))
  })

  it('[charting/model-accuracy] Negative reads: Nothing drafted', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await t.photoRead(bed1, { container: 'other', fluid: 'other', volume_ml: 150, issues: [] })
    await t.textRead(bed1, [])
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ nothing_drafted: 1 }))
    assert.deepEqual(row(q, 'text').outcomes, only({ nothing_drafted: 1 }))
    assert.equal(q.negatives.nothing_drafted, 2)
    assert.deepEqual([q.negatives.confirmed.of, q.negatives.overridden.of], [0, 0])
  })
})

describe('model accuracy summary', () => {
  it('[charting/model-accuracy] Model accuracy summary: Window and errors', async () => {
    const t = await setup()
    for (const days of ['0', '31', 'x']) {
      const r = await t.quality(`?days=${days}`)
      assert.deepEqual([r.status, r.body.error], [400, 'invalid_request'], days)
    }
    const missing = await t.quality('?ward=999')
    assert.deepEqual([missing.status, missing.body.error], [404, 'not_found'])
    const q = await summary(t, '')
    assert.deepEqual([q.days, q.since, q.ward], [7, new Date(nov(3, 8) - 7 * 24 * 3_600_000).toISOString(), null])
  })

  it('[charting/model-accuracy] Model accuracy summary: No session', async () => {
    const t = await setup()
    const none = await t.request('/api/quality/model?ward=2', {}, { cookie: null })
    assert.equal(none.status, 401)
    assert.equal(((await none.json()) as { error: string }).error, 'sign_in_required')
    const r = await t.get<ModelQuality>('/api/quality/model?ward=2', ANITA)
    assert.equal(r.status, 200)
    assert.equal(r.body.ward?.code, '3A')
    assert.equal(t.requests(), 0)
  })

  it('[charting/model-accuracy] Model accuracy summary: Ward and hospital', async () => {
    const t = await setup()
    await savedPhoto(t, await t.bed('3A', '1'), 450)
    await savedPhoto(t, await t.bed('5B', '1'), 450)
    const drafts = (q: ModelQuality) => q.kinds.reduce((s, k) => s + k.drafts, 0)
    assert.equal(drafts(await summary(t, '?ward=2')), 1)
    assert.equal(drafts(await summary(t, '')), 2)
  })

  it('[charting/model-accuracy] Model accuracy summary: Kinds always listed', async () => {
    const t = await setup()
    await t.textRead(await t.bed('3A', '1'), [{ direction: 'in', category: 'water', volume_ml: 200 }])
    const q = await summary(t)
    assert.deepEqual(
      q.kinds.map((k) => [k.kind, k.mode, k.drafts]),
      [
        ['photo', 'sam+spark', 0],
        ['photo', 'spark', 0],
        ['text', null, 1],
        ['voice', null, 0],
        ['tray', 'sam+spark', 0],
        ['tray', 'spark', 0],
      ],
    )
    assert.deepEqual([q.containers, q.top_corrections], [[], []])
    assert.deepEqual([q.dish_portion.of, q.meal_portion.of, q.meal_fluid.volume.of], [0, 0, 0])
  })

  it('[charting/model-accuracy] Model accuracy summary: No names', async () => {
    const t = await setup()
    const [bed1, bed2] = [await t.bed('3A', '1'), await t.bed('3A', '2')]
    for (const [bed, staff] of [
      [bed1, RAVI],
      [bed2, ANITA],
    ] as const) {
      const read = await t.photoRead(bed, { ...URINAL, volume_ml: 450 }, staff)
      assert.equal((await t.entry(bed, { volume_ml: 450, read_id: read }, staff)).status, 201)
    }
    const paneer = await t.trayRead(bed1, {
      dishes: [{ region: 0, name: 'paneer tikka', dish_kind: 'curry_vegetables', eaten: 'half' }],
      eaten: 'half',
    })
    assert.equal((await t.mealFrom(bed1, paneer)).status, 201)
    const q = await summary(t)
    const keys = new Set<string>()
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k)
          walk(x)
        }
      }
    }
    walk(q)
    for (const k of ['bed', 'patient', 'mrn']) assert.ok(!keys.has(k), k)
    const text = JSON.stringify(q)
    const names = ['Ravi Kumar', 'Anita Thomas', (await t.store.admission(bed1))!.patient, (await t.store.admission(bed2))!.patient]
    for (const n of names) assert.ok(!text.includes(n), n)
    assert.ok(!text.includes('paneer'))
    assert.equal(row(q, 'photo').drafts, 2)
    assert.equal(row(q, 'tray').outcomes.accepted, 1)
  })

  it('[charting/model-accuracy] Model accuracy summary: Rates per outcome', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const plan: [Seeded, number][] = [
      ['accepted', 20],
      ['edited', 2],
      ['corrected', 3],
      ['rejected', 1],
    ]
    for (const [o, n] of plan) for (let i = 0; i < n; i++) await seedEntry(t, bed1, o, { kind: 'photo', mode: 'sam+spark' })
    const k = row(await summary(t), 'photo')
    assert.deepEqual(k.accepted, { n: 20, of: 26, pct: 76 })
    assert.deepEqual(k.edited_at_capture, { n: 2, of: 26, pct: 7 })
    assert.deepEqual(k.corrected_by_nurse, { n: 3, of: 26, pct: 11 })
    assert.deepEqual(k.corrected, { n: 5, of: 26, pct: 19 })
    assert.deepEqual(k.rejected, { n: 1, of: 26, pct: 3 })
  })
})

/**
 * Seeds `n` reads of `kind` (photo in `mode`) for bed `id` through the store, each drafting `draftMl` of water, saved by
 * Ravi Kumar at `saved(i)` mL and then approved by Anita Thomas, or rejected when `saved(i)` is null. No HTTP, no model.
 */
async function seed(
  t: Setup,
  id: number,
  n: number,
  o: { kind: 'photo' | 'text' | 'voice'; mode?: 'sam+spark' | 'spark'; draftMl?: number; saved?: (i: number) => number | null },
) {
  const { kind, mode = 'spark', draftMl = 200, saved = () => draftMl } = o
  const draft = { category: 'water' as const, volume_ml: draftMl, urine_colour: null, drink: null }
  for (let i = 0; i < n; i++) {
    const readId = await t.store.recordRead({
      kind,
      mode: kind === 'photo' ? mode : null,
      models: ['muse-spark-1.3'],
      hint: null,
      staff_id: RAVI,
      admission_id: id,
      confidence: kind === 'photo' ? 0.9 : null,
      issues: [],
      needs_review: false,
      drafts: 1,
      output:
        kind === 'photo'
          ? {
              kind,
              container: 'cup',
              fluid: 'water',
              volume_ml: draftMl,
              capacity_ml: 300,
              marks_visible: false,
              urine_colour: null,
              draft,
            }
          : { kind, drafts: [draft] },
    })
    const ml = saved(i)
    const e = (await t.store.addEntry(
      id,
      { direction: 'in', category: 'water', volume_ml: ml ?? draftMl, source: kind, read_id: readId },
      RAVI,
    ))!
    const r =
      ml === null
        ? await t.store.review(e.id, 'reject', { staffId: ANITA, reason: 'duplicate' })
        : await t.store.review(e.id, 'approve', { staffId: ANITA })
    assert.ok(r.ok)
  }
}

describe('outcome of a saved draft: the type table', () => {
  it('[charting/model-accuracy] Outcome of a saved draft: Nurse amend', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { container: 'cup', fluid: 'water', volume_ml: 250, capacity_ml: 300 })
    const e = await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 250, read_id: read })
    assert.equal((await t.approve(e.body.id)).status, 200)
    const amend = await t.send(`/api/entries/${e.body.id}/amend`, { category: 'food', reason: 'it was soup' }, ANITA)
    assert.equal(amend.status, 200, JSON.stringify(amend.body))
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ corrected_by_nurse: 1 }))
    assert.deepEqual(q.classes.type, [{ model: 'water', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'food', n: 1 }] }])
  })
})

describe('outcome of a saved level', () => {
  const BAG = { container: 'urine_bag', fluid: 'urine', capacity_ml: 2000 } as const

  it('[charting/model-accuracy] Outcome of a saved level: Bag reading', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const read = await t.photoRead(bed3, { ...BAG, volume_ml: 400 })
    const photo = await t.upload(bed3)
    const r = await t.bag(bed3, { volume_ml: 380, media_id: photo.id, evidence: t.evidence(), read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal((await t.approve(r.body.entry!.id, { volume_ml: 300 })).status, 200)
    const q = await summary(t)
    const k = row(q, 'photo')
    assert.deepEqual([k.outcomes.edited_at_capture, k.outcomes.corrected_by_nurse], [1, 0])
    assert.deepEqual([k.volume.of, k.volume.within.n, k.volume.within.of], [1, 1, 1])
    assert.deepEqual(
      q.classes.type.map((c) => [c.model, c.kept.n, c.kept.of]),
      [['urine', 1, 1]],
    )
  })

  it('[charting/model-accuracy] Outcome of a saved level: No entry, then a fall', async () => {
    const t = await setup(nov(3, 10, 2))
    const bed3 = await t.bed('3A', '3')
    assert.equal((await t.bag(bed3, { event: 'check', volume_ml: 300, source: 'manual' })).status, 201)
    t.at(nov(3, 10, 13))
    const read = await t.photoRead(bed3, { ...BAG, volume_ml: 300 })
    const photo = await t.upload(bed3)
    const r = await t.bag(bed3, { event: 'check', volume_ml: 300, media_id: photo.id, evidence: t.evidence(), read_id: read })
    assert.deepEqual([r.status, r.body.entry], [201, null])
    t.at(nov(3, 11))
    assert.equal((await t.bag(bed3, { event: 'check', volume_ml: 150, source: 'manual' })).status, 201)
    const k = row(await summary(t), 'photo')
    assert.deepEqual(k.outcomes, only({ accepted: 1 }))
    assert.deepEqual([k.volume.of, k.volume.within.n, k.volume.within.of], [1, 1, 1])
  })

  it('[charting/model-accuracy] Outcome of a saved level: Drain bag', async () => {
    const t = await setup()
    const bed3 = await t.bed('3A', '3')
    const read = await t.photoRead(bed3, { container: 'drain_bag', fluid: 'urine', volume_ml: 200, capacity_ml: 1000 })
    const photo = await t.upload(bed3)
    const r = await t.bag(bed3, { container: 'drain_bag', volume_ml: 200, media_id: photo.id, evidence: t.evidence(), read_id: read })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ accepted: 1 }))
    assert.deepEqual(q.classes.type, [{ model: 'urine', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'drain', n: 1 }] }])
  })

  it('[charting/model-accuracy] Outcome of a saved level: Jug level', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const jug = { container: 'water_jug', fluid: 'water', capacity_ml: 1500 } as const
    const first = await t.photoRead(bed1, { ...jug, volume_ml: 600 })
    assert.equal((await t.level(bed1, { volume_ml: 600, read_id: first })).status, 201)
    const second = await t.photoRead(bed1, { ...jug, volume_ml: 500 })
    assert.equal((await t.level(bed1, { volume_ml: 550, read_id: second })).status, 201)
    const q = await summary(t)
    assert.deepEqual(row(q, 'photo').outcomes, only({ accepted: 1, edited_at_capture: 1 }))
    assert.deepEqual(
      q.classes.type.map((c) => [c.model, c.kept.n, c.kept.of]),
      [['water', 2, 2]],
    )
    assert.deepEqual(q.classes.urine_colour, [])
  })
})

describe('field scoring', () => {
  it('[charting/model-accuracy] Field scoring: Volume error math', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    for (const ml of [400, 410, 425, 426, 500]) {
      const e = await savedPhoto(t, bed1, ml, 400)
      assert.equal((await t.approve(e.id)).status, 200)
    }
    const q = await summary(t)
    for (const v of [q.volume, row(q, 'photo').volume]) {
      assert.deepEqual(v, { of: 5, mae_ml: 32, within: { n: 3, of: 5, pct: 60 }, no_volume: 0 })
    }
  })

  it('[charting/model-accuracy] Field scoring: Against the final value', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    for (let i = 0; i < 5; i++) {
      const e = await savedPhoto(t, bed1, 400)
      assert.equal((await t.approve(e.id)).status, 200)
      assert.equal((await t.send(`/api/entries/${e.id}/amend`, { volume_ml: 300, reason: 'misread' }, ANITA)).status, 200)
    }
    const q = await summary(t)
    assert.deepEqual([q.volume.mae_ml, q.volume.within], [100, { n: 0, of: 5, pct: 0 }])
  })

  it('[charting/model-accuracy] Field scoring: No volume read', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const read = await t.photoRead(bed1, { ...URINAL, volume_ml: null })
    const e = await t.entry(bed1, { volume_ml: 200, read_id: read })
    assert.equal((await t.approve(e.body.id)).status, 200)
    const q = await summary(t)
    assert.deepEqual([q.volume.no_volume, q.volume.of], [1, 0])
    assert.deepEqual([row(q, 'photo').volume.no_volume, row(q, 'photo').volume.of], [1, 0])
  })

  it('[charting/model-accuracy] Field scoring: Urine colour', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const ids: number[] = []
    for (const colour of ['dark', 'yellow'] as const) {
      const read = await t.photoRead(bed1, { ...URINAL, volume_ml: 300, urine_colour: colour })
      const e = await t.entry(bed1, { volume_ml: 300, urine_colour: colour, read_id: read })
      assert.equal((await t.approve(e.body.id)).status, 200)
      ids.push(e.body.id)
    }
    assert.equal((await t.send(`/api/entries/${ids[1]}/amend`, { urine_colour: 'red', reason: 'blood seen' }, ANITA)).status, 200)
    const q = await summary(t)
    assert.deepEqual(q.classes.urine_colour, [
      { model: 'dark', n: 1, kept: { n: 1, of: 1, pct: null }, corrections: [] },
      { model: 'yellow', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'red', n: 1 }] },
    ])
  })
})

describe('small numbers withheld', () => {
  it('[charting/model-accuracy] Small numbers withheld: Four and five', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await seed(t, bed1, 4, { kind: 'text' })
    await seed(t, bed1, 5, { kind: 'voice' })
    const q = await summary(t)
    assert.deepEqual(row(q, 'text').accepted, { n: 4, of: 4, pct: null })
    assert.deepEqual(row(q, 'voice').accepted, { n: 5, of: 5, pct: 100 })
  })

  it('[charting/model-accuracy] Small numbers withheld: Rounded down', async () => {
    const t = await setup()
    await seed(t, await t.bed('3A', '1'), 200, { kind: 'photo', mode: 'spark', saved: (i) => (i === 0 ? null : 200) })
    assert.deepEqual(row(await summary(t), 'photo', 'spark').accepted, { n: 199, of: 200, pct: 99 })
  })

  it('[charting/model-accuracy] Small numbers withheld: Two kinds', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const text = [400, 410, 425, 450, 500, 600, 700]
    await seed(t, bed1, text.length, { kind: 'text', draftMl: 400, saved: (i) => text[i]! })
    await seed(t, bed1, 4, { kind: 'voice' })
    const q = await summary(t)
    const [tx, vo] = [row(q, 'text').volume, row(q, 'voice').volume]
    assert.deepEqual(tx.within, { n: 3, of: 7, pct: 42 })
    assert.equal(typeof tx.mae_ml, 'number')
    assert.deepEqual([vo.of, vo.mae_ml, vo.within.pct], [4, null, null])
  })
})

// ---------- trays (accuracy-views) ----------

type Seeded = 'accepted' | 'edited' | 'corrected' | 'rejected' | 'pending' | 'unsaved'

/**
 * One read of `kind` for bed `id` through the store, drafting 200 mL water (or `draft`), ending as `outcome`: saved and
 * approved (accepted), saved at +50 mL (edited), approved at +50 mL (corrected), rejected, left pending, or never saved.
 */
async function seedEntry(
  t: Setup,
  id: number,
  outcome: Seeded,
  o: {
    kind?: 'photo' | 'text' | 'voice'
    mode?: 'sam+spark' | 'spark'
    container?: ContainerKind
    draft?: { category: EntryCategory; volume_ml: number; urine_colour: UrineColour | null }
    saved?: { category?: EntryCategory; urine_colour?: UrineColour | null }
    negative?: boolean
  } = {},
) {
  const { kind = 'text', mode = 'sam+spark', container = 'cup' } = o
  const draft = { drink: null, ...(o.draft ?? { category: 'water' as const, volume_ml: 200, urine_colour: null }) }
  const readId = await t.store.recordRead({
    kind,
    mode: kind === 'photo' ? mode : null,
    models: ['muse-spark-1.3'],
    hint: null,
    staff_id: RAVI,
    admission_id: id,
    confidence: kind === 'photo' ? 0.9 : null,
    issues: o.negative ? ['no_container'] : [],
    needs_review: false,
    drafts: 1,
    output:
      kind === 'photo'
        ? { kind, container, fluid: 'water', volume_ml: draft.volume_ml, capacity_ml: 300, marks_visible: false, urine_colour: null, draft }
        : { kind, drafts: [draft] },
  })
  if (outcome === 'unsaved') return readId
  const category = o.saved?.category ?? draft.category
  const out = ['urine', 'stoma', 'drain', 'vomit'].includes(category)
  const e = (await t.store.addEntry(
    id,
    {
      direction: out ? 'out' : 'in',
      category,
      volume_ml: draft.volume_ml + (outcome === 'edited' ? 50 : 0),
      source: kind,
      read_id: readId,
      ...(category === 'urine' ? { urine_colour: o.saved?.urine_colour ?? draft.urine_colour } : {}),
    },
    RAVI,
  ))!
  if (outcome === 'rejected') assert.ok((await t.store.review(e.id, 'reject', { staffId: ANITA, reason: 'duplicate' })).ok)
  else if (outcome === 'corrected')
    assert.ok((await t.store.review(e.id, 'approve', { staffId: ANITA, volumeMl: draft.volume_ml + 50 })).ok)
  else if (outcome !== 'pending') assert.ok((await t.store.review(e.id, 'approve', { staffId: ANITA })).ok)
  return readId
}

type Dish = { dish_kind: DishKind; portion: Portion }
const dishes = (...ds: Dish[]): DishValue[] => ds.map((d, i) => ({ index: i + 1, name: d.dish_kind, ...d }))

/**
 * One tray read for bed `id` through the store, drafting `draft` (default: portion 50 and no fluid), and its photo meal
 * saved with `saved` (default: the draft) linked to it, its fluid entry approved unless `fluid` says otherwise. No HTTP.
 */
async function seedMeal(
  t: Setup,
  id: number,
  draft: { portion?: Portion; fluid_ml?: number | null; dishes: Dish[] },
  saved: { portion?: Portion; fluid_ml?: number | null; dishes?: Dish[] } = {},
  o: { fluid?: 'approve' | 'reject' | 'pending' | number; mode?: 'sam+spark' | 'spark'; issues?: 'not_a_meal'[] } = {},
): Promise<Meal> {
  const d = { portion: draft.portion ?? 50, fluid_ml: draft.fluid_ml ?? null, dishes: draft.dishes }
  const readId = await t.store.recordRead({
    kind: 'tray',
    mode: o.mode ?? 'sam+spark',
    models: ['sam-3.1', 'muse-spark-1.3'],
    hint: null,
    staff_id: RAVI,
    admission_id: id,
    confidence: 0.9,
    issues: o.issues ?? [],
    needs_review: false,
    drafts: 1,
    output: {
      kind: 'tray',
      served: false,
      portion: d.portion,
      dishes: d.dishes.map((x, i) => ({ index: i + 1, ...x, basis: 'model' })),
      fluids: d.fluid_ml === null ? [] : [{ index: 0, fluid_kind: 'soup', volume_ml: d.fluid_ml }],
      draft: d,
    },
  })
  const fluid = saved.fluid_ml === undefined ? d.fluid_ml : saved.fluid_ml
  const meal = (await t.store.addMeal(
    id,
    {
      meal: 'lunch',
      portion: saved.portion ?? d.portion,
      fluid_ml: fluid,
      source: 'photo',
      dishes: dishes(...(saved.dishes ?? d.dishes)),
      read_id: readId,
    },
    RAVI,
  ))!
  if (meal.entry_id !== null) {
    const f = o.fluid ?? 'approve'
    if (f === 'reject') assert.ok((await t.store.review(meal.entry_id, 'reject', { staffId: ANITA, reason: 'duplicate' })).ok)
    else if (typeof f === 'number') assert.ok((await t.store.review(meal.entry_id, 'approve', { staffId: ANITA, volumeMl: f })).ok)
    else if (f === 'approve') assert.ok((await t.store.review(meal.entry_id, 'approve', { staffId: ANITA })).ok)
  }
  return meal
}

const R = (dish_kind: DishKind, portion: Portion = 50): Dish => ({ dish_kind, portion })
const RICE_HALF: Partial<MealModelOutput> = { dishes: [{ region: 0, name: 'rice', dish_kind: 'rice', eaten: 'half' }], eaten: 'half' }
const dishRow = (q: ModelQuality, model: string) => q.classes.dish_kind.find((r) => r.model === model)
/** One read's outcome through the store's rows, as of `now`. */
const outcomeOf = async (t: Setup, readId: number, now: number) =>
  outcomes(await t.store.readOutcomeRows(0), now)
    .filter((i) => i.read_id === readId)
    .map((i) => i.outcome)

describe('outcome of a saved meal', () => {
  /** A 3A bed 1 lunch read as LUNCH (portion 50, rice 50, dal 100, 150 mL) and saved with `over`; 0 requests for the save. */
  async function lunch(t: Setup, over: Parameters<Setup['mealFrom']>[2] = {}, out: Partial<MealModelOutput> = LUNCH) {
    const bed1 = await t.bed('3A', '1')
    const read = await t.trayRead(bed1, out)
    const before = t.requests()
    const r = await t.mealFrom(bed1, read, over)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(t.requests(), before)
    return r.body
  }
  const approveMeal = async (t: Setup, m: Meal, body: Record<string, unknown> = {}) =>
    assert.equal((await t.approve(m.entry_id!, body)).status, 200)

  it('[charting/model-accuracy] Outcome of a saved meal: Accepted lunch', async () => {
    const t = await setup()
    const m = await lunch(t)
    await approveMeal(t, m)
    const before = t.requests()
    assert.deepEqual(row(await summary(t), 'tray').outcomes, only({ accepted: 1 }))
    assert.equal(t.requests(), before)
    assert.equal(t.requests(), 3)
  })

  it('[charting/model-accuracy] Outcome of a saved meal: No fluid', async () => {
    const t = await setup()
    const m = await lunch(
      t,
      { meal: 'dinner' },
      { dishes: [{ region: 0, name: 'roti', dish_kind: 'bread', eaten: 'three_quarters' }], eaten: 'three_quarters' },
    )
    assert.equal(m.entry_id, null)
    assert.deepEqual(row(await summary(t), 'tray').outcomes, only({ accepted: 1 }))
  })

  it('[charting/model-accuracy] Outcome of a saved meal: Edited at capture', async () => {
    const t = await setup()
    const read = await t.trayRead(await t.bed('3A', '1'), LUNCH)
    const [rice, dal] = read.draft.dishes
    const r = await t.mealFrom(await t.bed('3A', '1'), read, { dishes: [{ ...rice!, portion: 75 }, dal!] })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    await approveMeal(t, r.body)
    assert.deepEqual(row(await summary(t), 'tray').outcomes, only({ edited_at_capture: 1 }))
  })

  it('[charting/model-accuracy] Outcome of a saved meal: Amended by a nurse', async () => {
    const t = await setup()
    const m = await lunch(t)
    await approveMeal(t, m)
    const a = await t.send(`/api/meals/${m.id}/amend`, { portion: 25, reason: 'tray returned fuller' }, ANITA)
    assert.equal(a.status, 200, JSON.stringify(a.body))
    assert.deepEqual(row(await summary(t), 'tray').outcomes, only({ corrected_by_nurse: 1 }))
    assert.equal(t.requests(), 3)
  })

  it('[charting/model-accuracy] Outcome of a saved meal: Renamed only', async () => {
    const t = await setup()
    const m = await lunch(t)
    await approveMeal(t, m)
    const [rice, dal] = m.dishes
    const a = await t.send(
      `/api/meals/${m.id}/amend`,
      { dishes: [{ ...rice!, name: 'jeera rice' }, dal!], reason: 'named the rice' },
      ANITA,
    )
    assert.equal(a.status, 200, JSON.stringify(a.body))
    assert.equal((a.body as Meal).items, 'jeera rice, dal')
    const k = row(await summary(t), 'tray')
    assert.deepEqual([k.outcomes.accepted, k.outcomes.corrected_by_nurse], [1, 0])
  })

  it('[charting/model-accuracy] Outcome of a saved meal: Fluid entry rejected', async () => {
    const t = await setup()
    const m = await lunch(t)
    assert.equal((await t.send(`/api/entries/${m.entry_id}/review`, { action: 'reject', reason: 'duplicate' }, ANITA)).status, 200)
    const q = await summary(t)
    const k = row(q, 'tray')
    assert.deepEqual([k.outcomes.corrected_by_nurse, k.outcomes.rejected], [1, 0])
    assert.equal(q.meal_fluid.removed, 1)
  })

  it('[charting/model-accuracy] Outcome of a saved meal: Voided and pending', async () => {
    const t = await setup()
    const voided = await lunch(t)
    await lunch(t)
    assert.equal((await t.send(`/api/meals/${voided.id}/void`, { reason: 'wrong bed' }, ANITA)).status, 200)
    assert.deepEqual(row(await summary(t), 'tray').outcomes, only({ rejected: 1, pending: 1 }))
    assert.equal(t.requests(), 6)
  })
})

describe('retaken tray reads', () => {
  it('[charting/model-accuracy] Retaken tray reads: Lunch read twice', async () => {
    const t = await setup(nov(3, 12))
    const bed1 = await t.bed('3A', '1')
    const first = await t.trayRead(bed1, RICE_HALF, { meal: 'lunch' })
    assert.equal(t.requests(), 3)
    t.at(nov(3, 12, 4))
    const second = await t.trayRead(bed1, RICE_HALF, { meal: 'lunch' })
    assert.equal(t.requests(), 6)
    assert.equal((await t.mealFrom(bed1, second)).status, 201)
    t.at(nov(3, 12, 5))
    assert.deepEqual(await outcomeOf(t, first.read_id, nov(3, 12, 5)), ['retaken'])
    await summary(t)
    t.at(nov(4, 0, 5))
    assert.deepEqual(await outcomeOf(t, first.read_id, nov(4, 0, 5)), ['retaken'])
    const k = row(await summary(t), 'tray')
    assert.deepEqual([k.outcomes.abandoned, k.outcomes.retaken], [0, 1])
    assert.equal(t.requests(), 6)
  })

  it('[charting/model-accuracy] Retaken tray reads: Not a retake', async () => {
    const cases: [string, number, number, number][] = [
      ['Sunita Devi, 12:04', SUNITA, 1, 4],
      ['Ravi Kumar, 12:11', RAVI, 1, 11],
      ['Ravi Kumar on bed 2, 12:04', RAVI, 2, 4],
      ['Ravi Kumar, stored later but stamped 11:58', RAVI, 1, -2],
    ]
    for (const [label, staff, bed, minute] of cases) {
      const t = await setup(nov(3, 12))
      const first = await t.trayRead(await t.bed('3A', '1'), RICE_HALF)
      t.at(nov(3, 12, minute))
      await t.trayRead(await t.bed('3A', String(bed)), RICE_HALF, { staff })
      assert.deepEqual(await outcomeOf(t, first.read_id, nov(3, 12, 15)), ['open'], label)
      assert.deepEqual(await outcomeOf(t, first.read_id, nov(4, 0, 5)), ['abandoned'], label)
      assert.equal(t.requests(), 6, label)
    }
  })

  it('[charting/model-accuracy] Retaken tray reads: No bed', async () => {
    const t = await setup(nov(3, 12))
    const a = await t.trayRead(null, RICE_HALF)
    t.at(nov(3, 12, 3))
    const b = await t.trayRead(null, RICE_HALF)
    t.at(nov(3, 12, 5))
    assert.deepEqual(
      [...(await outcomeOf(t, a.read_id, nov(3, 12, 5))), ...(await outcomeOf(t, b.read_id, nov(3, 12, 5)))],
      ['open', 'open'],
    )
    const q = await summary(t, '')
    assert.deepEqual([row(q, 'tray').outcomes.retaken, row(q, 'tray', 'spark').outcomes.retaken], [0, 0])
  })

  it('[charting/model-accuracy] Retaken tray reads: Negative draft retaken', async () => {
    const t = await setup(nov(3, 12))
    const bed2 = await t.bed('3A', '2')
    const first = await t.trayRead(bed2, { ...RICE_HALF, issues: ['not_a_meal'] })
    t.at(nov(3, 12, 3))
    const second = await t.trayRead(bed2, RICE_HALF)
    assert.equal((await t.mealFrom(bed2, second)).status, 201)
    t.at(nov(4, 0, 5))
    assert.deepEqual(await outcomeOf(t, first.read_id, nov(4, 0, 5)), ['retaken'])
    const q = await summary(t)
    assert.deepEqual([q.negatives.confirmed.of, q.negatives.overridden.of], [0, 0])
  })
})

describe('negative tray reads', () => {
  it('[charting/model-accuracy] Negative reads: Not a meal, confirmed', async () => {
    const t = await setup()
    await t.trayRead(await t.bed('3A', '1'), { issues: ['not_a_meal'], confidence: 0.3 }, { mode: 'spark' })
    assert.equal(t.requests(), 1)
    const q = await summary(t)
    assert.deepEqual(row(q, 'tray', 'spark').outcomes, only({ negative_confirmed: 1 }))
    assert.deepEqual(q.negatives.confirmed, { n: 1, of: 1, pct: null })
  })

  it('[charting/model-accuracy] Negative reads: Not a meal, charted anyway', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const charted = await t.trayRead(bed1, { ...RICE_HALF, issues: ['not_a_meal'] })
    assert.equal((await t.mealFrom(bed1, charted)).status, 201)
    const voided = await t.trayRead(bed1, { ...RICE_HALF, issues: ['not_a_meal'] })
    const m = await t.mealFrom(bed1, voided)
    assert.equal((await t.send(`/api/meals/${m.body.id}/void`, { reason: 'not a meal' }, ANITA)).status, 200)
    const q = await summary(t)
    assert.deepEqual(row(q, 'tray').outcomes, only({ negative_overridden: 1, negative_confirmed: 1 }))
    assert.deepEqual(q.negatives.overridden_as, [{ to: 'meal', n: 1 }])
  })

  it('[charting/model-accuracy] Negative reads: Tray with nothing drafted', async () => {
    const t = await setup()
    await t.trayRead(await t.bed('3A', '1'), { issues: ['tray_empty_unclear'] })
    const k = row(await summary(t), 'tray')
    assert.deepEqual([k.outcomes.nothing_drafted, k.outcomes.negative_confirmed], [1, 0])
  })
})

describe('dish scoring and portions', () => {
  it('[charting/model-accuracy] Dish scoring: Kind changed', async () => {
    const t = await setup()
    await seedMeal(
      t,
      await t.bed('3A', '1'),
      { dishes: [R('rice'), R('dal_lentils', 100)] },
      { dishes: [R('bread'), R('dal_lentils', 100)] },
    )
    const q = await summary(t)
    assert.deepEqual(dishRow(q, 'dal_lentils'), { model: 'dal_lentils', n: 1, kept: { n: 1, of: 1, pct: null }, corrections: [] })
    assert.deepEqual(dishRow(q, 'rice'), { model: 'rice', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'bread', n: 1 }] })
  })

  it('[charting/model-accuracy] Dish scoring: Removed and added', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await seedMeal(t, bed1, { dishes: [R('rice'), R('dal_lentils'), R('fruit')] }, { dishes: [R('rice'), R('dal_lentils')] })
    await seedMeal(t, bed1, { dishes: [R('rice')] }, { dishes: [R('rice'), R('dairy')] })
    const q = await summary(t)
    assert.deepEqual(dishRow(q, 'fruit')?.kept, { n: 0, of: 1, pct: null })
    assert.deepEqual(dishRow(q, 'fruit')?.corrections, [{ to: 'none', n: 1 }])
    assert.deepEqual([dishRow(q, 'none')?.n, dishRow(q, 'none')?.corrections], [1, [{ to: 'dairy', n: 1 }]])
    assert.deepEqual(dishRow(q, 'rice')?.kept, { n: 2, of: 2, pct: null })
  })

  it('[charting/model-accuracy] Dish scoring: Same kind twice', async () => {
    const t = await setup()
    await seedMeal(t, await t.bed('3A', '1'), { dishes: [R('rice', 100), R('rice', 25)] }, { dishes: [R('rice', 25)] })
    const q = await summary(t)
    assert.deepEqual(dishRow(q, 'rice'), { model: 'rice', n: 2, kept: { n: 1, of: 2, pct: null }, corrections: [{ to: 'none', n: 1 }] })
    assert.deepEqual([q.dish_portion.of, q.dish_portion.quarters_off], [1, [0, 0, 0, 1, 0]])
  })

  it('[charting/model-accuracy] Portion agreement: Quarters', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    for (const [a, b] of [
      [50, 50],
      [50, 75],
      [100, 50],
      [0, 100],
      [25, 25],
    ] as [Portion, Portion][]) {
      await seedMeal(t, bed1, { dishes: [R('rice', a)] }, { dishes: [R('rice', b)] })
    }
    const q = await summary(t)
    assert.deepEqual(q.dish_portion, {
      of: 5,
      exact: { n: 2, of: 5, pct: 40 },
      within_quarter: { n: 3, of: 5, pct: 60 },
      quarters_off: [2, 1, 1, 0, 1],
    })
  })

  it('[charting/model-accuracy] Portion agreement: Meal portion after an amend', async () => {
    const t = await setup()
    const m = await seedMeal(t, await t.bed('3A', '1'), { portion: 50, dishes: [R('rice')] })
    const a = await t.send(`/api/meals/${m.id}/amend`, { portion: 25, reason: 'tray returned fuller' }, ANITA)
    assert.equal(a.status, 200, JSON.stringify(a.body))
    const q = await summary(t)
    assert.deepEqual(q.meal_portion, {
      of: 1,
      exact: { n: 0, of: 1, pct: null },
      within_quarter: { n: 1, of: 1, pct: null },
      quarters_off: [0, 1, 0, 0, 0],
    })
  })
})

describe('meal fluid, containers, top corrections and positives', () => {
  it('[charting/model-accuracy] Fluid with a meal: Soup kept and re-volumed', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await seedMeal(t, bed1, { fluid_ml: 150, dishes: [R('rice')] })
    await seedMeal(t, bed1, { fluid_ml: 150, dishes: [R('rice')] }, {}, { fluid: 120 })
    const q = await summary(t)
    assert.deepEqual([q.meal_fluid.volume.of, q.meal_fluid.volume.within.n, q.meal_fluid.volume.within.of], [2, 1, 2])
    assert.deepEqual([row(q, 'tray').outcomes.accepted, row(q, 'tray').outcomes.corrected_by_nurse], [1, 1])
    assert.deepEqual(row(q, 'tray').volume, q.meal_fluid.volume)
    assert.equal(q.volume.of, 0)
  })

  it('[charting/model-accuracy] Fluid with a meal: Added and removed', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await seedMeal(t, bed1, { fluid_ml: null, dishes: [R('rice')] }, { fluid_ml: 200 })
    await seedMeal(t, bed1, { fluid_ml: 150, dishes: [R('rice')] }, {}, { fluid: 'reject' })
    const q = await summary(t)
    assert.deepEqual([q.meal_fluid.volume.of, q.meal_fluid.volume.no_volume, q.meal_fluid.removed], [0, 1, 1])
  })

  it('[charting/model-accuracy] Outcomes per container: Two containers', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    for (let i = 0; i < 5; i++) await seedEntry(t, bed1, 'accepted', { kind: 'photo', container: 'urinal' })
    await seedEntry(t, bed1, 'corrected', { kind: 'photo', container: 'urinal' })
    for (let i = 0; i < 2; i++) await seedEntry(t, bed1, 'accepted', { kind: 'photo', mode: 'spark', container: 'water_jug' })
    const q = await summary(t)
    assert.deepEqual(
      q.containers.map((c) => c.container),
      ['urinal', 'water_jug'],
    )
    const [urinal, jug] = q.containers
    assert.deepEqual(
      [urinal!.reads, urinal!.decided, urinal!.accepted, urinal!.corrected],
      [6, 6, { n: 5, of: 6, pct: 83 }, { n: 1, of: 6, pct: 16 }],
    )
    assert.deepEqual([jug!.reads, jug!.accepted], [2, { n: 2, of: 2, pct: null }])
  })

  it('[charting/model-accuracy] Outcomes per container: No container read', async () => {
    const t = await setup()
    await t.photoRead(await t.bed('3A', '1'), { ...NONE, fluid: 'none' })
    const q = await summary(t)
    assert.deepEqual(
      q.containers.map((c) => [c.container, c.reads, c.decided]),
      [['none', 1, 0]],
    )
  })

  it('[charting/model-accuracy] Top corrections: Six changes', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    const water = { category: 'water' as const, volume_ml: 200, urine_colour: null, drink: null }
    const urine = (c: UrineColour) => ({ category: 'urine' as const, volume_ml: 300, urine_colour: c })
    for (let i = 0; i < 3; i++) await seedEntry(t, bed1, 'accepted', { draft: water, saved: { category: 'food' } })
    for (let i = 0; i < 2; i++) await seedEntry(t, bed1, 'accepted', { draft: urine('dark'), saved: { urine_colour: 'red' } })
    for (let i = 0; i < 2; i++) await seedMeal(t, bed1, { dishes: [R('rice')] }, { dishes: [R('bread')] })
    await seedEntry(t, bed1, 'accepted', { draft: { ...urine('yellow'), urine_colour: null }, saved: { category: 'stoma' } })
    await seedEntry(t, bed1, 'accepted', { draft: urine('yellow'), saved: { urine_colour: 'dark' } })
    await seedMeal(t, bed1, { dishes: [R('rice'), R('fruit')] }, { dishes: [R('rice')] })
    const q = await summary(t)
    assert.deepEqual(
      q.top_corrections.map((c) => [c.table, c.from, c.to, c.n]),
      [
        ['type', 'water', 'food', 3],
        ['urine_colour', 'dark', 'red', 2],
        ['dish_kind', 'rice', 'bread', 2],
        ['type', 'urine', 'stoma', 1],
        ['urine_colour', 'yellow', 'dark', 1],
      ],
    )
  })

  it('[charting/model-accuracy] Positive drafts not kept: Kept and not kept', async () => {
    const t = await setup(nov(3, 8))
    const bed1 = await t.bed('3A', '1')
    await seedEntry(t, bed1, 'unsaved')
    t.at(nov(3, 20, 30))
    const plan: [Seeded, number][] = [
      ['accepted', 38],
      ['edited', 4],
      ['corrected', 2],
      ['rejected', 3],
      ['pending', 2],
    ]
    for (const [o, n] of plan) for (let i = 0; i < n; i++) await seedEntry(t, bed1, o)
    // Two tray reads retaken by a second read, each saved unchanged with no fluid: 2 retaken, 2 more accepted.
    for (let i = 0; i < 2; i++) {
      const first = await t.trayRead(bed1, RICE_HALF)
      const second = await t.trayRead(bed1, RICE_HALF)
      assert.equal((await t.mealFrom(bed1, second)).status, 201)
      void first
    }
    const q = await summary(t)
    assert.deepEqual(q.positives, {
      kept: { n: 46, of: 50, pct: 92 },
      not_kept: { n: 4, of: 50, pct: 8 },
      rejected: 3,
      abandoned: 1,
      retaken: 2,
    })
  })

  it('[charting/model-accuracy] Positive drafts not kept: Negatives left out', async () => {
    const t = await setup()
    const bed1 = await t.bed('3A', '1')
    await t.photoRead(bed1, { ...NONE, fluid: 'none' })
    const read = await t.photoRead(bed1, { ...NONE, fluid: 'water' })
    assert.equal((await t.entry(bed1, { direction: 'in', category: 'water', volume_ml: 200, read_id: read })).status, 201)
    const q = await summary(t)
    assert.deepEqual(
      [q.positives.kept, q.positives.not_kept],
      [
        { n: 0, of: 0, pct: null },
        { n: 0, of: 0, pct: null },
      ],
    )
  })
})
