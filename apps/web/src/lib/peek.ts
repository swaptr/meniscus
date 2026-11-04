/**
 * When a peek opens and closes (web/interface "Peeks open by hover, tap and keyboard", DESIGN.md 5.1). DOM-free, so the
 * rules are tested with fake timers; `components/peek.tsx` drives a controlled Base UI Popover from it.
 *
 * - A fine pointer resting 400 ms on a trigger opens it; leaving before then opens nothing.
 * - It closes 150 ms after the pointer leaves both the trigger and the peek (so the pointer can travel into it).
 * - A tap, click, Enter or Space opens it pinned (a second press on the same trigger closes it).
 * - Focus alone never opens one: a Tab sweep over 25 rows must not fetch 25 photos.
 * - Escape or a press outside closes it; one peek is open at a time.
 */

export const PEEK_DELAY = 400
export const PEEK_CLOSE_DELAY = 150
/** Up to this width a peek opens as a bottom sheet with a Close button. */
export const SHEET_MAX = 640

export const peekMode = (width: number): 'sheet' | 'float' => (width <= SHEET_MAX ? 'sheet' : 'float')

/** Base UI's change reasons that may open a peek; `trigger-focus` never does. */
export const opensOn = (reason: string): boolean => reason === 'trigger-press' || reason === 'trigger-hover'

export interface PeekState {
  /** The open trigger's id, or null. */
  open: string | null
  /** Opened by a press or key, so pointer travel does not close it. */
  pinned: boolean
}

export interface Timers {
  set: (fn: () => void, ms: number) => unknown
  clear: (t: unknown) => void
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
}

export function createPeekController(timers: Timers = realTimers, delay = PEEK_DELAY, closeDelay = PEEK_CLOSE_DELAY) {
  let state: PeekState = { open: null, pinned: false }
  const listeners = new Set<() => void>()
  let openTimer: unknown = null
  let closeTimer: unknown = null
  let overTrigger: string | null = null
  let overPeek = false

  const set = (next: PeekState) => {
    if (next.open === state.open && next.pinned === state.pinned) return
    state = next
    for (const l of listeners) l()
  }
  const clearOpen = () => {
    if (openTimer !== null) timers.clear(openTimer)
    openTimer = null
  }
  const clearClose = () => {
    if (closeTimer !== null) timers.clear(closeTimer)
    closeTimer = null
  }
  const scheduleClose = () => {
    clearClose()
    if (state.open === null || state.pinned) return
    closeTimer = timers.set(() => {
      closeTimer = null
      if (overTrigger !== state.open && !overPeek) set({ open: null, pinned: false })
    }, closeDelay)
  }

  return {
    get: (): PeekState => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    /** Pointer enters a trigger. Touch and pen taps arrive as `press`. */
    enter(id: string, pointerType: string) {
      overTrigger = id
      if (pointerType !== 'mouse') return
      clearOpen()
      if (state.open === id) return clearClose()
      // Moving between triggers of an open hover peek swaps it at once (no close and reopen).
      if (state.open !== null && !state.pinned) {
        clearClose()
        return set({ open: id, pinned: false })
      }
      openTimer = timers.set(() => {
        openTimer = null
        if (overTrigger === id && !state.pinned) set({ open: id, pinned: false })
      }, delay)
    },
    leave(id: string) {
      if (overTrigger === id) overTrigger = null
      clearOpen()
      if (state.open === id) scheduleClose()
    },
    enterPeek() {
      overPeek = true
      clearClose()
    },
    leavePeek() {
      overPeek = false
      scheduleClose()
    },
    /** A tap, click, Enter or Space on a trigger. */
    press(id: string) {
      clearOpen()
      clearClose()
      if (state.open === id && state.pinned) return set({ open: null, pinned: false })
      set({ open: id, pinned: true })
    },
    /** Focus never opens a peek. */
    focus(_id: string) {},
    /** Escape, a press outside, the Close button. */
    close() {
      clearOpen()
      clearClose()
      overPeek = false
      set({ open: null, pinned: false })
    },
  }
}

export type PeekController = ReturnType<typeof createPeekController>
