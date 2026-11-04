import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shiftStart, type Entry } from '@meniscus/shared'
import { byShift, logView } from './history.ts'

// Local-time constructors keep the test independent of the machine's time zone.
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString()
let id = 1
const entry = (created_at: string, direction: Entry['direction'], volume_ml: number, status: Entry['status']): Entry => ({
  labeled_media: null,
  id: id++,
  admission_id: 1,
  direction,
  category: direction === 'in' ? 'water' : 'urine',
  volume_ml,
  item: null,
  notes: null,
  source: 'photo',
  confidence: 0.9,
  status,
  created_at,
  reviewed_at: null,
  has_photo: false,
  recorded_ml: volume_ml,
  evidence: null,
  recorded_at: created_at,
  late: false,
  created_by: null,
  reviewed_by: null,
  approved_ml: null,
  amended_at: null,
  reject_reason: null,
  urine_colour: null,
  urine_rgb: null,
  media: null,
  levels: null,
  iddsi_level: null,
  drink: null,
})

describe('history by shift', () => {
  it('[web/ward] Intake and output log by shift: Two shifts', () => {
    const shifts = byShift([
      entry(at(2, 9), 'in', 200, 'approved'),
      entry(at(2, 19, 30), 'out', 300, 'approved'),
      entry(at(2, 21), 'in', 100, 'pending'),
    ])
    assert.deepEqual(
      shifts.map((s) => [s.name, s.in_ml, s.out_ml, s.pending, s.entries.length]),
      [
        ['night', 0, 0, 1, 1],
        ['day', 200, 300, 0, 2],
      ],
    )
    assert.equal(shifts[0]!.start, new Date(2026, 10, 2, 20).getTime())
    assert.equal(shifts[1]!.start, new Date(2026, 10, 2, 8).getTime())
  })

  it('[web/ward] Intake and output log by shift: early morning belongs to the previous night', () => {
    assert.deepEqual(shiftStart(new Date(2026, 10, 3, 6, 30).getTime()), {
      start: new Date(2026, 10, 2, 20).getTime(),
      end: new Date(2026, 10, 3, 8).getTime(),
      name: 'night',
    })
    assert.deepEqual(shiftStart(new Date(2026, 10, 3, 8).getTime()), {
      start: new Date(2026, 10, 3, 8).getTime(),
      end: new Date(2026, 10, 3, 20).getTime(),
      name: 'day',
    })
  })

  describe('filter and sort', () => {
    const NOW = new Date(2026, 10, 2, 22).getTime()
    const log = () => [
      { ...entry(at(2, 9), 'out', 300, 'approved') },
      { ...entry(at(2, 10), 'out', 400, 'pending') },
      { ...entry(at(2, 11), 'in', 200, 'approved'), item: 'coconut water' },
      { ...entry(at(2, 12), 'out', 50, 'rejected'), category: 'drain' as const },
      { ...entry(at(2, 13), 'in', 150, 'approved'), item: 'tea' },
    ]

    it('[web/ward] Filter and sort the log: Approved output only', () => {
      const all = log().slice(0, 4)
      const v = logView(all, { direction: 'out', status: 'approved' }, { key: 'time', desc: true }, NOW)
      assert.deepEqual(
        v.rows.map((e) => e.volume_ml),
        [300],
      )
      assert.equal(v.count, '1 of 4')
    })

    it('[web/ward] Filter and sort the log: Largest first', () => {
      const v = logView(log().slice(0, 4), {}, { key: 'volume', desc: true }, NOW)
      assert.deepEqual(
        v.rows.map((e) => e.volume_ml),
        [400, 300, 200, 50],
      )
      assert.equal(v.groups, null)
    })

    it('[web/ward] Filter and sort the log: Pending first', () => {
      const v = logView(log().slice(0, 4), {}, { key: 'status', desc: false }, NOW)
      assert.deepEqual(
        v.rows.map((e) => [e.status, e.volume_ml]),
        [
          ['pending', 400],
          ['approved', 200],
          ['approved', 300],
          ['rejected', 50],
        ],
      )
    })

    it('[web/ward] Filter and sort the log: Pages', () => {
      const many = Array.from({ length: 30 }, (_, i) => entry(new Date(NOW - (30 - i) * 60_000).toISOString(), 'in', 10 + i, 'approved'))
      const p1 = logView(many, {}, { key: 'time', desc: true }, NOW, 0)
      const p2 = logView(many, {}, { key: 'time', desc: true }, NOW, 1)
      assert.equal(p1.rows.length, 25)
      assert.equal(p1.rows[0]!.volume_ml, 39)
      assert.equal(p1.page.range, '1–25 of 30')
      assert.deepEqual(
        p2.rows.map((e) => e.volume_ml),
        [14, 13, 12, 11, 10],
      )
      assert.equal(p2.page.range, '26–30 of 30')
      assert.equal(logView(many, {}, { key: 'time', desc: true }, NOW, 9).page.index, 1)
    })

    it('[web/ward] Filter and sort the log: shift totals span pages', () => {
      const many = Array.from({ length: 30 }, (_, i) => entry(new Date(NOW - (30 - i) * 60_000).toISOString(), 'in', 10, 'approved'))
      const p2 = logView(many, {}, { key: 'time', desc: true }, NOW, 1)
      const groups = p2.groups ?? []
      assert.equal(groups.length, 1)
      assert.equal(groups[0]!.rows.length, 5)
      assert.equal(groups[0]!.shift.in_ml, 300)
    })

    it('[web/ward] Filter and sort the log: Search', () => {
      const v = logView(log(), { text: 'Coconut' }, { key: 'time', desc: true }, NOW)
      assert.deepEqual(
        v.rows.map((e) => e.item),
        ['coconut water'],
      )
    })

    it('[web/ward] Filter and sort the log: this shift only', () => {
      const v = logView([...log(), entry(at(2, 21), 'in', 100, 'pending')], { period: 'shift' }, { key: 'time', desc: true }, NOW)
      assert.deepEqual(
        v.rows.map((e) => e.volume_ml),
        [100],
      )
    })
  })
})
