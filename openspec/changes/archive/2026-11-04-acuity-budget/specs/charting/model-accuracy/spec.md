# Spec Delta

## MODIFIED Requirements

### Requirement: Reads name their bed
`POST /api/ai/read`, `/api/ai/note` and `/api/ai/voice-note` SHALL accept an optional `admission_id`, as a form field or, for `/note`, a JSON field. An unknown admission gets 404 `not_found` with no model request and nothing stored. The id is never sent upstream and never changes a request's body; its bed sets only the budget class (capture/read-budget). Requests: photo 3 in `sam+spark` mode and 1 in `spark` mode, text 1, voice 2; 0 when refused.

#### Scenario: Unknown bed
- **WHEN** a JPEG is posted to `/api/ai/read` and a note to `/api/ai/note`, each with `admission_id: 9999`
- **THEN** both responses are 404 with `error: not_found`
- **AND** the upstream received no request, and no read is stored

#### Scenario: Not sent upstream
- **WHEN** `{ text: "coconut water 200" }` is posted to `/api/ai/note` once without `admission_id` and once with the id of bed 1
- **THEN** the two Spark request bodies are identical, and neither contains bed 1's patient name
- **AND** the second stored read names bed 1's admission and the first names none

#### Scenario: Bed picks the class
- **WHEN**, with a cap of 120, a 30 % reserve and 84 requests in use, the same JPEG is posted to `/api/ai/read` in `sam+spark` mode once with HDU bed 1's id and once with 3A bed 4's id
- **THEN** the HDU read is 200 with `mode: "sam+spark"` after exactly 3 upstream requests
- **AND** the 3A read is 429 with `budget_class: "routine"`, the upstream received no request for it, and no read is stored for it
- **AND** the HDU Spark request body contains neither an admission id nor a patient name
