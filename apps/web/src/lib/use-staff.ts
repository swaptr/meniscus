import { useSyncExternalStore } from 'react'
import type { Staff } from '@meniscus/shared'
import { session, type SessionState } from './session.ts'

/** The app's session state; re-renders when it changes. */
export const useSession = (): SessionState => useSyncExternalStore(session.subscribe, session.get)

/** Who is signed in on this device (also while locked). */
export const useStaff = (): Staff | null => useSession().staff
