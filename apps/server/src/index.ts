/**
 * The server process: config → migrations (session URL) → store (the DATABASE_URL pool) → media store → app →
 * `startServer` (the start checks: the web build in production, then the bucket) → signal handlers (server/hosting,
 * server/storage). Production runs this file with plain `node` (type stripping); development through tsx.
 */
import { existsSync } from 'node:fs'
import { createApp } from './app.ts'
import { appFlags, config, redactUrl } from './config.ts'
import { createDb, dbErrorCode, migrateDb, TablesOpen, tablesClosedCheck } from './db/client.ts'
import { startServer, stopOnSignal } from './serve.ts'
import { startChecks } from './start-checks.ts'
import { createMediaStore } from './store/media/create.ts'
import { openPgStore } from './store/pg/store.ts'

// charting/entries "Persistent store": the chart lives in Postgres only, never a local file.
if (config.DATABASE_URL === undefined) {
  console.error('[server] start failed: DATABASE_URL is not set (run pnpm dev:stack for a local Postgres, then set it in .env)')
  process.exit(1)
}
const dbUrl = config.DATABASE_URL

// The migrations run first, on the session URL (never 6543, server/storage "Session connection").
const sessionUrl = config.DATABASE_SESSION_URL ?? dbUrl
try {
  await migrateDb({ url: sessionUrl, caFile: config.DATABASE_CA_FILE })
} catch (err) {
  console.error(`[server] start failed: database migrations at ${redactUrl(sessionUrl)}: ${dbErrorCode(err)}`)
  process.exit(1)
}

const db = createDb({ url: dbUrl, caFile: config.DATABASE_CA_FILE, max: config.DATABASE_POOL_MAX })
// server/storage "Tables closed to Supabase's APIs": RLS on every table, nothing granted to the API roles.
try {
  await tablesClosedCheck(db.db)
} catch (err) {
  // The check's own message names only tables and roles; a database error is logged as its code.
  const why = err instanceof TablesOpen ? err.message : `database at ${redactUrl(dbUrl)}: ${dbErrorCode(err)}`
  console.error(`[server] start failed: ${why}`)
  await db.close()
  process.exit(1)
}
// Media rows expired on open: their objects are deleted after the bucket check, before listening.
let goneOnOpen: string[] | undefined = []
let store
try {
  store = await openPgStore(db.db, { close: () => db.close(), onMediaGone: (shas) => goneOnOpen?.push(...shas) })
} catch (err) {
  console.error(`[server] start failed: database at ${redactUrl(dbUrl)}: ${dbErrorCode(err)}`)
  await db.close()
  process.exit(1)
}
const opened = goneOnOpen
goneOnOpen = undefined
const media = createMediaStore(config)
export const app = createApp({
  media,
  store,
  rateLimitPerMinute: config.AI_RATE_LIMIT_PER_MINUTE,
  trustProxyHops: config.TRUST_PROXY_HOPS,
  // Outside production a missing build only means paths outside /api are 404 (server/hosting).
  webDist: existsSync(config.WEB_DIST) ? config.WEB_DIST : undefined,
  ...appFlags(config),
})
export type AppType = typeof app

try {
  const running = await startServer({
    fetch: app.fetch,
    store,
    host: config.HOST,
    port: config.PORT,
    graceMs: config.SHUTDOWN_GRACE_MS,
    beforeListen: startChecks(config, media, store, opened),
  })
  const port = (running.server.address() as { port: number }).port
  console.log(`meniscus server on http://${config.HOST}:${port}`)
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void stopOnSignal(running))
  }
} catch (err) {
  console.error(`[server] start failed: ${err instanceof Error ? err.message : String(err)}`)
  await store.close()
  process.exit(1)
}
