/**
 * Where media bytes live (server/storage): one object per distinct content, keyed by its SHA-256. The database keeps
 * only metadata. Every operation is one request to the store, never retried.
 */

export interface MediaObject {
  body: ReadableStream<Uint8Array>
  size: number
}

export type MediaOp = 'put' | 'get' | 'head' | 'delete' | 'head-bucket' | 'list'

/** A failed store request. Carries only the operation and the status, never a key, hash, body or credential. */
export class MediaStoreError extends Error {
  // Declared fields, not parameter properties: Node type stripping (erasableSyntaxOnly).
  readonly op: MediaOp
  readonly status: number | 'timeout' | 'network'
  constructor(op: MediaOp, status: number | 'timeout' | 'network') {
    super(`media ${op} ${status}`)
    this.name = 'MediaStoreError'
    this.op = op
    this.status = status
  }
}

export interface MediaStore {
  readonly kind: 's3' | 'memory'
  /** Idempotent by content: the key is the hash, so the same key always carries the same bytes. */
  put(sha256: string, bytes: Uint8Array, mime: string): Promise<void>
  /** Streams the object. Throws MediaStoreError (404 included: a row without its object is an integrity fault). */
  get(sha256: string): Promise<MediaObject>
  /** An absent object is not an error. */
  delete(sha256: string): Promise<void>
  /** media:sweep only: one HeadObject; undefined when the object is absent. */
  head(sha256: string): Promise<{ lastModified: number } | undefined>
  /** One HeadBucket. */
  check(): Promise<void>
  /** media:sweep only: ListObjectsV2 pages of our objects (`<sha256[0:2]>/<sha256>`); other keys are skipped. */
  list(): AsyncIterable<{ sha256: string; lastModified: number }>
}

/** The object key of a content hash. */
export const objectKey = (sha256: string) => `${sha256.slice(0, 2)}/${sha256}`

/** Our keys only: `<2 hex>/<64 hex>` whose prefix is the hash's own. */
export const shaOfKey = (key: string): string | undefined => {
  const m = /^([0-9a-f]{2})\/([0-9a-f]{64})$/.exec(key)
  return m && m[2]!.startsWith(m[1]!) ? m[2] : undefined
}

/** The whole object, read into memory (the seed, the served-photo comparison and tests; routes stream instead). */
export const readAll = async (obj: MediaObject): Promise<Uint8Array> => new Uint8Array(await new Response(obj.body).arrayBuffer())
