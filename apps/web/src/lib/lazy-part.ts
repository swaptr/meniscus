import { lazy, type ComponentType } from 'react'

/**
 * One named export of a lazily loaded module, typed as the export itself, so generic components keep their type
 * parameters. Render it inside a `Suspense` whose fallback reserves the part's height (DESIGN.md 10; design.md D9).
 */
export function lazyPart<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  return lazy(() => load().then((m) => ({ default: m[name] as unknown as ComponentType<object> }))) as unknown as M[K]
}
