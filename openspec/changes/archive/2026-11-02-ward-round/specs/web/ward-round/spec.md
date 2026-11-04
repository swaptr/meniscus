## Purpose
Bulk capture on a multi-bed ward: photograph a bed's QR card, then its containers, bed after bed, and confirm all drafts at the end.

## ADDED Requirements

### Requirement: Bed card switches the bed
A round photo whose QR code is a Meniscus bed link (`…/a/bed/<token>`) SHALL make that bed current, making no model request; a QR code that is not a bed link SHALL be reported and change nothing.

#### Scenario: Bed card photo
- **WHEN** a photo decodes to `https://ward.example/a/bed/abcDEF123_-xyz0000000`
- **THEN** the token `abcDEF123_-xyz0000000` is looked up and that bed becomes current, with no `/api/ai` request

#### Scenario: Foreign QR
- **WHEN** a photo decodes to `https://example.com/menu`
- **THEN** it is reported as not a bed card and the current bed is unchanged

### Requirement: Readings join the current bed
A round photo without a bed link SHALL be queued as a reading for the current bed; with no current bed it SHALL be rejected with a prompt to scan a bed card first and make no request.

#### Scenario: Two beds
- **WHEN** bed 1's card, a bag photo, bed 2's card and two photos are taken
- **THEN** the queue holds one reading for bed 1 and two for bed 2, in that order

#### Scenario: No bed yet
- **WHEN** the first photo of a round has no bed card
- **THEN** nothing is queued and the user is asked to scan a bed card

### Requirement: One read per photo, in order
Queued readings SHALL be read one at a time in capture order, each with exactly one read request (3 model requests, 1 in fast mode); a failed read SHALL be marked failed and SHALL be read again only when the user taps Retry.

#### Scenario: Three photos, one fails
- **WHEN** three readings are queued and the second read fails
- **THEN** exactly three read requests are made in capture order, the second reading is marked failed, and the third is still read

#### Scenario: Fast mode
- **WHEN** fast mode is on
- **THEN** each read request asks for mode `spark`

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved reading with a draft whose confidence is at least 0.75 (entry, then its photo; jug/bottle readings as levels) and leave the others for individual review.

#### Scenario: Mixed round
- **WHEN** a round has readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal)
- **THEN** one entry and one level are saved with their photos, and the 0.5 reading stays unsaved
