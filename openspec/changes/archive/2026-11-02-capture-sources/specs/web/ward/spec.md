# Spec Delta

## ADDED Requirements

### Requirement: Source preview
Entry details SHALL show the source by kind:
- **Photo:** an outline toggle (on when segmented) and a full-screen view.
- **Recording:** play/pause, elapsed/total time, a scrubber, and timed transcript turns (highlighted while playing, tap to seek, amounts marked).
- **Typed note:** quoted.
- **By hand:** `Entered by hand by <name>`.

Media loads with one `GET /api/media/<id>`. A photo meal's "What the AI read" SHALL show its tray photo. Rejecting SHALL say if the photo or recording is deleted.

#### Scenario: Recording with turns
- **WHEN** a voice entry with `duration_ms` 4200 and the turns 0–1800 ms `bed 4 had a coconut water` and 1900–4100 ms `200 mL` is opened
- **THEN** it shows `0:00 / 0:04` and the turns `0:00 bed 4 had a coconut water` and `0:01 200 mL`, with `200 mL` marked
- **AND** the playing turn at 2.5 s is the second, and tapping the second turn seeks to 1.9 s

#### Scenario: Photo outline
- **WHEN** a segmented photo entry is opened and the outline is turned off
- **THEN** the photo shows no container or liquid outline
- **AND** the full-screen view shows the same photo

#### Scenario: By hand
- **WHEN** an entry entered by hand by Anita Thomas is opened
- **THEN** its source reads `Entered by hand by Anita T.`, and no media is requested

#### Scenario: Tray photo
- **WHEN** a photo lunch with a tray photo is shown on the bed review and "What the AI read" is opened
- **THEN** the tray photo is shown with the read

#### Scenario: Reject a photo entry
- **WHEN** a nurse rejects a pending 450 mL urine entry that has its photo
- **THEN** the reject sheet ends with `Its photo is deleted.`
- **AND** the message after rejecting ends with `Its photo was deleted.`

#### Scenario: Reject a recorded entry
- **WHEN** a nurse rejects a pending 200 mL coconut water entry from a recording
- **THEN** the reject sheet and the message after rejecting both end with `Its recording is deleted once no other entry from it remains.`

#### Scenario: Reject a level drop
- **WHEN** a nurse rejects the pending 400 mL entry from a water jug at 1000 mL (08:00) and then 600 mL (12:00)
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo, since both jug photos stay with their levels

#### Scenario: Reject a typed note
- **WHEN** a nurse rejects a pending 200 mL entry from the typed note `tea 200 ml`
- **THEN** neither the reject sheet nor the message after rejecting mentions a photo or recording

### Requirement: Before and after on the entry
The entry details of a level-drop entry SHALL show the before and after photos side by side. Each photo has its outline, volume and time. Between them is the drop, as `<before> mL → <after> mL · −<drop> mL`.

#### Scenario: Jug drop
- **WHEN** the 400 mL entry from a water jug at 1000 mL (08:00) and then 600 mL (12:00) is opened
- **THEN** it shows the 08:00 photo labelled `1000 mL` and the 12:00 photo labelled `600 mL`, with `1000 mL → 600 mL · −400 mL` between them
