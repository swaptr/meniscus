/**
 * pnpm --filter @meniscus/server media:sweep [--delete]
 *
 * Counts (and with --delete removes) the media store's objects that no media row names and that are over an hour
 * old. Reads `meniscus.media` on `DATABASE_URL` (no migration, no seed, no writes), so it can run beside the live
 * server. 0 model requests.
 */
import { config, redactUrl } from '../src/config.ts'
import { createDb, dbErrorCode } from '../src/db/client.ts'
import { mediaShas, sweepMedia } from '../src/lab/media-sweep.ts'
import { createMediaStore } from '../src/store/media/create.ts'
import { MediaStoreError } from '../src/store/media/port.ts'

if (config.MEDIA_STORE !== 's3') {
  console.error('media:sweep needs MEDIA_STORE=s3 (a memory store holds nothing between runs)')
  process.exit(1)
}
if (config.DATABASE_URL === undefined) {
  console.error('media:sweep needs DATABASE_URL (run pnpm dev:stack for a local Postgres)')
  process.exit(1)
}
const handle = createDb({ url: config.DATABASE_URL, caFile: config.DATABASE_CA_FILE, max: 1 })
const store = mediaShas(handle.db)
try {
  const r = await sweepMedia({ store, media: createMediaStore(config), delete: process.argv.includes('--delete') })
  console.log(r.line)
  process.exitCode = r.failed ? 1 : 0
} catch (err) {
  // A media store error carries its op and status only; a database error is logged as its code, never its message.
  const why =
    err instanceof MediaStoreError ? err.message.split('\n')[0] : `database at ${redactUrl(config.DATABASE_URL)}: ${dbErrorCode(err)}`
  console.error(`media:sweep failed: ${why}`)
  process.exitCode = 1
} finally {
  await handle.close()
}
