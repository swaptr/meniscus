import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PhotoEvidence } from '@meniscus/shared'
import { ANITA, at, entry, event, GRACE, RAVI, SUNITA } from './audit-fixtures.ts'
import { renderLine, timeline } from './timeline.ts'

const read = (over: Partial<PhotoEvidence> = {}): PhotoEvidence => ({
  kind: 'photo',
  mode: 'sam+spark',
  reading: {
    container: 'urine_bag',
    fluid: 'urine',
    volume_ml: 450,
    capacity_ml: 2000,
    marks_visible: true,
    reading_basis: 'between 400 and 500',
    appearance: 'pale yellow, clear',
    confidence: 0.9,
    issues: [],
  },
  segmentation: {
    container: { left: 100, top: 80, right: 400, bottom: 900 },
    fluid: { left: 110, top: 700, right: 390, bottom: 890 },
    fill_fraction: 0.25,
  },
  review_reasons: [],
  trace: [
    { step: 'sam:container', model: 'sam-3.1', ms: 2100 },
    { step: 'sam:liquid', model: 'sam-3.1', ms: 2200 },
    { step: 'spark:read', model: 'muse-spark-1.3', ms: 4500 },
  ],
  colour: '#d9b44a',
  ...over,
})
const lines = (...args: Parameters<typeof timeline>) => timeline(...args).map(renderLine)

describe('entry timeline', () => {
  it('[web/ward] Entry timeline: Corrected photo entry', () => {
    const e = entry({
      direction: 'out',
      category: 'urine',
      source: 'photo',
      volume_ml: 400,
      recorded_ml: 430,
      approved_ml: 400,
      status: 'approved',
      created_at: at(10, 42),
      recorded_at: at(10, 42),
      reviewed_at: at(10, 52),
      created_by: RAVI,
      reviewed_by: ANITA,
      evidence: read(),
    })
    const events = [
      event({ kind: 'recorded', at: at(10, 42), by: RAVI, to_ml: 430 }),
      event({ kind: 'corrected', at: at(10, 52), by: ANITA, from_ml: 430, to_ml: 400 }),
    ]
    assert.deepEqual(lines(e, events), [
      '10:42 · Photo by Ravi Kumar (attendant)',
      'SAM 3.1 outlined the urine bag',
      'SAM 3.1 found the liquid, 25% full',
      'Muse Spark read 450 mL of 2000 mL',
      'SAM and Spark agree',
      "Saved 430 mL, changed from the AI's 450 mL",
      '10:52 · Corrected 430 → 400 mL by Anita Thomas (nurse)',
    ])
  })

  it('[web/ward] Entry timeline: Pending voice note', () => {
    const trace = [
      { step: 'asr', model: 'muse-voice-transcribe-1.0', ms: 900 },
      { step: 'spark:note', model: 'muse-spark-1.3', ms: 2100 },
    ]
    const e = entry({
      source: 'voice',
      created_at: at(9, 5),
      recorded_at: at(9, 5),
      created_by: SUNITA,
      evidence: { kind: 'voice', transcript: 'bed 4 had coconut water 200 mL', draft_ml: 200, trace },
    })
    assert.deepEqual(lines(e, [event({ kind: 'recorded', at: at(9, 5), by: SUNITA, to_ml: 200 })]), [
      '09:05 · Voice note by Sunita Devi (attendant)',
      'Speech-to-text heard: “bed 4 had coconut water 200 mL”',
      'Muse Spark drafted 200 mL',
      'Saved 200 mL',
      'Waiting for approval',
    ])
  })

  it('[web/ward] Entry timeline: Jug level', () => {
    const jug = read({
      mode: 'spark',
      reading: { ...read().reading, container: 'water_jug', fluid: 'water', volume_ml: 600, capacity_ml: 1500 },
      segmentation: null,
      trace: [{ step: 'spark:read', model: 'muse-spark-1.3', ms: 4100 }],
    })
    const e = entry({
      source: 'photo',
      volume_ml: 400,
      recorded_ml: 400,
      approved_ml: 400,
      status: 'approved',
      created_at: at(13, 10),
      recorded_at: at(13, 10),
      reviewed_at: at(13, 20),
      reviewed_by: GRACE,
      evidence: jug,
    })
    const events = [
      event({ kind: 'recorded', at: at(13, 10), to_ml: 400 }),
      event({ kind: 'approved', at: at(13, 20), by: GRACE, to_ml: 400 }),
    ]
    assert.deepEqual(lines(e, events), [
      '13:10 · Photo by staff not recorded',
      'Muse Spark read the water jug level 600 mL',
      'Saved 400 mL, the drop since the last level',
      '13:20 · Approved by Grace Lee (nurse)',
    ])
  })

  it('[web/ward] Entry timeline: Late entry, amended', () => {
    const e = entry({
      volume_ml: 250,
      recorded_ml: 200,
      approved_ml: 200,
      status: 'approved',
      created_at: at(8),
      recorded_at: at(14, 10),
      late: true,
      created_by: ANITA,
      reviewed_by: ANITA,
      amended_at: at(15),
    })
    const events = [
      event({ kind: 'recorded', at: at(14, 10), by: ANITA, to_ml: 200 }),
      event({ kind: 'approved', at: at(14, 10), by: ANITA, to_ml: 200 }),
      event({
        kind: 'amended',
        at: at(15),
        by: GRACE,
        from_ml: 200,
        to_ml: 250,
        from_category: 'water',
        to_category: 'water',
        reason: 'jug re-measured',
      }),
    ]
    assert.deepEqual(lines(e, events), [
      '14:10 · Entered by hand by Anita Thomas (nurse), charted for 08:00 (6 h late)',
      'Saved 200 mL',
      '14:10 · Approved by Anita Thomas (nurse)',
      '15:00 · Amended 200 → 250 mL by Grace Lee (nurse): jug re-measured',
    ])
  })

  it('a colour-only amendment names the colour change', () => {
    const e = entry({ direction: 'out', category: 'urine', status: 'approved', urine_colour: 'red', amended_at: at(15) })
    const amended = event({
      kind: 'amended',
      at: at(15),
      by: GRACE,
      from_ml: 200,
      to_ml: 200,
      from_category: 'urine',
      to_category: 'urine',
      from_colour: 'yellow',
      to_colour: 'red',
      reason: 'rechecked the bag',
    })
    assert.equal(lines(e, [amended]).at(-1), '15:00 · Amended colour yellow → red by Grace Lee (nurse): rechecked the bag')
  })

  it("[web/ward] Correct a drink's consistency: Timeline", () => {
    const e = entry({ status: 'approved', volume_ml: 400, recorded_ml: 400, approved_ml: 400, iddsi_level: 2, amended_at: at(15) })
    const amended = (from: 0 | null) =>
      event({
        kind: 'amended',
        at: at(15),
        by: ANITA,
        from_ml: 400,
        to_ml: 400,
        from_category: 'water',
        to_category: 'water',
        from_iddsi: from,
        to_iddsi: 2,
        reason: 'checked the cup',
      })
    assert.equal(lines(e, [amended(null)]).at(-1), '15:00 · Amended consistency none → IDDSI 2 by Anita Thomas (nurse): checked the cup')
    assert.equal(lines(e, [amended(0)]).at(-1), '15:00 · Amended consistency IDDSI 0 → IDDSI 2 by Anita Thomas (nurse): checked the cup')
  })

  it('[web/ward] Entry timeline: Rejected duplicate', () => {
    const e = entry({
      source: 'photo',
      status: 'rejected',
      created_at: at(11),
      recorded_at: at(11),
      created_by: RAVI,
      reject_reason: 'duplicate',
    })
    const events = [
      event({ kind: 'recorded', at: at(11), by: RAVI, to_ml: 200 }),
      event({ kind: 'rejected', at: at(11, 5), by: ANITA, reason: 'duplicate', note: 'same bag twice' }),
    ]
    const out = lines(e, events)
    assert.equal(out.at(-1), '11:05 · Rejected by Anita Thomas (nurse): Duplicate (same bag twice)')
    assert.equal(out[0], '11:00 · Photo by Ravi Kumar (attendant)')
    assert.ok(out.includes('Saved 200 mL'))
  })

  it('[web/ward] Entry timeline: Rejected without a reason', () => {
    const e = entry({ status: 'rejected', created_at: at(11), recorded_at: at(11) })
    const events = [event({ kind: 'recorded', at: at(11), to_ml: 200 }), event({ kind: 'rejected', at: at(11, 5) })]
    assert.equal(lines(e, events).at(-1), '11:05 · Rejected by staff not recorded')
  })
})
