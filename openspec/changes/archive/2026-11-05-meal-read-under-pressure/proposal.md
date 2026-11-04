## Why

scale-store added "Reads under budget pressure": a stable bed's tray read makes 1 request even with a comparable served photo. capture/meal-reading "Served and collected trays" still says such a read makes exactly 5, which now contradicts capture/read-budget.

## What Changes

- "Served and collected trays": the 5-request read happens when capture/read-budget admits it for 5; add a scenario for a stable bed under pressure (1 Spark request).

## Impact

- Spec wording and one citing test (`apps/server/src/ai/budget.test.ts`). No code change, no change in request counts.
