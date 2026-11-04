import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Entry } from '@meniscus/shared'
import { createApi } from './api.ts'
import { entry } from './audit-fixtures.ts'
import { toEntryInput, type Pending } from './capture.ts'
import { addMissedEntry, amendBody, chartedAt, offersConsistency, offersMissedEntry, rejectBody, saveByHand } from './resolve.ts'

/** Fake server: records path, X-Staff-Id and body of every request. */
function server(staffId = 4) {
  const seen: { path: string; staff: string | null; body: Record<string, unknown> | null }[] = []
  let next = 41
  const api = createApi(
    (url, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      seen.push({ path: url, staff: new Headers(init?.headers).get('x-staff-id'), body })
      if (url.endsWith('/entries'))
        return Promise.resolve(Response.json(entry({ id: ++next, ...(body as Partial<Entry>) }), { status: 201 }))
      return Promise.resolve(Response.json(entry({ id: next, status: 'approved' })))
    },
    () => staffId,
  )
  return { api, seen }
}

const drink = { direction: 'in', category: 'water', volume_ml: 200, item: null, notes: null } as const

describe('resolve from the bed review', () => {
  it('[web/ward] Resolve from the bed review: Missed drink', async () => {
    const { api, seen } = server()
    const now = new Date(2026, 10, 2, 14, 10)
    const when = chartedAt('08:00', now, new Date(2026, 10, 1, 9).toISOString())
    assert.ok('iso' in when)
    const r = await addMissedEntry(api, 16, drink, when.iso)
    assert.equal(r.entry.status, 'approved')
    assert.equal(r.error, null)
    assert.deepEqual(
      seen.map((s) => [s.path, s.staff]),
      [
        ['/api/admissions/16/entries', '4'],
        ['/api/entries/42/review', '4'],
      ],
    )
    assert.equal(seen[0]!.body!.source, 'manual')
    assert.equal(seen[0]!.body!.charted_at, new Date(2026, 10, 2, 8).toISOString())
    assert.deepEqual(seen[1]!.body, { action: 'approve' })
    assert.ok(seen.every((s) => !s.path.startsWith('/api/ai')))
  })

  it('[web/ward] Resolve from the bed review: Attendant adds a missed drink', async () => {
    // Ravi Kumar (id 1, attendant): saved for a nurse to approve, not approved.
    const { api, seen } = server(1)
    const now = new Date(2026, 10, 2, 14, 10)
    const when = chartedAt('08:00', now, new Date(2026, 10, 1, 9).toISOString())
    assert.ok('iso' in when)
    const r = await addMissedEntry(api, 16, drink, when.iso, { approve: false })
    assert.equal(r.entry.status, 'pending')
    assert.equal(r.error, null)
    assert.deepEqual(
      seen.map((s) => [s.path, s.staff]),
      [['/api/admissions/16/entries', '1']],
    )
    assert.equal(seen[0]!.body!.source, 'manual')
    assert.equal(seen[0]!.body!.charted_at, new Date(2026, 10, 2, 8).toISOString())
    assert.ok(seen.every((s) => !s.path.startsWith('/api/ai')))
  })

  it('[web/ward] Resolve from the bed review: Reject with a reason', () => {
    assert.deepEqual(rejectBody('duplicate', ''), { action: 'reject', reason: 'duplicate' })
    assert.deepEqual(rejectBody('other', '  bag swapped  '), { action: 'reject', reason: 'other', note: 'bag swapped' })
    assert.deepEqual(rejectBody(null, ''), { action: 'reject' })
  })

  it('[web/ward] Resolve from the bed review: Gap prompts offer a missed entry', () => {
    assert.equal(offersMissedEntry('logging_gap'), true)
    assert.equal(offersMissedEntry('intake_incomplete'), true)
    assert.equal(offersMissedEntry('intake_target_behind'), true)
    assert.equal(offersMissedEntry('low_urine_output'), false)
    assert.equal(offersMissedEntry('mismatch'), false)
  })

  it('[web/ward] Resolve from the bed review: Amend needs a reason', () => {
    const e = entry({ status: 'approved', volume_ml: 400, recorded_ml: 400, approved_ml: 400 })
    assert.equal(amendBody(e, 380, 'water', ''), null)
    assert.equal(amendBody(e, 380, 'water', 'ok'), null)
    assert.equal(amendBody(e, 380, 'water', ' o k '), null)
    assert.deepEqual(amendBody(e, 380, 'water', 'jug re-measured'), { volume_ml: 380, reason: 'jug re-measured' })
    // Nothing changed, or an impossible volume: still disabled.
    assert.equal(amendBody(e, 400, 'water', 'jug re-measured'), null)
    assert.equal(amendBody(e, 0, 'water', 'jug re-measured'), null)
    assert.deepEqual(amendBody(e, 400, 'food', 'was soup'), { category: 'food', reason: 'was soup' })
  })
})

describe('late entry by hand', () => {
  const admitted = new Date(2026, 10, 1, 9).toISOString()

  it('[web/capture] Late entry by hand: This morning', () => {
    assert.deepEqual(chartedAt('08:00', new Date(2026, 10, 2, 14, 10), admitted), { iso: new Date(2026, 10, 2, 8).toISOString() })
  })

  it('[web/capture] Late entry by hand: Last night', () => {
    assert.deepEqual(chartedAt('22:00', new Date(2026, 10, 2, 7, 30), admitted), { iso: new Date(2026, 10, 1, 22).toISOString() })
  })

  it('[web/capture] Late entry by hand: Now', async () => {
    const { api, seen } = server()
    const p: Pending = { draft: drink, source: 'manual', confidence: null }
    assert.equal('charted_at' in toEntryInput(p), false)
    await saveByHand(api, 16, p, null)
    assert.equal(seen.length, 1)
    assert.equal('charted_at' in seen[0]!.body!, false)
  })

  it('[web/capture] Late entry by hand: Before admission', async () => {
    const { api, seen } = server()
    const when = chartedAt('09:00', new Date(2026, 10, 2, 14, 10), new Date(2026, 10, 2, 10).toISOString())
    assert.deepEqual(when, { error: 'Before admission' })
    assert.ok('error' in chartedAt('25:00', new Date(2026, 10, 2, 14, 10), admitted))
    // A refused time never reaches the server.
    await assert.rejects(saveByHand(api, 16, { draft: drink, source: 'manual', confidence: null }, when), /Before admission/)
    assert.equal(seen.length, 0)
    const ok = chartedAt('11:00', new Date(2026, 10, 2, 14, 10), new Date(2026, 10, 2, 10).toISOString())
    assert.ok('iso' in ok)
    await saveByHand(api, 16, { draft: drink, source: 'manual', confidence: null }, ok)
    assert.equal(seen[0]!.body!.charted_at, new Date(2026, 10, 2, 11).toISOString())
  })
})

describe("correct a drink's consistency", () => {
  it("[web/ward] Correct a drink's consistency: Record a jug drink's level", async () => {
    // Anita Thomas (id 4): an approved 400 mL jug-drop drink with no level.
    const e = entry({ id: 42, source: 'photo', status: 'approved', volume_ml: 400, recorded_ml: 400, approved_ml: 400, iddsi_level: null })
    assert.equal(offersConsistency(e.category), true)
    assert.equal(e.iddsi_level, null, 'no chip picked at first')
    assert.equal(amendBody(e, 400, 'water', 'checked the cup'), null, 'nothing changed yet')
    const body = amendBody(e, 400, 'water', 'checked the cup', 2)
    assert.deepEqual(body, { iddsi_level: 2, reason: 'checked the cup' })
    const { api, seen } = server(4)
    await api.amend(e.id, body)
    assert.deepEqual(
      seen.map((s) => [s.path, s.staff]),
      [['/api/entries/42/amend', '4']],
    )
    assert.deepEqual(seen[0]!.body, { iddsi_level: 2, reason: 'checked the cup' })
    assert.ok(seen.every((s) => !s.path.startsWith('/api/ai')))
    // The same level again is no change.
    assert.equal(amendBody(entry({ ...e, iddsi_level: 2 }), 400, 'water', 'checked the cup', 2), null)
  })

  it("[web/ward] Correct a drink's consistency: Not a drink", () => {
    const urine = entry({ direction: 'out', category: 'urine', status: 'approved', volume_ml: 300 })
    assert.equal(offersConsistency(urine.category), false)
    assert.equal(amendBody(urine, 300, 'urine', 'rechecked', 2), null, 'a level is never sent for urine')
    const drink = entry({ status: 'approved', iddsi_level: 2 })
    assert.equal(offersConsistency('food'), false)
    assert.deepEqual(amendBody(drink, 200, 'food', 'it was soup', 2), { category: 'food', reason: 'it was soup' })
  })
})
