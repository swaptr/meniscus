# Tasks

Every test runs without the network. Server tests go through `testApp` with the fake upstream, and assert that its `requests` stay empty (only "Explained" expects exactly one). Clocks are local (`new Date(2026, 10, 3, h, m)`). Web tests use `createApi` with a fake `fetch` and a `staffId`, and assert the exact requests, `X-Staff-Id` and that no `/api/ai` request is sent.

No task adds a `diet` care kind, touches a care-plan registry, or leaves a placeholder that throws. Everything under "Deferred" in design.md stays out.

Scenario → test file map (each task below lists the scenarios it cites):

| Requirement | Test file |
|---|---|
| [charting/nutrition] Poor meal intake (all but "Counted on the ward list" and "Explained"), Meals counted for poor intake, Dietitian worklist (ordering) | `apps/server/src/chart/nutrition.test.ts` (new, pure) |
| [charting/nutrition] Nutrition status on chart reads, Poor meal intake: "Counted on the ward list" and "Explained", Prompt while referred, Refer to a dietitian, Referral routing, Acknowledge a referral, Close a referral, Dietitian worklist | `apps/server/src/nutrition.test.ts` (new) |
| [charting/staffing] Demo staffing, Decisions need a nurse, Dietitians cover wards | `apps/server/src/staffing.test.ts` |
| [charting/audit] Staff roster | `apps/server/src/audit.test.ts` |
| [server/security] Demo accounts and sign-in | `apps/server/src/session.test.ts` |
| [web/staff] Staff on shift: "Landing by role" | `apps/web/src/lib/staff.test.ts` |
| [web/staff] Demo accounts on the sign-in screen | `apps/web/src/lib/session.test.ts` |
| [web/ward] Decisions need a nurse | `apps/web/src/lib/rota.test.ts` |
| [web/ward] Nutrition on the bed review, Referral actions on the bed review, Refer to dietitian, Nutrition on bed cards | `apps/web/src/lib/nutrition.test.ts` (new) |
| [web/dietitian] every requirement | `apps/web/src/lib/nutrition.test.ts` |

## 0. Earlier changes archived; rebase on them

- [x] 0.1 This change applies last. Check that `care-plan`, `bag-emptying`, `tray-segmentation` and `read-outcomes` are archived, in that order, and rebase this change on them.
  - `openspec/changes/<name>/` is gone for each of the four (moved to `changes/archive/`), and `openspec/specs/charting/care-plan/spec.md` and `openspec/specs/charting/bag-periods/spec.md` exist.
  - Rebase the branch so `packages/shared`, `apps/server/src/store/store.ts`, `apps/server/scripts/demo-history.ts`, `apps/server/src/chart/view.ts`, `apps/server/src/chart/alerts.ts` and `apps/server/src/routes/chart.ts` are the archived versions. Re-check the line numbers design.md and these tasks cite in those files.
  - Confirm what the earlier changes left that this one builds on (design.md, "Overlaps"): bag-emptying's three bag kinds at the end of `ALERT_KINDS`, its bag prompts appended after the care prompts in `chartView`, `withChart` passing `bagReadingsByWard`, and its `INTENDED` beds; read-outcomes' per-bed alerts snapshot and outcome guard in `demo-history.ts`, with the snapshot taken after the meal loop (2.5 relies on it; if it is taken earlier, stop and report rather than edit read-outcomes' guard).
  - This change has no care-plan delta and does not depend on tray-segmentation.
  - Verify: `pnpm exec openspec validate dietitian --strict` passes, and `pnpm verify` passes on the rebased branch before any task below.

## 1. Shared contracts

- [x] 1.1 Shared roles, alert kind and config, the web's exhaustive maps, and the `/d` stub.
  - Write the failing tests first:
    - In `apps/web/src/lib/staff.test.ts`, rewrite [web/staff] Staff on shift: "Landing by role" in place, adding Sana Mirza → `/d` and the header `Sana Mirza · Dietitian`. It checks more, not less.
    - In `apps/web/src/lib/session.test.ts`, [web/staff] Demo accounts on the sign-in screen: "Every role labelled", with the 11-account fixture: the matron then the dietitian last, and `sana` filled on tap.
    - In `apps/web/src/lib/nutrition.test.ts` (new), [web/ward] Nutrition on bed cards: "Prompt colour", through `ALERT_LABEL`, `ALERT_TONE`, `bedTone` and `STATUS_LABEL`.

    They fail to compile: the role and the alert kind do not exist yet.
  - Then implement, in `packages/shared/src/index.ts`, design.md "Types" except `NutritionStatus` on `AdmissionSummary` and `EntryList` (task 2.2 adds that with the code that fills it):
    - `STAFF_ROLES` with `dietitian`; `TEAM_ROLES`, `DIETITIAN_ROLES`, `REFERRER_ROLES`;
    - `ALERT_KINDS` with `poor_meal_intake` last, after bag-emptying's three bag kinds;
    - `POOR_INTAKE_*` and `REFERRAL_*`;
    - `Referral`, `ReferralInput`, `CloseReferralInput`, `NutritionStatus`, `WorklistPatient`, `NutritionWorklist`;
    - the `Staff.wards` and `DemoAccount.ward` docs.
  - Then, in `apps/web`:
    - `lib/staff.ts`: `ROLE_LABEL.dietitian`, `ROLE_AVATAR.dietitian = 'in'` (widen the type), `LANDING.dietitian = '/d'` (widen the type to `'/a' | '/n' | '/d'`);
    - a stub `routes/d/index.tsx` in this same task, rendering only a heading, so the typed router accepts `'/d'`. `routeTree.gen.ts` is regenerated by `pnpm --filter @meniscus/web build` (the router plugin), never edited by hand;
    - `lib/labels.ts`: `ALERT_LABEL.poor_meal_intake = 'Poor meal intake'`, `ALERT_TONE.poor_meal_intake = 'warn'`, each after the bag entries;
    - `lib/staff-fixtures.ts:21-32`: add `SANA = person(11, 'Sana Mirza', 'dietitian', ['2C', '3A', '5B', 'HDU'])` to `ROSTER`, and give `DEMO_ACCOUNTS` its `ward` from `TEAM_ROLES` instead of `s.role === 'matron'`.
  - Verify: `pnpm typecheck` passes; the three tests pass; every existing server and web test passes unchanged.

## 2. Server

- [x] 2.1 The dietitian role and the demo dietitian.
  - Write the failing tests:
    - `apps/server/src/staffing.test.ts`:
      - [charting/staffing] Demo staffing: "Who works where", with the added Sana Mirza line;
      - [charting/staffing] Decisions need a nurse: "Dietitian approves or voids";
      - [charting/staffing] Dietitians cover wards: "Not in the ward team", "Not in charge".
    - `apps/server/src/audit.test.ts`: [charting/audit] Staff roster: "Demo roster", with 11 staff and 1 dietitian.
    - `apps/server/src/session.test.ts`:
      - [server/security] Demo accounts and sign-in: "Demo accounts listed", with 11 accounts, `sana` with `ward: null`, and the `sana`/`sana` sign-in;
  - Update any staff count no scenario states, 10 → 11, in tests of the roster a fresh store opens with; nothing else in those tests changes.
  - Implement:
    - `apps/server/src/store/demo-hospital.ts`: `DEMO_STAFF` gains `{ id: 11, name: 'Sana Mirza', role: 'dietitian', username: 'sana' }`, and `DEMO_TEAMS[11] = ['2C', '3A', '5B', 'HDU']`;
    - `apps/server/scripts/demo-passwords.ts`: keep every hash already in `DEMO_PASSWORD_HASHES` and hash only members missing one. Run it once (`pnpm --filter @meniscus/server exec tsx scripts/demo-passwords.ts`); `git diff src/store/demo-passwords.ts` shows exactly one added line, for id 11, and no other change. It prints no password or hash;
    - `SCHEMA`: the `staff` role CHECK follows `STAFF_ROLES`, and `STORE_SCHEMA_VERSION` goes from 1 to 2 (fresh-schema design, "Rule for later changes"). No upgrade step. `seedStaff` and `seedTeams` are unchanged: a fresh store's empty `staff_ward` gets every demo team, Sana Mirza's included;
    - `TEAM_ROLES` in `orderTeam` (`chart/staffing.ts:10`), the demo account's `ward` (`routes/session.ts:28`) and `teamOf` (`scripts/demo-history.ts:324`).

    `requireDecider` is unchanged, so dietitians get 403 through `DECIDER_ROLES`.
  - Verify: these tests and the whole server suite pass. The 3A team test ("Team of 3A") is unchanged and green.
- [x] 2.2 Store, and nutrition status on chart reads.
  - Write the failing tests in `apps/server/src/nutrition.test.ts` (new). Referrals are seeded through the store API until 2.4:
    - [charting/nutrition] Nutrition status on chart reads: "Ward pool", "No dietitian covers the ward". For the second, build a temporary store file, delete Sana Mirza's 3A `staff_ward` row with `node:sqlite`, then reopen it.
  - Update the existing `[charting/wards] Demo hospital: Fresh store` test in `apps/server/src/chart.test.ts` (`:58` today): its exact key list of a `GET /api/admissions` item gains `'nutrition'`, sorted between `'mrn'` and `'patient'`. This does not weaken it: it still checks the exact keys, now including the one this change adds, and every other assertion stays as it is. It fails until `withChart` returns `nutrition`.
  - Implement, in `apps/server/src/store/store.ts`:
    - the `referral` table and its indexes, in `SCHEMA`;
    - `refer`, `acknowledgeReferral` and `closeReferral` (guarded updates, `RETURNING`), and `referral(id)`;
    - reads: `latestReferral(id)`, `latestReferralsByWard(wardId?)`, `coveredWards()` (roles from `DIETITIAN_ROLES`), `meals(id, since)` and `mealsByWard(wardId?, since)`;
    - the `admissions()` return type (`store.ts:514`) also omits `nutrition`.

    Then `nutritionStatus` in new `apps/server/src/chart/nutrition.ts`, and `nutrition` on `withChart` and `GET …/entries` (`routes/chart.ts`).
  - The shared `withChart` edit: `routes/chart.ts`'s `withChart` already passes `careOrdersByWard` and bag-emptying's `bagReadingsByWard` to `chartView`. Gather them, with this change's `latestReferralsByWard` and `coveredWards`, into one `WardReads` object (`chart/view.ts`), so bag-emptying's ward reads are kept, not replaced, and the ward list stays one query per read per ward. `chartView` with no `WardReads` reads one bed, as today.
  - Add `nutrition: NutritionStatus` to `AdmissionSummary` and `EntryList` in `packages/shared` in this task, and retype every consumer so the repo compiles with no other assertion changed:
    - server fixtures building either shape;
    - `apps/web/src/lib/api.ts`, `lib/ward.ts`, `lib/care.ts`, `lib/rota.ts`, `routes/n/$id.tsx`, `routes/n/$id_.print.tsx`, `routes/n/w.$ward.tsx` and `routes/a/index.tsx`: compile against the new field (no behaviour yet);
    - fixtures gain `nutrition: { dietitian_available: true, referral: null }`: `apps/web/src/lib/lib.test.ts`, `lib/rota.test.ts`, and `lib/care.test.ts:188` (`chartOf`, an `EntryList`) and `:374` (the `AdmissionSummary`).
  - Verify: these tests and the updated `Fresh store` test pass, `pnpm typecheck` passes, and so does the whole server and web suite.
- [x] 2.3 The `poor_meal_intake` rule.
  - Write the failing tests in `apps/server/src/chart/nutrition.test.ts` (new, pure):
    - [charting/nutrition] Poor meal intake: "Three poor meals", "Exactly half", "Two meals", "A better meal breaks the run", "Held while nil by mouth";
    - [charting/nutrition] Meals counted for poor intake: "Window edge", "Voided meal left out", "Charted under nil by mouth", "Drink-only snack".

    And in `apps/server/src/nutrition.test.ts`, on a fresh store opened at 07:00 on 3 Nov (`setup(nov(3, 7), u)`, as care-plan's "Only a catheter review"), meals posted through `POST /api/admissions/:id/meals` with `charted_at`, read at 09:30:
    - [charting/nutrition] Poor meal intake: "Counted on the ward list" (3A bed 6's alerts are exactly `['poor_meal_intake']`; `GET /api/wards` gives 3A `beds_with_alerts: 1` and every other ward 0; no upstream request);
    - [charting/nutrition] Poor meal intake: "Explained" (`POST /api/ai/explain` is 200; exactly one upstream request; its body contains `poor_meal_intake` and contains neither `Priya Iyer` nor `idli`).
  - Implement `poorMealIntake` in `apps/server/src/chart/nutrition.ts` (design.md §3). `chartView` (`chart/view.ts`) reads meals for every bed (not only nil-by-mouth beds), the latest referral and the covered wards, and appends the prompt last: after the care prompts and after bag-emptying's bag prompts. `WardReads` (2.2) gains `store.mealsByWard`.
  - Verify: these tests pass. So do the existing `[charting/alerts]` tests, care-plan's `Care prompts join the alerts` and `Entries judged by the order then in force` tests, bag-emptying's `[charting/bag-periods]` tests (including `Bag prompts join the alerts`), and every existing test that charts meals, unchanged. If an existing test's bed now raises `poor_meal_intake`, stop and report it rather than edit the test.
- [x] 2.4 Referral routes and the worklist.
  - Write the failing tests in `apps/server/src/nutrition.test.ts`:
    - [charting/nutrition] Refer to a dietitian:
      - "Nurse refers";
      - "Note kept, never logged" (capture the server log, as "Grace opens HDU" does);
      - "Attendant or dietitian cannot refer";
      - "Invalid referrals" (each its own request);
      - "Already referred";
      - "No dietitian available" (the temporary store of 2.2);
      - "Unknown admission or no session";
    - [charting/nutrition] Prompt while referred: "Referred", "Closed, then poor again" (including the 15:00 snack and the 21:30 read);
    - [charting/nutrition] Referral routing: "Ward pool", "Another ward", "Closed" (a temporary store adding Joel Mathew, id 12, dietitian, `wards` 3A, with `node:sqlite`);
    - [charting/nutrition] Acknowledge a referral: "Sana acknowledges", "Twice", "Not a dietitian", "Unknown referral";
    - [charting/nutrition] Close a referral: "Supplements started", "Closed straight from open", "Review date bounds", "Unknown referral before the body", "Role checked first", "Twice or not a dietitian";
    - [charting/nutrition] Dietitian worklist: "Sana's worklist" over HTTP, plus its ordering in `chart/nutrition.test.ts`; "Not a dietitian or nobody signed in";
  - Implement:
    - `apps/server/src/routes/common.ts`: `requireRole(list)`, with `requireDecider = requireRole(DECIDER_ROLES)`;
    - new `apps/server/src/routes/nutrition.ts` (HTTP only), mounted in `app.ts`. The chains and statuses are in design.md §5: `requireRole`, the referral lookup before `smallJson` on close, the strict zod bodies, `no_dietitian`, `referral_open`, `not_open` and `already_closed`;
    - `worklistFor` (pure) in `chart/nutrition.ts`.

    No log line carries a note, reason or outcome.
  - Verify: these tests and the whole server suite pass.
- [x] 2.5 Demo census, in `apps/server/scripts/demo-history.ts`, as design.md §9:
  - 3A-7 meal portions 0/50/25, a `poor_intake` referral by Anita Thomas, acknowledged by Sana Mirza;
  - 3A-6 meal portions 25/50/0, not referred;
  - **before read-outcomes' snapshot.** The portions are set in the meal loop, and the 3A-7 referral and acknowledgement are written straight after the meal loop, both before the point where read-outcomes takes its per-bed alerts snapshot. So the snapshot already holds 3A-6 → `['poor_meal_intake']` and 3A-7 → `[]`, and read-outcomes' later 3A-6 records (an entry and reads, no meal) leave both unchanged. read-outcomes' guard, its snapshot and its outcome counts are not edited;
  - the header comment lists the two beds;
  - the `INTENDED` guard, which already holds care-plan's and bag-emptying's beds (HDU-1, 3A-3, 2C-5, 2C-6), gains 3A-6 → `['poor_meal_intake']` and 3A-7 → `[]`, and one assertion that no other bed raises `poor_meal_intake`. The beds do not overlap: no entry already in `INTENDED` changes.

  Verify: one run over a fresh temporary `DATA_DIR` succeeds, with every guard passing: `INTENDED`, read-outcomes' outcome counts and its alerts snapshot. `GET /api/nutrition/worklist` signed in as `sana` lists 3A-7 only (3A-6 is not referred). The script makes no model request.

## 3. Web library

- [x] 3.1 Showing nutrition.
  - Write the failing tests in `apps/web/src/lib/nutrition.test.ts`:
    - [web/ward] Nutrition on the bed review: "Acknowledged referral", "Closed with an outcome", "No dietitian" (`dietitianLine`, `referralLines`), "Meals in the section" (the existing meal rows, no `GET /api/media`), "No extra request" (`bedLoad` sends exactly the two GETs);
    - [web/ward] Nutrition on bed cards: "Referral chip" (`referralChip`), "No extra request" (`wardLoads`);
    - [web/dietitian] Dietitian worklist: "Sana's worklist" (`worklistRows`, `intakeLine`), "Opens the bed review" (the row's link, then `bedLoad`), "Nothing to do";
    - [web/dietitian] Worklist for dietitians only: "Navigation" (`navFor`), "Nurse opens the worklist" (`isDietitian`, the notice, no worklist request).
  - Implement the read side of new `apps/web/src/lib/nutrition.ts`, and `navFor` with `roles` in `nav.ts`.
  - Verify: these tests pass.
- [x] 3.2 Acting on nutrition.
  - Write the failing tests:
    - `apps/web/src/lib/rota.test.ts`: [web/ward] Decisions need a nurse: "Dietitian on the bed review" (`canDecide`, `decisionNotice`).
    - `apps/web/src/lib/nutrition.test.ts`:
      - [web/ward] Refer to dietitian: "Anita refers" (`api.refer`, then `bedLoad`), "Reason and note" (`referBody`, `REFERRAL_NOTE_MAX`), "No dietitian available", "Who may refer" (`canRefer`, `offersReferral`), "Already referred";
      - [web/ward] Referral actions on the bed review: "Acknowledge", "Close" (`closeBody`, `reviewBounds`), "Nurse looks" (`canActOnReferral`);
      - [web/dietitian] Dietitian worklist: "Requests" (`createPoll` with an injected clock: one GET at open, one at 30 s).
  - Implement:
    - `lib/api.ts`: `refer`, `acknowledgeReferral`, `closeReferral` and `worklist`; `errorText` for `no_dietitian`, `referral_open`, `not_open` and `already_closed`;
    - the write side of `lib/nutrition.ts`;
    - `REFER_PROMPTS` and `offersReferral` in `lib/resolve-rules.ts`.
  - Verify: these tests and the whole web suite pass.

## 4. Web screens

- [x] 4.1 Components and routes, as design.md §7. Use StyleX tokens, Base UI, lucide icons through `components/icons.tsx` (e.g. `salad`, `clipboard-check`), and controls ≥ 44 px:
  - `components/nutrition.tsx` on the bed review, after the Care plan, holding the dietitian line, the referral, the existing meals list (moved, not duplicated), "Acknowledge", "Close…" and "Refer to dietitian";
  - lazy `components/referral-dialog.tsx` and `components/close-referral-dialog.tsx`;
  - "Refer to dietitian" on the `poor_meal_intake` prompt row;
  - the referral chip on `BedCard`;
  - `routes/d/index.tsx` replaces the stub of 1.1: the worklist, `createPoll` at 30 s, paused while locked; rows link to `/n/$id`; the notice for anyone else;
  - "Nutrition" in the navigation through `navFor`.

  Verify: `pnpm typecheck`, `pnpm lint` and the web tests pass. `routeTree.gen.ts` is regenerated by the build, not edited.
- [x] 4.2 Bundle. Run `pnpm --filter @meniscus/web build` and record in one line of the PR description:
  - the shell (≤ 120 KB gzipped);
  - the own chunks of `/d`, `/n/$id` and `/n/w/$ward` (each ≤ 50 KB gzipped);
  - that the two referral dialogs are separate chunks, not preloaded.

  If a route goes over, lazy-load more of it before moving on.
- [x] 4.3 Browser check on the demo store from 2.5, through the Vite proxy, at 390 and 1100 px, in the same shift as seeding (so the nurses in charge hold).
  - Block `/api/ai/*` in the browser (Playwright `route(…, abort)`), so no model request can be sent; nothing here should need one.
  - **Signed in as `anita` (Anita Thomas, nurse):**
    - the 3A dashboard: 3A-6 shows `Poor meal intake`, amber, `Review`; 3A-7 shows `Referred to dietitian · Sana M.` and no nutrition prompt;
    - the 3A-6 bed review: the Nutrition section reads `Dietitian: ward dietitians`, lists the 24 h meals, and offers "Refer to dietitian". Refer with "Poor intake": one `POST`, then the two GETs; the prompt goes and the card shows `Referred to dietitian`;
    - `/d` reads `The nutrition worklist is for dietitians.`
  - **Signed in as `sana` (Sana Mirza, dietitian):**
    - she lands on `/d`; the header reads `Sana Mirza · Dietitian`; the navigation shows "Nutrition";
    - the worklist: "Referrals" lists 3A-6 (open, just referred) then 3A-7 (acknowledged);
    - tapping 3A-6 opens `/n/<3A-6>` with no reason dialog; "Acknowledge", then "Close…" with `Supplements started` and a next review 3 days on; back on `/d`, 3A-6 is gone;
    - any bed review: no Approve, Reject, Amend or Void, and the notice; no "Refer to dietitian";
    - `/n`: "Your wards" lists 2C, 3A, 5B and HDU, and opening HDU asks for no reason.
  - **Signed in as `ravi` (Ravi Kumar, attendant):**
    - the 3A-6 bed review: no "Refer to dietitian", "Acknowledge" or "Close…";
    - `/d` is not in his navigation.
  - **In the network panel:**
    - a bed review sends exactly the entries and meals GETs;
    - a dashboard sends the admissions and team GETs;
    - the worklist sends one GET, then one every 30 s;
    - each action sends one request, then the reload;
    - no `/api/ai` request is attempted.
  - **With the keyboard only, at 390 px:** refer, acknowledge and close; the dialogs trap focus and return it.

## 5. Docs and verification

- [x] 5.1 README, new section **"Working with dietitians"**:
  - the role: covers wards, no home ward, in no ward team, never approves;
  - routing to the ward's dietitians; no dietitian means no referral action, and the prompt still shows;
  - `poor_meal_intake`:
    - the rule and its constants by name;
    - snacks count, drink-only snacks do not; meals charted under nil by mouth do not;
    - held while nil by mouth or referred, and restarted after the close;
    - Explain can now explain it (1 request);
    - a product nudge, not a screening tool: cite NICE CG32 and the Salisbury food chart;
  - the referral lifecycle, reasons and outcomes; the note is never logged;
  - the worklist, opening the bed review;
  - MUST and NRS-2002 out of scope, and why;
  - the demo password rule: committed hashes never change (design.md §8);
  - the rollback SQL from design.md §8.

  **Demo notes:** `sana`/`sana` (demo only) and the two dietitian beds. **API list:** the four new routes and the four 409 codes. Update the test count.
- [x] 5.2 `pnpm verify` passes (format, lint, `openspec validate --all --strict`, spec:check, typecheck, tests).

## Workflow follow-up

- Run the `spec-reviewer` agent on this change before `/opsx:apply`, and again before `/opsx:archive`.
- Clear context between proposing and applying.
- Archive order: `care-plan`, `bag-emptying`, `tray-segmentation`, `read-outcomes`, then `dietitian` (`openspec archive dietitian --yes`), once `pnpm verify` passes.
