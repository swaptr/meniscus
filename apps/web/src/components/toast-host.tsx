import { lazy, Suspense, useSyncExternalStore } from 'react'
import { onToastsRequested, toastsRequested } from '../lib/toast.ts'

const ToastViewport = lazy(() => import('./toast.tsx').then((m) => ({ default: m.ToastViewport })))

/** Mounted once by the app shell; loads the toast viewport on the first `flash()` so the shell stays light. */
export function ToastHost() {
  const requested = useSyncExternalStore(onToastsRequested, toastsRequested, () => false)
  return requested ? (
    <Suspense fallback={null}>
      <ToastViewport />
    </Suspense>
  ) : null
}
