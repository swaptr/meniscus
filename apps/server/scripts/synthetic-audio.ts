/**
 * Synthetic "recording" for the demo history: a WAV of silence with soft beeps during each transcript turn, labelled
 * as synthetic in its INFO chunk. It stands in for a voice note so the player and its timed turns have something to
 * play. No real voices, no patient data.
 */
const RATE = 8000

export interface ToneTurn {
  start_ms: number
  end_ms: number
}

/** 16-bit mono PCM at 8 kHz: silence, and 90 ms beeps every 240 ms inside each turn (a different pitch per turn). */
export function toneWav(durationMs: number, turns: ToneTurn[]): Uint8Array {
  const n = Math.round((durationMs / 1000) * RATE)
  const samples = new Int16Array(n)
  turns.forEach((t, k) => {
    const freq = [523.25, 659.25, 587.33, 698.46][k % 4]!
    for (let at = t.start_ms; at + 90 <= t.end_ms; at += 240) {
      const from = Math.round((at / 1000) * RATE)
      const len = Math.round(0.09 * RATE)
      for (let i = 0; i < len && from + i < n; i++) {
        // 10 ms fade in and out, so the beeps do not click.
        const fade = Math.min(1, i / 80, (len - i) / 80)
        samples[from + i] = Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * 0.22 * fade * 32767)
      }
    }
  })
  const info = infoChunk({ INAM: 'Meniscus demo tone', ICMT: 'synthetic: not a recording of anyone' })
  const data = Buffer.from(samples.buffer)
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8) // PCM
  fmt.writeUInt16LE(1, 10) // mono
  fmt.writeUInt32LE(RATE, 12)
  fmt.writeUInt32LE(RATE * 2, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const dataHead = Buffer.alloc(8)
  dataHead.write('data', 0, 'ascii')
  dataHead.writeUInt32LE(data.length, 4)
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmt, info, dataHead, data])
  const riff = Buffer.alloc(8)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(body.length, 4)
  return new Uint8Array(Buffer.concat([riff, body]))
}

/** A RIFF `LIST`/`INFO` chunk of NUL-terminated, even-padded strings. */
function infoChunk(fields: Record<string, string>): Buffer {
  const parts = Object.entries(fields).map(([id, text]) => {
    const value = Buffer.from(`${text}\0`, 'ascii')
    const padded = value.length % 2 ? Buffer.concat([value, Buffer.alloc(1)]) : value
    const head = Buffer.alloc(8)
    head.write(id, 0, 'ascii')
    head.writeUInt32LE(value.length, 4)
    return Buffer.concat([head, padded])
  })
  const list = Buffer.concat([Buffer.from('INFO', 'ascii'), ...parts])
  const head = Buffer.alloc(8)
  head.write('LIST', 0, 'ascii')
  head.writeUInt32LE(list.length, 4)
  return Buffer.concat([head, list])
}

/** Turns from a transcript at even times: about 350 ms a word, a new turn at the amount ("… had tea" | "300 mL"), 150 ms apart. */
export function evenTurns(transcript: string): { duration_ms: number; turns: (ToneTurn & { text: string })[] } {
  const words = transcript.split(/\s+/).filter(Boolean)
  const amount = words.findIndex((w, i) => /^\d+$/.test(w) && /^ml$/i.test(words[i + 1] ?? ''))
  const groups = amount > 0 ? [words.slice(0, amount), words.slice(amount)] : [words]
  const lead = 300
  const turns = []
  let at = lead
  for (const g of groups) {
    const len = g.length * 350
    turns.push({ start_ms: at, end_ms: at + len, text: g.join(' ') })
    at += len + 150
  }
  return { duration_ms: at - 150 + lead, turns }
}
