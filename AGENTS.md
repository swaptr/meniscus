# Meniscus — agent guide

Hospital fluid intake/output charting: ward staff capture a photo or voice note at the bed; Meta models (Muse Spark, SAM 3.1, speech-to-text) turn it into a draft chart entry a nurse approves.

## Three sources of truth

1. **Behaviour**: `openspec/specs/<domain>/<capability>/spec.md` (OpenSpec 1.16, schema `spec-driven`). Requirements + WHEN/THEN scenarios. Changed only through a change in `openspec/changes/<name>/`, merged by `openspec archive`. Never hand-edit `openspec/specs/**`.
2. **Types**: `packages/shared` (domain + HTTP shapes the web app consumes) and `packages/meta` (Meta API wire types, mirrored from the official docs).
3. **Tests**: every live requirement is cited by a test titled `[<domain>/<capability>] <Requirement name>: <scenario>`. `pnpm spec:check` fails on uncited requirements and on citations of requirements that do not exist.

## Workflow

Small, iterative changes (one intent you can say in a sentence):

1. **Explore**: read the relevant specs (`openspec list --specs`, `openspec show <id> --type spec`) and code. No writes.
2. **Propose**: `openspec/changes/<kebab-name>/` with `proposal.md`, delta `specs/**/spec.md` (ADDED/MODIFIED/REMOVED/RENAMED), optional `design.md`, `tasks.md`. Validate with `openspec validate <name> --strict`.
3. **Apply**: tasks in order. Write the citing test first, see it fail, implement, tick the task.
4. **Verify**: `pnpm verify` passes.
5. **Archive**: `openspec archive <name> --yes` merges deltas into `openspec/specs/`.

Skip the change for typos, formatting, dependency bumps and pure refactors (a refactor that changes no requirement may use a change with `skip_specs: true`). Anything that changes observable behaviour (HTTP responses, stored data, model request counts, UI) goes through a change.

## Commands

| Command                                                     | What                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm verify`                                               | everything CI runs: format check, lint, `openspec validate --all --strict`, spec:check, typecheck, tests     |
| `pnpm spec` / `pnpm spec:check`                             | requirement → test coverage / trace check                                                                    |
| `pnpm test`, `pnpm --filter <pkg> test`                     | tests (node:test via tsx; no network)                                                                        |
| `pnpm typecheck`                                            | TypeScript 7 (`tsc`) for root scripts and every package                                                      |
| `pnpm lint` / `pnpm format`                                 | ESLint 10 (type-aware) / Prettier 3, shared from `@meniscus/config`                                          |
| `pnpm --filter @meniscus/server eval <dir>`                 | accuracy eval; dry-run only. Sending requests needs the user's approval                                      |
| `pnpm --filter @meniscus/server synth <plan.json> <outdir>` | synthetic test images; dry run only. Sending needs the user's approval                                       |
| `pnpm --filter @meniscus/server demo:capture <url> [pack]`  | seeds a deployed app's capture flow over HTTP (3 per photo); dry run only. Sending needs the user's approval |
| `pnpm dev:stack` / `pnpm dev:stack:stop` (alias `dev:s3`)   | local Supabase stack (Docker): Postgres on 54322 and the media bucket; prints the `S3_*` values              |
| `pnpm db:migrate`                                           | applies the committed Drizzle migrations to `DATABASE_URL` (the server also does at start)                   |
| `pnpm --filter @meniscus/server media:sweep [--delete]`     | counts (or deletes) bucket objects no media row names, over 1 h old; reads `meniscus.media` only             |

## Layout

```
apps/server      Hono API. src/model-api.ts (the one Meta client), src/ai/ (prompts, contracts, pipelines over AiPorts), src/routes/ (HTTP only), src/lab/ (dev-only script modules)
apps/web         React 19 PWA (React Compiler, StyleX, Base UI, TanStack Router). Talks to the server over HTTP only.
packages/meta    @meniscus/meta: fetch-based Meta Model API client. Transport only, no domain, no deps besides @meta-sam/parser.
packages/shared  @meniscus/shared: domain and HTTP types shared by server and web.
packages/config  @meniscus/config: tsconfig bases, ESLint flat config (with import boundaries), Prettier.
openspec/        specs/ (truth), changes/ (in flight), changes/archive/, config.yaml (context + rules for artifacts)
scripts/         spec-check.ts
```

Import boundaries are lint errors: packages never import apps; `@meniscus/meta` never imports `@meniscus/shared`, zod or openai; web never imports server code or `@meniscus/meta`; server routes and `src/ai` never import `src/lab`.

## Rules that always apply

- **Docs first.** Before calling or changing any external API, confirm its current request/response shape in our code (`packages/meta/src`) or the official docs (https://dev.meta.ai/docs). Use the latest recommended API: the Responses API for Muse Spark. If docs and an installed package disagree, inspect the package and trust it.
- **Model API credits are limited. Never loop requests**: no retry loops, fallback chains, polling or "try the next prompt". Each user action makes a fixed, specified number of upstream calls per mode, admitted whole before the first is sent, and 0 when the budget refuses it (photo read 3 in `sam+spark` mode, or 1 in `spark` mode; text note 1; voice note 2; Explain 1; meal tray photo 3 in `sam+spark` mode, 5 with a served photo, or 1 in `spark` mode; image synthesis (dev script only): 1 per plan item). A `sam+spark` read whose 3 no longer fit runs in `spark` mode with 1, and so does a stable-bed or bedless `sam+spark` photo or tray read once `BUDGET_PRESSURE_PCT` (default 50) of the cap is in use. `@meniscus/meta` never retries and enforces a request budget (`MODEL_API_MAX_REQUESTS_PER_HOUR`, `MODEL_API_MAX_CONCURRENT`, the `CRITICAL_RESERVE_PCT` kept for critical beds); never bypass it with raw `fetch`.
- **Live API during development**: say how many requests you will send before sending, send the minimum, never inside loops or watch scripts. Tests use a fake `fetch` with `createMetaClient` and assert request counts.
- **Patient data**: never retained upstream where the API allows it: `store: false` on every Responses API request. Speech-to-text has no per-request retention option (https://dev.meta.ai/docs/api-reference/voice/schemas), so audio follows the organisation's Meta data-retention setting; zero data retention is enabled per organisation by Meta. Never logged (log paths, models, statuses, timings; never transcripts, images or notes), never in fixtures (staged props and fictional patients only). Never read or print `.env`.
- **Never weaken a test to pass.** If a requirement is wrong, change the spec through a change.
- **Not a diagnostic device.** Clinical flags say "review"; nurses approve every entry.
