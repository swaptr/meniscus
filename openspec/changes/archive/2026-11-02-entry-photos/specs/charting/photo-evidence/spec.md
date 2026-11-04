## Purpose
Keeping the capture photo with its chart entry so a nurse can check the reading before approving, and discarding it when the entry is rejected.

## ADDED Requirements

### Requirement: Attach a photo
`POST /api/entries/:id/photo` SHALL store one JPEG, PNG, WebP or GIF image for a pending entry and mark the entry `has_photo`, making no model request; an entry that already has a photo SHALL get HTTP 409 `photo_exists`, a reviewed entry HTTP 409 `not_pending`, an unknown entry HTTP 404 `not_found`, and bytes that do not match the declared type HTTP 400 `invalid_request`.

#### Scenario: Photo of a pending entry
- **WHEN** a JPEG is posted for a pending entry
- **THEN** the response is 201, the entry list shows `has_photo: true`, and the upstream received no request

#### Scenario: Second photo
- **WHEN** another JPEG is posted for the same entry
- **THEN** the response is 409 with `error: photo_exists`

#### Scenario: Not an image
- **WHEN** the bytes `hello` are posted as `image/jpeg`
- **THEN** the response is 400 with `error: invalid_request`

### Requirement: Serve the photo
`GET /api/entries/:id/photo` SHALL return the stored bytes with their content type and `Cache-Control: no-store`, or HTTP 404 `not_found` when the entry has no photo.

#### Scenario: Stored photo
- **WHEN** the photo of an entry with a stored JPEG is requested
- **THEN** the response is 200 with `Content-Type: image/jpeg`, `Cache-Control: no-store` and the same bytes

#### Scenario: No photo
- **WHEN** the photo of an entry without one is requested
- **THEN** the response is 404 with `error: not_found`

### Requirement: Rejected entries drop their photo
Rejecting an entry SHALL delete its photo.

#### Scenario: Reject
- **WHEN** a pending entry with a photo is rejected
- **THEN** its photo request returns 404 and the entry shows `has_photo: false`
