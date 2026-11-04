# Proposal

## Why

Fluid charts are read against the patient's care plan, and the plan today lives only on paper or in the nurse's head:
- a heart or kidney patient on a 1.5 L a day fluid limit;
- a surgical patient nil by mouth before theatre;
- a stroke patient on thickened fluids (IDDSI levels) for a swallowing problem;
- a patient with a catheter that should come out as soon as it is no longer needed;
- an older patient with a minimum intake target.

Meniscus sees every drink as it is charted, so it can say "820 of 1000 mL today" or "a drink was charted while nil by mouth" at the moment it matters. It never blocks a save and never decides: each prompt asks a nurse to review.

## What Changes

- **Care orders per admission** (new `charting/care-plan`). Five kinds:
  - `nil_by_mouth` (optional planned end);
  - `thickened_fluids` (IDDSI drink level 1–4);
  - `fluid_limit` (mL, oral or total intake);
  - `intake_target` (mL of oral intake);
  - `catheter` (urethral or suprapubic, insertion time, which may be before admission).

  Rules for orders:
  - Each order is a time range, with at most one active order per kind.
  - Changing a value ends the current order and starts a new one, in one transaction. The rows are the history and the audit trail: who set or ended what, and when.
  - Nurses and the matron (`DECIDER_ROLES`) set, change and end orders, and record catheter reviews. Attendants get 403, and see orders read-only.
- **Prompts in the existing alerts pipeline**, with stable kinds. Every message ends `Review.`, and none of them makes a model request.

  | Kind | When |
  |---|---|
  | `fluid_limit_near` | counted intake today is at least `FLUID_LIMIT_WARN` (80%) of the limit |
  | `fluid_limit_reached` | counted intake today is at least 100% of the limit |
  | `nil_by_mouth_intake` | a drink, food fluid or eaten meal was charted while nil by mouth was in force |
  | `nil_by_mouth_overdue` | nil by mouth is still active past its planned end. It never ends on its own |
  | `drink_too_thin` | a drink was charted thinner than the thickened-fluids order then in force (red) |
  | `drink_consistency_unrecorded` | a drink was charted under that order with no consistency recorded (amber); a nurse can record it through Amend, which clears the prompt |
  | `intake_target_behind` | counted oral intake is below the fraction due at the last `INTAKE_TARGET_CHECKS` time |
  | `catheter_review` | today's necessity review is not yet recorded |

  How they are worked out:
  - An entry is judged against the order in force at its charted time. A drink at 10:00 while nil by mouth ran 06:00–12:00 stays flagged after it is lifted.
  - Limits and targets use the active order over the **chart day** (from `CHART_DAY_START`, 08:00), not the rolling 24 h.
  - They count approved and pending intake, and show the pending part. Rejected entries are not counted, and a voided meal's pending fluid is rejected.
  - Every existing prompt keeps its current window and approved-only volumes.
- **Entries gain `iddsi_level`** (0–4), on drinks (`water`) only. Drafts never set it, so model requests and prompts are unchanged.
- **Amend records or corrects a drink's consistency** (`charting/audit`): `POST /api/entries/:id/amend` accepts `iddsi_level` on approved drinks, under the existing amend rules (nurse or matron, reason, some change). The `amended` event records `from_iddsi` and `to_iddsi`. This is how a ward-round or jug-level drink loses its amber prompt.
- **`logging_gap` is not raised while nil by mouth is active** (MODIFIED). "No intake logged. Check jug and meals." is wrong advice for a fasting patient. `intake_target_behind` is also held while nil by mouth is active.
- **HTTP.**
  - `PUT /api/admissions/:id/care/:kind` starts or replaces an order: 201 with the new order, or 200 when the value is unchanged.
  - `DELETE /api/admissions/:id/care/:kind` ends one: 200, or 404 when none is active.
  - `POST /api/admissions/:id/care/catheter/review` records the review: 201, or 409 `already_reviewed` once per chart day.
  - Checks, in order: 401 (session), 403 (role), 404, 400. `smallJson` runs before zod.
  - A target above an active limit, or a limit below an active target, gets 400.
  - Orders and their computed status ride on existing reads, so no screen makes an extra request:
    - `GET /api/admissions` items gain `care`;
    - `GET /api/admissions/:id/entries` gains `care` and `care_history`.
- **Web.**
  - The bed review gets a "Care plan" section:
    - each active order;
    - progress bars for the limit and the target ("today since 08:00");
    - the catheter day with "Reviewed today";
    - set, change and end for nurses, with the forms loaded lazily;
    - a compact history.
  - Ward bed cards and the attendant's bed banner show badges: `NBM`, `IDDSI 2`, `Limit 1.5 L · 82%`, `Target 900/1600`, `Catheter day 6`.
  - Prompt colours: red for intake while nil by mouth, a drink thinner than ordered and a limit reached; amber for near the limit, nil by mouth past its end, behind target and a drink with no consistency recorded; blue for the catheter review. The status-chip text moves to one shared `STATUS_LABEL`.
  - Flagged entries and meals carry a badge.
  - Entry details' Amend offers "Consistency" on approved drinks, and the timeline shows the change.
  - `intake_target_behind` offers "Add missed entry" (MODIFIED).
  - The capture check screen, the by-hand form, the Meal form and the bed review's "Add missed entry" warn before saving intake for a patient who is nil by mouth. A drink's consistency defaults to the thickened-fluids level and can be changed.
- **Demo census** (`scripts/demo-history.ts`, fictional patients):
  - HDU-3: a total limit of 1000 mL, at 82%;
  - HDU-1: catheter day 6, review due;
  - 5B-6: IDDSI 2, with one thin drink and one with no consistency recorded;
  - 2C-1: nil by mouth until 14:00, with a drink inside the window;
  - 3A-4: a 1600 mL target, behind at the 14:00 check.

Model requests per user action: none before, none after. Setting, changing, ending and reviewing orders, saving with a consistency or past a nil-by-mouth warning, amending a drink's consistency, and every read call no model. `POST /api/ai/explain` stays exactly 1 request. It explains the same prompt list the chart shows, so a bed whose only prompts are care prompts can now be explained instead of getting 409. Its prompt text is unchanged, and no patient name is sent.

### Config (shared constants in `packages/shared`; code changes, no env or UI)

| Constant | Default | Used by |
|---|---|---|
| `CHART_DAY_START` | `SHIFTS[0].start` (`'08:00'`) | `chartDay(ms)`: limit and target progress, catheter review day |
| `FLUID_LIMIT_WARN` | `0.8` | `fluid_limit_near` |
| `FLUID_LIMIT_RANGE` | `{ min: 500, max: 3000, step: 50, default: 1500 }` mL | PUT validation (`min`, `max`, whole mL); web stepper (`step`, `default`). The step of 50 is the stepper's only: the API accepts any whole mL in range |
| `INTAKE_TARGET_RANGE` | `{ min: 500, max: 3000, step: 50, default: 1600 }` mL | PUT validation (`min`, `max`, whole mL); web stepper (`step`, `default`). The step of 50 is the stepper's only: the API accepts any whole mL in range |
| `INTAKE_TARGET_CHECKS` | `[{ at: '14:00', fraction: 0.5 }, { at: '20:00', fraction: 0.75 }]` | `intake_target_behind` |
| `CATHETER_REVIEW_FROM` | `CHART_DAY_START` | when `catheter_review` starts each chart day |
| `IDDSI_DRINK_LEVELS` | 0 Thin, 1 Slightly thick, 2 Mildly thick, 3 Moderately thick, 4 Extremely thick | entry validation, labels, the consistency field |
| `NIL_BY_MOUTH_MAX_HOURS` | `48` | latest planned end accepted, from now |
| `CATHETER_MAX_AGE_DAYS` | `365` | earliest insertion time accepted |
| `CARE_HISTORY_LIMIT` | `50` | orders returned in `care_history` |
| `CARE_HISTORY_SHOWN` | `10` | history rows shown on the bed review before "Show all" |

The role lists (`DECIDER_ROLES`) and `SHIFTS` stay the existing config items.

### Changed shapes

- `packages/shared`:
  - **BREAKING**: `ALERT_KINDS` and `AlertKind` gain the 8 kinds above. The web's exhaustive `ALERT_LABEL` and `ALERT_TONE` are updated in this change.
  - **BREAKING**: `Alert` becomes a union on `kind`. The record kinds (`RECORD_ALERT_KINDS`: `nil_by_mouth_intake`, `drink_too_thin`, `drink_consistency_unrecorded`) require `entry_ids: number[]` and `meal_ids: number[]`, the records the prompt is about; the others are `{ kind, message }` as today.
  - **BREAKING**: `Entry` gains `iddsi_level: IddsiLevel | null`. Server and web fixtures are updated.
  - `EntryInput` gains optional `iddsi_level`, and `AmendInput` optional `iddsi_level`.
  - **BREAKING**: `EntryEvent` gains `from_iddsi` and `to_iddsi` (`IddsiLevel | null`).
  - **BREAKING**: `AdmissionSummary` gains `care: CareStatus`. `EntryList` gains `care: CareStatus` and `care_history: CareOrder[]`.
  - New:
    - `CARE_KINDS`, `CareKind`, `CARE_LABEL`;
    - `CareValues`, `CareInput`, `CareOrder`, `CareStatus`, `CareProgress`, `CareReview`;
    - `FLUID_SCOPES`, `FluidScope`, `SCOPE_CATEGORIES`, `CATHETER_TYPES`, `CatheterType`, `IDDSI_DRINK_LEVELS`, `IddsiLevel`, `ThickenedLevel`, `RECORD_ALERT_KINDS`;
    - `chartDay` and the constants above.
- HTTP:
  - the three new routes above;
  - the new error code `already_reviewed` (409), in the existing `{ error }` shape;
  - `GET /api/wards` `beds_with_alerts` also counts beds with care prompts.

### Out of scope

- **Order timing.** Orders start when they are set. Backdated or scheduled orders are out ("NBM from midnight" is set when it begins), and so are prescriber sign-off and EHR or CPOE import. Meniscus documents a decision made elsewhere.
- **Blocking.** No save is blocked, and nil by mouth never ends on its own.
- **Dismissing a prompt.** Entry-based prompts last 24 h, as `appearance` does.
- **Consistency elsewhere.** IDDSI food textures (levels 3–7 for foods) and consistency on meal fluid are out. A meal's fluid is charted as food, not a drink, so it is not checked against a thickened-fluids order. The ward round and jug levels set no consistency, so their drinks for a thickened-fluids patient get the amber "no consistency recorded" prompt until a nurse records the level through Amend. The ward round has no nil-by-mouth warning either.
- **Consistency at approval.** Approve takes no `iddsi_level`: a pending drink is approved, then amended, as for urine colour.
- **Other kinds and scopes.** Intermittent catheterisation and other catheter types, an IV-only limit, and a target that counts IV.
- **Paper and summaries.** Orders on the printable chart or the printed QR bed card (paper goes stale), and care actions in the ward data-quality summary.
- **Model work.** Escalation, notifications and any model reading of orders.

## Capabilities

### New Capabilities
- `charting/care-plan`: per-admission care orders (nil by mouth, thickened fluids, fluid limit, intake target, catheter) as time ranges with history. Covers who may change them, the chart day, how intake is counted, the review prompts each kind raises, the catheter necessity review, the status on chart reads, and older stores.

### Modified Capabilities
- `charting/entries`: adds **Drink consistency on the entry** (`iddsi_level` on drinks: validation, storage, lists).
- `charting/audit`: adds **Amend a drink's consistency** (`iddsi_level` through amend, recorded on the `amended` event).
- `charting/alerts`: **Logging gap** is not raised while nil by mouth is active.
- `web/ward`:
  - **Resolve from the bed review**: `intake_target_behind` also offers "Add missed entry".
  - Adds **Care plan on the bed review**, **Change care orders from the bed review**, **Care badges on bed cards**, **Care prompt colours**, **Care flags on entries and meals** and **Correct a drink's consistency**.
- `web/capture`: adds **Care orders at the bed**, **Nil by mouth warning before saving** and **Drink consistency on the check screen**.

## Impact

- `packages/shared/src/index.ts`: the types and constants above, and `chartDay`.
- `apps/server`:
  - New `src/chart/care.ts`: pure rules and status, and the `CARE_RULES` registry.
  - New `src/routes/care.ts`: routes and the per-kind value schemas `CARE_VALUE`.
  - `src/app.ts`: mounts `careRoutes`.
  - `src/routes/common.ts`: `SKEW_MS` moves here from `src/routes/chart.ts:156` and is exported, for the entry and care routes.
  - `src/routes/chart.ts`: `EntryBody` and `AmendBody` gain `iddsi_level`; chart reads use `chartView`.
  - `src/chart/alerts.ts`: nil by mouth holds back `logging_gap`.
  - New `src/chart/view.ts`: one prompt list, used by `src/routes/chart.ts` (chart reads) and `src/routes/ai.ts` (Explain).
  - `src/store/store.ts`:
    - the `care_order` and `care_review` tables;
    - `entry.iddsi_level`, `entry_event.from_iddsi` and `to_iddsi`, and a `migrateCare` step;
    - `amend` recording a consistency change;
    - queries for orders, reviews and the chart-day window.
  - `scripts/demo-history.ts`.
- `apps/web`:
  - New `lib/care.ts`, `components/care-plan.tsx`, `components/care-forms.tsx` (lazy), `components/care-badges.tsx` and `components/consistency-field.tsx`.
  - Updated: `lib/labels.ts` (`STATUS_LABEL`, moved from the two routes), `lib/resolve-rules.ts`, `lib/resolve.ts`, `lib/timeline.ts`, `lib/capture.ts`, `lib/api.ts`, `routes/n/$id.tsx`, `routes/n/w.$ward.tsx`, `routes/a/bed.$token.tsx`, `components/resolve.tsx`, `components/meal-form.tsx`, `components/meals.tsx`, `components/entry-log.tsx` and `components/entry-details.tsx`.
- README: a "Care plan" section and demo notes.
- No new dependencies. No env vars. No model calls.
