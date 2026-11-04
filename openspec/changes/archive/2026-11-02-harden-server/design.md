# Design

## Config (`apps/server/src/config.ts`)

```ts
export function parseConfig(env: Record<string, string | undefined>): Config // pure, testable
export const config = parseConfig(process.env)

// new keys
HOST: string                       // default '127.0.0.1'
NODE_ENV: 'development' | 'production' | 'test'  // default 'development'
MENISCUS_API_TOKEN?: string          // min 32 chars when set; required when NODE_ENV=production
AI_RATE_LIMIT_PER_MINUTE: number   // default 20
```

## App (`apps/server/src/app.ts`)

```ts
export interface AppOptions { ai?: Ai; apiToken?: string; rateLimitPerMinute?: number; now?: () => number }
export function createApp(o?: AppOptions)
```

Middleware order, all in `src/security.ts` (owned by the server; no package changes):

1. `secureHeaders` (Hono) on `*`: defaults plus `xFrameOptions: 'DENY'`; Hono already removes `X-Powered-By`.
2. `/api/ai/*`: `Cache-Control: no-store`.
3. `/api/ai/*`: bearer check, constant-time compare (`crypto.timingSafeEqual` over SHA-256 digests so lengths never leak).
4. `/api/ai/*`: rolling-minute limiter keyed by remote address (`getConnInfo`; `local` when unavailable, as in tests). Forwarded headers are not trusted.
5. Routes: after the MIME check, sniff magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WebP `RIFF....WEBP`, GIF `GIF8`).

`onError` keeps the mapped model errors and returns only `{ error: 'internal_error' }` for the rest; the log line keeps the error name, never request data.

## Web dev proxy

`apps/web/vite.config.ts` proxy `/api` adds `Authorization: Bearer ${process.env.MENISCUS_API_TOKEN}` when set. That runs in the Vite node process, so the token never reaches the bundle.
