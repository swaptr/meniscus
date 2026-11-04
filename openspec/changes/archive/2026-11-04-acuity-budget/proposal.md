# Proposal

## Why

We measured a fictional 500-bed hospital (design.md §1). At the busiest hour, model demand is 12.8–19× the 120/h request budget. Today nothing decides who is served when demand exceeds it, and a 3-request read can spend 1–2 requests and then be refused. Patients differ: a critical patient needs every reading, read as accurately as we can. Making acuity explicit lets Meniscus protect the sickest beds when credits run short. This is the deadline MVP; the store and read-path work the same measurements call for is `scale-store`, after the deadline.

## What Changes

- **Acuity** (new `charting/acuity`). Each bed has a level: `critical`, `watch` or `stable`.
  - **How it is set.** A nurse or matron sets it as a care order of kind `acuity`, with history and the existing care-order rules and routes (`PUT` / `DELETE /api/admissions/:id/care/acuity`).
  - **Ward default.** Without an order, the ward's `default_acuity` applies. The demo HDU defaults to `critical` and every other ward to `stable`. A route to change it comes with `scale-store`.
  - **Chart reads** return `acuity`: `level`, `source` (`order` or `ward`), `order_id`, `suggested` and `reasons`.
  - **Suggestions.** A suggested level only ever raises: `critical` on low urine output, overload, a reached fluid limit or intake while nil by mouth; `watch` on a stable bed with an amber fluid prompt. A suggestion does exactly two things: it raises the bed's dashboard group, and it raises its budget class to `critical`. It is never stored and never applied, and the screen says "Review". A nurse confirms it with one PUT. It is not a diagnosis.
- **Acuity-aware model budget** (new `capture/read-budget`; `model-api/client`, `model-api/http-errors`).
  - **Class.** An action is `critical` when its bed's level or suggestion is `critical`, else `routine`, including every action with no bed (every tray read and `GET /api/ai/status`).
  - **Whole-action admission.** Each model action is admitted or refused **up front for all its requests**. An admitted action is never refused part way, and a refused one sends 0.
  - **Critical reserve.** Routine actions may use the cap less `CRITICAL_RESERVE_PCT` (default 30 %, so 84 of 120). Critical actions may use the whole cap: at least 36 requests an hour (about 12 `sam+spark` reads or 18 voice notes) stay for them however busy routine beds are. That is a floor, not cover: at 500 beds critical beds need ≈ 405 at the busiest hour, which 30 % covers only once the cap is sized to busiest-hour demand (≈ 1,533/h; design §1).
  - **Short budget.** A `sam+spark` photo or tray read whose 3 requests no longer fit, but 1 does, runs in `spark` mode with 1 request and a `budget pressure` warning instead of failing part way.
  - **Busy.** Requests in flight never change the mode. A `sam+spark` read that cannot get its 2 in-flight slots is refused with `limit: "concurrent"` and `Retry-After: 5`, not downgraded. `MODEL_API_MAX_CONCURRENT` must therefore be at least 2.
  - **Refusal.** A refused action gets 429 `request_budget_exceeded` with `Retry-After`, `retry_after_ms`, `budget_class` and `retryable: true`. Nothing is queued or sent later. The capture screen says reads are used up until `HH:MM` (hourly) or busy for a few seconds (concurrent), offers Enter by hand at once, and Read again only after that time and only on a tap.
  - **Layers.** `src/ai/budget-policy.ts` (domain, over `AiPorts`) classes, plans, reserves and runs each action. Routes only validate, resolve the bed and map the response and the 429.
  - `@meniscus/meta` stays transport-only: a generic `priority` and a per-action reservation (a ticket), still the single gate.
  - Scripts that run at normal priority check their plans against what normal priority can still use: the image-synthesis script and `scripts/eval.ts`.
- **Dashboard** (`web/ward`). Beds sort by the higher of set and suggested acuity, then by the existing order. Each card has an acuity chip and, when suggested, a `Suggested … · Review` chip. A Critical/Watch/Stable filter needs no request. The bed review sets a level (one PUT, 0 model requests), confirms a suggestion, or returns to the ward default. Acuity stays out of the care-plan order rows, badges and add-order control; its history rows stay in History.
- **Ward round** (`web/ward-round`). The button keeps `Read <n> · <k> model requests`, with k the most the reads can make (`Read 5 · 13 model requests`), as read-outcomes keeps it. Each read's count follows its response's `mode`: 3 in `sam+spark`, 1 in `spark`, 0 when refused. After a refusal, Retry waits for `Retry-After`.
- **README "Scaling"** (docs only): the Phase A numbers (latency, store size, budget demand), what the critical reserve guarantees at the default cap and what it covers only at a sized one, and `scale-store` as the measured next step.

### Upstream model requests per user action (before → after)

| Action | Before | After |
| --- | --- | --- |
| Photo read, `sam+spark` (requested or `READ_USE_SAM`) | 3; with 1–2 requests left, 1–2 SAM sent, then 429 | 3 when 3 fit under its class's ceiling; else 1 in `spark` mode when 1 fits; else 429 with 0 |
| Photo read, `spark` | 1 | 1; else 429 with 0 |
| Tray read (`/api/ai/meal`, after tray-segmentation; no bed, so routine) | 3 in `sam+spark`, 1 in `spark`; with 1 left, SAM `dish` sent, then 429 | 3 when 3 fit under the routine ceiling; else 1 in `spark` mode; else 429 with 0 |
| Voice note | 2; ASR could be sent and Spark refused | 2, admitted whole; else 429 with 0 |
| Text note, Explain | 1 | 1; else 429 with 0 |
| Status check (`GET /api/ai/status`, routine) | 1 | 1; else 429 with 0 |
| Any action while its in-flight slots are taken | 429 `concurrent`; a `sam+spark` read with 1 slot free sent 1 SAM first | 429 `concurrent` with 0, never downgraded |
| Acuity order, chart reads, dashboard filter, refusal screen | 0 | 0 |

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `CARE_KINDS` gains `acuity` (first), and `CareValues` / `CareInput` gain `acuity: { level }`. The web's exhaustive care maps must add it.
  - **BREAKING**: `Ward` / `WardSummary` gain `default_acuity`.
  - **BREAKING**: `AdmissionSummary` and `EntryList` gain `acuity: AcuityStatus`. Fixtures change.
  - New: `ACUITY_LEVELS`, `AcuityLevel`, `ACUITY_SUGGEST`, `AcuityStatus`, `BudgetRefusal`.
- `@meniscus/meta`:
  - **BREAKING**: `MetaBudgetError.retryable` changes from `false` to `true` (the client still never retries).
  - Additive: `RequestBudget.reserve()` returning a `Ticket`, `RequestBudget.fits()`, `BudgetOptions.reservePct`, `CallOptions.ticket`, `MetaBudgetError.retryAfterMs` and `.priority`, and `stats()` gains `held`, `reservePct` and `remaining`.
- HTTP:
  - **BREAKING**: the 429 `request_budget_exceeded` body changes `retryable` from `false` to `true`, and gains `retry_after_ms`, `budget_class` and a `Retry-After` header.
  - **BREAKING**: `GET /api/wards` items gain `default_acuity`; `GET /api/admissions` items and `GET /api/admissions/:id/entries` gain `acuity`.
  - `PUT` / `DELETE /api/admissions/:id/care/acuity` through the existing care routes.
  - Photo and tray reads in `sam+spark` mode may return `mode: "spark"` with a `budget pressure` warning where they were refused part way.
- Config (`config.ts`, `.env.example`): `CRITICAL_RESERVE_PCT` (integer 0–90, default 30). **BREAKING**: `MODEL_API_MAX_CONCURRENT` must be at least 2 (1 is rejected at startup; default 4 unchanged).
- Server internal: `AiPorts` gains `budget` (`fits`, `reserve`); pipeline inputs gain the bed's `status`.

### Out of scope

- **Everything in `scale-store`** (after the deadline): media out of SQLite, bounded status reuse, the ward-scoped hourly series and media expiry fix, `/api/metrics`, the bench script, intervals by acuity, the matron's ward-default route, the attendant's bed picker by ward, and the stable-bed downgrade under budget pressure.
- **Sizing the cap.** No policy makes 120/h serve 500 beds. The cap stays configuration; this change decides who is served under it.
- **Critical reads downgraded past the routine ceiling.** Critical reads stay `sam+spark` while 3 fit (design §3).
- **Automatic step-down suggestions, queued or deferred reads, per-ward quotas.**
- **Multiple server processes.** The budget is per process, as today.

## Capabilities

### New Capabilities
- `charting/acuity`: a bed's acuity level (the `acuity` care order), its ward default, suggestions from live prompts that are never stored or applied, on chart reads.
- `capture/read-budget`: the budget class of a model action, the critical reserve, admission of a whole action up front, and the read mode a short budget allows, with exact request counts.

### Modified Capabilities
- `charting/care-plan`: **Care status on chart reads** lists acuity first.
- `charting/model-accuracy` (added by read-outcomes): **Reads name their bed**: the bed sets the class; counts per mode, 0 when refused.
- `capture/meal-reading` (as tray-segmentation leaves it): **Tray reading** and **Tray segmentation degrades**: with 1–2 requests left a tray read runs in `spark` mode with 1 request; with none left it gets 429 with 0.
- `model-api/client`: **Request budget** admits a whole action, has a priority reserve, and gives a retry time.
- `model-api/http-errors`: adds **Local budget refusal**.
- `eval/synthetic-images` (added by image-synthesis, archived): **Hourly budget checked first** counts only what normal priority can use.
- `web/ward`: **Beds needing attention first** groups by acuity; **Care plan on the bed review**, **Change care orders from the bed review** and **Care badges on bed cards** leave acuity to its own row and chip. Adds **Acuity on bed cards** and **Set or confirm acuity on the bed review**.
- `web/capture`: adds **Budget refusal offers manual entry**, with separate hourly and concurrent copy.
- `web/ward-round`: **One read per photo, in order** counts per response mode (3 in `sam+spark`, 1 in `spark`, 0 when refused) and keeps Retry disabled until `Retry-After` after a refusal. **Requests before reading** is unchanged: its `k` is already the most a read can make.

Two modify requirements that in-flight changes add (read-outcomes, tray-segmentation); `openspec validate` reports them as INFO until those archive. image-synthesis has archived. Apply order: care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → **acuity-budget** → tray-comparison → bag-alerts → accuracy-views → dietitian-care → scale-store → postgres-store → read-queue (design §8).

## Impact

- `packages/meta`: `src/budget.ts`, `src/transport.ts`, `src/errors.ts`, `src/responses.ts`, `src/sam.ts`, `src/asr.ts`, `src/index.ts`, and tests.
- `packages/shared/src/index.ts`.
- `apps/server`:
  - new `src/ai/budget-policy.ts` (domain, over `AiPorts`) and `src/chart/acuity.ts` (domain, pure);
  - changed `src/ai/ports.ts`, `src/ai/pipeline.ts` (and its header comment's counts, `:11`), `src/routes/ai.ts`, `src/chart/view.ts`, `src/chart/care.ts`, `src/routes/care.ts`, `src/routes/chart.ts`, `src/store/store.ts`, `src/model-api.ts`, `src/config.ts`, `src/testing.ts`, `.env.example`, `scripts/demo-history.ts`, `scripts/eval.ts` (`:88-90`), `scripts/synth-images.ts` (`:13`) and `src/lab/synth.ts` (`:417`).
- `apps/web`: `lib/ward.ts`, `lib/labels.ts`, `lib/care.ts`, `lib/api.ts`, `lib/capture.ts`, `lib/round.ts`, `lib/sources.ts`, new `lib/acuity.ts`, `routes/n/w.$ward.tsx`, `routes/n/$id.tsx`, `routes/a/bed.$token.tsx`, `routes/a/round.tsx`, and the care forms.
- Docs: AGENTS.md "Rules that always apply" (the "Model API credits are limited" bullet) and README "Meta models, and why each one" (request counts per mode, 0 when refused; `Read n · k model requests` makes at most k), README "Care plan" (acuity) and a new README "Scaling". The README "What it does" round row keeps `Read 5 · 13 model requests`.
- No new dependencies.
