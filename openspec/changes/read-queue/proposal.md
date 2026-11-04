# Proposal

**After the deadline.** Apply order: … → drink-types → deploy-ready → s3-media → ui-polish → labeled-photo-copy → postgres-store → scale-store → **read-queue** (design §10). It targets postgres-store's Postgres store and tests on its in-process test database. Cut first if time is short.

## Why

The user asked for "a request queue so that none of the requests fail". Under acuity-budget, a read that does not fit the hourly budget or the in-flight limit gets 429 and the attendant has to enter it by hand. At 500 beds the busiest hour is 12.8–19× the 120/h cap (acuity-budget design §1), so many reads that could be served a few minutes later are refused.

A queue removes **our own** refusals. It cannot remove Meta's. A queued read that Meta fails (503, an upstream 429, a timeout) is marked failed and never re-sent, because AGENTS.md forbids retries. "None fail" therefore holds only for the local budget and the concurrency limit, and only within each read's maximum wait.

## What Changes

- **Queued instead of refused** (new `capture/read-queue`).
  - `POST /api/ai/read`, `/note` and `/voice-note` with a bed (`admission_id`) and the header `Prefer: respond-async` (RFC 7240) are queued when the local budget cannot admit them now. They answer **202** with the queued read: its position, an estimated start (`eta`) and its expiry.
  - **Saved before the response.** The photo or recording becomes the bed's media at once, and a text note's text is kept in the store. Nothing is sent upstream yet.
  - **Same as today when it fits.** A read that fits, with nothing of its class or higher waiting ahead of it, answers 200 exactly as today.
  - **Not queued.** These still get acuity-budget's 429:
    - requests without the header (scripts, eval, tests, older clients);
    - reads without a bed;
    - tray reads (see Out of scope);
    - Explain;
    - `GET /api/ai/status`.
- **Order.** The critical class goes first, then capture time. A read queued as critical raises its bed's waiting reads to critical, so one bed's reads keep their order. Position counts across the hospital.
- **Sent at most once, when it fits.** The server sends a queued read as soon as its class's hourly ceiling and its in-flight slots admit it.
  - The mode is picked then, by acuity-budget's rule, and the read makes that mode's fixed request count.
  - The read is claimed in the same database transaction that checks and holds its budget, so no two servers send one read.
  - The server sends it whether or not anyone is still signed in.
- **No retries.** An upstream failure ends the read `failed` with its error code. The read keeps the requests it sent and is never sent again. Staff see "Read failed: enter by hand". **Read again** (`POST /api/ai/read-again`) is a new user action: a new queued read of the stored photo, recording or text, made at most once per failed read.
- **Expiry and queue full.**
  - A read not sent within `READ_QUEUE_MAX_WAIT_CRITICAL_MIN` (10) or `READ_QUEUE_MAX_WAIT_ROUTINE_MIN` (45) ends `expired` with 0 requests. Its photo stays linkable to a record entered by hand.
  - A read whose estimated start already falls past its maximum wait is not queued. It gets acuity-budget's 429, with the time it could be queued.
- **The server saves what the read found**, as the staff member who captured it and charted at the time of capture, linked to its photo or recording and to its read (read-outcomes). It makes no more model requests. Nurses approve every entry, as today:
  - a photo saves what the ward round saves: a jug or bottle level, a bag reading with the bed's default event (bag-alerts), or one pending entry;
  - a voice or text note saves one pending entry per draft that has a volume;
  - a read that finds nothing to chart saves nothing (`nothing_to_chart`);
  - when a save rule refuses it (bag-alerts' 409 duplicate, bag-emptying's 403 fall guard), the read saves nothing and ends `not_saved`.
- **Marked for the nurse.** Entries saved by a queued read carry `queued_read: true`, show `Queued read · check`, and are left out of "Approve all high-confidence", because nobody checked them at the bed.
- **Cancel.** `POST /api/read-jobs/:id/cancel` withdraws a read that is still waiting, for the staff member who made it, a nurse or a matron. The capture screen's "Enter by hand instead" uses it, so a by-hand entry and the queued read never both chart.
- **Delivery to the web without polling `/api/ai/*`.** The bed's chart read (`GET /api/admissions/:id/entries`) returns its `reads`, and the bed list items return `reads_waiting`. The bed review and the dashboard already refresh every 30 s. The capture screen refreshes its chart read every 30 s only while the bed has a read waiting. There is no server-sent events stream (design §5).
- **Web.**
  - **Capture.** After a 202, the capture screen keeps the photo, recording or note and shows `Queued · position 3 · about 11:00` and `You can leave. It is saved for nurse approval once read.` The attendant can leave.
  - **Bed review.** It lists the bed's reads: queued, failed, expired, nothing to chart and not saved, each with Enter by hand or Read again.
  - **Bed cards.** Each card shows `2 reads waiting`.
  - **Ward round.** It marks a 202 reading `Queued · about 11:00`, moves on, and leaves it out of "Save all high-confidence".
- **Budget kept in the database.**
  - The rolling hour's sends and the held and in-flight slots move from process memory into `meniscus` tables, read and written under one budget advisory lock inside the same transaction as each admission and claim.
  - A restart keeps the hour's count, and every server on one database shares it; acuity-budget's "Per-process state" risk is closed.
  - `@meniscus/meta` gains an async `BudgetStore` port with an in-memory default (`reserve` and `Ticket.take` become async). The client stays transport-only, and the SQL adapter lives in `apps/server`.
  - Each hold has a lease (its requests' timeouts plus 30 s), so a server that dies frees its slots, and its running read ends `failed: interrupted`.
- **Durable.** Queued reads survive a restart. A read that was being sent when its server stopped ends `failed: interrupted` once its lease lapses, and is never re-sent, because we cannot know whether its requests reached Meta.
- **The worker wakes; it never polls.** One worker per process looks at the queue only on these events, from its own process or, through `LISTEN`/`NOTIFY`, from any server sharing the database:
  - a read is enqueued or cancelled;
  - an admitted action ends;
  - the one timer it sets fires, at the earliest of the moment the hourly window next admits the first waiting read, the next expiry and the next lease lapse.

  With nothing queued, it sets no timer.
- **Metrics** (`server/metrics`, after scale-store): `GET /api/metrics` gains `read_queue`. It reports reads waiting by class, the p95 wait by class over the last hour, and the reads sent, expired, failed and cancelled in the last hour. It holds no patient data.
- **Shared rules.** The read → record routing (level, bag reading, entry), the evidence builders and the bag default event move from `apps/web/src/lib` into `packages/shared`, so the bed screen, the round and the queue route a read identically.
- **Our own queue table on Postgres** (design §3, §6–8): `meniscus.read_job`, `model_request` and `budget_hold`, added as new Drizzle migrations (`0005` tables and indexes, `0006` RLS and revokes), applied at start like the others; existing data is untouched. Claims use `FOR UPDATE SKIP LOCKED` under one `pg_advisory_xact_lock`, in the transaction that checks the budget. The worker's `LISTEN` and claims use postgres-store's session connection (`DATABASE_SESSION_URL`: direct or Supavisor session mode on 5432, never 6543). pg-boss and Supabase Queues (pgmq) are rejected (design §6).
- **Tests on PGlite.** PGlite has one connection, so it cannot show two transactions contending (design §8.1). The suite proves each race's single outcome by interleaving, a lock-first guard and `pg_locks`, and the wake through PGlite's in-process `listen`. A user-run test covers real contention on Postgres (design §8.3).

### Upstream model requests per user action (before → after)

| Action | Before (acuity-budget, tray-comparison, scale-store) | After |
| --- | --- | --- |
| Photo read, voice note or text note that fits now | 3 or 1 / 2 / 1 | unchanged, answered 200 |
| The same that does not fit (hourly or in flight), with a bed and `Prefer: respond-async` | 429 with 0 | 202 with 0 now; once admitted, exactly the mode's count: photo 3 (`sam+spark`) or 1 (`spark`), voice 2, text 1 |
| Queued read whose upstream request fails | — | what it sent (photo 3 or 1, voice 1 when speech-to-text fails, else 2, text 1), never again |
| Queued read that expires, or is cancelled | — | 0 |
| Queued read whose estimated start is past its maximum wait | — | 429 with 0, as before |
| Read again (one tap on a failed or expired read) | — | a new queued read: the same counts |
| Without the header, without a bed, tray reads, Explain, status, scripts | 429 with 0 when refused | unchanged |
| Cancel, chart reads, metrics, worker wake-ups, saving a finished read | — | 0 |

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `Entry` gains `queued_read: boolean`; `EntryList` gains `reads: ReadJob[]`; `AdmissionSummary` gains `reads_waiting: number`. Fixtures and builders change.
  - New: `READ_JOB_KINDS`, `READ_JOB_STATUSES`, `READ_JOB_OUTCOMES`, `READ_JOB_ERRORS`, `ReadJob`, `QueuedRead`, `ReadQueueMetrics`.
  - New pure functions moved from the web: `routeRead`, `toEvidence`, `noteEvidence`, `levelContainer`, `bagContainer`, `defaultBagEvent`.
- `@meniscus/meta` (additive): `BudgetStore`, `memoryBudgetStore()`, `BudgetOptions.store`.
- HTTP:
  - `POST /api/ai/read`, `/note` and `/voice-note` may answer **202** `QueuedRead` with `Preference-Applied: respond-async`, but only when the request sent `Prefer: respond-async`. Every other caller sees no change.
  - `/voice-note` accepts an optional `duration_ms`, kept only with a queued recording.
  - New: `POST /api/ai/read-again` (202 or 409) and `POST /api/read-jobs/:id/cancel` (200, 403 or 409).
  - **BREAKING** for the web: `GET /api/admissions/:id/entries` gains `reads` and each entry `queued_read`, and `GET /api/admissions` items gain `reads_waiting`. `GET /api/metrics` gains `read_queue`.
- Config (`config.ts`, `.env.example`): `READ_QUEUE_MAX_WAIT_CRITICAL_MIN` (integer 1–55, default 10) and `READ_QUEUE_MAX_WAIT_ROUTINE_MIN` (integer 1–55, default 45).

### Decided defaults this proposal departs from (flagged)

- **Routine wait 45 min, not 60.** Records are charted at capture time, and an entry saved more than `LATE_ENTRY_MINUTES` (60) after its charted time is flagged `late`. A 60-minute wait plus up to 3 minutes of reading would flag queued reads as late, and count against the ward's data quality, merely for having waited. The cap is 55 for the same reason.
- **Tray reads are not queued.** tray-segmentation's meal proof records the values staff confirmed. A server-saved meal would claim a confirmation nobody made, and a "tray read ready" confirm step is a second delivery path. The by-hand meal form keeps its photo at 0 requests. A queued tray confirm step can come later (Out of scope).
- **Opt-in through `Prefer: respond-async`.** The queue is not on for every caller. Only a caller that can take a 202 and come back gets one, so the scripts, the eval and acuity-budget's citing tests keep their fail-fast 429.
- **Our own table, not pg-boss or pgmq; no Redis** (design §6).

### Out of scope

- Retrying anything upstream, at any layer, and any re-send of a `running` read after a crash.
- Queued tray reads and a "tray read ready" confirm flow; queued Explain.
- Re-classing a waiting read when its bed's acuity changes, apart from the raise when a critical read for the same bed is queued.
- Back-filling: a smaller read never overtakes the waiting read ahead of it, even when it would fit.
- The store's move to Postgres (`postgres-store`, applied before this). This change adds only its own tables (new migrations after scale-store's `0004`) and adapters.
- Server-sent events or Supabase Realtime: the web talks only to our server, over HTTP.
- Sizing the cap: a queue spreads demand over the hour, it does not add credits.

## Capabilities

### New Capabilities
- `capture/read-queue`: reads queued instead of refused by the local budget. It covers their order, at-most-once dispatch, expiry and queue-full, failures without retries, what a finished read saves, cancel and Read again, the reads on chart reads, restart durability, the budget counted in the store, a single claim per read and the wake rule.

### Modified Capabilities
- `capture/read-budget` (added by acuity-budget, as tray-comparison leaves it): **Whole action admitted up front** and **Read mode fits the budget**. A read that would be refused may be queued instead, and is admitted whole when it is sent.
- `charting/model-accuracy` (added by read-outcomes, extended by accuracy-views): **Reads are logged** also logs a queued read when it answers. Adds **Queued reads in the accuracy numbers**: a queued read counts only through the entries it saved, so its levels, bag readings, unsaved drafts and negatives, which nobody checked at the bed, count nowhere, ahead of "Outcome of a saved level", "Unsaved drafts" and "Negative reads".
- `server/metrics` (added by scale-store): adds **Read queue metrics**.
- `web/capture`: adds **Queued read at the bed** and **Bed screen follows its reads**.
- `web/ward`: **Batch approve high confidence** leaves out entries saved by a queued read. Adds **Reads on the bed review**, **Queued read entries marked** and **Waiting reads on bed cards**.
- `web/ward-round`: adds **Queued round readings**.

Three of these (read-budget, model-accuracy, metrics) modify or extend capabilities that in-flight changes add or change (acuity-budget, tray-comparison, read-outcomes, accuracy-views, scale-store). `openspec validate` reports them as INFO until those archive.

## Impact

- `packages/meta`: `src/budget.ts` (the `BudgetStore` port, with the in-memory default), `src/index.ts`, tests. No new imports.
- `packages/shared`: `src/index.ts`, plus a new `src/reads.ts` holding the routing and evidence rules moved from the web.
- `apps/server`:
  - new: `src/ai/read-queue.ts` (the ports and the domain types), `src/ai/read-worker.ts` (the worker over `AiPorts`), `src/chart/save-read.ts` (a finished read becomes its records), `src/store/pg/read-queue.ts`, `pg/budget-store.ts` and `pg/notifier.ts` (the Postgres adapters), `src/routes/read-jobs.ts`, and `src/store/pg/read-queue.contention.test.ts` (user-run);
  - changed: `src/ai/budget-policy.ts`, `src/ai/pipeline.ts`, `src/routes/ai.ts`, `src/routes/chart.ts`, `src/routes/metrics.ts`, `src/store/pg/store.ts`, `src/db/schema.ts` and `drizzle/0005_*`, `0006_*` (the queue tables), lock-first guard, `src/model-api.ts`, `src/config.ts`, `src/index.ts`, `src/app.ts`, `src/testing.ts`, `package.json` (`test:pg` is postgres-store's; this change adds its contention test to it) and `.env.example`.
- `apps/web`:
  - new: `lib/reads.ts`, `components/reads.tsx`;
  - changed: `lib/api.ts`, `lib/capture.ts`, `lib/round.ts`, `lib/ward.ts`, `lib/evidence.ts`, `lib/bags.ts`, `routes/a/bed.$token.tsx`, `routes/a/round.tsx`, `routes/n/$id.tsx`, `routes/n/w.$ward.tsx`.
- Docs:
  - AGENTS.md "Model API credits are limited": a queued read is sent at most once, with the same counts, and 0 when expired or cancelled.
  - README: up to 3 lines under the Scaling note: the queue, what it removes, and what it cannot remove.
- **No new dependencies.** It uses postgres-store's `pg` and PGlite; no Redis, pg-boss or pgmq; nothing is installed.
