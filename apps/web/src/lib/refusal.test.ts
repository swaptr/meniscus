import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createApi, refusalOf, type Refusal } from './api.ts'
import { refusalView } from './capture.ts'
import { saveByHand } from './resolve.ts'

/** 3 Nov 2026 local. */
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 3, h, m, s).getTime()
const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })

/** Fake server: the read answers 429 with `refusal`; a by-hand entry is saved. Records "METHOD path". */
function fake(refusal: { limit: string; budget_class: string; retry_after_ms: number }, retryAfter: string) {
  const calls: string[] = []
  const api = createApi(
    (url, init) => {
      const key = `${init?.method ?? 'GET'} ${url}`
      calls.push(key)
      if (key === 'POST /api/ai/read') {
        return Promise.resolve(
          Response.json(
            { error: 'request_budget_exceeded', message: 'request budget exhausted', retryable: true, ...refusal },
            { status: 429, headers: { 'Retry-After': retryAfter } },
          ),
        )
      }
      return Promise.resolve(Response.json({ id: 1, volume_ml: 200, category: 'water', status: 'pending' }, { status: 201 }))
    },
    () => 1,
  )
  return { api, calls }
}

/** A refused read: the refusal it gives, answered at `answered`. */
async function refused(f: ReturnType<typeof fake>, admissionId: number, answered: number): Promise<Refusal> {
  const err = await f.api.read(photo, { admissionId }).catch((e: unknown) => e)
  const r = refusalOf(err, answered)
  assert.ok(r)
  return r
}
const byHand = {
  draft: { direction: 'in' as const, category: 'water' as const, volume_ml: 200, item: null, notes: null },
  source: 'manual' as const,
  confidence: null,
}

describe('budget refusal', () => {
  it('[web/capture] Budget refusal offers manual entry: Routine bed refused', async () => {
    const f = fake({ limit: 'hourly', budget_class: 'routine', retry_after_ms: 1_200_000 }, '1200')
    const r = await refused(f, 4, at(10, 40))
    assert.deepEqual(r, { until: at(11, 0), budgetClass: 'routine', limit: 'hourly' })
    const before = refusalView(r, at(10, 40))
    assert.equal(before.text, 'Model reads for routine beds are used up until 11:00. Enter by hand, or read again from 11:00.')
    assert.deepEqual(before.readAgain, { label: 'Read again from 11:00', disabled: true })
    assert.equal(refusalView(r, at(10, 59, 59)).readAgain.disabled, true)
    assert.deepEqual(refusalView(r, at(11, 0)).readAgain, { label: 'Read again', disabled: false })
    // Enter by hand, at once: one entry for the bed, no model request.
    await saveByHand(f.api, 4, byHand, null)
    assert.deepEqual(f.calls, ['POST /api/ai/read', 'POST /api/admissions/4/entries'])
  })

  it('[web/capture] Budget refusal offers manual entry: Busy for a moment', async () => {
    const f = fake({ limit: 'concurrent', budget_class: 'critical', retry_after_ms: 5000 }, '5')
    const r = await refused(f, 19, at(10, 40))
    assert.deepEqual(r, { until: at(10, 40, 5), budgetClass: 'critical', limit: 'concurrent' })
    const v = refusalView(r, at(10, 40))
    assert.equal(v.text, 'Model reads are busy. Read again in a few seconds, or enter by hand.')
    assert.ok(!v.text.includes('used up until'))
    assert.equal(v.readAgain.disabled, true)
    assert.equal(refusalView(r, at(10, 40, 4)).readAgain.disabled, true)
    assert.equal(refusalView(r, at(10, 40, 5)).readAgain.disabled, false)
    await saveByHand(f.api, 19, byHand, null)
    assert.deepEqual(f.calls, ['POST /api/ai/read', 'POST /api/admissions/19/entries'])
  })
})
