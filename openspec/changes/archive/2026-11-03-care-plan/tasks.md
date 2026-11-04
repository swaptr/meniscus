# Tasks

Every test runs without the network; server tests go through `testApp` with the fake upstream, and assert that its `requests` stay empty unless a scenario says otherwise. Clocks are local (`new Date(2026, 10, 3, h, m)`).

Scenario → test file map (each task below lists the scenarios it cites):

| Requirement | Test file |
|---|---|
| [charting/care-plan] Fluid limit progress, Nil by mouth past its planned end, Catheter day, Intake target progress, Entries judged by the order then in force | `apps/server/src/chart/care.test.ts` (new) |
| [charting/care-plan] Chart day, Nil by mouth intake, Thickened fluids, Catheter necessity review, Care prompts join the alerts | the pure parts in `apps/server/src/chart/care.test.ts`, and the HTTP parts in `apps/server/src/care.test.ts` (new) |
| [charting/care-plan] Set a care order, Care order values, End a care order, Care orders need a nurse, Care order history, Target within the limit, Care status on chart reads, Counted intake, Pre-care stores | `apps/server/src/care.test.ts` |
| [charting/entries] Drink consistency on the entry | `apps/server/src/chart.test.ts` |
| [charting/audit] Amend a drink's consistency | `apps/server/src/audit.test.ts` |
| [charting/alerts] Logging gap | `apps/server/src/chart/alerts.test.ts` |
| [web/ward] Care plan on the bed review, Change care orders from the bed review, Care badges on bed cards, Care prompt colours, Care flags on entries and meals | `apps/web/src/lib/care.test.ts` (new) |
| [web/ward] Resolve from the bed review | `apps/web/src/lib/resolve.test.ts` |
| [web/ward] Correct a drink's consistency | `apps/web/src/lib/resolve.test.ts` (the request) and `apps/web/src/lib/timeline.test.ts` (the timeline line) |
| [web/capture] Care orders at the bed, Nil by mouth warning before saving, Drink consistency on the check screen | `apps/web/src/lib/care.test.ts` |

## 1. Shared contracts

- [x] 1.1 Shared types and config, and the new prompts' labels, colours and status text.
  - Write the failing tests first, in new `apps/web/src/lib/care.test.ts`:
    - [web/ward] Care prompt colours: "Worst prompt wins", asserting the chip text `STATUS_LABEL[bedTone(alerts, 0)]` for all four beds (`Check`, `Review`, `Review now`, `Review`), and "Labels" (`ALERT_LABEL`). They fail to compile: the kinds and `STATUS_LABEL` do not exist yet.
  - Then implement, in `packages/shared/src/index.ts`, everything in design.md "Types" (contracts only; no requirement of their own):
    - `CHART_DAY_START`, `chartDay`;
    - `CARE_KINDS`, `CareKind`, `CARE_LABEL`;
    - `FLUID_SCOPES`, `FluidScope`, `SCOPE_CATEGORIES`, `CATHETER_TYPES`, `CatheterType`, `IDDSI_DRINK_LEVELS`, `IddsiLevel`, `ThickenedLevel`;
    - `CareValues`, `CareInput`, `CareOrder`, `CareProgress`, `CareReview`, `CareStatus`;
    - the config constants, `CARE_HISTORY_SHOWN` included;
    - the 8 new `ALERT_KINDS`, `RECORD_ALERT_KINDS`, `RecordAlertKind`, and `Alert` as the discriminated union;
    - `Entry.iddsi_level`, `EntryInput.iddsi_level`, `AmendInput.iddsi_level`, and `EntryEvent.from_iddsi`/`to_iddsi`;
    - `AdmissionSummary.care`, `EntryList.care` and `EntryList.care_history`.
  - Then, in `apps/web/src/lib/labels.ts`:
    - `ALERT_LABEL` and `ALERT_TONE`, with the labels and tones from the spec;
    - `STATUS_LABEL`, moved from the two `STATUS` copies in `routes/n/$id.tsx:44` and `routes/n/w.$ward.tsx:49`, which now import it.
  - Then retype so the whole repo compiles, with no assertion changed:
    - `apps/server/src/chart/alerts.test.ts:22`, `apps/web/src/lib/audit-fixtures.ts:12`, `lib.test.ts:49` and `history.test.ts:33`: `iddsi_level: null`;
    - `apps/web/src/lib/audit-fixtures.ts:50`: `from_iddsi: null`, `to_iddsi: null`;
    - `lib.test.ts:211` and `rota.test.ts:52`: `care` with no orders;
    - any fixture building an `Alert` from a variable `AlertKind`: narrowed to a non-record kind;
    - `apps/server/src/store/store.ts` `toEntry` and the event mapper: the new fields as null until 2.1;
    - `routes/chart.ts`: an empty `care` (`emptyCare()` in new `apps/server/src/chart/care.ts`) and `care_history: []`, until 2.3.
  - Verify: `pnpm typecheck` passes; the two colour tests pass; every existing server and web test passes unchanged.

## 2. Server

- [x] 2.1 Drink consistency on entries and through amend.
  - Write the failing tests:
    - In `apps/server/src/chart.test.ts`: [charting/entries] Drink consistency on the entry: "Mildly thick drink", "No consistency given", "Misplaced consistency", "Amended to food" (with the event's `from_iddsi: 2`, `to_iddsi: null`).
    - In `apps/server/src/audit.test.ts`: [charting/audit] Amend a drink's consistency: "Consistency recorded", "Consistency corrected", "Misplaced consistency" (each its own request, each asserting nothing changed), "Amend rules apply" (`staff: 1` for the 403).
  - Implement:
    - `entry.iddsi_level`, `entry_event.from_iddsi` and `entry_event.to_iddsi` (`INTEGER`) in the `SCHEMA` DDL, and a new `migrateCare(db)` after `migrateMedia` in `openStore` that adds whichever is missing to older files;
    - `EntryBody` in `routes/chart.ts`: `iddsi_level: z.number().int().min(0).max(4).nullable().optional()`, refined to `water` only (`path: ['iddsi_level']`);
    - `AmendBody`: `iddsi_level: z.number().int().min(0).max(4).optional()`;
    - the insert, `toEntry` and the event mapper; `store.amend` accepting a level only when the result is `water`, refusing an unchanged level, recording `from_iddsi`/`to_iddsi` by the session's staff, and clearing the level (`to_iddsi: null`) when the category leaves `water`.
  - Verify: these tests and the whole server suite pass, with the existing "Amend an approved entry" tests unchanged.
- [x] 2.2 Pure care rules and the logging-gap hold.
  - Write the failing tests in new `apps/server/src/chart/care.test.ts`, calling the pure rules with in-memory orders, entries, meals and reviews:
    - [charting/care-plan] Chart day: "Before the day's start", "Clock change" (design.md §10: `process.env.TZ = 'Europe/London'`, restored after the test).
    - [charting/care-plan] Fluid limit progress: "Near the limit", "Exactly 80 percent", "Exactly 100 percent", "Over the limit", "Oral leaves out IV", "Started mid-day".
    - [charting/care-plan] Nil by mouth intake: "Meals and IV", "Entries and a meal", "Tea with no food", and the alert of "Drink while fasting".
    - [charting/care-plan] Nil by mouth past its planned end: "At the planned end", "A day later", "No planned end".
    - [charting/care-plan] Thickened fluids: "Thinner, same and thicker", "Not recorded", "Rejected or no order".
    - [charting/care-plan] Entries judged by the order then in force: "Lifted after the drink", "Start and end", "Level changed".
    - [charting/care-plan] Catheter day: "Inserted before admission", "Midnight".
    - [charting/care-plan] Catheter necessity review, the rule parts: "Review due", "Set today", and the 07:59 / 08:00 part of "Once a chart day".
    - [charting/care-plan] Intake target progress: "Behind at 14:00", "Caught up, then behind again", "Pending and IV", "Rounded up", "Set after a check", "Held while nil by mouth".
    - [charting/care-plan] Care prompts join the alerts: "Wording". Every care message from the scenarios above, all eight kinds, ends with `Review.`, and none contains the admission's patient name.
    - Uncited extra assertions in the same file: the 07:59 / 08:00 chart-day edge and the pending / rejected / voided-meal counting, at the rule level (their cited scenarios are in 2.3).

    And in `apps/server/src/chart/alerts.test.ts`:
    - [charting/alerts] Logging gap: "Nil by mouth". "No intake since morning" stays unchanged and green.
  - Implement, in `apps/server/src/chart/care.ts` (domain, pure):
    - `CARE_RULES` (a mapped type over `CARE_KINDS`) and the per-kind value codecs;
    - the message templates (the nil-by-mouth meal folding and `Math.ceil` expected mL, as design.md §3), local `HH:MM` and `D Mon` formatting, and the check and review-from instants;
    - `emptyCare()`.

    In `apps/server/src/chart/alerts.ts`: `alertsFor(admission, entries, now, { nilByMouth })` holds back `logging_gap`.
  - Verify: these tests pass, and so does `alerts.test.ts` with no other assertion changed.
- [x] 2.3 Store, chart reads and Explain.
  - Write the failing tests in new `apps/server/src/care.test.ts`. Orders are seeded through the store API, `store.setCare` and `store.reviewCatheter`, until 2.4 adds the routes; entries and meals through HTTP:
    - [charting/care-plan] Care status on chart reads: "Fresh store", "Display order" (both `GET /api/admissions` and `GET /api/admissions/:id/entries`).
    - [charting/care-plan] Care order history: "Long history".
    - [charting/care-plan] Chart day: "Across the start". Entries posted with `charted_at` 07:59 and 08:00 and approved through `POST /api/entries/:id/review`; then `GET /api/admissions/:id/entries` gives `care.fluid_limit.ml` 500 and `totals.in_ml` 800.
    - [charting/care-plan] Counted intake: "Mixed statuses". Water posted and approved, tea left pending, water rejected, a dinner posted through `POST /api/admissions/:id/meals` with `fluid_ml: 150` and voided through `POST /api/meals/:id/void`; then `GET …/entries` gives `ml: 700`, `pending_ml: 200` and `totals.in_ml` 500.
    - [charting/care-plan] Nil by mouth intake: "Drink while fasting", through `POST /api/admissions/:id/entries` (201 pending), then the entry list's alerts.
    - [charting/care-plan] Thickened fluids: "Recorded afterwards", through `POST /api/entries/:id/amend`, then the entry list's alerts.
    - [charting/care-plan] Care prompts join the alerts: "Only a catheter review":
      - `GET /api/wards` shows HDU with `beds_with_alerts: 1`;
      - `POST /api/ai/explain` is 200, with exactly one upstream request whose input holds `catheter_review` and not `Nadia Rahman`.
  - Implement, in `apps/server/src/store/store.ts`:
    - the `care_order` table, the `care_order_active` partial unique index and the `care_review` table, in `SCHEMA`;
    - `setCare` (in `tx`: end the active order and insert the new one at the same `t`, or return the unchanged one);
    - `endCare`, `careOrders(id, since)`, `careOrdersByWard(wardId?, since)`, `careHistory(id, limit)`, `reviewCatheter`, and `recent(id, since?)`.

    Then new `apps/server/src/chart/view.ts`, `chartView(store, admission)`, used by `withChart` (`routes/chart.ts:172`), `GET /admissions/:id/entries` (`:276`) and Explain (`routes/ai.ts:80`). It works over the window `min(now − 24 h, chartDay(now).start)`, and reads meals only for beds with a nil-by-mouth order in the window.
  - Verify: these tests pass, and so do the existing `[charting/alerts] Alerts on chart reads` and `Explain alerts` tests (`chart.test.ts:416`, `:430`, `:457`) unchanged.
- [x] 2.4 Order and review routes.
  - Write the failing tests in `apps/server/src/care.test.ts`:
    - [charting/care-plan] Set a care order: "Start a fluid limit", "Change the value", "Same value again", "Unknown admission or kind", "Unknown admission before the body".
    - [charting/care-plan] Care order values: "Every kind", "Boundaries accepted" (with the insertion exactly 365 days earlier), "Invalid values" (with `until` equal to now). Each invalid body is its own request, and each asserts no order is stored.
    - [charting/care-plan] End a care order: "Lift nil by mouth", "Nothing to end".
    - [charting/care-plan] Care orders need a nurse: "Attendant changes an order" (all four requests, `staff: 1`), "No session" (`cookie: null`), "Matron sets an order", "Attendant reads orders".
    - [charting/care-plan] Care order history: "Replaced, then lifted", over HTTP.
    - [charting/care-plan] Target within the limit: "Target above the limit", "Limit below the target", "Equal, or the limit ended".
    - [charting/care-plan] Catheter necessity review: "Reviewed", "Once a chart day" (the 409 and the 08:05 201), "No catheter".
    - [charting/care-plan] Pre-care stores: "Older store" (built with the pre-change `entry` and `entry_event` DDL and no care tables, and holding one approved 200 mL water entry; then the PUT and the amend), "Opened again" (`PRAGMA schema_version` read before and after the second open).
  - Implement:
    - `SKEW_MS` moved from `routes/chart.ts:156` to `routes/common.ts` and exported; `routes/chart.ts` imports it;
    - new `apps/server/src/routes/care.ts`, mounted in `app.ts` beside `chartRoutes`:
      - `CARE_VALUE`, strict per-kind zod schemas from the shared ranges, with `store.now()` refines for `until` (strictly after now) and `inserted_at` (`SKEW_MS`, `CATHETER_MAX_AGE_DAYS`);
      - `AnyCareBody = z.record(z.string(), z.unknown())`;
      - the `careTarget` middleware (404 for an unknown admission or kind);
      - the chain `requireDecider` → `careTarget` → `smallJson()` → `validate('json', AnyCareBody)` → `CARE_VALUE[kind]` → the target-vs-limit check;
      - `DELETE`, and `POST …/care/catheter/review` (`ON CONFLICT DO NOTHING RETURNING` → 409 `already_reviewed`).

    No log line carries an order value.
  - Verify: these tests and the whole server suite pass.
- [x] 2.5 Demo census, in `apps/server/scripts/demo-history.ts`, as design.md §9:
  - HDU-1 keeps its full `routine()` day and gets no story rows;
  - HDU-3, 2C-1 and 3A-4 keep their routine output rows, `routine(...).filter((r) => CATEGORY_DIRECTION[r[3]] === 'out')`, and only their intake rows are replaced by story rows placed relative to `chartDay(now)`;
  - 5B-6's `STORY` drinks carry `iddsi_level: 2`, plus the level-0 voice drink and the approved drink with no level;
  - HDU-3, 2C-1 and 3A-4 join `storyBeds` (meals with no fluid), and 2C-1 gets no meal inside its nil-by-mouth window;
  - the orders and the HDU-1 review go through the store API, by each ward's own nurse;
  - the header comment lists the five beds and the 14:00–08:00 window;
  - a guard throws unless each story bed's alerts equal its intended set for the time of the run (the table in design.md §9).

  Verify: one run over a fresh temporary `DATA_DIR` succeeds (the guard passes), and `GET /api/admissions` from a server on that file shows each story bed's badges and only its intended prompts. No model requests: the script makes none.

## 3. Web library

The web tests use `createApi` with a fake `fetch` and a `staffId`, as `resolve.test.ts` and `meals.test.ts` do, and assert the exact requests and `X-Staff-Id`.

- [x] 3.1 Showing care.
  - Write the failing tests in `apps/web/src/lib/care.test.ts`:
    - [web/ward] Care plan on the bed review: "Limit and target", "Limit bar colours" (`limitTone` from `FLUID_LIMIT_WARN`), "Catheter" (`reviewedToday` by chart day, including the 07:30 review), "Nil by mouth and thickened fluids", "History" (`CARE_HISTORY_SHOWN`), "Nothing ordered" (through `CARE_ROW`, `limitCaption`, `targetCaption`, `CARE_HISTORY_TEXT`), and "No extra request" (`bedLoad` sends exactly the two GETs).
    - [web/ward] Care badges on bed cards: "Every kind", "Litres" (`careBadges`, `litres`), "No extra request" (`wardLoads`).
    - [web/ward] Care flags on entries and meals: "Drink while fasting", "Thin drink", "Lunch while fasting" (`careFlags`, `mealFlags`).
    - [web/capture] Care orders at the bed: "Fasting stroke patient". `careBadges`, plus the bed screen's loader, moved from `routes/a/bed.$token.tsx:94` to `lib/care.ts` as `bedScreenLoad`, sending exactly `GET /api/beds/<token>` then `GET /api/admissions/<id>/entries`.
  - Implement the read-side half of `apps/web/src/lib/care.ts` (`CARE_BADGE`, `CARE_ROW`, `CARE_HISTORY_TEXT`, mapped over `CARE_KINDS`).
  - Verify: these tests pass.
- [x] 3.2 Changing care.
  - Write the failing tests in `apps/web/src/lib/care.test.ts`:
    - [web/ward] Change care orders from the bed review:
      - "Add a fluid limit" (`api.setCare`, then `bedLoad`: three requests in order, `X-Staff-Id: 7`, no `/api/ai`);
      - "Form defaults" (`formDefaults(kind, care)` from the shared ranges, with the target capped at an active 1500 mL limit);
      - "Planned end of nil by mouth" (`untilFrom`);
      - "Catheter insertion date" (`insertedFrom`);
      - "End an order" (`api.endCare`, `endConfirmText`);
      - "Reviewed today" (`api.reviewCatheter`; a 409 maps to `Already reviewed today` through `errorText`, and nothing more is sent);
      - "Target above the limit" (`targetConflict`, which sends nothing);
      - "Attendant" (`canDecide`).
  - Implement `setCare`, `endCare` and `reviewCatheter` in `lib/api.ts`; `already_reviewed` in `errorText`; and the write-side half of `lib/care.ts`.
  - Verify: these tests pass.
- [x] 3.3 Capture with care, and amending a consistency.
  - Write the failing tests:
    - In `apps/web/src/lib/care.test.ts`:
      - [web/capture] Nil by mouth warning before saving:
        - "Drink for a fasting patient" (`nbmWarning`, `saveLabel`, then `saveByHand` sends exactly one request);
        - "Planned end", "IV or output", "Meal" (`nbmWarning` on a meal form: portion ½, None without fluid, None with 150 mL tea);
        - "Missed entry by a nurse" (`addMissedEntry` still sends the entry and then the approve).
      - [web/capture] Drink consistency on the check screen:
        - "Defaults to the order" (`consistencyDefault`, then `saveByHand` with `iddsi_level: 2`, one request);
        - "Thinner than ordered" (`thinnerNotice`);
        - "Thicker", "Type changed" (`toEntryInput` sends `iddsi_level` for water only, and changing the type back re-seeds it), "No order";
        - "Photo draft" (the read sends one `/api/ai/read` request; `saveEntry` then sends the media upload and the entry with `iddsi_level: 2`, and no `/api/ai` request).
    - In `apps/web/src/lib/resolve.test.ts`:
      - rewritten in place at `:74`: [web/ward] Resolve from the bed review: "Gap prompts offer a missed entry". It now also checks `intake_target_behind`, so it checks more, not less;
      - [web/ward] Correct a drink's consistency: "Record a jug drink's level" (`amendBody` with the level, then `api.amend`: one request, `X-Staff-Id: 4`, no `/api/ai`), "Not a drink" (no `iddsi_level` for urine or for a drink amended to food).
    - In `apps/web/src/lib/timeline.test.ts`: [web/ward] Correct a drink's consistency: "Timeline".
  - Implement:
    - `Pending.iddsi_level`, and `toEntryInput` in `lib/capture.ts`;
    - `addMissedEntry` taking an optional `iddsi_level` (`lib/resolve.ts:39`);
    - `amendBody` taking an optional level (`lib/resolve.ts:71`), and the consistency part of the amended line in `lib/timeline.ts:131`;
    - `GAP_PROMPTS` gaining `intake_target_behind` (`lib/resolve-rules.ts:10`);
    - `nbmWarning`, `saveLabel`, `consistencyDefault` and `thinnerNotice` in `lib/care.ts`.
  - Verify: these tests and the whole web suite pass, with the existing amend and timeline tests unchanged.

## 4. Web screens

- [x] 4.1 Components and screens, as design.md §7 (StyleX tokens, Base UI, lucide icons through `components/icons.tsx`, controls ≥ 44 px):
  - new `components/care-badges.tsx`, used by the `BedCard` (`routes/n/w.$ward.tsx:276`) and the attendant banner (`routes/a/bed.$token.tsx:360`);
  - new `components/consistency-field.tsx`, used on the check screen's water drafts, the by-hand form, `MissedEntryDialog` (`components/resolve.tsx:211`) and `AmendDialog` for drinks;
  - the nil-by-mouth notice and `Save anyway` on the check screen, the by-hand form, `MealForm` (new `care` prop) and `MissedEntryDialog`;
  - new `components/care-plan.tsx` on the bed review, after the prompts (`routes/n/$id.tsx:161`):
    - progress bars with `role="progressbar"` and `aria-valuetext`;
    - "Show all" on the history;
    - for deciders: "Add order", "Change…", "End…" and "Reviewed today";
  - new `components/care-forms.tsx`, `React.lazy` as `RejectDialog` is, with `CARE_FORMS` mapped over `CARE_KINDS`;
  - the `careFlags` badges on the pending cards, the entry log and the entry details, and `mealFlags` on the meals list;
  - both status chips read `STATUS_LABEL`.

  Verify: `pnpm typecheck`, `pnpm lint` and the web tests pass. The screens are checked in 4.3.
- [x] 4.2 Bundle: run `pnpm --filter @meniscus/web build` and record, in one line of the PR description:
  - the shell (entry and preloads, ≤ 120 KB gzipped);
  - the own chunks of `/n/$id`, `/n/w/$ward` and `/a/bed/$token` (each ≤ 50 KB gzipped);
  - the `care-forms` chunk, which must be separate and not preloaded.

  If a route goes over, lazy-load more of it before moving on.
- [x] 4.3 Browser check at 390 and 1100 px, through the Vite proxy, on the demo store from 2.5. Run it after 14:00 local, so every story prompt shows. Block `/api/ai/*` in the browser (Playwright `route(…, abort)`), so no model request can be sent; nothing here should need one.
  - **Signed in as `anita` (Anita Thomas, nurse; 3A and 5B):**
    - the 3A dashboard: 3A-4 shows `Target 600/1600` and `Behind intake target` (amber, `Review`);
    - the 3A-4 bed review: the target bar caption; "Add missed entry" on the prompt; then set a fluid limit of 1500 mL, see the target form open at 1500 mL, and see `Above the fluid limit of 1500 mL` refuse 1600 mL;
    - 5B: 5B-6 shows `IDDSI 2`, the red `Drink too thin` and the amber `Consistency not recorded`, with `Review now`. On its bed review:
      - the thin drink is badged `IDDSI 0` · `Thinner than ordered`, and the 7 h drink `Consistency not recorded`;
      - Amend on the 7 h drink offers "Consistency" with no chip picked; save `2 Mildly thick` with reason `checked the cup`: `Consistency not recorded` goes, `Drink too thin` stays, and the timeline reads `Amended consistency none → IDDSI 2 by Anita Thomas (nurse): checked the cup`;
      - Amend on a urine entry offers no "Consistency";
    - Renal HDU, after the break-the-glass reason:
      - HDU-3 shows `Limit 1 L · 82%` and an amber bar;
      - HDU-1 shows `Catheter day 6`, with `Check`;
      - tapping "Reviewed today" clears the prompt, and a second tap shows `Already reviewed today`;
    - 2C, also after a reason: 2C-1 shows `NBM`, `Intake while NBM` and `NBM past planned end`, with the pending drink badged `During NBM`. End nil by mouth: the overdue prompt goes, the intake prompt stays, and the history shows the ended order.
  - **Signed in as `ravi` (Ravi Kumar, attendant):**
    - `/a/bed/<2C-1 token>`: `NBM` on the banner; a drink by hand shows the warning and `Save anyway`, and saves one entry;
    - `/a/bed/<5B-6 token>`: a drink by hand shows "Consistency" at `2 Mildly thick`; picking `0 Thin` shows the notice; saving sends `iddsi_level: 0`;
    - the 3A-4 bed review shows the Care plan read-only, with no add, change, end or "Reviewed today", and entry details show no Amend.
  - **In the network panel:**
    - opening a bed review sends exactly the entries and meals GETs;
    - opening a dashboard sends exactly the admissions and team GETs;
    - each order action and the amend send one request, then the reload;
    - no `/api/ai` request is attempted.
  - **With the keyboard only, at 390 px:** add and end an order; the progress bars read out their captions.

## 5. Docs and verification

- [x] 5.1 README:
  - **New "Care plan" section**:
    - the five orders and their eight prompts, with their colours;
    - "today since 08:00" (the chart day) versus the rolling 24 h;
    - pending counted in limits and targets;
    - nothing is blocked, and nil by mouth never ends on its own;
    - intake while nil by mouth and a drink thinner than ordered stay red for 24 h, as `appearance` does, with no dismissal;
    - a drink with no consistency recorded (ward round, jug levels) is amber until a nurse records its level through Amend, which clears it;
    - the config constants, by name;
    - "documents orders made elsewhere; not a diagnostic device".

    Cite the IDDSI framework (https://iddsi.org/framework/drink-testing-methods), and check that it resolves with one `curl -sIL`, by hand, with no loop or retry.
  - **Demo notes:** the five story beds, and the 14:00–08:00 window.
  - **API list:** the three care routes, `iddsi_level` on amend, and the test count.
- [x] 5.2 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Clear context between proposing and applying.
- Archive with `openspec archive care-plan --yes` once `pnpm verify` passes.
