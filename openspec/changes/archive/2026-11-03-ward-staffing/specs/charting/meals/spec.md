# Spec Delta

## MODIFIED Requirements

### Requirement: Void a meal
`POST /api/meals/:id/void` with a `reason` of 3 to 200 characters SHALL mark the meal voided with the time, reason and the signed-in person, keeping the record. If its fluid entry is pending, that entry SHALL be rejected with reason `other` and the void reason as its note; an approved fluid entry stays. Voiding twice SHALL get 409 `already_voided`, an unknown meal 404 `not_found`, a short reason or unknown staff 400 `invalid_request`. It makes no model request.

#### Scenario: Wrong bed
- **WHEN** the dinner with 200 mL soup (pending) is voided with reason `wrong bed` and `X-Staff-Id: 4`
- **THEN** the meal returns `voided_at` set, `void_reason: "wrong bed"`, `voided_by` Anita Thomas, `entry_status: "rejected"`, it is still listed, and the soup entry is rejected with reason `other` and note `wrong bed` by Anita Thomas

#### Scenario: Fluid already approved
- **WHEN** a lunch with 150 mL whose entry a nurse approved is voided with reason `wrong bed`
- **THEN** the meal is voided with `entry_status: "approved"` and the bed's `in_ml` is unchanged

#### Scenario: Void refused
- **WHEN** a voided meal is voided again, meal 9999 is voided, a meal is voided with reason `x`, and a meal is voided with `X-Staff-Id: 999`
- **THEN** the responses are 409 `already_voided`, 404 `not_found`, 400 `invalid_request` and 400 `invalid_request`, and the last two meals are not voided
