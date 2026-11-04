import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatElapsed, levelOf, startRecording, type RecorderLike, type RecordingFrame } from './recorder.ts'

describe('recorder', () => {
  it('[web/capture] Recording feedback: Seven seconds in', async () => {
    const sent: string[] = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (input: RequestInfo | URL) => {
      sent.push(input instanceof Request ? input.url : input.toString())
      return Promise.reject(new Error('no network in tests'))
    }
    try {
      const clock = { t: 1_000 }
      const frames: (() => void)[] = []
      const rec: RecorderLike = {
        state: 'inactive',
        mimeType: 'audio/webm',
        ondataavailable: null,
        onstop: null,
        start() {
          this.state = 'recording'
        },
        stop() {
          this.state = 'inactive'
          this.ondataavailable?.({ data: new Blob(['synthetic']) })
          this.onstop?.()
        },
      }
      let closed = false
      const r = await startRecording(() => assert.fail('no auto-stop at 7 s'), {
        media: () => Promise.resolve({ getTracks: () => [] } as unknown as MediaStream),
        recorder: () => rec,
        meter: () => ({ level: () => 0.4, close: () => (closed = true) }),
        now: () => clock.t,
        frame: (cb) => frames.push(cb),
        cancelFrame: () => {},
      })
      const seen: RecordingFrame[] = []
      r.listen((f) => seen.push(f))

      clock.t += 7_400
      frames.at(-1)!()
      assert.equal(formatElapsed(r.elapsedMs()), '0:07 / 1:00')
      assert.deepEqual(seen.at(-1), { elapsedMs: 7_400, level: 0.4 })
      assert.deepEqual(sent, [], 'nothing is sent while recording')

      const audio = await r.stop()
      assert.equal(audio.size, 'synthetic'.length)
      assert.equal(closed, true)
      assert.deepEqual(sent, [], 'stopping returns the audio; sending is the caller’s one request')
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('formats the limit and clamps', () => {
    assert.equal(formatElapsed(0), '0:00 / 1:00')
    assert.equal(formatElapsed(59_999), '0:59 / 1:00')
    assert.equal(formatElapsed(60_000), '1:00 / 1:00')
    assert.equal(formatElapsed(75_000), '1:00 / 1:00')
  })

  it('reads silence as 0 and a loud signal as full', () => {
    assert.equal(levelOf(new Uint8Array(64).fill(128)), 0)
    assert.equal(levelOf(new Uint8Array(64).map((_, i) => (i % 2 ? 0 : 255))), 1)
  })
})
