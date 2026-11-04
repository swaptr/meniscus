# Spec Delta

## ADDED Requirements

### Requirement: Budget refusal offers manual entry
When a read or note is refused with 429 `request_budget_exceeded`, the capture screen SHALL:
- keep the photo or recording;
- for `limit: "hourly"`, say that model reads are used up until the time given by `Retry-After`;
- for `limit: "concurrent"`, say that model reads are busy and can be read again in a few seconds;
- offer Enter by hand at once;
- enable Read again only from the `Retry-After` time, and only on a tap.

Nothing is read without that tap, and no timer sends a request.

#### Scenario: Routine bed refused
- **WHEN** at 10:40 a photo read for 3A bed 4 gets 429 with `limit: "hourly"`, `budget_class: "routine"` and `Retry-After: 1200`
- **THEN** the photo stays on screen with `Model reads for routine beds are used up until 11:00. Enter by hand, or read again from 11:00.`
- **AND** Enter by hand opens the by-hand form for 3A bed 4 at once
- **AND** Read again is disabled until 11:00 and enabled after it
- **AND** no `/api/ai` request is sent until Read again is tapped

#### Scenario: Busy for a moment
- **WHEN** at 10:40:00 a photo read for HDU bed 1 gets 429 with `limit: "concurrent"`, `budget_class: "critical"` and `Retry-After: 5`
- **THEN** the photo stays on screen with `Model reads are busy. Read again in a few seconds, or enter by hand.`, and no "used up until" time
- **AND** Enter by hand opens the by-hand form for HDU bed 1 at once
- **AND** Read again is disabled until 10:40:05 and enabled after it
- **AND** no `/api/ai` request is sent until Read again is tapped
