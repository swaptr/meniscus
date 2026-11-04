# Design

## Context

Motivation is in proposal.md, "Why". This change applies after `dietitian` and the changes listed in "Overlaps" archive, so the state below is theirs where they change it.

- **Roles** (`packages/shared`, after `dietitian`):
  - `STAFF_ROLES` has `dietitian`;
  - `DECIDER_ROLES` = nurse, matron; `DIETITIAN_ROLES` = dietitian; `REFERRER_ROLES` = nurse, matron; `TEAM_ROLES` = attendant, nurse.
  - `requireRole(list)` (`routes/common.ts`) replaced `requireDecider`, which is `requireRole(DECIDER_ROLES)`.
- **Staffing** (`apps/server/src/chart/staffing.ts:17-27`):
  - `onWard(staff, wardId)`;
  - `mayNameInCharge` = a decider on the ward;
  - `mayTakeCharge` and `mayAssignBeds`, which reads `team.in_charge` from the team read.
- **Care orders** (`routes/care.ts:81-103`, `chart/care.ts:54,159`, `store.ts:257-270`):
  - `care_order` has no CHECK on `kind`, and one active order per kind (`care_order_active`).
  - PUT chain: `requireDecider` (403) → `careTarget` (404: admission or kind) → `smallJson` (413) → `AnyCareBody` (400: any JSON object) → `CARE_VALUE[kind]` (400) → `conflict` (400) → `setCare` (201, or 200 for the same value).
  - DELETE chain: `requireDecider` → `careTarget` → `endCare` (404 when none is active).
  - Exhaustive maps: `CARE_CODEC`, `CARE_RULES`, `CARE_VALUE` (server); `CARE_BADGE`, `CARE_ROW`, `CARE_HISTORY_TEXT`, `CARE_FORM` (web, `lib/care.ts:75-322`).
  - `careBadges` maps one badge per order (`lib/care.ts:89`). `addableKinds` lists the kinds with no active order (`:327`). `endConfirmText` gives `End <label>?` (`:324`).
  - acuity-budget puts `acuity` first in `CARE_KINDS` and specifies its value in its own "Acuity order".
- **Nutrition** (`dietitian`):
  - `referral` table with `referral_in_progress` (one open or acknowledged per admission).
  - Routing is computed at read time from the dietitians' `staff_ward` rows.
  - `nutritionRoutes` in `routes/nutrition.ts`. `worklistFor` and `poorMealIntake` live in `chart/nutrition.ts`.
  - `WardReads` (`chart/view.ts`) holds a ward's reads for `chartView`, so a list costs a fixed number of queries per ward.
- **Meals** (tray-segmentation, tray-comparison):
  - `Meal.dishes: DishValue[]` (`index`, `name`, `dish_kind`, `portion`); `index` 0 means "in no region".
  - `Meal.proof.photo.media_id` is the tray photo. The tray overlay and "Tray proof on the bed review" draw it, fetching once.
  - `Meal.amendments[]`: tray-comparison's `MealAmendment` `{ id, at, by, reason, before, after }`, oldest first, where `before` and `after` are `MealValues` (`portion`, `items` and `dishes: DishValue[]`).
- **Web access**:
  - `AccessGate` and `useNeedsReason(wardId)` (`lib/use-access.ts:10`) gate a page by ward until `POST /api/wards/:id/access` accepts a reason and a password.
  - Grants are per ward, per shift (`SHIFTS`: day 08:00, night 20:00), per person and per device.
- **UI contract**: `apps/web/DESIGN.md`, in particular:
  - §4.5 list row, §4.8 choice chips, §4.9 `Stepper` (mL only today), §4.11 sheets, §4.13 states;
  - §6 lazy dialogs, and the 30 s refresh paused while locked or hidden;
  - §7.4 dietitian worklist.

## Goals / Non-Goals

**Goals:**
- A named dietitian per patient, with routing, hand back and an audit trail, and no new role logic beyond one helper.
- A diet order the ward can read at a glance, whose energy and protein targets only a dietitian controls.
- One patient view per dietitian patient, from one GET, with the 3-day food chart.
- 0 model requests for every new action; no extra request on any existing screen.

**Non-Goals:**
- Counting energy or protein, nutrient analysis, or checking dishes against the texture (proposal, "Out of scope").
- A server-side ward check for dietitians.
- An `in_charge` field on chart reads (§2).

## Decisions

### 1. Types (`packages/shared`)

```ts
// ---------- care: the diet order ----------
// CARE_KINDS gains 'diet' LAST: [...existing, 'diet']. CARE_LABEL.diet = 'Diet'.
export const DIET_TYPES = ['regular', 'diabetic', 'renal', 'low_salt', 'low_fat', 'high_energy', 'gluten_free'] as const
export type DietType = (typeof DIET_TYPES)[number]
/** IDDSI food levels; 3 and 4 are shared with drinks (Liquidised / Moderately thick, Pureed / Extremely thick). */
export const IDDSI_FOOD_LEVELS = [
  { level: 3, name: 'Liquidised' },
  { level: 4, name: 'Pureed' },
  { level: 5, name: 'Minced & moist' },
  { level: 6, name: 'Soft & bite-sized' },
  { level: 7, name: 'Regular' },
] as const
export type FoodTexture = (typeof IDDSI_FOOD_LEVELS)[number]['level']
export const DIET_KCAL_RANGE = { min: 800, max: 4000, step: 50, default: 1800 } as const
export const DIET_PROTEIN_RANGE = { min: 20, max: 200, step: 5, default: 60 } as const

// CareValues gains:
//   diet: { type: DietType; texture: FoodTexture; kcal: number | null; protein_g: number | null }
// CareInput<'diet'> = { type; texture; kcal?: number | null; protein_g?: number | null }

/** Who may set, change or end each kind's orders. */
export const CARE_ORDER_ROLES: { readonly [K in CareKind]: readonly StaffRole[] } = {
  // every existing kind: DECIDER_ROLES
  diet: [...DECIDER_ROLES, ...DIETITIAN_ROLES],
}
/** Who may set, change or remove a diet's kcal and protein targets, and end a diet that has one. */
export const DIET_TARGET_ROLES: readonly StaffRole[] = DIETITIAN_ROLES

// ---------- nutrition ----------
export const FOOD_CHART_DAYS = 3
export const NUTRITION_HISTORY_LIMIT = 20

export interface DietitianAssignment {
  id: number
  admission_id: number
  staff: StaffRef
  assigned_at: string
  assigned_by: StaffRef | null
  ended_at: string | null
  ended_by: StaffRef | null
}
/** Body of PUT /api/admissions/:id/dietitian. */
export interface AssignDietitianInput { staff_id: number }

// NutritionStatus gains:
//   /** The current assignment, or null: routed to the ward's dietitians. */
//   dietitian: DietitianAssignment | null
// dietitian_available: some dietitian covers the ward, OR one is assigned.

// WorklistPatient gains: diet: CareOrder<'diet'> | null
/** GET /api/nutrition/worklist. Each patient appears once, in the first list that applies. */
export interface NutritionWorklist {
  since: string
  patients: WorklistPatient[] // a referral in progress routed to me: open, then acknowledged, oldest first
  assigned: WorklistPatient[] // the rest assigned to me, by ward id then bed
  diets: WorklistPatient[] // the rest routed to me with a diet order, by ward id then bed
}

export interface FoodChartDay {
  /** Local date 'YYYY-MM-DD'. */
  date: string
  /** Not voided, not drink-only snacks. */
  meals: number
  /** Of those, eaten POOR_INTAKE_PORTION or less. */
  poor_meals: number
}

/** GET /api/admissions/:id/nutrition. */
export interface NutritionView {
  admission: Admission
  nutrition: NutritionStatus
  referrals: Referral[] // newest created_at first, ≤ NUTRITION_HISTORY_LIMIT
  assignments: DietitianAssignment[] // newest assigned_at first, ≤ NUTRITION_HISTORY_LIMIT
  diet: CareOrder<'diet'> | null
  diet_history: CareOrder<'diet'>[] // newest start first, ≤ NUTRITION_HISTORY_LIMIT ("Patient nutrition read")
  /** 00:00 local on the first of the last FOOD_CHART_DAYS local dates. */
  since: string
  meals: Meal[] // since `since`, voided included, newest first
  days: FoodChartDay[] // FOOD_CHART_DAYS entries, newest first
}
```

- **Diet targets are `null`, not absent**, in reads, as `nil_by_mouth.until` is. The codec stores the value as JSON and reads absent keys as `null`.
- **`FoodTexture` starts at 3.** Levels 0–2 are drinks only. IDDSI 7 "Easy to chew" (7EC) is out of scope.
- **`CARE_ORDER_ROLES`** is a total map, so a new kind cannot forget its roles. Every check reads it; no role string is compared.

### 2. Who may assign: `mayNameInCharge`, not an `in_charge` field

The brief's "the nurse in charge" is served by `mayAssignDietitian(staff, wardId) = mayNameInCharge(staff, wardId) || DIETITIAN_ROLES.includes(staff.role)`, in `chart/nutrition.ts`.

- **It is the same people.** Any nurse on the ward may name herself in charge (`mayNameInCharge`, "Name the nurse in charge"), so "the nurse in charge, or any ward nurse who could become it" is everyone `mayNameInCharge` admits. A check on `team.in_charge` would add a step that any of them can take anyway.
- **`in_charge` is per shift and lives on the team read.** Putting it on `EntryList` or `AdmissionSummary` would be a BREAKING shape change. The web would also need `GET /api/wards/:id/team` on the bed review, which is an extra request per bed, against the rule "no extra request on existing screens".
- **The web already has the inputs.** `useStaff()` gives the role and `wards`, and the bed review has the ward id, so the web can decide what to offer with no request.
- **Matron.** `mayNameInCharge` admits a matron on her `wards`; Lakshmi Iyer has every ward.
- **Dietitians on any ward.** As in `dietitian`, there is no server-side ward check for dietitians. The web asks for a reason outside their wards (§8.3).
- **Alternative rejected:** `mayAssignBeds` (the in-charge or an overseer). It excludes an ordinary ward nurse at the bed, which is the person most likely to see that a patient needs the renal dietitian.

### 3. Assignments: data model and routing

```sql
-- One row per assignment; only ever ended, so the rows are the audit trail (as care_order).
CREATE TABLE IF NOT EXISTS admission_dietitian (
  id INTEGER PRIMARY KEY,
  admission_id INTEGER NOT NULL REFERENCES admission(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  assigned_at INTEGER NOT NULL,
  assigned_by INTEGER REFERENCES staff(id),
  ended_at INTEGER,
  ended_by INTEGER REFERENCES staff(id),
  CHECK (ended_at IS NULL OR ended_at >= assigned_at),
  CHECK ((ended_at IS NULL) = (ended_by IS NULL))
) STRICT;
-- At most one current assignment per admission.
CREATE UNIQUE INDEX IF NOT EXISTS admission_dietitian_current ON admission_dietitian (admission_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS admission_dietitian_admission ON admission_dietitian (admission_id, assigned_at);
```

- **No CHECK that `staff_id` is a dietitian.** The route checks the role. A roster change (a dietitian leaving) leaves the history readable. Routing ignores an assignment whose staff is no longer a dietitian: it falls back to the ward pool, and `nutrition.dietitian` is then null.
- **Assign** runs in `tx()`:
  1. read the current row;
  2. if it is the same staff, return it with 200;
  3. otherwise `UPDATE … SET ended_at = now, ended_by = me WHERE admission_id = ? AND ended_at IS NULL`, `INSERT` the new row, and return 201.

  `ended_by` is the person who made the new assignment.
- **Hand back** runs in `tx()`:
  1. no current row: 409 `not_assigned`;
  2. a referral in progress (`referral_in_progress`) and no dietitian covering the ward: 409 `no_dietitian`;
  3. otherwise end the row and return 200.
- **Routing** (`routedTo(admission, current, coveredBy)`, pure): the current assignment's staff, if they are still a dietitian; otherwise every dietitian whose `wards` include the ward.
  - It is used by the worklist, by `dietitian_available` (`current !== null || covered`) and by refer's 409 `no_dietitian`.
  - It is computed at read time, as in `dietitian` §2.
- **`WardReads`** gains `assignmentsByWard`: one query of the current rows joined to `staff`, per ward, so chart reads stay a fixed number of queries per ward.
- **The nutrition read** loads the assignment history with its own query (`ORDER BY assigned_at DESC, id DESC LIMIT 20`).

### 4. HTTP

| Route | Chain | Answers |
|---|---|---|
| `PUT /admissions/:id/dietitian` | `requireRole([...DECIDER_ROLES, ...DIETITIAN_ROLES])` → admission → `mayAssignDietitian` → `smallJson` → `AssignBody` (strict `{ staff_id: int }`) → staff is a dietitian → `tx` | 403 · 404 · 403 · 413 · 400 · 400 · 201 / 200 `DietitianAssignment` |
| `DELETE /admissions/:id/dietitian` | same role → admission → `mayAssignDietitian` → `tx` | 403 · 404 · 403 · 409 `not_assigned` · 409 `no_dietitian` · 200 |
| `GET /admissions/:id/nutrition` | admission | 404 · 200 `NutritionView` |
| `PUT /admissions/:id/care/:kind` | `careRole` → `careTarget` → `smallJson` → `AnyCareBody` → `dietTargets` → `CARE_VALUE[kind]` → `conflict` → `setCare` (targets re-checked in its `tx`) | 403 · 404 · 413 · 400 · 403 · 400 · 400 · 403 / 201 / 200 |
| `DELETE /admissions/:id/care/:kind` | `careRole` → `careTarget` → `dietTargets` → `endCare` (targets re-checked in its `tx`) | 403 · 404 · 403 · 404 · 403 / 200 |
| `POST /admissions/:id/care/catheter/review` | `careRole` (kind `catheter`) → `careTarget` → … | unchanged for deciders; 403 for dietitians |

- **The second 403s come after the 404.** These are the assignment ward check and the targets check. Both need the admission, or its active order, to answer. This is the "Name the nurse in charge" precedent (404 → 403 ward → 400) and keeps 401 → 403 → 404 → 400 → 409 for each check that can run first.
- **`careRole`** reads `c.req.param('kind')`:
  - a role in `DECIDER_ROLES` passes for any kind, so a nurse's unknown kind still gets 404 from `careTarget`, as today;
  - any other role passes only when the kind is a care kind whose `CARE_ORDER_ROLES` lists it. So a dietitian gets 403 for `fluid_limit`, for `catheter/review`, and for an unknown kind such as `fluid_restriction` ("Dietitian and other orders").
- **`dietTargets`** runs only for `diet` and a role outside `DIET_TARGET_ROLES`:
  - on PUT: read the active diet; `kcal` and `protein_g` in the body (absent = `null`, any type) must equal the active order's, or `null` when there is none. Otherwise 403 `forbidden`.
  - on DELETE: 403 when the active diet has a target.

  It compares raw body fields before the value schema, so `{ texture: 9, kcal: 2000 }` gets 403 for Divya and 400 for Sana ("Order of checks"). This route check only orders the answers; it reads the active order outside any store transaction, so it does not decide.
- **The decision is in the store's transaction.** The route passes `keepTargets: { kcal, protein_g }` (the raw body's pair, absent = `null`) to `setCare`, and `keepTargets: true` to `endCare`, when the role is outside `DIET_TARGET_ROLES`. Inside the `tx()` that already reads the active order before writing:
  - `setCare` compares the pair with the active diet's targets (`null` when there is none);
  - `endCare` refuses when the active diet has a target;
  - either returns `forbidden` and writes nothing, and the route answers 403 `forbidden`.

  On `node:sqlite` the two reads cannot differ, because the handler is synchronous. On postgres-store, its admission-row lock (`SELECT … FOR UPDATE`, its design §4.1) is taken at the start of that `tx`, so a dietitian's concurrent change is either seen or waits. A lost race is one 403, never a retry ("Overlaps").
- **Logging.** The nutrition read logs path, status and timing only, as every route does. Referral notes are never in a log line or an error message ("Referral history").

| Action | Nurse / matron on the ward | Nurse / matron off the ward | Dietitian | Attendant |
|---|---|---|---|---|
| Assign, hand back | yes | 403 | yes, any ward | 403 |
| Diet type, texture | yes | yes (no server ward check for care, as today) | yes | 403 |
| Diet `kcal`, `protein_g`; end a targeted diet | 403 | 403 | yes | 403 |
| Other care kinds, catheter review | yes | yes | 403 | 403 |
| `GET /admissions/:id/nutrition` | yes | yes | yes | yes (no UI) |

### 5. The diet order

- **Placed last in `CARE_KINDS`.** So "Care status on chart reads" (which acuity-budget MODIFIES) keeps its order clause: every existing kind keeps its place, and `diet` follows. No third MODIFIED of that requirement is needed.
- **Diet values in their own requirement, "Diet order values"; "Care order values" is not MODIFIED.**
  - bag-alerts' "Care order values" (its delta, archived before this change) is 498 characters on its own (OpenSpec's count). With ``- `diet`: see "Diet order".`` it is 526.
  - bag-alerts requires the catheter bullet to stay as it archives it (its design "Overlaps", its tasks.md "Workflow follow-up"). Trimming everything else (one intro phrase, and `fluid_limit` and `intake_target` merged into one bullet) still leaves 514, and the next trims would make the other bullets hard to read.
  - So the requirement is split. "Care order values" keeps the existing kinds, exactly as bag-alerts archives it, with its four scenarios; this change carries no copy of it, so nothing has to be re-copied or re-trimmed after bag-alerts archives. The ADDED "Diet order values" (391 characters) holds the diet value and the same 400 `invalid_request` rule, with "Diet boundaries accepted" and "Invalid diet values".
  - This is acuity-budget's precedent: its "Acuity order" specifies acuity's value, and "Care order values" does not list acuity either. "Each kind SHALL accept only its own value" still reads true, since diet's value is specified, in its own requirement.
  - "Diet order" keeps the shape (`{ type, texture, kcal, protein_g }`, targets null when left out) and points to "Diet order values" for the ranges, so the ranges are stated once.
- **`CARE_VALUE.diet`**: `z.object({ type: z.enum(DIET_TYPES), texture: z.union(IDDSI_FOOD_LEVELS literals), kcal: int in DIET_KCAL_RANGE, step-free, nullable optional, protein_g: likewise }).strict()`. Steps are a UI concern: any integer in range is accepted (1825 kcal is valid).
- **`CARE_RULES.diet`** returns no prompt. `explainContext` reads alerts and entries only (`ai/explain.ts:10`), so a diet adds nothing to Explain's input with no change there.
- **`CARE_CODEC.diet`** stores the value as JSON with `kcal` and `protein_g` always present. It reads an absent key as `null`.
- **Same value again** gets 200 (`setCare`'s existing equality). A nurse resending the active targets with a new texture is a change, so 201.
- **Nil by mouth** does not end or pause a diet. Both stay active, and both show.

### 6. Worklist sections

`worklistFor(staff, { referrals, assignments, diets, covered, meals })` (pure):

1. **`patients`**: admissions with a referral in progress routed to `staff`, ordered as `dietitian` orders them (open, then acknowledged, each by `created_at`, then referral id).
2. **`assigned`**: admissions not already listed whose current assignment is `staff`, by ward id, then bed label (natural order, as the census sorts).
3. **`diets`**: admissions not already listed, routed to `staff` (§3), with an active diet order, in the same order.

- Each `WorklistPatient` carries `nutrition`, `diet` and `intake`, as in `dietitian`.
- **Queries** (one each, on the union of the dietitian's covered wards and the wards of the patients assigned to them): in-progress referrals, current assignments, active diet orders, and meals since `since`. The number of queries does not depend on the number of patients.

### 7. The nutrition read and the food chart

- **`since`** = local midnight of `localDate(now) − (FOOD_CHART_DAYS − 1)`, built with local-time constructors (`new Date(y, m, d - 2)`), so it is DST-safe like `shiftStart`.
- **`meals`**: every meal charted at or after `since`, voided included (as the bed review lists them), newest first.
- **`days`**: always `FOOD_CHART_DAYS` entries, newest first. Each counts the meals of that local date that are not voided and not drink-only snacks (the `dietitian` §3 definition), and those with `portion ≤ POOR_INTAKE_PORTION`.
- **`foodChart(meals, now)`** (pure, `chart/nutrition.ts`) builds `since` and `days`. The route adds the referrals, assignments and diet orders.
- **No break-the-glass on the server**, as for every chart read. The web gates it (§8.3).

### 8. Web

#### 8.1 Modules

| File | Layer | What |
|---|---|---|
| `lib/care.ts` | web | `CARE_BADGE`, `CARE_ROW`, `CARE_HISTORY_TEXT` and `CARE_FORM` gain `diet`. `CARE_BADGE` returns `string[]` per order (existing kinds `[text]`), and `careBadges` flatMaps. `addableKinds(care, staff)` filters by `CARE_ORDER_ROLES`. `mayEnd(order, staff)` handles the targeted diet. |
| `lib/labels.ts` | web | `DIET_LABEL` (`Renal`, `Low salt`, …) and `FOOD_TEXTURE_LABEL` (`IDDSI 6 Soft & bite-sized`). |
| `lib/nutrition.ts` | web | the dietitian line, `mayAssignDietitian(staff, wardId)` (the server's rule on `useStaff()`), the worklist sections' row text. |
| `lib/dishes.ts` (new) | web, pure | `dishRows(meal)`: the dish lines and their amendment marks (§8.4). |
| `lib/nutrition-view.ts` (new) | web, pure | `dayRows(view)`: day labels, counts and each day's meals; `referralLines`. |
| `lib/api.ts` | web | `assignDietitian`, `handBack`, `nutritionView`. |
| `components/dish-list.tsx` (new) | web | dish rows and "Show tray", reusing tray-segmentation's overlay and its once-per-meal media fetch. |
| `components/assign-dietitian-dialog.tsx` (new, lazy) | web | `GET /api/staff` once; dietitians covering the ward first, then the rest; choice rows; "Assign". |
| `components/care-forms.tsx` | web | the diet form: type and texture as choice chips; targets as `Stepper`s with "Add energy target" and "Add protein target" for dietitians, and a read-only line for others. |
| `components/nutrition.tsx` | web | the bed review's Nutrition section: the dietitian line and actions, dishes per meal, and the `Nutrition view` link for dietitians. |
| `routes/d/index.tsx` | web | three sections; rows link to `/d/$id`. |
| `routes/d/$id.tsx` (new) | web | the patient view (§8.3). `routeTree.gen.ts` is regenerated by `pnpm --filter @meniscus/web build`, never edited by hand. |
| `routes/n/$id.tsx`, `routes/n/w.$ward.tsx` | web | the care-plan diet row and badges (through `lib/care.ts`). |

#### 8.2 DESIGN.md recipes

- **`Stepper` gains a `unit` prop**, defaulting to `mL`, for `kcal` and `g protein`. DESIGN.md §4.9 currently says "the only way to set a volume … with ` mL`". It gains "and diet targets, with `unit`" in the same change (task 4.1).
- **Diet form**: two choice-chip groups (§4.8). The type chips are ≤ 3 words. The texture chips read `IDDSI 6 Soft & bite-sized` on two lines: the level, then the name in muted.
- **Targets for non-dietitians**: a muted form-row line `1800 kcal · 60 g protein · set by a dietitian`. There are no disabled steppers (§7.4's "hidden buttons and no disabled ones").
- **Badges**: neutral fact chips (§4.3), after the existing care badges in `care.orders` order.
- **Patient view**: `Section`s (§4.1): `Dietitian`, `Diet`, `Referrals`, `Food chart`. Day rows are section headers (§4.2) with the counts as meta, then the bed review's meal rows.
- **Dialogs**:
  - "Assign dietitian…", "Take over…", "Hand back…", "End…" and "Close…" end in `…` because they ask a further question.
  - Confirms use `AlertDialog`. Sheets use `sheet.styles`, load lazily, and say `Saved in the name of <name>`.
- **Copy**: dates day first (`Tue 3 Nov`, `dayLabel`), 24 h times (`clock`), units with a space (`1800 kcal`, `60 g protein`). Diet text never uses "risk" or "diagnosis".
- DESIGN.md §7.4 gains these patterns in the same change (task 4.1), so it stays the contract.

#### 8.3 The patient view `/d/$id`

- **Loading.** `GET /api/admissions/:id/nutrition` is the only load. It refreshes every 30 s, paused while locked, hidden or gated.
- **Non-dietitians** get `Placeholder` `The nutrition view is for dietitians.` with a link to `/n/<id>`, before any load. The role comes from `useStaff()`.
- **Break-the-glass.** The first load names the ward (`admission.ward_id`).
  - When `useNeedsReason(wardId)` is true, the page renders only `AccessGate`. No second request is sent until a grant arrives.
  - The grant is the same per-ward grant that `/n/$id` reads, so one reason opens both views for the shift.
  - **An assignment does not waive it.** Otherwise a dietitian could assign themselves to any patient and skip the reason, and assignment is not ward-checked for dietitians (§2).
- **Actions**, each one request, then the reload:
  - Acknowledge, Close…;
  - Take on, Take over…, Hand back…, Assign…;
  - diet Add, Change…, End….

  On 409 `no_dietitian` it shows the spec'd message and sends nothing more. On 403 from a targets check, it reloads and shows the message.
- **Bundle.** The route is its own chunk. The dialogs are lazy. `dish-list` and the overlay are shared with `/n/$id`. Budget: ≤ 50 KB gzipped on top of the shell.

#### 8.4 Dish amendment marks (`dishRows`)

- **Pairing.** A dish's key is `(index, k)`, where `k` is its order among the meal's dishes with the same `index` (0 for the first). A current dish pairs with the baseline dish of the same key. Indices are not unique: tray-comparison's "Two dishes on one plate" reads two dishes in one region, so pairing by `index` alone would pair both with one baseline dish ("Two dishes in one region"). The same key covers `index` 0 ("in no region"), whose dishes pair by their order among the index-0 dishes.
- **Baseline.** `amendments[0].before.dishes` is the dish list before any amendment. With no amendment, there are no marks.
- **For each current dish**:
  - **added**: it has no pair in the baseline. It gets `Added <time> by <name>` from the first amendment whose `after` has it.
  - **changed**: its pair differs in `name` or `portion`. It gets `Amended <time> by <name> · was <old>`, from the latest amendment that changed it, where `<old>` is the baseline name or portion word (both, joined by ` · `, when both changed).
  - **untouched**: no mark.
- **Removed dishes** are baseline dishes with no current pair. They are listed struck through (`<s>` plus the text `Removed …`, never strike-through alone) after the current dishes, from the amendment that removed them.

### 9. Demo (`scripts/demo-history.ts`, fictional)

Writes go through the store API with `clock.t` moved, as in care-plan §9 and dietitian §9. All are written before read-outcomes' snapshot and accuracy-views' alerts snapshot. None raises or clears a prompt or changes a meal outcome, so no guard is edited.

| Bed | Written | Prompts |
|---|---|---|
| HDU-3 Elena Novak (21) | diet `{ renal, 7, 1800, 60 }` by Sana Mirza 30 h ago | unchanged (`fluid_limit_near`) |
| 5B-6 Kofi Mensah (18) | diet `{ regular, 6 }` by Grace Lee 20 h ago | unchanged (`drink_too_thin`, `drink_consistency_unrecorded`) |
| 2C-3 Deepa Rao (3) | `weight_loss` referral by Meera Pillai 40 h ago, note `Lost weight at home`; acknowledged by Sana Mirza 30 h ago; Sana Mirza assigned 18 h ago by Meera Pillai; closed `supplements_started` 6 h ago, `next_review` today + 3 | none |
| one 3A photo meal with dishes, charted between 1 h and 24 h before seeding (so the amendment 1 h after it is not in the future), `accepted` in accuracy-views' mix. Lunch is the only menu with `rice` and the routine meals (3.2, 8.5 and 14.8 h old) move with the seeding time, so one older 3A tray saved as read (not the retaken read, the curry misread or the rejected fluid) is served lunch's dishes whatever its meal. A `rice` dish is therefore always there; the script prints the meal it renamed and throws when none has `rice` | one amendment by Anita Thomas 1 h after the meal, through tray-comparison's `amendMeal`, reason `dish name corrected`, renaming its `rice` dish to `jeera rice` with the same `dish_kind`, `portion` and `index` | none |

- **2C-3** is a routine bed. Its `PORTION_STEPS` meals never give 3 in a row at ≤ 50% (dietitian §9), and only meals after the close count. So `poor_meal_intake` stays off, and dietitian's "only 3A-6 raises it" assertion holds.
- **The amended dish.** tray-comparison seeds "one amendment by Anita Thomas" (its design §16) and accuracy-views' amendment changes only the portion (its design §11), so neither is sure to change a dish. This rename gives the browser check an `Amended <time> by Anita T. · was rice` mark. It changes no `(dish_kind, portion)` multiset, so accuracy-views' outcome for that meal stays `accepted` (its design §3, "Dish multiset"), its outcome counts and alerts snapshot hold, and no portion or prompt moves.
- **New guard**: Sana Mirza's worklist is `patients` [3A-7], `assigned` [2C-3] and `diets` [5B-6, HDU-3]. 3A-6 has a prompt but no referral. The guard throws on drift.
- The header comment lists the three beds.

### 10. Test strategy

- **Pure:**
  - `chart/nutrition.test.ts`: `routedTo`, `worklistFor` sections and order, `foodChart` days across local midnight (local-time constructors only), `mayAssignDietitian`;
  - `chart/care.test.ts`: `CARE_CODEC.diet` round trip and absent keys;
  - `diet.test.ts`, against the store: `setCare` / `endCare` with `keepTargets` return `forbidden` from inside their `tx` when the active diet's targets differ, even if the route's pre-check had passed.
- **HTTP** through `testApp` and the fake upstream, each asserting `requests` stays empty:
  - new `diet.test.ts`: care-plan's diet scenarios;
  - new `assignment.test.ts`: assign and hand back;
  - new `nutrition-view.test.ts`: the read and the referral history, capturing the log for "Two referrals";
  - `care.test.ts`: the MODIFIED care scenarios;
  - `nutrition.test.ts`: the MODIFIED nutrition scenarios.
- **Store variants**:
  - Joel Mathew (id 12, dietitian, 3A) inserted with `node:sqlite`, as `dietitian` does;
  - "No dietitian covers 3A": delete Sana Mirza's 3A `staff_ward` row;
- **Web**: `lib/*.test.ts` with `createApi` and a fake `fetch`, asserting the exact request lists; pure helpers for the row text.

## Risks / Trade-offs

- **Assignment does not waive break-the-glass.**
  - Risk: friction for a renal dietitian on wards outside their `wards`.
  - Mitigation: one reason per ward per shift; their `wards` can include HDU.
- **No server ward check on assignment for dietitians.**
  - Risk: a dietitian could assign themselves anywhere.
  - Mitigation: the row records who and when, and the web asks for a reason before showing the patient. This is the same stance as `dietitian`'s referral actions.
- **Targets compared on the raw body.**
  - Risk: a nurse's client that drops `kcal` gets 403, not a silent target removal.
  - Mitigation: that 403 is intended. The web always sends the active targets back ("Divya changes the texture").
- **Hand back refused.**
  - Risk: a dietitian cannot leave a patient with an acknowledged referral on a ward nobody covers.
  - Mitigation: they close the referral first. The 409 message says why.
- **`CARE_BADGE` type change** touches every kind's entry.
  - Mitigation: a mechanical `[text]` wrap, covered by the existing badge tests.
- **The worklist query on assigned patients outside the dietitian's wards** widens the ward set.
  - Mitigation: still one query per kind of read.

## Migration Plan

- **Deploy.**
  - `admission_dietitian` and its indexes are added to `SCHEMA`, and `STORE_SCHEMA_VERSION` goes from 5 to 6. If the live `STORE_SCHEMA_VERSION` is not 5 at apply time, stop: changes were applied out of order. There is no upgrade step: a store file from before this change fails to open (charting/entries "Store schema version"); delete `DATA_DIR` or re-seed it.
  - `care_order` needs no change (no CHECK on `kind`).
  - No env var, and no dependency.
- **Rollback.** The previous build refuses this build's store version. Delete `DATA_DIR` or re-seed it with that build.

## Overlaps

Apply order: care-plan (archived) → bag-emptying → tray-segmentation → read-outcomes → dietitian → acuity-budget → tray-comparison → bag-alerts → accuracy-views → **dietitian-care** → scale-store. This change rebases on the archived text of all those before it (tasks.md group 0).

- **dietitian** (archives first):
  - **MODIFIED here**: seven requirements from its delta, copied from its text. They are "Nutrition status on chart reads", "Refer to a dietitian", "Referral routing" and "Dietitian worklist" in `charting/nutrition`; "Dietitian worklist" and "Worklist for dietitians only" in `web/dietitian`; and "Nutrition on the bed review" in `web/ward`.
  - **Reused**: `requireRole`, `worklistFor`, `WardReads`, `REFERRAL_*`, its demo beds 3A-6 and 3A-7, and its guards.
  - Its tests for those scenarios are updated in place, with the same titles, including one whose meaning changes: in web/dietitian "Dietitian worklist" the scenario "Opens the bed review" keeps its name, because OpenSpec refuses a MODIFIED block that drops a scenario, but now opens `/d/<id>`. Its test keeps its title and is rewritten (task 3.1).
- **care-plan** (archived): "Care orders need a nurse" is MODIFIED from the live text. "Care order values" is not MODIFIED; diet values are the ADDED "Diet order values" (§5). The care routes' chain gains `careRole` and `dietTargets` (§4).
- **acuity-budget** (archived before):
  - `CARE_KINDS` holds `acuity` first and `diet` last.
  - Its MODIFIED web/ward "Care plan on the bed review" is not touched: it lists every active order except acuity, so the diet row ("Diet order on the care plan") fits it.
  - Two of its MODIFIED web/ward requirements are MODIFIED again here, copied from its delta text:
    - "Change care orders from the bed review": diet joins the offered kinds ("Form defaults", "Acuity not offered here"), a dietitian gets diet only (new "Dietitian offered diet only"), and diets follow "Diet order from the bed review". The diet sentence is new, and "None of this makes a model request" becomes "It makes no model request", which changes no meaning, so the statement measures 496 characters.
    - "Care badges on bed cards": diet is excluded like acuity and points to "Diet badges on bed cards", since a `low_salt` texture 5 diet gives two badges (new "Diet has its own badges").
  - Its "Care status on chart reads" order clause covers `diet` with no edit (§5).
  - Acuity has its own row and its own roles (deciders), so `CARE_ORDER_ROLES.acuity` is `DECIDER_ROLES`.
- **bag-alerts** (archives before this change):
  - It MODIFIES "Care order values" (catheter `measure_every_h`), and its design "Overlaps" and tasks.md "Workflow follow-up" expect this change to MODIFY it again with a diet bullet. This change does not: bag-alerts' block is 498 characters, 526 with the bullet, and its catheter wording must stay as archived, so the diet values are the ADDED "Diet order values" (§5). "Care order values" archives as bag-alerts leaves it, and its four scenarios and tests stay bag-alerts'. Those two bag-alerts notes are now stale (tasks.md, "Workflow follow-up").
  - `store.ts` `setCare` and `endCare` gain `keepTargets` here (§4); bag-alerts' interval change touches the same store and care code. That is a textual merge.
  - Its "Catheter necessity review" is unaffected: dietitians get 403 on the review route.
- **tray-segmentation, tray-comparison** (archived before):
  - `Meal.dishes`, the tray overlay and the proof's media fetch are reused.
  - `Meal.amendments` drives the amended-dish marks (§8.4). tray-comparison's `MealAmendment` (its design §1) matches §8.4: `before` and `after` are whole `MealValues` with `dishes: DishValue[]`, and its overlaps table names this use. Task 0.1 re-checks the shape against its archived spec "Meal amendment history".
  - Dietitians cannot amend meals ("Meal amendments need a nurse"); nothing here changes that.
- **read-outcomes** (archived): its alert snapshot guard holds. This change's demo rows raise no prompt and are written before the snapshot (§9).
- **bag-emptying** (archived): no shared requirement. `scripts/demo-history.ts` and `store.ts` `SCHEMA` are textual merges.
- **accuracy-views** (archives before): no shared requirement. The shared files are `routes/n/$id.tsx` (it adds nothing to the Nutrition section), `packages/shared` and `apps/server/scripts/demo-history.ts`, where its §11 guard (outcome mix and alerts snapshot) must still pass after this change's rows (§9). It avoids new route files. This change adds `routes/d/$id.tsx`, as `dietitian` added `routes/d/index.tsx`, with `routeTree.gen.ts` regenerated by the build.
- **scale-store** (after):
  - Its version triggers (`bump_<table>_ins|upd|del` on every table with `admission_id`, checked against `sqlite_master` by its guard test) cover `admission_dietitian` and `diet` orders in `care_order`. Referrals are covered as before.
  - Its status unit already holds `nutrition` and `care`, so `nutrition.dietitian`, `dietitian_available` and the diet badge are reused together, within its 30 s bound.
  - The worklist and the nutrition read are not cached; it caches only `GET /api/admissions` and `/api/wards`.
  - Its overlaps table should gain a dietitian-care row saying this (its task 1.1 rebase).
- **postgres-store** (being planned; applies after scale-store, so after this change; not a dependency):
  - **Schema.** Its baseline migration must carry `admission_dietitian` with the partial unique index `WHERE ended_at IS NULL`, which Postgres supports, and its version-bump trigger. Its SQLite import must copy the table: its table list (its design §4.7, step 5) lacks `admission_dietitian`, which goes after `referral`. Diet values are `jsonb`, with "absent key = null" kept for the same-value 200.
  - **Concurrency.** Assign (end, then insert), hand back (referral and cover check, then end), and `setCare` / `endCare` with the diet targets compare (§4) each run in one store `tx()`. Once routes are async, each such `tx` must first lock the admission row with `SELECT … FOR UPDATE`, as its design §4.1 does for write transactions that read first. It rejected SERIALIZABLE because it needs a retry loop. A lost race maps to one answer (409 or 403), never a retry. Tasks.md, "Workflow follow-up", has the line for postgres-store.

## Open Questions

None that change the specs. Whether a speech and language therapist role should own texture is a later change. `CARE_ORDER_ROLES` would take it with no route change.
