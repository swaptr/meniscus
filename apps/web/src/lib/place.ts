/**
 * What the app bar names (DESIGN.md 4.2): the h1 for the place (`Medical Ward 3A`, `Bed 5 · 3A`) and the breadcrumb.
 * Routes set it after their own load; without one the route's static title stands. No request.
 */
import { useEffect, useSyncExternalStore } from 'react'

export interface Crumb {
  label: string
  href: string
}
export interface Place {
  title: string
  crumbs: readonly Crumb[]
}

let current: Place | null = null
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
const get = () => current

/** The app bar's place, or null for the route's static title. */
export const usePlaceTitle = (): Place | null => useSyncExternalStore(subscribe, get)

/** A route names its place while mounted. Pass null until its load knows the name. */
export function usePlace(place: Place | null): void {
  const key = place ? `${place.title}|${place.crumbs.map((c) => `${c.label}>${c.href}`).join('|')}` : ''
  useEffect(() => {
    if (!place) return
    current = place
    emit()
    return () => {
      if (current === place || (current && current.title === place.title)) {
        current = null
        emit()
      }
    }
    // The key captures the place's content; the object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
