/**
 * Who is signed in on this device, from the server's session (an `HttpOnly` cookie this code never sees).
 * States: `checking` (the opening `GET /api/session`), `signed_out`, `signed_in` and `locked` (idle, or a 401 mid-work:
 * the screen stays mounted behind the lock). No model requests; nothing is ever retried.
 */
import { STAFF_ROLES, type DemoAccount, type Staff, type StaffRole } from '@meniscus/shared'
import { api as appApi, ApiError, bindSession, errorText, type Api } from './api.ts'
import { firstName, ROLE_LABEL } from './staff.ts'
import { unsaved as appUnsaved, type Unsaved } from './unsaved.ts'

export const RECENT_KEY = 'meniscus.recent'
export const LOCKED_KEY = 'meniscus.locked'
export const MAX_RECENT = 4
export const WRONG_CREDENTIALS = 'Wrong username or password'
export const WRONG_PASSWORD = 'Wrong password'

/** Someone who signed in here: never a password or token. */
export interface Person {
  username: string
  name: string
  role: StaffRole
}

export type SessionStatus = 'checking' | 'signed_out' | 'signed_in' | 'locked'
export interface SessionState {
  status: SessionStatus
  /** The signed-in person (also while locked). */
  staff: Staff | null
  /** Whose lock covers the screen. */
  locked: Person | null
  /** For the sign-in screen, from `GET /api/session`'s 401; null until known. */
  hospital: string | null
  demo_accounts: DemoAccount[]
  /** The opening check could not reach the server. */
  error: string | null
}

export type SignInResult = { ok: true } | { ok: false; error: string }

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
type SessionApi = Pick<Api, 'session' | 'signIn' | 'signOut'>

export const personLabel = (p: Pick<Person, 'name' | 'role'>) => `${p.name} · ${ROLE_LABEL[p.role]}`
export const lockLine = (p: Pick<Person, 'name' | 'role'>) => `Locked · ${personLabel(p)}`
/** "Switch user" asks this first when work is unsaved; null when it can go straight on. */
export const switchQuestion = (staff: Pick<Staff, 'name'> | null, hasUnsaved: boolean) =>
  staff && hasUnsaved ? `${firstName(staff.name)}'s unsaved draft will be discarded` : null

function parsePerson(v: unknown): Person | null {
  if (typeof v !== 'object' || v === null) return null
  const p = v as Partial<Person>
  if (typeof p.username !== 'string' || typeof p.name !== 'string' || !(STAFF_ROLES as readonly unknown[]).includes(p.role)) return null
  return { username: p.username, name: p.name, role: p.role! }
}

export function createSession({ api, storage, unsaved = appUnsaved }: { api: SessionApi; storage: Storage | null; unsaved?: Unsaved }) {
  const read = (key: string): unknown => {
    try {
      const raw = storage?.getItem(key)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  }
  const write = (key: string, value: unknown) => {
    try {
      if (value === null) storage?.removeItem(key)
      else storage?.setItem(key, JSON.stringify(value))
    } catch {
      // Private mode or full storage: it lasts for this page only.
    }
  }
  const recent = (): Person[] => {
    const list = read(RECENT_KEY)
    return Array.isArray(list) ? list.map(parsePerson).filter((p): p is Person => p !== null) : []
  }

  let state: SessionState = { status: 'checking', staff: null, locked: null, hospital: null, demo_accounts: [], error: null }
  /** The signed-in person's username, for the lock. Not in `Staff`: known from sign-in, or from "Recent". */
  let username: string | null = null
  const listeners = new Set<() => void>()
  const set = (patch: Partial<SessionState>) => {
    state = { ...state, ...patch }
    for (const l of listeners) l()
  }

  const signedIn = (staff: Staff, name: string) => {
    // Someone else signing in over a lock that had forgotten whose it was: nothing unsaved carries over to them (the
    // screen behind remounts too, keyed by the signed-in id).
    if (state.staff && state.staff.id !== staff.id) unsaved.clear()
    username = name
    const me: Person = { username: name, name: staff.name, role: staff.role }
    write(RECENT_KEY, [me, ...recent().filter((p) => p.username !== name)].slice(0, MAX_RECENT))
    write(LOCKED_KEY, null)
    set({ status: 'signed_in', staff, locked: null, error: null })
  }

  const signIn = async (name: string, password: string, wrong = WRONG_CREDENTIALS): Promise<SignInResult> => {
    const user = name.trim()
    try {
      const { staff } = await api.signIn({ username: user, password })
      signedIn(staff, user)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof ApiError && err.code === 'invalid_credentials' ? wrong : errorText(err) }
    }
  }

  const session = {
    get: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => void listeners.delete(fn)
    },
    /** For `X-Staff-Id`: also while locked, so a save already in flight keeps its name. */
    staffId: () => state.staff?.id ?? null,
    /** The signed-in person's username when this device knows it (for password managers), else ''. */
    username: () => username ?? '',
    recent,

    /** The opening request: one `GET /api/session`. A 401 signs out (never locks) and drops a stale lock. */
    async check(signal?: AbortSignal) {
      try {
        const r = await api.session(signal)
        if ('staff' in r) {
          const lock = parsePerson(read(LOCKED_KEY))
          username = lock?.username ?? recent().find((p) => p.name === r.staff.name && p.role === r.staff.role)?.username ?? null
          set({ status: lock ? 'locked' : 'signed_in', staff: r.staff, locked: lock, error: null })
        } else {
          username = null
          write(LOCKED_KEY, null)
          set({ status: 'signed_out', staff: null, locked: null, hospital: r.hospital, demo_accounts: r.demo_accounts, error: null })
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        set({ status: 'signed_out', staff: null, locked: null, error: errorText(err) })
      }
    },

    /** One `POST /api/session`. A wrong username or password gets the same answer. */
    signIn: (name: string, password: string) => signIn(name, password),

    /** Sign in afresh as the locked person: works whether or not their session ended meanwhile. */
    unlock: (password: string) => signIn(state.locked?.username ?? username ?? '', password, WRONG_PASSWORD),

    lock() {
      if (state.status !== 'signed_in' || !state.staff) return
      const me: Person = { username: username ?? '', name: state.staff.name, role: state.staff.role }
      write(LOCKED_KEY, me)
      set({ status: 'locked', locked: me })
    },

    /** A 401 `sign_in_required` from anywhere but `/api/session`: lock over the work, only when signed in. */
    expired(path: string) {
      if (path.startsWith('/api/session')) return
      session.lock()
    },

    /** One `DELETE /api/session`, then the sign-in screen; unsaved work goes with the screens. A network error signs out here. */
    async switchUser() {
      let out = true
      try {
        await api.signOut()
      } catch {
        out = false
      }
      unsaved.clear()
      username = null
      write(LOCKED_KEY, null)
      set({ status: 'signed_out', staff: null, locked: null })
      // Opened signed in, the sign-in screen has no hospital or demo accounts yet: the opening check fetches them.
      if (out && state.hospital === null) await session.check()
    },
  }
  return session
}

export type Session = ReturnType<typeof createSession>

/** Sign-in form state, shared by the sign-in screen and the lock. */
export interface SignInFormState {
  username: string
  password: string
  error: string | null
  /** Where focus goes next. */
  focus: 'username' | 'password' | null
}
export type SignInFormAction =
  { type: 'username' | 'password'; value: string } | { type: 'pick'; username: string } | { type: 'failed'; error: string }

export const emptySignInForm: SignInFormState = { username: '', password: '', error: null, focus: null }

/** Picking a recent or demo account fills the username and moves to the password; a failure keeps the username only. */
export function signInForm(f: SignInFormState, a: SignInFormAction): SignInFormState {
  switch (a.type) {
    case 'username':
      return { ...f, username: a.value, error: null, focus: null }
    case 'password':
      return { ...f, password: a.value, error: null, focus: null }
    case 'pick':
      return { username: a.username, password: '', error: null, focus: 'password' }
    case 'failed':
      return { ...f, password: '', error: a.error, focus: 'password' }
  }
}

/** The app's session, bound to the app's API (its `X-Staff-Id` and 401s). */
export const session = createSession({ api: appApi, storage: typeof localStorage === 'undefined' ? null : localStorage })
bindSession({ staffId: () => session.staffId(), expired: (path) => session.expired(path) })
// The opening `GET /api/session`, once per page load (a hot update in development makes a new session, checked afresh).
if (typeof window !== 'undefined') void session.check()
