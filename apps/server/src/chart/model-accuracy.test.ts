import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { READ_ABANDON_HOURS, READ_RETAKE_MINUTES, type DrinkKind } from '@meniscus/shared'
import type { StoredRead } from '../ai/read-log.ts'
import {
  linkProblem,
  modelQuality,
  outcomes,
  type LinkContext,
  type DishFacts,
  type OutcomeLink,
  type OutcomeMeal,
  type OutcomeRead,
} from './model-accuracy.ts'

const HOUR = 3_600_000
const T0 = new Date(2026, 10, 3, 8).getTime()

const photoRead = (over: Partial<StoredRead> = {}): StoredRead => ({
  id: 41,
  kind: 'photo',
  mode: 'sam+spark',
  models: ['sam-3.1', 'muse-spark-1.3'],
  hint: null,
  staff_id: 1,
  admission_id: 7,
  created_at: T0,
  confidence: 0.9,
  issues: [],
  needs_review: false,
  drafts: 1,
  output: {
    kind: 'photo',
    container: 'urinal',
    fluid: 'urine',
    volume_ml: 450,
    capacity_ml: 1000,
    marks_visible: true,
    urine_colour: 'yellow',
    draft: { category: 'urine', volume_ml: 450, urine_colour: 'yellow', drink: null },
  },
  ...over,
})

const PHOTO_OUT = photoRead().output as Extract<StoredRead['output'], { kind: 'photo' }>

const ctx = (over: Partial<LinkContext> = {}): LinkContext => ({
  staffId: 1,
  admissionId: 7,
  record: 'entry',
  source: 'photo',
  draft: 0,
  now: T0 + HOUR,
  ...over,
})

const path = (p: ReturnType<typeof linkProblem>) => p?.path ?? null

describe('linkProblem', () => {
  it('accepts a photo read on a photo entry, level or bag reading', () => {
    for (const record of ['entry', 'level', 'bag'] as const) assert.equal(linkProblem(photoRead(), false, ctx({ record })), null)
  })

  it('pairs each kind with its records and sources', () => {
    const text = photoRead({ kind: 'text', mode: null, drafts: 2, output: { kind: 'text', drafts: [] } })
    const voice = { ...text, kind: 'voice' as const, output: { kind: 'voice' as const, drafts: [] } }
    assert.equal(linkProblem(text, false, ctx({ source: 'text' })), null)
    assert.equal(linkProblem(voice, false, ctx({ source: 'voice', draft: 1 })), null)
    assert.equal(path(linkProblem(text, false, ctx({ source: 'voice' }))), 'read_id')
    assert.equal(path(linkProblem(text, false, ctx({ record: 'level', source: 'photo' }))), 'read_id')
    assert.equal(path(linkProblem(photoRead(), false, ctx({ record: 'level', source: 'manual' }))), 'read_id')
    assert.equal(path(linkProblem(photoRead(), false, ctx({ record: 'bag', source: 'manual' }))), 'read_id')
    assert.equal(path(linkProblem(photoRead(), false, ctx({ source: 'manual' }))), 'read_id')
  })

  it('an unknown read wins over everything', () => {
    assert.deepEqual(linkProblem(undefined, true, ctx({ staffId: 2, source: 'voice', draft: 5 })), {
      path: 'read_id',
      message: 'no such read',
    })
  })

  it('a wrong staff member wins over age, a bedless read over a wrong kind', () => {
    const old = photoRead({ created_at: T0 - 13 * HOUR })
    assert.match(linkProblem(old, false, ctx({ staffId: 2 }))!.message, /another staff member/)
    const bedless = photoRead({ admission_id: null })
    assert.match(linkProblem(bedless, false, ctx({ source: 'voice' }))!.message, /names no bed/)
  })

  it('refuses at READ_ABANDON_HOURS, not a millisecond before', () => {
    const at = (ms: number) => linkProblem(photoRead(), false, ctx({ now: T0 + ms }))
    assert.equal(at(READ_ABANDON_HOURS * HOUR - 1), null)
    assert.equal(path(at(READ_ABANDON_HOURS * HOUR)), 'read_id')
  })

  it('a missing draft is at read_draft, before already linked', () => {
    assert.equal(path(linkProblem(photoRead(), true, ctx({ draft: 1 }))), 'read_draft')
    assert.deepEqual(linkProblem(photoRead(), true, ctx()), { path: 'read_id', message: 'already linked' })
  })
})

/** A stored read with its links, as `store.readOutcomeRows` gives it. */
const outcomeRead = (over: Partial<StoredRead> = {}, links: OutcomeLink[] = []): OutcomeRead => ({
  ...photoRead(over),
  ward_id: 2,
  links,
})
const entryLink = (over: Partial<NonNullable<OutcomeLink['entry']>> = {}, draft = 0): OutcomeLink => ({
  draft,
  entry: {
    status: 'approved',
    category: 'urine',
    volume_ml: 450,
    urine_colour: 'yellow',
    drink: null,
    recorded_ml: 450,
    approved_ml: 450,
    recorded_category: 'urine',
    amends: [],
    ...over,
  },
})
const levelLink = (volume_ml: number, container = 'water_jug', event: 'check' | 'emptied' | null = null): OutcomeLink => ({
  draft: 0,
  level: { volume_ml, container, event },
})
const NONE_DRAFT = {
  issues: ['no_container' as const],
  output: {
    kind: 'photo' as const,
    container: 'none' as const,
    fluid: 'water' as const,
    volume_ml: null,
    capacity_ml: null,
    marks_visible: false,
    urine_colour: null,
    draft: { category: 'water' as const, volume_ml: null, urine_colour: null, drink: null },
  },
}
const amend = (over: Partial<NonNullable<OutcomeLink['entry']>['amends'][number]>) => ({
  from_ml: 450,
  to_ml: 450,
  from_category: 'urine' as const,
  to_category: 'urine' as const,
  from_colour: null,
  to_colour: null,
  ...over,
})
const one = (r: OutcomeRead, now = T0 + HOUR) => outcomes([r], now).map((i) => i.outcome)
const LATE = T0 + READ_ABANDON_HOURS * HOUR

describe('outcomes, row by row (design.md §4)', () => {
  it('1: a negative read with no draft is negative_confirmed', () => {
    assert.deepEqual(one(outcomeRead({ ...NONE_DRAFT, drafts: 0, output: { ...NONE_DRAFT.output, draft: null } })), ['negative_confirmed'])
  })
  it('2: any other read with no draft is nothing_drafted', () => {
    assert.deepEqual(one(outcomeRead({ kind: 'text', mode: null, drafts: 0, output: { kind: 'text', drafts: [] } })), ['nothing_drafted'])
  })
  it('3: a young unlinked draft is open, negative or not', () => {
    assert.deepEqual(one(outcomeRead(), LATE - 1), ['open'])
    assert.deepEqual(one(outcomeRead(NONE_DRAFT), LATE - 1), ['open'])
  })
  it('4: an old unlinked negative draft is negative_confirmed', () => {
    assert.deepEqual(one(outcomeRead(NONE_DRAFT), LATE), ['negative_confirmed'])
  })
  it('5: an old unlinked draft is abandoned', () => {
    assert.deepEqual(one(outcomeRead(), LATE), ['abandoned'])
  })
  it('6: a negative draft whose entry was rejected is negative_confirmed; a level always stands', () => {
    assert.deepEqual(one(outcomeRead(NONE_DRAFT, [entryLink({ status: 'rejected', category: 'water' })])), ['negative_confirmed'])
    assert.deepEqual(one(outcomeRead(NONE_DRAFT, [levelLink(600)])), ['negative_overridden'])
  })
  it('7: a linked negative draft is negative_overridden, with what was saved', () => {
    const items = outcomes(
      [
        outcomeRead(NONE_DRAFT, [entryLink({ status: 'pending', category: 'food' })]),
        outcomeRead(NONE_DRAFT, [levelLink(600)]),
        outcomeRead(NONE_DRAFT, [levelLink(300, 'stoma_bag', 'check')]),
      ],
      T0 + HOUR,
    )
    assert.deepEqual(
      items.map((i) => [i.outcome, i.final?.category]),
      [
        ['negative_overridden', 'food'],
        ['negative_overridden', 'water'],
        ['negative_overridden', 'stoma'],
      ],
    )
  })
  it('8: a pending entry is pending, even edited', () => {
    assert.deepEqual(one(outcomeRead({}, [entryLink({ status: 'pending', approved_ml: null, recorded_ml: 300 })])), ['pending'])
  })
  it('9: a rejected entry is rejected, even edited', () => {
    assert.deepEqual(one(outcomeRead({}, [entryLink({ status: 'rejected', approved_ml: null, recorded_ml: 300 })])), ['rejected'])
  })
  it('10: approved at another volume, or amended in ml, type or colour, is corrected_by_nurse over an edit at capture', () => {
    assert.deepEqual(one(outcomeRead({}, [entryLink({ recorded_ml: 300, approved_ml: 400, volume_ml: 400 })])), ['corrected_by_nurse'])
    for (const a of [amend({ to_ml: 400 }), amend({ to_category: 'stoma' }), amend({ from_colour: 'yellow', to_colour: 'red' })]) {
      assert.deepEqual(one(outcomeRead({}, [entryLink({ amends: [a] })])), ['corrected_by_nurse'])
    }
  })
  it('10: a consistency-only amend is no correction', () => {
    assert.deepEqual(one(outcomeRead({}, [entryLink({ amends: [amend({})] })])), ['accepted'])
  })
  it('11: saved with another volume, type or colour is edited_at_capture', () => {
    for (const over of [
      { recorded_ml: 400, approved_ml: 400 },
      { recorded_category: 'stoma' as const },
      { urine_colour: 'dark' as const },
    ]) {
      assert.deepEqual(one(outcomeRead({}, [entryLink(over)])), ['edited_at_capture'], JSON.stringify(over))
    }
  })
  it("10: a colour amend after an as-drafted save is the nurse's", () => {
    // Saved as drafted (yellow), then amended to red: a nurse's correction, not an edit at capture.
    const a = amend({ from_colour: 'yellow', to_colour: 'red' })
    assert.deepEqual(one(outcomeRead({}, [entryLink({ urine_colour: 'red', amends: [a] })])), ['corrected_by_nurse'])
  })
  it('12: a level or bag reading saved at another volume is edited_at_capture', () => {
    const jug = { output: { ...PHOTO_OUT, draft: { category: 'water' as const, volume_ml: 500, urine_colour: null, drink: null } } }
    assert.deepEqual(one(outcomeRead(jug, [levelLink(550)])), ['edited_at_capture'])
    assert.deepEqual(one(outcomeRead({}, [levelLink(380, 'urine_bag', 'emptied')])), ['edited_at_capture'])
  })
  it('13: otherwise accepted', () => {
    assert.deepEqual(one(outcomeRead({}, [entryLink()])), ['accepted'])
    assert.deepEqual(one(outcomeRead({}, [levelLink(450, 'urine_bag', 'check')])), ['accepted'])
  })
})

// ---------- trays (accuracy-views) ----------

const RICE_DAL: DishFacts[] = [
  { dish_kind: 'rice', portion: 50 },
  { dish_kind: 'dal_lentils', portion: 100 },
]
const trayRead = (over: Partial<StoredRead> = {}, links: OutcomeLink[] = [], retaken = false): OutcomeRead => ({
  id: 61,
  kind: 'tray',
  mode: 'sam+spark',
  models: ['sam-3.1', 'muse-spark-1.3'],
  hint: null,
  staff_id: 1,
  admission_id: 7,
  created_at: T0,
  confidence: 0.82,
  issues: [],
  needs_review: false,
  drafts: 1,
  output: {
    kind: 'tray',
    served: false,
    portion: 50,
    dishes: RICE_DAL.map((d, i) => ({ index: i, ...d, basis: 'model' as const })),
    fluids: [{ index: 0, fluid_kind: 'soup', volume_ml: 150 }],
    draft: { portion: 50, fluid_ml: 150, dishes: RICE_DAL },
  },
  ward_id: 2,
  links,
  retaken,
  ...over,
})
const meal = (over: Partial<OutcomeMeal> = {}, entry: Partial<NonNullable<OutcomeMeal['entry']>> | null = {}): OutcomeLink => ({
  draft: 0,
  meal: {
    id: 9,
    voided: false,
    portion: 50,
    dishes: RICE_DAL,
    fluid_ml: 150,
    confirmed: { portion: 50, fluid_ml: 150, dishes: RICE_DAL },
    amends: [],
    entry: entry && { status: 'approved', volume_ml: 150, recorded_ml: 150, approved_ml: 150, amends: [], ...entry },
    ...over,
  },
})
const NOT_A_MEAL = { issues: ['not_a_meal' as const] }
const mealAmend = (
  before: { portion: 50 | 25 | 75; dishes: typeof RICE_DAL },
  after: { portion: 50 | 25 | 75; dishes: typeof RICE_DAL },
) => ({
  before,
  after,
})

describe('meal outcomes, row by row (design.md §3)', () => {
  it('M1: a voided meal of a negative read is negative_confirmed', () => {
    assert.deepEqual(one(trayRead(NOT_A_MEAL, [meal({ voided: true })])), ['negative_confirmed'])
  })
  it('M2: a standing meal of a negative read is negative_overridden, saved as meal', () => {
    const items = outcomes([trayRead(NOT_A_MEAL, [meal({}, { status: 'rejected' })])], T0 + HOUR)
    assert.deepEqual(
      items.map((i) => i.outcome),
      ['negative_overridden'],
    )
    const q = modelQuality([trayRead(NOT_A_MEAL, [meal()])], T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(q.negatives.overridden_as, [{ to: 'meal', n: 1 }])
  })
  it('M3: a voided meal is rejected, even with its entry pending or rejected', () => {
    assert.deepEqual(one(trayRead({}, [meal({ voided: true }, { status: 'rejected' })])), ['rejected'])
  })
  it('M4: a pending fluid entry is pending, even amended or edited', () => {
    const changed = mealAmend({ portion: 50, dishes: RICE_DAL }, { portion: 25, dishes: RICE_DAL })
    assert.deepEqual(one(trayRead({}, [meal({ amends: [changed] }, { status: 'pending', approved_ml: null })])), ['pending'])
  })
  it('M5: a nurse change to portion or dishes, a rejected entry, another approved volume or an ml amend is corrected_by_nurse', () => {
    const portion = mealAmend({ portion: 50, dishes: RICE_DAL }, { portion: 25, dishes: RICE_DAL })
    const dish = mealAmend(
      { portion: 50, dishes: RICE_DAL },
      { portion: 50, dishes: [RICE_DAL[0]!, { dish_kind: 'curry_vegetables', portion: 100 }] },
    )
    for (const link of [
      meal({ amends: [portion], portion: 25 }),
      meal({ amends: [dish] }),
      meal({}, { status: 'rejected' }),
      meal({}, { approved_ml: 120, volume_ml: 120 }),
      meal({}, { amends: [{ from_ml: 150, to_ml: 100 }], volume_ml: 100 }),
    ]) {
      assert.deepEqual(one(trayRead({}, [link])), ['corrected_by_nurse'], JSON.stringify(link))
    }
  })
  it('M5: an amend that reorders dishes or changes nothing scored is no correction', () => {
    const reordered = mealAmend({ portion: 50, dishes: RICE_DAL }, { portion: 50, dishes: [RICE_DAL[1]!, RICE_DAL[0]!] })
    assert.deepEqual(one(trayRead({}, [meal({ amends: [reordered] })])), ['accepted'])
  })
  it('M6: saved with another portion, fluid mL or dish multiset is edited_at_capture', () => {
    const at75 = [{ dish_kind: 'rice' as const, portion: 75 as const }, RICE_DAL[1]!]
    for (const confirmed of [
      { portion: 75 as const, fluid_ml: 150, dishes: RICE_DAL },
      { portion: 50 as const, fluid_ml: 200, dishes: RICE_DAL },
      { portion: 50 as const, fluid_ml: 150, dishes: at75 },
    ]) {
      assert.deepEqual(one(trayRead({}, [meal({ confirmed })])), ['edited_at_capture'], JSON.stringify(confirmed))
    }
  })
  it('M7: otherwise accepted; a meal with no fluid settles at once', () => {
    assert.deepEqual(one(trayRead({}, [meal()])), ['accepted'])
    const dry = {
      output: {
        ...trayRead().output,
        draft: { portion: 75 as const, fluid_ml: null, dishes: [{ dish_kind: 'bread' as const, portion: 75 as const }] },
      },
    } as Partial<StoredRead>
    assert.deepEqual(
      one(trayRead(dry, [meal({ portion: 75, fluid_ml: null, dishes: [{ dish_kind: 'bread', portion: 75 }], confirmed: null }, null)])),
      ['accepted'],
    )
  })
  it('saved values: proof.confirmed, else the first amend before-values, else the current values', () => {
    const at25 = mealAmend({ portion: 25, dishes: RICE_DAL }, { portion: 50, dishes: RICE_DAL })
    // No proof: the first amend's before (25) is what was saved, so the save was an edit (and the amend a nurse's change).
    assert.deepEqual(one(trayRead({}, [meal({ confirmed: null, amends: [at25] })])), ['corrected_by_nurse'])
    const items = outcomes([trayRead({}, [meal({ confirmed: null, amends: [at25] })])], T0 + HOUR)
    assert.equal(items[0]!.outcome, 'corrected_by_nurse')
    // No proof and no amend: the current values.
    assert.deepEqual(one(trayRead({}, [meal({ confirmed: null, portion: 75 })])), ['edited_at_capture'])
    assert.deepEqual(one(trayRead({}, [meal({ confirmed: null })])), ['accepted'])
    // The proof wins over the current values.
    assert.deepEqual(one(trayRead({}, [meal({ portion: 75 })])), ['accepted'])
  })
  it('the dish multiset is sorted (dish_kind, portion): order and names do not count', () => {
    assert.deepEqual(one(trayRead({}, [meal({ confirmed: { portion: 50, fluid_ml: 150, dishes: [RICE_DAL[1]!, RICE_DAL[0]!] } })])), [
      'accepted',
    ])
  })
})

describe('retaken tray reads, row R0', () => {
  it('R0 comes before open, abandoned and negative_confirmed, and lasts', () => {
    assert.deepEqual(one(trayRead({}, [], true), T0 + 60_000), ['retaken'])
    assert.deepEqual(one(trayRead({}, [], true), LATE + HOUR), ['retaken'])
    assert.deepEqual(one(trayRead(NOT_A_MEAL, [], true), LATE + HOUR), ['retaken'])
    assert.deepEqual(one(trayRead({}, [], false), LATE), ['abandoned'])
  })
  it('a linked read, or one with no draft, is never retaken', () => {
    assert.deepEqual(one(trayRead({}, [meal()], true)), ['accepted'])
    const none = {
      drafts: 0,
      issues: ['not_a_meal' as const],
      output: { ...trayRead().output, dishes: [], fluids: [], draft: null },
    } as Partial<StoredRead>
    assert.deepEqual(one(trayRead(none, [], true)), ['negative_confirmed'])
  })
  it('retaken counts in drafts and outcomes only', () => {
    const q = modelQuality([trayRead({}, [], true), trayRead({ id: 62 }, [meal()])], T0 + HOUR, { ward: null, days: 7 })
    const row = q.kinds.find((k) => k.kind === 'tray' && k.mode === 'sam+spark')!
    assert.deepEqual([row.drafts, row.outcomes.retaken, row.accepted, row.volume.of], [2, 1, { n: 1, of: 1, pct: null }, 1])
    assert.deepEqual(
      [q.positives.kept, q.positives.not_kept, q.positives.retaken],
      [{ n: 1, of: 1, pct: null }, { n: 0, of: 1, pct: null }, 1],
    )
    assert.deepEqual([q.negatives.confirmed.of, q.meal_fluid.volume.of, q.meal_portion.of], [0, 1, 1])
  })
  it('READ_RETAKE_MINUTES is 10', () => assert.equal(READ_RETAKE_MINUTES, 10))
})

describe('containers and positives (design.md §5)', () => {
  it('container rows: most reads first, then CONTAINER_KINDS order; negatives too', () => {
    const cup = (id: number) => outcomeRead({ id, output: { ...PHOTO_OUT, container: 'cup' } }, [entryLink()])
    const reads = [
      outcomeRead({ id: 1 }, [entryLink()]),
      cup(2),
      outcomeRead({ ...NONE_DRAFT, id: 3, drafts: 0, output: { ...NONE_DRAFT.output, draft: null } }),
      cup(4),
    ]
    const q = modelQuality(reads, T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(
      q.containers.map((c) => [c.container, c.reads, c.decided]),
      [
        ['cup', 2, 2],
        ['urinal', 1, 1],
        ['none', 1, 0],
      ],
    )
  })
  it('positives leave out negative reads, pending and open drafts', () => {
    const q = modelQuality(
      [
        outcomeRead({ id: 1 }, [entryLink()]),
        outcomeRead({ id: 2 }, [entryLink({ status: 'pending' })]),
        outcomeRead({ id: 3 }),
        outcomeRead({ ...NONE_DRAFT, id: 4 }, [entryLink({ category: 'water' })]),
        outcomeRead({ id: 5 }, [entryLink({ status: 'rejected' })]),
      ],
      T0 + HOUR,
      { ward: null, days: 7 },
    )
    assert.deepEqual(q.positives, {
      kept: { n: 1, of: 2, pct: null },
      not_kept: { n: 1, of: 2, pct: null },
      rejected: 1,
      abandoned: 0,
      retaken: 0,
    })
  })
})

describe('drink kind table', () => {
  const teaRead = (id: number, links: OutcomeLink[]) =>
    outcomeRead(
      {
        id,
        output: {
          ...PHOTO_OUT,
          container: 'cup',
          fluid: 'tea',
          urine_colour: null,
          draft: { category: 'water', volume_ml: 150, urine_colour: null, drink: 'tea' },
        },
      },
      links,
    )
  const drinkLink = (drink: DrinkKind | null) =>
    entryLink({
      category: 'water',
      recorded_category: 'water',
      urine_colour: null,
      volume_ml: 150,
      recorded_ml: 150,
      approved_ml: 150,
      drink,
    })

  it('[charting/model-accuracy] Drink kind table: Tea that was coffee', () => {
    const reads = [
      teaRead(1, [drinkLink('tea')]),
      teaRead(2, [drinkLink('tea')]),
      teaRead(3, [drinkLink('tea')]),
      teaRead(4, [
        entryLink({
          category: 'water',
          recorded_category: 'water',
          urine_colour: null,
          volume_ml: 150,
          recorded_ml: 150,
          approved_ml: 150,
          drink: 'coffee',
          amends: [{ from_ml: 150, to_ml: 150, from_category: 'water', to_category: 'water', from_colour: null, to_colour: null }],
        }),
      ]),
    ]
    const q = modelQuality(reads, T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(q.drink_kind, [{ model: 'tea', n: 4, kept: { n: 3, of: 4, pct: null }, corrections: [{ to: 'coffee', n: 1 }] }])
    assert.ok(q.top_corrections.every((c) => c.from !== 'tea'))
    // A change of kind alone leaves the draft's outcome unchanged: all four count as accepted.
    const photo = q.kinds.find((k) => k.kind === 'photo' && k.mode === 'sam+spark')!
    assert.equal(photo.outcomes.accepted, 4)
    assert.equal(photo.outcomes.corrected_by_nurse, 0)
  })

  it('[charting/model-accuracy] Drink kind table: A saved jug level is not counted', () => {
    const jug = outcomeRead(
      {
        id: 11,
        output: {
          ...PHOTO_OUT,
          container: 'water_jug',
          fluid: 'water',
          urine_colour: null,
          draft: { category: 'water', volume_ml: 500, urine_colour: null, drink: 'water' },
        },
      },
      [levelLink(500)],
    )
    const q = modelQuality([jug, teaRead(1, [drinkLink('tea')])], T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(q.drink_kind, [{ model: 'tea', n: 1, kept: { n: 1, of: 1, pct: null }, corrections: [] }])
  })

  it('[charting/model-accuracy] Drink kind table: Changed away from a drink', () => {
    const read = outcomeRead(
      {
        id: 5,
        kind: 'text',
        mode: null,
        confidence: null,
        output: { kind: 'text', drafts: [{ category: 'water', volume_ml: 200, urine_colour: null, drink: 'juice' }] },
      },
      [
        entryLink({
          category: 'iv',
          recorded_category: 'water',
          urine_colour: null,
          volume_ml: 200,
          recorded_ml: 200,
          approved_ml: 200,
          drink: null,
          amends: [{ from_ml: 200, to_ml: 200, from_category: 'water', to_category: 'iv', from_colour: null, to_colour: null }],
        }),
      ],
    )
    const q = modelQuality([read], T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(q.drink_kind, [{ model: 'juice', n: 1, kept: { n: 0, of: 1, pct: null }, corrections: [{ to: 'none', n: 1 }] }])
  })

  it('rows follow DRINK_KINDS order; drafts without a drink kind are left out; an empty window is []', () => {
    const coffee = outcomeRead(
      {
        id: 9,
        output: {
          ...PHOTO_OUT,
          container: 'cup',
          fluid: 'coffee',
          urine_colour: null,
          draft: { category: 'water', volume_ml: 150, urine_colour: null, drink: 'coffee' },
        },
      },
      [drinkLink('coffee')],
    )
    const reads = [coffee, coffee, teaRead(1, [drinkLink('tea')]), outcomeRead({ id: 10 }, [entryLink()])]
    const q = modelQuality(reads, T0 + HOUR, { ward: null, days: 7 })
    assert.deepEqual(
      q.drink_kind.map((r) => [r.model, r.n]),
      [
        ['tea', 1],
        ['coffee', 2],
      ],
    )
    assert.deepEqual(modelQuality([], T0, { ward: null, days: 7 }).drink_kind, [])
  })
})
