/**
 * Dev-only: the app over a fake Model API, for browser checks. No `.env` is read, and nothing leaves 127.0.0.1.
 *
 *   pnpm --filter @meniscus/server fake                       # a fresh in-process Postgres (PGlite), gone on exit
 *   DATABASE_URL=postgresql://… pnpm --filter @meniscus/server fake   # that database, migrated first
 *
 * Before anything imports `src/config.ts`, the Model API base URL and key are overridden (whatever the shell has), so
 * `GET /api/ai/status`, which calls the live client, reaches port 9 on loopback and is refused.
 */
process.env.MODEL_API_BASE_URL = 'http://127.0.0.1:9/v1'
process.env['MODEL_API_' + 'KEY'] = 'fake'

const { config } = await import('../src/config.ts')
const { createDb, migrateDb } = await import('../src/db/client.ts')
const { openPgStore } = await import('../src/store/pg/store.ts')
const { startFakeServer } = await import('../src/lab/fake-server.ts')

async function open() {
  const url = config.DATABASE_URL
  if (url === undefined) {
    const { createTestDb } = await import('../src/db/testing.ts')
    const h = await createTestDb()
    return openPgStore(h.db, { close: () => h.close() })
  }
  await migrateDb({ url: config.DATABASE_SESSION_URL ?? url, caFile: config.DATABASE_CA_FILE })
  const h = createDb({ url, caFile: config.DATABASE_CA_FILE, max: config.DATABASE_POOL_MAX })
  return openPgStore(h.db, { close: () => h.close() })
}

const store = await open()
const server = startFakeServer(store)
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => server.close(() => void store.close().then(() => process.exit(0))))
}
