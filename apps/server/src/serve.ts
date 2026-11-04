/**
 * The server process's listen and shutdown (server/hosting "Graceful shutdown"). Shutting down stops accepting, lets
 * requests in flight finish for up to `graceMs`, closes what is left, then the store. Nothing here calls a model, and
 * a request cut off at the limit is never retried.
 */
import type { Server, ServerResponse } from 'node:http'
import { serve } from '@hono/node-server'
import type { Store } from './store/port.ts'

export interface Running {
  server: Server
  /** Idempotent. Stops accepting, drains for `graceMs`, closes the rest, then the store. */
  shutdown(): Promise<void>
}

export interface StartOptions {
  fetch: (r: Request) => Response | Promise<Response>
  store: Pick<Store, 'close'>
  host: string
  port: number
  graceMs: number
  /** Start checks, awaited before listening; a rejection rejects `startServer` and nothing listens. */
  beforeListen?: () => Promise<void>
}

export async function startServer({ fetch, store, host, port, graceMs, beforeListen }: StartOptions): Promise<Running> {
  await beforeListen?.()
  const server = await new Promise<Server>((resolve, reject) => {
    const s = serve({ fetch, hostname: host, port }, () => resolve(s)) as Server
    s.once('error', reject)
  })
  // Responses not yet sent: once stopping, each one closes its connection when done, so a keep-alive client never
  // holds the drain open for the whole grace period.
  const open = new Set<ServerResponse>()
  let stopping: Promise<void> | undefined
  server.on('request', (_req, res: ServerResponse) => {
    if (stopping) res.shouldKeepAlive = false
    open.add(res)
    res.once('close', () => open.delete(res))
  })
  const shutdown = () =>
    (stopping ??= (async () => {
      for (const res of open) if (!res.headersSent) res.shouldKeepAlive = false
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeIdleConnections()
      let timer: NodeJS.Timeout | undefined
      const late = new Promise<'late'>((resolve) => (timer = setTimeout(() => resolve('late'), graceMs)))
      if ((await Promise.race([closed, late])) === 'late') {
        server.closeAllConnections()
        await closed
      }
      clearTimeout(timer)
      await store.close()
    })())
  return { server, shutdown }
}

/**
 * A signal's handler: shut down, then exit 0. A failed shutdown logs only its error class (never the message, which
 * could carry a path or data) and exits 1.
 */
export const stopOnSignal = (running: Pick<Running, 'shutdown'>, exit: (code: number) => void = (code) => process.exit(code)) =>
  running.shutdown().then(
    () => exit(0),
    (err: unknown) => {
      console.error(`[app] shutdown failed ${err instanceof Error ? err.constructor.name : typeof err}`)
      exit(1)
    },
  )
