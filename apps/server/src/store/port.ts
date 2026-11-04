/**
 * The chart store port: every read and write the routes, domain code and scripts make, each returning a `Promise`
 * (Postgres through Drizzle, `./pg/store.ts`). `now()` stays sync (it is the clock) and so does `watchMediaGone` (it
 * only registers a listener). Times are ISO strings at the edge.
 */
import {
  type Admission,
  type AdmissionSummary,
  type AfterEmptyingInput,
  type AmendInput,
  type BagReading,
  type BagReadingInput,
  type BagReadingResult,
  type CareInput,
  type CareKind,
  type CareOrder,
  type CareReview,
  type DietitianAssignment,
  type Entry,
  type EntryEvent,
  type EntryInput,
  type Meal,
  type AmendMealInput,
  type MealInput,
  type MealKind,
  type Level,
  type LevelInput,
  type LevelResult,
  type MediaRef,
  type SourceKind,
  type RejectReason,
  type Referral,
  type ReferralOutcome,
  type ReferralReason,
  type ReviewAction,
  type BedAssignment,
  type Staff,
  type StaffRef,
  type Totals,
  type UrineSeen,
  type Ward,
  type AcuityLevel,
  type WardAccess,
  type WardSummary,
  type WardTeam,
  type BagDuplicate,
} from '@meniscus/shared'
import type { StoredBagReading } from '../chart/bags.ts'

import type { QualityRow } from '../chart/quality.ts'

import type { ReadRow, StoredRead } from '../ai/read-log.ts'
import type { OutcomeRead } from '../chart/model-accuracy.ts'

export type ReviewResult = { ok: true; entry: Entry } | { ok: false; error: 'not_found' | 'not_pending' }
export type AmendResult =
  | { ok: true; entry: Entry }
  | { ok: false; error: 'not_found' }
  | { ok: false; error: 'not_approved' }
  /** `path` and `message` name what was wrong, for the 400. */
  | { ok: false; error: 'invalid'; path: 'category' | 'iddsi_level' | 'drink'; message: string }
export interface ReviewOptions {
  /** Corrected volume; approve only. */
  volumeMl?: number | undefined
  staffId?: number | null
  /** Reject only. */
  reason?: RejectReason | undefined
  note?: string | null | undefined
}
/** For the credential check only (auth.ts). */
export interface Credentials {
  staff: StaffRef
  password_hash: string | null
}
export type CareResult = { order: CareOrder; created: boolean }
/**
 * For a role outside DIET_TARGET_ROLES (charting/care-plan "Diet targets need a dietitian"), decided inside the write's
 * transaction: on set, the body's raw `kcal` and `protein_g` (absent = null) must equal the active diet's (null when
 * none); on end, the active diet must have no target. Otherwise the result is `'forbidden'` and nothing is written.
 */
export interface KeepTargets {
  kcal: unknown
  protein_g: unknown
}
export type AssignResult = { ok: true; assignment: DietitianAssignment; created: boolean } | { ok: false; error: 'not_found' }
export type HandBackResult = { ok: true; assignment: DietitianAssignment } | { ok: false; error: 'not_assigned' | 'no_dietitian' }
export type CareReviewResult = { ok: true; review: CareReview } | { ok: false; error: 'not_found' | 'already_reviewed' }
export type ReferResult = { ok: true; referral: Referral } | { ok: false; error: 'not_found' | 'referral_open' }
export type AcknowledgeResult = { ok: true; referral: Referral } | { ok: false; error: 'not_found' | 'not_open' }
export type CloseReferralResult = { ok: true; referral: Referral } | { ok: false; error: 'not_found' | 'already_closed' }
/** A referral in progress with its admission (the worklist). */
export interface ReferralInProgress {
  admission: Admission
  referral: Referral
}
export type VoidMealResult = { ok: true; meal: Meal } | { ok: false; error: 'not_found' | 'already_voided' }
export type PhotoResult = 'ok' | 'not_found' | 'not_pending' | 'photo_exists'
export type AfterEmptyingResult = { ok: true; reading: BagReading } | { ok: false; error: 'not_found' | 'closed' }
/** A read's draft is already linked to a record (the read_link primary key); the transaction rolls back. */
export class ReadLinkTaken extends Error {
  constructor() {
    super('already linked')
    this.name = 'ReadLinkTaken'
  }
}

/** Thrown by `addMeal` when another meal already links the served photo (the `meal_served_media` index); nothing is stored. */
export class ServedTaken extends Error {
  constructor() {
    super('served photo already linked')
    this.name = 'ServedTaken'
  }
}

export type AmendMealResult =
  | { ok: true; meal: Meal }
  | { ok: false; error: 'not_found' | 'voided' }
  | { ok: false; error: 'invalid'; path: 'items' | 'reason'; message: string }

/** Thrown by `addBagReading` when the reading repeats `duplicate` and was not confirmed as its repeat; nothing is stored. */
export class Duplicate extends Error {
  readonly duplicate: BagDuplicate
  constructor(duplicate: BagDuplicate) {
    super('duplicate_reading')
    this.duplicate = duplicate
    this.name = 'Duplicate'
  }
}

/** Thrown by `addBagReading` when the saver may not record this reading (an attendant clearing a fall); nothing is stored. */
export class Forbidden extends Error {
  constructor() {
    super('forbidden')
    this.name = 'Forbidden'
  }
}
export interface MediaInput {
  kind: SourceKind
  /** As sniffed from the bytes, never the client's claim. */
  mime: string
  /** Of the bytes already written to the media store (`sha256Hex`); the row keeps only metadata. */
  sha256: string
  size: number
  duration_ms?: number | null
  /** Photos only: the meal a served tray photo was taken for. */
  served_meal?: MealKind | null
}
/** Unlinked uploads are deleted, and no longer served, this long after upload. */
export const MEDIA_UNLINKED_TTL_MS = 24 * 3_600_000

export interface Store {
  /** Whole hospital (by ward code, then bed number), or one ward. */
  admissions(wardId?: number): Promise<Omit<AdmissionSummary, 'alerts' | 'care' | 'devices' | 'acuity' | 'nutrition'>[]>
  /** Wards by code, with census and activity; `beds_with_alerts` is the route's job (alert rules). */
  wards(): Promise<Omit<WardSummary, 'beds_with_alerts'>[]>
  ward(id: number): Promise<Ward | undefined>
  /** Every ward's `default_acuity`, by ward id (charting/acuity). */
  acuityDefaults(): Promise<Map<number, AcuityLevel>>
  admission(id: number): Promise<Admission | undefined>
  /** These admissions, by id, in one query; unknown ids are left out. */
  admissionsIn(ids: readonly number[]): Promise<Map<number, Admission>>
  admissionByToken(token: string): Promise<Admission | undefined>
  /** undefined when the admission does not exist. `charted_at` is trusted (the route checks its range). */
  addEntry(admissionId: number, input: EntryInput, staffId?: number | null): Promise<Entry | undefined>
  entries(admissionId: number): Promise<{ entries: Entry[]; totals: Totals; urine_seen: UrineSeen | null } | undefined>
  /** Entries charted since `since` (default: the last 24 h), any status, newest first (input to alert rules). */
  recent(admissionId: number, since?: number): Promise<Entry[]>
  /** The store's clock (epoch ms). */
  now(): number
  /** Rejecting unlinks the entry's media (deleted with its last link) and drops its evidence. Records an approved, corrected or rejected event. */
  review(entryId: number, action: ReviewAction, opts?: ReviewOptions): Promise<ReviewResult>
  /** Approved entries only; records an amended event. */
  amend(entryId: number, input: AmendInput, staffId?: number | null): Promise<AmendResult>
  /** Oldest first; undefined when the entry does not exist. */
  events(entryId: number): Promise<EntryEvent[] | undefined>
  /** The roster, by id, each with their wards (home first). Never a username or password hash. */
  staff(): Promise<Staff[]>
  /** One roster member, as `staff()` lists them. */
  member(id: number): Promise<Staff | undefined>
  /** Only auth.ts calls this. */
  credentials(username: string): Promise<Credentials | undefined>
  /** The signed-in person's username, to check their password again (break-the-glass). */
  username(staffId: number): Promise<string | null>
  /** The ward's members (home before cover, then by id; every role), nurse in charge and bed assignments this shift. */
  team(wardId: number): Promise<WardTeam | undefined>
  /** Names the nurse in charge of the ward this shift, ending their charge of any other ward. Callers check roles and teams. */
  setInCharge(wardId: number, staffId: number, setBy: number | null): Promise<WardTeam | undefined>
  /** Replaces the ward's bed assignments for this shift. Callers check the beds and nurses. */
  assignBeds(wardId: number, beds: BedAssignment[], setBy: number | null): Promise<WardTeam | undefined>
  /** Break-the-glass record; append-only. */
  recordAccess(wardId: number, staffId: number, reason: string): Promise<WardAccess>
  /** Starts a session ending at the end of the current shift. Only the token's hash is passed in. */
  createSession(tokenHash: string, staffId: number): Promise<void>
  /** The session's staff member, keeping it alive; null (and the row deleted) once it has ended. */
  sessionStaff(tokenHash: string): Promise<Staff | null>
  endSession(tokenHash: string): Promise<void>
  /** A ward's entries charted since `since` (epoch ms), newest charted first, with bed and patient. */
  wardEntries(wardId: number, since: number): Promise<QualityRow[]>
  /** One photo per pending entry that links no media yet; stored as photo media. */
  attachPhoto(entryId: number, mime: string, sha256: string, size: number): Promise<PhotoResult>
  /** `attachPhoto`'s checks alone, with no write: the route runs them before writing the object. */
  photoAllowed(entryId: number): Promise<PhotoResult>
  /** Also calls `fn` after each COMMIT with the hashes of the media rows it deleted (as `onMediaGone`); returns an unsubscribe. */
  watchMediaGone(fn: (shas: string[]) => void): () => void
  /** Bytes on disk of every relation in the store's schema, and the media rows' count and summed size (server/metrics). */
  sizes(): Promise<{ store: { bytes: number }; media: { count: number; bytes: number } }>
  /** The entry's linked photo media; its bytes are in the media store. */
  photo(entryId: number): Promise<MediaRef | undefined>
  /** undefined when the admission does not exist. First deletes unlinked uploads older than 24 h. */
  addMedia(admissionId: number, input: MediaInput, staffId?: number | null): Promise<MediaRef | undefined>
  /** undefined when missing, or unlinked and older than 24 h. */
  media(id: number): Promise<MediaRef | undefined>
  /** True when any media row has this content (the media store's object is still named). */
  hasMediaSha(sha256: string): Promise<boolean>
  /** The same reference as `media` (kept for callers that read only the fingerprint). */
  mediaRef(id: number): Promise<MediaRef | undefined>
  /** True when the media exists (as `media` serves it), belongs to the admission and is of this kind. */
  linkable(mediaId: number, admissionId: number, kind: SourceKind): Promise<boolean>
  /** Whether a labeled copy may be linked: a live photo of this admission, not a served tray photo, that no record links yet. */
  copyLinkable(mediaId: number, admissionId: number): Promise<boolean>
  /** undefined when the admission does not exist. A drop since the last level (24 h) adds a pending intake entry. */
  addLevel(admissionId: number, input: LevelInput, staffId?: number | null): Promise<LevelResult | undefined>
  /** Latest level per jug or bottle (bag readings are not levels). */
  levels(admissionId: number): Promise<Level[] | undefined>
  /**
   * undefined when the admission does not exist. In one transaction: the readings of the bag just before and after the
   * charted time, the fall guard (an emptying or bag change inside a fall's gap needs a DECIDER_ROLES saver, else
   * `Forbidden`), the duplicate check (`Duplicate` unless `confirm_duplicate_of` names the match), then the reading and, when it charts more than 0 mL, its pending output entry. `charted_at` is trusted.
   */
  addBagReading(admissionId: number, input: BagReadingInput, staffId?: number | null): Promise<BagReadingResult | undefined>
  /** A bag reading as returned (its step from its predecessor), with its admission; undefined for any other id. */
  bagReading(id: number): Promise<{ admission_id: number; reading: BagReading } | undefined>
  /** Keeps the after-emptying photo and residual, once, while no later reading of the bag exists. Callers validate the input. */
  afterEmptying(readingId: number, input: AfterEmptyingInput): Promise<AfterEmptyingResult>
  /** The admission's bag readings charted since `since`, plus the newest one before it of each bag; oldest first. */
  bagReadings(admissionId: number, since: number): Promise<StoredBagReading[]>
  /** The same for a ward's admissions (or the whole hospital's), by admission id, in one query. */
  bagReadingsByWard(wardId: number | undefined, since: number): Promise<Map<number, StoredBagReading[]>>
  /** undefined when the admission does not exist. With `fluid_ml`, also a pending food entry. `charted_at` is trusted. */
  addMeal(admissionId: number, input: MealInput, staffId?: number | null): Promise<Meal | undefined>
  /** Charted since `since` (default: the last 24 h), newest first; undefined when the admission does not exist. */
  meals(admissionId: number, since?: number): Promise<Meal[] | undefined>
  /** The same for a ward's admissions (or the whole hospital's), by admission id, in one query. */
  mealsByWard(wardId: number | undefined, since: number): Promise<Map<number, Meal[]>>
  /**
   * The bed's newest photo uploaded with `served_meal` = `meal` (any served meal when null) at or after now −
   * SERVED_TRAY_HOURS that no record links; undefined when none.
   */
  servedPhoto(admissionId: number, meal: MealKind | null): Promise<MediaRef | undefined>
  /** A meal by id, as the meal reads return it. */
  meal(id: number): Promise<Meal | undefined>
  /** Changes portion, items or dishes and keeps the amendment, in one transaction. Callers validate the input's shape. */
  amendMeal(mealId: number, input: AmendMealInput, staffId?: number | null): Promise<AmendMealResult>
  /** Keeps the meal; unlinks its tray and served photos; rejects its fluid entry if still pending. */
  voidMeal(mealId: number, reason: string, staffId?: number | null): Promise<VoidMealResult>
  /**
   * Starts an order of `kind` now and ends the active one at the same instant, in one transaction. A value equal to the
   * active one changes nothing (`created: false`). undefined when the admission does not exist. Callers validate the value.
   */
  setCare<K extends CareKind>(
    admissionId: number,
    kind: K,
    value: CareInput<K>,
    staffId?: number | null,
    opts?: { keepTargets?: KeepTargets },
  ): Promise<CareResult | 'forbidden' | undefined>
  /** Ends the active order of `kind` now; undefined when none is active. `keepTargets`: see KeepTargets. */
  endCare(
    admissionId: number,
    kind: CareKind,
    staffId?: number | null,
    opts?: { keepTargets?: boolean },
  ): Promise<CareOrder | 'forbidden' | undefined>
  /** The admission's active orders, and those ended after `since`, oldest start first. */
  careOrders(admissionId: number, since: number): Promise<CareOrder[]>
  /** The same for a ward's admissions (or the whole hospital's), by admission id, in one query. */
  careOrdersByWard(wardId: number | undefined, since: number): Promise<Map<number, CareOrder[]>>
  /** Every order of the admission, newest start first, at most `limit`. */
  careHistory(admissionId: number, limit: number): Promise<CareOrder[]>
  /** Records the active catheter order's necessity review, once per catheter (its chain) and chart day. */
  reviewCatheter(admissionId: number, staffId?: number | null): Promise<CareReviewResult>
  /** The order's latest review. */
  lastReview(orderId: number): Promise<CareReview | null>
  /** The latest review of any of these orders (a catheter's chain). */
  lastReviewOf(orderIds: readonly number[]): Promise<CareReview | null>
  /** Every catheter order of the admission, oldest start first (the full history `catheterSince` walks). */
  catheterOrders(admissionId: number): Promise<CareOrder[]>
  /** The same for a ward's admissions (or the whole hospital's), by admission id, in one query. */
  catheterOrdersByWard(wardId: number | undefined): Promise<Map<number, CareOrder[]>>
  /** An open referral by `staffId` at now; `referral_open` when one is open or acknowledged. Callers check coverage. */
  refer(admissionId: number, input: { reason: ReferralReason; note: string | null }, staffId: number | null): Promise<ReferResult>
  /** Fills `acknowledged_*` on an open referral. */
  acknowledgeReferral(referralId: number, staffId: number | null): Promise<AcknowledgeResult>
  /** Fills `closed_*`, the outcome and `next_review` on a referral not closed. */
  closeReferral(
    referralId: number,
    input: { outcome: ReferralOutcome; next_review: string | null },
    staffId: number | null,
  ): Promise<CloseReferralResult>
  referral(id: number): Promise<Referral | undefined>
  /** The admission's latest referral of any status. */
  latestReferral(admissionId: number): Promise<Referral | null>
  /** The latest referral of each of a ward's admissions (or the whole hospital's), in one query. */
  latestReferralsByWard(wardId?: number): Promise<Map<number, Referral>>
  /** Referrals open or acknowledged on these wards, each with its admission (one query, then one admission read per row). */
  referralsInProgress(wardIds: number[]): Promise<ReferralInProgress[]>
  /** Wards in some dietitian's `wards` (roles from DIETITIAN_ROLES). */
  coveredWards(): Promise<Set<number>>
  /**
   * Assigns dietitian `staffId` from now, by `byStaffId`, ending any other current assignment at that instant (its
   * `ended_by` is `byStaffId`). The same dietitian again changes nothing (`created: false`). Callers check the roles.
   */
  assignDietitian(admissionId: number, staffId: number, byStaffId: number | null): Promise<AssignResult>
  /**
   * Ends the current assignment now, by `byStaffId`: `not_assigned` when none; `no_dietitian` when a referral is in
   * progress and no dietitian's `wards` include the admission's ward.
   */
  handBack(admissionId: number, byStaffId: number | null): Promise<HandBackResult>
  /** Current assignments of a ward's admissions (or the whole hospital's), by admission id, in one query. */
  currentAssignments(wardId?: number): Promise<Map<number, DietitianAssignment>>
  /** The admission's assignments, newest assigned_at first, at most `limit`. */
  assignmentHistory(admissionId: number, limit: number): Promise<DietitianAssignment[]>
  /** Active diet orders on these wards, by admission id, in one query. */
  activeDiets(wardIds: number[]): Promise<Map<number, CareOrder<'diet'>>>
  /** The admission's diet orders, newest start first, at most `limit`. */
  dietHistory(admissionId: number, limit: number): Promise<CareOrder<'diet'>[]>
  /** The admission's referrals of every status, newest created_at first, at most `limit`. */
  referrals(admissionId: number, limit: number): Promise<Referral[]>
  /** Stores one read of the read log at `now()`; returns its id (charting/model-accuracy). */
  recordRead(row: ReadRow): Promise<number>
  read(id: number): Promise<StoredRead | undefined>
  /** Whether draft `draft` of read `readId` is linked to a record. */
  linked(readId: number, draft: number): Promise<boolean>
  /** Reads made since `since` (of the ward's beds, else all), each with its links and the linked entries' amends. */
  readOutcomeRows(since: number, wardId?: number): Promise<OutcomeRead[]>
  close(): Promise<void>
  /** One transaction. `fn` gets a store bound to it; nothing outside `fn` sees its writes before COMMIT. Nested: a savepoint. */
  tx<T>(fn: (t: Store) => Promise<T>): Promise<T>
  /**
   * s3-media's per-hash lock across connections (design §4.6): one transaction holding
   * `pg_advisory_xact_lock(hashtextextended(sha256, 0))` while `fn` runs, so an upload (PUT, then the row) and a delete
   * (row check, then DELETE) of the same bytes never interleave. `fn` may make the one S3 call; nothing else slow.
   */
  withShaLock<T>(sha256: string, fn: (t: Store) => Promise<T>): Promise<T>
}
