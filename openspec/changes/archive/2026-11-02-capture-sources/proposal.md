# Proposal

## Why

Staff feed Meniscus in two ways: photos and voice recordings. Each way is handled differently, which causes three problems.

- **Media is not kept consistently.** A photo is kept only when it produces an entry. A voice recording is never kept, only its transcript. A tray photo is dropped. The jug photo that set the "before" level is thrown away. So a nurse checking an entry often can't see or hear what it came from.
- **Bulk capture is photos only.** The ward round takes photos and nothing else, so a nurse doing a round can't dictate, or import the recordings and photos already on the phone.
- **New sources would be expensive to add.** Video, or anything else, would need its own storage, its own round handling and its own viewer.

## What Changes

- **One way to keep media.**
  - `POST /api/admissions/:id/media` stores one photo or voice recording for a bed and returns a media reference. The file type is checked against its bytes.
  - Entries, levels and meals link to it with `media_id`. A voice note that produced two entries links both to one recording.
  - `GET /api/media/:id` serves it.
  - Rejecting an entry or voiding a meal unlinks its media, which is deleted once nothing links it. Media that is never linked expires after 24 hours.
  - Retention: media behind a pending or approved entry, a level or an unvoided meal is kept with that record for as long as the store keeps it. Levels are never deleted, so every jug or bottle photo stays, and so does the recording behind an approved voice entry.
  - `POST /api/entries/:id/photo` keeps its live rules for any pending entry, whatever its source, and refuses an entry that already links media (409 `photo_exists`).
  - Existing stored photos move into media. `POST`/`GET /api/entries/:id/photo` keep working.
- **Source kinds as data.**
  - `SOURCE_KINDS` (`photo`, `voice`) in `packages/shared`, each with its accepted types and size limit.
  - On the server, each kind has its validator. On the web, each kind has its capture control, its reader, its request count and its viewer.
  - Adding `video` later means adding one kind to each of those. Single-bed capture, bulk capture and every preview then pick it up.
- **Before and after.**
  - Every jug or bottle level keeps its photo and its read evidence, not only the levels that create an entry.
  - An intake entry created by a level drop returns `levels: { before, after }`.
- **Voice timing.** `POST /api/ai/voice-note` asks speech-to-text for mode `ENDPOINTING` in the one request it already makes, which returns timed turns for the uploaded clip ([Speech to text](https://dev.meta.ai/docs/speech-to-text); today's default `PUSH_TO_TALK` returns none). It then also returns the recording's `duration_ms` and the transcript's `turns` with start and end times. Voice evidence keeps them. Still 1 ASR request and 1 Spark request.
- **Upstream retention of audio.** The ASR request has no retention flag (Spark calls send `store: false`; ASR has no equivalent), so upstream retention of the audio follows the team's Meta data-retention setting. This change sends no audio upstream that was not already sent.
- **Tray photo kept.** A meal recorded from a tray photo links the photo. Its fluid entry links none. Voiding the meal drops it.
- **Bulk capture for every source (ward round).**
  - Besides photos, a nurse can record a voice note for the current bed.
  - "Import" takes many photos and recordings at once, in the order selected. A photo of a bed card still switches the bed, and a photo with any other QR code is reported and skipped. Every other photo or recording joins the current bed.
  - Voice readings are read one at a time like photos.
  - The round shows how many model requests its queue will make before reading.
  - Voice readings are never batch-saved. Each one is reviewed.
- **Seeing the source.** The entry details, the meals list, the capture review and the round review show each record's source with one viewer per kind:
  - **Photo:** an outline on/off toggle and a full-screen zoom.
  - **Voice:** a player with a time scrubber and the transcript in timed turns. The current turn is highlighted while playing, tapping a turn seeks to it, and amounts are marked.
  - **Level drop:** the before and after photos side by side, each with its outline, volume and time.
  - **Typed note:** the quoted note.
  - **Entered by hand:** a by-hand label.

Model requests per user action: unchanged.
- Photo read: 3 (1 in Spark-only mode).
- Voice note: 2.
- Tray read: 1.
- A round makes those same counts per queued photo or recording.
- Uploading, serving or linking media: 0.

Changed shapes:
- `packages/shared`:
  - New: `SOURCE_KINDS`, `SourceKind`, `MEDIA_TYPES`, `MediaRef`, `LevelSnapshot`, `TranscriptTurn`.
  - `EntryInput`, `LevelInput` and `MealInput` gain an optional `media_id`.
  - **BREAKING** (the web reads them):
    - `Entry` gains `media: MediaRef | null` and `levels`.
    - `Level` gains `media`.
    - `Meal` gains `media`.
    - `NoteResult` and `NoteEvidence` gain `duration_ms` and `turns`.
- HTTP: new `POST /api/admissions/:id/media` and `GET /api/media/:id`. Entry, level and meal posts accept `media_id`. Entry lists, level results and meal lists return `media`.

### Out of scope

- Video itself. This change makes it one kind to add.
- Before-and-after meal trays (a photo when served). That needs a serving-time capture step and a two-image tray read.
- Routing a bulk recording by the bed number spoken in it. Recordings join the current bed, as photos do.
- Audio waveform rendering. The player shows the time and the turns.
- Streaming with byte ranges. The web fetches the media once and plays it from memory, which also carries the API token.
- Sending media to the model again from storage. Reads still upload the photo or recording with the read request.

## Capabilities

### New Capabilities
- `charting/media`: keeping a record's source media.
  - Upload with type checks.
  - Serving.
  - Linking from entries, levels and meals, including one recording shared by several entries.
  - Deletion with the record and expiry of unlinked media.
  - Migration of stored photos.

### Modified Capabilities
- `charting/photo-evidence`:
  - **Read evidence stored with the entry**: evidence is stored with every level too; the first level's evidence is returned as `levels.before`.
  - **Rejected entries drop their photo**: rejecting unlinks the media, which is deleted once nothing links it.
- `charting/level-pairing`: adds **Before and after**.
- `charting/meals`: adds **Tray photo kept**.
- `capture/notes`: adds **Voice note timing** (ASR mode `ENDPOINTING`).
- `web/capture`:
  - **Photo saved as evidence** is now media upload, then the entry with `media_id`.
  - **Jug photos record levels** and **Meal capture** ("Tray photo"): the media upload comes before the level or meal post.
  - Adds **Recording saved as evidence** and **Tray photo saved with the meal**.
- `web/ward-round`:
  - **One read per photo, in order** now covers photos and recordings.
  - **Save the round** now uploads media and excludes recordings.
  - Adds **Voice in the round**, **Import in bulk** and **Requests before reading**.
- `web/ward`: adds **Source preview** and **Before and after on the entry**.

## Impact

- `packages/shared`: source kinds and media types.
- `apps/server`:
  - Store: `media` table, `media_id` on `entry`, `level` and `meal`, level evidence, migration of the `photo` table.
  - New `routes/media.ts`, and the media magic-byte check in `routes/validate.ts`.
  - Voice-note result timing in `ai/pipeline.ts`.
  - Demo history attaches synthetic media: bag and jug photos, and a short synthetic tone as a stand-in "recording", labelled as made up.
- `apps/web`:
  - New `lib/sources.ts` (the registry) and `lib/media.ts` (upload and save).
  - `lib/round.ts` generalised over source kinds.
  - New `components/source-view.tsx` with the photo, voice and level-pair viewers, plus a lightbox.
  - Changes to the capture screen, round screen, entry details and meals.
- README: sources and bulk import, media retention, the ASR retention note.
- Apply order: after `urine-colour` (adds `urine_colour`/`urine_rgb` to `entry`; unrelated to media) and before `ward-staffing`. Both this change and `ward-staffing` touch `store.ts`, `scripts/demo-history.ts`, `components/entry-details.tsx`, `components/meals.tsx`, `packages/shared` and the fixtures; see design.md "Order with other changes".
- No new dependencies. No new model calls.
