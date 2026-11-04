/**
 * pnpm db:migrate: applies the committed migrations (`drizzle/`) to `DATABASE_SESSION_URL` (default `DATABASE_URL`),
 * under the same advisory lock the server takes at start. 0 model requests; prints no URL.
 */
import { config, redactUrl } from '../src/config.ts'
import { dbErrorCode, migrateDb } from '../src/db/client.ts'

const url = config.DATABASE_SESSION_URL ?? config.DATABASE_URL
if (url === undefined) {
  console.error('db:migrate needs DATABASE_URL (run pnpm dev:stack for a local Postgres)')
  process.exit(1)
}
try {
  await migrateDb({ url, caFile: config.DATABASE_CA_FILE })
  console.log(`db:migrate: up to date at ${redactUrl(url)}`)
} catch (err) {
  console.error(`db:migrate failed at ${redactUrl(url)}: ${dbErrorCode(err)}`)
  process.exitCode = 1
}
