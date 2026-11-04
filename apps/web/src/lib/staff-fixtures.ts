/** Test fixtures: the demo hospital's fictional staff with their wards, and a fake session server. Not imported by the app. */
import { TEAM_ROLES, type DemoAccount, type SessionInfo, type SignInRequired, type Staff, type StaffRole } from '@meniscus/shared'
import { createApi } from './api.ts'
import { createSession, type Session } from './session.ts'
import { createUnsaved } from './unsaved.ts'

/** Ward ids as the demo hospital seeds them. */
export const WARD = { '2C': { id: 1, code: '2C' }, '3A': { id: 2, code: '3A' }, '5B': { id: 3, code: '5B' }, HDU: { id: 4, code: 'HDU' } }
type Code = keyof typeof WARD

const person = (id: number, name: string, role: StaffRole, wards: Code[]): Staff => ({ id, name, role, wards: wards.map((c) => WARD[c]) })
export const RAVI = person(1, 'Ravi Kumar', 'attendant', ['3A', '2C'])
export const SUNITA = person(2, 'Sunita Devi', 'attendant', ['3A'])
export const MOHAN = person(3, 'Mohan Das', 'attendant', ['5B', '2C'])
export const ANITA = person(4, 'Anita Thomas', 'nurse', ['3A', '5B'])
export const GRACE = person(5, 'Grace Lee', 'nurse', ['5B', '3A'])
export const MEERA = person(6, 'Meera Pillai', 'nurse', ['2C', '3A'])
export const NIKHIL = person(7, 'Nikhil Bose', 'nurse', ['HDU'])
export const DIVYA = person(8, 'Divya Kapoor', 'nurse', ['HDU'])
export const REKHA = person(9, 'Rekha Gupta', 'attendant', ['2C'])
export const LAKSHMI = person(10, 'Lakshmi Iyer', 'matron', ['2C', '3A', '5B', 'HDU'])
export const SANA = person(11, 'Sana Mirza', 'dietitian', ['2C', '3A', '5B', 'HDU'])
export const ROSTER = [RAVI, SUNITA, MOHAN, ANITA, GRACE, MEERA, NIKHIL, DIVYA, REKHA, LAKSHMI, SANA]
/** A second dietitian, covering 3A only: not in the demo roster (charting/nutrition tests add him). */
export const JOEL = person(12, 'Joel Mathew', 'dietitian', ['3A'])

/** Demo usernames are the lowercase first name; so are the demo passwords. */
export const username = (s: Staff) => s.name.split(' ')[0]!.toLowerCase()

/** What GET /api/session lists with demo sign-in on, in roster order. */
export const DEMO_ACCOUNTS: DemoAccount[] = ROSTER.map((s) => ({
  username: username(s),
  name: s.name,
  role: s.role,
  ward: TEAM_ROLES.includes(s.role) ? s.wards[0]!.code : null,
}))

export function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial))
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

export interface Seen {
  req: string
  staff: string | null
  body: Record<string, unknown> | null
}

/**
 * A fake server with a session cookie, and the app's session over it. `live` is who the cookie signs in (null: none or
 * ended). Every request other than to /api/session without a live session gets 401 `sign_in_required`, reads
 * included, as the server does (server/security "Signed-in reads").
 * `routes` answer everything else by "METHOD path" (a regex).
 */
export function fakeServer({
  live = null,
  demo = true,
  routes = {},
  storage = memory(),
}: {
  live?: Staff | null
  demo?: boolean
  routes?: Record<string, (body: Record<string, unknown> | null) => Response>
  storage?: ReturnType<typeof memory>
} = {}) {
  const seen: Seen[] = []
  const server = { live }
  const app: { session?: Session } = {}
  const api = createApi(
    (url, init) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      const req = `${method} ${url}`
      seen.push({ req, staff: new Headers(init?.headers).get('x-staff-id'), body })
      const json = (b: unknown, status = 200) => Promise.resolve(Response.json(b, { status }))
      if (url === '/api/session') {
        if (method === 'GET') {
          if (server.live) return json({ staff: server.live } satisfies SessionInfo)
          const out: SignInRequired = {
            error: 'sign_in_required',
            hospital: 'Meniscus Demo Hospital',
            demo_accounts: demo ? DEMO_ACCOUNTS : [],
          }
          return json(out, 401)
        }
        if (method === 'DELETE') {
          server.live = null
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        const who = ROSTER.find((s) => username(s) === body?.username && username(s) === body.password)
        if (!who) return json({ error: 'invalid_credentials' }, 401)
        server.live = who
        return json({ staff: who } satisfies SessionInfo, 201)
      }
      if (!server.live) return json({ error: 'sign_in_required' }, 401)
      const hit = Object.entries(routes).find(([k]) => new RegExp(`^${k}$`).test(req))
      return hit ? Promise.resolve(hit[1](body)) : json({ error: 'not_found' }, 404)
    },
    () => app.session!.staffId(),
    (path) => app.session!.expired(path),
  )
  const unsaved = createUnsaved()
  const session = (app.session = createSession({ api, storage, unsaved }))
  return { api, session, seen, server, storage, unsaved, reqs: () => seen.map((s) => s.req) }
}
