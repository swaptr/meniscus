# Spec Delta

## ADDED Requirements

### Requirement: Meal saves carry their read
On the bed capture screen, the tray read SHALL carry the bed's `admission_id`, and a meal saved from it its `read_id`, adding no request to the one `/api/ai/meal` (3 or 1 model requests, 5 with a served photo) and the meal post. A meal by hand carries none, nor one whose read drafted no dish and no fluid or answered `READ_ABANDON_HOURS` less 5 minutes or more ago by the device's clock, as decided at the first save attempt and kept for retries. A retry answered `already linked` shows as saved.

#### Scenario: Tray lunch
- **WHEN** on bed 16 a tray photo is read, answering `read_id: 61` and a draft of portion 50, `rice, dal` and 150 mL, and the lunch is saved
- **THEN** the read request was one `POST /api/ai/meal` whose form has `admission_id` 16
- **AND** saving makes exactly two requests: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/meals` with `source: "photo"`, the tray's `media_id` and `read_id: 61`

#### Scenario: Meal by hand
- **WHEN** on bed 16 a lunch is entered by hand at ½ with `rice, dal` and saved
- **THEN** the only request is `POST /api/admissions/16/meals` with `source: "manual"` and no `read_id`

#### Scenario: Empty tray read
- **WHEN** on bed 16 a tray photo is read, answering `read_id: 63`, the issue `not_a_meal`, no dishes and `fluid_ml: null`, and the attendant sets lunch at ½ with `rice, dal` and saves
- **THEN** saving makes exactly two requests: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/meals` with `source: "photo"`, the tray's `media_id` and no `read_id`
- **AND** the meal post answers 201, and the screen shows `Saved lunch, half eaten.`

#### Scenario: Stale tray read
- **WHEN** a tray read answers with `read_id: 61` at 08:00 by the device's clock, and its lunch is saved at 19:55
- **THEN** the meal post carries no `read_id`, and the lunch is saved

#### Scenario: Retried meal save
- **WHEN** a tray read answers with `read_id: 61` at 08:00 by the device's clock, its first save at 19:54 uploads the photo and then the meal post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry sends exactly one request, the meal post, and it carries `read_id: 61`

#### Scenario: Already linked
- **WHEN** a tray read answers with `read_id: 61` and a draft of lunch at portion 50 with 150 mL, its first save uploads the photo, the meal post reaches the server but its response is lost, and Save is tapped again
- **THEN** the retry sends exactly one request, the meal post with `read_id: 61`, and it answers 400 with `{ path: "read_id", message: "already linked" }`
- **AND** the screen shows `Saved lunch, half eaten. 150 mL waiting for nurse approval.`, with no error and no further request
