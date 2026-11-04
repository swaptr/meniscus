/**
 * Speech-to-text: `POST /v1/asr/transcribe`, multipart (`request` JSON + `audio`).
 * Audio must be RIFF/WAVE, mono, 16-bit PCM, 16 or 24 kHz, ≤ 10 min (else 400),
 * request body ≤ 32 MB (else 413). Validated locally first, so a bad or over-long
 * file never costs a request.
 * https://dev.meta.ai/docs/speech-to-text
 */
import { MetaError } from './errors.ts'
import type { CallOptions } from './responses.ts'
import type { Request } from './transport.ts'

export interface TranscribeParams {
  /** WAV bytes (see module doc for the required format). */
  audio: Uint8Array
  model?: string
  mode?: 'PUSH_TO_TALK' | 'ENDPOINTING' | 'DIARIZATION'
  /**
   * Language names as the docs list them, e.g. `["English", "Hindi"]`; omit to auto-detect. A hint, not a forced
   * language (https://dev.meta.ai/docs/speech-to-text, https://dev.meta.ai/docs/api-reference/voice/schemas, 2026-11-04).
   * Sent as given: codes such as `en` are not documented values.
   */
  languageBias?: string[]
  keywords?: string[]
  /** Correlation id; the server generates one when absent. */
  sessionId?: string
}

/**
 * Transcribe request fields that apply to `text/event-stream` replies only
 * (https://dev.meta.ai/docs/api-reference/voice/schemas). Typed for completeness: `transcribe` is buffered, does not
 * accept these and never sends them.
 */
export interface TranscribeStreamConfig {
  /** Default `CUMULATIVE`. */
  partialMode?: 'CUMULATIVE' | 'DELTA'
  /** Default `true`. */
  emitAudioProgress?: boolean
}

export interface Transcription {
  sessionId: string
  transcript: string
  audioDurationMs: number
  /** Empty in PUSH_TO_TALK. */
  turns: { turnId: number; startMs: number; endMs: number; transcript: string; speaker?: string }[]
}

const MAX_BYTES = 32 * 1024 * 1024
/** Speech-to-text answers 400 for audio over 10 minutes. https://dev.meta.ai/docs/speech-to-text */
export const MAX_AUDIO_MS = 600_000

export class InvalidAudioError extends MetaError {
  override name = 'InvalidAudioError'
}

/** The clip is longer than the API accepts; nothing was sent. */
export class AudioTooLongError extends InvalidAudioError {
  override name = 'AudioTooLongError'
  /** Clip length in whole ms, from the bytes of the `data` chunk the file holds. */
  readonly durationMs: number
  readonly limitMs: number
  constructor(durationMs: number, limitMs: number = MAX_AUDIO_MS) {
    super(`audio is ${durationMs} ms; limit is ${limitMs} ms`)
    this.durationMs = durationMs
    this.limitMs = limitMs
  }
}

/**
 * Pure: check the RIFF/WAVE header and `fmt ` chunk against the API's accepted
 * format, then the clip length, then the size. Chunks are walked, never read at a
 * fixed offset. Length = floor(min(declared, present) data bytes × 1000 / (rate × 2)),
 * so a streamed (0xFFFFFFFF) or truncated `data` header cannot inflate or hide it.
 * Length comes before size so an over-long clip gets the message staff can act on.
 */
export function checkWav(b: Uint8Array): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const tag = (o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!)
  if (b.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new InvalidAudioError('audio is not a RIFF/WAVE file')
  let rate: number | undefined
  let dataBytes: number | undefined
  for (let o = 12; o + 8 <= b.byteLength;) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ' && rate === undefined) {
      if (o + 24 > b.byteLength) break
      const format = v.getUint16(o + 8, true)
      const channels = v.getUint16(o + 10, true)
      const r = v.getUint32(o + 12, true)
      const bits = v.getUint16(o + 22, true)
      if (format !== 1 || channels !== 1 || bits !== 16 || (r !== 16000 && r !== 24000)) {
        throw new InvalidAudioError(
          `audio must be mono 16-bit PCM at 16/24 kHz; got format=${format} channels=${channels} bits=${bits} rate=${r}`,
        )
      }
      rate = r
    } else if (tag(o) === 'data' && dataBytes === undefined) {
      dataBytes = Math.min(size, b.byteLength - (o + 8))
    }
    if (rate !== undefined && dataBytes !== undefined) break
    o += 8 + size + (size & 1)
  }
  if (rate === undefined) throw new InvalidAudioError('WAV has no fmt chunk')
  if (dataBytes === undefined) throw new InvalidAudioError('WAV has no data chunk')
  const durationMs = Math.floor((dataBytes * 1000) / (rate * 2))
  if (durationMs > MAX_AUDIO_MS) throw new AudioTooLongError(durationMs)
  if (b.byteLength > MAX_BYTES) throw new InvalidAudioError(`audio is ${b.byteLength} bytes; limit is 32 MB`)
}

export function createAsr(request: Request, defaultModel: string) {
  async function transcribe(p: TranscribeParams, opts: CallOptions = {}) {
    checkWav(p.audio)
    const model = p.model ?? defaultModel
    const form = new FormData()
    const req = {
      model,
      audioEncoding: 'WAV',
      mode: p.mode ?? 'PUSH_TO_TALK',
      ...(p.languageBias?.length && { languageBias: p.languageBias }),
      ...(p.keywords?.length && { keywords: p.keywords }),
    }
    form.append('request', new Blob([JSON.stringify(req)], { type: 'application/json' }))
    form.append('audio', new Blob([p.audio as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'audio.wav')
    const qs = p.sessionId ? `?sessionId=${encodeURIComponent(p.sessionId)}` : ''
    const { data, ms } = await request<Transcription>({
      method: 'POST',
      path: `/asr/transcribe${qs}`,
      model,
      form,
      signal: opts.signal,
      ticket: opts.ticket,
    })
    return { ...data, transcript: data.transcript.trim(), ms }
  }
  return { transcribe }
}
