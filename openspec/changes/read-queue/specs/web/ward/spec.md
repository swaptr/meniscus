# Spec Delta

## MODIFIED Requirements

### Requirement: Batch approve high confidence
"Approve all high-confidence" SHALL approve exactly the pending entries whose confidence is at least 0.75 and that no queued read saved, one review request each, and leave the others pending.

#### Scenario: Queue of four
- **WHEN** the queue holds pending entries at confidence 0.9, 0.75, 0.6 and none (manual)
- **THEN** two review requests are sent, for the 0.9 and 0.75 entries, each with `action: approve`

#### Scenario: Queued read left out
- **WHEN** the queue holds a pending entry at confidence 0.9 saved from a read at the bed, and one at 0.95 with `queued_read: true`
- **THEN** one review request is sent, for the 0.9 entry, and the 0.95 entry stays pending

## ADDED Requirements

### Requirement: Reads on the bed review
The bed review SHALL list the bed's `reads` from its chart read, refreshed by its existing 30 s chart read:
- waiting: `Queued · position <n> · about <HH:MM>`;
- failed: `Read failed (<reason>). Enter by hand or read again.`;
- expired: `Not read within <m> min. Enter by hand.`;
- nothing to chart: `Read found nothing to chart.`;
- not saved: `Read, but not saved: <reason>.`

Read again and Cancel act only on a tap.

#### Scenario: Four reads
- **WHEN** the chart read lists a read waiting at position 2 with `eta` 11:00, one `failed` with `upstream_status: 429`, one routine read `expired`, and one `not_saved` with `error: "duplicate_reading"`
- **THEN** the bed review shows `Queued · position 2 · about 11:00`, `Read failed (model busy). Enter by hand or read again.`, `Not read within 45 min. Enter by hand.` and `Read, but not saved: same as a reading already saved.`
- **AND** no `/api/ai` request is sent while the review refreshes

#### Scenario: Nurse cancels
- **WHEN** Anita Thomas (nurse) taps Cancel on the waiting read
- **THEN** exactly one `POST /api/read-jobs/<id>/cancel` is sent, and the next chart read no longer lists the read

### Requirement: Queued read entries marked
An entry with `queued_read: true` SHALL show `Queued read · check` on the bed review and in its entry details, beside its photo or recording.

#### Scenario: Marked for a look
- **WHEN** a pending 250 mL `water` entry has `queued_read: true` and a photo
- **THEN** its row on the bed review shows `Queued read · check`
- **AND** its entry details show `Queued read · check` and the photo

### Requirement: Waiting reads on bed cards
A bed card SHALL show `<n> read waiting` or `<n> reads waiting` when its `reads_waiting` is above 0, and nothing when it is 0, with no request beyond the dashboard's own.

#### Scenario: Two waiting
- **WHEN** 3A bed 4 has `reads_waiting: 2` and 3A bed 6 has `reads_waiting: 0`
- **THEN** bed 4's card shows `2 reads waiting`, and bed 6's card shows no such chip
- **AND** no request is sent beyond the dashboard's own
