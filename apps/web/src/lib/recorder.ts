import { duration } from './format.ts'
/** Voice recorder (MediaRecorder) with elapsed time and an input level. The server converts any codec to WAV. */
export const MAX_RECORDING_MS = 60_000
const FRAME_MS = 50 // about 20 updates a second

export interface RecordingFrame {
  elapsedMs: number
  /** 0..1, RMS of the latest audio samples (0 without a meter). */
  level: number
}

export interface Recording {
  /** Stops and returns the audio. Sends nothing: uploading is the caller's one request. */
  stop: () => Promise<Blob>
  cancel: () => void
  elapsedMs: () => number
  /** Called about 20 times a second while recording; returns an unsubscribe. */
  listen: (fn: (f: RecordingFrame) => void) => () => void
}

/** `m:ss / 1:00`; whole seconds, rounded down. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.min(MAX_RECORDING_MS, Math.floor(ms / 1000) * 1000)) / 1000
  const limit = MAX_RECORDING_MS / 1000
  const mmss = (n: number) => duration(n * 1000)
  return `${mmss(s)} / ${mmss(limit)}`
}

/** RMS of 8-bit time-domain samples (128 = silence), scaled so speech fills most of the bar. */
export function levelOf(samples: Uint8Array): number {
  if (!samples.length) return 0
  let sum = 0
  for (const b of samples) sum += ((b - 128) / 128) ** 2
  return Math.min(1, Math.sqrt(sum / samples.length) * 4)
}

export interface RecorderLike {
  state: string
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start: () => void
  stop: () => void
}
interface Meter {
  level: () => number
  close: () => void
}
/** Browser parts, injectable for tests. */
export interface RecorderDeps {
  media: () => Promise<MediaStream>
  recorder: (stream: MediaStream) => RecorderLike
  meter: (stream: MediaStream) => Meter | null
  now: () => number
  frame: (cb: () => void) => number
  cancelFrame: (id: number) => void
}

const browser = (): RecorderDeps => ({
  media: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  recorder: (stream) => new MediaRecorder(stream) as unknown as RecorderLike,
  // Created inside the tap that starts recording, so the browser allows it.
  meter: (stream) => {
    if (typeof AudioContext === 'undefined') return null
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    ctx.createMediaStreamSource(stream).connect(analyser)
    const buf = new Uint8Array(analyser.fftSize)
    return {
      level: () => {
        analyser.getByteTimeDomainData(buf)
        return levelOf(buf)
      },
      close: () => void ctx.close(),
    }
  },
  now: () => performance.now(),
  frame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
})

export async function startRecording(onAutoStop: () => void, deps: RecorderDeps = browser()): Promise<Recording> {
  const stream = await deps.media()
  const rec = deps.recorder(stream)
  const meter = deps.meter(stream)
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      resolve(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
    }
  })
  rec.start()
  const started = deps.now()
  const elapsedMs = () => deps.now() - started
  const listeners = new Set<(f: RecordingFrame) => void>()
  let last = -Infinity
  let raf = 0
  const tick = () => {
    const t = deps.now()
    if (t - last >= FRAME_MS) {
      last = t
      const f = { elapsedMs: t - started, level: meter?.level() ?? 0 }
      listeners.forEach((fn) => fn(f))
    }
    raf = deps.frame(tick)
  }
  raf = deps.frame(tick)
  const timer = setTimeout(onAutoStop, MAX_RECORDING_MS)
  let stopped = false
  const stop = () => {
    if (!stopped) {
      stopped = true
      clearTimeout(timer)
      deps.cancelFrame(raf)
      listeners.clear()
      meter?.close()
      if (rec.state !== 'inactive') rec.stop()
    }
    return done
  }
  return {
    stop,
    cancel: () => void stop(),
    elapsedMs,
    listen: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
