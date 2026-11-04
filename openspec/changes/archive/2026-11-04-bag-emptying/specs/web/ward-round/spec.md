# Spec Delta

## MODIFIED Requirements

### Requirement: Save the round
"Save all high-confidence" SHALL save every unsaved photo reading with a draft whose confidence is at least 0.75. Each save uploads its photo as media once, then posts the entry, the level for jug and bottle readings, or the bag reading for urine, stoma and drain bags, with that `media_id`. A bag reading is saved as an emptying when its bed's reading interval is 4 hours or more, else as a check. Every other reading, including every recording, stays for individual review.

#### Scenario: Mixed round
- **WHEN** a round has photo readings at confidence 0.9 (urine bag), 0.8 (water jug) and 0.5 (urinal), plus one recording
- **THEN** one bag reading and one level are saved, each after its own media upload
- **AND** the 0.5 reading and the recording stay unsaved

#### Scenario: Two wards
- **WHEN** a round reads a urine bag at confidence 0.9 on 3A bed 3 and one on HDU bed 1, and "Save all high-confidence" is tapped
- **THEN** the 3A bag-reading request has `event: "emptied"` and the HDU one `event: "check"`, each after its own media upload
- **AND** saving sends no `/api/ai` request
