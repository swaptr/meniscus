# Proposal

## Why

On a multi-bed ward one person often does the round: empty every bag, check every jug. Opening each bed's screen separately is slow. They should be able to keep the camera going: photograph the bed card, photograph the container, move to the next bed, and confirm everything at the end.

## What Changes

- New `/a/round` screen: a continuous capture loop. A photo containing a bed QR card switches the current bed (no model request); any other photo is a reading for the current bed and joins a queue.
- Queued photos are read one at a time in capture order, each exactly once (3 model requests, or 1 in fast mode). A failed read is marked failed and is only re-sent when the user taps Retry.
- Round review groups drafts by bed: adjust and save each, or "Save all high-confidence" (≥ 0.75, with the photo attached). Jug/bottle readings are saved as levels, as on the bed screen.
- QR decoding runs on the phone (built-in `BarcodeDetector` where available, else `jsqr` 1.4.0, zero dependencies, loaded only on this screen).
- `api.read` gains the optional `mode` (`spark` = fast, 1 request) that the server already accepts.

## Capabilities

### New Capabilities
- `web/ward-round`: bulk capture across beds.

### Modified Capabilities
None.

## Impact

`apps/web`: `src/lib/round.ts` (+ tests), `src/lib/qr-decode.ts`, route `a/round.tsx`, link from `/a`. No server changes.
