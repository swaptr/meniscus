# Tasks

## 1. Trace existing tests to the baseline specs

- [x] 1.1 Retitle `packages/meta/src/client.test.ts` tests to cite `[model-api/client] …` requirements and verify `pnpm --filter @meniscus/meta test` passes
- [x] 1.2 Retitle `apps/server/src/ai/ai.test.ts` tests to cite `[capture/photo-reading] …`, `[capture/notes] …` and `[model-api/http-errors] …` requirements and verify `pnpm --filter @meniscus/server test` passes
- [x] 1.3 Verify `pnpm spec:check` reports every requirement of the four capabilities as cited and no dangling citations
- [x] 1.4 Verify `pnpm verify` passes

## Workflow follow-up

- Archive with `openspec archive baseline-ai-capture --yes` and confirm `openspec/specs/` holds the four capabilities.
