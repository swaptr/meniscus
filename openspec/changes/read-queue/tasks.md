# Tasks

After the deadline. Apply last: after acuity-budget, tray-comparison, bag-alerts, accuracy-views, dietitian-care, postgres-store and scale-store have archived (design §10). Cut first if time is short. The store is the Drizzle Postgres store (`src/db/schema.ts` + `apps/server/drizzle/` migrations); tests run on the in-process test database (PGlite). `PG_TEST_URL` is used only by the opt-in tests that already read it, and by 6.3.

Every test is written first and seen failing. No task sends a live model request:
- Server tests go through `await testApp()` (postgres-store's fresh test database per test) and the fake upstream (`createMetaClient` over a fake `fetch`). They assert the exact SAM, Spark and ASR request counts, including 0 for queued, expired, cancelled and refused reads.
- The worker and the queue take an injected `Clock`: tests advance it, and they never sleep or poll.
- "Two servers on one database" means two `createApp` instances over one PGlite `Db` (design §8.2).
- Web tests use `createApi` over a fake `fetch`. They assert every request sent, and that no `/api/ai` request is sent where none is expected.
- Clocks are local (`new Date(2026, 10, 3, h, m)`).
- Test titles are `[<domain>/<capability>] <Requirement>: <Scenario>`.

## 1. Rebase, contracts and the PGlite spike

- [ ] 1.1 Re-copy each MODIFIED block from the live spec at apply time, keeping only this change's edits, and keep every body ≤ 500 characters:
  - [capture/read-budget] Whole action admitted up front (tray-comparison's text; only its last sentence changes) and Read mode fits the budget (scale-store's text and scenarios; "or queued" twice, "2 free slots", and "Busy, queued");
  - [charting/model-accuracy] Reads are logged (read-outcomes' text; the queued read and its staff);
  - [web/ward] Batch approve high confidence.

  Verify: `pnpm exec openspec validate read-queue --strict` passes with no "target spec does not exist" INFO line, and a diff of each block against the live one shows only those edits.
- [ ] 1.2 Add the non-breaking shared contracts from design §0 to `packages/shared/src/index.ts`: `READ_JOB_KINDS`, `READ_JOB_STATUSES`, `READ_JOB_OUTCOMES`, `READ_JOB_ERRORS`, `ReadJob`, `QueuedRead` and `ReadQueueMetrics`. Verify: `pnpm typecheck` passes.
- [ ] 1.3 Add `READ_QUEUE_MAX_WAIT_CRITICAL_MIN` and `READ_QUEUE_MAX_WAIT_ROUTINE_MIN` (integers 1–55, defaults 10 and 45) to `apps/server/src/config.ts` and `.env.example`, with a comment on the 55 cap (design §3.7). Verify: a config test titled `[capture/read-queue] Waiting reads expire: wait from config` shows the defaults 10 and 45, with 0 and 56 rejected.
- [ ] 1.4 PGlite spike (`apps/server/src/store/pg/pglite-queue.spike.test.ts`, kept as a test): on the pinned PGlite through `createPgConfig`, check each row of design §8.1 — `FOR UPDATE SKIP LOCKED` returns the head; `pg_advisory_xact_lock($class, 1)` shows in `pg_locks` inside the transaction and not after COMMIT; a `pg_notify` committed through the pool reaches `pglite.listen` once, a rolled-back one never, two identical ones in one transaction once; `SAVEPOINT` / `ROLLBACK TO SAVEPOINT`. Verify: it passes. If the notify row fails, record it in design §8.3 and use the in-process bus fallback there.

## 2. Shared read routing (pure refactor, no behaviour change)

- [ ] 2.1 Move into `packages/shared/src/reads.ts`, and re-export from the web:
  - `levelContainer` and `bagContainer`;
  - `routeRead`;
  - `toEvidence` and `noteEvidence`;
  - `defaultBagEvent`, with bag-alerts' catheter override (`measure_every_h` first, else the ward default);
  - the IDDSI seed from the active `thickened_fluids` order.

  Verify: `evidence.test.ts`, `bags.test.ts`, `lib.test.ts` and `round.test.ts` pass unchanged, `pnpm lint` (import boundaries) passes, and `apps/web/src/lib/capture.ts` and `round.ts` call the shared functions.

## 3. @meniscus/meta: an async budget behind a store

- [ ] 3.1 Write the tests in `packages/meta/src/client.test.ts` and see them fail. A `RequestBudget` over a recording `BudgetStore` calls `atomic` once per unbound `reserve` and once per `take()`, runs in place with `within`, ignores a lapsed lease in `held()`, and two budgets over one shared in-memory store see each other's sends and holds. The existing [model-api/client] Request budget tests stay, with `await` added only.
- [ ] 3.2 In `packages/meta/src/budget.ts`, implement the async `BudgetStore` interface, `memoryBudgetStore()` (the default), `BudgetOptions.store` and `timeoutMs`, and the lease. Route `reserve`, `fits`, `acquire`, `Ticket.take` and `release` through it. Update the callers in `apps/server` and the scripts (`await` only). Write JSDoc: no SQL, no retries, and `atomic` runs in place on a bound store. Verify: the 3.1 tests and every existing `@meniscus/meta` and server budget test pass, and `grep -riE "sqlite|postgres|read_job|queue" packages/meta/src` finds nothing.

## 4. Database: schema, adapters and locks

- [ ] 4.1 Write the citing tests in `apps/server/src/store/pg/read-queue.test.ts` and see them fail:
  - Queue order: Critical goes first, Raised with its bed;
  - Budget counted in the store: Restart keeps the hour (the same PGlite data directory, closed and reopened), Two workers, one hour (two app instances over one `Db`);
  - Each read sent by one worker: Woken together. Two workers' looks run back to back for one waiting read, in both orders, and with a cancel committed between them: exactly one claim, and exactly 2 SAM and 1 Spark request (design §8.3).
- [ ] 4.2 Confirm the latest journal entry is `0004_media_link_trigger` (stop otherwise). Add the three tables and indexes of design §3.3 to `src/db/schema.ts` and run `db:generate` (→ `0005_*`); add a custom migration (`drizzle-kit generate --custom`, → `0006_*`) enabling RLS on the three tables and the `IF EXISTS (pg_roles …)` revoke block of `0001`. No backfill: the tables are new. Verify: [server/storage] "Schema migrated on start: Empty database" and "Second start" pass with the new migrations, "Tables closed to Supabase's APIs: Every table" passes with the three tables, and a test shows a database migrated to 0004 with an entry, a level and linked media keeps every row after 0005–0006.
- [ ] 4.3 Add `apps/server/src/store/pg/budget-store.ts`: the Postgres `BudgetStore`, with `atomic` as a `store.tx` whose first statement is the budget lock, in place when bound; `model_request` pruned in `open`; `sent` incrementing `read_job.requests` by ticket; `close` deleting the hold and notifying; `held` ignoring lapsed leases. Wire it in `index.ts` via `configureModelApi({ budgetStore, timeoutMs })` before `createApp` (design §12). Verify: Budget counted in the store: both scenarios pass, and the existing budget tests in `apps/server` pass.
- [ ] 4.4 Add `apps/server/src/store/pg/read-queue.ts`, the Postgres `ReadQueue`: `admitOrQueue`, `claimNext` (design §3.5's statements, the guarded `UPDATE` asserted at rowCount 1, the lease sweep), `cancel`, `readAgain`, `forBed`, `waitingByAdmission` and `metrics`, with the `eta` and `position` of design §3.2 in the pure `apps/server/src/ai/read-queue.ts`. Every time is a parameter from the clock. Verify: the 4.1 tests pass, and a unit test titled `[capture/read-queue] Queue order: Estimated start` covers the three `eta` cases of k.
- [ ] 4.5 Extend postgres-store's lock-first guard (the recording `Db`) with design §8.3's rules: the budget lock first in admission, claim, Read again and unbound `atomic`; `FOR UPDATE SKIP LOCKED` on the head; the bed lock first in `saveRead`; and a named failure for any pool query while the same flow's transaction holds the pool's client. Add the `pg_locks` check inside a claim. Verify: each rule has a test that breaks it on purpose and sees the guard fail, and the whole server suite passes under the guard.

## 5. Admission and routes

- [ ] 5.1 Write the citing tests in a new `apps/server/src/read-queue.test.ts` and see them fail:
  - [capture/read-queue] Queued instead of refused: every scenario;
  - Queue order: Estimated start (HTTP body);
  - Queue full: Past the routine wait, Critical waits less;
  - [capture/read-budget] Whole action admitted up front: Queued, then admitted whole;
  - Read mode fits the budget: Busy, queued.
- [ ] 5.2 Split `apps/server/src/ai/budget-policy.ts` `withBudget` into `admit` and `run`. Have `routes/ai.ts` read `Prefer: respond-async` on `/read`, `/note` and `/voice-note`, read the body's bytes and put them in the `MediaStore` before the transaction, call `admitOrQueue`, and answer 200 as today, 202 `QueuedRead` with `Preference-Applied: respond-async`, or 429 `BudgetRefusal`. Tray reads, Explain and `/status` ignore the header. Verify: the 5.1 tests pass, and every acuity-budget and tray-comparison test passes unchanged without the header.

## 6. Worker and wake

- [ ] 6.1 Write the citing tests in `apps/server/src/ai/read-worker.test.ts` (fake `Clock`, fake upstream) and see them fail:
  - [capture/read-queue] Sent at most once, when it fits: Window rolls, One request frees, Slots free;
  - Upstream failures are not retried: every scenario;
  - Waiting reads expire: Overtaken by critical reads;
  - Queue woken, never polled: Idle (no timer armed, 0 fetches after 2 simulated hours), One timer (exactly one armed timer at the computed instant), Woken by another server (two app instances over one `Db`, woken through the notifier, no timer for the read);
  - Queued reads survive a restart: Restart while waiting, Stopped mid-read (the lease lapses at 11:02:00 on the fake clock).
- [ ] 6.2 Implement `apps/server/src/ai/read-worker.ts` and `apps/server/src/store/pg/notifier.ts` (design §3.5, §7, §8.2): a coalesced `wake()`; a look that loops on `claimNext` and dispatches without awaiting; one `unref()`ed timer at `next`, lease lapses included; local wakes after enqueue, cancel, Read again and every ticket close; the `pg` notifier on one session `Client` (`LISTEN meniscus_read_queue`, claims on the same client, one look after a reconnect at the next local wake) and the PGlite notifier (`pglite.listen`, registered before serving, claims on the shared pool); a per-read `AbortController` aborted on shutdown; one look at start. Verify: the 6.1 tests pass, and `grep -nE "setInterval|while ?\(true" apps/server/src/ai apps/server/src/store/pg` finds nothing.
- [ ] 6.3 Add `apps/server/src/store/pg/read-queue.contention.test.ts` skipped without `PG_TEST_URL` (add a `test:pg` script that runs it) (design §8.3): two pools, 20 queued text notes, two workers woken together, a cancel held open in a second session, and a notification across pools, against a fake upstream. Verify: `pnpm test` skips it with no network access; the user runs `PG_TEST_URL=… pnpm --filter @meniscus/server test:pg` once against a local Postgres or the Supabase project, with 0 model requests, and records the result here.

## 7. Saving a finished read

- [ ] 7.1 Write the citing tests (in `read-queue.test.ts`) and see them fail:
  - [capture/read-queue] Queued photo saves its record: every scenario, including the catheter override (3A bed 5), the 409 duplicate and the attendant's 403 inside a fall;
  - Queued note saves its drafts: every scenario;
  - Entries from a queued read are marked: Marked;
  - Queued reads stay in the store: Nothing in the logs. Capture `console` and the logger, and assert that no note text, transcript, image byte, volume or staff name appears, and that every `pg_notify` payload is empty;
  - [charting/model-accuracy] Reads are logged: Queued read logged;
  - Queued reads in the accuracy numbers: every scenario.
- [ ] 7.2 Implement `apps/server/src/chart/save-read.ts` per design §3.6: one `store.tx` with the bed lock first, the `model_read` row, `SAVEPOINT records`, the records through the bound store, `ROLLBACK TO SAVEPOINT` on a save-rule refusal, and the guarded finish. Derive `Entry.queued_read` in the entry queries (BREAKING: update `audit-fixtures.ts` and the test builders). Leave queued reads out of accuracy-views' summary except through their saved entries. Verify: the 7.1 tests pass, and the existing read-outcomes and accuracy-views tests (`retaken`, `abandoned` and the negatives included) pass unchanged.

## 8. Cancel and Read again

- [ ] 8.1 Write the citing tests and see them fail:
  - [capture/read-queue] Cancel a waiting read: Entered by hand instead, Not his, or too late;
  - Read again: Tap after a failure, Only once (also with the two taps interleaved), Not failed;
  - Waiting reads expire: Entered by hand with its photo.
- [ ] 8.2 Add `apps/server/src/routes/read-jobs.ts` (`POST /api/read-jobs/:id/cancel`) and `POST /api/ai/read-again` in `routes/ai.ts` (design §3.8), with the 403 and 409 codes, mounted in `app.ts` under the existing auth. Verify: the 8.1 tests pass, and `security.test.ts` passes.

## 9. Chart reads and metrics

- [ ] 9.1 Write the citing tests and see them fail:
  - [capture/read-queue] Reads on the bed's chart: A morning's reads;
  - Waiting reads on the bed list: Two waiting;
  - [server/metrics] Read queue metrics: Queue after a busy hour.
- [ ] 9.2 Add `EntryList.reads` and `AdmissionSummary.reads_waiting` (BREAKING: update the web fixtures), and `read_queue` on scale-store's metrics body (nearest-rank p95). Verify: the 9.1 tests pass, a read changing bumps its bed's version so scale-store's status reuse serves fresh `reads`, and the 500-bed list query stays in scale-store's p95 budget on its benchmark (a local run on PGlite, 0 upstream requests).

## 10. Web

- [ ] 10.1 Write the citing tests and see them fail:
  - in a new `apps/web/src/lib/reads.test.ts`, [web/capture] Queued read at the bed: every scenario, and Bed screen follows its reads: every scenario;
  - in `lib.test.ts`, [web/ward] Batch approve high confidence: Queued read left out, with Queue of four unchanged; Reads on the bed review: every scenario; Queued read entries marked: Marked for a look; Waiting reads on bed cards: Two waiting;
  - in `round.test.ts`, [web/ward-round] Queued round readings: One of three queued.
- [ ] 10.2 Add `apps/web/src/lib/reads.ts` (read state → copy, the reason labels, `canCancel` and `canReadAgain`) and `api.ts` calls with `Prefer: respond-async`, `cancelRead` and `readAgain`.
- [ ] 10.3 The bed screen (`routes/a/bed.$token.tsx`):
  - on 202 it keeps the photo, shows `Queued · position N · about HH:MM`, and lets the attendant leave;
  - Enter by hand cancels first;
  - it refreshes the chart every 30 s only while a read waits or runs.

  Then add `components/reads.tsx` for the bed review, the `Queued read · check` mark in `entry-log.tsx` and `entry-details.tsx`, and the `reads_waiting` chip on the bed cards (`routes/n/w.$ward.tsx`), following `apps/web/DESIGN.md`.
- [ ] 10.4 The round (`lib/round.ts`): a 202 reading is marked queued, skipped by "Save all high-confidence", and never re-sent. Batch approve skips `queued_read`. Verify: the 10.1 tests pass, and every existing web test passes unchanged.

## 11. Docs

- [ ] 11.1 AGENTS.md "Model API credits are limited": a queued read makes the same fixed count when sent, and 0 when expired or cancelled; still no retries. README: at most 3 lines under the existing **Scaling** note (the queue, its waits, upstream failures still fail). Add the config lines to `.env.example`. Verify: `grep -n "queued\|READ_QUEUE" AGENTS.md README.md .env.example` shows the new text, and it agrees with [capture/read-queue] Sent at most once, when it fits.

## 12. Integration

- [ ] 12.1 Browser check at 390 and 1100 px, through the Vite proxy, on the local stack's Postgres (`DATABASE_URL`, migrated by `pnpm db:migrate`; never drop the schema).
  - **Setup.** Start the server with `MODEL_API_KEY=fake`, the model API base URL on `http://127.0.0.1:9` (a local fake upstream: `testing.ts`'s `upstream()` behind a tiny HTTP shim, with a `delayMs` switch and a 503 switch) and `MODEL_API_MAX_REQUESTS_PER_HOUR=4`. Never use the real upstream: **0 real upstream requests**. Never read `.env`.
  - **Check:**
    - with the hour full, a photo at the bed shows `Queued · position 1 · about HH:MM`, and the attendant can leave the screen;
    - Enter by hand on a second queued read cancels it, and the bed review no longer lists it;
    - once the window rolls, the pending entry appears on the nurse's bed review marked `Queued read · check`, without a reload, within 30 s;
    - the ward dashboard card shows `1 read waiting` while it waits;
    - with the fake upstream answering 503, the read shows `Read failed (…)` and Read again sends exactly one `POST /api/ai/read-again`;
    - a slow fake upstream (`delayMs` 20000) keeps the bed screen responsive;
    - after a server restart on the same database, a waiting read is still listed and is sent once admitted.

  Verify: no console errors; the network log shows no `/api/ai` request other than the user's taps; the fake upstream's request count matches the spec for each read.
- [ ] 12.2 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check (every ADDED and MODIFIED requirement above is cited), typecheck and tests.

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply` and again before `/opsx:archive`.
- Archive with `openspec archive read-queue --yes`.
