# Spec Delta

## MODIFIED Requirements

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved photo reading with a draft whose confidence is at least 0.75. Each save uploads its photo once and, when segmented, its labeled copy, then posts the entry, the level for a jug or bottle, or the bag reading for urine, stoma and drain bags, with those ids. A bag reading takes its picked event ("Bag readings in the round"). A reading answered 409 `duplicate_reading` and every other reading, recordings included, stay for individual review.

#### Scenario: Mixed round
- **WHEN** a round has photo readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal), plus one recording
- **THEN** one bag reading and one level are saved, each after its own media uploads
- **AND** the 0.5 reading and the recording stay unsaved

#### Scenario: Two wards
- **WHEN** a round reads a urine bag at confidence 0.9 on 3A bed 3 and one on HDU bed 1, and "Save all high-confidence" is tapped
- **THEN** the 3A bag-reading request has `event: "emptied"` and the HDU one `event: "check"`, each after its own media uploads
- **AND** saving sends no `/api/ai` request

#### Scenario: Duplicate left for review
- **WHEN** "Save all high-confidence" posts urine-bag readings for 3A beds 3 and 5, and bed 3's post answers 409 `duplicate_reading`
- **THEN** bed 5's reading is saved and bed 3's stays unsaved
- **AND** tapping "Save all high-confidence" again sends no request for bed 3

### Requirement: Round reads and saves carry their read
In a ward round, each reading's read request SHALL carry its bed's `admission_id`, and each save its reading's `read_id` (with `read_draft` for a recording's drafts), in the request that saves it. No request is added: a photo read stays 3 model requests (1 in `spark` mode) and a recording 2, and `Read <n> · <k> model requests` counts the same. A reading whose read answered `READ_ABANDON_HOURS` less 5 minutes or more ago, by the device's clock, is saved without it.

#### Scenario: Two beds
- **WHEN** bed 2's card, a urinal photo, bed 4's card and a jug photo are taken
- **THEN** the two read requests are `POST /api/ai/read` with `admission_id` of bed 2, then of bed 4

#### Scenario: Save all high-confidence
- **WHEN** the urinal photo was read with `read_id: 51` at confidence 0.9 and the jug photo with `read_id: 52` at 0.8, and "Save all high-confidence" is tapped
- **THEN** the entry post for bed 2 has `read_id: 51` and the level post for bed 4 `read_id: 52`, each after its own media uploads, and no other request is sent
- **AND** with both read in `sam+spark` mode with segmentation, exactly six requests are sent: for each bed, the photo upload, its labeled copy upload, then the post with `labeled_media_id`

#### Scenario: Bag reading
- **WHEN** a urine bag photo for bed 2 was read with `read_id: 54` at confidence 0.9, and "Save all high-confidence" is tapped
- **THEN** after its media uploads, the one `POST /api/admissions/<bed 2>/bag-readings` has `container: "urine_bag"`, `source: "photo"`, its `media_id` and `read_id: 54`
- **AND** read in `spark` mode, with `segmentation: null`, exactly two requests are sent: the photo upload, then that post with no `labeled_media_id`

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
