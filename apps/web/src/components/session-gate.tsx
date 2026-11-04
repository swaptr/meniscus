import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { IDLE_LOCK_MS } from '@meniscus/shared'
import { createIdleTimer } from '../lib/idle.ts'
import { session } from '../lib/session.ts'
import { landingPath, LOGIN, signedOutRoute } from '../lib/staff.ts'
import { useSession } from '../lib/use-staff.ts'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { BrandMark } from './brand-mark.tsx'
import { lockCover } from './lock.styles.ts'

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
// Not needed once signed in (a reload with a live session skips it), so they load on their own.
const Landing = lazy(() => import('./landing.tsx').then((m) => ({ default: m.Landing })))
const SignIn = lazy(() => import('./sign-in.tsx').then((m) => ({ default: m.SignIn })))
// Only after idle time or a lapsed session, so it loads then (the service worker has it cached); its cover shows at once.
const Lock = lazy(() => import('./lock.tsx').then((m) => ({ default: m.Lock })))

/**
 * Every route sits behind sign-in: one `GET /api/session` on opening. Signed out, `/` is the landing page, `/login` the
 * sign-in screen, and any other URL redirects to `/login?next=<it>` (so a deep link opens after). Signed in, the
 * routes, under the lock when idle or when the session ended.
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const state = useSession()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const href = useRouterState({ select: (s) => s.location.href })
  const next = useRouterState({ select: (s) => (s.location.search as { next?: unknown }).next })
  const [idleMs, setIdleMs] = useState(IDLE_LOCK_MS)

  // Signed in, `/` and `/login` open `next` (a path on this site) or the role's landing page; any other URL opens as asked.
  const role = state.status === 'signed_in' ? state.staff?.role : undefined
  const nextPath = typeof next === 'string' ? next : null
  useEffect(() => {
    if (!role || (pathname !== '/' && pathname !== LOGIN)) return
    void navigate({ href: landingPath(pathname, { role }, nextPath), replace: true })
  }, [role, pathname, nextPath, navigate])

  // Signed out, any URL but `/` and `/login` goes to sign-in, keeping itself as `next`.
  const out = state.status === 'signed_out' ? signedOutRoute(pathname, href) : null
  const redirectNext = out && 'redirect' in out ? out.redirect.next : null
  useEffect(() => {
    if (redirectNext !== null) void navigate({ to: LOGIN, search: { next: redirectNext }, replace: true })
  }, [redirectNext, navigate])

  // The idle lock: input anywhere resets it; a read in flight does not.
  const signedIn = state.status === 'signed_in'
  useEffect(() => {
    if (!signedIn) return
    const idle = createIdleTimer({ ms: idleMs, onIdle: () => session.lock() })
    const touch = () => idle.touch()
    for (const e of ACTIVITY) window.addEventListener(e, touch, { capture: true, passive: true })
    return () => {
      idle.stop()
      for (const e of ACTIVITY) window.removeEventListener(e, touch, { capture: true })
    }
  }, [signedIn, idleMs])

  // Development only: shorten the idle time from the console (`__meniscusIdleMs(5000)`) to see the lock sooner.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    Object.assign(window, { __meniscusIdleMs: setIdleMs })
  }, [])

  // `/` and `/login` show at once, while the check is pending or failed; a live session then moves on (effect above).
  if (state.status === 'checking') {
    if (pathname !== '/' && pathname !== LOGIN) return <Splash />
    return <Suspense fallback={<Splash />}>{pathname === '/' ? <Landing /> : <SignIn />}</Suspense>
  }
  if (out) {
    if ('redirect' in out) return <Splash />
    return <Suspense fallback={<Splash />}>{out.show === 'landing' ? <Landing /> : <SignIn />}</Suspense>
  }
  const locked = state.status === 'locked'
  return (
    <>
      {/* Always this wrapper, so locking never remounts the screen (drafts and readings live in it); someone else
          signing in over the lock gets a fresh one. */}
      <div key={state.staff?.id} inert={locked} aria-hidden={locked || undefined} {...stylex.props(s.contents)}>
        {children}
      </div>
      {locked && state.locked && (
        <Suspense fallback={<LockCover />}>
          <Lock person={state.locked} />
        </Suspense>
      )}
    </>
  )
}

/** The lock's opaque cover alone, while its code loads: nothing of the screen behind shows meanwhile. */
function LockCover() {
  return createPortal(<div {...stylex.props(lockCover.cover)} />, document.body)
}

function Splash() {
  return (
    <div role="status" aria-live="polite" {...stylex.props(s.splash)}>
      <BrandMark markOnly size="lg" />
      <span>Checking sign-in…</span>
    </div>
  )
}

const s = stylex.create({
  contents: { display: 'contents' },
  splash: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    minHeight: '100dvh',
    backgroundColor: color.canvas,
    color: color.muted,
    fontSize: text.sm,
    fontWeight: weight.semibold,
  },
})
