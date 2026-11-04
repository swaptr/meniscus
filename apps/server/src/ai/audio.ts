import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Browser recordings (webm/ogg/mp4) → mono 16-bit PCM WAV at 16 kHz, the
 * format the speech-to-text API accepts. Temp files, not pipes: a piped WAV
 * has no size in its header.
 */
export async function toWav(input: Uint8Array): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'meniscus-audio-'))
  try {
    const src = join(dir, 'in')
    const out = join(dir, 'out.wav')
    await writeFile(src, input)
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-map_metadata', '-1', out])
    return await readFile(out)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export class AudioConversionError extends Error {
  override name = 'AudioConversionError'
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => reject(new AudioConversionError(`${cmd} unavailable: ${e.message}`)))
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new AudioConversionError(`could not decode audio: ${err.trim().split('\n').pop()}`)),
    )
  })
}
