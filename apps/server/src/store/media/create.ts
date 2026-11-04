/** The configured media store (server/storage): `s3` (the bucket) or `memory`. */
import type { Config } from '../../config.ts'
import { createMemoryMediaStore } from './memory.ts'
import type { MediaStore } from './port.ts'
import { createS3MediaStore, type S3MediaOptions } from './s3.ts'

type MediaConfig = Pick<
  Config,
  'MEDIA_STORE' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'
>

export function createMediaStore(c: MediaConfig, o: Pick<S3MediaOptions, 'fetch' | 'timeoutSignal'> = {}): MediaStore {
  if (c.MEDIA_STORE === 'memory') return createMemoryMediaStore()
  // parseConfig has checked these are set for s3.
  return createS3MediaStore({
    endpoint: c.S3_ENDPOINT!,
    region: c.S3_REGION!,
    bucket: c.S3_BUCKET,
    accessKeyId: c.S3_ACCESS_KEY_ID!,
    secretAccessKey: c.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: c.S3_FORCE_PATH_STYLE,
    ...o,
  })
}
