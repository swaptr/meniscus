# Spec Delta

## ADDED Requirements

### Requirement: Read result kept as evidence
Saving a photo draft SHALL send its read result as the entry's evidence, keeping the model's own volume when the attendant adjusted it. The evidence holds the mode, reading, segmentation, review reasons, trace and liquid colour. Voice and typed drafts SHALL send the transcript or note text, the model's volume for that draft as `draft_ml`, and the trace. Text is trimmed to the server's bounds, so a long model sentence never loses the entry. Manual entries send no evidence.

#### Scenario: Adjusted photo draft
- **WHEN** a urine bag read as 450 mL is adjusted to 430 mL and saved
- **THEN** the entry request has `volume_ml: 430` and `evidence.kind: photo` with `reading.volume_ml: 450` and the read's segmentation and trace

#### Scenario: Voice draft
- **WHEN** a voice note heard as "bed 4 had coconut water 200 mL" is saved
- **THEN** the entry request has `evidence.kind: voice`, that transcript, `draft_ml: 200`, and the `asr` and `spark:note` trace steps

#### Scenario: Long model text
- **WHEN** the read's `reading_basis` is 900 characters and one review reason is 400 characters
- **THEN** the evidence sent has a `reading_basis` of at most 300 characters and every review reason at most 200, and the entry is saved

### Requirement: Liquid colour sampled from the photo
The capture screen SHALL derive the liquid colour as the mean colour of the liquid box's central half, as `#rrggbb`. The central half is the box inset by 25% of its width and height on each side. It SHALL record no colour when segmentation found no liquid.

#### Scenario: Uniform liquid
- **WHEN** every pixel in the central half of the liquid box is rgb(217, 180, 74) and the rest of the box is black
- **THEN** the colour is `#d9b44a`

#### Scenario: No liquid found
- **WHEN** the read has no liquid box
- **THEN** no colour is recorded

### Requirement: Read summary on the check screen
After a photo read, the check screen SHALL show the number of model calls and the read's wall time as `<n> model calls · <s> s`. It SHALL overlay the segmentation on the preview as in "Segmentation overlay".

#### Scenario: Three calls
- **WHEN** a read returns a trace of three calls and `ms: 6800`
- **THEN** the screen shows `3 model calls · 6.8 s`
