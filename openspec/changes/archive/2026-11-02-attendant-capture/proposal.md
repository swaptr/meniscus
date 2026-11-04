# Proposal

## Why

The capture API exists but staff have no screen: the attendant flow (scan bed QR → photo or voice → confirm → saved) is the core of the demo and of the product (PLAN §2).

## What Changes

- `/a`: pick a bed (demo list; in the ward the bed QR opens the bed directly).
- `/a/bed/$token`: patient header, today's totals and alerts; capture by photo, voice note or typed note; draft card with +/- volume adjust; Save.
- Photos are shrunk on the phone (longest side ≤ 1280 px, JPEG) before upload.
- A photo read of a water jug or bottle is saved as a level reading (level pairing) instead of an entry.
- Saving a photo capture records the entry, then attaches the photo; a failed photo upload does not lose the entry.
- Upstream model requests per action unchanged: photo read 3 (or 1), voice note 2, typed note 1. Saving makes none.

## Capabilities

### New Capabilities
- `web/capture`: the attendant capture screen.

### Modified Capabilities
None.

## Impact

`apps/web`: `src/lib/api.ts`, `src/lib/capture.ts` (+ tests), `src/lib/photo.ts`, routes `a/index.tsx`, `a/bed.$token.tsx`, components. `packages/shared`: `AUTO_CONFIRM_CONFIDENCE` moves here from the server. Web gets a `test` script (node:test via tsx, pure modules only).
