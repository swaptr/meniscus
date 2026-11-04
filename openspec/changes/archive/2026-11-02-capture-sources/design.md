# Design

## Context

How each source is handled today:
- **Photos.**
  - Stored per entry in `photo (entry_id PK, mime, bytes)` through `POST /api/entries/:id/photo`, which runs after the entry is posted.
  - `has_photo` is a column on `entry`.
  - Rejecting an entry clears the photo.
- **Levels.**
  - Levels store no photo or evidence. The intake entry a drop creates carries the after photo, through `saveLevel` → `attachPhoto`, and the after evidence.
- **Voice notes.**
  - The recording goes to `POST /api/ai/voice-note`, which converts it, runs ASR and Spark, and keeps nothing.
  - `NoteEvidence` holds only the transcript.
  - The ASR response has `audioDurationMs` and `turns[{ startMs, endMs, transcript }]` (`packages/meta/src/asr.ts:22-28`), but `turns` is always empty today: `transcribe` defaults to `mode: 'PUSH_TO_TALK'` (`asr.ts:67`) and `voiceNote` sets no mode (`apps/server/src/ai/pipeline.ts:143`). The server drops both fields.
  - The Speech to text docs (https://dev.meta.ai/docs/speech-to-text, and the Voice schemas at https://dev.meta.ai/docs/api-reference/voice/schemas) say `turns` is "Empty in `PUSH_TO_TALK`" and populated with `startMs`/`endMs` in `ENDPOINTING` ("detects speech onset and endpoint, one turn per detected segment") and `DIARIZATION`, for file transcription in the same single `POST /v1/asr/transcribe`. `transcript` is the whole clip in every mode. Mode availability depends on the model; the models page lists native endpointing and turn-level timestamps for Muse Voice Transcribe (`muse-voice-transcribe-1.0`, our `ASR_MODEL` default).
  - The transcribe request has no retention field (`store` or similar) in the docs, and `asr.ts` sends none: only `model`, `audioEncoding`, `mode`, `languageBias` and `keywords`. `store: false` applies to Responses API (Spark) calls only (`packages/meta/src/client.ts:48`).
- **Meals.** Tray photos are not kept.
- **Ward round.** `lib/round.ts` is DOM-free. Its `Reading` holds a `photo: Blob` and a `CaptureReadResult`, and it pumps one read at a time.
- **Upload checks.** `routes/validate.ts` checks image magic bytes (`MAX_IMAGE` 15 MB). Audio is checked only by ffmpeg conversion.

## Types (`packages/shared`)

```ts
/** Ways to feed the chart. Order is display order. Video would be one more entry here, in MEDIA_TYPES, in the server sniffers and in the web registry. */
export const SOURCE_KINDS = ['photo', 'voice'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** Accepted MIME types and size cap per kind (bytes are checked on the server). */
export const MEDIA_TYPES: Record<SourceKind, { mimes: readonly string[]; maxBytes: number }> = {
  photo: { mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: 15 * 1024 * 1024 },
  voice: { mimes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'], maxBytes: 25 * 1024 * 1024 },
}

export interface MediaRef {
  id: number
  kind: SourceKind
  mime: string
  size: number
  duration_ms: number | null
  created_at: string
}

export interface TranscriptTurn {
  start_ms: number
  end_ms: number
  text: string
}
// NoteResult and NoteEvidence (voice): + duration_ms?: number | null; turns?: TranscriptTurn[]

export interface LevelSnapshot {
  id: number
  volume_ml: number
  created_at: string
  media: MediaRef | null
  evidence: PhotoEvidence | null
}

// EntryInput, LevelInput, MealInput: + media_id?: number
// Entry: + media: MediaRef | null; levels: { before: LevelSnapshot | null; after: LevelSnapshot } | null
// Level: + media: MediaRef | null
// Meal:  + media: MediaRef | null
```

`has_photo` stays on `Entry`, computed as `media?.kind === 'photo'`, so existing readers keep working.

## Decisions

**One media table, links on the records.**
- `media (id INTEGER PRIMARY KEY AUTOINCREMENT, admission_id INTEGER NOT NULL REFERENCES admission(id), kind TEXT NOT NULL, mime TEXT NOT NULL, bytes BLOB NOT NULL, size INTEGER NOT NULL, duration_ms INTEGER, created_at INTEGER NOT NULL, created_by INTEGER REFERENCES staff(id)) STRICT`, with an index on `(created_at)` for expiry. `AUTOINCREMENT` means a deleted media id is never reused, so a stale link can never point at another patient's media.
- `entry`, `level` and `meal` each gain `media_id INTEGER REFERENCES media(id)`. Several entries share one recording through equal `media_id`s.
- Rejected alternatives:
  - A per-record blob table (today's `photo`) would duplicate a recording across the entries one note produced.
  - A polymorphic link table would add joins for no gain at three record types.
- A CHECK on `kind` would need an SQLite table rebuild when video lands. Use plain TEXT validated by zod instead, so adding video needs no migration: `kind TEXT NOT NULL`.

**Lifecycle (`store`).**
- `addMedia` inserts the file. Before inserting, it deletes unlinked media older than 24 hours. `media(id)` also refuses to serve an unlinked row older than 24 hours. That covers the case where nothing was uploaded since.
- Rejecting nulls the entry's `media_id` (as `has_photo` is cleared today), and voiding nulls the meal's. Then `gcMedia(ids)`, inside the same transaction and only for the ids just unlinked, deletes each media row that no `entry`, `level` or `meal` links any more. A fresh upload that is not linked yet is never in `ids`, so only expiry removes it.
- "Rejected entries drop their photo" is MODIFIED to say exactly this: the entry is unlinked, and the media goes only with its last link. Its "Reject" scenario and citing test are unchanged (the entry's photo route returns 404, `has_photo: false`, `evidence: null`).
- The level-drop entry links the after level's `media_id`. Rejecting that entry unlinks it from the entry, but the level still holds the jug photo, which stays as the next pair's "before".
- A photo meal's fluid entry links no media; only the meal links the tray. Voiding the meal rejects that pending entry as today, and unlinks and deletes the tray photo.

**Retention.** What is kept, and for how long:
- Media behind a pending or approved entry, a level or an unvoided meal is kept with that record for as long as the store keeps the record. Approved entries are never deleted, so their photos and recordings stay with the chart.
- Levels are never deleted, so every jug or bottle photo and its read evidence stays, including the "before" photo of a pair whose entry was rejected.
- Media goes when its last link goes (reject, void), or 24 hours after upload if never linked.
- README states this (task 4.1).

**Linking validation (route plus store).**
- `media_id` must exist, belong to the record's admission and be linkable. Linkable means:
  - photo media for `source: photo` entries, levels and meals;
  - voice media for `source: voice` entries.
- `text` and `manual` records take no media. A failure is 400 `invalid_request` with `issues: [{ path: 'media_id' }]`.
- This rule is for `media_id` on posts. `POST /api/entries/:id/photo` keeps its live rules (any pending entry, whatever its source, as "Attach a photo" defines today); it only adds 409 `photo_exists` for an entry that already links media of any kind, so a recording is never replaced by a photo.

**Migration (`migrateMedia`, its own step in `openStore`).**
- It runs after `db.exec(SCHEMA)`, not inside `migrate()`. `migrate()` returns early for a pre-ward file with no admissions (`apps/server/src/store/store.ts:769`), so anything placed after that branch would be skipped for such a file.
- `SCHEMA` creates `media` and its `(created_at)` index, and no longer creates `photo`. It indexes none of the new `entry`, `level` or `meal` columns, because on an older file they exist only after `migrateMedia` runs.
- `migrateMedia` adds any missing column (`media_id` on `entry`, `level` and `meal`; `level.evidence`; `entry.level_id` and `prev_level_id`). Then, if the `photo` table exists, in one transaction:
  1. Insert each row into `media` (kind `photo`, the entry's admission, `created_at` of the entry).
  2. Set `entry.media_id`.
  3. Drop `photo`.
- It does not touch `staff` and does not depend on any staff-table rebuild. `media.created_by REFERENCES staff(id)` names the table, so a later rebuild that renames a new table to `staff` keeps it valid.
- Order in `openStore` after this change: `migrate()` → `SCHEMA` → `migrateMedia()` → `seedStaff` → `seed` → `backfill`.

`POST /api/entries/:id/photo` becomes a thin wrapper: create media, then link it to that entry. It keeps its existing status codes, `photo_exists` and `not_pending`. `GET /api/entries/:id/photo` serves the linked photo media.

**Upload route (`routes/media.ts`).**
- `POST /admissions/:id/media`:
  - `bodyLimit` of the largest `MEDIA_TYPES` cap plus 1 MB (26 MB), as `routes/ai.ts` does for audio. Over that, Hono's `bodyLimit` answers 413. Under it, a file over its kind's cap fails the zod size check: 400 `invalid_request`, as an over-15 MB image does on `/api/ai/read` today.
  - zod form `{ file: File, kind: enum(SOURCE_KINDS), duration_ms?: int 0..3_600_000 }`, with `staffHeader` for `created_by`.
- `sniff(kind, bytes)` in `routes/validate.ts` returns the MIME type from magic bytes, or null:
  - Photo: the existing JPEG/PNG/WebP/GIF checks.
  - Voice:
    - WebM `1A45DFA3`
    - Ogg `OggS`
    - MP4/M4A `ftyp` at offset 4
    - WAV `RIFF....WAVE`
    - MP3 `ID3` or `FF Ex`/`FF Fx` frame sync
  - The stored MIME is the sniffed one, never the client's.
- `GET /media/:id` responds with `Cache-Control: no-store`, `Content-Type` and `X-Content-Type-Options` (already global).
- Both routes go under the existing API token middleware.

**Voice timing (`ai/pipeline.ts`).**
- `voiceNote` calls `asr.transcribe({ audio, languageBias, mode: 'ENDPOINTING' })`. `packages/meta` already accepts `mode`, so it is unchanged. ASR and Spark stay at 1 call each; no other mode is tried.
- It maps `audioDurationMs` and `turns` to `duration_ms` and `turns`, trimmed and capped at 200 turns.
- If the model returns no turns, `turns` is `[]`. The viewer then shows the whole transcript as one untimed turn, as it does for voice evidence saved before this change.
- `routes/evidence.ts` NoteEvidence gains optional `duration_ms` (int ≤ 3,600,000) and `turns` (≤ 200, text ≤ 500 each), both strict.

**Levels keep evidence (`store`).**
- `level` gains `evidence TEXT` (JSON) and `media_id`.
- `addLevel` stores both on every level.
- The drop entry gets the after evidence (as now) and `media_id`.
- Entry queries compute `levels` with two LEFT JOINs:
  - `entry.level_id` → the after level (a new column, set when a drop creates the entry);
  - `entry.prev_level_id` → the before level.

**Web registry (`apps/web/src/lib/sources.ts`, DOM-free).**

```ts
interface SourceDef<K extends SourceKind> {
  kind: K
  label: string            // "Photo", "Recording"
  accept: string           // file input accept: 'image/*' | 'audio/*'
  /** Model requests for one read (fast = Spark-only photo mode). */
  requests: (fast: boolean) => number
  /** Classify an imported file, or null if unsupported. */
  matches: (file: { type: string; name: string }) => boolean
}
export const SOURCES: { [K in SourceKind]: SourceDef<K> }
export const sourceOfFile = (f) => SourceKind | null
export const requestsFor = (kinds: SourceKind[], fast: boolean) => number
```

The viewers live in `components/source-view.tsx`, behind a `switch (media.kind)` whose `never` default makes TypeScript flag a missing viewer when a kind is added. Reads stay where they are: `api.read` for photos, `api.voiceNote` for voice, `api.readMeal` for trays. The registry maps a kind to its reader in `lib/round.ts` and on the capture screen.

**Saving (`lib/media.ts`).**
- `uploadOnce(api, admissionId, kind, blob, durationMs)` memoises one upload per source blob per API client. It is a `WeakMap<Api, WeakMap<Blob, Promise<MediaRef | null>>>`, so the drafts of one voice note share one upload, and tests with separate fake clients never share a memo. The app has one `api`.
- A failed upload resolves to null, and that null stays memoised: later drafts of the same note make no second upload. The records are then saved without media, with the "not kept" warning.
- `saveEntry`, `saveLevel` and `saveMeal` take an optional `{ blob, kind, duration_ms }` and call `uploadOnce` first.
- The old `attachPhoto` path is no longer used by the web.

**Round (`lib/round.ts`).** It generalises to:

```ts
type Source = { kind: 'photo'; blob: Blob } | { kind: 'voice'; blob: Blob; duration_ms: number | null }
interface Reading {
  id; bed; source: Source; status: 'waiting' | 'queued' | 'reading' | 'ready' | 'failed' | 'saved'
  volume_ml; result?; evidence?                    // photo: kept at the top level, as before
  voice?: { result: NoteResult; drafts: Pending[] } // when kind = voice
}
```

The photo fields stay at the top level rather than moving under `photo`, so the existing round code and tests keep their shape.

- `onPhoto` is unchanged.
- `onRecording(blob, duration)` joins the current bed, or returns `no_bed`.
- `import(files, decodeQr)` walks the files in order:
  - an image in which `decodeQr` finds a QR code goes through `onPhoto`'s QR branch and is never queued: a bed link switches the bed; a foreign QR (`foreign_qr`) or an unknown bed (`unknown_bed`) is reported, as live "Bed card switches the bed" requires;
  - images with no QR code and recordings are queued as `waiting`;
  - unsupported files and files before any bed card are reported.
- `readWaiting()` turns `waiting` into `queued` and starts the pump.
- `waitingRequests()` returns `requestsFor(kinds of waiting readings, fast)`.
- The pump reads `queued` items one at a time. A photo calls `api.read` (one `POST /api/ai/read`, 3 model requests, or 1 with mode `spark` in fast mode); a voice item calls `api.voiceNote` (one `POST /api/ai/voice-note`, 2 model requests, no mode).
- `autoSavable` stays photo-only.
- `save(id)` for voice uploads once, then posts one entry per draft.
- Live recording reuses `startRecording` from `lib/recorder.ts`.

**Viewers (`components/source-view.tsx`).**
- `SourceView({ entry })` switches between:
  - `levels` → `BeforeAfter`
  - `media.kind === 'photo'` → `PhotoSource`
  - `media.kind === 'voice'` → `VoiceSource`
  - evidence `text` → a quote
  - `manual` → by hand
- Each viewer fetches its media once (`api.media(id)` → Blob → object URL, revoked on unmount). The token-adding proxy and `fetch` apply, which an `<audio src>` would not get.
- `PhotoSource` reuses `PhotoOverlay` with an `outline` toggle. Full screen is a Base UI Dialog that opens with the image fitted to the screen and an "Actual size" toggle for natural size, with pinch zoom from `touch-action: pinch-zoom`.
- `VoiceSource`:
  - A hidden `<audio>` element, a play/pause button (lucide `Play`/`Pause`), a range scrubber, and `m:ss / m:ss` from `formatClock`.
  - The turn list comes from `turns`. When there are none (older evidence, or no turns detected), the whole transcript is one turn.
  - The active turn comes from `turnAt(turns, currentMs)`. Tapping a turn sets `currentTime`.
  - Amounts are marked with the existing `markAmounts`.
- `BeforeAfter` shows two `PhotoSource`s in a `minmax(0,1fr)` two-column grid with the drop line, stacking under 480 px.
- Helpers `turnAt`, `formatClock`, `dropLine`, `sourceOf(entry)` (the viewer and its media id per kind, or `manual` with the recorder's name), `mealSource(meal)` (the tray photo of a photo meal, or null) and `outlineFor(evidence, on, w, h)` (the overlay boxes, or null when off) live in `lib/sources.ts`, so they can be tested. The inline photo and its full-screen view both take the media id from `sourceOf`.
- `EntryDetails` replaces its photo block with `SourceView`. `MealsSection`'s "What the AI read" adds the tray `PhotoSource`. The capture review and the round review use `PhotoSource` and `VoiceSource` from the in-memory blob, with no fetch.

**Demo history.** Synthetic media is attached:
- the existing bag photos;
- jug photos for level pairs, as before-and-after pairs;
- for voice entries, a short generated WAV (a tone of silence and beeps) labelled "synthetic", with turns copied from the stored transcript at even times.

There are no real voices or patients.

## Order with other changes

- Apply order: `urine-colour` → `capture-sources` → `ward-staffing`.
  - `urine-colour` adds `urine_colour` and `urine_rgb` to `entry`. It touches no media, level or meal column, so this change rebases on it with no conflict beyond adjacent `migrate()`/DDL lines.
  - `ward-staffing` is applied after this change. Its staff-table rebuild (`openspec/changes/ward-staffing/design.md:88-96`) goes before `migrate()`; `migrateMedia` stays after `SCHEMA` and depends on neither.
- Files both this change and `ward-staffing` touch, so the second to apply rebases on the first:
  - `apps/server/src/store/store.ts` (`openStore` order, DDL, entry and meal queries);
  - `apps/server/scripts/demo-history.ts`;
  - `apps/web/src/components/entry-details.tsx`;
  - `apps/web/src/components/meals.tsx`;
  - `packages/shared/src/index.ts`;
  - fixtures and test builders, including `apps/web/src/lib/audit-fixtures.ts` and the server's older-store fixtures.

## Risks / Trade-offs

- [Audio is patient data] → It is stored locally only, as photos are, and never logged. It goes upstream only in the one ASR call, which has no retention flag: unlike Spark calls (`store: false`), upstream retention of the audio depends on the team's Meta data-retention setting, not on our request. The stored copy is deleted with its last link (reject) or after 24 hours unlinked; behind an approved entry it is kept with the chart (see Retention).
- [ENDPOINTING not enabled for the configured `ASR_MODEL`] → The docs say mode availability depends on the model. If it is refused, the voice note fails with the mapped error, with no retry and no fallback to another mode. One live voice note (2 model requests), sent only with the user's approval, confirms it before merging (task 2.3).
- [Database size] → A 60-second Opus recording is about 0.5–1 MB, and photos are shrunk to 1280 px. The demo stays small. Production would move blobs to object storage behind the same `media` API.
- [Bulk import of many files spends credits] → Imports wait for an explicit "Read n · k model requests" tap, and the client budget still applies. Nothing reads on import.
- [Client-reported `duration_ms`] → It is display only and bounded. Turns come from the server.
- [Safari `<audio>` with an object URL and WebM] → iOS Safari cannot play WebM/Opus. The recorder already picks the browser's supported type (mp4 on Safari), so recordings play back on the device that made them. Cross-browser playback of WebM on iOS is a known gap. The viewer shows "This browser can't play this recording" with the transcript.

## Migration Plan

Opening a store moves `photo` rows to `media` and adds the nullable columns. Old clients that call `POST /api/entries/:id/photo` keep working. Rollback: the old build expects `photo`, which is gone, so roll back only with a backup of the store file. This is noted in the README.
