# Spec Delta

## MODIFIED Requirements

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved photo reading with a draft whose confidence is at least 0.75. Each save uploads its photo as media once, then posts the entry, the level for jug and bottle readings, or the bag reading for urine, stoma and drain bags, with that `media_id`. A bag reading is saved with the event picked on it ("Bag readings in the round"). A reading answered 409 `duplicate_reading`, and every other reading, including every recording, stays for individual review.

#### Scenario: Mixed round
- **WHEN** a round has photo readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal), plus one recording
- **THEN** one bag reading and one level are saved, each after its own media upload
- **AND** the 0.5 reading and the recording stay unsaved

#### Scenario: Two wards
- **WHEN** a round reads a urine bag at confidence 0.9 on 3A bed 3 and one on HDU bed 1, and "Save all high-confidence" is tapped
- **THEN** the 3A bag-reading request has `event: "emptied"` and the HDU one `event: "check"`, each after its own media upload
- **AND** saving sends no `/api/ai` request

#### Scenario: Duplicate left for review
- **WHEN** "Save all high-confidence" posts urine-bag readings for 3A beds 3 and 5, and bed 3's post answers 409 `duplicate_reading`
- **THEN** bed 5's reading is saved and bed 3's stays unsaved
- **AND** tapping "Save all high-confidence" again sends no request for bed 3

## ADDED Requirements

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
