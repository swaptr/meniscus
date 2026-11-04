## ADDED Requirements

### Requirement: Bedpan and commode reads
A photo read SHALL accept the hints `bedpan` and `commode_pan` and may return either as its container. With hint `bedpan` or `commode_pan`, SAM is prompted `bedpan` or `commode pan`. A reading of either with fluid `urine` or `other` drafts `out` / `urine` with `item` `bedpan` or `commode pan`. A read makes the same requests as any other: exactly two SAM requests and one Spark request in `sam+spark` mode, and exactly one Spark request in `spark` mode.

#### Scenario: Commode pan, grounded
- **WHEN** a JPEG is read with hint `commode_pan` in `sam+spark` mode, and Spark returns container `commode_pan`, fluid `urine`, 250 mL
- **THEN** the upstream receives SAM prompts `commode pan` and `liquid` and one Spark request, and nothing else
- **AND** the draft is `{ direction: out, category: urine, volume_ml: 250, item: "commode pan" }`

#### Scenario: Bedpan, Spark only
- **WHEN** a JPEG is read with hint `bedpan` in `spark` mode, and Spark returns container `bedpan`, fluid `other`, 180 mL
- **THEN** exactly one upstream request is made, a Spark request
- **AND** the draft is `{ direction: out, category: urine, volume_ml: 180, item: "bedpan" }`

#### Scenario: Unknown hint
- **WHEN** a JPEG is sent to `POST /api/ai/read` with hint `commode`
- **THEN** the response is 400 with `error: invalid_request`, and the upstream received no request
