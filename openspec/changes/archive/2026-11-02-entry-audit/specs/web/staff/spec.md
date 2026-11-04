# Spec Delta

## Purpose

Who is using the app on this device. The user picks themselves from the hospital roster, and every chart change carries their id, so entries and reviews are attributed. This is attribution for the demo, not authentication.

## ADDED Requirements

### Requirement: Staff on shift
The app SHALL let the user pick who they are from the staff roster and keep the choice on the device. The header's staff button SHALL be labelled with their name and role. Every request that changes the chart SHALL carry their id as `X-Staff-Id`. With no choice, or a stored choice no longer on the roster, the button SHALL read "Who's on shift?" and requests SHALL carry no staff id.

#### Scenario: Nurse on shift
- **WHEN** Anita Thomas (id 4, nurse) is chosen and an entry is approved
- **THEN** the staff button's label is `Anita Thomas · Nurse` and the review request carries `X-Staff-Id: 4`

#### Scenario: Nobody chosen
- **WHEN** no one is chosen and an entry is saved
- **THEN** the staff button reads `Who's on shift?` and the entry request has no `X-Staff-Id`

#### Scenario: Stale choice
- **WHEN** the device stored staff id 9 and the roster has no id 9
- **THEN** the stored choice is cleared and the staff button reads `Who's on shift?`

#### Scenario: Reads carry no staff id
- **WHEN** Anita Thomas is chosen and the ward list is loaded
- **THEN** the `GET /api/wards` request has no `X-Staff-Id`
