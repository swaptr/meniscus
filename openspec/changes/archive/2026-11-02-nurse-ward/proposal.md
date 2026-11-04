# Proposal

## Why

Entries land as pending, but nurses have no queue or dashboard: nothing gets approved, and alerts are invisible (PLAN §2, nurse flow).

## What Changes

- `/n`: ward dashboard, one row per bed with 24 h in/out/balance, pending count and alert chips; beds needing attention first.
- `/n/$id`: bed detail with alerts (and "Explain", 1 model request on tap), pending queue with photo evidence, approve / correct / reject, "Approve all high-confidence", and the full entry history.

## Capabilities

### New Capabilities
- `web/ward`: the nurse dashboard and approval queue.

### Modified Capabilities
None.

## Impact

`apps/web`: `src/lib/ward.ts` (+ tests), routes `n/index.tsx`, `n/$id.tsx`.
