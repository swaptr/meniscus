# Proposal

## Why

Meniscus already charts every meal tray: the portion eaten and, from a photo, each dish. Nobody acts on it yet. In hospitals a dietitian covers a group of wards. Ward staff screen and chart intake, and refer patients who are not eating. The dietitian takes the referral and closes it with an outcome. Meniscus can make that loop visible:
- a prompt when the latest meals keep coming back half eaten;
- a referral, with its reason, routed to the dietitians covering the ward;
- a worklist that opens the bed review, where the meals already are.

The user asked that meal and tray readings "collaborate with the dietician if available for the patient like hospital chains do". The research behind the design is in design.md, under "Research".

This is the MVP cut for the deadline (Nov 4, 9 PM ET). What it leaves for later is listed under "Deferred".

## What Changes

- **A `dietitian` role** (`STAFF_ROLES`), with policy only through shared role lists:
  - `DIETITIAN_ROLES`: dietitians acknowledge and close referrals, and land on `/d`;
  - `REFERRER_ROLES` (nurse, matron): who may refer;
  - `TEAM_ROLES` (attendant, nurse): who is listed in a ward team. It replaces the current "not an overseer" filter.
  - Dietitians are not in `DECIDER_ROLES`, so approving, rejecting, amending and voiding stay 403 for them.
  - Like the matron, a dietitian covers wards through `staff_ward`, has no home ward, and is in no ward team.
- **Demo staff:** Sana Mirza (id 11, `sana`/`sana`, demo only), dietitian, covering 2C, 3A, 5B and HDU.
  - `src/store/demo-passwords.ts` gains her hash only. The hashes of staff 1–10 stay byte-identical, so the file's diff is one added line.
  - **Schema.** The `referral` table and the four-role `staff` CHECK go into `SCHEMA`, and `STORE_SCHEMA_VERSION` goes from 1 to 2 (fresh-schema). A store file from before this change fails to open (charting/entries "Store schema version"); delete `DATA_DIR` or re-seed it. There is no upgrade step, and a fresh store seeds every demo team, Sana Mirza's included.
- **Routing to the ward's dietitians.** A referral goes to every dietitian whose `wards` include the patient's ward. With none, `dietitian_available` is false: the prompt still shows ("Review"), and there is no referral action. The roster is the configuration: no dietitian on the roster means no referrals anywhere, and nothing else changes.
- **Prompt `poor_meal_intake`** (amber, "Review").
  - It fires when the latest `POOR_INTAKE_MEALS` (3) counted meals were each eaten `POOR_INTAKE_PORTION` (50%) or less.
  - Counted meals: not voided, charted in the last `POOR_INTAKE_WINDOW_H` (24 h), snacks included. Left out: meals charted while a nil-by-mouth order was in force (as care-plan's "Entries judged by the order then in force"), and a drink-only snack (0% eaten, with a fluid such as tea).
  - It is not raised:
    - while nil by mouth is active;
    - while a referral is open or acknowledged (the bed shows `Referred to dietitian` instead).
  - After a referral closes, only meals charted after the close count.
  - **Explain:** a bed whose only prompt is `poor_meal_intake` used to get 409 `no_alerts` from `POST /api/ai/explain` with no request. It now gets 200 and exactly 1 Spark request, whose input names the prompt but not the patient or the meal items.
- **Referrals.**
  - A nurse or the matron sends `POST /api/admissions/:id/referrals` with a reason from `REFERRAL_REASONS` and an optional note of at most 200 characters, never logged.
  - Lifecycle: open → acknowledged → closed. A dietitian acknowledges, then closes with an outcome from `REFERRAL_OUTCOMES` and an optional `next_review` date. A referral may also be closed straight from open.
  - Each step stores who and when on the referral row, which is the audit trail.
  - Errors:
    - 403 for attendants and dietitians (refer), and for anyone but a dietitian (acknowledge, close);
    - 409 `no_dietitian` when no dietitian covers the ward;
    - 409 `referral_open` when one is already open;
    - 409 `not_open` or `already_closed` for a step out of order.
- **Reads.** None of these adds a request to an existing screen.
  - `GET /api/admissions` items and `GET /api/admissions/:id/entries` gain `nutrition`: whether a dietitian covers the ward, and the latest referral.
  - New: `GET /api/nutrition/worklist`, the signed-in dietitian's referrals with 24 h intake counts (401 without a session, 403 for other roles).
- **Web.**
  - Bed review: a "Nutrition" section with the ward-dietitian line, the latest referral, and the existing 24 h meals list. Dietitians get "Acknowledge" and "Close…"; nurses and the matron get "Refer to dietitian" (with reason chips).
  - The `poor_meal_intake` prompt's own "Refer to dietitian" action.
  - Bed cards: the `Referred to dietitian` chip, and the prompt in amber.
  - New `/d` worklist with one "Referrals" section, oldest open first, then acknowledged. Each row opens the bed review `/n/$id`, which already has break-the-glass. Anyone else at `/d` is told it is for dietitians.
  - The navigation gets "Nutrition" for dietitians.
- **Demo census** (`scripts/demo-history.ts`, fictional):
  - 3A-7 with 3 poor meals, referred by Anita Thomas and acknowledged by Sana Mirza;
  - 3A-6 with 3 poor meals, not yet referred, so the prompt and the "Refer" action can be shown live.
- **Docs:** a README section, "Working with dietitians".

Model requests per user action: unchanged, except Explain. Referring, acknowledging, closing and the worklist call no model. `POST /api/ai/explain` stays exactly 1 request, and a bed whose only prompt is `poor_meal_intake` can now be explained (1 request instead of a 409).

### Config (shared constants in `packages/shared`; code changes, no env, no UI)

| Constant | Default | Used by |
|---|---|---|
| `POOR_INTAKE_MEALS` | `3` | `poor_meal_intake` |
| `POOR_INTAKE_PORTION` | `50` (a `Portion`) | `poor_meal_intake`, worklist intake counts |
| `POOR_INTAKE_WINDOW_H` | `24` | `poor_meal_intake`, worklist intake counts |
| `REFERRAL_REASONS` | `poor_intake`, `weight_loss`, `swallowing`, `diet_query`, `other` | referral validation, chips |
| `REFERRAL_OUTCOMES` | `diet_changed`, `supplements_started`, `monitoring`, `no_action_needed` | close validation, chips |
| `REFERRAL_NOTE_MAX` | `200` | referral note |
| `REFERRAL_REVIEW_MAX_DAYS` | `28` | latest `next_review` accepted |

Role lists (config items, as `DECIDER_ROLES` is): `DIETITIAN_ROLES` (`dietitian`), `REFERRER_ROLES` (`nurse`, `matron`) and `TEAM_ROLES` (`attendant`, `nurse`).

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `STAFF_ROLES` and `StaffRole` gain `dietitian`. The web's exhaustive `ROLE_LABEL`, `ROLE_AVATAR` and `LANDING` maps change, and `LANDING`'s type gains `'/d'`.
  - **BREAKING**: `ALERT_KINDS` and `AlertKind` gain `poor_meal_intake`, which is not a record kind. The web's `ALERT_LABEL` and `ALERT_TONE` gain it.
  - **BREAKING**: `AdmissionSummary` and `EntryList` gain `nutrition: NutritionStatus`. Server and web fixtures are updated.
  - New:
    - `TEAM_ROLES`, `DIETITIAN_ROLES`, `REFERRER_ROLES`;
    - `REFERRAL_REASONS`, `ReferralReason`, `REFERRAL_OUTCOMES`, `ReferralOutcome`, `REFERRAL_STATUSES`, `ReferralStatus`;
    - `Referral`, `ReferralInput`, `CloseReferralInput`;
    - `NutritionStatus`, `WorklistPatient`, `NutritionWorklist`;
    - the constants above.
  - `Staff.wards` doc: dietitians, like overseers, have no home ward.
- HTTP:
  - new routes:
    - `POST /api/admissions/:id/referrals`;
    - `POST /api/referrals/:id/acknowledge` and `POST /api/referrals/:id/close`;
    - `GET /api/nutrition/worklist`;
  - new error codes `no_dietitian`, `referral_open`, `not_open` and `already_closed` (409), in the existing `{ error }` shape;
  - `GET /api/staff`, `GET /api/session`'s demo accounts and the sign-in panel list 11 people;
  - `GET /api/wards` `beds_with_alerts` also counts `poor_meal_intake`;
  - `POST /api/ai/explain` answers 200 (1 Spark request) instead of 409 `no_alerts` for a bed whose only prompt is `poor_meal_intake`.

### Deferred

Cut for the deadline; each is a follow-up change. None is specified here.

- **Care plan:** the `diet` care kind and every care-plan delta: the three MODIFIED blocks (Care order values, Care orders need a nurse, Care status on chart reads), Diet order, and Diet targets need a dietitian. `diet` is not a care kind in this change, and `CARE_ORDER_ROLES` is not added.
- **Assignment:** Assign a dietitian (`PUT`/`DELETE /api/admissions/:id/dietitian`), the `admission_dietitian` table, `nutrition.dietitian`, and the `in_charge` field on `EntryList`.
- **Reads:** Referral history and Patient nutrition read (`GET /api/admissions/:id/nutrition`).
- **Bed review and cards:** Assign a dietitian from the bed review, Diet order on the care plan, Diet badges.
- **`web/dietitian`** beyond the worklist: the `/d/$id` patient view, Referral actions for the dietitian there, Diet and assignment from the patient view, Patients outside the dietitian's wards, and the worklist's "Your patients" and "Diet orders" sections.
- **tray-segmentation:** no dish list and no overlay. The Nutrition section shows the existing 24 h meals.
- **Demo beds** HDU-3 (renal diet), 5B-6 (soft diet) and 2C-3 (assigned, closed referral).

### Out of scope

- **MUST or NRS-2002 screening.**
  - MUST needs height and weight history, which Meniscus does not capture, and an acute-disease judgement.
  - A score typed in from three dropdowns would look like a validated screen without being one.
  - Screening stays in the hospital's EHR. `weight_loss` is a referral reason, so a high MUST score can still be referred.
- **Clinical content.** No nutrient analysis, menu or supplement prescribing, kcal or protein counting from photos, or meal ordering and catering integration.
- **Referral extras.**
  - No referral to speech and language therapy. `swallowing` goes to the dietitian.
  - No notifications, paging or escalation timers.
  - No re-opening a closed referral (make a new one).
  - No nurse cancelling a referral. A dietitian closes it as `no_action_needed`.
- **Teams.** No ward-scoped write checks on the server, the stance ward-staffing took. No UI to edit which wards a dietitian covers, which is roster data as for nurses.
- **Meals.** Meals not charted count as nothing, not as refused. Snacks count as meals, except drink-only ones.
- **Model work.** No model reads referrals. No tray-read change.

## Capabilities

### New Capabilities
- `charting/nutrition`: whether a dietitian covers the ward and the latest referral on chart reads, the `poor_meal_intake` prompt and the meals it counts, referrals and their lifecycle, routing, the worklist read.
- `web/dietitian`: the dietitian's worklist (`/d`), one "Referrals" section opening the bed review, and who sees it.

### Modified Capabilities
- `charting/staffing`:
  - **Demo staffing** adds the dietitian;
  - **Decisions need a nurse** refuses every role outside `DECIDER_ROLES`, so dietitians too;
  - adds **Dietitians cover wards**.
- `charting/audit`: **Staff roster** adds the role and an 11-person roster.
- `server/security`: **Demo accounts and sign-in** (fresh-schema's name for it) lists 11 demo accounts.
- `web/staff`:
  - **Staff on shift** lands dietitians on `/d`;
  - **Demo accounts on the sign-in screen** lists those with no home ward last, the matron then the dietitian.
- `web/ward`:
  - **Decisions need a nurse** hides the decision buttons from dietitians too;
  - adds **Nutrition on the bed review**, **Referral actions on the bed review**, **Refer to dietitian** and **Nutrition on bed cards**.

## Impact

- `packages/shared/src/index.ts`: the types, role lists and constants above.
- `apps/server`:
  - New `src/chart/nutrition.ts`: pure rules for poor intake, availability, routing and the worklist order.
  - New `src/routes/nutrition.ts`: the referral and worklist routes. Mounted in `src/app.ts`.
  - `src/chart/view.ts`: `chartView` reads meals for every bed, plus the latest referral and the covered wards, and appends `poor_meal_intake`.
  - `src/chart/staffing.ts`: `orderTeam` reads `TEAM_ROLES`.
  - `src/routes/session.ts`: a demo account's ward reads `TEAM_ROLES`.
  - `src/routes/chart.ts`: `nutrition` on chart reads.
  - `src/routes/common.ts`: `requireRole(list)`.
  - `src/store/store.ts`:
    - the `referral` table and the four-role `staff` CHECK in `SCHEMA`, with a `STORE_SCHEMA_VERSION` bump;
    - queries for referrals, covered wards and meals by ward;
    - the `admissions()` return type also omits `nutrition`.
  - `src/store/demo-hospital.ts`: `DEMO_STAFF` and `DEMO_TEAMS` add Sana Mirza.
  - `scripts/demo-passwords.ts` keeps the committed hashes and hashes only members missing one; `src/store/demo-passwords.ts` gains one line.
  - `scripts/demo-history.ts`.
- `apps/web`:
  - New: `lib/nutrition.ts`, `routes/d/index.tsx`, `components/nutrition.tsx`, lazy `components/referral-dialog.tsx` and `components/close-referral-dialog.tsx`.
  - Updated: `lib/staff.ts`, `lib/staff-fixtures.ts`, `lib/labels.ts`, `lib/resolve-rules.ts`, `lib/api.ts`, `nav.ts`, `routes/n/$id.tsx`, `routes/n/w.$ward.tsx`, and the `nutrition` consumers and fixtures listed in tasks.md 2.2.
- README: "Working with dietitians" and demo notes.
- No new dependencies. No env vars. Model requests change only for Explain on a bed whose only prompt is `poor_meal_intake` (409 → 1 request).
- Order: care-plan → bag-emptying → tray-segmentation → read-outcomes → dietitian. This change applies and archives last. No dependency on `tray-segmentation`. See design.md, "Overlaps".
