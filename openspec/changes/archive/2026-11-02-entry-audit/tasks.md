# Tasks

## 1. Shared types

- [x] 1.1 Add `Staff`, `StaffRef`, `STAFF_ROLES`, `REJECT_REASONS`, `LATE_ENTRY_MINUTES`, `QUALITY_DAYS`, `EntryEvent`, `AmendInput`, `QualityFlag`, `QualityTotals` and `WardQuality` to `packages/shared`. Add the new `Entry`, `EntryInput` and `ReviewInput` fields. Update the `Entry` fixtures in web and server tests. Verify: `pnpm typecheck`.

## 2. Server

- [x] 2.1 Roster, storage, migration and backfill. Tests in `apps/server/src/audit.test.ts`:
  - [charting/audit] Staff roster: "Demo roster".
  - [charting/audit] Entry history: "Pre-history entry".
- [x] 2.2 `X-Staff-Id` middleware plus attribution on entries, levels and review. Tests:
  - [charting/audit] Chart changes are attributed: "Recorded and reviewed", "Unknown staff", "No staff sent", "Level attributed", each with 0 upstream requests.
- [x] 2.3 Events, the reject reason and `GET /entries/:id/events`. Tests:
  - [charting/audit] Entry history: "Unknown entry".
  - [charting/audit] Rejection reason: "Duplicate", "Unknown reason".
- [x] 2.4 Amend. Tests: [charting/audit] Amend an approved entry: "Volume amended", "Not approved", "Invalid amendments"; [charting/audit] Entry history: "Corrected then amended".
- [x] 2.5 `charted_at` and `late`. Tests with an injected clock:
  - [charting/audit] Late entries: "Late drink", "On time", "Out of range", "Before admission".
  - [charting/entries] 24-hour totals: "Late entry counts by its charted time".
  - The existing [charting/entries] Record an entry and 24-hour totals tests stay green under the modified wording.
- [x] 2.6 `chart/quality.ts` and `GET /wards/:id/quality`. Tests: [charting/audit] Ward data quality: "One of each", "Unknown ward".
- [x] 2.7 Demo history: attribute entries to the roster, and script these:
  - a corrected entry (3A bed 1; the 5B story beds stay as they are);
  - an amendment (3A bed 2);
  - a late manual entry (HDU bed 1);
  - a duplicate rejection (2C bed 3);
  - synthetic read evidence (trace, reading, segmentation) on some photo entries.

  Verify: run it against a temp `DATA_DIR`, and the quality endpoint for 3A shows the scripted flagged entries.

## 3. Web: staff and resolving

- [x] 3.1 `lib/staff.ts` plus the `X-Staff-Id` header in `lib/api.ts`. Tests in `apps/web/src/lib/staff.test.ts`: [web/staff] Staff on shift: "Nurse on shift" (header value and label), "Nobody chosen", "Stale choice", "Reads carry no staff id".
- [x] 3.2 `components/staff-picker.tsx` in the app shell header (phone and wide). Verify in the browser.
- [x] 3.3 `lib/resolve.ts`. Tests in `resolve.test.ts`:
  - [web/ward] Resolve from the bed review: "Missed drink", "Reject with a reason", "Gap prompts offer a missed entry", "Amend needs a reason".
  - [web/capture] Late entry by hand: "This morning", "Last night", "Now", "Before admission".

## 4. Web: timeline, flags, quality

- [x] 4.1 `lib/timeline.ts`. Tests in `timeline.test.ts`: [web/ward] Entry timeline: "Corrected photo entry", "Pending voice note", "Jug level", "Late entry, amended", "Rejected duplicate", "Rejected without a reason".
- [x] 4.2 `lib/flags.ts` plus `flagged` in `lib/history.ts`. Tests: [web/ward] Flagged records highlighted: "Badges", "Flagged only".
- [x] 4.3 `lib/quality.ts`. Tests: [web/ward] Data quality view: "Tiles", "Quiet week", "Flagged entry opens its bed".
- [x] 4.4 `components/entry-details.tsx` (lazy) and `components/resolve.tsx`. Wire them into `/n/$id`:
  - rows and pending cards open the details;
  - Reject asks for a reason;
  - Amend on approved rows;
  - "Add missed entry" in the header and on the gap prompts;
  - badges on rows and cards.

  Verify in the browser at 390 and 1100 px.
- [x] 4.5 Data quality view on `/n/w/$ward?view=quality`. Verify in the browser.
- [x] 4.6 "When?" on Enter by hand in `/a/bed/$token`. Verify in the browser.

## 5. Docs and verification

- [x] 5.1 README: the timeline, data quality, fixing records, staff attribution (demo, self-selected) and synthetic demo history. Verify by reading the diff.
- [x] 5.2 `pnpm verify` passes.

## Workflow follow-up

- Apply after `entry-evidence` (needs `recorded_ml`, evidence and `lib/evidence.ts`). Archive after `entry-evidence` is archived.
