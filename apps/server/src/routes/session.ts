/** Sign-in and sessions (POST, GET and DELETE /api/session). No model requests; nothing here is logged. */
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { TEAM_ROLES, type DemoAccount, type SessionInfo, type SignInRequired } from '@meniscus/shared'
import { newToken, tokenHash, verifyCredentials } from '../auth.ts'
import { DEMO_STAFF, DEMO_TEAMS, HOSPITAL_NAME } from '../store/demo-hospital.ts'
import { requestProtocol } from '../security.ts'
import type { Store } from '../store/port.ts'
import { invalidCredentials, SESSION_COOKIE, smallJson, type Env } from './common.ts'
import { validate } from './validate.ts'

// zod issues carry paths and messages, never the values.
const SessionBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) }).strict()

export interface SessionOptions {
  /** List the demo accounts and accept demo passwords. */
  demoLogin: boolean
  /** Mark the cookie `Secure` (production). Over HTTPS (`requestProtocol`) it is marked anyway. */
  secureCookie: boolean
  /** Proxies whose `X-Forwarded-Proto` is trusted (server/security "Forwarded protocol"). */
  trustProxyHops: number
}

/** Home ward first; only TEAM_ROLES have one. */
const demoAccounts = (): DemoAccount[] =>
  DEMO_STAFF.map((s) => ({
    username: s.username,
    name: s.name,
    role: s.role,
    ward: TEAM_ROLES.includes(s.role) ? (DEMO_TEAMS[s.id]?.[0] ?? null) : null,
  }))

export function sessionRoutes(store: Store, { demoLogin, secureCookie, trustProxyHops }: SessionOptions) {
  const secure = (c: Context) => secureCookie || requestProtocol(c, trustProxyHops) === 'https'
  const cookie = (c: Context) => ({ httpOnly: true, sameSite: 'Strict', path: '/api', secure: secure(c) }) as const
  return new Hono<Env>()
    .post('/session', smallJson(), validate('json', SessionBody), async (c) => {
      const { username, password } = c.req.valid('json')
      const ref = await verifyCredentials(store, username, password, { demoLogin })
      const staff = ref && (await store.member(ref.id))
      if (!staff) return c.json(invalidCredentials, 401)
      // Rotation: signing in or unlocking ends the session of any cookie presented.
      const old = getCookie(c, SESSION_COOKIE)
      if (old) await store.endSession(tokenHash(old))
      const token = newToken()
      await store.createSession(tokenHash(token), staff.id)
      setCookie(c, SESSION_COOKIE, token, cookie(c))
      return c.json({ staff } satisfies SessionInfo, 201)
    })
    .get('/session', (c) => {
      const staff = c.get('staff')
      if (staff) return c.json({ staff } satisfies SessionInfo)
      const body: SignInRequired = {
        error: 'sign_in_required',
        hospital: HOSPITAL_NAME,
        demo_accounts: demoLogin ? demoAccounts() : [],
      }
      return c.json(body, 401)
    })
    .delete('/session', async (c) => {
      // Idempotent, and needs no session: any cookie's row goes, live or not.
      const token = getCookie(c, SESSION_COOKIE)
      if (token) await store.endSession(tokenHash(token))
      deleteCookie(c, SESSION_COOKIE, { path: '/api', secure: secure(c) })
      return c.body(null, 204)
    })
}
