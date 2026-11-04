# Spec Delta

## MODIFIED Requirements

### Requirement: Photos are shrunk before upload
A captured photo SHALL be scaled so its longest side is at most 1280 px, keeping its aspect ratio and never enlarging it, and sent only when it is at most 8 MB. A photo still over 8 MB after one lower-quality re-encode, or one the server refuses as invalid or too large, shows `Photo too large · max 8 MB. Retake closer or in better light.`

#### Scenario: Large phone photo
- **WHEN** a 4032 × 3024 photo is captured
- **THEN** it is uploaded at 1280 × 960

#### Scenario: Small photo
- **WHEN** an 800 × 600 photo is captured
- **THEN** it is uploaded at 800 × 600

#### Scenario: Photo over 8 MB
- **WHEN** a picked photo is still over 8 MB after shrinking and its one re-encode
- **THEN** the screen shows `Photo too large · max 8 MB. Retake closer or in better light.` and no request is sent

#### Scenario: Server refuses the photo's size
- **WHEN** an upload or read of a photo is answered 413 `payload_too_large` or 400 `invalid_request`
- **THEN** the screen shows `Photo too large · max 8 MB. Retake closer or in better light.`, not a generic failure
