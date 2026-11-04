/**
 * Unsaved work on this device: the capture draft, the meal form and ward round readings hold while they have any.
 * Only "Switch user" asks about it; the idle lock keeps everything as it is.
 */
export function createUnsaved() {
  const holds = new Set<object>()
  return {
    /** Returns the release. */
    hold(): () => void {
      const key = {}
      holds.add(key)
      return () => void holds.delete(key)
    },
    has: () => holds.size > 0,
    /** Switching user discards it with the screens that held it. */
    clear: () => holds.clear(),
  }
}

export type Unsaved = ReturnType<typeof createUnsaved>

export const unsaved = createUnsaved()
export const holdUnsaved = () => unsaved.hold()
export const hasUnsaved = () => unsaved.has()
