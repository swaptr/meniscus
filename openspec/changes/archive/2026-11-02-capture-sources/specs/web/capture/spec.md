# Spec Delta

## MODIFIED Requirements

### Requirement: Photo saved as evidence
Saving a photo capture SHALL upload the photo once as media and then post the record with its `media_id`. If the upload fails, the record SHALL still be saved without media, and the screen SHALL say the photo was not kept.

#### Scenario: Save with photo
- **WHEN** a photo draft is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/entries` with its `media_id`

#### Scenario: Photo upload fails
- **WHEN** the media request fails with 500
- **THEN** the entry is posted without `media_id`, and the save result has the entry and a warning that the photo was not kept

### Requirement: Jug photos record levels
A photo reading of a water jug or water bottle with a volume SHALL be saved as a level reading linked to its photo, as in "Photo saved as evidence", and the screen SHALL show the intake entry created from the drop, if any.

#### Scenario: Water jug reading
- **WHEN** a reading of container `water_jug` at 600 mL is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/levels` with `water_jug`, 600 mL and its `media_id`
- **AND** no entry is posted directly

### Requirement: Meal capture
The capture screen SHALL offer "Meal": the meal preselected by local time (breakfast 05:00–10:29, lunch 10:30–14:59, snack 15:00–17:59, otherwise dinner), portion chips None, ¼, ½, ¾ and All, items, optional fluid mL and "When did it happen?". "Photo of the tray" SHALL make exactly one `/api/ai/meal` request and fill the form from its draft; when the read needs review it SHALL say "Check the tray" with the reasons. Saving SHALL post the meal and make no `/api/ai` request.

#### Scenario: Lunch by hand
- **WHEN** at 13:10 the attendant opens Meal, picks ½, types "rice, dal" and sets 150 mL, then saves
- **THEN** the only request is `POST /api/admissions/<id>/meals` with `{ meal: "lunch", portion: 50, items: "rice, dal", fluid_ml: 150, source: "manual" }`

#### Scenario: Tray photo
- **WHEN** the attendant takes a tray photo whose draft is `{ portion: 75, items: "idli, sambar", fluid_ml: 100 }` with confidence 0.8, then saves
- **THEN** the requests are, in order: one `/api/ai/meal`, one `POST /api/admissions/<id>/media` with `kind: photo`, and one `POST /api/admissions/<id>/meals`
- **AND** the meal post has `portion: 75`, `items: "idli, sambar"`, `fluid_ml: 100`, `source: "photo"`, `confidence: 0.8`, the read's evidence and the tray's `media_id`

#### Scenario: Tray needs a check
- **WHEN** the tray read returns confidence 0.6 with issue `partly_hidden`
- **THEN** the form shows `Check the tray: low confidence (0.60), partly hidden`

#### Scenario: Meal by time of day
- **WHEN** Meal is opened at 07:45, 15:30 and 21:00
- **THEN** breakfast, snack and dinner are preselected

## ADDED Requirements

### Requirement: Recording saved as evidence
Saving a draft from a voice note SHALL upload the recording once as voice media, with its duration, the first time any of its drafts is saved. That draft and every later draft from the same note SHALL be posted with the same `media_id`. If the upload fails, it SHALL NOT be tried again for that note: its drafts are saved without media, and the screen SHALL say the recording was not kept. No `/api/ai` request is made.

#### Scenario: Two drafts, one recording
- **WHEN** a voice note drafted 200 mL tea and 300 mL urine, and both drafts are saved
- **THEN** the requests are, in order:
  1. one `POST /api/admissions/:id/media` with `kind: voice`;
  2. one `POST /api/admissions/:id/entries` for each draft, both with that `media_id`

#### Scenario: Recording not kept
- **WHEN** a voice note drafted 200 mL tea and 300 mL urine, the media request fails with 500, and both drafts are then saved
- **THEN** exactly one `POST /api/admissions/:id/media` is made, followed by two entry posts, both without `media_id`
- **AND** each save result warns that the recording was not kept

### Requirement: Tray photo saved with the meal
Saving a meal filled from a tray photo SHALL upload the photo once as photo media and post the meal with its `media_id`. A meal entered by hand SHALL upload nothing.

#### Scenario: Lunch from a tray
- **WHEN** a meal filled from a tray read is saved
- **THEN** exactly two requests are made: `POST /api/admissions/:id/media` with `kind: photo`, then `POST /api/admissions/:id/meals` with its `media_id`
