import { useCallback, useEffect, useRef, useState } from 'react'
import { createPoll } from './poll.ts'
import { useSession } from './use-staff.ts'

export type Resource<T> = {
  data: T | undefined
  error: unknown
  loading: boolean
  reload: () => void
  /** Replace the data with a response already in hand (a PUT's answer), with no request. */
  set: (data: T) => void
}

type Done<T> = { key: string; tick: number; data?: T; error?: unknown }

/**
 * Loads `load` on mount and when `key` changes; `reload` refetches (keeping the old data meanwhile).
 * Aborts superseded loads. Local API only (no model requests): `pollMs` refreshes while the tab is visible, except while
 * `paused` or the app is locked.
 */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  pollMs?: number,
  { paused = false }: { paused?: boolean } = {},
): Resource<T> {
  const [done, setDone] = useState<Done<T> | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  const locked = useSession().status === 'locked'
  const pausedRef = useRef(paused || locked)
  useEffect(() => {
    pausedRef.current = paused || locked
  }, [paused, locked])

  useEffect(() => {
    const c = new AbortController()
    load(c.signal).then(
      (data) => !c.signal.aborted && setDone({ key, tick, data }),
      (error: unknown) => !c.signal.aborted && setDone((d) => ({ key, tick, data: d?.key === key ? d.data : undefined, error })),
    )
    return () => c.abort()
    // `load` is recreated each render; `key` + `tick` decide when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick])

  useEffect(() => {
    if (!pollMs) return
    return createPoll({ ms: pollMs, paused: () => pausedRef.current, visible: () => document.visibilityState === 'visible', tick: reload })
  }, [pollMs, reload])

  const same = done?.key === key
  return {
    data: same ? done.data : undefined,
    error: same ? done.error : undefined,
    loading: !same || done.tick !== tick,
    reload,
    set: (data: T) => setDone({ key, tick, data }),
  }
}
