# Spec Delta

## ADDED Requirements

### Requirement: Photo read names its image
`POST /api/ai/read` SHALL return `image_sha256`, the lowercase-hex SHA-256 of the image bytes it read, in every mode, so the read's geometry can be bound to the photo that is kept. It is computed locally from the posted bytes: the read still makes exactly 3 upstream requests in `sam+spark` mode (2 SAM, 1 Spark) and 1 in `spark` mode, and the value is never logged.

#### Scenario: Urine bag read
- **WHEN** a 48,213-byte JPEG is read with hint `urine_bag` in `sam+spark` mode
- **THEN** the result's `image_sha256` is the 64-character lowercase-hex SHA-256 of those 48,213 bytes, and exactly 3 upstream requests were made

#### Scenario: Spark mode
- **WHEN** the same JPEG is read in `spark` mode
- **THEN** the result has `segmentation: null`, the same `image_sha256`, and exactly 1 upstream request was made

#### Scenario: Not in the log
- **WHEN** that read completes
- **THEN** no server log line contains its `image_sha256`
