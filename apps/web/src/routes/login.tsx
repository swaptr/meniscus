import { createFileRoute } from '@tanstack/react-router'

/**
 * The sign-in page (web/staff "Sign-in page"). The session gate draws the sign-in screen here while signed out, and
 * sends a signed-in person on to `next` (when it is a path on this site) or their landing page.
 */
export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => (typeof search.next === 'string' ? { next: search.next } : {}),
  component: () => null,
})
