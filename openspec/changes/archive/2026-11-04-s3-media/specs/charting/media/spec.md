# Spec Delta

## ADDED Requirements

### Requirement: Media kept in an object store
The server SHALL keep each distinct content as exactly one object, `<sha256[0:2]>/<sha256>`, in the private bucket `S3_BUCKET`, written after every check that can refuse the upload and before its media row commits. The database keeps only metadata. Uploads with identical bytes share one object and keep their own media ids. Upload and link responses are unchanged, serve responses only add `Content-Length` ("Serve media"), and the web never contacts the object store. It makes no model request.

#### Scenario: Photo stored as an object
- **WHEN** a 48,213-byte JPEG is uploaded for 3A bed 4 with `kind: photo` and linked from a photo entry
- **THEN** the bucket `meniscus-media` holds the object `<sha256[0:2]>/<sha256>` with exactly those bytes, where `<sha256>` is the upload's `sha256`
- **AND** `GET /api/media/<id>` returns the 48,213 bytes with `Content-Type: image/jpeg` and `Cache-Control: no-store`
- **AND** a 64-byte run from the middle of the photo is found in no file under `DATA_DIR`
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

### Requirement: Objects go with their last media row
After a change that deletes media rows commits (a rejected entry, a voided meal, or expiry), the server SHALL delete, before that request is answered or, for expiry on open, before listening, the object of each deleted row whose `sha256` no media row has any more, with one delete request per object. It never deletes an object that a committed media row names. An upload of the same bytes racing that delete still commits with its object stored. It makes no model request.

#### Scenario: Last reference
- **WHEN** a JPEG is uploaded for 3A bed 4 and linked from a pending photo entry, and the entry is rejected
- **THEN** `GET /api/media/<id>` returns 404, and the bucket no longer holds the object once the reject has answered
- **AND** the object store received exactly one delete request

#### Scenario: Shared content
- **WHEN** the same JPEG is uploaded for 3A beds 4 and 5, each linked from a pending photo entry, and bed 4's entry is rejected
- **THEN** bed 5's `GET /api/media/<id>` still returns the photo, the bucket keeps the object, and the object store received no delete request

#### Scenario: Voided lunch with its served photo
- **WHEN** a lunch for 3A bed 1 linked to tray photo 42 and served photo 41, whose bytes no other media has, is voided
- **THEN** neither photo's object is in the bucket once the void has answered
- **AND** the meal's `proof.photo` and `proof.served` keep their fingerprints

#### Scenario: Expired upload
- **WHEN** a photo is uploaded for 3A bed 1 at 09:00 on 2 Nov and never linked, and another photo is uploaded at 09:01 on 3 Nov
- **THEN** once the second upload has answered 201, the first photo's object is gone from the bucket and the second's is there

#### Scenario: Same bytes uploaded during a delete
- **WHEN** a JPEG's only media row is deleted by rejecting its entry while an upload of the same bytes for another bed is still writing its object, and that upload then completes
- **THEN** the upload's response is 201, and `GET /api/media/<its id>` returns the photo
- **AND** the bucket holds the object

### Requirement: Media store unavailable
When the object store answers a media write or read with an error, or does not answer within 10 seconds, the server SHALL answer 503 `{"error":"media_unavailable"}` after that one request, never retrying it. A failed write (`POST /api/admissions/:id/media`, `POST /api/entries/:id/photo`) stores no media row. A failed delete keeps the object, and the reject or void still succeeds. It makes no model request.

#### Scenario: Upload while the store is down
- **WHEN** the object store answers the PUT of a JPEG uploaded for 3A bed 4 with HTTP 503
- **THEN** the response is 503 with the body exactly `{"error":"media_unavailable"}`, and no media row is stored
- **AND** the object store received exactly one request, the PUT, and the same upload answered with HTTP 429 also gets 503 after exactly one request

#### Scenario: Store does not answer
- **WHEN** the object store does not answer the PUT of a voice recording for 3A bed 4 within 10 seconds
- **THEN** the response is 503 with `error: media_unavailable`, the object store received exactly one request, the PUT, and no media row is stored

#### Scenario: Read while the store is down
- **WHEN** `GET /api/media/<id>` is sent for a stored photo and the object store answers the GET with HTTP 500
- **THEN** the response is 503 with `error: media_unavailable`
- **AND** the object store received exactly one request, the GET

#### Scenario: Delete fails
- **WHEN** a pending photo entry for 3A bed 4 is rejected and the object store answers the delete with HTTP 503
- **THEN** the reject succeeds and the entry is `rejected`, and `GET /api/media/<id>` returns 404
- **AND** the object store received exactly one delete request

#### Scenario: Served tray photo unreadable
- **WHEN** a tray photo for 3A bed 1 is read with `POST /api/ai/meal` for lunch, the bed has a served lunch photo, and the object store answers that photo's GET with HTTP 503
- **THEN** the response is 503 with `error: media_unavailable`
- **AND** the object store received exactly one request, the GET, and the upstream received no request

### Requirement: Media store logs nothing identifying
Every log line about an object-store request SHALL carry only the operation, the HTTP status or error name, the duration and the media id when one exists. It never carries an object key, a `sha256`, media bytes, the access key id, the secret or a request signature.

#### Scenario: Refused write logged
- **WHEN** `S3_ACCESS_KEY_ID=ak-test-77bb` and `S3_SECRET_ACCESS_KEY=sk-test-55aa`, and the object store answers a photo upload's PUT with HTTP 403
- **THEN** a log line contains `media put 403`
- **AND** no log line contains `sk-test-55aa`, `ak-test-77bb`, `Signature=` or the photo's `sha256`

## MODIFIED Requirements

### Requirement: Serve media
`GET /api/media/:id` SHALL return the stored bytes with their content type, a `Content-Length` equal to their size, and `Cache-Control: no-store`, or 404 `not_found`.

#### Scenario: Recording served
- **WHEN** a stored WebM recording is requested
- **THEN** the response is 200, with `Content-Type: audio/webm`, `Cache-Control: no-store`, a `Content-Length` equal to the upload's `size`, and the same bytes

#### Scenario: No such media
- **WHEN** `GET /api/media/9999` is requested
- **THEN** the response is 404 with `error: not_found`

#### Scenario: Large recording served
- **WHEN** a 24,000,044-byte WAV recording is stored and requested
- **THEN** the response is 200 with `Content-Type: audio/wav` and `Content-Length: 24000044`, and the SHA-256 of the body equals the upload's `sha256`

### Requirement: Upload media
`POST /api/admissions/:id/media` with a `file`, a `kind` and an optional `duration_ms` SHALL store the file and return 201 `{ id, kind, mime, size, duration_ms, created_at, sha256, served_meal }`.
- `photo`: JPEG, PNG, WebP or GIF, up to 8 MB.
- `voice`: WebM, Ogg, MP4/M4A, WAV or MP3, up to 25 MB.

The type is checked against the bytes. A wrong, empty or over-limit file gets 400 `invalid_request`, a body over 26 MB 413, and an unknown admission 404 `not_found`. No model request is made.

#### Scenario: Voice recording
- **WHEN** WebM bytes are posted with `kind: voice` and `duration_ms: 4200` for bed 1
- **THEN** the response is 201 with `kind: voice`, `mime: audio/webm`, `duration_ms: 4200` and `served_meal: null`
- **AND** the upstream received no request

#### Scenario: Wrong file
- **WHEN** JPEG bytes are posted with `kind: voice`, and the text `hello` with `kind: photo`
- **THEN** both responses are 400 with `error: invalid_request`

#### Scenario: MP4 brands
- **WHEN** MP4 files with the brand `M4A ` and with the brand `heic` are posted with `kind: voice`
- **THEN** the `M4A ` file gets 201 with `mime: audio/mp4`
- **AND** the `heic` file, a phone photo, gets 400 with `error: invalid_request`

#### Scenario: Unknown bed
- **WHEN** a JPEG is posted for admission 9999
- **THEN** the response is 404 with `error: not_found`

#### Scenario: Too large
- **WHEN** a 9 MB JPEG is posted with `kind: photo`, and then a 30 MB request body
- **THEN** the first response is 400 with `error: invalid_request`, the second is 413, and nothing is stored
