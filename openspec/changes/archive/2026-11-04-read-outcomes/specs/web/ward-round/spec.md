# Spec Delta

## ADDED Requirements

### Requirement: Round reads and saves carry their read
In a ward round, each reading's read request SHALL carry its bed's `admission_id`, and each save its reading's `read_id` (with `read_draft` for a recording's drafts), in the request that saves it. No request is added: a photo read stays 3 model requests (1 in `spark` mode) and a recording 2, and `Read <n> · <k> model requests` counts the same. A reading whose read answered `READ_ABANDON_HOURS` less 5 minutes or more ago, by the device's clock, is saved without it.

#### Scenario: Two beds
- **WHEN** bed 2's card, a urinal photo, bed 4's card and a jug photo are taken
- **THEN** the two read requests are `POST /api/ai/read` with `admission_id` of bed 2, then of bed 4

#### Scenario: Save all high-confidence
- **WHEN** the urinal photo was read with `read_id: 51` at confidence 0.9 and the jug photo with `read_id: 52` at 0.8, and "Save all high-confidence" is tapped
- **THEN** the entry post for bed 2 has `read_id: 51` and the level post for bed 4 `read_id: 52`, each after its own media upload, and no other request is sent

#### Scenario: Bag reading
- **WHEN** a urine bag photo for bed 2 was read with `read_id: 54` at confidence 0.9, and "Save all high-confidence" is tapped
- **THEN** after its media upload, the one `POST /api/admissions/<bed 2>/bag-readings` has `container: "urine_bag"`, `source: "photo"`, its `media_id` and `read_id: 54`

#### Scenario: Stale reading
- **WHEN** a urinal photo for bed 2 was read at 08:00 by the device's clock, and its reading is saved at 19:55
- **THEN** its entry post carries no `read_id`, and the entry is saved

#### Scenario: Recording with two drafts
- **WHEN** a recording for bed 2 is read with `read_id: 53`, drafting 200 mL tea and 300 mL urine, and both are saved
- **THEN** after one media upload, the two entry posts carry `read_id: 53` with `read_draft` 0 and 1

#### Scenario: Dropped draft
- **WHEN** a recording read with `read_id: 53` drafts 200 mL tea and 300 mL urine, the tea draft is removed, and the reading is saved
- **THEN** after one media upload, exactly one entry post is sent, with `read_id: 53` and `read_draft: 1`

#### Scenario: Imported queue
- **WHEN** 3 photos and 2 recordings are imported
- **THEN** the button still reads `Read 5 · 13 model requests`

### Requirement: Round saves resume after a failure
In a ward round, each draft of a reading SHALL be marked saved as soon as its post succeeds, so saving again after a failure posts only the drafts not yet saved. A retried post answered 400 with the issue `already linked` at `read_id` counts that draft as saved. Whether the posts carry the `read_id` is decided at the reading's first save attempt and kept for every retry. A retry makes no model request and adds no request beyond the posts of unsaved drafts.

#### Scenario: Second draft fails
- **WHEN** a recording for bed 2 read with `read_id: 53` drafts 200 mL tea and 300 mL urine, saving posts the tea (201) and the urine post fails with a network error, and Save is tapped again
- **THEN** the retry sends exactly one request, the entry post with `read_id: 53` and `read_draft: 1`, and no media upload
- **AND** when it answers 201 the reading is saved with both entries

#### Scenario: Already linked
- **WHEN** the urine post of that recording reached the server but its response was lost, and Save is tapped again
- **THEN** the retried post with `read_id: 53` and `read_draft: 1` answers 400 with `{ path: "read_id", message: "already linked" }`
- **AND** the reading shows as saved, with no error and no further request

#### Scenario: Retry past the margin
- **WHEN** a recording for bed 2 read with `read_id: 53` at 08:00 by the device's clock drafts 200 mL tea and 300 mL urine, saving at 19:54 posts the tea (201) and the urine post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry's one entry post carries `read_id: 53` and `read_draft: 1`
