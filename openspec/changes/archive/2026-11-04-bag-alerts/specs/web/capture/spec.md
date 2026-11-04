# Spec Delta

## ADDED Requirements

### Requirement: Duplicate bag reading at the bed
When a bag-reading post from the bed screen (a read bag photo, "Bag level" by hand, or "Emptied it now?") answers 409 `duplicate_reading`, the screen SHALL show `Same as the reading at <time>: <event> at <level> mL.` with "Save anyway" and "Discard", and send nothing more until one is tapped. "Save anyway" resends the same body once with `confirm_duplicate_of` that reading's id, without uploading its photo again. "Discard" sends nothing. No `/api/ai` request is made.

#### Scenario: Saved twice
- **WHEN** on 3A bed 3 Ravi Kumar saves a urine bag photo, read as 380 mL with `read_id: 49`, as an emptying at 11:02, and the bag-reading post answers 409 with `duplicate_of` `{ id: 101, event: "emptied", volume_ml: 380, created_at: <11:00> }`
- **THEN** the screen shows `Same as the reading at 11:00: emptied at 380 mL.` with "Save anyway" and "Discard", and no saved message
- **AND** saving sent exactly two requests, the photo upload and that bag-reading post, and no `/api/ai` request

#### Scenario: Save anyway
- **WHEN** "Save anyway" is tapped
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/bag-readings` with the same `media_id`, evidence and `read_id: 49`, and `confirm_duplicate_of: 101`
- **AND** when it answers 201 with a 380 mL entry, the screen reads `Urine bag emptied at 380 mL: 380 mL charted. Waiting for nurse approval.`

#### Scenario: Response lost
- **WHEN** that "Save anyway" post gets no response, and "Save anyway" is tapped again
- **THEN** exactly one more request is sent, the same body with `confirm_duplicate_of: 101`
- **AND** when it answers 409 with `duplicate_of` `{ id: 102, event: "emptied", volume_ml: 380, created_at: <11:03> }`, the screen shows `Same as the reading at 11:03: emptied at 380 mL.` with "Save anyway" and "Discard", and nothing more is sent

#### Scenario: Discard
- **WHEN** "Discard" is tapped instead
- **THEN** no request is sent, and the screen reads `Not saved. The reading at 11:00 stands.`

#### Scenario: By hand
- **WHEN** "Bag level" by hand, with a photo, saves a check at 300 mL whose post answers 409 with `duplicate_of` `{ id: 88, event: "check", volume_ml: 290, created_at: <10:02> }`, and "Save anyway" is tapped
- **THEN** the screen first shows `Same as the reading at 10:02: checked at 290 mL.`
- **AND** the resend is one bag-reading post with `source: "photo"`, the same `media_id` and `confirm_duplicate_of: 88`, with no second photo upload

### Requirement: Nearly full at the bed
A bag's check screen and its "Bag level" form SHALL show `Nearly full: <level> of <capacity> mL. Empty it now?` when the level is at or above 80% of the bag's capacity and the event is a check, and after that check is saved lead with "Emptied it now? Add after-emptying photo". It sends no request of its own and no `/api/ai` request.

#### Scenario: Check at 1650 mL
- **WHEN** on HDU bed 1 a nurse's photo reads the urine bag at 1650 mL, with "Emptied after photo" off
- **THEN** the check screen shows `Nearly full: 1650 of 2000 mL. Empty it now?`
- **AND** after saving, "Emptied it now? Add after-emptying photo" is the first button, and saving sent only the photo upload and the bag-reading post

#### Scenario: Under 80%, or emptied
- **WHEN** the level is 1599 mL with "Emptied after photo" off, or 1650 mL with it on
- **THEN** no `Nearly full` line is shown

#### Scenario: Stoma bag by hand
- **WHEN** "Bag level" for stoma output is set to a check at 420 mL
- **THEN** the form shows `Nearly full: 420 of 500 mL. Empty it now?`
