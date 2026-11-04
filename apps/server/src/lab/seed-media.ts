/**
 * Media for seed scripts (`scripts/demo-history.ts`): each row is added as the script builds the chart (it runs
 * on its own store, with no server beside it), and its object is written to the configured media store
 * by `flush`, once per distinct content, under the hash's lock, before the script reports success.
 */
import type { MediaRef } from '@meniscus/shared'
import { sha256Hex } from '../hash.ts'
import type { MediaStore } from '../store/media/port.ts'
import type { MediaInput, Store } from '../store/port.ts'

export type SeedInput = Omit<MediaInput, 'sha256' | 'size'> & { bytes: Uint8Array }

export interface SeedMedia {
  /** The row now (undefined for an unknown admission); its object at `flush`. */
  keep(admissionId: number, input: SeedInput, staffId?: number | null): Promise<MediaRef | undefined>
  /** Writes every kept object (one PUT per distinct content); returns how many. Rejects on the first failure. */
  flush(): Promise<number>
}

export function seedMedia(store: Pick<Store, 'addMedia' | 'withShaLock'>, media: MediaStore): SeedMedia {
  const pending = new Map<string, { bytes: Uint8Array; mime: string }>()
  return {
    keep: async (admissionId, input, staffId = null) => {
      const { bytes, ...rest } = input
      const sha256 = sha256Hex(bytes)
      const ref = await store.addMedia(admissionId, { ...rest, sha256, size: bytes.byteLength }, staffId)
      if (ref) pending.set(sha256, { bytes, mime: input.mime })
      return ref
    },
    flush: async () => {
      let n = 0
      for (const [sha256, o] of pending) {
        await store.withShaLock(sha256, () => media.put(sha256, o.bytes, o.mime))
        pending.delete(sha256)
        n++
      }
      return n
    },
  }
}
