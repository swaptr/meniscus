# Proposal

## Why

A nurse approving a low-confidence reading needs to see the container, not trust a number. Today the capture photo is discarded after the AI read, so there is no evidence on the chart.

## What Changes

- `POST /api/entries/:id/photo` (multipart `image`, same type/size/signature checks as reads) attaches one photo to a pending entry; `GET /api/entries/:id/photo` returns it. No model request.
- Entries report `has_photo`.
- Photos live in the SQLite store (same file, same token, `no-store`); a rejected entry's photo is deleted (data minimisation).

## Capabilities

### New Capabilities
- `charting/photo-evidence`: attaching, serving and discarding the capture photo of an entry.

### Modified Capabilities
None.

## Impact

`packages/shared` (`Entry.has_photo`), `apps/server/src/store/store.ts` (`photo` table), `src/routes/chart.ts`, `src/routes/validate.ts` (shared image schema), `src/routes/ai.ts`.

Out of scope: photo thumbnails, annotations (Muse Image), encryption at rest.
