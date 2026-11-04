# Tasks

## 1. Config

- [x] 1.1 Make `parseConfig(env)` pure and add `HOST`, `NODE_ENV`, `MENISCUS_API_TOKEN`, `AI_RATE_LIMIT_PER_MINUTE`; tests `[server/security] Production requires a token` and `[server/security] Loopback by default` pass
- [x] 1.2 Bind `serve()` to `config.HOST`; document the new vars in `.env.example`

## 2. HTTP guards

- [x] 2.1 Security headers and `no-store` on `/api/ai/*`; test `[server/security] Security headers` passes
- [x] 2.2 Bearer token check; test `[server/security] API access token` passes
- [x] 2.3 Per-client rolling-minute limiter; test `[server/security] Per-client rate limit` passes
- [x] 2.4 Upload signature sniffing; test `[server/security] Upload content matches its type` passes
- [x] 2.5 Opaque 500s; test `[server/security] Internal errors stay internal` passes

## 3. Dev wiring

- [x] 3.1 Vite proxy adds the bearer token from `MENISCUS_API_TOKEN` and verify `pnpm --filter @meniscus/web typecheck` passes
- [x] 3.2 `pnpm verify` passes

## Workflow follow-up

- Archive with `openspec archive harden-server --yes`.
