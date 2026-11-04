import { useCallback, useEffect, useRef, useState } from 'react'

export type ApiStatus = 'checking' | 'ok' | 'down'

const POLL_MS = 30_000
const TIMEOUT_MS = 5_000

// Polls only while the calling screen is mounted and not `paused` (the lock); `check` forces a recheck.
export function useApiStatus(paused = false): { status: ApiStatus; check: () => void } {
  const [status, setStatus] = useState<ApiStatus>('checking')
  const checkRef = useRef<() => void>(() => {})
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    let controller: AbortController | undefined

    const check = () => {
      if (!navigator.onLine) return setStatus('down')
      controller?.abort()
      const c = (controller = new AbortController())
      // Manual timeout: AbortSignal.any/timeout need Safari 17.4+, targets include 16.4.
      const timeout = setTimeout(() => c.abort(), TIMEOUT_MS)
      fetch('/api/health', { signal: c.signal })
        .then((r) => controller === c && setStatus(r.ok ? 'ok' : 'down'))
        // Ignore failures of a check superseded by a newer one; timeouts count as down.
        .catch(() => controller === c && setStatus('down'))
        .finally(() => clearTimeout(timeout))
    }
    const onVisible = () => document.visibilityState === 'visible' && !pausedRef.current && check()
    const offline = () => setStatus('down')

    checkRef.current = check
    check()
    const timer = setInterval(() => document.visibilityState === 'visible' && !pausedRef.current && check(), POLL_MS)
    window.addEventListener('online', check)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      const c = controller
      controller = undefined
      c?.abort()
      clearInterval(timer)
      window.removeEventListener('online', check)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const check = useCallback(() => checkRef.current(), [])
  return { status, check }
}
