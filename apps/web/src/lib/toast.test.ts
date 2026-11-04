import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ApiError } from './api.ts'
import { failureGoesTo, TOAST_LIMIT, TOAST_MS, toastQueue, toastOptions } from './toast.ts'

describe('one toast', () => {
  it('[web/interface] Results in one toast: Saved on a long page', () => {
    const o = toastOptions({ text: 'Saved 200 mL drink. Waiting for nurse approval.', tone: 'ok' })
    assert.equal(o.timeout, 6000)
    assert.equal(TOAST_MS, 6000)
    assert.equal(o.priority, 'low') // polite live region
    assert.equal(o.title, 'Saved 200 mL drink. Waiting for nurse approval.')
  })

  it('[web/interface] Results in one toast: One at a time', () => {
    assert.equal(TOAST_LIMIT, 1)
    const q = toastQueue()
    q.push({ text: 'Approved 200 mL.', tone: 'ok' })
    q.push({ text: 'Rejected 100 mL entry.', tone: 'ok' })
    assert.deepEqual(
      q.shown().map((t) => t.text),
      ['Rejected 100 mL entry.'],
    )
  })

  it('[web/interface] Results in one toast: Failure stays', () => {
    const o = toastOptions({ text: 'Can’t reach the server. Check the connection and try again.', tone: 'danger' })
    assert.equal(o.timeout, 0) // until dismissed
    assert.equal(o.priority, 'high') // assertive live region
  })

  it('[web/interface] Results in one toast: Errors stay inline', () => {
    assert.equal(failureGoesTo(new ApiError(422, 'audio_too_long', 'x')), 'inline')
    assert.equal(failureGoesTo(new ApiError(409, 'no_dietitian', 'x')), 'inline')
    assert.equal(failureGoesTo(new ApiError(403, 'forbidden', 'x')), 'inline')
    assert.equal(failureGoesTo(new TypeError('Failed to fetch')), 'toast')
    assert.equal(failureGoesTo(new ApiError(503, 'unavailable', 'x')), 'toast')
  })
})
