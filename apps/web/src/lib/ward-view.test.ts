import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { wardView } from './model-view.ts'

describe('ward dashboard views', () => {
  it('[web/ward] Ward dashboard views: Unknown view', () => {
    assert.deepEqual(wardView({ view: 'x' }), {})
    assert.deepEqual(wardView({ view: 7 }), {})
    assert.deepEqual(wardView({}), {})
    // The route reads Beds for `{}`; the view's loads are the dashboard's two (see "Bed tile encodings: No extra request").
    assert.equal(wardView({ view: 'x' }).view ?? 'beds', 'beds')
  })

  it('[web/ward] Ward dashboard views: Data quality by address', () => {
    assert.deepEqual(wardView({ view: 'quality' }), { view: 'quality' })
    assert.deepEqual(wardView({ view: 'qr' }), { view: 'qr' })
  })
})
