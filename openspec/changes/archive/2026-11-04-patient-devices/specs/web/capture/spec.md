## MODIFIED Requirements

### Requirement: Bag level by hand
The by-hand form SHALL offer "Bag level" for urine, stoma or drain output only for a bag in `devices.bags`, on at first: the bag's level, the event as on the check screen, "When did it happen?" and an optional photo. Without a photo, saving sends one `POST /api/admissions/:id/bag-readings` with `source: "manual"` and no media. With one, it uploads the photo once, then sends the reading with `source: "photo"`, its `media_id` and no evidence. It makes no `/api/ai` request.

#### Scenario: Emptied now
- **WHEN** at 14:00 Ravi Kumar, on 3A bed 3, whose `devices.bags` is `["urine_bag"]`, picks urine output, finds "Bag level" already on, enters 400 mL with "Emptied after photo" picked, and saves
- **THEN** exactly one request is sent: `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "manual" }` and no `charted_at`
- **AND** no `/api/ai` request is sent

#### Scenario: Earlier time
- **WHEN** the same level is saved with "When did it happen?" at 12:30
- **THEN** the request has `charted_at` 12:30 today, local time

#### Scenario: Photo, level typed
- **WHEN** Ravi Kumar adds a photo of the bag to that form, enters 400 mL with "Emptied after photo" picked, and saves
- **THEN** exactly two requests are sent: `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/admissions/<id>/bag-readings` with `{ container: "urine_bag", event: "emptied", volume_ml: 400, source: "photo", media_id: <it> }` and no `evidence`
- **AND** no `/api/ai` request is sent

#### Scenario: Not a bag
- **WHEN** "Bag level" is turned off and 300 mL of urine is saved
- **THEN** exactly one request is sent, `POST /api/admissions/<id>/entries`, as before

#### Scenario: No bag on record
- **WHEN** Ravi Kumar, on 3A bed 5, whose `devices.bags` is `[]`, picks urine, stoma and drain output in turn
- **THEN** none of them shows "Bag level"
- **AND** saving 300 mL of urine sends exactly one request, `POST /api/admissions/<id>/entries`

#### Scenario: Stoma only
- **WHEN** on 2C bed 3, whose `devices.bags` is `["stoma_bag"]`, stoma output is picked, and then urine output
- **THEN** stoma output shows "Stoma bag level" with "Bag level" on, and urine output shows no "Bag level"

## ADDED Requirements

### Requirement: Capture choices follow the bed's devices
The bed screen SHALL list photo container hints as "Auto-detect", the bed's own output containers (urine bag, urinal, bedpan or commode pan as `devices.urine` says, then its stoma and drain bags), the intake containers, then the urinal, bedpan, commode pan and emesis basin not yet listed, never a bag outside `devices.bags`. By hand, urine is saved with the urine method's container as `item`. It all comes from the bed screen's own load, with no extra request.

#### Scenario: Commode bed
- **WHEN** Ravi Kumar opens 3A bed 4, whose `devices` is `{ urine: "commode", urine_from: "voiding", urine_measured: true, bags: [] }`
- **THEN** the hints read, in order, `Auto-detect`, `Commode pan`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Emesis basin`
- **AND** the only requests are `GET /api/beds/<token>` and `GET /api/admissions/<id>/entries`

#### Scenario: Catheter and drain
- **WHEN** a nurse opens 2C bed 2, whose `devices` has `urine: "catheter"` and `bags: ["urine_bag", "drain_bag"]`
- **THEN** the hints read, in order, `Auto-detect`, `Urine bag`, `Drain bag`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Commode pan`, `Emesis basin`, with no `Stoma bag`

#### Scenario: Default urinal
- **WHEN** a bed has `devices` `{ urine: "urinal", urine_from: "default", urine_measured: true, bags: [] }`
- **THEN** the hints read `Auto-detect`, `Urinal`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Bedpan`, `Commode pan`, `Emesis basin`

#### Scenario: Urine by hand
- **WHEN** on 3A bed 4 (commode) 220 mL of urine is saved by hand, and on a default urinal bed 180 mL
- **THEN** the requests are `POST /api/admissions/<id>/entries` with `{ direction: "out", category: "urine", volume_ml: 220, item: "commode pan", source: "manual" }`, and with `volume_ml: 180` and `item: "urinal"`

#### Scenario: Toilet
- **WHEN** Ravi Kumar opens 3A bed 7, whose `devices` is `{ urine: "toilet", urine_from: "voiding", urine_measured: false, bags: [] }`, and saves 300 mL of urine by hand
- **THEN** the hints read `Auto-detect`, `Water jug`, `Water bottle`, `Cup`, `Measuring jug`, `Urinal`, `Bedpan`, `Commode pan`, `Emesis basin`
- **AND** the urine form shows `Urine is not measured on this bed (toilet).`, and the request has `item: null`

### Requirement: Bag photo on a bed without that bag
A photo read as a bag not in the bed's `devices.bags` SHALL be drafted and saved as any bag reading, its check screen showing `No catheter on the care plan for this bed. Saving charts it and asks the nurse to review.` (`No stoma` or `No drain` for those bags). After saving, a nurse or matron is offered "Add catheter" ("Add stoma", "Add drain"), opening that care-plan form, whose save sends one `PUT` and reloads the bed. The mismatch makes no extra `/api/ai` request.

#### Scenario: Attendant
- **WHEN** Ravi Kumar (attendant) opens 3A bed 5, whose `devices.bags` is `[]`, and a photo is read as a urine bag at 300 mL
- **THEN** the check screen shows `No catheter on the care plan for this bed. Saving charts it and asks the nurse to review.`
- **AND** no request was sent beyond the bed screen's load and the one `/api/ai/read`
- **AND** saving sends exactly two requests: `POST /api/admissions/<id>/media` with `kind: photo`, then `POST /api/admissions/<id>/bag-readings` with `container: "urine_bag"`
- **AND** the saved screen offers no "Add catheter"

#### Scenario: Nurse adds the catheter
- **WHEN** Anita Thomas (id 4, nurse) saves the same reading, taps "Add catheter", keeps "Urethral" and "Inserted" today, and saves
- **THEN** the requests after the reading are `PUT /api/admissions/<id>/care/catheter` with `type: "urethral"` and `X-Staff-Id: 4`, then `GET /api/admissions/<id>/entries`
- **AND** no `/api/ai` request is sent

#### Scenario: Bag on record
- **WHEN** a photo is read as a urine bag on 3A bed 3, whose `devices.bags` is `["urine_bag"]`
- **THEN** the check screen shows no `No catheter` warning, and the saved screen offers no "Add catheter"

#### Scenario: Drain on a stoma bed
- **WHEN** on 2C bed 3, whose `devices.bags` is `["stoma_bag"]`, a photo is read as a drain bag at 200 mL
- **THEN** the check screen shows `No drain on the care plan for this bed. Saving charts it and asks the nurse to review.`
