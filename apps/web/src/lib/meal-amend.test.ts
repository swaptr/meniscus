import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Meal, StaffRef } from '@meniscus/shared'
import { createApi } from './api.ts'
import { ANITA, RAVI } from './audit-fixtures.ts'
import { AMEND_VOIDED, amendBody, amendedLine, amendForm, canAmend, saveAmend } from './meal-amend.ts'

const SANA: StaffRef = { id: 11, name: 'Sana Mirza', role: 'dietitian' }
const at = (h: number, m = 0) => new Date(2026, 10, 2, h, m).toISOString()

function lunch(over: Partial<Meal> = {}): Meal {
  return {
    labeled_media: null,
    id: 12,
    admission_id: 1,
    meal: 'lunch',
    portion: 75,
    items: 'rice, dal',
    fluid_ml: null,
    source: 'photo',
    confidence: 0.82,
    evidence: null,
    created_at: at(13, 10),
    recorded_at: at(13, 10),
    late: false,
    created_by: RAVI,
    entry_id: null,
    entry_status: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    media: null,
    dishes: [
      { index: 1, name: 'rice', dish_kind: 'rice', portion: 50 },
      { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
    ],
    proof: null,
    served_media: null,
    amendments: [],
    amended_at: null,
    ...over,
  }
}

/** Fake server: records every request; the amend answers `amendStatus`, the meals list `meals`. */
function server({ amendStatus = 200, meals = [] as Meal[] } = {}) {
  const seen: { req: string; body: unknown }[] = []
  const api = createApi(
    (url, init) => {
      seen.push({ req: `${init?.method ?? 'GET'} ${url}`, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null })
      if (url.endsWith('/amend'))
        return Promise.resolve(amendStatus === 200 ? Response.json(lunch()) : Response.json({ error: 'voided' }, { status: amendStatus }))
      return Promise.resolve(Response.json(meals))
    },
    () => 4,
  )
  return { api, seen }
}

describe('amend a meal', () => {
  it('[web/ward] Amend a meal from the bed review: Rice finished after all', async () => {
    const m = lunch()
    const f = amendForm(m)
    f.dishes[0] = { ...f.dishes[0]!, portion: 100 }
    f.reason = 'tray rechecked'
    const amended = lunch({
      amended_at: at(14, 30),
      amendments: [
        {
          id: 1,
          at: at(14, 30),
          by: ANITA,
          reason: 'tray rechecked',
          before: { portion: 75, items: 'rice, dal', dishes: m.dishes },
          after: { portion: 75, items: 'rice, dal', dishes: f.dishes },
        },
      ],
    })
    const { api, seen } = server({ meals: [amended] })
    let reloaded: Meal[] = []
    await saveAmend(api, m, f, async () => {
      reloaded = await api.meals(1)
    })
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/meals/12/amend', 'GET /api/admissions/1/meals'],
    )
    assert.deepEqual(seen[0]!.body, {
      dishes: [
        { index: 1, name: 'rice', dish_kind: 'rice', portion: 100 },
        { index: 2, name: 'dal', dish_kind: 'dal_lentils', portion: 100 },
      ],
      reason: 'tray rechecked',
    })
    assert.equal(seen.filter((s) => s.req.includes('/api/ai')).length, 0)
    assert.equal(amendedLine(reloaded[0]!), 'Amended 14:30 · Anita T. · tray rechecked')
  })

  it('[web/ward] Amend a meal from the bed review: Nothing to save yet', async () => {
    const m = lunch()
    const short = { ...amendForm(m), reason: 'ab' }
    short.dishes[0] = { ...short.dishes[0]!, portion: 100 }
    assert.equal(amendBody(m, short), null)
    const unchanged = { ...amendForm(m), reason: 'checked' }
    assert.equal(amendBody(m, unchanged), null)
    const { api, seen } = server()
    assert.equal(await saveAmend(api, m, short, () => api.meals(1)), null)
    assert.equal(await saveAmend(api, m, unchanged, () => api.meals(1)), null)
    assert.deepEqual(seen, [])
  })

  it('[web/ward] Amend a meal from the bed review: Portion of a meal by hand', async () => {
    const m = lunch({ meal: 'breakfast', source: 'manual', items: 'toast', dishes: [], portion: 100 })
    const f = { ...amendForm(m), portion: 25 as const, reason: 'half the toast left' }
    // No dishes: the dialog shows the items field.
    assert.deepEqual(f.dishes, [])
    assert.equal(f.items, 'toast')
    const { api, seen } = server()
    await saveAmend(api, m, f, () => api.meals(1))
    const amends = seen.filter((s) => s.req.endsWith('/amend'))
    assert.equal(amends.length, 1)
    assert.deepEqual(amends[0]!.body, { portion: 25, reason: 'half the toast left' })
  })

  it('[web/ward] Amend a meal from the bed review: Not offered', () => {
    assert.equal(canAmend(RAVI, lunch()), false)
    assert.equal(canAmend(SANA, lunch()), false)
    assert.equal(canAmend(ANITA, lunch({ voided_at: at(14) })), false)
    assert.equal(canAmend(ANITA, lunch()), true)
    assert.equal(canAmend(null, lunch()), false)
  })

  it('[web/ward] Amend a meal from the bed review: Voided meanwhile', async () => {
    const m = lunch()
    const f = { ...amendForm(m), portion: 100 as const, reason: 'tray rechecked' }
    const { api, seen } = server({ amendStatus: 409 })
    await assert.rejects(
      saveAmend(api, m, f, () => api.meals(1)),
      (err: Error) => err.message === AMEND_VOIDED,
    )
    assert.equal(AMEND_VOIDED, 'This meal was voided. Nothing was changed.')
    assert.deepEqual(
      seen.map((s) => s.req),
      ['POST /api/meals/12/amend'],
    )
  })

  it('sends a dish added or removed as the whole list, and refuses an unnamed dish', () => {
    const m = lunch()
    const removed = { ...amendForm(m), reason: 'no dal served' }
    removed.dishes = removed.dishes.slice(0, 1)
    assert.deepEqual(amendBody(m, removed)?.dishes, [{ index: 1, name: 'rice', dish_kind: 'rice', portion: 50 }])
    const unnamed = { ...amendForm(m), reason: 'added curd' }
    unnamed.dishes = [...unnamed.dishes, { index: 0, name: ' ', dish_kind: 'dairy', portion: 100 }]
    assert.equal(amendBody(m, unnamed), null)
    assert.equal(amendedLine(m), null)
  })
})
