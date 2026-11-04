import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ALERT_TONE, liquidVolumeMl, worstTone } from '@meniscus/shared'

describe('liquidVolumeMl', () => {
  it('[capture/photo-reading] Liquid region quantity: Urine bag 46% full', () => {
    assert.equal(liquidVolumeMl(0.463, 2000), 930)
    assert.equal(liquidVolumeMl(0.125, 1000), 130)
    assert.equal(liquidVolumeMl(0, 2000), 0)
  })

  it('[capture/photo-reading] Liquid region quantity: No capacity', () => {
    assert.equal(liquidVolumeMl(0.4, null), null)
    assert.equal(liquidVolumeMl(null, 2000), null)
  })
})

describe('worstTone', () => {
  it('takes the worst prompt tone', () => {
    assert.equal(worstTone([]), null)
    assert.equal(worstTone(['info', 'warn']), 'warn')
    assert.equal(worstTone([ALERT_TONE.overload, ALERT_TONE.nil_by_mouth_intake, 'info']), 'danger')
  })
})
