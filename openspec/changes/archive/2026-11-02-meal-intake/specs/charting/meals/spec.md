# Spec Delta

## Purpose

The food chart beside the fluid chart: meals per admission with the portion eaten, the items and the fluid served with them, who recorded them and how, and voiding a wrong record. The fluid in a meal reaches the fluid chart only as a pending entry a nurse approves. None of it calls a model.

## ADDED Requirements

### Requirement: Record a meal
`POST /api/admissions/:id/meals` SHALL store a meal: `meal` (`breakfast`, `lunch`, `dinner`, `snack`), `portion` eaten (0, 25, 50, 75 or 100), optional `items` (≤ 200 characters) and integer `fluid_ml` (1–5000), `source` (`manual` or `photo`), optional `confidence` and, for photos only, the read evidence. `charted_at`, `late` and `X-Staff-Id` follow the entry rules. It returns 201 with the meal, 400 `invalid_request` or 404 `not_found`, and makes no model request.

#### Scenario: Lunch by hand
- **WHEN** `{ meal: "lunch", portion: 50, items: "rice, dal", source: "manual" }` is posted for bed 1 with `X-Staff-Id: 1`
- **THEN** the response is 201 with `meal: "lunch"`, `portion: 50`, `items: "rice, dal"`, `fluid_ml: null`, `entry_id: null`, `late: false`, `created_by` Ravi Kumar, and the upstream received no request

#### Scenario: Invalid meals
- **WHEN** meals are posted with `portion: 40`, `meal: "brunch"`, `fluid_ml: 0`, `fluid_ml: 150.5`, evidence on a `manual` meal, `charted_at` 25 hours ago, and `X-Staff-Id: 999`
- **THEN** each response is 400 with `error: invalid_request` and no meal is stored

#### Scenario: Unknown admission
- **WHEN** a meal is posted for admission 9999
- **THEN** the response is 404 with `error: not_found`

### Requirement: Meal fluid becomes a pending entry
A meal posted with `fluid_ml` SHALL also create a pending intake entry: category `food`, that volume, the meal's charted time, source and staff, no confidence (so it is never batch-approved), and item `<Meal>: <items>` (or the meal alone) cut to 200 characters. The meal SHALL return its `entry_id` and that entry's `entry_status`. The volume counts in the 24 h totals only once the entry is approved.

#### Scenario: Soup with dinner
- **WHEN** `{ meal: "dinner", portion: 75, items: "soup, roti", fluid_ml: 200, source: "manual" }` is posted for bed 2
- **THEN** the bed's entries include a pending `in` / `food` entry of 200 mL with item `Dinner: soup, roti` and `confidence: null`, the meal's `entry_id` is that entry's id with `entry_status: "pending"`, and the bed's `pending_ml` rises by 200 while `in_ml` is unchanged

#### Scenario: Long items
- **WHEN** a breakfast with 200 characters of items and 100 mL is posted
- **THEN** its entry's item starts with `Breakfast: ` and is exactly 200 characters long

### Requirement: Meals of the last day
`GET /api/admissions/:id/meals` SHALL return the admission's meals charted in the last 24 hours, newest charted first, each with its staff, linked entry status and void details, and `404 not_found` for an unknown admission. It makes no model request.

#### Scenario: Two meals
- **WHEN** a breakfast is charted 6 hours ago, a lunch 1 hour ago and a dinner 25 hours ago for bed 3
- **THEN** the list holds the lunch then the breakfast (marked late), and not the dinner

### Requirement: Void a meal
`POST /api/meals/:id/void` with a `reason` of 3 to 200 characters SHALL mark the meal voided with the time, reason and `X-Staff-Id` staff, keeping the record. If its fluid entry is pending, that entry SHALL be rejected with reason `other` and the void reason as its note; an approved fluid entry stays. Voiding twice SHALL get 409 `already_voided`, an unknown meal 404 `not_found`, a short reason or unknown staff 400 `invalid_request`. It makes no model request.

#### Scenario: Wrong bed
- **WHEN** the dinner with 200 mL soup (pending) is voided with reason `wrong bed` and `X-Staff-Id: 4`
- **THEN** the meal returns `voided_at` set, `void_reason: "wrong bed"`, `voided_by` Anita Thomas, `entry_status: "rejected"`, it is still listed, and the soup entry is rejected with reason `other` and note `wrong bed` by Anita Thomas

#### Scenario: Fluid already approved
- **WHEN** a lunch with 150 mL whose entry a nurse approved is voided with reason `wrong bed`
- **THEN** the meal is voided with `entry_status: "approved"` and the bed's `in_ml` is unchanged

#### Scenario: Void refused
- **WHEN** a voided meal is voided again, meal 9999 is voided, a meal is voided with reason `x`, and a meal is voided with `X-Staff-Id: 999`
- **THEN** the responses are 409 `already_voided`, 404 `not_found`, 400 `invalid_request` and 400 `invalid_request`, and the last two meals are not voided
