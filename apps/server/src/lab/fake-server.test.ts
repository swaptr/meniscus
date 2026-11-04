import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../../scripts/fake-server.ts', import.meta.url))

describe('fake server (dev-only, tray-comparison design §16)', () => {
  let sentinel: Server | undefined
  after(() => {
    sentinel?.close()
  })

  it('fake server: /status stays local', async () => {
    // A Model API the shell points at: the script must override it, so it never sees a request.
    let hits = 0
    sentinel = createServer((_req, res) => {
      hits++
      res.end('{}')
    })
    await new Promise<void>((r) => sentinel!.listen(0, '127.0.0.1', r))
    const upstreamUrl = `http://127.0.0.1:${(sentinel.address() as AddressInfo).port}/v1`
    const port = 40_000 + Math.floor(Math.random() * 20_000)
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      env: { PATH: process.env.PATH, MODEL_API_BASE_URL: upstreamUrl, HOST: '127.0.0.1', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', (d: Buffer) => (log += d.toString()))
    child.stderr.on('data', (d: Buffer) => (log += d.toString()))
    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`fake server did not start:\n${log}`)), 20_000)
        child.stdout.on('data', () => {
          if (log.includes('fake server on')) {
            clearTimeout(t)
            resolve()
          }
        })
        child.on('exit', (code) => reject(new Error(`fake server exited ${code}:\n${log}`)))
      })
      const base = `http://127.0.0.1:${port}/api`
      const signIn = await fetch(`${base}/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'anita', password: 'anita' }),
      })
      assert.equal(signIn.status, 201)
      const cookie = signIn.headers.get('set-cookie')!.split(';')[0]!
      const status = await fetch(`${base}/ai/status`, { headers: { cookie } })
      await status.body?.cancel()
      assert.notEqual(status.status, 200)
      assert.equal(hits, 0)
      assert.match(log, /Model API http:\/\/127\.0\.0\.1:9\/v1/)
      // Only method, masked path, status and the client's own step line; never bodies, passwords or the key.
      const lines = log.trim().split('\n').slice(1)
      assert.ok(lines.length >= 2)
      for (const line of lines)
        assert.match(
          line,
          /^(GET|POST|PUT|PATCH|DELETE) \/api\/[\w/:-]* \d{3}$|^\[ai\] \d{3} [a-z_]+ \w+( [\w.-]+)?$|^\[model-api\] GET \/models /,
        )
      assert.doesNotMatch(log, /anita"|fake"|password/)
    } finally {
      child.kill()
    }
  })
})
