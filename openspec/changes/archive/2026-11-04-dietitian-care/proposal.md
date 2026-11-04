# Proposal

## Why

The user asked for every feature, with no cuts: "collaborate with the dietician if available for the patient like hospital chains do". The `dietitian` change shipped the MVP: the role, ward cover, the `poor_meal_intake` prompt, referrals and a one-section worklist. Its "Deferred" list is everything a dietitian needs to own a patient's nutrition:
- a named dietitian per patient (for example, a renal dietitian on a medical ward);
- the diet order itself (therapeutic type, IDDSI food texture, and energy and protein targets that only a dietitian sets);
- a patient view with the 3-day food chart that dietitians use as evidence;
- the dish-level tray readings tray-segmentation now keeps.

This change builds all of it on the archived text of `dietitian`, `care-plan`, `bag-alerts`, `tray-segmentation` and `tray-comparison`.

## What Changes

- **Assign a dietitian** (`charting/nutrition`).
  - `PUT /api/admissions/:id/dietitian` with `{ staff_id }` names the patient's dietitian. Who may assign:
    - a nurse or matron whose `wards` include the bed's ward: the existing `mayNameInCharge` rule, which stands in for "the nurse in charge";
    - any dietitian.
  - There is no `in_charge` on chart reads (design.md §2).
  - Assigning another dietitian ends the current assignment at the same instant. The same dietitian again gets 200 and changes nothing.
  - **Hand back:** `DELETE /api/admissions/:id/dietitian` ends the assignment, so the patient is routed to the ward's dietitians again. The patient's referrals are unchanged.
    - 409 `not_assigned` when nobody is assigned.
    - 409 `no_dietitian` when an open or acknowledged referral would be left with no dietitian covering the ward.
  - **Routing:** the assigned dietitian first, otherwise the ward's dietitians. It applies to referrals and to diet orders on the worklist.
  - `dietitian_available` is also true for an assigned patient, so a referral can be made on a ward no dietitian covers.
  - New `admission_dietitian` table. One row per assignment: who assigned, when, and who ended it.
  - `nutrition.dietitian` on chart reads.
- **Referral history and the patient nutrition read.** `GET /api/admissions/:id/nutrition` returns:
  - the admission and its `nutrition`;
  - every referral, newest first, at most 20;
  - the assignment history;
  - the active diet order and the diet order history;
  - the meals of the last 3 local days (`FOOD_CHART_DAYS`), with per-day counts.

  Referral notes are returned, and never logged.
- **Diet order** (`charting/care-plan`). A new care kind `diet`, listed after every other kind in `care.orders`. Its value:
  - `type`: one of `DIET_TYPES`;
  - `texture`: an IDDSI food level from 3 to 7;
  - `kcal`: optional, 800–4000;
  - `protein_g`: optional, 20–200.

  It raises no prompt and adds nothing to Explain's input. Permissions:
  - Nurses, the matron and dietitians may set and change the type and texture.
  - Only a dietitian may set, change or clear `kcal` or `protein_g`. Anyone else gets 403, so a nurse changing the texture sends the targets back unchanged.
  - Only a dietitian may end a diet order that has a target. This closes the "end it, then set it again without targets" bypass.
  - "Care orders need a nurse" is MODIFIED from its live text. The diet's values are a new requirement, "Diet order values", so "Care order values" stays as bag-alerts leaves it (design.md §5).
- **Web, `web/dietitian`:**
  - **`/d/$id` patient view:** the dietitian line, the diet order, the referral history and the 3-day food chart with dishes and "Show tray".
  - **Break-the-glass** outside the dietitian's wards: a reason and password, recorded through `POST /api/wards/:id/access`, as for the other roles. An assignment does not waive it.
  - **Actions:** acknowledge and close a referral, "Take on", "Hand back" and "Assign…", and set, change or end the diet order.
  - **The worklist:** it gains "Your patients" and "Diet orders" after "Referrals", and its rows open the patient view.
  - Anyone else at `/d/$id` is told it is for dietitians, with a link to the bed review.
- **Web, `web/ward`:**
  - **Bed review:** "Assign dietitian…", "Change…" and "Hand back…" in the Nutrition section, which names the assigned dietitian.
  - **Care plan:** the diet order row and its history.
  - **Diet form:** the targets are editable by dietitians and read-only for others.
  - **Bed cards:** a diet badge, which also appears on the attendant's bed screen, since that screen shows the card's badges.
  - **Nutrition section:** each meal lists its dishes from `Meal.dishes`, with "Show tray" (the tray overlay; one `GET /api/media/<id>` on tap). Dishes a meal amendment changed, added or removed are marked as amended.
- **Demo census** (`scripts/demo-history.ts`, fictional):
  - HDU-3: a renal diet set by Sana Mirza;
  - 5B-6: a soft diet, texture 6, set by Grace Lee;
  - 2C-3: assigned to Sana Mirza, with a closed `weight_loss` referral;
  - one 3A photo meal: Anita Thomas renames its `rice` dish to `jeera rice`, so the bed review shows an amended-dish mark.

  The care-plan, bag-emptying, bag-alerts, read-outcomes, dietitian and accuracy-views guards stay as they are and still pass. A new guard checks Sana Mirza's worklist.
- **Docs:** README "Working with dietitians" gains assignment, diet orders and the patient view.

### Upstream model requests per user action (before → after)

| Action | Before | After |
|---|---|---|
| Assign, hand back, nutrition read, patient view, worklist, Show tray | n/a | 0 |
| Set, change or end a diet order | n/a | 0 |
| `POST /api/ai/explain` | 1 | 1 (a diet order adds nothing to its input) |
| Every other action | unchanged | unchanged |

### Config (shared constants; code, no env, no UI)

| Constant | Default | Used by |
|---|---|---|
| `DIET_TYPES` | `regular`, `diabetic`, `renal`, `low_salt`, `low_fat`, `high_energy`, `gluten_free` | diet validation, chips |
| `IDDSI_FOOD_LEVELS` | 3 Liquidised, 4 Pureed, 5 Minced & moist, 6 Soft & bite-sized, 7 Regular | diet validation, chips |
| `DIET_KCAL_RANGE` | 800–4000, step 50, default 1800 | diet validation, stepper |
| `DIET_PROTEIN_RANGE` | 20–200 g, step 5, default 60 | diet validation, stepper |
| `FOOD_CHART_DAYS` | `3` | nutrition read |
| `NUTRITION_HISTORY_LIMIT` | `20` | referrals, assignments and diet orders in the nutrition read |

Role lists, like `DECIDER_ROLES`:
- `CARE_ORDER_ROLES`: per care kind; `diet` adds `DIETITIAN_ROLES`.
- `DIET_TARGET_ROLES`: `DIETITIAN_ROLES`.

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `CARE_KINDS` and `CareKind` gain `diet`, last. `CareValues`, `CareInput` and `CareOrder` gain its value, and `CARE_LABEL` gains `Diet`. Each exhaustive care map must add it:
    - in the server, `CARE_CODEC`, `CARE_RULES` and `CARE_VALUE`;
    - in the web, `CARE_BADGE`, `CARE_ROW`, `CARE_HISTORY_TEXT` and `CARE_FORM`.
  - **BREAKING**: `NutritionStatus` gains `dietitian: DietitianAssignment | null`. It is used by `AdmissionSummary`, `EntryList` and `WorklistPatient`, so fixtures change.
  - **BREAKING**: `NutritionWorklist` gains `assigned` and `diets`. `WorklistPatient` gains `diet`.
  - New:
    - `DIET_TYPES`, `DietType`, `IDDSI_FOOD_LEVELS` and `FoodTexture`;
    - `DIET_KCAL_RANGE` and `DIET_PROTEIN_RANGE`;
    - `CARE_ORDER_ROLES` and `DIET_TARGET_ROLES`;
    - `DietitianAssignment`, `AssignDietitianInput`, `FoodChartDay` and `NutritionView`;
    - `FOOD_CHART_DAYS` and `NUTRITION_HISTORY_LIMIT`.
- HTTP:
  - new routes:
    - `PUT /api/admissions/:id/dietitian`: 201 or 200 `DietitianAssignment`;
    - `DELETE /api/admissions/:id/dietitian`: 200;
    - `GET /api/admissions/:id/nutrition`: 200 `NutritionView`;
  - new 409 code `not_assigned`. `no_dietitian` is also returned when handing back;
  - `PUT` and `DELETE /api/admissions/:id/care/diet` go through the existing care routes:
    - dietitians may now change `diet` orders, and get 403 on every other kind;
    - a non-dietitian who changes a target gets 403;
  - **BREAKING**: chart reads' `nutrition` gains `dietitian`;
  - **BREAKING**: `GET /api/nutrition/worklist` gains `assigned`, `diets`, and `diet` on each patient;
  - `POST /api/admissions/:id/referrals` accepts a referral for an assigned patient even when no dietitian covers the ward.

### Out of scope

- **Clinical content.**
  - No counting of energy or protein from meals or photos, and no nutrient analysis. The targets are an order for the kitchen and the ward, not a tally.
  - No check of dishes against the ordered texture, and no prompt for a mismatch (not a diagnostic device).
  - No IDDSI 7 "Easy to chew" or transitional foods.
  - No allergy or religious diet coding, no menu ordering and no catering link.
- **Other roles.** No speech and language therapist role, though texture is often their recommendation. No assigning anyone but dietitians.
- **Assignment extras.** No caseload limits, notifications or dietitian rota. No server-side ward check for dietitians, the stance ward-staffing took; the web asks for a reason outside their wards.
- **Interactions.** Nil by mouth does not end or pause a diet order. Both can be active, and the bed shows both.
- **Screens.** No printed food chart; the printable daily chart is unchanged. No UI to edit which wards a dietitian covers.
- Everything `dietitian` already rules out: MUST or NRS-2002 screening, re-opening referrals, and a nurse cancelling a referral.

## Capabilities

### New Capabilities

None. `charting/nutrition` and `web/dietitian` are added by `dietitian`, which archives first.

### Modified Capabilities

- `charting/care-plan`:
  - MODIFIED **Care orders need a nurse** (dietitians, for `diet` only);
  - ADDED **Diet order**, **Diet order values** and **Diet targets need a dietitian**.
- `charting/nutrition` (added by `dietitian`):
  - MODIFIED **Nutrition status on chart reads**, **Refer to a dietitian**, **Referral routing**, **Dietitian worklist**;
  - ADDED **Assign a dietitian**, **Hand back a patient**, **Patient nutrition read**, **Referral history**.
- `web/dietitian` (added by `dietitian`):
  - MODIFIED **Dietitian worklist** and **Worklist for dietitians only**;
  - ADDED **Patient nutrition view**, **Patients outside the dietitian's wards**, **Referral actions in the patient view**, **Assignment from the patient view** and **Diet order from the patient view**.
- `web/ward`:
  - MODIFIED **Nutrition on the bed review** (added by `dietitian`), and **Change care orders from the bed review** and **Care badges on bed cards** (from acuity-budget's delta: diet joins the offered kinds, dietitians get diet only, and diet badges are excluded from the one-badge-per-order list);
  - ADDED **Dishes in the Nutrition section**, **Assign a dietitian from the bed review**, **Diet order on the care plan**, **Diet order from the bed review** and **Diet badges on bed cards**.

Seven of the MODIFIED requirements come from `dietitian`'s delta and two in `web/ward` from acuity-budget's; `openspec validate` reports them as INFO until those changes archive.

## Impact

- `packages/shared/src/index.ts`: the types, constants and role lists above.
- `apps/server`:
  - `src/routes/care.ts`:
    - the role check per kind from `CARE_ORDER_ROLES`, replacing `requireDecider`;
    - the `diet` value;
    - the targets check on `PUT` and `DELETE`.
  - `src/chart/care.ts`: `CARE_CODEC.diet` and `CARE_RULES.diet`, which raises no prompt.
  - `src/routes/nutrition.ts`: the assignment routes and the nutrition read.
  - `src/chart/nutrition.ts`: routing, `mayAssignDietitian`, the worklist sections and the food-chart days.
  - `src/chart/view.ts`: `WardReads` gains the current assignments, and `nutrition` gains `dietitian`.
  - `src/store/store.ts`: the `admission_dietitian` table and its queries.
  - `scripts/demo-history.ts`.
- `apps/web`:
  - `lib/care.ts`, `lib/labels.ts`, `lib/nutrition.ts` and `lib/api.ts`;
  - new `lib/dishes.ts` and `lib/nutrition-view.ts`;
  - `components/care-plan.tsx`, `components/care-forms.tsx` and `components/nutrition.tsx`;
  - new `components/dish-list.tsx` and lazy `components/assign-dietitian-dialog.tsx`;
  - `routes/d/index.tsx`, new `routes/d/$id.tsx`, `routes/n/$id.tsx` and `routes/n/w.$ward.tsx`.
- README: "Working with dietitians", the API list and demo notes.
- No new dependencies and no env vars. 0 new model requests.
- UI follows `apps/web/DESIGN.md`. Its §4.9 `Stepper` gains a `unit` prop, and §7.4 gains the patient view, diet form and assignment patterns, both in this change.
- **Apply order:** care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → bag-alerts → accuracy-views → **dietitian-care** → scale-store.
  - bag-alerts archives **before** this change. It MODIFIES "Care order values" (498 characters, 526 with a diet bullet), so this change leaves that requirement alone and adds "Diet order values" instead (design.md §5).
  - postgres-store (Supabase Postgres, being planned) applies after scale-store. It is not a dependency, but its schema port must carry `admission_dietitian`. See design.md, "Overlaps".
