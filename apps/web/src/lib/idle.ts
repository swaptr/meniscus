/**
 * Calls `onIdle` once `ms` pass with no `touch()` (pointerdown, keydown, wheel, touchstart). One timer, re-armed only
 * when it fires early; a touch after it fired arms it again. Work in flight does not count: unlocking resumes it.
 */
export function createIdleTimer({ ms, now = () => Date.now(), onIdle }: { ms: number; now?: () => number; onIdle: () => void }) {
  let last = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (delay: number) => {
    timer = setTimeout(check, delay)
  }
  function check() {
    timer = undefined
    const left = last + ms - now()
    if (left > 0) return arm(left)
    onIdle()
  }
  arm(ms)
  return {
    touch() {
      last = now()
      if (timer === undefined) arm(ms)
    },
    stop() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}

export type IdleTimer = ReturnType<typeof createIdleTimer>
