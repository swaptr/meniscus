import type { Entry } from '@meniscus/shared'

/**
 * What rejecting the entry does to its source, for the reject sheet and the message after it. A level drop's photos
 * belong to the levels and stay (a bag's to its readings); a recording goes once no other entry from the same note links it.
 */
export function rejectSourceText(e: Pick<Entry, 'media' | 'levels'>): { before: string; after: string } | null {
  if (!e.media || e.levels) return null
  return e.media.kind === 'photo'
    ? { before: 'Its photo is deleted.', after: 'Its photo was deleted.' }
    : {
        before: 'Its recording is deleted once no other entry from it remains.',
        after: 'Its recording is deleted once no other entry from it remains.',
      }
}
