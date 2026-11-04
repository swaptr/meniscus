import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WardSummary } from '@meniscus/shared'
import { ENTRY_STATUS_LABEL, ENTRY_STATUS_TONE, SOURCE_LABEL, STATUS_LABEL } from './labels.ts'
import { overloadTone, wardTone } from './ward.ts'

const ward = (over: Partial<WardSummary>): WardSummary => ({
  id: 1,
  code: '2C',
  name: 'Ward 2C',
  specialty: 'Medicine',
  capacity: 6,
  occupied: 6,
  pending: 0,
  beds_with_alerts: 0,
  last_entry_at: null,
  default_acuity: 'stable',
  in_charge: null,
  ...over,
})

describe('ward status and labels', () => {
  it('[web/interface] Ward status from its beds: Quiet ward', () => {
    assert.deepEqual(wardTone(ward({ worst_tone: null })), { tone: 'ok', label: 'On track' })
    assert.deepEqual(wardTone(ward({})), { tone: 'ok', label: 'On track' })
    assert.deepEqual(wardTone(ward({ worst_tone: null, pending: 3 })), { tone: 'pending', label: 'Pending' })
  })

  it('[web/interface] Ward status from its beds: Ward with a red prompt', () => {
    assert.deepEqual(wardTone(ward({ code: 'HDU', worst_tone: 'danger', beds_with_alerts: 1, pending: 2 })), {
      tone: 'danger',
      label: 'Review now',
    })
    assert.deepEqual(wardTone(ward({ worst_tone: 'warn' })), { tone: 'warn', label: 'Review' })
    assert.deepEqual(wardTone(ward({ worst_tone: 'info' })), { tone: 'info', label: 'Check' })
  })

  it('balance tone follows the overload rule, none while urine is not measured', () => {
    // charting/alerts "Fluid overload": Toilet bed drinking well (2400 mL in, nothing out).
    assert.equal(overloadTone(2400, { urine_measured: false }), 'neutral')
    assert.equal(overloadTone(2400, { urine_measured: true }), 'warn')
    assert.equal(overloadTone(1500, { urine_measured: true }), 'neutral')
    assert.equal(overloadTone(1501, null), 'warn')
  })

  it('one label per status and source', () => {
    assert.equal(STATUS_LABEL.pending, 'Pending')
    assert.equal(SOURCE_LABEL.manual, 'By hand')
    assert.deepEqual(ENTRY_STATUS_TONE, { pending: 'pending', approved: 'ok', rejected: 'neutral' })
    assert.deepEqual(ENTRY_STATUS_LABEL, { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' })
  })
})
