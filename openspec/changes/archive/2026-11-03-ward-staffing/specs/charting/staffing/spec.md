# Spec Delta

## Purpose

Who works where and who decides. Covers each ward's team of attendants and nurses, the matron over a group of wards, the configured shifts, the nurse in charge and the bed assignments of each shift, the rule that only a nurse or matron decides on saved records while anyone may record, the reason recorded when someone opens a ward outside their team (break-the-glass; stored for review, read by no endpoint in this change), the demo hospital's staffing, and how older store files gain it. Adjusting an AI draft before saving it is recording, open to attendants. "Decisions need a nurse" adds a 403 to the existing Nurse review, Amend an approved entry and Void a meal requirements without modifying them. Who is signed in comes from the server session (server/security). None of it calls a model.

## ADDED Requirements

### Requirement: Demo staffing
When the server seeds the demo hospital, it SHALL also seed the ward teams and, for the shift current at seeding, each ward's nurse in charge and bed assignments. Wards 2C, 3A and 5B each get a home nurse and home attendants. Renal HDU gets two home nurses and no attendants, one nurse to two patients on the demo shift. One matron, with no home ward, oversees all four wards. It makes no model request.

#### Scenario: Who works where
- **WHEN** `GET /api/staff`, `GET /api/wards` and each ward's `GET /api/wards/:id/team` are called on a fresh store
- **THEN** the home ward (the first of `wards`) of each attendant and nurse is:
  - 2C: Meera Pillai (nurse), Rekha Gupta (attendant)
  - 3A: Anita Thomas (nurse), Ravi Kumar and Sunita Devi (attendants)
  - 5B: Grace Lee (nurse), Mohan Das (attendant)
  - HDU: Nikhil Bose and Divya Kapoor (nurses), no attendant
- **AND** Lakshmi Iyer (matron) has the `wards` 2C, 3A, 5B, HDU
- **AND** `in_charge` is Meera Pillai on 2C, Anita Thomas on 3A, Grace Lee on 5B and Nikhil Bose on HDU
- **AND** every occupied bed of 2C, 3A and 5B is assigned to Meera Pillai, Anita Thomas and Grace Lee respectively, and HDU beds 1 and 2 to Nikhil Bose and bed 3 to Divya Kapoor
- **AND** the upstream received no request

### Requirement: Nurse in charge
`GET /api/wards` SHALL include each ward's `in_charge`: the `{ id, name, role }` of the nurse named for the current shift, or null. Shifts follow the configured `SHIFTS`, by default day 08:00–20:00 and night 20:00–08:00 in server local time. A nurse named in charge stays in charge until that shift ends. It makes no model request.

#### Scenario: Day shift ends
- **WHEN** the store is seeded at 09:00 local time on 2 Nov
- **AND** `GET /api/wards` is called at 19:59 and again at 20:00
- **THEN** at 19:59, 3A's `in_charge` is `{ id: 4, name: "Anita Thomas", role: "nurse" }`
- **AND** at 20:00, every ward's `in_charge` is null

#### Scenario: Night shift crosses midnight
- **WHEN** the store is seeded at 23:00 local time on 2 Nov
- **AND** `GET /api/wards` is called at 07:59 and again at 08:00 on 3 Nov
- **THEN** 3A's `in_charge` is Anita Thomas at 07:59 and null at 08:00

#### Scenario: Three shifts
- **WHEN** the shifts are early 07:00, late 15:00 and night 23:00, and the shift is worked out for 14:59, 15:00 and 23:00 on 3 Nov and for 06:59 on 3 Nov
- **THEN** 14:59 is in the early shift of 07:00–15:00 on 3 Nov, and 15:00 starts the late shift ending at 23:00
- **AND** 06:59 on 3 Nov is in the night shift that began at 23:00 on 2 Nov and ends at 07:00, and 23:00 on 3 Nov starts a new night shift

### Requirement: Ward team
`GET /api/wards/:id/team` SHALL return `{ ward_id, shift_start, in_charge, team, assignments }` for the current shift. `team` lists each attendant and nurse whose `wards` include the ward as `{ id, name, role, home }` (`home`: it is their home ward): nurses then attendants, home before cover, then by id; matrons are not listed. `assignments` lists `{ admission_id, staff_id }`. An unknown ward gets 404 `not_found`. It makes no model request.

#### Scenario: Team of 3A
- **WHEN** `GET /api/wards/<3A>/team` is called on a fresh store
- **THEN** `in_charge` is Anita Thomas, and `team` lists, in order:
  - Anita Thomas (nurse, home)
  - Grace Lee (nurse, cover)
  - Meera Pillai (nurse, cover)
  - Ravi Kumar (attendant, home)
  - Sunita Devi (attendant, home)
- **AND** `assignments` gives each of the 7 occupied 3A beds to Anita Thomas (id 4)

#### Scenario: Unknown ward team
- **WHEN** `GET /api/wards/999/team` is called
- **THEN** the response is 404 with `error: not_found`

### Requirement: Name the nurse in charge
`PUT /api/wards/:id/in-charge` with `{ staff_id }` SHALL make that nurse in charge of the ward, replacing anyone else, and of no other ward, for the current shift, and return the ward team. After the sign-in checks, errors change nothing, in order: 404 `not_found` (unknown ward); 403 `forbidden` unless the signed-in person is a nurse on the ward's team or the matron over it; 400 `invalid_request` when `staff_id` is not a nurse on the team. It makes no model request.

#### Scenario: Cover nurse takes charge
- **WHEN** at 10:00, signed in as Grace Lee (id 5), `PUT /api/wards/<3A>/in-charge` is sent with `{ staff_id: 5 }`
- **THEN** the response is 200, with `in_charge` Grace Lee and the 3A team
- **AND** `GET /api/wards` shows Grace Lee in charge of 3A and nobody in charge of 5B

#### Scenario: Matron names a nurse
- **WHEN** signed in as Lakshmi Iyer (id 10, matron), Divya Kapoor (id 8) is named in charge of HDU
- **THEN** the response is 200, and HDU's `in_charge` is Divya Kapoor

#### Scenario: Not a nurse on the team
- **WHEN** signed in as Grace Lee (id 5), Nikhil Bose (id 7, HDU team only) or Mohan Das (id 3, an attendant on 5B) is named in charge of 5B
- **THEN** both responses are 400 with `error: invalid_request`, and 5B's `in_charge` is still Grace Lee

#### Scenario: Attendant or nobody
- **WHEN** a request naming Anita Thomas (id 4) in charge of 3A is sent once signed in as Ravi Kumar (id 1, attendant) and once with no session
- **THEN** the responses are 403 with `error: forbidden` and 401 with `error: sign_in_required`, and 3A's `in_charge` is unchanged

#### Scenario: Nurse off the team
- **WHEN** signed in as Nikhil Bose (id 7, nurse on the HDU team only), `PUT /api/wards/<3A>/in-charge` is sent with `{ staff_id: 6 }` (Meera Pillai, a 3A cover nurse)
- **THEN** the response is 403 with `error: forbidden`
- **AND** 3A's `in_charge` is still Anita Thomas, and Meera Pillai is still in charge of 2C

#### Scenario: Unknown ward
- **WHEN** signed in as Grace Lee, `PUT /api/wards/999/in-charge` is sent with `{ staff_id: 5 }`
- **THEN** the response is 404 with `error: not_found`

### Requirement: Assign beds
`PUT /api/wards/:id/assignments` with `{ beds: [{ admission_id, staff_id }] }` SHALL replace the ward's bed assignments for the current shift and return the ward team; each shift starts with none. After the sign-in checks, errors change nothing, in order: 404 (unknown ward); 403 unless the signed-in person is the ward's nurse in charge or the matron over it; 400 for a nurse off the ward's team, a bed of another ward or a bed listed twice. It makes no model request.

#### Scenario: Nurse in charge splits HDU
- **WHEN** at 10:00, signed in as Nikhil Bose (id 7, HDU's nurse in charge), `PUT /api/wards/<HDU>/assignments` is sent with HDU bed 1 to staff 7 and beds 2 and 3 to staff 8
- **THEN** the response is 200, and its `assignments` are exactly those three
- **AND** `GET /api/wards/<HDU>/team` returns the same `assignments`, and the upstream received no request

#### Scenario: Matron assigns
- **WHEN** signed in as Lakshmi Iyer (id 10, matron), 3A bed 1 is assigned to Grace Lee (id 5, 3A cover) and the other 3A beds to Anita Thomas
- **THEN** the response is 200, with 3A bed 1 assigned to staff 5

#### Scenario: Not in charge
- **WHEN** the same HDU request is sent signed in as Divya Kapoor (id 8, on the HDU team, not in charge) and as Ravi Kumar (id 1, attendant)
- **THEN** both responses are 403 with `error: forbidden`, and HDU's assignments are unchanged

#### Scenario: Invalid assignment
- **WHEN** signed in as Nikhil Bose, HDU beds are sent once with bed 1 to Anita Thomas (id 4, not on HDU), once with a 3A bed to Divya Kapoor, and once with HDU bed 1 listed twice
- **THEN** each response is 400 with `error: invalid_request`, and HDU's assignments are unchanged

#### Scenario: Next shift starts unassigned
- **WHEN** HDU's beds were assigned at 10:00 on 2 Nov, and `GET /api/wards/<HDU>/team` is called at 20:00
- **THEN** its `assignments` is empty, and its `in_charge` is null

### Requirement: Decisions need a nurse
When the signed-in staff member is an attendant, approving or rejecting an entry, amending an entry and voiding a meal SHALL get 403 `forbidden` and change nothing (no event, no media unlinked), before the body or the target is checked, so an invalid body or unknown entry also gets 403. Nurses and matrons may do them. Recording entries, levels and meals, uploading media, and adjusting an AI draft before saving it stay open to every role. It makes no model request.

#### Scenario: Attendant approves
- **WHEN** a pending 300 mL urine entry recorded by staff 1 is approved signed in as Sunita Devi (id 2, attendant)
- **THEN** the response is 403 with `error: forbidden`
- **AND** the entry is still pending, and its history holds only `recorded`

#### Scenario: Role checked first
- **WHEN** signed in as Sunita Devi (id 2, attendant), `POST /api/entries/999/review` is sent with `{ action: "approve" }`, and `POST /api/entries/<an approved entry>/amend` with `{ volume_ml: -5 }`
- **THEN** both responses are 403 with `error: forbidden`

#### Scenario: Attendant amends or voids
- **WHEN** an approved 400 mL entry is amended to 350 mL signed in as Mohan Das (id 3)
- **AND** a meal is voided signed in as Ravi Kumar (id 1)
- **THEN** both responses are 403 with `error: forbidden`
- **AND** the entry is still 400 mL, and the meal is not voided

#### Scenario: Refused reject or void keeps media
- **WHEN** signed in as Ravi Kumar (id 1, attendant), a pending photo entry linked to a photo is rejected, and a meal linked to a tray photo is voided
- **THEN** both responses are 403 with `error: forbidden`
- **AND** `GET /api/media/<id>` still returns 200 for the photo and for the tray photo

#### Scenario: Matron approves
- **WHEN** a pending entry is approved signed in as Lakshmi Iyer (id 10)
- **THEN** the response is 200, and `reviewed_by` is `{ id: 10, name: "Lakshmi Iyer", role: "matron" }`

#### Scenario: Attendant records
- **WHEN** signed in as Rekha Gupta (id 9, attendant), a PNG photo is uploaded with `POST /api/admissions/<3A bed>/media` and `kind: photo`, then a 200 mL water entry with `source: photo` linking it is posted for that bed
- **THEN** the responses are 201 and 201, and the entry's `created_by` is Rekha Gupta

#### Scenario: Attendant saves an adjusted draft
- **WHEN** signed in as Ravi Kumar (id 1, attendant), a photo draft the model read as 450 mL is changed to 400 mL on the check screen and saved
- **THEN** `POST /api/admissions/<id>/entries` with `volume_ml: 400` and `source: photo` gets 201, and the entry is pending at 400 mL
- **AND** approving it, still signed in as Ravi Kumar, gets 403 with `error: forbidden`

### Requirement: Pre-team stores
A store file created before ward teams existed SHALL open with its staff, admissions and entries kept, gain the demo staff it lacks, and get team rows only for the demo wards (2C, 3A, 5B, HDU) it already has. No nurse is in charge and no bed is assigned until someone does so. It makes no model request.

#### Scenario: Older demo store
- **WHEN** a store file is opened that has the four demo wards with admissions, staff 1–6 under the old two-role constraint, no team tables, and one entry recorded by staff 1
- **THEN** `GET /api/staff` lists 10 staff, and Anita Thomas has the `wards` 3A then 5B
- **AND** every ward's `in_charge` is null, and every ward team's `assignments` is empty
- **AND** the entry still has `created_by` Ravi Kumar

#### Scenario: Opened again
- **WHEN** that upgraded file is closed and opened a second time
- **THEN** `GET /api/staff` still lists 10 staff with the same `wards`, and the entry still has `created_by` Ravi Kumar
- **AND** the file's `PRAGMA schema_version` is the same before and after the second open

### Requirement: Record access to another ward
`POST /api/wards/:id/access` with `{ reason, password }` SHALL, when the password is the signed-in person's, store the ward, that person, the trimmed reason and the time, and return 201 with the record. After the sign-in checks, errors store nothing, in order: 404 (unknown ward); 400 unless the reason trims to 1–200 characters and a password is given; 401 `invalid_credentials`. Neither is logged; the password is never stored. It makes no model request.

#### Scenario: Grace opens HDU
- **WHEN** at 10:15, signed in as Grace Lee (id 5, wards 5B and 3A), `POST /api/wards/<HDU>/access` is sent with `{ reason: "  Covering HDU during break  ", password: "grace" }`
- **THEN** the response is 201 with the record `{ id, ward_id, created_by, reason, created_at }`: HDU's `ward_id`, `created_by` `{ id: 5, name: "Grace Lee", role: "nurse" }`, `reason: "Covering HDU during break"` and `created_at` 10:15
- **AND** nothing the server wrote to its log contains `Covering HDU` or the password, and no response or stored row contains the password
- **AND** the upstream received no request

#### Scenario: Reason required
- **WHEN** signed in as Grace Lee, access to HDU is posted with `{ password: "grace" }`, with reasons `""`, `"   "` and one of 201 characters (each with `password: "grace"`), and with a reason and no password
- **THEN** each response is 400 with `error: invalid_request`, and HDU has no access record

#### Scenario: Wrong password
- **WHEN** signed in as Grace Lee, `{ reason: "Covering HDU during break", password: "wrong" }` is posted to HDU's access
- **THEN** the response is 401 with `error: invalid_credentials`, HDU has no access record, and no log line contains `wrong`

#### Scenario: Unknown ward or no session
- **WHEN** `{ reason: "Covering HDU during break", password: "grace" }` is posted to `POST /api/wards/999/access` signed in as Grace Lee, and to HDU with no session
- **THEN** the responses are 404 with `error: not_found` and 401 with `error: sign_in_required`, and HDU has no access record
