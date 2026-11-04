# Proposal

## Why

The attendant flow starts by scanning the bed QR with the phone's own camera; the demo needs printable bed cards that open the right capture screen.

## What Changes

- `/n/qr`: printable cards, one per bed (bed number, QR, short instruction; no patient name on the card), print-friendly layout.
- The QR encodes `<origin>/a/bed/<token>`, a plain URL so any camera app opens it.

## Capabilities

### New Capabilities
- `web/bed-qr`: printable bed QR cards.

### Modified Capabilities
None.

## Impact

`apps/web`: `src/lib/qr.ts` (+ tests) using `uqr` 0.1.3 (zero-dependency QR encoder), route `n/qr.tsx`.
