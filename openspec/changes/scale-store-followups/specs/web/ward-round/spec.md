# Spec Delta

## MODIFIED Requirements

### Requirement: Bag readings in the round
Each bag photo reading in a ward round SHALL show its event as one choice of `Check`, `Emptied` and `Bag changed`, starting at `Emptied` when its bed's reading interval, catheter's included, is 4 h or more, else `Check`, and save with the event picked. A save answered 409 `duplicate_reading` shows `Same as the reading at <time>: <event> at <level> mL.` and "Save anyway", which resends it once with `confirm_duplicate_of` that reading's id and no new upload. Saving makes no `/api/ai` request.

#### Scenario: Per-reading event
- **WHEN** a 3A round reads urine bags at confidence 0.9 for beds 3 and 5, both start at `Emptied`, `Check` is picked on bed 5's reading, and "Save all high-confidence" is tapped
- **THEN** bed 3's bag-reading post has `event: "emptied"` and bed 5's `event: "check"`, each after its own media upload

#### Scenario: Bag changed
- **WHEN** `Bag changed` is picked on bed 3's reading
- **THEN** it is the only event selected on that reading, and its bag-reading post has `event: "bag_changed"`

#### Scenario: Catheter interval
- **WHEN** in the round's ward list 3A bed 5's catheter order has `measure_every_h: 1`
- **THEN** its bag reading starts at `Check`, and "Save all high-confidence" posts it with `event: "check"`

#### Scenario: Duplicate
- **WHEN** bed 3's bag-reading post, after its media upload, answers 409 with `duplicate_of` `{ id: 101, event: "emptied", volume_ml: 380, created_at: <11:00> }`
- **THEN** bed 3's reading shows `Same as the reading at 11:00: emptied at 380 mL.` with "Save anyway", is not saved, and nothing is resent
- **AND** tapping "Save anyway" sends exactly one request, the bag-reading post with the same `media_id` and `read_id` and `confirm_duplicate_of: 101`

#### Scenario: Saved message
- **WHEN** bed 3's emptying at 380 mL is saved and its response holds a 120 mL entry
- **THEN** bed 3's reading reads `Urine bag emptied at 380 mL: 120 mL charted. Waiting for nurse approval.`

#### Scenario: Acuity interval
- **WHEN** a 5B round reads urine bags at confidence 0.9 for 5B bed 1 (order `watch`, no catheter interval) and 5B bed 2 (ward `stable`)
- **THEN** bed 1's reading starts at `Check` and bed 2's at `Emptied`, as their scanned cards' `reading_interval` gives 2 h and 4 h

#### Scenario: Bed from another ward
- **WHEN** during a 3A round the card of HDU bed 1 (ward `critical`) is scanned and its urine bag is read at confidence 0.9, and in a round started with no ward the card of 3A bed 3 is scanned and its bag read
- **THEN** HDU bed 1's reading starts at `Check` and 3A bed 3's at `Emptied`
- **AND** the only request for each card is its `GET /api/beds/<token>`, and no `/api/ai` request is sent beyond each photo's one read
