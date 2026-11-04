# Spec Delta

## ADDED Requirements

### Requirement: Reads and saves carry their read
On the bed capture screen, each photo, typed or voice read request SHALL carry the bed's `admission_id`, and each save of its draft (entry, level or bag reading) its `read_id`, with `read_draft` for a note's drafts. No request is added: photo 3 (1 in `spark` mode), text 1, voice 2. By-hand records carry none, nor does a draft whose read answered `READ_ABANDON_HOURS` less 5 minutes or more ago, by the device's clock, as decided at its first save attempt and kept for its retries.

#### Scenario: Photo draft
- **WHEN** on bed 16 a photo read of a `urinal` answers with `read_id: 41` and a 450 mL urine draft, and the draft is saved
- **THEN** the read request was one `POST /api/ai/read` whose form has `admission_id` 16
- **AND** saving makes exactly two requests: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/entries` with `read_id: 41`

#### Scenario: Voice note with two drafts
- **WHEN** a voice note on bed 16 answers with `read_id: 42` and drafts 200 mL tea and 300 mL urine, and both are saved
- **THEN** the requests are one `POST /api/admissions/16/media` with `kind: voice`, then two entry posts, with `read_id: 42` and `read_draft` 0 and 1 respectively

#### Scenario: Dropped draft
- **WHEN** a voice note answers with `read_id: 42` and drafts 200 mL tea and 300 mL urine, the tea draft is removed, and the urine draft is saved
- **THEN** its entry post carries `read_id: 42` and `read_draft: 1`

#### Scenario: Typed note and jug
- **WHEN** a typed note answers with `read_id: 45` and a water jug read with `read_id: 43`, and each is saved
- **THEN** the note's entry post has `read_id: 45` and `read_draft: 0`, and the level post `read_id: 43`
- **AND** the note request carried `admission_id` 16 in its JSON

#### Scenario: By hand
- **WHEN** a drink is entered by hand, and on bed 16 "Bag level" is saved for urine at 400 mL with a photo and "Emptied after photo" on
- **THEN** the entry post carries no `read_id`
- **AND** the bag-reading post is `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <it> }`, with no `evidence` and no `read_id`

#### Scenario: Bag photo
- **WHEN** on bed 16 a photo read answers with `read_id: 47` and a `urine_bag` at 380 mL, and it is saved as an emptying
- **THEN** saving makes exactly two requests: `POST /api/admissions/16/media` with `kind: photo`, then `POST /api/admissions/16/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 380, source: "photo", media_id: <it>, read_id: 47 }` and the read's evidence

#### Scenario: Emptied it now
- **WHEN** on bed 16 a photo read answers with `read_id: 48` and a `urine_bag` at 260 mL, it is saved as a check with `read_id: 48`, and "Emptied it now? Add after-emptying photo" is tapped
- **THEN** the emptying post is `{ container: "urine_bag", event: "emptied", volume_ml: 260, source: "manual" }`, with no `read_id`

#### Scenario: Stale read
- **WHEN** two `urinal` photo reads and one `water_jug` photo read answer at 08:00 by the device's clock, and the first urinal draft is saved at 19:54, the second at 19:55 and the jug at 19:55
- **THEN** the first entry post carries its `read_id`
- **AND** the second entry post and the level post carry none, and both are saved

#### Scenario: Retried save
- **WHEN** a `urinal` photo read answers with `read_id: 41` at 08:00 by the device's clock, its first save at 19:54 uploads the photo and then the entry post fails with a network error, and Save is tapped again at 19:56
- **THEN** the retry sends exactly one request, the entry post, and it carries `read_id: 41`
