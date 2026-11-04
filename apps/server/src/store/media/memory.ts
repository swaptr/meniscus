/**
 * The in-process media store: a Map, for tests and quick development runs (`MEDIA_STORE=memory`). Its objects are gone
 * when the process ends while their rows remain, so reads of them answer 503 after a restart.
 */
import { MediaStoreError, type MediaObject, type MediaOp, type MediaStore } from './port.ts'

export interface MemoryObject {
  bytes: Uint8Array
  mime: string
  lastModified: number
}

export interface MemoryMediaStore extends MediaStore {
  readonly kind: 'memory'
  /** By hash. Tests read and age them. */
  readonly objects: Map<string, MemoryObject>
  /** Every operation called, in order. */
  readonly calls: MediaOp[]
  /** Fault injection: an operation listed here throws MediaStoreError with this status. */
  readonly fail: Partial<Record<MediaOp, number | 'timeout' | 'network'>>
}

export function createMemoryMediaStore({ now = Date.now }: { now?: () => number } = {}): MemoryMediaStore {
  const objects = new Map<string, MemoryObject>()
  const calls: MediaOp[] = []
  const fail: MemoryMediaStore['fail'] = {}
  /** Records the call, then answers it (or throws the injected fault) on a later microtask, as a store would. */
  const call = async <T>(op: MediaOp, answer: () => T): Promise<T> => {
    calls.push(op)
    await Promise.resolve()
    const status = fail[op]
    if (status !== undefined) throw new MediaStoreError(op, status)
    return answer()
  }
  return {
    kind: 'memory',
    objects,
    calls,
    fail,
    put: (sha256, bytes, mime) => call('put', () => void objects.set(sha256, { bytes: bytes.slice(), mime, lastModified: now() })),
    get: (sha256) =>
      call('get', (): MediaObject => {
        const o = objects.get(sha256)
        if (!o) throw new MediaStoreError('get', 404)
        const bytes = o.bytes.slice()
        return {
          size: bytes.byteLength,
          body: new ReadableStream({
            start(c) {
              c.enqueue(bytes)
              c.close()
            },
          }),
        }
      }),
    delete: (sha256) => call('delete', () => void objects.delete(sha256)),
    head: (sha256) =>
      call('head', () => {
        const o = objects.get(sha256)
        return o && { lastModified: o.lastModified }
      }),
    check: () => call('head-bucket', () => undefined),
    list: async function* () {
      const listed = await call('list', () => [...objects])
      for (const [sha256, o] of listed) yield { sha256, lastModified: o.lastModified }
    },
  }
}
