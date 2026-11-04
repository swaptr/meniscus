# Spec Delta

## MODIFIED Requirements

### Requirement: Demo staffing
When the server seeds the demo hospital, it SHALL also seed the ward teams and, for the shift current at seeding, each ward's nurse in charge and bed assignments. Wards 2C, 3A and 5B each get a home nurse and home attendants. Renal HDU gets two home nurses and no attendants, one nurse to two patients on the demo shift. One matron, with no home ward, oversees all four wards, and one dietitian, with no home ward, covers them. It makes no model request.

#### Scenario: Who works where
- **WHEN** `GET /api/staff`, `GET /api/wards` and each ward's `GET /api/wards/:id/team` are called on a fresh store
- **THEN** the home ward (the first of `wards`) of each attendant and nurse is:
  - 2C: Meera Pillai (nurse), Rekha Gupta (attendant)
  - 3A: Anita Thomas (nurse), Ravi Kumar and Sunita Devi (attendants)
  - 5B: Grace Lee (nurse), Mohan Das (attendant)
  - HDU: Nikhil Bose and Divya Kapoor (nurses), no attendant
- **AND** Lakshmi Iyer (matron) has the `wards` 2C, 3A, 5B, HDU
- **AND** Sana Mirza (id 11, dietitian) has the `wards` 2C, 3A, 5B, HDU, and is in no ward's `team`, `in_charge` or `assignments`
- **AND** `in_charge` is Meera Pillai on 2C, Anita Thomas on 3A, Grace Lee on 5B and Nikhil Bose on HDU
- **AND** every occupied bed of 2C, 3A and 5B is assigned to Meera Pillai, Anita Thomas and Grace Lee respectively, and HDU beds 1 and 2 to Nikhil Bose and bed 3 to Divya Kapoor
- **AND** the upstream received no request

### Requirement: Decisions need a nurse
When the signed-in staff member is not a nurse or matron, approving or rejecting an entry, amending an entry and voiding a meal SHALL get 403 `forbidden` and change nothing (no event, no media unlinked), before the body or the target is checked, so an invalid body or unknown entry also gets 403. Nurses and matrons may do them. Recording entries, levels and meals, uploading media, and adjusting an AI draft before saving it stay open to every role. It makes no model request.

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

#### Scenario: Dietitian approves or voids
- **WHEN** signed in as Sana Mirza (id 11, dietitian), a pending 300 mL urine entry is approved, `POST /api/entries/999/review` is sent with `{ action: "approve" }`, and a meal is voided with reason `wrong bed`
- **THEN** each response is 403 with `error: forbidden`
- **AND** the entry is still pending with only `recorded` in its history, and the meal is not voided

## ADDED Requirements

### Requirement: Dietitians cover wards
A dietitian's `wards` SHALL be the wards they cover, none of them a home ward. They are listed in no ward team, cannot be named in charge or assigned beds, and cannot name a nurse in charge or assign beds. It makes no model request.

#### Scenario: Not in the ward team
- **WHEN** `GET /api/wards/<3A>/team` is called on a fresh store
- **THEN** `team` lists exactly Anita Thomas, Grace Lee, Meera Pillai, Ravi Kumar and Sunita Devi, and not Sana Mirza
- **AND** `GET /api/staff` gives Sana Mirza `{ id: 11, name: "Sana Mirza", role: "dietitian" }` with the `wards` 2C, 3A, 5B, HDU

#### Scenario: Not in charge
- **WHEN** signed in as Anita Thomas (id 4), `PUT /api/wards/<3A>/in-charge` is sent with `{ staff_id: 11 }`, and `PUT /api/wards/<3A>/assignments` with 3A bed 1 to staff 11
- **AND** signed in as Sana Mirza (id 11), `PUT /api/wards/<3A>/in-charge` is sent with `{ staff_id: 4 }`, and `PUT /api/wards/<3A>/assignments` with every 3A bed to staff 4
- **THEN** Anita Thomas's two responses are 400 with `error: invalid_request`, and Sana Mirza's are 403 with `error: forbidden`
- **AND** 3A's `in_charge` and `assignments` are unchanged
