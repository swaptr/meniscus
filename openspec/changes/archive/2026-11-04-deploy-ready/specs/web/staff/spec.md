# Spec Delta

## MODIFIED Requirements

### Requirement: Lock when idle
After `IDLE_LOCK_MS` (5 minutes) with no input, the app SHALL cover the screen with a lock reading `Locked · <name> · <role>`, offering "Unlock" (their password, one `POST /api/session`) and "Switch user". Unlocking resumes the screen as it was, unsaved work included. A read in flight finishes behind the lock. A 401 `sign_in_required` while signed in shows the same lock. Nothing is retried, and refreshes pause while locked. It makes no model request.

#### Scenario: Locked after 5 minutes idle
- **WHEN** Anita Thomas is signed in on the 3A dashboard, and her last input was at 10:00
- **THEN** at 10:04:59 the dashboard is shown, and at 10:05 it is covered by `Locked · Anita Thomas · Nurse` with "Unlock" and "Switch user"
- **AND** while locked, the dashboard's 30-second refresh sends no request

#### Scenario: Unlock keeps the draft
- **WHEN** Ravi Kumar has an unsaved 450 mL photo draft at 10:00, the app locks at 10:05, and at 10:40 (after his session has ended) he unlocks with the password `ravi`
- **THEN** the only request is `POST /api/session` with `{ username: "ravi", password: "ravi" }` and no `X-Staff-Id`
- **AND** Ravi Kumar is signed in again, his draft is still held as unsaved, and no `/api/ai` request is sent

#### Scenario: Session ends while working
- **WHEN** saving Ravi Kumar's draft gets 401 `sign_in_required`
- **THEN** the app is locked as Ravi Kumar, the save fails without a second request, and the draft is still held as unsaved
- **AND** after unlocking, the only request is `POST /api/session`, until the draft is saved again

#### Scenario: A refresh after the session ended
- **WHEN** Anita Thomas is signed in on the 3A dashboard, her session has ended on the server, and the 30-second refresh's `GET /api/admissions?ward=2` answers 401 `sign_in_required`
- **THEN** the dashboard is covered by `Locked · Anita Thomas · Nurse`, the refresh is not sent again, and no further request is sent until she unlocks
