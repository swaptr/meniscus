import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { URINE_REFERENCE, type DraftEntry, type Entry } from '@meniscus/shared'
import { createApi } from './api.ts'
import { entry } from './audit-fixtures.ts'
import { saveEntry, toEntryInput, type Pending } from './capture.ts'
import { entrySwatch, seenSwatch, withColour } from './urine.ts'

/** Fake server: records every request and answers with the posted entry. */
function server() {
  const seen: { req: string; body: Record<string, unknown> | null }[] = []
  const api = createApi(
    (url, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      seen.push({ req: `${init?.method ?? 'GET'} ${url}`, body })
      return Promise.resolve(Response.json(entry({ ...(body as Partial<Entry>), id: 9 }), { status: 201 }))
    },
    () => 1,
  )
  return { api, seen }
}

const urine = (over: Partial<Entry> = {}) => entry({ direction: 'out', category: 'urine', volume_ml: 300, ...over })
const readDraft: DraftEntry = {
  direction: 'out',
  category: 'urine',
  volume_ml: 450,
  item: 'urine bag',
  notes: 'dark amber, clear',
  urine_colour: 'dark',
  urine_rgb: '#c9952f',
}
const photo = (draft: DraftEntry): Pending => ({ draft, source: 'photo', confidence: 0.9 })

describe('urine colour beside urine counts', () => {
  it('[web/ward] Urine colour beside urine counts: Bag photographed dark', () => {
    const e = urine({ status: 'pending', urine_colour: 'dark', urine_rgb: '#c9952f' })
    assert.deepEqual(entrySwatch(e), { fill: '#c9952f', label: 'Dark amber', photo: true })
    const seen = seenSwatch({ colour: 'dark', rgb: '#c9952f', charted_at: e.created_at, status: 'pending' })
    assert.deepEqual(seen, { fill: '#c9952f', label: 'Dark amber · pending', photo: true })
  })

  it('[web/ward] Urine colour beside urine counts: Named in a note', () => {
    const e = urine({ status: 'approved', source: 'voice', urine_colour: 'red', urine_rgb: null })
    assert.deepEqual(entrySwatch(e), { fill: URINE_REFERENCE.red, label: 'Red', photo: false })
  })

  it('[web/ward] Urine colour beside urine counts: No colour', () => {
    assert.equal(entrySwatch(urine()), null)
    assert.equal(entrySwatch(entry({ urine_colour: 'dark' })), null, 'a drink never shows a urine swatch')
    assert.equal(seenSwatch(null), null)
  })
})

describe('urine colour on the check screen', () => {
  it('[web/capture] Urine colour on the check screen: Read colour kept', () => {
    const body = toEntryInput(photo(readDraft))
    assert.equal(body.urine_colour, 'dark')
    assert.equal(body.urine_rgb, '#c9952f')
  })

  it('[web/capture] Urine colour on the check screen: Staff change the colour', () => {
    const body = toEntryInput(photo(withColour(readDraft, 'red')))
    assert.equal(body.urine_colour, 'red')
    assert.equal('urine_rgb' in body, false)
  })

  it('[web/capture] Urine colour on the check screen: Type changed', () => {
    const body = toEntryInput(photo({ ...readDraft, direction: 'in', category: 'water' }))
    assert.equal('urine_colour' in body, false)
    assert.equal('urine_rgb' in body, false)
  })

  it('[web/capture] Urine colour on the check screen: By hand', async () => {
    const s = server()
    const draft = withColour({ direction: 'out', category: 'urine', volume_ml: 300, item: null, notes: null }, 'yellow')
    await saveEntry(s.api, 1, { draft, source: 'manual', confidence: null })
    assert.deepEqual(
      s.seen.map((x) => x.req),
      ['POST /api/admissions/1/entries'],
    )
    assert.equal(s.seen[0]!.body!.urine_colour, 'yellow')
    assert.equal('urine_rgb' in s.seen[0]!.body!, false)
  })
})
