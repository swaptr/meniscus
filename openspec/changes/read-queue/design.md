# Design

Motivation is in proposal.md, under "Why". This change applies **last**, after postgres-store (§10). It rebases on the archived text and code of acuity-budget, tray-comparison, bag-alerts, accuracy-views, dietitian-care and scale-store, and on postgres-store's design: an async `Store` over `pg` or PGlite, schema `meniscus` with one versioned baseline, bed locks first, an injected clock. Where those change something, the state below is theirs. Docs were read on 2026-11-04; every external claim links its source.

## 0. Changed types

### packages/shared

```ts
export type BudgetClass = 'critical' | 'routine' // if acuity-budget has not already exported it

export const READ_JOB_KINDS = ['photo', 'voice', 'text'] as const
export type ReadJobKind = (typeof READ_JOB_KINDS)[number]
export const READ_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'expired', 'cancelled'] as const
export type ReadJobStatus = (typeof READ_JOB_STATUSES)[number]
/** `done` reads only. */
export const READ_JOB_OUTCOMES = ['saved', 'nothing_to_chart', 'not_saved'] as const
export type ReadJobOutcome = (typeof READ_JOB_OUTCOMES)[number]
/** `failed`: aiErrorStatus codes plus `interrupted`. `not_saved`: the save rule's code. Closed list. */
export const READ_JOB_ERRORS = [
  'model_api_error', 'model_api_timeout', 'model_api_unreachable', 'model_response_unusable',
  'model_output_invalid', 'invalid_audio', 'interrupted',
  'duplicate_reading', 'forbidden', 'invalid_request',
] as const
export type ReadJobError = (typeof READ_JOB_ERRORS)[number]

export interface ReadJob {
  id: number
  kind: ReadJobKind
  admission_id: number
  status: ReadJobStatus // `queued` past `expires_at` is reported `expired` even before a look stores it (§3.7)
  budget_class: BudgetClass
  /** 1-based, hospital-wide; null unless queued. */
  position: number | null
  /** Estimated start, ISO; null unless queued (§3.2). */
  eta: string | null
  captured_at: string
  expires_at: string
  finished_at: string | null
  /** Upstream requests this read sent: 0 until sent, and for expired and cancelled reads. */
  requests: number
  mode: ReadMode | null
  warnings: string[]
  /** The photo or recording; null for text, and once the media is gone (§3.3). */
  media: MediaRef | null
  /** Text notes only, and only on the bed's chart read. */
  text: string | null
  outcome: ReadJobOutcome | null
  error: ReadJobError | null
  upstream_status: number | null
  saved: { entry_ids: number[]; level_id: number | null; bag_reading_id: number | null } | null
  read_id: number | null
  created_by: StaffRef | null
  read_again_job_id: number | null
}
/** 202 body of POST /api/ai/read, /note, /voice-note (with Prefer: respond-async) and /read-again. */
export interface QueuedRead { queued: ReadJob }

export interface ReadQueueMetrics {
  waiting: Record<BudgetClass, number>
  wait_p95_ms: Record<BudgetClass, number | null>
  last_hour: { sent: number; expired: number; failed: number; cancelled: number }
}

export interface Entry { /* … */ queued_read: boolean }        // BREAKING
export interface EntryList { /* … */ reads: ReadJob[] }        // BREAKING
export interface AdmissionSummary { /* … */ reads_waiting: number } // BREAKING
// scale-store's metrics body gains `read_queue: ReadQueueMetrics`.
```

`packages/shared/src/reads.ts` holds the pure rules moved out of `apps/web/src/lib`, so the bed screen, the round and the queue route a read the same way. The web re-exports them, and its tests keep passing unchanged:
- `levelContainer` and `bagContainer`;
- `routeRead(result) → { kind: 'level' | 'bag' | 'entry' | 'nothing', … }`;
- `toEvidence(result, colour)` and `noteEvidence(result)`, with their bounds;
- `defaultBagEvent(interval)`, built on `emptiedByDefault` and bag-alerts' catheter override (the interval is the catheter order's `measure_every_h` when set, else the ward default);
- the IDDSI seed from the active `thickened_fluids` order.

### @meniscus/meta (transport only; no SQL, no domain words)

```ts
/** Where a RequestBudget keeps its state. Async, like postgres-store's Store. */
export interface BudgetStore {
  /** Runs fn so no other user of this store reads or changes the budget until it resolves. fn gets a store bound to that unit; on a bound store, atomic runs fn in place. */
  atomic<T>(fn: (s: BudgetStore) => Promise<T>): Promise<T>
  /** Send times (epoch ms) after `since`, oldest first. */
  sentSince(since: number): Promise<number[]>
  /** Slots held by open tickets whose lease has not lapsed at `at`: hourly slots not yet sent, and in-flight slots. */
  held(at: number): Promise<{ slots: number; inFlight: number }>
  open(t: { id: string; priority: Priority; slots: number; peak: number; at: number; leaseUntil: number }): Promise<void>
  /** One request of ticket `id` sent at `at`: one held slot becomes a send. */
  sent(id: string, at: number): Promise<void>
  close(id: string): Promise<void>
}
export function memoryBudgetStore(): BudgetStore // today's arrays behind a promise; the default
export interface BudgetOptions { perHour: number; maxConcurrent: number; reservePct?: number; store?: BudgetStore; timeoutMs?: number }
```

`RequestBudget` keeps acuity-budget's contract (`reserve`, `fits`, `acquire`, `stats`, `Ticket`), but `reserve`, `fits`, `acquire` and `Ticket.take` now return promises:
- `reserve(requests, { priority, peak, within? })`: `within` is a bound `BudgetStore` from an enclosing transaction, so the admission and the claim reserve inside their own transaction (§3.2, §3.5). Without it, `reserve` runs in its own `store.atomic`.
- Each `take()` runs in its own `store.atomic`.
- The lease is `at + slots × timeoutMs + 30 000` (§3.11). `stats().total` stays per process.

This makes the budget async, which postgres-store left synchronous and in memory (its §6). With `memoryBudgetStore()`, every promise resolves at once, so the eval and synthesis scripts keep their behaviour.

### Server ports and config

```ts
// apps/server/src/ai/read-queue.ts (domain port; Postgres adapter in src/store/pg/read-queue.ts)
export interface ReadQueue {
  /** One transaction: expire due reads; admit now (returns a ticket), queue (writes media and job) or refuse (queue full). */
  admitOrQueue(a: Action, opts: { prefer: boolean; at: number }): Promise<Admitted | { queued: ReadJob } | QueueFull>
  /** One transaction: expire due reads and lapsed holds, take the head, plan it, reserve, and claim it. Or report when to look next. */
  claimNext(at: number): Promise<{ job: ClaimedJob; ticket: Ticket; plan: Plan } | { next: number | null }>
  cancel(id: number, by: Staff, at: number): Promise<ReadJob | 'not_waiting' | 'forbidden' | undefined>
  readAgain(id: number, by: Staff, at: number): Promise<{ queued: ReadJob } | QueueFull | 'already_read_again' | 'not_readable_again' | undefined>
  forBed(admissionId: number, at: number): Promise<ReadJob[]>
  waitingByAdmission(): Promise<Map<number, number>>
  metrics(at: number): Promise<ReadQueueMetrics>
}
/** The wake channel. pg: a LISTEN on the session client. PGlite: pglite.listen (§8). */
export interface QueueNotifier { start(onWake: () => void): Promise<void>; stop(): Promise<void> }
export interface Clock { now(): number; setTimer(at: number, fn: () => void): () => void } // real one unref()s its timeout
```

`saveRead(t, job, result)` and the job's `finish` run on the bound store of one `store.tx` (§3.6).

- **Config.** `READ_QUEUE_MAX_WAIT_CRITICAL_MIN` and `READ_QUEUE_MAX_WAIT_ROUTINE_MIN` are integers from 1 to 55, defaulting to 10 and 45 (§3.7). They go in `config.ts` and `.env.example`. No database variable is added: the worker uses postgres-store's `DATABASE_SESSION_URL` (§7).
- **Ports.** `AiPorts` is unchanged. The worker gets `{ ports, queue, budget, saveRead, notifier, clock, instance }`.

### Layer ownership

| Module | Layer | Role |
| --- | --- | --- |
| `packages/meta/src/budget.ts` | `@meniscus/meta` | `BudgetStore` port, in-memory default; `RequestBudget` over it |
| `packages/shared/src/reads.ts` | shared, pure | read → record routing, evidence, default bag event |
| `apps/server/src/ai/read-queue.ts` | domain | `ReadQueue` and `QueueNotifier` ports, `eta`, `position`, `Clock` |
| `apps/server/src/ai/read-worker.ts` | domain, over `AiPorts` | the wake rule, the dispatch, the finish |
| `apps/server/src/ai/budget-policy.ts` | domain | acuity-budget's plan/reserve, split into `admit` and `run` |
| `apps/server/src/chart/save-read.ts` | domain | a finished read → its records, in one store transaction |
| `apps/server/src/store/pg/read-queue.ts`, `pg/budget-store.ts`, `pg/notifier.ts` | store | Postgres adapters (`pg` and PGlite through postgres-store's `Db`) |
| `src/db/schema.ts`, `drizzle/0005_*`, `0006_*` | store | the queue's tables and indexes, then RLS and the revoke block in a custom migration (§3.3) |
| `apps/server/src/routes/ai.ts`, `routes/read-jobs.ts` | HTTP | `Prefer`, 202/409/429 mapping, cancel, read-again |
| `apps/web/src/lib/reads.ts`, `components/reads.tsx` | web | read states, copy, actions |

## 1. Context

- **Budget.** acuity-budget's `RequestBudget` is in process memory, and postgres-store keeps it there (its §6). Each action takes a `Ticket` up front: all its requests, plus its in-flight peak. When it does not fit, it gets 429 `request_budget_exceeded` with `Retry-After`, and the web offers Enter by hand. A restart resets the hour, although Meta's real limit does not reset (acuity-budget design §7).
- **Routing.** A read becomes a record only on the phone. `apps/web/src/lib/capture.ts`, `bags.ts` and `evidence.ts` turn it into a level, a bag reading or entries, with the attendant's edits. The ward round saves high-confidence photo reads with defaults (bag-alerts "Save the round"). The server never saves a read on its own today.
- **Store.** postgres-store's async `Store` (`src/store/port.ts`) over a `Db`: a postgres.js client (via Drizzle) on `DATABASE_URL` in production and development (the local stack), and in tests PGlite in-process (a fresh database per test, pool size 1) or a pool on `PG_TEST_URL`. Postgres runs at READ COMMITTED; every write `tx` that reads first locks its bed or ward row first (postgres-store §4.1). SQL never calls `now()`: every time is a parameter from the injected clock.
- **Hosting.** Supabase Postgres, with a separate long-lived Node host (postgres-store §9).

## 2. Goals / Non-Goals

**Goals**
- Every queueable read the local budget would refuse is served within its maximum wait whenever the budget allows it, and is sent at most once.
- The attendant never waits at the bed; the nurse finds the result as a pending entry.
- One SQL design, on Postgres, that runs unchanged on PGlite in tests.

**Non-Goals**
- Recovering from upstream failures (no retries: AGENTS.md).
- More credits. The queue moves demand within the hour; it does not create capacity.
- A general job system for other background work.

## 3. Decisions

### 3.1 Opt-in with `Prefer: respond-async`

`Prefer: respond-async` is RFC 7240 §4.1: the client says it can handle a 202, and the server answers with `Preference-Applied: respond-async`.

**Why opt in.** Only a client that can come back for the result should get a 202. With the header:
- the bed screen and the round send it;
- `scripts/eval.ts`, the synthesis script and every existing test do not, so they keep acuity-budget's fail-fast 429, and acuity-budget's and tray-comparison's citing tests stay valid unchanged;
- without the header, acuity-budget's rule applies as before, even while reads wait.

**Rejected.**
- *Queue everything.* This breaks the scripts' "plan fits the hour" checks and the acuity-budget tests, and a dev script could fill the queue.
- *A form field.* It is non-standard, and `/note` is JSON.

**Not queued.** Reads without a bed (nowhere to save the result); tray reads (§3.9); Explain (the nurse waits for it on screen, and it saves nothing); `/status` (a health check).

### 3.2 Admission in one transaction: now, queued or full

`admitOrQueue` runs in one `store.tx`. The bytes are read (`await file.arrayBuffer()`) and, for a photo or recording, put in the `MediaStore` (s3-media's S3 port, `S3_*` settings, under postgres-store's per-hash `pg_advisory_xact_lock`) before the transaction opens. Inside it, only queries on `t` run (postgres-store §4.1). The steps, in order:
1. `SELECT pg_advisory_xact_lock($class, 1)`: the budget lock (§3.10), first statement after `BEGIN`.
2. Expire the reads that are due (§3.7) and drop lapsed holds (§3.11).
3. If `prefer` and a read of this class or a higher one is waiting, go to step 5. A read never overtakes the waiting reads ahead of it (no back-filling).
4. `plan` + `budget.reserve(…, { within: t.budget })`, as acuity-budget does. If admitted, COMMIT and return the ticket: the route runs the pipeline as today and answers 200.
5. On `MetaBudgetError`, or from step 3:
   - **Not queued.** Without `prefer`, without a bed, or for a kind that is never queued, ROLLBACK and rethrow: 429 as today.
   - **Full.** If `eta > captured_at + maxWait(class)`, ROLLBACK and return `QueueFull` with `retry_after_ms = max(1000, eta − maxWait − now)`. It maps to acuity-budget's 429 `BudgetRefusal` with `limit: "hourly"`.
   - **Queued.** Otherwise take the media hash lock and insert the media row (postgres-store §4.6, step 2), insert the `read_job` row, and `SELECT pg_notify('meniscus_read_queue', '')`. A critical read also raises its bed's waiting routine reads (`UPDATE meniscus.read_job SET budget_class = 'critical', priority = 0 WHERE admission_id = $1 AND status = 'queued'`); `expires_at` is unchanged. COMMIT, wake the local worker, and answer 202.

A refused or full read leaves its bytes in the `MediaStore` with no row; s3-media's `media:sweep` removes such objects (over one hour old), as it does for any upload whose transaction rolled back.

**The estimated start.** With C = cap, R = reserve and ceiling(critical) = C, ceiling(routine) = C − R:
- W = the window's send times, oldest first;
- H = slots held by open, unlapsed tickets;
- A = the sum of `needs` (fewest requests: photo 1, voice 2, text 1) of waiting reads ahead (for routine: every critical read and older routine reads; for critical: older critical reads);
- k = |W| + H + A + needs − ceiling.

`eta` follows from k:
- k ≤ 0: now;
- 1 ≤ k ≤ |W|: W[k] + 1 h;
- k > |W|: now + 1 h.

`eta` ignores in-flight limits and later critical arrivals, so the screen says "about". `position` = 1 + the number of waiting reads ordered before it by `(priority, created_at, id)`.

### 3.3 Data model (a new Drizzle migration)

The store's schema is `apps/server/src/db/schema.ts` and its committed Drizzle migrations (`apps/server/drizzle/`, journal `meniscus.drizzle_migrations`; server/storage "Schema migrated on start"). At apply time the latest journal entry is `0004_media_link_trigger` (scale-store); if not, stop: changes were applied out of order. The three tables and their indexes go in `schema.ts`, and `pnpm --filter @meniscus/server db:generate` writes `0005_*`. RLS, the revoke block and any trigger go in a custom migration (`drizzle-kit generate --custom`, `0006_*`), as `0001_triggers_and_grants.sql` and `0004_media_link_trigger.sql` do. The tables are new and empty, so no backfill and no data is touched; existing rows are never dropped or rewritten. Types: `integer` identities, `timestamptz` times, `jsonb`, `text` + CHECK rather than enums. The SQL below is the target shape the migrations must produce.

```sql
CREATE TABLE meniscus.read_job (
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('photo','voice','text')),
  admission_id integer NOT NULL REFERENCES meniscus.admission(id),
  budget_class text NOT NULL CHECK (budget_class IN ('critical','routine')),
  priority integer NOT NULL CHECK (priority IN (0, 1)),           -- 0 critical
  needs integer NOT NULL CHECK (needs BETWEEN 1 AND 2),          -- fewest requests: photo 1, voice 2, text 1
  requested_mode text CHECK (requested_mode IN ('spark','sam+spark')),
  hint text, languages text, note_text text, duration_ms integer,
  media_id integer REFERENCES meniscus.media(id) ON DELETE SET NULL,
  created_by integer REFERENCES meniscus.staff(id),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','expired','cancelled')),
  claimed_at timestamptz, finished_at timestamptz, ticket text UNIQUE,
  mode text CHECK (mode IN ('spark','sam+spark')),
  requests integer NOT NULL DEFAULT 0, warnings jsonb NOT NULL DEFAULT '[]',
  outcome text CHECK (outcome IN ('saved','nothing_to_chart','not_saved')),
  error text, upstream_status integer,
  read_id integer REFERENCES meniscus.model_read(id), saved jsonb,
  read_again_of integer REFERENCES meniscus.read_job(id),
  CONSTRAINT read_job_read_again_once UNIQUE (read_again_of)
);
CREATE INDEX read_job_waiting ON meniscus.read_job (priority, created_at, id) WHERE status = 'queued';
CREATE INDEX read_job_bed ON meniscus.read_job (admission_id, created_at);
CREATE INDEX read_job_running ON meniscus.read_job (claimed_at) WHERE status = 'running';
CREATE INDEX read_job_read ON meniscus.read_job (read_id) WHERE read_id IS NOT NULL;

CREATE TABLE meniscus.model_request (            -- the budget's rolling hour
  id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sent_at timestamptz NOT NULL, priority text NOT NULL, ticket text
);
CREATE INDEX model_request_sent ON meniscus.model_request (sent_at);

CREATE TABLE meniscus.budget_hold (              -- open tickets
  ticket text PRIMARY KEY, instance text NOT NULL, priority text NOT NULL,
  slots integer NOT NULL, peak integer NOT NULL,
  opened_at timestamptz NOT NULL, lease_until timestamptz NOT NULL
);

-- No bed-version trigger: scale-store's version triggers moved to scale-store-followups and do not exist yet.
-- When that change lands, it adds read_job to its bumped tables.
ALTER TABLE meniscus.read_job ENABLE ROW LEVEL SECURITY;
ALTER TABLE meniscus.model_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE meniscus.budget_hold ENABLE ROW LEVEL SECURITY;
-- then 0001's IF EXISTS (pg_roles …) revoke block, for these three tables and their sequences (custom migration)
```

- **Naming.** Singular tables and `<table>_<purpose>` indexes, as in `0000_baseline.sql` (`read_link_once`, `meal_event_meal`).
- **The bed version.** No bump trigger now (see the SQL note). The chart read computes `reads` and `reads_waiting` on each request, so no cache can go stale.
- **RLS.** Enabled, no policy, nothing granted to `anon`, `authenticated` or `service_role`. postgres-store's start-time check covers the three tables with no change (server/storage "Tables closed to Supabase's APIs").
- **One row per request.** `model_request` has one row per upstream request, so exact timestamps keep acuity-budget's `retryAfterMs` arithmetic: "Retry time" gives 1,200,000 ms. Per-minute buckets would round it. Rows older than 1 h are deleted in each `open`.
- **Counting a read's requests.** The server adapter's `sent(ticket)` also runs `UPDATE meniscus.read_job SET requests = requests + 1 WHERE ticket = $1`, so a read's `requests` survives pruning and restarts.
- **No int8.** Aggregates are cast (`count(*)::int`), so `pg` and PGlite return the same numbers (postgres-store §4.2).
- **The bed list.** `reads_waiting` comes from `read_job_bed`, grouped per ward in the existing list query.
- **Marking entries.** `queued_read` is derived, not stored: an entry is marked when a `done` `read_job`'s `read_id` has a `read_link` naming the entry, or naming the level or bag reading whose drop or rise the entry charts (`entry.level_id`).
- **Media.** A queued read's media is unlinked until its records link it, so scale-store's 24 h unlinked expiry is far beyond the 55-minute ceiling on waiting. After `failed`, `expired` or `cancelled`, the photo stays linkable for the rest of those 24 h ("Enter by hand", Read again). When the expiry deletes the media row, `ON DELETE SET NULL` clears `media_id`, so the delete never fails on this table; such a read answers Read again with 409 `not_readable_again`.

### 3.4 The budget moves into the database

- **Why now.** The claim must check the budget and hold its requests in the same transaction that marks the read `running` ("Each read sent by one worker"). With the budget in memory, that holds only within one process. The database also keeps the hour across restarts, which closes acuity-budget's per-process risk.
- **The port.** `BudgetStore` lives in `@meniscus/meta` as an interface (no SQL). The adapter lives in `apps/server/src/store/pg/budget-store.ts`, over postgres-store's `Db`.
- **`atomic`.** Unbound, it opens a `store.tx` whose first statement is the budget lock. Bound to an enclosing transaction (`within`), it runs in that transaction, which has already taken the lock. It never opens a second transaction from inside one: on PGlite the pool has one connection, so a nested checkout would wait for itself (§8.3).
- **Wiring.** `index.ts` opens the store, then calls `configureModelApi({ budgetStore: store.budget, timeoutMs })` before `createApp`, so `metaClient()` builds its `RequestBudget` over the database. `testing.ts`'s `upstream()` keeps the in-memory store unless a test passes the test database's.
- **Ticketless calls.** `models.list` and the scripts use `acquire()`, which still opens a 1-slot hold and sends at once. The scripts keep `memoryBudgetStore()`, as today.

### 3.5 The worker: woken, never polling

There is one worker per process.
- **Triggers.** `wake()` coalesces with a `setImmediate` flag, so there is at most one pending look. It is called:
  - after this process commits an enqueue, a cancel or a Read again;
  - after this process closes any ticket (any admitted action ending: synchronous or queued);
  - on a notification on `meniscus_read_queue` from any process sharing the database (§3.10);
  - when the single timer fires;
  - once at start, and once after the listener reconnects, because notifications may have been missed. That is one look per event, not a poll.
- **A look** loops on `claimNext(now)`. Each claimed read is dispatched without awaiting it, and the loop stops at the first `{ next }`. It then clears the old timer and sets one for `next`, or none when `next` is null.
- **`next`** is the earliest of:
  - the instant the hourly window admits the head read: `W[k] + 1 h`, with k as in §3.2 but A = 0. When the excess is held by running actions rather than sent, there is no window instant: their release wakes the worker;
  - the earliest `expires_at` of the waiting reads;
  - the earliest `lease_until` of the open holds, while any read waits or runs (§3.11).

  It is null when nothing waits and nothing runs.

`claimNext` runs in one transaction on the worker's session connection (§7):

```sql
BEGIN;
SELECT pg_advisory_xact_lock($1, 1);                                  -- the budget lock, released at COMMIT
UPDATE meniscus.read_job SET status = 'expired', finished_at = $2
  WHERE status = 'queued' AND expires_at <= $2;
UPDATE meniscus.read_job j SET status = 'failed', error = 'interrupted', finished_at = $2
  FROM meniscus.budget_hold h
  WHERE j.status = 'running' AND h.ticket = j.ticket AND h.lease_until <= $2;   -- §3.11
DELETE FROM meniscus.budget_hold WHERE lease_until <= $2;
SELECT sent_at FROM meniscus.model_request WHERE sent_at > $2 - interval '1 hour' ORDER BY sent_at;
SELECT coalesce(sum(slots), 0)::int, coalesce(sum(peak), 0)::int FROM meniscus.budget_hold;
SELECT * FROM meniscus.read_job WHERE status = 'queued'
  ORDER BY priority, created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED;
-- app: plan(head, budget): acuity-budget's hourly fits, so the mode is picked now, with scale-store's pressure rule
-- no fit (hourly or concurrent) → COMMIT, return { next }
INSERT INTO meniscus.budget_hold (…) VALUES (…);                         -- reserve(…, { within })
UPDATE meniscus.read_job SET status = 'running', claimed_at = $2, mode = $3, ticket = $4
  WHERE id = $5 AND status = 'queued';                                -- rowCount must be 1
SELECT pg_notify('meniscus_read_queue', '');                            -- only if a read was failed above
COMMIT;
```

`$2` is the injected clock's time, never `now()` (postgres-store §4.1).

**Dispatch** runs outside any transaction:
- it rebuilds the pipeline input from the row: the media bytes from the `MediaStore`, `hint`, `languages`, `note_text`, `duration_ms` and `requested_mode` (null → `READ_USE_SAM`);
- it runs `ai.readCapture`, `ai.voiceNote` or `ai.parseNote` with `{ signal, ticket }`, where the signal is a per-read controller that is aborted on shutdown. Each upstream request runs `ticket.take()` first (its own budget transaction);
- then `saveRead` and the job's finish run in one `store.tx` (§3.6), followed by `ticket.release()` in `finally`, which closes the hold, notifies and wakes the local worker.

**At most once.**
- A row leaves `queued` only through the guarded `UPDATE`, and nothing ever sets it back.
- `failed` is final, and the finish is guarded too (`WHERE id = $1 AND status = 'running'`).
- A read whose server died ends `failed: interrupted` once its lease lapses (§3.11), because its requests may have reached Meta.
- No code path re-reads a row. Read again creates a new row (`read_job_read_again_once`).

This keeps the AGENTS.md rule: each user action makes a fixed number of upstream calls, and the bash guard's loop patterns never apply, because no script loops on `/api/ai`.

**Why it is not polling.**
- With nothing waiting or running, there is no timer.
- With reads waiting, exactly one timer is set, for a computed instant (the scenario "One timer").
- The timers are `unref()`ed, and the `Clock` is injected, so tests advance time without real sleeps.

### 3.6 What a finished read saves

`saveRead(t, job, result)` runs in one `store.tx`, as `job.created_by`, with read-outcomes' link written by the server: same staff, same bed, a fresh read, so its link checks hold by construction. Requests made: 0. The transaction:
1. `SELECT 1 FROM meniscus.admission WHERE id = $1 FOR UPDATE`: the bed lock, first (postgres-store §4.1; `saveRead` joins its lock-first list).
2. Insert the `model_read` row ("Reads are logged").
3. `SAVEPOINT records`, then the records below, through the bound store's own methods (their bed lock re-locks a row this transaction holds, which does not wait). Their link check, fall guard and duplicate check run after the lock, as for an HTTP post.
4. On a save-rule refusal: `ROLLBACK TO SAVEPOINT records`. This covers bag-alerts' `DuplicateReading` (409), bag-emptying's `Forbidden` fall guard (403) and a validation failure (400). The read ends `done`, `outcome: not_saved`, and `error` holds the rule's code. Nothing is retried. The model read stays, so its drafts are logged.
5. The guarded finish: `UPDATE meniscus.read_job SET status = 'done', outcome = …, saved = …, read_id = …, finished_at = $2 WHERE id = $1 AND status = 'running'`. COMMIT.

A pipeline failure skips steps 2–4 and finishes `failed` with the error code, in a transaction of its own.

The records by kind:
- **Photo** (`routeRead`, shared with the round):
  - **Jug or bottle with a volume.** `addLevel` (`source: photo`, evidence, `media_id`) creates the level and its drop entry. A level has no charted time in level-pairing, so it is saved when read. Giving it the capture time would need out-of-order pairing rules that level-pairing does not have.
  - **Urine, stoma or drain bag with a volume.** `addBagReading` with `event: defaultBagEvent(interval)` and `charted_at: captured_at`. The interval is the bed's catheter `measure_every_h` when its order sets one, else the ward default (bag-alerts). The urine colour comes from the draft. `urine_rgb` and `evidence.colour` are null, because the phone samples them from the segmentation and no phone is present. A reading charted before the bag's newest one follows bag-periods' late-reading rule; an attendant's `emptied` reading charted inside a fall gets the 403 (step 4).
  - **Any other draft with volume ≥ 1.** `addEntry` (`source: photo`, `charted_at: captured_at`, evidence, `media_id`). `iddsi_level` is seeded from the active `thickened_fluids` order, by the same rule the bed screen uses (moved to shared).
  - **Otherwise.** Nothing is saved: `nothing_to_chart`.
- **Voice and text.** One `addEntry` per draft with volume ≥ 1 (`source: voice | text`, `noteEvidence`, the recording's `media_id` for voice, `read_draft` = index). None saved means `nothing_to_chart`.
- **Low confidence.** It is saved anyway. Every entry is pending, and `queued_read` entries are left out of batch approval ("Batch approve high confidence"), so a nurse looks at each one. The round's 0.75 auto-save threshold exists because the round saves for the attendant. Here, a nurse decides.
- **Charted time.** Entries and bag readings take `charted_at = captured_at`. Their `late` flag follows the existing rule (§3.7).
- **A duplicate the nurse wants anyway.** The read shows `not_saved` with `duplicate_reading`; the nurse enters the reading by hand with "Save anyway" on the by-hand form, which bag-alerts already provides, using the read's photo as `media_id`.

### 3.7 Expiry and the maximum wait

- **Expired is a fact of the clock.** Every reader reports `queued` with `expires_at ≤ now` as `expired`. `admitOrQueue`, `claimNext` and the expiry timer persist it. So no read is ever sent after its expiry, whatever the look's timing.
- **Why 45 minutes for routine reads, not 60.** An entry is `late` when it is recorded more than `LATE_ENTRY_MINUTES` (60) after its charted time. A queued entry is charted at capture and recorded once it is read: at most the wait plus about 3 minutes (two 90 s `MODEL_API_TIMEOUT_MS` steps). With 60 minutes, a queued read could be flagged late, and count against the ward's data quality, purely for waiting. The cap of 55 keeps this true for any configured value.
- **Why 10 minutes for critical reads.** A critical bed is read hourly, and a reading more than 10 minutes stale is better charted by hand.

### 3.8 Cancel and Read again

- **Cancel.**
  - It needs the staff member who queued the read, or `DECIDER_ROLES`.
  - It is one guarded statement, `UPDATE meniscus.read_job SET status = 'cancelled', … WHERE id = $1 AND status = 'queued'`, plus `pg_notify`, in one transaction. A guarded single-statement update needs no bed lock (postgres-store §4.1). When nothing changes, the answer is 409 `not_waiting`.
  - "Enter by hand instead" on the capture screen uses it, so a by-hand entry and the queued read never both chart. If the read is already `running`, the screen does not open the by-hand form.
- **Read again.**
  - The route is `POST /api/ai/read-again`. It sits under `/api/ai`, so the session check and the AI rate limiter apply (deploy-ready removed the bearer token), and it is one user action.
  - It is allowed only for `failed` and `expired` reads whose media still exists (text needs none).
  - It runs as `admitOrQueue` does, under the budget lock, and always queues. Under the lock it checks that no row has `read_again_of` = the old id, so a second tap answers 409 `already_read_again` without relying on the unique constraint. `read_job_read_again_once` stays as a backstop and is never expected to fire.
  - The new row copies the old row's media, text, hint, languages and requested mode, with `created_by` = the tapper and the class from the bed's status now. The worker is woken at once, so a read that fits is sent immediately.

### 3.9 What is not queued, and why

- **Tray reads.**
  - tray-segmentation's meal proof records "the portion, items, fluid mL and dishes staff confirmed". A meal saved by the server would claim a confirmation nobody made.
  - A "tray read ready, open the meal form" step would be a second delivery path, with its own stored result and its own GET.
  - The Meal form already works by hand at 0 requests and keeps the tray photo.
  - Trays are also first to give way under pressure (scale-store's pressure rule).
  - A later change can add the confirm path.
- **Explain and `/status`** are interactive and save nothing.

### 3.10 Locks, in postgres-store's terms

| Lock | Taken by | Why |
| --- | --- | --- |
| budget: `pg_advisory_xact_lock($class, 1)`, two-key form | admission, claim, Read again, every unbound `BudgetStore.atomic` (`take`, `acquire`), as the first statement after `BEGIN` | one budget decision at a time across processes, for about a millisecond each |
| bed row, `FOR UPDATE` | `saveRead`, first | postgres-store §4.1: a write `tx` that reads first locks the bed |
| `read_job` row | the guarded updates (claim, cancel, finish, raise) | each decides one row's state in one statement |
| media hash, `pg_advisory_xact_lock(hashtextextended(sha256, 0))` | admission of a queued photo or recording, after the budget lock | postgres-store §4.6 |

- **Key spaces.** The budget lock uses the two-key form with a fixed `meniscus` class id. "A single 64-bit key value or two 32-bit key values (note that these two key spaces do not overlap)" ([advisory lock functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS)), so it can never collide with postgres-store's single-key media hash lock or any schema lock it takes at start.
- **Order.** Budget lock, then media hash lock, then rows. No transaction takes the budget lock while holding a bed lock: `saveRead` takes none, and the `take()` calls run outside it. So no cycle exists.
- **SKIP LOCKED.** A cancel holds its row lock for one statement without the budget lock. With `FOR UPDATE SKIP LOCKED` ([locking clause](https://www.postgresql.org/docs/current/sql-select.html#SQL-FOR-UPDATE-SHARE)), the claim takes the next read instead of waiting. The skipped read is being cancelled, and if it is not, the next look claims it.
- **Not SERIALIZABLE.** It aborts conflicting transactions with SQLSTATE 40001, and the application "must be prepared to retry" ([serializable](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-SERIALIZABLE)). That is a loop, even if a database one. postgres-store rejected it for the same reason.
- **The wake.** Enqueue, cancel, Read again, every hold close and a lease sweep that failed a read run `SELECT pg_notify('meniscus_read_queue', '')` in their transaction. The payload is empty: no patient data. "The notify events are not delivered until and unless the transaction is committed", identical ones in one transaction are folded, and a listener inside a transaction gets them "just after the transaction is completed" ([NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)). A process also gets its own notifications back ("just like all the other listening sessions"), which the coalesced `wake()` absorbs.

### 3.11 Leases and recovery

- Every hold has `lease_until = opened_at + slots × MODEL_API_TIMEOUT_MS + 30 s`. The pipeline's requests each end within `MODEL_API_TIMEOUT_MS`, so a live action always closes its hold first.
- `held()` ignores lapsed holds, and the claim deletes them. A `running` read whose hold lapsed ends `failed: interrupted` in the same transaction ("Queued reads survive a restart: Stopped mid-read"). This is the same rule for one process (the embedded database) and for several on Supabase, so there is no start-time sweep that could fail another live process's reads.
- `instance` (a random id per start) is kept for logs and metrics only; no rule depends on it.

## 4. Per capture kind

| Capture | Queued? | Requests when sent | What the server saves |
| --- | --- | --- | --- |
| Photo of a cup, urinal, commode pan, vomit bowl… | yes | 3 `sam+spark` / 1 `spark` | one pending entry, charted at capture |
| Photo of a jug or bottle | yes | 3 / 1 | level + drop entry, saved when read |
| Photo of a urine, stoma or drain bag | yes | 3 / 1 | bag reading with the bed's default event (`emptied` for an interval of 4 h or more, catheter order first, else `check`) + rise entry |
| Voice note | yes | 2 (1 when speech-to-text fails) | one pending entry per draft with a volume |
| Text note | yes | 1 | the same |
| Ward round photo or recording | yes, per reading | as above | as above; the round skips it on save |
| Tray photo | no | — | — (429 + the by-hand Meal form) |
| By-hand entry, level or bag reading | n/a | 0 | — |

## 5. Delivery to the web: chart refresh, not SSE

**Chosen: the existing chart reads.**
- `GET /api/admissions/:id/entries` returns `reads`, and the new entries appear in it as pending entries.
- `GET /api/admissions` items carry `reads_waiting`.
- The bed review and the ward dashboard already refresh every 30 s (`routes/n/$id.tsx`, `routes/n/w.$ward.tsx`).
- The attendant's capture screen gains the same 30 s refresh, but only while the bed has a read waiting or running.

None of these is an `/api/ai/*` request, so `.claude/rules/web.md` holds.

**Why not server-sent events from our server.**
- An SSE stream is a long-lived connection per open screen, on low-end Android over hospital Wi-Fi, with reconnect logic, proxy buffering and background-tab throttling.
- The worker would need to fan out to those connections, across instances.
- A read waits minutes, so a ≤ 30 s delay costs nothing clinically, and the nurse approves on her own round anyway.
- The 30 s chart read already exists and is cheap (acuity-budget design §1: bed review p50 10–34 ms at 500 beds).

**Why not Supabase Realtime.** The web talks only to our server, over HTTP (AGENTS.md). Realtime would put supabase-js, a Supabase session and RLS policies for patient rows into the browser (https://supabase.com/docs/guides/realtime).

## 6. Queue technology: our own table

**Chosen: `meniscus.read_job` behind `ReadQueue`**, claimed with `FOR UPDATE SKIP LOCKED` under the budget lock, woken by LISTEN/NOTIFY plus one timer. No dependency, one source of truth, and the budget checked and held in the claim's transaction.

**Rejected: pg-boss** (12.38.0, https://pgboss.io/, https://github.com/timgit/pg-boss/releases).
- Our gate is the request budget, not worker capacity: a read may be claimed only when its 1–3 requests fit its class's ceiling and the in-flight slots, decided in the claim's transaction. pg-boss's `fetch()` could only do that inside our transaction through a per-call `db`, rolled back when the head does not fit (https://pgboss.io/api/adapters).
- We need our own row anyway (chart reads per bed, `position` and `eta` over every waiting read, visible `expired`, `failed`, `cancelled` and `not_saved`, foreign keys), so pg-boss would be a mirror updated in every transaction.
- Queued-job expiry is a deletion at maintenance (`retentionSeconds`, https://pgboss.io/api/queues), not a visible `expired` at the instant.
- Its workers poll every `pollingIntervalSeconds`, and with LISTEN/NOTIFY still every `notifyPollingIntervalSeconds` "as a safety net" (https://pgboss.io/api/workers), plus its maintenance timers: our database, not the model API, but more background work on Supabase's connection limits.
- It needs its own schema (`pgboss`), outside postgres-store's `meniscus` RLS check.
- Its PGlite backend shows the same limit as ours: "PGlite serializes everything through one connection" (https://pgboss.io/database-backends), so it would not test contention either.

**Rejected: Supabase Queues (pgmq)** (https://supabase.com/docs/guides/queues, https://github.com/pgmq/pgmq).
- No priority: one queue per class and no single order for `position`.
- A read that is not deleted or archived becomes visible again after its timeout and is re-delivered; at most once needs `pop`, which deletes on read.
- The same mirror row and in-transaction budget check, plus the `pgmq_public` schema exposed through the Data API, which we would have to keep unexposed.

## 7. Connections (Supavisor)

From https://supabase.com/docs/guides/database/connecting-to-postgres, as postgres-store §7 records: the direct connection and Supavisor session mode (5432) keep session features; transaction mode (6543) loses `LISTEN`/`NOTIFY` and session-level advisory locks.

- **The worker's connection.** Each process takes one `Client` from postgres-store's session factory (`connect.ts`), on `DATABASE_SESSION_URL`: the direct connection when the host has IPv6 egress or the IPv4 add-on, else the session pooler on 5432. Never 6543: the config already refuses it (server/storage "Session connection").
- **What runs on it.** The `LISTEN meniscus_read_queue` (pg delivers notifications on the `Client`'s `notification` event, https://node-postgres.com/apis/client) and every `claimNext` transaction, one at a time. A notification that arrives during a claim is delivered after its COMMIT (§3.10), so one client serves both.
- **What runs on the request pool** (`DATABASE_URL`): admission, cancel, Read again, `saveRead` and the finish, and each `take()` and hold close. These use only transaction-scoped advisory locks and row locks, so they work in any pooler mode, 6543 included.
- **Reconnect.** On the client's `error` or `end`, the notifier drops it and takes a new client at the next local wake, then runs one look. It sets no reconnect timer: the local events (enqueue, release, the queue timer) keep happening while the process serves requests.
- **On PGlite** there is no second connection: §8.

## 8. PGlite: what it can show, and the test strategy

### 8.1 Findings (docs first, then the shipped source)

| Feature | PGlite 0.5.x | Source |
| --- | --- | --- |
| Connections | One. "PGlite is single user/connection" (README); "PGlite only has a single exclusive connection to the database" (docs). `createPgConfig` fixes the pool at 1 (`poolSize = 1 // PGlite is single connection at the moment`) | https://github.com/electric-sql/pglite/blob/main/README.md, https://pglite.dev/docs/, `packages/pglite/src/node-postgres/index.ts` |
| Serialised queries | Yes: the instance runs queries and transactions under mutexes (`#queryMutex`, `#transactionMutex`). pg-boss's docs: "PGlite serializes everything through one connection … PGlite queues requests internally" | `packages/pglite/src/pglite.ts`, https://pgboss.io/database-backends |
| `FOR UPDATE SKIP LOCKED` | Accepted: it is real Postgres 18. pg-boss: "`SELECT FOR UPDATE SKIP LOCKED` … all work". With one session, no other transaction ever holds a row lock, so the skip path never runs | https://pgboss.io/database-backends |
| Advisory locks | The functions exist. With one session they never wait: "If a session already holds a given advisory lock, additional requests by it will always succeed … regardless of whether the existing lock hold and new request are at session level or transaction level" | https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS |
| LISTEN/NOTIFY | Yes, in-process: `listen(channel, cb)` "Subscribe to a pg_notify channel", `onNotification`. pg-boss: "LISTEN/NOTIFY works entirely in-process". In the source, notifications in any protocol response (the `pg` adapter's path included) reach the `listen` callbacks through `queueMicrotask` | https://pglite.dev/docs/api#listen, https://pgboss.io/database-backends, `pglite.ts` `#parse` |
| pglite-socket | Several clients, but "through a multiplexer over the single conn", and "not all cases might be covered": still serialised | https://pglite.dev/docs/pglite-socket |

The earlier unconfirmed finding holds: PGlite cannot show two transactions contending, for a row lock or for the advisory lock, in-process or over pglite-socket.

### 8.2 What runs where

- **PGlite (the suite and the lab fake server).** Every scenario of every requirement here runs on a `clone()` of postgres-store's template with the schema, in-process, network-free.
- **"Two servers on one database"** in tests are two `createApp` instances over **one** PGlite `Db`: two `ReadQueue`s, two workers, two clocks' timers, two notifier subscriptions, two in-memory reuse caches, sharing the one pool. A second `createPgConfig` pool over the same instance is not used: it would put two protocol streams onto the one backend session, and their transactions would interleave.
- **The notifier on PGlite** is `pglite.listen('meniscus_read_queue', wake)`, registered once at start before the app serves. It is not a pooled client: holding the pool's one client for `LISTEN` would block every query. A `LISTEN` sent while a pool transaction is open would join that transaction on the one session, which is why it runs only before serving.
- **The claim on PGlite** runs on the shared pool, not a session client.

### 8.3 Proving the concurrency rules without contention

- **Single outcome per race, by interleaving at the await points.** The suite drives the orders a real database can produce, with deferred fakes: a cancel committed before the claim, and after it; two workers' claims back to back for one read; two Read again taps; an enqueue between a look's `claimNext` calls; a finish after a lease sweep. Each asserts the one outcome and the upstream request count. This is how "Each read sent by one worker: Woken together" is cited.
- **Lock-first guard** (postgres-store §5's recording `Db` wrapper, extended). It fails a test when:
  - an admission, claim, Read again or unbound `atomic` transaction does not run `pg_advisory_xact_lock($class, 1)` as its first statement after `BEGIN`;
  - the claim's head `SELECT` lacks `FOR UPDATE SKIP LOCKED`, or its `UPDATE … AND status = 'queued'` is not asserted to change exactly 1 row;
  - `saveRead` does not lock the bed first;
  - a query goes to the pool while that flow's transaction holds the pool's client. On PGlite that query would wait for itself, so the wrapper turns a hang into a named failure.
- **The lock is held.** Inside a claim transaction, `SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND classid = $class AND objid = 1` is 1, and 0 after COMMIT.
- **The wake path.** In-process notifications prove: one wake per committed enqueue, cancel and hold close; none for a rolled-back transaction; one for two identical `pg_notify` calls in one transaction; and "Queue woken, never polled: Woken by another server" across the two app instances.
- **Spike first** (task 1.4): each row of §8.1 checked on the pinned PGlite through `createPgConfig`, plus `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` and the `notification` delivery while no pool transaction is open. If notifications from the `pg` path do not reach `listen`, the PGlite notifier falls back to the local `wake()` calls alone, which already cover every event in one process, and "Woken by another server" runs on a shared in-process bus that the PGlite notifier publishes to after each commit.
- **Real contention, user-run.** `pnpm --filter @meniscus/server test:pg` runs `read-queue.contention.test.ts` against `PG_TEST_URL` (postgres-store's opt-in real-Postgres URL: the local stack or a Postgres 15+, supplied by the user; skipped without it, so the suite stays network-free). Two pools of 2 on that URL, 20 queued text notes, 2 workers woken together: each read claimed once and sent once to a fake upstream (0 model requests); a cancel held open in a second session is skipped by the claim, not waited on; a notification from one pool's commit reaches the other's listener. It cites no requirement: the citing tests are the PGlite ones. postgres-store's user-run task 11.3 smoke test is where the app first runs against Supabase.

## 9. Supabase specifics

- **pg_cron** (https://supabase.com/docs/guides/cron): not used. Correctness does not depend on a sweep (§3.7), the app sets its own timer anyway, and `model_request` is pruned in each hold transaction. Retention purges of old finished `read_job` rows could later be a cron job or an app step.
- **Supabase Queues**: not used (§6). **Realtime**: not used (§5).
- **The Node host.** Edge Functions cannot hold a `LISTEN` connection and timers indefinitely (150 s / 400 s wall clock, https://supabase.com/docs/guides/functions/limits). postgres-store §9's long-lived Node host serves; the queue adds no requirement beyond its session connection on 5432.

## 10. Order and overlaps

**Apply order** (the coordinator's, 2026-11-04): drink-types → deploy-ready → s3-media → ui-polish → labeled-photo-copy → postgres-store → scale-store → **read-queue**. Everything before drink-types (tray-segmentation through dietitian-care, bag-emptying, care-plan, image-synthesis) is archived. postgres-store removed SQLite. The Postgres `SCHEMA_VERSION` is 1 after postgres-store, 2 after scale-store, and goes 2 → 3 here.

| Change | Overlap | Resolution |
| --- | --- | --- |
| **acuity-budget** | Classes, reserve, `Ticket`, `withBudget`, the 429 `BudgetRefusal`, "Budget refusal offers manual entry" | Builds on it. `withBudget` splits into `admit` (in `admitOrQueue` / `claimNext`) and `run`. The 429 body is reused for "Queue full". Its web refusal screen is unchanged and still shows for queue-full and header-less refusals. Its out-of-scope "queued or deferred reads" is now this change. |
| **tray-comparison** (its design §14, tasks 11.4) | MODIFIES "Whole action admitted up front" and "Read mode fits the budget" | "Whole action admitted up front" copies tray-comparison's text (the comparable served photo, the status check) and replaces only its last sentence. Trays are not queued, so its served-tray admission (5 requests) is untouched. |
| **scale-store** | "Read mode fits the budget" (the latest earlier text: in-flight sentence, "Busy, not downgraded", served-tray exception, pressure rule, `MODEL_API_MAX_CONCURRENT` ≥ 2), `/api/metrics`, `media.linked_at`, version triggers | The MODIFIED block copies scale-store's text and scenarios, adding "or queued" twice and "Busy, queued". `read_queue` is ADDED to `server/metrics`. `read_job` gets no bed bump trigger until scale-store-followups adds the version triggers (§3.3). |
| **read-outcomes** | `model_read`, `read_link`, link checks, outcomes | The queue writes the read and its links in the save transaction, after the bed lock (checks hold by construction). MODIFIED "Reads are logged" copies its text and adds the queued read. A queued entry's outcome follows the nurse: never `edited_at_capture`. |
| **accuracy-views** | "Unsaved drafts" (MODIFIED there, with `retaken`), "Negative reads", "Retaken tray reads", the summary | ADDED "Queued reads in the accuracy numbers" applies before "Outcome of a saved level", "Unsaved drafts" and "Negative reads": a queued read counts only through the entries it saved. So its unsaved drafts never become `open` or `abandoned` (nobody chose to drop them), and a queued negative read is never `negative_confirmed` (nobody confirmed it). `retaken` needs `tray` reads, which are never queued, and a queued photo read is never a "later `tray` read", so `retaken` is unaffected either way. Without a MODIFIED copy of those three blocks, later edits to them need no re-copy here. |
| **bag-emptying / bag-alerts** | Default event and catheter override, 409 `duplicate_reading`, 403 fall guard, late readings, round per-reading switch | The queue uses `defaultBagEvent` with the catheter's `measure_every_h` first. 409 and 403 become `not_saved` with the code, after the bed lock and the link check, in the order postgres-store §4.1 keeps. A queued round reading has no switch: it takes the default, as "Save the round" does for an unchanged switch. |
| **level-pairing** | A level has no charted time | Queued levels are saved when read (§3.6). |
| **dietitian / dietitian-care** | Meals, diet orders | None: trays are not queued. |
| **postgres-store** | Async store, schema `meniscus` and its version, bed locks, session URL, RLS check, PGlite test database, `PG_TEST_URL` | Applied first. The queue adds its tables as Drizzle migrations `0005`/`0006` (after scale-store's `0004`), joins the lock-first guard (§8.3), uses the session factory (§7), and is covered by the RLS check. Its "Session connection" requirement already names the queue worker. |

## 11. Risks / Trade-offs

- **[Upstream failures still fail]** → The proposal says so plainly. Read again is one tap, and Enter by hand always works at 0 requests.
- **[Nobody checks the volume at the bed]** → Every entry is pending and marked `Queued read · check`, and it is left out of batch approval. Queued levels, bag readings and unsaved drafts are left out of accuracy numbers.
- **[A wrong queued level becomes the next baseline]** → The same as a wrong level saved at the bed today. The drop entry is pending, and the nurse can reject it. bag-emptying's fall prompt catches a bag that later falls.
- **[A routine read starves behind critical reads]** → It expires at 45 minutes with 0 requests, and staff see "Not read within 45 min. Enter by hand." The queue-full check refuses at once what cannot be served in time.
- **[Under saturation most photos run in `spark` mode]** → Slots free one at a time as the window rolls, so the head read is admitted as soon as 1 fits (acuity-budget's rule). The `budget pressure` warning stays on the evidence.
- **[Head-of-line blocking]** → A `sam+spark` read waiting for 2 in-flight slots holds up a text note that needs 1. This lasts seconds, and it keeps order.
- **[A class fixed at enqueue]** → A bed that turns critical keeps its waiting routine reads routine, unless a critical read for it is queued (the raise). The nurse can cancel and read again.
- **[Clock jumps on the host]** → Timers are re-armed after every look. A late timer only delays a read, and expiry is computed from timestamps.
- **[A dead process holds slots until its lease lapses]** → At most `slots × MODEL_API_TIMEOUT_MS + 30 s` (about 5 min for a photo read). The queue timer includes the earliest lease, so the slots return without a poll.
- **[PGlite cannot show contention]** → §8.3: interleaving tests, the lock-first guard, `pg_locks`, and the user-run contention test on real Postgres.
- **[A missed notification]** → The local wakes cover this process; another process's events reach it on its next notification, its timer or a reconnect look. Reads are never lost, only delayed until one of those.
- **[One budget lock for every model action]** → Each holder runs a few indexed statements with no I/O; at 120 requests an hour the lock is idle almost always.
- **[Note text kept in `read_job`]** → It stays in our database, as entry notes do. It is never logged, and never in metrics, error bodies or the notification payload.

## 12. Deploy plan

- **On start,** `migrateDb` applies `0005` and `0006` under its advisory lock (server/storage "Schema migrated on start"). They only add three empty tables, their indexes and RLS: no existing row is changed, so the deployed data is kept.
- **Start-up** (`index.ts`): `connect` → `migrateDb` and the RLS check → `configureModelApi({ budgetStore, timeoutMs })` → `createApp` → `worker.start()`: the notifier starts, then one look.
- **Shutdown** (SIGTERM): stop the notifier, abort in-flight reads (they end `failed` with their error, or `interrupted` by lease if the process dies first), then the store ends its clients.
- **Rollback**: an older build ignores the three tables (Drizzle never drops them). Reads still waiting are then never sent, their photos stay unlinked media and expire by `linked_at` (scale-store), and the hour's count returns to memory.

## 13. Open questions

- None that change the design. The PGlite spike (task 1.4) only chooses between the two notifier paths of §8.3.
