import { useSyncExternalStore } from 'react'

/** Whether a media query matches now, re-rendering when it changes. False where `matchMedia` is missing. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      if (typeof matchMedia !== 'function') return () => {}
      const m = matchMedia(query)
      m.addEventListener('change', fn)
      return () => m.removeEventListener('change', fn)
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false),
  )
}
