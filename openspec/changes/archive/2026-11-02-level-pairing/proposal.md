# Proposal

## Why

Patients drink from a jug or bottle through the day; nobody measures each sip. Photographing the jug at each refill (a task staff already do) and charting the drop since the last photo turns drinking into entries without extra work (PLAN §2, intake flow).

## What Changes

- `POST /api/admissions/:id/levels` `{ container: water_jug | water_bottle, volume_ml, source, confidence? }` records a level reading (from a photo read or typed). No model request.
- When the previous level of the same container in the last 24 h was higher, a pending `in / water` entry for the difference is created and returned; otherwise the reading is a new baseline (first reading or refill) and no entry is created.
- `GET /api/admissions/:id/levels` returns the latest level per container.

## Capabilities

### New Capabilities
- `charting/level-pairing`: level readings and the intake entries derived from them.

### Modified Capabilities
None.

## Impact

`packages/shared` (`Level`, `LevelInput`, `LevelResult`), `apps/server/src/store/store.ts` (`level` table), `src/routes/chart.ts`.

Out of scope: meal tray before/after (needs a two-image model prompt), poured-away corrections.
