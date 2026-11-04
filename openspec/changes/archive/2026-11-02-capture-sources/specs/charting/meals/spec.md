# Spec Delta

## ADDED Requirements

### Requirement: Tray photo kept
A meal with `source: photo` MAY link its tray photo with `media_id`. The meal SHALL return it as `media`, and voiding the meal unlinks it, so it is deleted as in `charting/media` "Media goes with its record". The fluid entry a photo meal creates SHALL link no media (`media: null`); only the meal links the tray. A meal with `source: manual` and a `media_id` SHALL get 400 `invalid_request`. It makes no model request.

#### Scenario: Lunch with its tray
- **WHEN** a tray photo is uploaded for bed 1, and a photo lunch with `fluid_ml: 150` is posted with its `media_id`
- **THEN** the meal and the meals list return `media` with `kind: photo`
- **AND** the lunch's 150 mL fluid entry returns `media: null` and `has_photo: false`
- **AND** `GET /api/media/<id>` returns the photo

#### Scenario: By-hand meal with a photo
- **WHEN** a `manual` breakfast is posted with a `media_id`
- **THEN** the response is 400 with `error: invalid_request`
