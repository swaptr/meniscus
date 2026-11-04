import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// Muse Spark rejects "none" (HTTP 400); "max" is unavailable on *-contributor models.
const Effort = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/**
 * A model id, refused in contributor mode (`*-contributor`, any case): Meta may train on its content,
 * and it is rejected under zero data retention (server/security "No contributor models").
 * https://dev.meta.ai/docs/models, https://dev.meta.ai/help/policies-and-privacy/zero-data-retention
 */
const modelId = (name: string, fallback: string) =>
  z
    .string()
    .refine((v) => !/-contributor$/i.test(v), `${name} must not be a contributor-mode model`)
    .default(fallback)

const Env = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  /** Interface to listen on. Loopback unless deliberately exposed. */
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8787),
  /**
   * Proxies in front of the server whose `X-Forwarded-For` / `X-Forwarded-Proto` entries are trusted (server/security
   * "Trusted proxy hops"). 0: none (direct). 1 on Render.
   */
  TRUST_PROXY_HOPS: z.coerce
    .number('TRUST_PROXY_HOPS must be an integer 0–3')
    .int('TRUST_PROXY_HOPS must be an integer 0–3')
    .min(0, 'TRUST_PROXY_HOPS must be an integer 0–3')
    .max(3, 'TRUST_PROXY_HOPS must be an integer 0–3')
    .default(0),
  /** The web build to serve outside /api (server/hosting). Default: apps/web/dist, resolved from this file, not the cwd. */
  WEB_DIST: z
    .string()
    .min(1)
    .default(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  /** How long in-flight requests may run after SIGTERM before their connections are closed (server/hosting). */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(0).max(120_000).default(25_000),
  /**
   * The chart's Postgres (server/storage "Database connection settings"): request traffic, Supavisor transaction mode
   * (6543) on Supabase. Server-only; never logged (`redactUrl`). Required by the server and its scripts (they exit without it); tests
   * never read it.
   */
  DATABASE_URL: z.string().optional(),
  /** Migrations (and later LISTEN or a queue worker): a session connection, never port 6543. Default DATABASE_URL. */
  DATABASE_SESSION_URL: z.string().optional(),
  /** PEM CA for `sslmode=verify-full` (Supabase's, from the dashboard); Node's root CAs are trusted too. */
  DATABASE_CA_FILE: z.string().min(1).optional(),
  DATABASE_POOL_MAX: z.coerce
    .number('DATABASE_POOL_MAX must be an integer 1–20')
    .int('DATABASE_POOL_MAX must be an integer 1–20')
    .min(1, 'DATABASE_POOL_MAX must be an integer 1–20')
    .max(20, 'DATABASE_POOL_MAX must be an integer 1–20')
    .default(5),
  /** Per-client /api/ai/* requests per rolling minute (and, separately, password checks). */
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  MODEL_API_KEY: z.string().min(1).optional(),
  MODEL_API_BASE_URL: z.url().default('https://api.meta.ai/v1'),
  MODEL_API_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  /** Hard cap on upstream requests per process per rolling hour. Exceeding it fails fast. */
  MODEL_API_MAX_REQUESTS_PER_HOUR: z.coerce.number().int().positive().default(120),
  /**
   * Max upstream requests in flight at once. At least 2: a `sam+spark` read holds 2 in-flight slots (its two SAM
   * requests run together), so with 1 no such read could ever be admitted (capture/read-budget).
   */
  MODEL_API_MAX_CONCURRENT: z.coerce.number().int().min(2, 'MODEL_API_MAX_CONCURRENT must be at least 2').default(4),
  /**
   * Percent of the hourly cap kept for critical beds (capture/read-budget "Critical reserve"): routine actions stop at
   * the cap less this share, rounded down (84 of 120 at 30). Integer 0–90.
   */
  CRITICAL_RESERVE_PCT: z.coerce.number().int().min(0).max(90, 'CRITICAL_RESERVE_PCT must be 0–90').default(30),
  /**
   * Percent of the hourly cap in use from which a `sam+spark` photo or tray read for a stable bed, or for no bed, runs in
   * `spark` mode with 1 request (capture/read-budget "Reads under budget pressure"). Integer 1–100.
   */
  BUDGET_PRESSURE_PCT: z.coerce
    .number()
    .int('BUDGET_PRESSURE_PCT must be an integer 1–100')
    .min(1, 'BUDGET_PRESSURE_PCT must be 1–100')
    .max(100, 'BUDGET_PRESSURE_PCT must be 1–100')
    .default(50),
  SPARK_MODEL: modelId('SPARK_MODEL', 'muse-spark-1.3'),
  SAM_MODEL: modelId('SAM_MODEL', 'sam-3.1'),
  ASR_MODEL: modelId('ASR_MODEL', 'muse-voice-transcribe-1.0'),
  SPARK_READ_EFFORT: Effort.default('medium'),
  SPARK_NOTE_EFFORT: Effort.default('low'),
  /** Run SAM before Spark on capture reads unless the request says otherwise. */
  READ_USE_SAM: z.stringbool().default(true),
  /** Tray reads: SAM dish + food before Spark (3 requests) unless the request says otherwise; false: Spark only (1). */
  MEAL_USE_SAM: z.stringbool().default(true),
  /** Demo staff may sign in with their first name, and the sign-in screen lists them. Always on outside production. */
  MENISCUS_DEMO_LOGIN: z.stringbool().default(false),
  /** Where media bytes live (server/storage): `s3` (required in production) or `memory` (tests, quick runs). */
  MEDIA_STORE: z.enum(['s3', 'memory']).optional(),
  /** S3-compatible endpoint: the local Supabase stack (`pnpm dev:s3`) or `https://<ref>.storage.supabase.co/storage/v1/s3`. */
  S3_ENDPOINT: z.url('S3_ENDPOINT must be a URL').optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).default('meniscus-media'),
  /** Server-only; never logged. */
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
})

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])
const S3_REQUIRED = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const

/** A database URL's scheme, host and port only: the one form a URL may take in a log line or an error. */
export const redactUrl = (url: string) => {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return 'an unparseable URL'
  }
}

type DbVar = 'DATABASE_URL' | 'DATABASE_SESSION_URL'
/**
 * server/storage "Database connection settings" and "Session connection". Messages are built from the variable's name
 * and fixed words, never from its value, so a password never reaches an error.
 */
function checkDatabase(e: z.infer<typeof Env>, ctx: z.core.$RefinementCtx) {
  const issue = (path: DbVar | 'DATABASE_CA_FILE', message: string) => ctx.addIssue({ code: 'custom', path: [path], message })
  const parse = (name: DbVar): URL | undefined => {
    const value = e[name]
    if (value === undefined) return undefined
    let u: URL
    try {
      u = new URL(value)
    } catch {
      issue(name, `${name} must be a postgres:// or postgresql:// URL`)
      return undefined
    }
    if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
      issue(name, `${name} must be a postgres:// or postgresql:// URL`)
      return undefined
    }
    if (!LOOPBACK.has(u.hostname) && u.searchParams.get('sslmode') !== 'verify-full') {
      issue(name, `${name} names a remote host: it needs sslmode=verify-full (and DATABASE_CA_FILE)`)
    }
    return u
  }
  const url = parse('DATABASE_URL')
  const session = parse('DATABASE_SESSION_URL') ?? (e.DATABASE_SESSION_URL === undefined ? url : undefined)
  if (session?.port === '6543') {
    issue(
      'DATABASE_SESSION_URL',
      'DATABASE_SESSION_URL (default DATABASE_URL) must not be port 6543, Supavisor transaction mode: migrations need a session (5432)',
    )
  }
  const remote = [url, session].some((u) => u !== undefined && !LOOPBACK.has(u.hostname))
  if (remote && e.DATABASE_CA_FILE === undefined) issue('DATABASE_CA_FILE', 'DATABASE_CA_FILE is required for a remote database host')
  if (e.DATABASE_CA_FILE !== undefined && !existsSync(e.DATABASE_CA_FILE)) {
    issue('DATABASE_CA_FILE', 'DATABASE_CA_FILE must name a readable PEM file')
  }
}

/** server/storage "Media store settings" and "Production media store"; resolves MEDIA_STORE's default. */
const Checked = Env.superRefine((e, ctx) => {
  checkDatabase(e, ctx)
  const prod = e.NODE_ENV === 'production'
  if (prod && e.MEDIA_STORE !== 's3') {
    ctx.addIssue({ code: 'custom', path: ['MEDIA_STORE'], message: 'MEDIA_STORE must be s3 in production' })
    return
  }
  if (e.MEDIA_STORE !== 's3') return
  const missing = S3_REQUIRED.filter((k) => e[k] === undefined)
  if (missing.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['MEDIA_STORE'],
      message: `MEDIA_STORE=s3 needs ${missing.join(', ')} (run pnpm dev:s3 and copy its S3 values into .env)`,
    })
  }
  if (prod && e.S3_ENDPOINT !== undefined) {
    const u = new URL(e.S3_ENDPOINT)
    if (u.protocol !== 'https:' && !LOOPBACK.has(u.hostname)) {
      ctx.addIssue({ code: 'custom', path: ['S3_ENDPOINT'], message: 'S3_ENDPOINT must be https:// in production (or a loopback host)' })
    }
  }
}).transform((e) => ({ ...e, MEDIA_STORE: e.MEDIA_STORE ?? 'memory' }))

export type Config = z.infer<typeof Checked>
export type ReasoningEffort = z.infer<typeof Effort>

/** Pure: a bad value throws with every problem listed. */
export function parseConfig(env: Record<string, string | undefined>): Config {
  // `KEY=` (as copied from .env.example) means unset, not an empty value.
  const parsed = Checked.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/** The app's sign-in flags: demo sign-in outside production (or when allowed), and `Secure` cookies in production. */
export const appFlags = (c: Config) => ({
  demoLogin: c.NODE_ENV !== 'production' || c.MENISCUS_DEMO_LOGIN,
  secureCookie: c.NODE_ENV === 'production',
})

/** Requests per hour a routine (normal-priority) action or script may use: the cap less the critical reserve. */
export const routineCeiling = (c: Pick<Config, 'MODEL_API_MAX_REQUESTS_PER_HOUR' | 'CRITICAL_RESERVE_PCT'>) =>
  c.MODEL_API_MAX_REQUESTS_PER_HOUR - Math.floor((c.MODEL_API_MAX_REQUESTS_PER_HOUR * c.CRITICAL_RESERVE_PCT) / 100)

/** Parsed once at startup; fails fast. */
export const config: Config = parseConfig(process.env)
