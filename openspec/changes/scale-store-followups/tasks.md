# Tasks

Not applied. `design.md` is the original scale-store design, kept as the starting point; rewrite it and this list for the Drizzle store before applying (see proposal).

## 1. Plan

- [ ] 1.1 Rewrite `design.md` for Drizzle migrations: version tables and bump triggers in a custom migration with RLS and the revoke block; schema columns in `src/db/schema.ts` and a generated migration; drop every `SCHEMA_VERSION`, `schema.sql`, "drop schema" and docs/PLAN.md reference.
- [ ] 1.2 Rewrite this task list per requirement and scenario, test first, and run the spec-reviewer agent.

## 2. Apply

- [ ] 2.1 Acuity and intervals ([charting/acuity], [charting/bag-periods]).
- [ ] 2.2 Bounded status reuse ([charting/alerts] Alerts on chart reads).
- [ ] 2.3 Web ([web/capture], [web/ward], [web/ward-round]).
- [ ] 2.4 Bench and plan guard.
- [ ] 2.5 `pnpm verify` passes.
