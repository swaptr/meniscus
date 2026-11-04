import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ago,
  clock,
  dayLabelClock,
  isoDate,
  confidenceChip,
  dayClock,
  dayLabel,
  dayMonth,
  duration,
  hourRange,
  litres,
  ml,
  percent,
  plural,
  rate,
  signedMl,
} from './format.ts'

// Local-time dates, so the result does not depend on the machine's zone; the helpers never use ICU,
// so the device locale (en-US in the scenarios) cannot change them.
const local = (mo: number, d: number, h: number, m: number) => new Date(2026, mo - 1, d, h, m)

describe('format', () => {
  it('[web/interface] Times and dates written one way: US locale', () => {
    const t = local(11, 3, 21, 38)
    assert.equal(clock(t), '21:38')
    assert.equal(dayLabel(t), 'Tue 3 Nov')
    assert.equal(clock(local(11, 3, 9, 5)), '09:05')
    assert.equal(hourRange(local(11, 3, 14, 20)), '14:00–15:00')
    assert.equal(hourRange(local(11, 3, 23, 0)), '23:00–00:00')
  })

  it('[web/interface] Times and dates written one way: Not today', () => {
    assert.equal(dayClock(local(11, 3, 22, 5), local(11, 4, 8, 10)), '3 Nov 22:05')
    assert.equal(dayClock(local(11, 4, 7, 55), local(11, 4, 8, 10)), '07:55')
    assert.equal(dayMonth(local(1, 9, 0, 0)), '9 Jan')
  })

  it('[web/interface] Times and dates written one way: Time input echo', () => {
    // TimeField echoes clock(value) beside the native input.
    assert.equal(clock(local(11, 4, 21, 38).getTime()), '21:38')
  })

  it('[web/interface] Confidence written one way: Meal read', () => {
    assert.deepEqual(confidenceChip('Photo', 0.82), { text: 'Photo · 82%', tone: 'neutral' })
  })

  it('[web/interface] Confidence written one way: Low on the round', () => {
    assert.deepEqual(confidenceChip('Photo', 0.62), { text: 'Photo · 62%', tone: 'warn' })
    assert.deepEqual(confidenceChip('Photo', 0.75), { text: 'Photo · 75%', tone: 'neutral' })
  })

  it('[web/interface] Units on every volume: Ward list tiles', () => {
    assert.equal(ml(1200), '1200 mL')
    assert.equal(plural(7, 'bed', 'beds'), '7 beds')
    assert.equal(plural(1, 'entry', 'entries'), '1 entry')
  })

  it('[web/interface] Units on every volume: Balance', () => {
    assert.equal(signedMl(1500 - 900), '+600 mL')
    assert.equal(signedMl(-80), '−80 mL')
    assert.equal(signedMl(0), '0 mL')
  })

  it('writes the other helpers', () => {
    assert.equal(litres(1500), '1.5')
    assert.equal(litres(2000), '2')
    assert.equal(percent(0.82), '82%')
    assert.equal(rate({ n: 20, of: 26, pct: 76.9 }), '77% · 20/26')
    assert.equal(rate({ n: 3, of: 4, pct: null }), '— · 3/4')
    const now = local(11, 4, 12, 0)
    assert.equal(ago(local(11, 4, 11, 48), now), '12 min ago')
    assert.equal(ago(local(11, 4, 9, 0), now), '3 h ago')
    assert.equal(ago(now, now), 'just now')
    assert.equal(duration(42_000), '0:42')
    assert.equal(isoDate(local(1, 9, 8, 0)), '2026-01-09')
    assert.equal(dayLabelClock(local(11, 3, 21, 38)), 'Tue 3 Nov 21:38')
  })
})
