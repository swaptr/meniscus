# Design

## Types (packages/shared)

```ts
export const STAFF_ROLES = ['attendant', 'nurse'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export interface Staff { id: number; name: string; role: StaffRole }
export type StaffRef = Staff

export const REJECT_REASONS = ['wrong_bed', 'duplicate', 'unreadable', 'wrong_volume', 'not_given', 'other'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]
export const LATE_ENTRY_MINUTES = 60
export const QUALITY_DAYS = 7

export const EVENT_KINDS = ['recorded', 'approved', 'corrected', 'rejected', 'amended'] as const
export interface EntryEvent {
  kind: (typeof EVENT_KINDS)[number]
  at: string
  by: StaffRef | null
  from_ml: number | null
  to_ml: number | null
  from_category: EntryCategory | null
  to_category: EntryCategory | null
  /** Reject: a RejectReason. Amend: free text. */
  reason: string | null
  note: string | null
}

// Entry gains:
//   recorded_at: string            // when it was saved; created_at is the charted time
//   late: boolean                  // recorded_at - created_at > LATE_ENTRY_MINUTES
//   created_by: StaffRef | null
//   reviewed_by: StaffRef | null
//   approved_ml: number | null     // volume at approval; amendments do not change it
//   amended_at: string | null
//   reject_reason: RejectReason | null
// EntryInput gains charted_at?: string (ISO)
// ReviewInput gains reason?: RejectReason, note?: string | null  (reject only)

export interface AmendInput { volume_ml?: number; category?: EntryCategory; reason: string }

export type QualityFlag = 'corrected' | 'amended' | 'late' | 'rejected'
export interface QualityTotals { entries: number; corrected: number; amended: number; late: number; rejected: number; manual: number }
export interface WardQuality {
  ward: Ward
  since: string
  totals: QualityTotals
  rejected_by_reason: Partial<Record<RejectReason | 'unspecified', number>>
  /** One row per recorder (staff null = not recorded), most entries first. */
  recorders: { staff: StaffRef | null; recorded: number; corrected: number; amended: number; late: number; rejected: number }[]
  /** One row per reviewer, most reviews first. */
  reviewers: { staff: StaffRef | null; reviewed: number }[]
  /** Newest charted first, at most 100. `entry.evidence` is always null here (no transcripts in a ward-wide list). */
  flagged: { entry: Entry; admission_id: number; bed: string; patient: string; flags: QualityFlag[] }[]
}
```

## Server (apps/server)

**Storage (store/store.ts).** New tables:

```sql
CREATE TABLE staff (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('attendant','nurse'))) STRICT;
CREATE TABLE entry_event (
  id INTEGER PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES entry(id),
  kind TEXT NOT NULL CHECK (kind IN ('recorded','approved','corrected','rejected','amended')),
  at INTEGER NOT NULL, staff_id INTEGER REFERENCES staff(id),
  from_ml INTEGER, to_ml INTEGER, from_category TEXT, to_category TEXT, reason TEXT, note TEXT) STRICT;
CREATE INDEX entry_event_entry ON entry_event (entry_id, at, id);
```

New `entry` columns:
- `recorded_at INTEGER NOT NULL`;
- `created_by` and `reviewed_by`, `INTEGER REFERENCES staff(id)`;
- `approved_ml INTEGER`;
- `amended_at INTEGER`;
- `reject_reason TEXT`.

`created_at` keeps its meaning across the code: the charted time, which windows, totals, alerts and ordering already use. A late entry therefore lands in the right hour without touching any query.

**Migration.**
- `migrate()` runs before `SCHEMA` and only adds columns, setting `recorded_at = created_at` for existing rows.
- After `SCHEMA` has created `staff` and `entry_event`, `backfill()` runs once, guarded by "entries exist that have no events". It writes a `recorded` event per such entry, plus an `approved`, `corrected` or `rejected` event at `reviewed_at`, all without staff.
- `seed()` fills the staff table with the demo roster (`demo-hospital.ts`, fictional names) when it is empty.

**Writes.** Every write runs in one `tx` with its events:
- `addEntry` inserts the entry and its `recorded` event;
- `addLevel` does the same for the entry it creates;
- `review` writes `approved_ml`, `reviewed_by` and `reject_reason`, plus an `approved`, `corrected` or `rejected` event;
- `amend` is guarded `WHERE status = 'approved'`. It updates `volume_ml`, `category` and `amended_at`, and inserts an `amended` event with from/to.

**Reads.**
- Entries join staff twice for `created_by` and `reviewed_by`. `late` is computed in `toEntry`.
- `events(entryId)` returns events joined with staff, ordered by `at, id`.

**Quality (store).** One query gets the ward's entries charted since `now - 7 d`, with their admission and staff. The flags and counts are computed in TypeScript (`chart/quality.ts`, pure and tested), never in SQL. `@meniscus/shared` holds types only, so the web mirrors `isCorrected` in `lib/flags.ts`; both are pinned by the same scenarios:
- `corrected` = `approved_ml !== null && approved_ml !== recorded_ml`;
- `amended` = `amended_at !== null`;
- `late` and `rejected` come from the entry;
- `manual` = `source === 'manual'`.

Recorders count entries by `created_by`. Reviewers count entries by `reviewed_by` where `reviewed_at` is set.

**Routes (routes/chart.ts).**
- `staffHeader` middleware on the mutating routes (entries, levels, review, amend):
  - an absent header gives `null`;
  - otherwise the header must match `/^[1-9]\d{0,5}$/` and be on the roster, or the request gets 400 `invalid_request`;
  - the resolved id goes on the context.
  - The header is listed in the CORS allow-list if one exists (same-origin today).
- `EntryBody` gains `charted_at: z.iso.datetime({ offset: true }).optional()`. The route checks the range against `store.now()` and the admission's `admitted_at`, allowing 60 s of clock skew into the future.
- `ReviewBody` gains `reason` and `note`, for reject only (refine).
- `AmendBody`: `{ volume_ml?: Volume, category?: EntryCategory, reason: string.trim().min(3).max(200) }`, strict. The direction check needs the entry, so the store returns `invalid` for a category of the other direction or a no-op change. The route maps that to 400.
- `GET /staff`, `GET /entries/:id/events`, `POST /entries/:id/amend`, `GET /wards/:id/quality`.

## Web (apps/web)

- **`lib/staff.ts`**: the current staff id in `localStorage` (`meniscus.staff`), with a tiny subscribe API for the header. It is DOM-light; storage is injected in tests.
- **`lib/api.ts`**: `call()` takes a `staff` flag. The chart-changing calls (add entry, add level, review, amend, attach photo) set it, and `call()` merges `X-Staff-Id` into the headers (the server checks it on entries, levels, review and amend; the photo upload carries it but the photo is not attributed separately) next to `content-type` when a staff id is set. `/api/ai/*` and reads never carry it. New methods: `staff()`, `events(id)`, `amend(id, body)`, `quality(wardId)`.
- **Stale choice**: the picker loads `GET /api/staff` once per session. If the stored id is not on the roster, it clears the choice.
- **`lib/timeline.ts`** (pure): `timeline(entry, events)` returns `{ time?, kind, text, tone, detail? }[]`.
  - `kind` is one of `capture`, `model`, `check`, `save`, `review`, `amend` or `wait`.
  - Its lines and scenarios are pinned by the specs.
  - Model step labels come from the evidence trace step: `sam:container`, `sam:liquid`, `spark:read`, `asr` and `spark:note`.
  - Container labels come from a shared map. The agreement line uses `agreement()` from `lib/evidence.ts`.
  - An entry is a level entry when its photo evidence reads a `water_jug` or `water_bottle`.
- **`lib/flags.ts`** (pure): `entryFlags(entry)` returns badge `{ tone, text }[]`; `isFlagged(entry)`. `LogFilter` gains `flagged?: boolean`, applied in `filterLog`.
- **`lib/resolve.ts`** (pure over an injected api). `chartedAt` also takes the admission time and returns `{ error: 'Before admission' }` when the time is earlier:
  - `addMissedEntry(api, admissionId, draft, chartedIso)` sends two requests;
  - `saveByHand(api, admissionId, pending, charted)` refuses a `{ error }` time without sending anything;
  - `rejectBody(reason, note)`;
  - `amendBody(entry, volume, category, reason)` returns a body, or null when saving must stay disabled;
  - `chartedAt(hhmm, now, admittedAt)` returns `{ iso }` or `{ error }` and handles the "yesterday" rule.
- **`lib/quality.ts`** (pure): `qualityTiles(totals)` returns `{ label, value, tone }[]`.
- **Components:**
  - `components/staff-picker.tsx`: a header button (initials avatar plus "Name · Role" on wide screens) that opens a dialog listing the roster grouped by role.
  - `components/entry-details.tsx`: loaded lazily, like the QR dialog. It is a dialog (full-height sheet on phones) with the badges, the photo with the overlay and the `EvidencePanel` (from `entry-evidence`), and the timeline, rendered as a vertical rail with icons per kind.
  - `components/resolve.tsx`: the amend, reject-reason and missed-entry dialogs.
- **Routes:**
  - `/n/$id`:
    - log rows and pending cards open the entry details;
    - "Reject" opens the reason dialog;
    - approved rows get "Amend";
    - a header action and the gap prompts offer "Add missed entry".
  - `/n/w/$ward`: a third view, `?view=quality`.
  - `/a/bed/$token`: Enter by hand gets "When?" (Now / earlier time).

## Decisions

- **Header, not body, for staff.** One place (`api.send`) covers every mutating call, including multipart photo upload. The body schemas stay about the entry.
- **No authentication.** The trust model is unchanged from today, where anyone with the API token can chart. The README states that attribution is self-selected in the demo.
- **`created_at` stays the chart time.** Renaming it to `charted_at` everywhere would touch every query and alert rule for no behavioural gain. `recorded_at` is the new column.
- **Late threshold 60 minutes.** This is a common nursing documentation expectation for "contemporaneous". It is a shared constant.
- **Missed entry is two calls, not a special endpoint.** It reuses the record and review rules and their tests. If the approve fails, the entry is left pending and shown, which is visible and recoverable.

- **Ward "last activity"** (`last_entry_at`) is the latest charted time. A late entry does not move it. That is correct for "when was this bed last charted for" and is documented here rather than in a spec.
- **Free text.** Amend reasons and reject notes are staff-entered chart text. Like every request body, they are never logged.
- **Demo history.** The scripted correction goes on 3A bed 1, not 5B bed 4, so the 5B founder-story totals and prompts stay as they are.

## Risks / Trade-offs

- [Self-selected identity can be wrong or spoofed] → It is labelled as demo attribution. Real deployments use SSO.
- [Per-staff counts can feel like blame] → The view is titled "Data quality" with the note "For charting quality, not performance review".
- [Backfilled history has no staff] → It is shown as "staff not recorded".
- [Synthetic evidence in demo history might be read as real model output] → The README states the demo history is synthetic, and the ward list already says "Demo census with fictional patients".

## Migration Plan

`migrate()` adds the columns and the tables, backfills events, and seeds the roster on next start. Rollback: the older build ignores the extra columns and tables.
