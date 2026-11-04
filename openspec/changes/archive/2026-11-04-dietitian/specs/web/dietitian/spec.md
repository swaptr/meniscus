# Spec Delta

## Purpose

The dietitian's screen. A worklist (`/d`) of the referrals routed to the signed-in dietitian, in one "Referrals" section, each row opening the existing bed review. Shown to dietitians only. Over HTTP only, with no model request.

## ADDED Requirements

### Requirement: Dietitian worklist
`/d` SHALL show the signed-in dietitian's worklist from one `GET /api/nutrition/worklist`, in one section, "Referrals", in the server's order. Each row gives the bed and patient, the referral and `<n> of <m> meals 50% eaten or less · last 24 h`, or `No meals charted · last 24 h` when there are none, and opens that bed's review, `/n/<admission id>`. It refreshes every 30 s, paused while locked. It makes no model request.

#### Scenario: Sana's worklist
- **WHEN** at 15:00 on 3 Nov the worklist lists:
  - 3A bed 6, Priya Iyer: a `poor_intake` referral made at 14:05 by Anita Thomas, 3 meals, all 3 eaten 50% or less;
  - 3A bed 7, Hugo Martin: a `poor_intake` referral made at 12:30 by Anita Thomas, acknowledged at 13:30 by Sana Mirza, and no meals
- **THEN** "Referrals" lists 3A bed 6 then 3A bed 7
- **AND** 3A bed 6's row reads `3A-6 · Priya Iyer`, `Referred 14:05 by Anita T. · Poor intake` and `3 of 3 meals 50% eaten or less · last 24 h`
- **AND** 3A bed 7's row reads `Referred 12:30 by Anita T. · Poor intake · Acknowledged 13:30 · Sana M.` and `No meals charted · last 24 h`

#### Scenario: Opens the bed review
- **WHEN** Sana Mirza taps 3A bed 6's row (admission 11)
- **THEN** the app opens `/n/11`, whose requests are `GET /api/admissions/11/entries` and `GET /api/admissions/11/meals`, and no access dialog is shown on a ward in her `wards`

#### Scenario: Requests
- **WHEN** Sana Mirza opens `/d` at 15:00:00 and it is still open at 15:00:30
- **THEN** the requests are `GET /api/nutrition/worklist`, then one more `GET /api/nutrition/worklist` at 15:00:30, and no `/api/ai` request

#### Scenario: Nothing to do
- **WHEN** the worklist has no patients
- **THEN** `/d` reads `Nothing on your worklist`

### Requirement: Worklist for dietitians only
The navigation SHALL show "Nutrition", linking to `/d`, to dietitians only. Anyone else who opens `/d` sees `The nutrition worklist is for dietitians.` with a link to their landing page, and no `GET /api/nutrition/worklist` is sent. It makes no model request.

#### Scenario: Navigation
- **WHEN** Sana Mirza (dietitian), Anita Thomas (nurse) and Ravi Kumar (attendant) are each signed in
- **THEN** only Sana Mirza's navigation shows "Nutrition", linking to `/d`

#### Scenario: Nurse opens the worklist
- **WHEN** Anita Thomas (nurse) opens `/d`
- **THEN** the page reads `The nutrition worklist is for dietitians.` with a link to `/n`
- **AND** no request is sent after `GET /api/session`
