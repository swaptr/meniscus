# Proposal

## Why

The AI capture pipeline and the Meta Model API client were built before the repo adopted spec-driven development. Their behaviour lives only in code and tests, so an agent changing them has nothing to check against, and nothing fails when a change silently alters request counts or error handling. This change records the behaviour that exists today as specs and makes the existing tests cite them.

## What Changes

- No behaviour changes. Specs describe what the code already does.
- Existing tests are retitled to cite the requirements they prove; `pnpm spec:check` enforces that every requirement is cited.
- Upstream model requests per user action: unchanged (photo read 3, or 1 in Spark-only mode; text note 1; voice note 2).

## Capabilities

### New Capabilities
- `capture/photo-reading`: photo of a container → reading, draft chart entry and review flag.
- `capture/notes`: typed or spoken note → draft chart entries.
- `model-api/client`: request discipline, errors, privacy and validation of the `@meniscus/meta` client.
- `model-api/http-errors`: how the server reports model-API failures to its HTTP callers.

### Modified Capabilities
None.

## Impact

- Test titles in `packages/meta/src/client.test.ts` and `apps/server/src/ai/ai.test.ts`.
- No code, types or HTTP shapes change.

Out of scope: charting, nurse approval, alerts, the family view and the web UI.
