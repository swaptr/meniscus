/**
 * Deploy preflight (CI, before anything is sent to Render): proves every production dependency is reachable with the
 * configured values, and fails early with a line that names what is wrong.
 *
 *   pnpm --filter @meniscus/server preflight
 *
 * Checks, in order, each once, no retries:
 *   1. configuration parses (the server's own rules: URLs, sslmode, CA file, S3 settings);
 *   2. Postgres: one connection on DATABASE_URL (and DATABASE_SESSION_URL when set), `select 1`, TLS verified with
 *      DATABASE_CA_FILE;
 *   3. media bucket: one HeadBucket, as the server's start check does;
 *   4. Meta Model API key: one `GET /models` (a listing, not a generation; the key works and the models are enabled).
 * Logs names, hosts and statuses only; never a URL with its password, a key or a secret.
 */
import { sql } from 'drizzle-orm'
import type { Config } from '../src/config.ts'

let failed = 0
const ok = (what: string) => console.log(`ok    ${what}`)
const fail = (what: string, why: string) => {
  failed++
  console.log(`FAIL  ${what}: ${why}`)
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

let config: Config
try {
  ;({ config } = await import('../src/config.ts'))
  ok('configuration')
} catch (e) {
  fail('configuration', message(e))
  process.exit(1)
}
// Loaded after the configuration check: these modules read the configuration when they load.
const { MODELS, metaClient } = await import('../src/model-api.ts')
const { createDb, dbErrorCode } = await import('../src/db/client.ts')
const { bucketCheck } = await import('../src/start-checks.ts')
const { createMediaStore } = await import('../src/store/media/create.ts')

const host = (url: string) => {
  const u = new URL(url)
  return `${u.username.split('.')[0] ?? ''}@${u.hostname}:${u.port || '5432'}`
}

const urls = [['DATABASE_URL', config.DATABASE_URL]] as [string, string | undefined][]
if (config.DATABASE_SESSION_URL !== undefined && config.DATABASE_SESSION_URL !== config.DATABASE_URL) {
  urls.push(['DATABASE_SESSION_URL', config.DATABASE_SESSION_URL])
}
for (const [name, url] of urls) {
  if (url === undefined) {
    fail(name, 'not set')
    continue
  }
  const handle = createDb({ url, caFile: config.DATABASE_CA_FILE, max: 1 })
  try {
    await handle.db.execute(sql`select 1`)
    ok(`${name} (${host(url)}, TLS verified)`)
  } catch (e) {
    fail(`${name} (${host(url)})`, `${dbErrorCode(e)} ${message(e)}`.trim())
  } finally {
    await handle.close()
  }
}

if (config.MEDIA_STORE === 's3') {
  try {
    await bucketCheck(config, createMediaStore(config))
    ok(`bucket ${config.S3_BUCKET} (${config.S3_ENDPOINT ? new URL(config.S3_ENDPOINT).host : ''})`)
  } catch (e) {
    fail('bucket', message(e))
  }
} else {
  fail('bucket', `MEDIA_STORE is ${config.MEDIA_STORE}, production needs s3`)
}

try {
  const ids = new Set((await metaClient().models.list({})).map((m) => m.id))
  const missing = Object.values(MODELS).filter((id) => !ids.has(id))
  if (missing.length) fail('Meta Model API', `key works, but not enabled for this team: ${missing.join(', ')}`)
  else ok(`Meta Model API (${Object.values(MODELS).join(', ')} enabled)`)
} catch (e) {
  fail('Meta Model API', message(e))
}

console.log(failed ? `preflight: ${failed} check(s) failed` : 'preflight: all checks passed')
process.exit(failed ? 1 : 0)
