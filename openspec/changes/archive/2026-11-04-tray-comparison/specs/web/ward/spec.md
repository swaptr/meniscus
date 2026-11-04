# Spec Delta

## MODIFIED Requirements

### Requirement: Tray proof on the bed review
A photo meal with a proof SHALL show it in "What the AI read", above the existing lines: the tray photo with the tray overlay, who took it and when, and its fingerprint, paired with any served tray ("Served tray in the proof"); one row per dish with the AI read beside the value saved; and who saved the meal and when. Viewing makes no model request and fetches each photo once with `GET /api/media/<id>`, only when opened. A meal with `proof: null` shows only the existing lines and its photo.

#### Scenario: Lunch proof
- **WHEN** a lunch has a tray photo taken at 13:09 by Ravi Kumar with `sha256` `3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9`, a read of rice in region 1, Half, and dal in region 2, All, and saved values rice All and dal All, by Ravi Kumar at 13:10
- **THEN** "What the AI read" shows, in order:
  - `Tray photo · 13:09 · Ravi K.` with the photo, its overlay and `Photo fingerprint: 3f2a…c9`;
  - the rows `1 rice · Rice · AI Half · saved All` and `2 dal · Dal / lentils · AI All · saved All`;
  - `Saved by Ravi K. · 13:10`
- **AND** opening it sends exactly one request, `GET /api/media/<id>`, and no `/api/ai` request

#### Scenario: Voided lunch
- **WHEN** that lunch is voided, so its photo is deleted, and "What the AI read" is opened
- **THEN** the photo reads `Photo deleted · fingerprint 3f2a…c9` from its proof, and no media request is sent

## ADDED Requirements

### Requirement: Served tray in the proof
When a meal's proof has `served`, "What the AI read" SHALL show the served photo and the tray photo as a before and after pair, each with its overlay, who took it and when, and its fingerprint, with a stat line between them giving each measured dish's served and left coverage and portion eaten. A measured dish's row reads `measured <portion>` before the AI's. A deleted served photo reads `Served tray deleted · fingerprint …` from the proof. Viewing makes no model request.

#### Scenario: Compared lunch
- **WHEN** a lunch has the tray photo 42 taken at 13:30 and the served photo 41 taken at 12:40, both by Ravi Kumar, the served photo with `sha256` `9b1c4d2e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a10e2`, and a compared read of rice in region 1 (`basis: measured`, portion 50, `model_portion` 25, served coverage 0.8, coverage 0.4) and dal in region 2 (`basis: model`, All), saved as rice Half and dal All
- **THEN** "What the AI read" shows the before photo `Served tray · 12:40 · Ravi K.` with the served photo, its overlay and `Photo fingerprint: 9b1c…e2`, then the stat line `1 rice · 80% served · 40% left · Half eaten`, then the after photo with the tray photo's lines
- **AND** the rows read `1 rice · Rice · measured Half · AI A quarter · saved Half` and `2 dal · Dal / lentils · AI All · saved All`
- **AND** opening it sends exactly two requests, `GET /api/media/42` and `GET /api/media/41`, and no `/api/ai` request

#### Scenario: Voided compared lunch
- **WHEN** that lunch is voided and "What the AI read" is opened
- **THEN** the served photo reads `Served tray deleted · fingerprint 9b1c…e2` from its proof, and no media request is sent

### Requirement: Amend a meal from the bed review
For a signed-in nurse or matron, each meal not voided SHALL offer "Amend…": its portion chips, and its dish rows (name, kind and portion chips, with add and remove) or, with no dishes, its items, and a reason. Save is disabled until something changed and the reason has at least 3 characters. It sends one `POST /api/meals/<id>/amend` with what changed and the reason, then reloads the bed's meals. An amended meal's row reads `Amended <time> · <who> · <reason>`.

#### Scenario: Rice finished after all
- **WHEN** Anita Thomas (nurse) opens bed 1, whose lunch 12 has the dishes `1 rice` (Half) and `2 dal` (All) and portion ¾, taps "Amend…", taps All on rice, types `tray rechecked` and saves at 14:30
- **THEN** the requests are, in order, `POST /api/meals/12/amend` with `{ dishes: [{ index: 1, name: "rice", dish_kind: "rice", portion: 100 }, { index: 2, name: "dal", dish_kind: "dal_lentils", portion: 100 }], reason: "tray rechecked" }`, then `GET /api/admissions/1/meals`
- **AND** no `/api/ai` request is made, and the lunch's row reads `Amended 14:30 · Anita T. · tray rechecked`

#### Scenario: Nothing to save yet
- **WHEN** the dialog is opened and the reason `ab` is typed, or a reason of `checked` is typed with nothing changed
- **THEN** Save is disabled and nothing is sent

#### Scenario: Portion of a meal by hand
- **WHEN** a nurse amends a breakfast by hand with items `toast` and no dishes to ¼ with reason `half the toast left`
- **THEN** the dialog shows the items field and no dish rows, and the only amend request has `{ portion: 25, reason: "half the toast left" }`

#### Scenario: Not offered
- **WHEN** Ravi Kumar (attendant) or Sana Mirza (dietitian) is signed in, or a nurse views a voided meal
- **THEN** no "Amend…" is shown for it

#### Scenario: Voided meanwhile
- **WHEN** the amend answers 409 with `error: voided`
- **THEN** the dialog reads `This meal was voided. Nothing was changed.`, and nothing is resent
