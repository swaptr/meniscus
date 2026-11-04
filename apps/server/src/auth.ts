/**
 * Staff credentials and session tokens (`node:crypto` only). Passwords and tokens are never logged or stored in clear.
 * OIDC single sign-on or a badge tap would replace `verifyCredentials` and the sign-in screen, nothing else.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { StaffRef } from '@meniscus/shared'
import { DEMO_PASSWORD_HASHES } from './store/demo-passwords.ts'
import type { Store } from './store/port.ts'

interface Params {
  N: number
  r: number
  p: number
}
/** N = 2^15: below OWASP's 2^17, chosen so a sign-in stays fast on a small demo server. Stored in each hash. */
const PARAMS: Params = { N: 32768, r: 8, p: 1 }
const SALT_BYTES = 16
const KEY_BYTES = 32
/** The most work a stored hash may ask for; beyond it, the hash counts as malformed (the dummy runs, then 401). */
const MAX_N = 2 ** 20
const MAX_R = 16
const MAX_P = 4
/** 128 · N · r bytes of scrypt memory. */
const MAX_MEM = 64 * 1024 * 1024

/** scrypt needs about 128 · N · r bytes; Node refuses exactly its 32 MiB default at N = 2^15, so allow twice that. */
const derive = (password: string, salt: Buffer, { N, r, p }: Params) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_BYTES, { N, r, p, maxmem: 2 * 128 * N * r }, (err, key) => (err ? reject(err) : resolve(key))),
  )

/** `scrypt$N=32768,r=8,p=1$<salt>$<key>`, base64url, with a fresh 16-byte salt. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, PARAMS)
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

interface Parsed {
  params: Params
  salt: Buffer
  key: Buffer
}
const B64URL = /^[A-Za-z0-9_-]+$/

/** Null for anything but a well-formed hash: wrong prefix, parameters beyond the caps, or salt or key length. */
function parse(hash: string): Parsed | null {
  const [prefix, params, salt, key, ...rest] = hash.split('$')
  const m = /^N=(\d{1,8}),r=(\d{1,2}),p=(\d{1,2})$/.exec(params ?? '')
  if (prefix !== 'scrypt' || !m || rest.length || !salt || !key || !B64URL.test(salt) || !B64URL.test(key)) return null
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (N < 2 || N > MAX_N || (N & (N - 1)) !== 0 || r < 1 || r > MAX_R || p < 1 || p > MAX_P || 128 * N * r > MAX_MEM) return null
  const s = Buffer.from(salt, 'base64url')
  const k = Buffer.from(key, 'base64url')
  if (s.length !== SALT_BYTES || k.length !== KEY_BYTES) return null
  return { params: { N, r, p }, salt: s, key: k }
}

/** Checked in place of a missing or malformed hash, so every refusal costs one scrypt run. */
const DUMMY = parse('scrypt$N=32768,r=8,p=1$6qh9tFg1PKM7ofSq79-xig$e6WfhhbCo1Hpv7PeIKLpT8sEzp-sa0un7L19srSb4iA')!

/** One scrypt run against `hash` (the dummy when it does not parse); lengths are equal before `timingSafeEqual`. */
export async function passwordMatches(hash: string | null, password: string): Promise<boolean> {
  const parsed = hash === null ? null : parse(hash)
  const target = parsed ?? DUMMY
  const key = await derive(password, target.salt, target.params)
  return timingSafeEqual(key, target.key) && parsed !== null
}

/**
 * The one credential check: sign-in, unlock and break-the-glass. An unknown username, a member with no or a malformed
 * hash, a wrong password, and (with demo sign-in off) a demo password all get null, after the same scrypt work.
 */
export async function verifyCredentials(
  store: Store,
  username: string,
  password: string,
  { demoLogin }: { demoLogin: boolean },
): Promise<StaffRef | null> {
  const c = await store.credentials(username)
  const ok = await passwordMatches(c?.password_hash ?? null, password)
  if (!c || !ok) return null
  if (!demoLogin && c.password_hash === DEMO_PASSWORD_HASHES[c.staff.id]) return null
  return c.staff
}

/** 32 random bytes, base64url (43 characters). */
export const newToken = () => randomBytes(32).toString('base64url')
/** Only this is stored. */
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
