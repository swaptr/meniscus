/**
 * The checks before the server listens (server/hosting, server/storage), with no side effects of their own, so tests
 * import this file and never `index.ts` (which opens the store and listens). In order: the web build (production),
 * one HeadBucket (`MEDIA_STORE=s3`), then the deletes for media rows that expired when the store opened.
 */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import type { Config } from './config.ts'
import { createMediaGc, type MediaLog } from './media-gc.ts'
import { MediaStoreError, type MediaStore } from './store/media/port.ts'
import type { Store } from './store/port.ts'

type StartConfig = Pick<Config, 'NODE_ENV' | 'WEB_DIST' | 'MEDIA_STORE' | 'S3_ENDPOINT' | 'S3_BUCKET'>

/** server/hosting "Production needs the web build": without it the host's health check would pass on a server with no UI. */
export const webBuildCheck = async (webDist: string) => {
  const index = join(webDist, 'index.html')
  await access(index).catch(() => {
    throw new Error(`WEB_DIST: no web build at ${index}; run pnpm build`)
  })
}

/** The cause in words, from the bucket check's status. Never the keys or the endpoint's path. */
const cause = (err: unknown) => {
  if (!(err instanceof MediaStoreError)) return 'unreachable'
  if (err.status === 404) return 'not found'
  if (err.status === 401 || err.status === 403 || err.status === 400) return 'keys refused'
  if (err.status === 'timeout' || err.status === 'network') return 'unreachable'
  return `answered ${err.status}`
}

/** server/storage "Bucket checked at start": one HeadBucket; a failure names the bucket, the endpoint's host and the cause. */
export async function bucketCheck(config: StartConfig, media: MediaStore) {
  try {
    await media.check()
  } catch (err) {
    const host = config.S3_ENDPOINT ? new URL(config.S3_ENDPOINT).host : 'the endpoint'
    const hint = config.NODE_ENV === 'production' ? '' : ' (run pnpm dev:s3)'
    // The cause carries only the operation and status (MediaStoreError), never a key.
    throw new Error(`media store: bucket ${config.S3_BUCKET} ${cause(err)} at ${host}${hint}`, { cause: err })
  }
}

/**
 * The `beforeListen` of `startServer`. `goneOnOpen`: hashes of the media rows expired when the store opened; their
 * objects are deleted (when no row names them) after the bucket check.
 */
export function startChecks(
  config: StartConfig,
  media: MediaStore,
  store: Pick<Store, 'withShaLock'>,
  goneOnOpen: readonly string[] = [],
  log: MediaLog = (line) => console.error(line),
): () => Promise<void> {
  return async () => {
    if (config.NODE_ENV === 'production') await webBuildCheck(config.WEB_DIST)
    if (config.MEDIA_STORE === 's3') await bucketCheck(config, media)
    else if (config.NODE_ENV !== 'test') {
      log('[server] MEDIA_STORE=memory: media is lost when the server stops (set MEDIA_STORE=s3; run pnpm dev:s3)')
    }
    if (goneOnOpen.length) await createMediaGc(store, media, log).collect(goneOnOpen)
  }
}
