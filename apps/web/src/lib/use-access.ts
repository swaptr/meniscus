import { useEffect, useState, useSyncExternalStore } from 'react'
import type { WardSummary } from '@meniscus/shared'
import { accessGrants, needsReason } from './rota.ts'
import { useStaff } from './use-staff.ts'

/** This device's break-the-glass grants (localStorage `meniscus.access`). */
export const grants = accessGrants(typeof localStorage === 'undefined' ? null : localStorage)

/** True while `wardId` (null: not known yet) needs a reason from the signed-in person this shift (re-read each minute). */
export function useNeedsReason(wardId: number | null): boolean {
  const staff = useStaff()
  const now = useNow(60_000)
  // The answer itself is the snapshot: a value computed beside the store would be memoised (React Compiler) and miss a grant.
  return useSyncExternalStore(grants.subscribe, () => wardId !== null && staff !== null && needsReason(wardId, staff, now, grants))
}

/** Ward names seen on the ward list, so the reason dialog can name a ward it has not loaded (it loads nothing first). */
const wardNames = new Map<number, string>()
export const rememberWards = (wards: readonly WardSummary[]) => {
  for (const w of wards) wardNames.set(w.id, w.name)
}
export const wardName = (wardId: number) => wardNames.get(wardId) ?? null

/** The time, re-read every `ms` (no request): shift-bound lines update while a page stays open. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
