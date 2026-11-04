# Tasks

Every test runs without the network.
- **Server tests** go through `testApp` with the fake upstream and assert that its `requests` stay empty. Only "Not in Explain" expects exactly one.
- **Clocks** are local (`new Date(2026, 10, 3, h, m)`; 3 Nov 2026 is a Tuesday).
- **Web tests** use `createApi` with a fake `fetch` and a `staffId`. They assert the exact requests, `X-Staff-Id`, and that no `/api/ai` request is sent.

Each task is test-first: write the citing tests, see them fail, implement, then tick. A test title is `[<domain>/<capability>] <Requirement>: <scenario>`. No task leaves a placeholder that throws.

Scenario → test file map (each task below lists the scenarios it cites):

| Requirement | Test file |
|---|---|
| [charting/care-plan] Care orders need a nurse | `apps/server/src/care.test.ts` |
| [charting/care-plan] Diet order, Diet order values, Diet targets need a dietitian | `apps/server/src/diet.test.ts` (new) |
| [charting/nutrition] Nutrition status on chart reads, Refer to a dietitian, Referral routing, Dietitian worklist | `apps/server/src/nutrition.test.ts` |
| [charting/nutrition] Assign a dietitian, Hand back a patient | `apps/server/src/assignment.test.ts` (new) |
| [charting/nutrition] Patient nutrition read, Referral history | `apps/server/src/nutrition-view.test.ts` (new) |
| (pure) `routedTo`, `worklistFor` sections, `foodChart`, `mayAssignDietitian` | `apps/server/src/chart/nutrition.test.ts` |
| (pure) `CARE_CODEC.diet`, `CARE_RULES.diet` | `apps/server/src/chart/care.test.ts` |
| [web/ward] Diet order on the care plan, Diet order from the bed review, Diet badges on bed cards | `apps/web/src/lib/care.test.ts` |
| [web/ward] Change care orders from the bed review, Care badges on bed cards (MODIFIED from acuity-budget) | `apps/web/src/lib/care.test.ts`; "Acuity not offered here" stays in acuity-budget's `apps/web/src/lib/acuity.test.ts` |
| [web/ward] Nutrition on the bed review, Assign a dietitian from the bed review | `apps/web/src/lib/nutrition.test.ts` |
| [web/ward] Dishes in the Nutrition section | `apps/web/src/lib/dishes.test.ts` (new) |
| [web/dietitian] Dietitian worklist, Worklist for dietitians only | `apps/web/src/lib/nutrition.test.ts` |
| [web/dietitian] Patient nutrition view, Patients outside the dietitian's wards, Referral actions in the patient view, Assignment from the patient view, Diet order from the patient view | `apps/web/src/lib/nutrition-view.test.ts` (new) |

## 0. Earlier changes archived; rebase on them

- [x] 0.1 Check the apply order and rebase. The order is care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → bag-alerts → accuracy-views → **dietitian-care**, and scale-store is not yet archived.
  - **Archived.** `openspec/changes/<name>/` is gone for each change before this one. `openspec/specs/charting/nutrition/spec.md` and `openspec/specs/web/dietitian/spec.md` exist.
  - **Rebase** the branch on them. Re-check the line numbers design.md cites in `routes/care.ts`, `chart/care.ts`, `chart/staffing.ts`, `store.ts`, `lib/care.ts` and `lib/use-access.ts`.
  - **Re-copy every MODIFIED block** from the archived text, then re-apply this change's edits:
    - `charting/care-plan` "Care order values" is not in this delta (design.md §5). Confirm that bag-alerts archived it with its four scenarios, that its tests in `care.test.ts` pass, and that `diet` is not in its list; nothing to re-copy.
    - `charting/care-plan` "Care orders need a nurse": the live text, if no earlier change touched it.
    - The seven `dietitian` requirements listed in design.md, "Overlaps".
    - `web/ward` "Change care orders from the bed review" and "Care badges on bed cards": acuity-budget's archived text, plus this change's edits (design.md, "Overlaps", acuity-budget).
  - **Confirm what the earlier changes left:**
    - `CARE_KINDS` starts with `acuity`, and `diet` goes last;
    - `requireRole` exists in `routes/common.ts`;
    - `WardReads` exists in `chart/view.ts`;
    - `Meal.dishes`, `Meal.proof.photo.media_id` and `Meal.amendments` (`MealAmendment` `{ id, at, by, reason, before, after }`, oldest first, `before` and `after` with `dishes`) exist;
    - the tray overlay component and its once-per-meal media fetch exist;
    - `scripts/fake-server.ts` (tray-comparison) exists;
    - in `demo-history.ts`: read-outcomes' snapshot guard, `INTENDED`, dietitian's "only 3A-6 raises `poor_meal_intake`" assertion, and accuracy-views' §11 guard (outcome mix and alerts snapshot);
    - in `demo-history.ts`: a 3A photo meal with a `rice` dish, charted between 1 h and 24 h before seeding (at least 1 h old, so the amendment 1 h after the meal is not in the future), linked to a tray read and `accepted` in accuracy-views' mix, for task 2.7's amendment. Name its bed in design.md §9. Also note whether tray-comparison's seeded amendment by Anita Thomas already changes a dish; task 2.7 seeds the rename either way.

    If any differs, stop and report. Don't edit another change's guard.
  - **Verify:**
    - `pnpm exec openspec validate dietitian-care --strict` passes, with no description over 500 characters;
    - `pnpm verify` passes on the rebased branch before any task below.

## 1. Shared contracts and the diet kind's registries

- [x] 1.1 `packages/shared`: everything in design.md §1.
  - `CARE_KINDS` gains `diet` last, and `CARE_LABEL.diet` is `Diet`.
  - Add `DIET_TYPES`, `IDDSI_FOOD_LEVELS`, `FoodTexture`, `DIET_KCAL_RANGE`, `DIET_PROTEIN_RANGE`, `CARE_ORDER_ROLES` (a total map) and `DIET_TARGET_ROLES`.
  - Add `DietitianAssignment`, `AssignDietitianInput`, `FoodChartDay`, `NutritionView`, `FOOD_CHART_DAYS` and `NUTRITION_HISTORY_LIMIT`.
  - Change `NutritionStatus` (gains `dietitian`), `WorklistPatient` (gains `diet`) and `NutritionWorklist` (gains `assigned` and `diets`), with doc comments as in §1.
  - Verify: `pnpm --filter @meniscus/shared typecheck`. Task 1.2 follows in the same sitting, since the exhaustive maps fail typecheck until then.
- [x] 1.2 The `diet` entries of every exhaustive care map, test-first.
  - **Pure tests:**
    - `chart/care.test.ts`: `CARE_CODEC.diet` round-trips `{ renal, 7, 1800, 60 }`, and reads `{ type, texture }` with `kcal: null, protein_g: null`;
    - `CARE_RULES.diet` returns no prompt.
  - **Web tests** (`lib/care.test.ts`):
    - [web/ward] Diet order on the care plan: "Renal diet", "Soft diet", "History";
    - [web/ward] Diet badges on bed cards: "Renal and soft" and "No extra request" (the 5B dashboard load with diet orders, exactly the two GETs);
    - [web/ward] Care badges on bed cards: "Diet has its own badges", with "Every kind", "Litres", "No extra request" and "Acuity is not a care badge" passing unchanged;
    - [web/ward] Diet order from the bed review: "Form defaults" (the form's defaults and `input`);
    - [web/ward] Change care orders from the bed review: "Form defaults" (the existing test gains the diet bullet).
  - **Implement:**
    - server: `CARE_CODEC.diet`, `CARE_RULES.diet` (`[]`) and `CARE_VALUE.diet` (design.md §5; no step check);
    - web `lib/labels.ts`: `DIET_LABEL` and `FOOD_TEXTURE_LABEL`;
    - web `lib/care.ts`:
      - `CARE_BADGE` returns `string[]`, with the existing kinds wrapped as `[text]` and `careBadges` using flatMap;
      - `CARE_ROW.diet`, `CARE_HISTORY_TEXT.diet` and `CARE_FORM.diet`.
  - Verify: `pnpm typecheck` passes for every package, and the existing care and badge tests pass unchanged.

## 2. Server

- [x] 2.1 Care roles per kind, and the diet value.
  - **Tests** in `care.test.ts`:
    - bag-alerts' [charting/care-plan] Care order values tests ("Every kind", "Boundaries accepted", "Invalid values", "No interval, sent either way") pass unchanged;
    - [charting/care-plan] Care orders need a nurse: the existing "Attendant changes an order", "No session", "Matron sets an order" and "Attendant reads orders", plus "Dietitian sets and ends a diet", "Dietitian and other orders" and "Nurse or attendant and a diet".
  - **Tests** in `diet.test.ts`, [charting/care-plan] Diet order values: "Diet boundaries accepted" and "Invalid diet values".
  - **Tests** in `diet.test.ts`, [charting/care-plan] Diet order:
    - "Renal diet", "Listed last, no prompt" and "Targets left out";
    - "Not in Explain": exactly 1 upstream request, whose input contains neither `renal` nor `kcal`.
  - **Implement** `careRole` in `routes/care.ts` (design.md §4). It replaces `requireRole(DECIDER_ROLES)` on the PUT, DELETE and catheter-review routes, reading `CARE_ORDER_ROLES`. A decider keeps the 404 for an unknown kind; any other role gets 403 unless the kind lists it.
- [x] 2.2 Diet targets.
  - **Tests** in `diet.test.ts`, [charting/care-plan] Diet targets need a dietitian: "Nurse changes the texture", "Nurse cannot change or drop targets", "Nurse or matron cannot add targets", "Ending targets needs a dietitian", "No targets to keep" and "Order of checks".
  - **Store test** (in `diet.test.ts`, citing no requirement): `setCare` with `keepTargets` that differ from the active diet's returns `forbidden` and writes nothing, and `endCare` with `keepTargets: true` on a targeted diet does the same, even when the route's pre-check passed (call the store directly after a dietitian's change).
  - **Implement** (design.md §4):
    - `dietTargets` on PUT, after `AnyCareBody` and before `CARE_VALUE`, and on DELETE, before `endCare`. It applies to `diet` only and to roles outside `DIET_TARGET_ROLES`, and compares the raw body to the active order. It only orders the answers ("Order of checks").
    - The decision in the store: `setCare(…, { keepTargets })` and `endCare(…, { keepTargets: true })` compare inside their existing `tx()`, after reading the active order and before the same-value 200 or any write, and return `forbidden`, which the route maps to 403 `forbidden`.
- [x] 2.3 Assignments: the table, the store and the routes.
  - **Tests** in `assignment.test.ts`:
    - [charting/nutrition] Assign a dietitian: "Nurse assigns Sana", "Same dietitian again", "Another dietitian takes over", "Matron and dietitians on any ward", "Not allowed" and "Invalid or unknown";
    - [charting/nutrition] Hand back a patient: "Sana hands back", "Nothing to hand back", "Open referral with nobody to take it" and "Not allowed".
    - Store variants, as in design.md §10:
      - Joel Mathew (id 12, dietitian, `wards` 3A) is inserted with `node:sqlite`;
      - "nobody covers 3A" deletes Sana Mirza's 3A `staff_ward` row.
  - **Implement:**
    - `admission_dietitian` and its two indexes in `SCHEMA` (design.md §3);
    - the store's `assignDietitian`, `handBack`, `currentAssignments(wardId)` and `assignmentHistory(admissionId, limit)`, each in `tx()`;
    - `mayAssignDietitian` in `chart/nutrition.ts`;
    - `PUT` and `DELETE /admissions/:id/dietitian` in `routes/nutrition.ts`, with the chains in design.md §4 and strict `AssignBody`.
- [x] 2.4 Routing, status and the worklist.
  - **Tests** in `nutrition.test.ts`:
    - [charting/nutrition] Nutrition status on chart reads: "Ward pool", "No dietitian covers the ward" and "Assigned across wards";
    - [charting/nutrition] Refer to a dietitian: "Nurse refers", "Note kept, never logged", "Attendant or dietitian cannot refer", "Invalid referrals", "Already referred", "No dietitian available", "Unknown admission or no session" and the new "Assigned dietitian available";
    - [charting/nutrition] Referral routing: "Ward pool", "Another ward", "Closed", "Assigned dietitian first" and "Assigned across wards";
    - [charting/nutrition] Dietitian worklist: "Sana's worklist", "Your patients and diet orders" and "Not a dietitian or nobody signed in".
  - **Pure tests** in `chart/nutrition.test.ts`:
    - `routedTo`, including an assignee who is no longer a dietitian;
    - `worklistFor`: each patient once, the section order, and the order within each section.
  - **Implement:**
    - `routedTo`;
    - `WardReads.assignmentsByWard` (one query per ward);
    - `nutrition.dietitian`, and `dietitian_available` that also counts an assignment;
    - refer's `no_dietitian` check through routing;
    - `worklistFor` with `assigned` and `diets`, each list loaded with one query (design.md §6).
  - Update the existing fixtures that build `NutritionStatus` to add `dietitian: null`.
- [x] 2.5 The nutrition read and the referral history.
  - **Tests** in `nutrition-view.test.ts`:
    - [charting/nutrition] Patient nutrition read: "Priya's food chart", "Diet and assignments", "Nothing yet", "Long diet history" and "Unknown admission";
    - [charting/nutrition] Referral history: "Two referrals" (the test captures the server log and asserts it has no `Lost weight`) and "Long history".
  - **Pure tests** in `chart/nutrition.test.ts`: `foodChart` with meals at 23:59 and 00:00 local, a voided meal, and a drink-only snack.
  - **Implement** `foodChart` and `GET /admissions/:id/nutrition`: one query each for referrals, assignments, diet orders and meals since `since`. The referral, assignment and diet-order queries each take `LIMIT NUTRITION_HISTORY_LIMIT` (20).
- [x] 2.6 Schema.
  - **Implement:** `admission_dietitian` and its indexes go into `SCHEMA`, and `STORE_SCHEMA_VERSION` goes from 5 to 6, stopping if the live value is not 5 (fresh-schema design, "Rule for later changes"). No upgrade step; a store file from before this change fails to open (charting/entries "Store schema version").
- [x] 2.7 Demo (`scripts/demo-history.ts`, design.md §9).
  - **Write** HDU-3's renal diet by Sana Mirza, 5B-6's soft diet by Grace Lee, 2C-3's referral, acknowledgement, assignment and close, and Anita Thomas's rename of the `rice` dish to `jeera rice` on the meal 0.1 named (same `index`, `dish_kind` and `portion`; reason `dish name corrected`; through `amendMeal`), all before read-outcomes' and accuracy-views' snapshots.
  - **New guard:** Sana Mirza's worklist is `patients` [3A-7], `assigned` [2C-3] and `diets` [5B-6, HDU-3]. It throws on drift.
  - Update the header comment.
  - **Verify:**
    - one run over a fresh temporary `DATA_DIR` succeeds, with every guard passing: care-plan's and bag-emptying's `INTENDED`, bag-alerts' guards, read-outcomes' outcome counts and alerts snapshot, dietitian's `poor_meal_intake` assertion, accuracy-views' guards (its design §11: the outcome mix, with the renamed meal still `accepted`, and the alerts snapshot), and the new worklist guard;
    - no existing guard is edited, and the script makes no model request.

## 3. Web lib

- [x] 3.1 `lib/api.ts` and `lib/nutrition.ts`.
  - **Tests** in `lib/nutrition.test.ts`:
    - [web/ward] Nutrition on the bed review: "Acknowledged referral", "Closed with an outcome", "No dietitian", "Assigned dietitian", "Meals in the section" and "No extra request";
    - [web/ward] Assign a dietitian from the bed review: "Anita assigns Sana", "Dietitians covering the ward first", "Hand back" and "Who is offered";
    - [web/dietitian] Dietitian worklist: "Sana's worklist", "Your patients and diet orders", "Opens the bed review", "Requests" and "Nothing to do". The MODIFIED block keeps the scenario name "Opens the bed review" (OpenSpec refuses a MODIFIED block that drops a scenario) but now opens `/d/11` (design.md, "Overlaps"): rewrite the existing test `[web/dietitian] Dietitian worklist: Opens the bed review` in place for `/d/11` and its one nutrition GET;
    - [web/dietitian] Worklist for dietitians only: "Navigation", "Nurse opens the worklist" and "Nurse opens a patient view".
  - **Implement:**
    - `api.assignDietitian`, `api.handBack` and `api.nutritionView`;
    - the dietitian line, `mayAssignDietitian(staff, wardId)`, the dialog's ordering, and the worklist sections' row text;
    - `/d/<id>` as the rows' target.
- [x] 3.2 `lib/dishes.ts` (new, pure).
  - **Tests** in `lib/dishes.test.ts`, [web/ward] Dishes in the Nutrition section: "Lunch dishes", "Amended dishes", "Two dishes in one region" (rice and dal both at `index` 1, dal renamed `sambar`: rice has no mark, sambar reads `Amended 14:10 by Anita T. · was dal`, nothing added or removed), "Show tray" (one media GET across hide and show, and the overlay labels) and "No photo kept". Each is written first and seen to fail.
  - **Implement** `dishRows(meal)` with the `(index, order within that index)` pairing and the baseline of design.md §8.4, and `trayMediaId(meal)`: `proof.photo.media_id` when the photo is kept, else null.
- [x] 3.3 Diet form rules in `lib/care.ts`.
  - **Tests** in `lib/care.test.ts`, [web/ward] Diet order from the bed review: "Sana sets a renal diet", "Divya changes the texture", "Ending", "Dietitian's care plan", "Targets changed meanwhile" and "Attendant".
  - **Tests**, [web/ward] Change care orders from the bed review: "Acuity not offered here" (acuity-budget's test in `lib/acuity.test.ts`, updated in place: the offered kinds now end with diet) and the new "Dietitian offered diet only" in `lib/care.test.ts`.
  - **Implement:**
    - `addableKinds(care, staff)` filtered by `CARE_ORDER_ROLES`;
    - `mayChange(order, staff)` and `mayEnd(order, staff)`;
    - the read-only targets line;
    - the 403 message and the reload.
- [x] 3.4 `lib/nutrition-view.ts` (new): the loader and the pure text helpers.
  - **Tests** in `lib/nutrition-view.test.ts`:
    - [web/dietitian] Patient nutrition view: "Priya's food chart", "Dietitian, diet and referrals", "Requests" (including no request while hidden) and "Links";
    - [web/dietitian] Patients outside the dietitian's wards: "Joel opens HDU", "Cancel" (back to `/d`, or `/d` with no history), "Assigned is not enough", "Own wards" and "Once a shift, both views". These use `rota.ts` `needsReason` and `accessGrants` over a fake `localStorage`;
    - [web/dietitian] Referral actions in the patient view: "Acknowledge" and "Close";
    - [web/dietitian] Assignment from the patient view: "Take on", "Take over", "Hand back" and "Assign to a colleague";
    - [web/dietitian] Diet order from the patient view: "Set targets" and "History and end".
  - **Implement:**
    - `dayRows(view)`, using `dayLabel` and `plural` from DESIGN.md §3.1;
    - `referralLines` and `assignmentActions(view, staff)`;
    - `nutritionViewLoad`: one GET, the gate on the ward it names, and the reload after each action.

## 4. Web screens

- [x] 4.1 DESIGN.md and `Stepper`.
  - `Stepper` gains `unit` (default `mL`), and the existing call sites are unchanged.
  - **DESIGN.md:**
    - §4.9 covers diet targets;
    - §7.4 gains the patient view, the diet form (chips and targets, with read-only targets for non-dietitians), the assignment dialog, the dish list with amendment marks, and the diet badges (design.md §8.2).
- [x] 4.2 The bed review and the bed cards (`routes/n/$id.tsx`, `components/nutrition.tsx`, `components/care-forms.tsx`, `components/dish-list.tsx`, lazy `components/assign-dietitian-dialog.tsx`).
  - **Nutrition section:** the dietitian line and its actions, dishes per meal, "Show tray", and the `Nutrition view` link for dietitians.
  - **Care plan:** the diet row, its form and its history.
  - **Bed cards:** badges through `careBadges`, on the ward dashboards and on the attendant's bed screen.
  - Every string is the spec's, verbatim, following DESIGN.md §3 and §4.
- [x] 4.3 `/d` and `/d/$id`.
  - `routes/d/index.tsx`: three sections, with empty ones left out.
  - New `routes/d/$id.tsx`: the patient view (design.md §8.3), with `AccessGate`, a 30 s refresh paused while locked, hidden or gated, and the non-dietitian `Placeholder`.
  - `routeTree.gen.ts` is regenerated by `pnpm --filter @meniscus/web build`, never edited.
- [x] 4.4 Bundle.
  - Run `pnpm --filter @meniscus/web build`: the shared shell must stay ≤ 120 KB gzipped, and the `/d/$id` and `/n/$id` route chunks ≤ 50 KB each on top. The dialogs and the overlay are lazy.
  - Record the before and after sizes in the PR.

## 5. Docs

- [x] 5.1 README "Working with dietitians" gains:
  - **Assignment:** who may assign, and why a nurse on the ward stands in for the nurse in charge (design.md §2); routing; the hand back and its 409s;
  - **The diet order:** types, IDDSI food levels 3–7, and targets by dietitians only; who may end it; no counting of energy or protein;
  - **The patient view:** the 3-day food chart, and break-the-glass outside the dietitian's wards, which an assignment does not waive;
  - rollback (design.md, "Migration Plan"): the previous build refuses this store version, so delete `DATA_DIR` or re-seed it with that build.

  **API list:** the three new routes and `not_assigned`. **Demo notes:** HDU-3, 5B-6 and 2C-3. Update the test count.

## 6. Verification

- [x] 6.1 Browser check at 390 and 1100 px, through the Vite proxy.
  - **Setup:**
    - seed the demo (2.7) into a fresh temporary `DATA_DIR`, then serve that directory with tray-comparison's `scripts/fake-server.ts` (fake upstream, dummy key, never `.env`), in the same shift as seeding;
    - in Playwright, abort `/api/ai/*` (`route(…, abort)`) so no model request can be sent. Nothing here needs one.
  - **Signed in as `sana` (Sana Mirza, dietitian):**
    - `/d` shows:
      - "Referrals": 3A-7;
      - "Your patients": `2C-3 · Deepa Rao` with `Assigned <time> by Meera P.`;
      - "Diet orders": 5B-6 (`Diet · Regular · IDDSI 6 Soft & bite-sized · set by Grace L.`), then HDU-3 (`Diet · Renal · IDDSI 7 Regular · 1800 kcal · 60 g protein · set by Sana M.`).
    - HDU-3 opens `/d/21` with no reason dialog. It shows `Dietitian: ward dietitians`, the renal diet, and three day rows (`<Day> <d> <Mon> · …`).
      - "Take on": one PUT, then the reload; the line reads `Dietitian: Sana M. · assigned <time> by Sana M.`.
      - Change the energy target to 2000 kcal: one PUT, then the reload.
      - "Hand back…" and confirm: one DELETE, then the reload.
    - 2C-3's view: the closed `weight_loss` referral with `Lost weight at home`, and the assignment history.
    - 3A-7's view: "Close…" with `Monitoring`. Back on `/d`, 3A-7 has left "Referrals".
    - The bed review of a meal with a tray photo (tray-segmentation's demo bed): its dishes are listed. "Show tray" sends one `GET /api/media/<id>`; hiding and showing it again sends nothing. The meal task 2.7 amended (the bed design.md §9 names) lists `jeera rice · <portion>` with `Amended <time> by Anita T. · was rice`.
    - The bed review of HDU-3: "Nutrition view" links to `/d/21`. The care plan offers only "Add diet" on other beds, and "Change…" and "End…" on the diet.
  - **Signed in as `anita` (Anita Thomas, nurse; 3A and 5B):**
    - 3A-6 bed review:
      - "Assign dietitian…" lists `Sana Mirza · covers Medical Ward 3A`;
      - "Assign" sends one PUT, then the two GETs, and the line names Sana M.;
      - "Hand back…" sends one DELETE.
    - 5B dashboard: 5B-6 shows `IDDSI 2`, then `Food IDDSI 6`.
    - 5B-6 bed review: the diet row is `Diet · Regular · IDDSI 6 Soft & bite-sized`. "Change…" to `IDDSI 5 Minced & moist` sends one PUT `{ type: "regular", texture: 5 }`.
    - HDU-3, after a reason: the diet form shows `2000 kcal · 60 g protein · set by a dietitian` with no target control, no "End…", and `Only a dietitian can end a diet with targets.`.
    - `/d/11` reads `The nutrition view is for dietitians.` with a link to `/n/11`.
  - **Signed in as `ravi` (Ravi Kumar, attendant):**
    - 3A-6 bed review: the dietitian line, with no "Assign dietitian…" or diet controls;
    - "Nutrition" is not in his navigation;
    - 5B-6's attendant bed screen (its QR link from the 5B QR cards) shows `Food IDDSI 6`.
  - **Break-the-glass** (last):
    - stop the server, then delete Sana Mirza's HDU `staff_ward` row with `node:sqlite` from a scratch script outside the repo, and restart;
    - sign in as `sana` again: `/d/21` shows only the reason dialog, and its one nutrition GET;
    - a reason and her password send `POST /api/wards/4/access`, and the view opens;
    - `/n/21` then asks for no reason.
  - **Network panel:**
    - a bed review sends exactly the entries and meals GETs;
    - a dashboard sends the admissions and team GETs;
    - `/d` and `/d/$id` each send one GET, then one every 30 s;
    - each action sends one request, then the reload;
    - no `/api/ai` request is attempted.
  - **Keyboard only, at 390 px:** assign, hand back, and set a diet with targets. The dialogs trap focus and return it. There is no horizontal scroll.
  - Attach screenshots of every touched screen at 390 and 1100 px (DESIGN.md §9).
- [x] 6.2 `pnpm verify` passes: format, lint, `openspec validate --all --strict`, spec:check, typecheck and tests.

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Clear context between proposing and applying.
- Archive with `openspec archive dietitian-care --yes`, after accuracy-views and before scale-store, once `pnpm verify` passes.
- Then, in scale-store: add a dietitian-care row to its overlaps table (its task 1.1 rebase). Its triggers already cover `admission_dietitian`, and its status unit already covers `nutrition` and `care`.
- In bag-alerts (not edited here): its design.md "Overlaps" (dietitian-care, :343-349) and tasks.md "Workflow follow-up" (:245-250) say dietitian-care MODIFIES "Care order values" and must trim to ≤ 500 keeping the catheter bullet. Since the split (design.md §5), dietitian-care does not MODIFY it, so those lines should say: dietitian-care leaves "Care order values" as bag-alerts archives it and adds "Diet order values". Its tasks.md:54 sibling check should also note that dietitian-care changes `setCare` and `endCare` (`keepTargets`, design.md §4).
- In postgres-store (not edited here): add `admission_dietitian` to its baseline migration (with the partial unique index `WHERE ended_at IS NULL` and its version trigger) and to its import's table list (its design.md §4.7, step 5, after `referral`), and lock the admission row (`SELECT … FOR UPDATE`) at the start of the `setCare` and `endCare` transactions, which now hold the diet targets compare, and of assign and hand back (design.md §4, "Overlaps").
