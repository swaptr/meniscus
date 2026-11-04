# Spec Delta

## MODIFIED Requirements

### Requirement: Meal capture
The capture screen SHALL offer "Meal": the meal preselected as in "Meal follows the served tray", else by local time (breakfast 05:00–10:29, lunch 10:30–14:59, snack 15:00–17:59, otherwise dinner), portion chips None, ¼, ½, ¾ and All, items, optional fluid mL and "When did it happen?". "Photo of the tray" makes exactly one `/api/ai/meal` request and fills the form from its draft; a read needing review says "Check the tray" with the reasons. Saving posts the meal and makes no `/api/ai` request.

#### Scenario: Lunch by hand
- **WHEN** at 13:10 the attendant opens Meal on a bed with no served tray waiting, picks ½, types "rice, dal" and sets 150 mL, then saves
- **THEN** after the served-tray lookup, the only request is `POST /api/admissions/<id>/meals` with `{ meal: "lunch", portion: 50, items: "rice, dal", fluid_ml: 150, source: "manual" }`

#### Scenario: Tray photo
- **WHEN** the attendant takes a tray photo whose draft is `{ portion: 75, items: "idli, sambar", fluid_ml: 100 }` with confidence 0.8, then saves
- **THEN** the requests after the served-tray lookup are, in order: one `/api/ai/meal`, one `POST /api/admissions/<id>/media` with `kind: photo`, and one `POST /api/admissions/<id>/meals`
- **AND** the meal post has `portion: 75`, `items: "idli, sambar"`, `fluid_ml: 100`, `source: "photo"`, `confidence: 0.8`, the read's evidence and the tray's `media_id`

#### Scenario: Tray needs a check
- **WHEN** the tray read returns confidence 0.6 with issue `partly_hidden`
- **THEN** the form shows `Check the tray: low confidence (0.60), partly hidden`

#### Scenario: Meal by time of day
- **WHEN** Meal is opened at 07:45, 15:30 and 21:00 on a bed with no served tray waiting
- **THEN** breakfast, snack and dinner are preselected

## ADDED Requirements

### Requirement: Meal follows the served tray
Opening Meal on the bed capture screen SHALL send one `GET /api/admissions/<id>/served-tray` and, when it returns a photo, preselect that photo's `served_meal` and read `Served <meal> tray from <HH:MM> waiting`. When it returns `media: null` or fails, the meal is preselected by local time and the lookup is not resent. Picking another meal chip stays possible until a compared read is on the form. It makes no `/api/ai` request.

#### Scenario: Lunch collected late
- **WHEN** at 15:10 the attendant opens Meal on bed 1, whose served lunch photo 41 was uploaded at 14:30
- **THEN** the only request on opening is `GET /api/admissions/1/served-tray`, lunch is preselected instead of snack, and the screen reads `Served lunch tray from 14:30 waiting`
- **AND** a tray photo then read sends `meal: lunch` in its one `POST /api/ai/meal`

#### Scenario: No served tray waiting
- **WHEN** at 15:10 the lookup answers `media: null`, and on another bed it answers 500
- **THEN** snack is preselected on both, no served tray is named, and neither lookup is resent

### Requirement: Served tray photo at the bed
The Meal capture SHALL offer "Served tray": a photo of the tray as it is served, uploaded once as photo media with the selected meal as `served_meal`. It makes no `/api/ai` request and posts no meal, and it says when the photo was kept. A failed upload says so and is not resent. Either way, the meal is captured as before when the tray is collected.

#### Scenario: Lunch served
- **WHEN** at 12:40 the attendant opens Meal on bed 1 (lunch preselected), taps "Served tray" and takes a photo
- **THEN** after the served-tray lookup, the only request is `POST /api/admissions/1/media` with `kind: photo` and `served_meal: lunch`
- **AND** the screen reads `Served lunch kept at 12:40. Photograph the tray again when it is collected.`

#### Scenario: Served photo not kept
- **WHEN** that upload answers 500
- **THEN** the screen reads `Served tray photo not kept. You can still photograph the tray when it is collected.`
- **AND** no other request is made

### Requirement: Collected tray compared at the bed
On the bed capture screen, the tray read SHALL send the bed's `admission_id` and the selected `meal` in its one `/api/ai/meal` request. When the read has a `comparison`, the form names the served photo's time, marks `measured` dish portions, and keeps the meal fixed, saying why, until the photo is retaken, and saving posts `served_media_id` beside the tray's `media_id`. A meal posted without the tray's `media_id` sends no `served_media_id`.

#### Scenario: Lunch compared
- **WHEN** at 13:30 on bed 1 a lunch tray photo is read, answering a `comparison` with `served_media_id: 41`, `served_at` 12:40, a served segmentation, and dishes `1 rice` (Half, `basis: measured`) and `2 dal` (All, `basis: model`), and the attendant saves
- **THEN** the read request was one `POST /api/ai/meal` whose form has the image, `admission_id` 1 and `meal: lunch`
- **AND** the form reads `Compared with the served tray from 12:40`, rice's portion is marked `measured`, and the meal chips are disabled under `Meal fixed to lunch by the served tray. Retake to change it.`
- **AND** saving makes exactly two requests: `POST /api/admissions/1/media` with `kind: photo` (answering media 42), then `POST /api/admissions/1/meals` with `media_id: 42`, `served_media_id: 41` and the read as evidence

#### Scenario: Served photo not compared
- **WHEN** the read's `comparison` has `served_media_id: 41`, `served_at` 12:40 and `served: null`
- **THEN** the form reads `Served tray from 12:40 kept with the meal` and no portion is marked `measured`
- **AND** saving posts `served_media_id: 41`

#### Scenario: No served photo
- **WHEN** the read's `comparison` is null
- **THEN** the form names no served tray, and the meal post has no `served_media_id`

#### Scenario: Tray photo not kept
- **WHEN** a compared read is saved and `POST /api/admissions/1/media` answers 500
- **THEN** the meal post has no `media_id`, no `served_media_id` and no `evidence`
- **AND** the save result warns that the photo was not kept

#### Scenario: Retaken for another meal
- **WHEN** after a compared lunch read the attendant taps "Retake", picks Snack and takes a new photo
- **THEN** the new read is one `POST /api/ai/meal` with `meal: snack`, and the form no longer names the served lunch tray
