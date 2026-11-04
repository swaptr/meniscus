# Tasks

## 1. Shared types

- [x] 1.1 In `packages/shared`:
  - add `SOURCE_KINDS`, `SourceKind`, `MEDIA_TYPES`, `MediaRef`, `TranscriptTurn` and `LevelSnapshot`;
  - add `media_id?` to `EntryInput`, `LevelInput` and `MealInput`;
  - add `media` and `levels` to `Entry`, and `media` to `Level` and `Meal`;
  - add `duration_ms?` and `turns?` to `NoteResult` and to voice `NoteEvidence`.

  Retype the fixtures and test builders that construct these objects. Verify: `pnpm typecheck`.

## 2. Server

Apply order: after `urine-colour`, before `ward-staffing` (design.md "Order with other changes").

- [x] 2.1 Store:
  - `media` table and index in `SCHEMA`; `photo` no longer in `SCHEMA`;
  - `migrateMedia` as its own step in `openStore`, after `SCHEMA` and outside `migrate()` (which returns early at `store.ts:769`): `media_id` on `entry`/`level`/`meal`, `level.evidence`, `entry.level_id`/`prev_level_id`, then the photo-table move. It touches no `staff` table and does not depend on `ward-staffing`'s rebuild;
  - `addMedia` with expiry, `media(id)`, unlink plus `gcMedia(ids)` in reject and void;
  - level evidence and level snapshots on entries.

  Media `kind` is TEXT validated by zod. These need no new route, so their tests go here:
  - [charting/photo-evidence] Read evidence stored with the entry: update "Level drop keeps evidence" in place in its existing test; "Photo evidence round trip" and "Malformed evidence" stay green unchanged.
  - [charting/photo-evidence] Rejected entries drop their photo: "Reject" stays green unchanged.

  Verify: `pnpm --filter @meniscus/server test` and `pnpm typecheck`.
- [x] 2.2 `routes/media.ts` (upload and serve, `bodyLimit` 26 MB), `sniff` in `routes/validate.ts`, and `media_id` validation on entry, level and meal posts. `POST`/`GET /entries/:id/photo` go through media. Every test that needs `POST /api/admissions/:id/media` or `GET /api/media/:id` is here. Tests in `apps/server/src/media.test.ts`, each asserting 0 upstream requests:
  - [charting/media] Upload media: "Voice recording", "Wrong file", "Unknown bed", "Too large" (a 20 MB JPEG gets 400; a 30 MB body gets 413).
  - [charting/media] Link media to records: "One recording, two entries", "Another bed's media", "Kind mismatch".
  - [charting/media] Serve media: "Recording served", "No such media".
  - [charting/media] Media goes with its record: "Shared recording", "Voided tray".
  - [charting/media] Unlinked media expires: "Never saved", with an injected clock.
  - [charting/media] Stored photos become media: "Older store", with the old file built from the old DDL; "Photo route on other sources".
  - [charting/level-pairing] Before and after: "Jug before and after".
  - [charting/meals] Tray photo kept: "Lunch with its tray" (its fluid entry has `media: null`), "By-hand meal with a photo".

  The existing photo-evidence tests (Attach a photo, Serve the photo, Rejected entries drop their photo) must stay green unchanged.
- [x] 2.3 Voice timing in `ai/pipeline.ts`: pass `mode: 'ENDPOINTING'` to `asr.transcribe` (no change in `packages/meta`), and map `audioDurationMs` and `turns`. `NoteEvidence` bounds in `routes/evidence.ts`. Test in `apps/server/src/ai/ai.test.ts` with a fake ASR returning turns:
  - [capture/notes] Voice note timing: "Two turns". The fake ASR receives `mode: 'ENDPOINTING'`; exactly 1 ASR request and 1 Spark request.

  Live check, only with the user's approval and announced first: one voice note through the running server (2 model requests: 1 ASR, 1 Spark) to confirm the configured `ASR_MODEL` accepts `ENDPOINTING` and returns turns. Never repeated in a loop. Status: not sent yet; awaiting the user's approval. Until it is sent, `ENDPOINTING` is unconfirmed against the live model, and a refusal would fail every voice note.
- [x] 2.4 Demo history: link the bag photos as media; give level pairs before and after jug photos; give voice entries a synthetic WAV with turns. Verify against a fresh temporary `DATA_DIR`:
  - every photo, voice and level-drop entry returns `media`;
  - level drops return `levels`;
  - nothing is sent upstream.

## 3. Web

- [x] 3.1 Library code:
  - `lib/sources.ts`: the `SOURCES` registry, `sourceOfFile`, `requestsFor`, `turnAt`, `formatClock`, `dropLine`.
  - `lib/media.ts`: `uploadOnce`; `saveEntry`, `saveLevel` and `saveMeal` gain the source argument.
  - `lib/api.ts`: `uploadMedia`, `media(id)` returning a Blob.

  - `lib/sources.ts` also: `sourceOf(entry)`, `mealSource(meal)` and `outlineFor(evidence, on, w, h)` (design.md "Viewers").

  Tests in `apps/web/src/lib/sources.test.ts`, `lib.test.ts` and `meals.test.ts`, with exact request sequences through `createApi` and a fake fetch:
  - [web/capture] Photo saved as evidence: update "Save with photo" and "Photo upload fails" in place in their existing tests.
  - [web/capture] Jug photos record levels: update "Water jug reading" in place (`lib.test.ts:131-132`): the sequence becomes `POST /api/admissions/1/media`, then `POST /api/admissions/1/levels` with `media_id`.
  - [web/capture] Meal capture: update "Tray photo" in place (`meals.test.ts:83-86`): `saveMeal` gets the tray blob, and the sequence becomes `/api/ai/meal`, `POST /api/admissions/16/media`, `POST /api/admissions/16/meals` with `media_id`. "Lunch by hand" stays green unchanged.
  - [web/capture] Recording saved as evidence: "Two drafts, one recording"; "Recording not kept", asserting exactly one media request across both drafts.
  - [web/capture] Tray photo saved with the meal: "Lunch from a tray".
  - [web/ward] Source preview:
    - "Recording with turns", through `turnAt` and `formatClock`;
    - "By hand", through `sourceOf`, with no request;
    - "Photo outline", through `outlineFor` (on by default when segmented, null when off) and `sourceOf` (inline and full-screen take the same media id);
    - "Tray photo", through `mealSource` (a photo meal with media gives its tray photo; a manual meal gives null);
    - "Reject a photo entry", "Reject a recorded entry", "Reject a level drop", "Reject a typed note", through `rejectSourceText` (exact sheet and message text per source).

    Drawing the outline and opening the full-screen dialog remain browser checks in 3.3.
  - [web/ward] Before and after on the entry: "Jug drop", through `dropLine`.
- [x] 3.2 `lib/round.ts` over source kinds: `onRecording`, `import`, `readWaiting`, `waitingRequests`; the voice pump; voice save. Tests in `apps/web/src/lib/round.test.ts`:
  - [web/ward-round] One read per photo, in order: the existing scenarios stay green, plus "Photo then recording".
  - [web/ward-round] Save the round: update "Mixed round" in place.
  - [web/ward-round] Voice in the round: "Dictated at bed 2" (exactly one `POST /api/ai/voice-note`), "Record before any card".
  - [web/ward-round] Import in bulk: "Two beds from the gallery", "Foreign QR in an import".
  - [web/ward-round] Requests before reading: "Imported queue".
- [x] 3.3 `components/source-view.tsx`:
  - `SourceView`, with `PhotoSource` (outline toggle and full-screen dialog), `VoiceSource` (player, scrubber, timed turns, active turn, tap to seek, marked amounts) and `BeforeAfter`;
  - a `never`-checked kind switch;
  - lucide icons.

  Wire it into `EntryDetails`, the meals' "What the AI read", the capture review (from the in-memory blob) and the round review. Verify in the browser at 390 and 1100 px, using demo history media only (synthetic). No live model requests:
  - "Photo outline": the outline is drawn and hidden, and the full-screen dialog opens (rendering only; the logic is unit-tested in 3.1);
  - "Tray photo": the tray image renders in "What the AI read" (rendering only; tested through `mealSource` in 3.1);
  - playback and seeking of the synthetic recording.
- [x] 3.4 Round screen: a Record button (current bed), Import (multi-select `image/*,audio/*`), a waiting list with `Read n · k model requests`, voice reading cards with a player and drafts, and fast-mode counts. Verify the import flow in the browser with synthetic files: bed card PNGs from `bed-qr`, synthetic photos and WAVs. Make no read request: check the button text and stop.

## 4. Docs and verification

- [x] 4.1 README:
  - sources and the registry (how to add video);
  - kept media and how it is deleted: reject and void unlink, the last unlink deletes, unlinked uploads expire after 24 hours;
  - retention: level photos, and photos and recordings behind approved entries, are kept with the record for as long as the store keeps it;
  - ASR retention: the speech-to-text request has no `store` flag, so upstream retention of audio follows the team's Meta data-retention setting;
  - bulk import and request counts;
  - the rollback note (back up the store before downgrading).

  Also update the test count.
- [x] 4.2 Bundle check: `source-view` (8.5 KB gzipped) is lazy in entry details, and this change adds about 0.2 KB (`uploadMedia`, `media` in `api.ts`) to the first load. Measured first load: 114.7 KB gzipped (index 78.3 KB unchanged, plus the React, TanStack Router, lucide and api chunks), over the 100 KB budget because of the earlier UI-shell work, not this change. Tracked separately.
- [x] 4.3 `pnpm verify` passes (format, lint, typecheck, tests, specs, traces).
