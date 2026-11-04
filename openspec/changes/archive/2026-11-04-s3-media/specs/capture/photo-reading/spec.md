# Spec Delta

## MODIFIED Requirements

### Requirement: Upload validation
`POST /api/ai/read` SHALL reject a non-image upload, or an image over 8 MB, with HTTP 400 `invalid_request` and make no model request.

#### Scenario: Text file uploaded
- **WHEN** the `image` field is a `text/plain` file
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request

#### Scenario: Photo over 8 MB
- **WHEN** the `image` field is a 9 MB JPEG
- **THEN** the response is 400 with `error: invalid_request` and the upstream received no request
