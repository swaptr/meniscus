import { useState, useSyncExternalStore } from 'react'
import { createPeekController, PEEK_CLOSE_DELAY, PEEK_DELAY, type PeekController, type PeekState } from '../lib/peek.ts'

export interface PopoverList<P> {
  ctl: PeekController
  state: PeekState
  /** Trigger id → its button, the open popup's anchor and focus-return target. */
  triggers: Map<string, HTMLElement>
  /** Trigger id → its payload. */
  payloads: Map<string, P>
}

/** One per list: its triggers share one popup. `delay`/`closeDelay` default to the peek's 400/150 ms. */
export function usePopoverList<P>(delay = PEEK_DELAY, closeDelay = PEEK_CLOSE_DELAY): PopoverList<P> {
  const [ctl] = useState(() => createPeekController(undefined, delay, closeDelay))
  const [triggers] = useState(() => new Map<string, HTMLElement>())
  const [payloads] = useState(() => new Map<string, P>())
  const state = useSyncExternalStore(ctl.subscribe, ctl.get)
  return { ctl, state, triggers, payloads }
}
