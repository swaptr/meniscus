# Spec Delta

## MODIFIED Requirements

### Requirement: Media kept in an object store
The server SHALL keep each distinct content as exactly one object, `<sha256[0:2]>/<sha256>`, in the private bucket `S3_BUCKET`, written after every check that can refuse the upload and before its media row commits. The database keeps only metadata. Uploads with identical bytes share one object and keep their own media ids. Upload and link responses are unchanged, serve responses only add `Content-Length` ("Serve media"), and the web never contacts the object store. It makes no model request.

#### Scenario: Photo stored as an object
- **WHEN** a 48,213-byte JPEG is uploaded for 3A bed 4 with `kind: photo` and linked from a photo entry
- **THEN** the bucket `meniscus-media` holds the object `<sha256[0:2]>/<sha256>` with exactly those bytes, where `<sha256>` is the upload's `sha256`
- **AND** `GET /api/media/<id>` returns the 48,213 bytes with `Content-Type: image/jpeg` and `Cache-Control: no-store`
- **AND** no column of any table in schema `meniscus` has type `bytea`, and its `media` row holds the `sha256` but not the bytes
- **AND** the upstream received no request

#### Scenario: Same bytes for two beds
- **WHEN** the same JPEG is uploaded for 3A bed 4 and for 3A bed 5
- **THEN** the two responses have different `id`s and the same `sha256`, and the bucket holds one object for them

#### Scenario: Refused upload writes nothing
- **WHEN** the text `hello` is posted with `kind: photo` for 3A bed 4
- **THEN** the response is 400 with `error: invalid_request`
- **AND** the object store received no request and the bucket is unchanged

#### Scenario: Refused by the chart before the PUT
- **WHEN** a valid JPEG is posted to `POST /api/admissions/9999/media`, and another to `POST /api/entries/<id>/photo` for an entry that already has a photo
- **THEN** the responses are 404 with `error: not_found` and 409 with `error: photo_exists`
- **AND** the object store received 0 requests and the bucket is unchanged

