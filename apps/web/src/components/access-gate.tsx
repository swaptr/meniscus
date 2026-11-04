import { lazy, Suspense, type ReactNode } from 'react'
import { useNeedsReason } from '../lib/use-access.ts'

// The dialog loads only when a ward needs a reason, which is rare.
const ReasonDialog = lazy(() => import('./reason-dialog.tsx').then((m) => ({ default: m.ReasonDialog })))

/**
 * Break-the-glass: a ward outside the signed-in person's wards shows nothing but this dialog (its children are not
 * rendered, so they load nothing) until one `POST /api/wards/:id/access` accepts a reason and their password.
 * Then it opens for the rest of the shift, for that person on this device. "Cancel" sends nothing.
 */
export function AccessGate({
  wardId,
  wardName,
  fallback,
  children,
}: {
  wardId: number
  wardName: string | null
  /** Where Cancel goes with no page to go back to: `/n` by default. */
  fallback?: '/n' | '/d'
  children: ReactNode
}) {
  const needed = useNeedsReason(wardId)
  if (!needed) return children
  return (
    <Suspense fallback={null}>
      <ReasonDialog wardId={wardId} wardName={wardName} {...(fallback && { fallback })} />
    </Suspense>
  )
}
