# Spec Delta

## ADDED Requirements

### Requirement: Next up on the worklist
`/d` SHALL open with a Next up list of at most 3 referrals the dietitian has not acknowledged, oldest first, each reading `<ward>-<bed> · <patient>`, `Referred <time> · <reason>` and how long ago, and opening `/d/<admission id>`, above the worklist's sections and from the same `GET /api/nutrition/worklist`. With none open it is not shown.

#### Scenario: Two open referrals
- **WHEN** at 15:00 the worklist lists 3A bed 6 referred at 14:05 and 3A bed 7 referred at 12:30, neither acknowledged
- **THEN** Next up lists `3A-7 · Hugo Martin` (`Referred 12:30 · Poor intake · 2 h ago`) then `3A-6 · Priya Iyer`, and only `GET /api/nutrition/worklist` was requested

#### Scenario: All acknowledged
- **WHEN** every referral on the worklist is acknowledged
- **THEN** no Next up list is shown
