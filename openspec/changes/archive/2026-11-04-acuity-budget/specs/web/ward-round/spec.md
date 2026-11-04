# Spec Delta

## MODIFIED Requirements

### Requirement: One read per photo, in order
Queued readings, photos and recordings alike, SHALL be read one at a time in queue order, each with exactly one read request: a photo's is one `POST /api/ai/read`, making 3 model requests in `sam+spark` and 1 in `spark`, per its response's `mode`; a recording's is one `POST /api/ai/voice-note`, making 2. A refused read makes 0. A failed read is marked failed and read again only on a Retry tap; after a 429, Retry stays disabled until its `Retry-After`.

#### Scenario: Three photos, one fails
- **WHEN** three readings are queued and the second read fails
- **THEN** exactly three read requests are made in capture order
- **AND** the second reading is marked failed, and the third is still read

#### Scenario: Fast mode
- **WHEN** fast mode is on
- **THEN** each photo read request asks for mode `spark`

#### Scenario: Photo then recording
- **WHEN** a photo and then a recording are queued for bed 2
- **THEN** exactly two read requests are made, in order: `POST /api/ai/read`, then `POST /api/ai/voice-note`
- **AND** the voice-note request carries no read mode

#### Scenario: Mode from each response
- **WHEN** at 10:40 three photos are queued and their read responses are 200 with `mode: "sam+spark"`, 200 with `mode: "spark"` and the warning `budget pressure: read without segmentation`, and 429 `request_budget_exceeded` with `Retry-After: 1200`
- **THEN** exactly three read requests are made, in order, and none is sent again
- **AND** the second reading shows its `budget pressure` warning
- **AND** the third is marked failed, with Retry disabled until 11:00 and enabled after it
