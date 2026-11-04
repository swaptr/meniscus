## 1. Spec and test

- [x] 1.1 Citing test `[capture/meal-reading] Served and collected trays: Stable bed under pressure` (1 Spark request, `comparison.served: null`)
- [x] 1.2 MODIFIED "Served and collected trays" defers the 5-request read to capture/read-budget
- [x] 1.3 `openspec validate --all --strict`, `pnpm spec:check` and the server budget tests pass
