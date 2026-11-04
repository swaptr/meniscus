# Spec Delta

## ADDED Requirements

### Requirement: Hospital ward list
The nurse home SHALL list every ward in code order as a card. Each card shows the ward name, `<occupied>/<capacity> beds`, the pending count ("All reviewed" when 0), the beds with prompts ("<n> to review", omitted when 0) and the last activity. Last activity is relative: "just now" under a minute, "<n> min ago" under an hour, "<n> h ago" otherwise, and "No entries today" when there are none.

#### Scenario: Busy ward
- **WHEN** ward 5B has 6 of 6 beds occupied, 3 pending entries, 4 beds with prompts and its last entry 12 minutes ago
- **THEN** its card reads `Neurology Ward 5B`, `6/6 beds`, `3 pending`, `4 to review` and `12 min ago`

#### Scenario: Quiet ward
- **WHEN** ward HDU has 3 of 4 beds occupied, nothing pending, no prompts and no entries in 24 hours
- **THEN** its card reads `3/4 beds`, `All reviewed` and `No entries today`, with no review count

### Requirement: Ward dashboard per ward
Opening a ward SHALL list only that ward's beds, fetched with one `GET /api/admissions?ward=<id>` request and ordered as in "Beds needing attention first".

#### Scenario: Open ward 5B
- **WHEN** the dashboard of the ward with id 3 is loaded
- **THEN** exactly one request is made, `GET /api/admissions?ward=3`
