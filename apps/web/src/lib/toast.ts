/**
 * Result toasts (DESIGN.md 5.3; web/interface "Results in one toast"), the pure part: one at a time, a new one replacing
 * the shown one; a success polite for 6 s, a failure assertive until dismissed.
 */
import { ApiError } from './api.ts'

export type ToastTone = 'ok' | 'info' | 'warn' | 'danger'
export interface ToastInput {
  text: string
  tone?: ToastTone
}

export const TOAST_MS = 6000
export const TOAST_LIMIT = 1

export function toastOptions({ text, tone = 'ok' }: ToastInput) {
  const sticky = tone === 'danger'
  return {
    title: text,
    type: tone,
    timeout: sticky ? 0 : TOAST_MS,
    priority: sticky ? ('high' as const) : ('low' as const),
  }
}

/** The queue rule in isolation: only the newest result is shown. */
export function toastQueue() {
  let list: ToastInput[] = []
  return {
    push: (t: ToastInput) => {
      list = [...list, t].slice(-TOAST_LIMIT)
    },
    shown: () => list,
  }
}

// ---------- flash(): the one way to show a result; the Base UI viewport loads on the first call (DESIGN.md 10, D9) ----------

type Sink = (t: ToastInput) => void
let sink: Sink | null = null
const pending: ToastInput[] = []
let requested = false
const listeners = new Set<() => void>()

/** Show a result. Before the viewport has loaded, it is held and shown once it mounts (only the newest is kept). */
export function flash(t: ToastInput): void {
  if (sink) return sink(t)
  pending.splice(0, pending.length, t)
  if (!requested) {
    requested = true
    for (const l of listeners) l()
  }
}

/** The viewport attaches here when it mounts. */
export function attachToasts(s: Sink): () => void {
  sink = s
  for (const t of pending.splice(0)) s(t)
  return () => {
    if (sink === s) sink = null
  }
}

export const toastsRequested = () => requested
export function onToastsRequested(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * A refusal the server answered about what was sent (400, 403, 409, 422) stays inline in the dialog, form or section
 * that sent it; anything else (server unreachable, 5xx, signed out) is a toast.
 */
export const isRefusal = (err: unknown): boolean => err instanceof ApiError && [400, 403, 409, 422].includes(err.status)

/** Where a failure is shown: inline beside what sent it, or in the toast. */
export const failureGoesTo = (err: unknown): 'inline' | 'toast' => (isRefusal(err) ? 'inline' : 'toast')
