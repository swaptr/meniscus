# Spec Delta

## MODIFIED Requirements

### Requirement: Media fingerprint shown
Where a kept photo or recording is shown (an entry's photo or voice source, its before/after jug photos, and a meal's tray proof), the app SHALL show `Photo fingerprint: <first 4 hex>…<last 2 hex>`, or `Recording fingerprint: …` for a recording, with the full value as its title. Every media reference has its `sha256`, recorded at upload. It uses the media reference or proof already loaded, with no extra request.

#### Scenario: Photo entry
- **WHEN** a photo entry whose media has `sha256` `3f2a9b0c4d1e7f8a6b5c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3fc9` is opened
- **THEN** its source shows `Photo fingerprint: 3f2a…c9`, titled with the full value
- **AND** the only request is `GET /api/media/<id>`

#### Scenario: Older recording
- **WHEN** a voice entry recorded earlier in the shift, whose media has `sha256` `9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c71`, is opened
- **THEN** its source shows `Recording fingerprint: 9c0d…71`, titled with the full value

### Requirement: Bag reading interval on the care plan
The bed review's catheter row SHALL read `Bag reading every <h> h`, from `bags`, adding ` · By acuity` unless the catheter order sets it, and its History row adds `, bag reading every <h> h` when set. A nurse or matron's catheter form offers "Bag reading every": `By acuity (<h> h)` from `acuity.interval_h`, 1, 2, 4, 6, 8 or 12 h, starting at the active order's. Saving sends one PUT with the order's type and insertion time and `measure_every_h` (null for acuity), then reloads. No model request.

#### Scenario: Set by the order
- **WHEN** 3A bed 5's catheter `{ type: "urethral", inserted_at: <29 Oct> }` has `measure_every_h: 2`, and its bed review is opened on 3 Nov
- **THEN** its catheter row reads `Urethral catheter · inserted 29 Oct · Catheter day 6` and `Bag reading every 2 h`

#### Scenario: Default
- **WHEN** HDU bed 1's catheter has `measure_every_h: null`
- **THEN** its catheter row reads `Bag reading every 1 h · By acuity`

#### Scenario: Change it
- **WHEN** at 09:05 on 3 Nov Nikhil Bose (id 7) opens the catheter form on HDU bed 1 (admission 19), whose catheter is `{ type: "urethral", inserted_at: <00:00 on 29 Oct> }` and whose review is due, picks "4 h" and saves
- **THEN** the requests are, in order:
  1. `PUT /api/admissions/19/care/catheter` with `{ type: "urethral", inserted_at: <00:00 on 29 Oct>, measure_every_h: 4 }` and `X-Staff-Id: 7`;
  2. `GET /api/admissions/19/entries` and `GET /api/admissions/19/meals`
- **AND** after the reload the row reads `Bag reading every 4 h`, "Reviewed today" is still offered, and no `/api/ai` request was sent

#### Scenario: Back to the default
- **WHEN** on that form `By acuity (1 h)` is picked and saved
- **THEN** the PUT has `measure_every_h: null`

#### Scenario: Form defaults
- **WHEN** a new catheter form is opened on 3A bed 4, HDU bed 3 and 5B bed 1 (order `watch`), none with a catheter
- **THEN** "Bag reading every" starts at `By acuity (4 h)` on 3A bed 4, `By acuity (1 h)` on HDU bed 3 and `By acuity (2 h)` on 5B bed 1

#### Scenario: History
- **WHEN** Nikhil Bose's 4-hour order replaced the default one at 09:05 on 3 Nov
- **THEN** the History rows read `Urethral catheter inserted 29 Oct, bag reading every 4 h · 09:05–now · set by Nikhil B.`, then the replaced order's row, with no interval and `ended by Nikhil B.`

#### Scenario: Order beats acuity
- **WHEN** 5B bed 1 (order `watch`) has a catheter with `measure_every_h: 1`, and its bed review is opened and then its catheter form
- **THEN** its catheter row reads `Bag reading every 1 h`, with no ` · By acuity`
- **AND** the form's "Bag reading every" starts at `1 h` and offers `By acuity (2 h)` first
