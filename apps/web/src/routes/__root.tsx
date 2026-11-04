import { createRootRoute, Outlet, type ErrorComponentProps } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell.tsx'
import { ErrorIcon, NotFoundIcon } from '../components/icons.tsx'
import { NOT_FOUND, ROUTE_ERROR } from '../lib/screens.ts'
import { Placeholder } from '../components/placeholder.tsx'
import { SessionGate } from '../components/session-gate.tsx'

export const Route = createRootRoute({
  // Every route, /a and /n alike, waits for sign-in.
  component: () => (
    <SessionGate>
      <AppShell>
        <Outlet />
      </AppShell>
    </SessionGate>
  ),
  notFoundComponent: NotFound,
  errorComponent: RouteError,
})

function NotFound() {
  return (
    <Placeholder
      icon={NotFoundIcon}
      title={NOT_FOUND.title}
      description={NOT_FOUND.description}
      action={{ label: 'Go to Capture', to: '/a' }}
    />
  )
}

function RouteError({ reset }: ErrorComponentProps) {
  return (
    <Placeholder
      icon={ErrorIcon}
      title={ROUTE_ERROR.title}
      description={ROUTE_ERROR.description}
      action={{ label: 'Try again', onClick: reset }}
    />
  )
}
