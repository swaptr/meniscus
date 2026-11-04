export const ENTRY_DIRECTIONS = ['in', 'out'] as const
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number]

export const ENTRY_CATEGORIES = ['water', 'food', 'iv', 'urine', 'stoma', 'drain', 'vomit'] as const
export type EntryCategory = (typeof ENTRY_CATEGORIES)[number]

export const ENTRY_STATUSES = ['pending', 'approved', 'rejected'] as const
export type EntryStatus = (typeof ENTRY_STATUSES)[number]

export const CONTAINER_KINDS = [
  'urinal',
  'urine_bag',
  'stoma_bag',
  'drain_bag',
  'bedpan',
  'commode_pan',
  'emesis_basin',
  'water_jug',
  'water_bottle',
  'cup',
  'measuring_jug',
  'food_tray',
  'other',
  'none',
] as const
export type ContainerKind = (typeof CONTAINER_KINDS)[number]

/** What was drunk, by mouth. Small and fixed so it can be tallied; the specific name lives in the entry's item. */
export const DRINK_KINDS = [
  'water',
  'tea',
  'coffee',
  'milk',
  'juice',
  'coconut_water',
  /** Also lassi, chaas, mattha. */
  'buttermilk',
  /** Oral rehydration solution. */
  'ors',
  /** Nutritional supplement drinks (sip feeds). */
  'supplement',
  'soup',
  'other',
] as const
export type DrinkKind = (typeof DRINK_KINDS)[number]

export const DRINK_LABEL: Record<DrinkKind, string> = {
  water: 'Water',
  tea: 'Tea',
  coffee: 'Coffee',
  milk: 'Milk',
  juice: 'Juice',
  coconut_water: 'Coconut water',
  buttermilk: 'Buttermilk',
  ors: 'ORS',
  supplement: 'Supplement drink',
  soup: 'Soup',
  other: 'Drink',
}

/** Longest drink name kept on a reading or a tray fluid, in UTF-16 code units. */
export const DRINK_NAME_MAX = 40

export const isDrinkKind = (f: string): f is DrinkKind => (DRINK_KINDS as readonly string[]).includes(f)

export const FLUID_KINDS = [
  'urine',
  'water',
  'tea',
  'coffee',
  'milk',
  'juice',
  'coconut_water',
  'buttermilk',
  'ors',
  'supplement',
  'soup',
  'stoma_output',
  'drain_fluid',
  'vomit',
  'other',
  'none',
] as const
export type FluidKind = (typeof FLUID_KINDS)[number]

export const READING_ISSUES = ['no_container', 'no_marks', 'blurry', 'angled', 'occluded', 'foam', 'multiple_containers'] as const
export type ReadingIssue = (typeof READING_ISSUES)[number]

// ---------- urine colour ----------

/** Names nurses chart urine colour with; order is pale → dark, then the review colours. */
export const URINE_COLOURS = ['pale', 'yellow', 'dark', 'orange', 'pink', 'red', 'brown'] as const
export type UrineColour = (typeof URINE_COLOURS)[number]

/** Fill for a colour name when no photo colour exists (notes, corrections, by hand). Display only; not calibrated. */
export const URINE_REFERENCE: Record<UrineColour, string> = {
  pale: '#f2eaa5',
  yellow: '#e9cf4f',
  dark: '#c48a24',
  orange: '#de7a26',
  pink: '#e7a1a9',
  red: '#b3242e',
  brown: '#5c3317',
}

/** A colour as `#rrggbb`, lowercase. */
export const HEX_COLOUR = /^#[0-9a-f]{6}$/

/** The newest coloured, pending or approved urine entry in the last 24 h. */
export interface UrineSeen {
  colour: UrineColour
  /** As photographed; null when the colour came from words. */
  rgb: string | null
  charted_at: string
  status: 'pending' | 'approved'
}

/** Model reading of one photo of a container. */
export interface ContainerReading {
  container: ContainerKind
  fluid: FluidKind
  volume_ml: number | null
  capacity_ml: number | null
  marks_visible: boolean
  reading_basis: string
  appearance: string | null
  /** Urine only: nearest colour name, and the colour as seen (`#rrggbb`). */
  urine_colour?: UrineColour | null
  urine_rgb?: string | null
  confidence: number
  issues: ReadingIssue[]
  /** The specific drink seen (`masala chai`), ≤ DRINK_NAME_MAX; null when not a drink. Absent on evidence stored before drink kinds. */
  drink_name?: string | null
}

/** Segmentation geometry from SAM, in source pixels. */
export interface SegmentBox {
  left: number
  top: number
  right: number
  bottom: number
  confidence?: number
}

export interface Segmentation {
  container: SegmentBox | null
  fluid: SegmentBox | null
  /** Fluid height / container height, 0..1, when both were found. */
  fill_fraction: number | null
  /**
   * The chosen container and liquid SAM masks, packed at MASK_GRID over their boxes, as tray masks are
   * (capture/photo-reading "Masks kept with the segmentation"). Null when that box is null; absent on
   * evidence stored before masks were kept.
   */
  container_mask?: MaskBits | null
  fluid_mask?: MaskBits | null
  /** `liquidVolumeMl(fill_fraction, reading.capacity_ml)`; null without either; absent on older evidence. */
  fluid_volume_ml?: number | null
}

/**
 * The liquid region's share of the container's capacity, to the nearest 10 mL (halves up), or null when
 * the fill or the capacity is unknown ("Liquid region quantity"). 0.463 × 2000 → 930.
 */
export function liquidVolumeMl(fill: number | null | undefined, capacity: number | null | undefined): number | null {
  if (fill == null || capacity == null) return null
  // Round the product to 6 places first so 0.125 × 1000 = 125 rounds up, not down from 124.99999.
  return Math.round(Math.round(fill * capacity * 1e6) / 1e7) * 10
}

export interface DraftEntry {
  direction: EntryDirection
  category: EntryCategory
  volume_ml: number | null
  item: string | null
  notes: string | null
  /** Urine only. `urine_rgb` only from a photo. */
  urine_colour?: UrineColour | null
  urine_rgb?: string | null
  /** Intake only: what was drunk; null for outputs and food that is not a drink. The server always sets it; absent on drafts kept before drink kinds. */
  drink?: DrinkKind | null
}

/** One upstream model call: latency and token usage, for cost/latency visibility. */
export interface CallTrace {
  step: string
  model: string
  ms: number
  input_tokens?: number
  output_tokens?: number
  reasoning_tokens?: number
}

export const READ_MODES = ['spark', 'sam+spark'] as const
export type ReadMode = (typeof READ_MODES)[number]

export interface CaptureReadResult {
  mode: ReadMode
  /** SHA-256 of the image bytes read, lowercase hex. Never logged. */
  image_sha256: string
  reading: ContainerReading
  /** Null when mode is "spark" or SAM failed (see `warnings`). */
  segmentation: Segmentation | null
  /** Suggested chart entry; null when the photo shows nothing chartable. */
  draft: DraftEntry | null
  /** True when the reading should go to manual review instead of one-tap confirm. */
  needs_review: boolean
  warnings: string[]
  trace: CallTrace[]
  ms: number
}

export interface NoteResult {
  transcript?: string
  entries: DraftEntry[]
  /** Model reply when it found nothing to log. */
  reply: string | null
  trace: CallTrace[]
  /** Voice notes: the recording's length, and the transcript in timed turns ([] when none were detected). */
  duration_ms?: number | null
  turns?: TranscriptTurn[]
}

// ---------- sources and kept media ----------

/** Ways to feed the chart. Order is display order. Video would be one more entry here, in MEDIA_TYPES, in the server sniffers and in the web registry. */
export const SOURCE_KINDS = ['photo', 'voice'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** The largest photo the server accepts (uploads and reads) and the web sends: 8 MiB. */
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024
/** `PHOTO_MAX_BYTES` in words, for messages. */
export const PHOTO_MAX_LABEL = '8 MB'

/** Accepted MIME types and size cap per kind (bytes are checked on the server). */
export const MEDIA_TYPES: Record<SourceKind, { mimes: readonly string[]; maxBytes: number }> = {
  photo: { mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], maxBytes: PHOTO_MAX_BYTES },
  voice: { mimes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav', 'audio/mpeg'], maxBytes: 25 * 1024 * 1024 },
}

/** A kept photo or recording (GET /api/media/:id). */
export interface MediaRef {
  id: number
  kind: SourceKind
  mime: string
  size: number
  duration_ms: number | null
  created_at: string
  /** SHA-256 of the stored bytes, lowercase hex; null when none was recorded. */
  sha256: string | null
  /** The meal a served tray photo was taken for; null for any other media. */
  served_meal: MealKind | null
}

/** One timed stretch of a voice note's transcript. */
export interface TranscriptTurn {
  start_ms: number
  end_ms: number
  text: string
}

/** A jug, bottle or bag level as kept: its photo and read evidence. */
export interface LevelSnapshot {
  id: number
  volume_ml: number
  created_at: string
  media: MediaRef | null
  /** The labeled copy kept with `media` (SAM regions drawn in); null when none was kept. */
  labeled_media: MediaRef | null
  evidence: PhotoEvidence | null
  /** Bag readings only; null for jugs and bottles. */
  event: BagEvent | null
  /** An emptying's recorded residual; null for jugs, bottles and when none was recorded. */
  residual_ml: number | null
}

// ---------- charting ----------

/** Which categories belong to which direction. */
export const CATEGORY_DIRECTION = {
  water: 'in',
  food: 'in',
  iv: 'in',
  urine: 'out',
  stoma: 'out',
  drain: 'out',
  vomit: 'out',
} as const satisfies Record<EntryCategory, EntryDirection>

export const ENTRY_SOURCES = ['photo', 'voice', 'text', 'manual'] as const
export type EntrySource = (typeof ENTRY_SOURCES)[number]

export const MAX_ENTRY_ML = 5000

/** Over the last 24 h. in/out/balance count approved entries only. */
export interface Totals {
  in_ml: number
  out_ml: number
  balance_ml: number
  pending_ml: number
}

export interface Admission {
  id: number
  bed: string
  /** Fictional in the demo hospital. */
  patient: string
  weight_kg: number | null
  qr_token: string
  admitted_at: string
  ward_id: number
  ward_code: string
  ward_name: string
  /** Medical record number; fictional in the demo hospital. Never on bed cards. */
  mrn: string
}

export interface Ward {
  id: number
  /** Short code printed on bed cards, e.g. "5B". */
  code: string
  name: string
  specialty: string
  capacity: number
  /** Acuity of the ward's beds that have no acuity order (charting/acuity). */
  default_acuity: AcuityLevel
}

export interface WardSummary extends Ward {
  occupied: number
  /** Pending entries of the last 24 h across the ward's admissions. */
  pending: number
  /** Beds with at least one review prompt. */
  beds_with_alerts: number
  /** Newest entry (any status) in the last 24 h, or null. */
  last_entry_at: string | null
  /** The nurse named in charge for the current shift, or null. */
  in_charge: StaffRef | null
  /** The worst open prompt tone on any of its beds (ALERT_TONE), or null (charting/wards "Ward summary"). */
  worst_tone?: AlertTone | null
  /** Approved volume per rolling hour, oldest first, summed over its admissions. */
  hourly?: { in_ml: number[]; out_ml: number[] }
}

/** Response of GET /api/wards. */
export interface HospitalSummary {
  hospital: string
  wards: WardSummary[]
}

/** 24 rolling hours, oldest first; index 23 = the last 60 minutes (an entry exactly 60 min old is in 22). */
export interface HourlySeries {
  /** Approved volume. */
  in_ml: number[]
  out_ml: number[]
  /** Intake entries that are not rejected (what the logging-gap prompt counts). */
  in_logged: number[]
}

export interface AdmissionSummary extends Admission {
  totals: Totals
  pending: number
  alerts: Alert[]
  hourly: HourlySeries
  urine_seen: UrineSeen | null
  care: CareStatus
  devices: OutputDevices
  acuity: AcuityStatus
  /** Whether a dietitian covers the ward, and the latest referral (charting/nutrition). */
  nutrition: NutritionStatus
  /** Each bag's latest level, from stored bag readings (charting/bag-periods "Bag levels on the bed list"). */
  bag_levels?: BagLevel[]
}

/** A bag's latest reading against its capacity, and when the next urine-bag reading is due. */
export interface BagLevel {
  container: ContainerKind
  level_ml: number
  capacity_ml: number | null
  read_at: string
  /** "Urine bag reading due": later of the newest urine-bag reading and the catheter start, plus the interval; null without a catheter or for stoma and drain bags. */
  due_at: string | null
}

/** Body of POST /api/admissions/:id/entries. */
export interface EntryInput {
  direction: EntryDirection
  category: EntryCategory
  volume_ml: number
  item?: string | null
  notes?: string | null
  source: EntrySource
  confidence?: number | null
  /** What the read produced; must match `source` (none for manual). Client-reported. */
  evidence?: EntryEvidence | null
  /** When the intake or output happened, if earlier than now (a late entry). ISO. */
  charted_at?: string
  /** Urine entries only; `urine_rgb` needs `urine_colour`. */
  urine_colour?: UrineColour | null
  urine_rgb?: string | null
  /** An upload of this admission (POST /api/admissions/:id/media) whose kind matches `source`. */
  media_id?: number
  /** The labeled copy of `media_id`: another photo upload of this admission; needs photo evidence with segmentation. */
  labeled_media_id?: number
  /** `water` entries only. */
  iddsi_level?: IddsiLevel | null
  /** `water` and `food` entries only. */
  drink?: DrinkKind | null
  /** The read this entry was drafted from, and which of its drafts (a note's index; default 0). `read_draft` needs `read_id`. */
  read_id?: number
  read_draft?: number
}

/** A photo read, as kept with the entry it produced. */
export interface PhotoEvidence {
  kind: 'photo'
  mode: ReadMode
  /** The read's image_sha256; must equal the raw media's sha256 when a media_id is posted. Absent on evidence stored before this change. */
  image_sha256?: string
  /** `volume_ml` is the model's own value, before any edit. */
  reading: ContainerReading
  segmentation: Segmentation | null
  review_reasons: string[]
  trace: CallTrace[]
  /** Mean colour of the liquid area, '#rrggbb'; sampled on the phone. */
  colour: string | null
}

/** A voice or typed note, as kept with each entry drafted from it. */
export interface NoteEvidence {
  kind: 'voice' | 'text'
  transcript: string
  /** The model's volume for this entry before any edit. */
  draft_ml: number | null
  trace: CallTrace[]
  /** Voice only: the recording's length and the timed turns. */
  duration_ms?: number | null
  turns?: TranscriptTurn[]
}

export type EntryEvidence = PhotoEvidence | NoteEvidence

/** SAM's fill and the reading's fill must agree within this fraction, or the read goes to review. */
export const READ_AGREEMENT_TOLERANCE = 0.3

export interface Entry {
  id: number
  admission_id: number
  direction: EntryDirection
  category: EntryCategory
  volume_ml: number
  item: string | null
  notes: string | null
  source: EntrySource
  confidence: number | null
  status: EntryStatus
  created_at: string
  reviewed_at: string | null
  /** Linked to photo media (GET /api/entries/:id/photo); same as `media?.kind === 'photo'`. */
  has_photo: boolean
  /** The volume the entry was saved with; a correction on approval does not change it. */
  recorded_ml: number
  evidence: EntryEvidence | null
  /** When it was saved. `created_at` is the charted time, earlier for a late entry. */
  recorded_at: string
  /** Saved more than LATE_ENTRY_MINUTES after its charted time. */
  late: boolean
  created_by: StaffRef | null
  reviewed_by: StaffRef | null
  /** Volume at approval; amendments do not change it. */
  approved_ml: number | null
  amended_at: string | null
  reject_reason: RejectReason | null
  /** Urine only: colour name, and the colour as photographed (null when named in words). */
  urine_colour: UrineColour | null
  urine_rgb: string | null
  /** The photo or recording it came from; null when none was kept. */
  media: MediaRef | null
  /** The labeled copy of `media` (SAM regions drawn in); null when none was kept. */
  labeled_media: MediaRef | null
  /** A level drop's two readings; null for any other entry. */
  levels: { before: LevelSnapshot | null; after: LevelSnapshot } | null
  /** Drinks (`water`) only; null when none was recorded. */
  iddsi_level: IddsiLevel | null
  /** `water` and `food` only: what was drunk; null when none was recorded. */
  drink: DrinkKind | null
}

// ---------- audit (who did what; no model requests) ----------

export const STAFF_ROLES = ['attendant', 'nurse', 'matron', 'dietitian'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

// ── Config surface. Shared constants are the hackathon's configuration (no env, no UI); changing one
// ── is a code change reviewed like any other. MENISCUS_DEMO_LOGIN is the only env var for staffing.

// Role policy: the only place roles are tied to permissions.
// Config item: whether a new role (e.g. nursing associates) may sign off is only its membership of
// DECIDER_ROLES, after adding it to STAFF_ROLES.
/** May approve, reject, amend and void, and name a nurse in charge of a ward they are on. */
export const DECIDER_ROLES: readonly StaffRole[] = ['nurse', 'matron']
/** May be named nurse in charge or assigned beds; listed first in a ward team. */
export const IN_CHARGE_ROLES: readonly StaffRole[] = ['nurse']
/** Their wards are the wards they oversee: not in a ward team; assign beds there. */
export const OVERSEER_ROLES: readonly StaffRole[] = ['matron']
/** Listed in a ward team (GET /api/wards/:id/team), with a home ward. Other roles' wards have no home ward. */
export const TEAM_ROLES: readonly StaffRole[] = ['attendant', 'nurse']
/** Cover wards for nutrition: acknowledge and close referrals, land on /d. Never decide entries. */
export const DIETITIAN_ROLES: readonly StaffRole[] = ['dietitian']
/** May refer a patient to a dietitian. */
export const REFERRER_ROLES: readonly StaffRole[] = ['nurse', 'matron']
/** May set, change or remove a diet's kcal and protein targets, and end a diet that has one. */
export const DIET_TARGET_ROLES: readonly StaffRole[] = DIETITIAN_ROLES

/** Shift pattern, local time, sorted by start. Default 2 × 12 h; e.g. 3 × 8 h is three entries. */
export interface ShiftDef {
  name: string
  /** "HH:MM" */
  start: string
}
export const SHIFTS: readonly ShiftDef[] = [
  { name: 'day', start: '08:00' },
  { name: 'night', start: '20:00' },
]

/** The shift containing `ms`: its local start, the next shift's start, and its name. DST-safe (local-time constructors). */
export function shiftStart(ms: number, shifts: readonly ShiftDef[] = SHIFTS): { start: number; end: number; name: string } {
  const d = new Date(ms)
  const times = shifts.map((s) => {
    const [h = 0, m = 0] = s.start.split(':').map(Number)
    return { name: s.name, h, m }
  })
  // Every shift start from the day before to the day after, in time order.
  const starts: { at: number; name: string }[] = []
  for (const offset of [-1, 0, 1]) {
    for (const t of times) {
      starts.push({ at: new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset, t.h, t.m).getTime(), name: t.name })
    }
  }
  starts.sort((a, b) => a.at - b.at)
  const i = starts.findLastIndex((s) => s.at <= ms)
  const cur = starts[i]!
  return { start: cur.at, end: starts[i + 1]!.at, name: cur.name }
}

// ---------- chart day ----------

/** Limits and targets reset here each day, server local time. By default, the first shift's start. */
export const CHART_DAY_START: string = SHIFTS[0]!.start

/** The chart day containing `ms`: its local start and the next day's start. DST-safe (23 h or 25 h days). */
export function chartDay(ms: number, start: string = CHART_DAY_START): { start: number; end: number } {
  const { start: s, end } = shiftStart(ms, [{ name: 'chart day', start }])
  return { start: s, end }
}

/** Client: lock the screen after this long with no input. */
export const IDLE_LOCK_MS = 5 * 60_000
/** Server: a session ends this long after its last request (and always at the end of its shift). */
export const SESSION_IDLE_MS = 30 * 60_000

/** Who did something: on entries, events, meals, quality rows, in_charge and access records. */
export interface StaffRef {
  id: number
  name: string
  role: StaffRole
}
export interface WardRef {
  id: number
  code: string
}
/** A roster member (GET /api/staff, and the signed-in person). Never carries a username or password hash. */
export interface Staff extends StaffRef {
  /**
   * Home ward first, then cover wards, for TEAM_ROLES. Other roles have no home ward: an overseer's wards are those they
   * oversee, a dietitian's those they cover.
   */
  wards: WardRef[]
}

export interface TeamMember extends StaffRef {
  home: boolean
}
export interface BedAssignment {
  admission_id: number
  staff_id: number
}
/** GET /api/wards/:id/team, and the response of both PUTs below. */
export interface WardTeam {
  ward_id: number
  /** Start of the shift `in_charge` and `assignments` belong to (ISO). */
  shift_start: string
  in_charge: StaffRef | null
  team: TeamMember[]
  assignments: BedAssignment[]
}
/** Body of PUT /api/wards/:id/in-charge. */
export interface InChargeInput {
  staff_id: number
}
/** Body of PUT /api/wards/:id/assignments. Replaces the ward's assignments for the current shift. */
export interface AssignBedsInput {
  beds: BedAssignment[]
}

/** Break-the-glass: someone opened a ward outside their wards. */
export interface WardAccess {
  id: number
  ward_id: number
  created_by: StaffRef
  /** Staff-written, trimmed, 1–200 characters. Stored, never logged. */
  reason: string
  created_at: string
}
/** Body of POST /api/wards/:id/access. The password is checked, never stored or logged. */
export interface WardAccessInput {
  reason: string
  password: string
}

/** Body of POST /api/session. */
export interface SessionInput {
  username: string
  password: string
}
/** 201 of POST /api/session; 200 of GET /api/session. */
export interface SessionInfo {
  staff: Staff
}
export interface DemoAccount {
  username: string
  name: string
  role: StaffRole
  /** Home ward code; null outside TEAM_ROLES (an overseer, a dietitian). */
  ward: string | null
}
/** 401 body of GET /api/session. Other 401 `sign_in_required` bodies are `{ error }` only. */
export interface SignInRequired {
  error: 'sign_in_required'
  hospital: string
  /** Empty unless demo sign-in is on. */
  demo_accounts: DemoAccount[]
}

export const REJECT_REASONS = ['wrong_bed', 'duplicate', 'unreadable', 'wrong_volume', 'not_given', 'other'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

/** An entry saved more than this long after its charted time is late. */
export const LATE_ENTRY_MINUTES = 60
/** Window of the ward data-quality summary. */
export const QUALITY_DAYS = 7

export const EVENT_KINDS = ['recorded', 'approved', 'corrected', 'rejected', 'amended'] as const
export type EventKind = (typeof EVENT_KINDS)[number]

/** One step of an entry's append-only history (GET /api/entries/:id/events). */
export interface EntryEvent {
  kind: EventKind
  at: string
  by: StaffRef | null
  from_ml: number | null
  to_ml: number | null
  from_category: EntryCategory | null
  to_category: EntryCategory | null
  /** Rejected: a RejectReason. Amended: the nurse's free text. */
  reason: string | null
  note: string | null
  /** Amended: the urine colour before and after, when it changed. */
  from_colour: UrineColour | null
  to_colour: UrineColour | null
  /** Amended: the drink's level before and after, when it changed (cleared → null). */
  from_iddsi: IddsiLevel | null
  to_iddsi: IddsiLevel | null
  /** Amended: the drink kind before and after, when it changed (cleared → null). */
  from_drink: DrinkKind | null
  to_drink: DrinkKind | null
  /** Amended: the item before and after, when a new drink kind renamed it to the kind's label. */
  from_item: string | null
  to_item: string | null
}

/** Body of POST /api/entries/:id/amend. */
export interface AmendInput {
  volume_ml?: number
  category?: EntryCategory
  /** Urine entries only; clears `urine_rgb`. */
  urine_colour?: UrineColour
  /** Allowed when the entry is `water` after the amendment. */
  iddsi_level?: IddsiLevel
  /** Allowed when the entry is `water` or `food` after the amendment. */
  drink?: DrinkKind
  reason: string
}

export type QualityFlag = 'corrected' | 'amended' | 'late' | 'rejected'

export interface QualityTotals {
  entries: number
  corrected: number
  amended: number
  late: number
  rejected: number
  manual: number
}

/** Response of GET /api/wards/:id/quality: the ward's entries charted in the last QUALITY_DAYS. */
export interface WardQuality {
  ward: Ward
  since: string
  totals: QualityTotals
  rejected_by_reason: Partial<Record<RejectReason | 'unspecified', number>>
  /** Most entries first; staff null = not recorded. */
  recorders: { staff: StaffRef | null; recorded: number; corrected: number; amended: number; late: number; rejected: number }[]
  /** Most reviews first. */
  reviewers: { staff: StaffRef | null; reviewed: number }[]
  /** Newest charted first, at most 100; `entry.evidence` is always null here. */
  flagged: { entry: Entry; admission_id: number; bed: string; patient: string; flags: QualityFlag[] }[]
}

export interface EntryList {
  admission: Admission
  entries: Entry[]
  totals: Totals
  alerts: Alert[]
  urine_seen: UrineSeen | null
  care: CareStatus
  devices: OutputDevices
  acuity: AcuityStatus
  /** Newest start first, at most CARE_HISTORY_LIMIT; active orders included. */
  care_history: CareOrder[]
  /** The bed's bag periods and reading interval (this read only; the ward list carries none). */
  bags: BagChart
  /** Whether a dietitian covers the ward, and the latest referral (charting/nutrition). */
  nutrition: NutritionStatus
}

/** Response of POST /api/ai/explain. */
export interface Explanation {
  text: string
  trace: CallTrace[]
}

// ---------- model accuracy: the read log and its summary (charting/model-accuracy; no model requests) ----------

/** `tray`: POST /api/ai/meal. */
export const READ_KINDS = ['photo', 'text', 'voice', 'tray'] as const
export type ReadKind = (typeof READ_KINDS)[number]

/** One per draft, or one per read that has none. Display order. */
export const READ_OUTCOMES = [
  'accepted',
  'edited_at_capture',
  'corrected_by_nurse',
  'rejected',
  'pending',
  'open',
  'abandoned',
  /** An unlinked tray draft superseded by a later tray read of the same bed by the same staff member (READ_RETAKE_MINUTES). */
  'retaken',
  'negative_confirmed',
  'negative_overridden',
  'nothing_drafted',
] as const
export type ReadOutcome = (typeof READ_OUTCOMES)[number]

/** Issue codes that make a read negative ("nothing to chart here"), even with a draft. */
export const NEGATIVE_ISSUES = ['no_container', 'not_a_meal'] as const satisfies readonly (ReadingIssue | MealIssue)[]

/** A later tray read by the same staff for the same admission at most this many minutes after an unlinked tray read with a draft makes that read `retaken`. */
export const READ_RETAKE_MINUTES = 10

/** Corrections listed in ModelQuality.top_corrections, at most. */
export const TOP_CORRECTIONS = 5

/** Drafts a tray read has: 1 when its draft names a dish or a fluid volume, else 0. The read log counts with it, and the meal form sends no read_id when it is 0. */
export const trayDrafts = (d: { dishes: readonly unknown[]; fluid_ml: number | null }): 0 | 1 =>
  d.dishes.length > 0 || d.fluid_ml !== null ? 1 : 0

/** A draft unsaved this long after its read is abandoned; links to a read this old are refused. */
export const READ_ABANDON_HOURS = 12
/** A volume this close to the final value counts as right (inclusive), in the ward and in the lab eval. */
export const VOLUME_TOLERANCE_ML = 25
/** Largest `days` GET /api/quality/model accepts. The default is QUALITY_DAYS. */
export const QUALITY_MAX_DAYS = 30
/** Stability rule: a percentage over fewer items is withheld (null); the count is always shown. */
export const MIN_N = 5

/** On every photo, text, voice and tray read response (`read_id` of the stored read). */
export interface ReadRef {
  read_id: number
}
export type Logged<T> = T & ReadRef

/** A share with its count. `pct` is `floor(100 n / of)`, null when `of` < MIN_N. */
export interface Rate {
  n: number
  of: number
  pct: number | null
}

/** Model volume against the final volume, over settled drafts with both. */
export interface VolumeError {
  of: number
  /** Mean absolute error in mL, rounded to the nearest mL; null when `of` < MIN_N. */
  mae_ml: number | null
  /** |error| ≤ VOLUME_TOLERANCE_ML. */
  within: Rate
  /** Settled drafts where the model read no volume and staff entered one. */
  no_volume: number
}

/** Display order, and the tie order of top corrections. */
export const CLASS_TABLES = ['type', 'urine_colour', 'dish_kind'] as const
export type ClassTable = (typeof CLASS_TABLES)[number]

export interface ClassRow {
  /** The model's class as stored: an EntryCategory, a UrineColour or a DishKind, or 'none' (for dishes: not read, added by staff). */
  model: string
  /** Decided drafts with this class. */
  n: number
  /** Settled drafts whose final value equals the model's. */
  kept: Rate
  /** What staff changed it to, most first. */
  corrections: { to: string; n: number }[]
}

export interface KindRow {
  kind: ReadKind
  /** Photo and tray reads only (`sam+spark` | `spark`); null for text and voice. */
  mode: ReadMode | null
  /** Drafts, plus reads with none. */
  drafts: number
  outcomes: Record<ReadOutcome, number>
  /** Over decided drafts (accepted + edited_at_capture + corrected_by_nurse + rejected). */
  accepted: Rate
  /** edited_at_capture + corrected_by_nurse. */
  corrected: Rate
  rejected: Rate
  /** Over decided drafts, from rate(). The Table shows it; the web never recomputes it. */
  edited_at_capture: Rate
  /** Over decided drafts, from rate(). */
  corrected_by_nurse: Rate
  /** A tray row's volume is its meal fluid ("Fluid with a meal"). */
  volume: VolumeError
}

/** What staff did with drafts of photo reads that named this container. Not container truth. */
export interface ContainerRow {
  /** The model's read, `none` included. */
  container: ContainerKind
  reads: number
  /** accepted + edited_at_capture + corrected_by_nurse + rejected. */
  decided: number
  accepted: Rate
  /** edited_at_capture + corrected_by_nurse. */
  corrected: Rate
  rejected: Rate
  volume: VolumeError
}

/** Portions compared in quarters (25 points). */
export interface PortionAgreement {
  /** Pairs with both portions known. */
  of: number
  exact: Rate
  /** At most one quarter apart, exact included. */
  within_quarter: Rate
  /** Pairs 0, 1, 2, 3 and 4 quarters apart. */
  quarters_off: [number, number, number, number, number]
}

export interface MealFluidScore {
  /** Drafted fluid mL against the fluid entry's final volume. `no_volume`: no fluid drafted, one charted. */
  volume: VolumeError
  /** A fluid drafted, none charted at the end (no entry, or its entry rejected). */
  removed: number
}

/** Drafts of reads that are not negative, across every kind. */
export interface Positives {
  /** accepted + edited_at_capture + corrected_by_nurse, over kept + not kept. */
  kept: Rate
  /** rejected + abandoned, over the same. */
  not_kept: Rate
  rejected: number
  abandoned: number
  /** Retaken drafts of the same reads, counted in neither rate. */
  retaken: number
}

export interface TopCorrection {
  table: ClassTable
  from: string
  to: string
  n: number
}

/** Response of GET /api/quality/model. No patient, bed, MRN, staff or dish name anywhere (`ward` is the ward, with its name). */
export interface ModelQuality {
  /** Null for the whole hospital. */
  ward: Ward | null
  since: string
  days: number
  min_n: number
  tolerance_ml: number
  /** Always six rows: photo sam+spark, photo spark, text, voice, tray sam+spark, tray spark. */
  kinds: KindRow[]
  /** Rows by the model's class, sorted by n descending, then by class. Dishes: `none` = not read (added by staff); a `to` of `none` = removed. */
  classes: Record<ClassTable, ClassRow[]>
  /** Drafted drink kind against the entry's final `drink` (`none` when it has none); DRINK_KINDS order. Not in top_corrections. */
  drink_kind: ClassRow[]
  /** Entries, levels and bag readings; never meal fluid. */
  volume: VolumeError
  /** Most reads first, then CONTAINER_KINDS order. */
  containers: ContainerRow[]
  dish_portion: PortionAgreement
  meal_portion: PortionAgreement
  meal_fluid: MealFluidScore
  positives: Positives
  /** At most TOP_CORRECTIONS: n descending, then CLASS_TABLES order, then from, then to. */
  top_corrections: TopCorrection[]
  negatives: {
    /** Over confirmed + overridden. */
    confirmed: Rate
    overridden: Rate
    /** What staff saved instead: an EntryCategory (a jug level counts as `water`, a bag reading as BAG_CATEGORY of its bag), or `meal` (a negative tray read whose meal stands). */
    overridden_as: { to: string; n: number }[]
    /** Reads with no draft and no negative issue. Not a negative. */
    nothing_drafted: number
  }
}

export const REVIEW_ACTIONS = ['approve', 'reject'] as const
export type ReviewAction = (typeof REVIEW_ACTIONS)[number]

/** Body of POST /api/entries/:id/review. */
export interface ReviewInput {
  action: ReviewAction
  /** Corrected volume; approve only. */
  volume_ml?: number
  /** Reject only. */
  reason?: RejectReason
  /** Reject only; up to 200 characters. */
  note?: string | null
}

// ---------- alerts (rule-based; "review", never diagnosis) ----------

export const ALERT_KINDS = [
  'low_urine_output',
  'mismatch',
  'intake_incomplete',
  'overload',
  'logging_gap',
  'appearance',
  // care plan
  'nil_by_mouth_intake',
  'nil_by_mouth_overdue',
  'drink_too_thin',
  'drink_consistency_unrecorded',
  'fluid_limit_near',
  'fluid_limit_reached',
  'intake_target_behind',
  'catheter_review',
  // bag readings
  'bag_reading_due',
  'bag_reading_overdue',
  'bag_level_fell',
  'bag_nearly_full',
  'bag_without_device',
  // nutrition (charting/nutrition); not a record kind
  'poor_meal_intake',
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/** A prompt's tone: red, amber or blue (web/ward colours prompts by it; a ward's `worst_tone` takes the worst). */
export type AlertTone = 'danger' | 'warn' | 'info'

/**
 * Severity of each prompt: red when output may be falling, intake was charted while nil by mouth, a drink was thinner
 * than ordered, a fluid limit is reached or a bag reading is overdue; blue for checks; amber for the rest. Shown with its label, never alone.
 */
export const ALERT_TONE: Record<AlertKind, AlertTone> = {
  low_urine_output: 'danger',
  mismatch: 'danger',
  intake_incomplete: 'info',
  overload: 'warn',
  logging_gap: 'warn',
  appearance: 'warn',
  nil_by_mouth_intake: 'danger',
  drink_too_thin: 'danger',
  fluid_limit_reached: 'danger',
  fluid_limit_near: 'warn',
  nil_by_mouth_overdue: 'warn',
  intake_target_behind: 'warn',
  drink_consistency_unrecorded: 'warn',
  catheter_review: 'info',
  bag_reading_overdue: 'danger',
  bag_reading_due: 'warn',
  bag_level_fell: 'warn',
  bag_nearly_full: 'warn',
  bag_without_device: 'warn',
  poor_meal_intake: 'warn',
}

/** The worst of some prompt tones (danger, then warn, then info), or null when there are none. */
export function worstTone(tones: Iterable<AlertTone>): AlertTone | null {
  const rank: Record<AlertTone, number> = { info: 1, warn: 2, danger: 3 }
  let worst: AlertTone | null = null
  for (const t of tones) if (worst === null || rank[t] > rank[worst]) worst = t
  return worst
}

/** Prompts about particular records, which the web badges. */
export const RECORD_ALERT_KINDS = ['nil_by_mouth_intake', 'drink_too_thin', 'drink_consistency_unrecorded', 'bag_level_fell'] as const
export type RecordAlertKind = (typeof RECORD_ALERT_KINDS)[number]

export const ALERT_RULES = {
  /** mL per kg per hour, over `lowOutputWindowH`. */
  lowOutputMlPerKgH: 0.5,
  lowOutputWindowH: 6,
  /** Approved 24 h intake that counts as "adequately logged". */
  adequateIntakeMl: 1500,
  overloadBalanceMl: 1500,
  loggingGapH: 3,
} as const

// ---------- acuity (charting/acuity; "review", never applied) ----------

/** How closely a bed must be watched, highest first. */
export const ACUITY_LEVELS = ['critical', 'watch', 'stable'] as const
export type AcuityLevel = (typeof ACUITY_LEVELS)[number]
/**
 * Prompt kinds that suggest a higher level (charting/acuity "Suggested acuity").
 * Closed lists: a new kind suggests nothing until named here.
 */
export const ACUITY_SUGGEST = {
  critical: ['low_urine_output', 'overload', 'fluid_limit_reached', 'nil_by_mouth_intake'],
  watch: ['logging_gap', 'appearance', 'fluid_limit_near', 'intake_target_behind'],
} as const satisfies Record<'critical' | 'watch', readonly AlertKind[]>

/** On GET /api/admissions items and GET /api/admissions/:id/entries. */
export interface AcuityStatus {
  /** The active acuity order's level, else the ward's default. */
  level: AcuityLevel
  source: 'order' | 'ward'
  order_id: number | null
  /** Only ever higher than `level`; never stored, never applied. Raises the dashboard group and the budget class. */
  suggested: AcuityLevel | null
  /** Only the bed's alert kinds from ACUITY_SUGGEST[suggested], in alert order; [] when suggested is null. */
  reasons: AlertKind[]
}

/** 429 body of a model action refused by the local budget (model-api/http-errors "Local budget refusal"). */
export interface BudgetRefusal {
  error: 'request_budget_exceeded'
  message: string
  retryable: true
  limit: 'hourly' | 'concurrent'
  budget_class: 'critical' | 'routine'
  retry_after_ms: number
}

/** 422 body of a voice note over the speech-to-text limit (capture/notes "Recording length limit"); nothing was sent. */
export interface AudioTooLong {
  error: 'audio_too_long'
  message: string
  retryable: false
  /** The clip's length in whole ms, measured from its WAV data. */
  duration_ms: number
  limit_ms: 600000
}

/** Discriminated on `kind`: record prompts always carry both id lists (possibly []), the others never do. */
export type Alert =
  | { kind: Exclude<AlertKind, RecordAlertKind>; message: string }
  | { kind: RecordAlertKind; message: string; entry_ids: number[]; meal_ids: number[] }

// ---------- care plan (orders a nurse records; prompts say "review", never diagnose) ----------

/**
 * Order kinds, in display order (acuity first, as it governs monitoring; then safety-critical first). Adding one is a compile error until the server's
 * CARE_VALUE and CARE_RULES, and the web's CARE_BADGE, CARE_ROW, CARE_HISTORY_TEXT and CARE_FORMS, have it.
 */
export const CARE_KINDS = [
  'acuity',
  'nil_by_mouth',
  'thickened_fluids',
  'fluid_limit',
  'intake_target',
  'catheter',
  // output devices (charting/care-plan "Output device orders")
  'stoma',
  'drain',
  'voiding',
  'diet',
] as const
export type CareKind = (typeof CARE_KINDS)[number]
export const CARE_LABEL: Record<CareKind, string> = {
  acuity: 'Acuity',
  nil_by_mouth: 'Nil by mouth',
  thickened_fluids: 'Thickened fluids',
  fluid_limit: 'Fluid limit',
  intake_target: 'Intake target',
  catheter: 'Catheter',
  stoma: 'Stoma',
  drain: 'Drain',
  voiding: 'Urine collection',
  diet: 'Diet',
}

export const FLUID_SCOPES = ['oral', 'total'] as const
export type FluidScope = (typeof FLUID_SCOPES)[number]
/** Which intake categories each scope counts. An intake target counts `oral`. */
export const SCOPE_CATEGORIES: Record<FluidScope, readonly EntryCategory[]> = {
  oral: ['water', 'food'],
  total: ['water', 'food', 'iv'],
}

export const CATHETER_TYPES = ['urethral', 'suprapubic'] as const
export type CatheterType = (typeof CATHETER_TYPES)[number]
/** Bag reading intervals a catheter order may set, in hours. */
export const MEASURE_EVERY_H = [1, 2, 4, 6, 8, 12] as const
export type MeasureEveryH = (typeof MEASURE_EVERY_H)[number]

/** Output device order values (charting/care-plan "Output device order values"). */
export const STOMA_TYPES = ['colostomy', 'ileostomy'] as const
export type StomaType = (typeof STOMA_TYPES)[number]
export const DRAIN_SITES = ['abdominal', 'chest', 'pelvic', 'wound'] as const
export type DrainSite = (typeof DRAIN_SITES)[number]
/** How a patient without a catheter passes urine; `urinal` is the default with no order. */
export const VOIDING_METHODS = ['urinal', 'bedpan', 'commode', 'toilet', 'pads'] as const
export type VoidingMethod = (typeof VOIDING_METHODS)[number]
/** Voiding methods whose urine is not measured (charting/alerts "Urine not measured"). */
export const UNMEASURED_VOIDING = ['toilet', 'pads'] as const satisfies readonly VoidingMethod[]

/** IDDSI drink levels (https://iddsi.org/framework/drink-testing-methods). Level 0 is thin, so it is not an order. */
export const IDDSI_DRINK_LEVELS = [
  { level: 0, name: 'Thin' },
  { level: 1, name: 'Slightly thick' },
  { level: 2, name: 'Mildly thick' },
  { level: 3, name: 'Moderately thick' },
  { level: 4, name: 'Extremely thick' },
] as const
export type IddsiLevel = (typeof IDDSI_DRINK_LEVELS)[number]['level']
export type ThickenedLevel = Exclude<IddsiLevel, 0>

/** Diet order types (charting/care-plan "Diet order values"). */
export const DIET_TYPES = ['regular', 'diabetic', 'renal', 'low_salt', 'low_fat', 'high_energy', 'gluten_free'] as const
export type DietType = (typeof DIET_TYPES)[number]
/** IDDSI food levels; 3 and 4 are shared with drinks (Liquidised / Moderately thick, Pureed / Extremely thick). */
export const IDDSI_FOOD_LEVELS = [
  { level: 3, name: 'Liquidised' },
  { level: 4, name: 'Pureed' },
  { level: 5, name: 'Minced & moist' },
  { level: 6, name: 'Soft & bite-sized' },
  { level: 7, name: 'Regular' },
] as const
export type FoodTexture = (typeof IDDSI_FOOD_LEVELS)[number]['level']
/** Energy target range (kcal/day). `step` and `default` are the form's; any integer in range is accepted. */
export const DIET_KCAL_RANGE = { min: 800, max: 4000, step: 50, default: 1800 } as const
/** Protein target range (g/day). */
export const DIET_PROTEIN_RANGE = { min: 20, max: 200, step: 5, default: 60 } as const

/** Each kind's value, as returned. Times are ISO at the edge. */
export interface CareValues {
  /** charting/acuity "Acuity order". */
  acuity: { level: AcuityLevel }
  nil_by_mouth: { until: string | null }
  thickened_fluids: { level: ThickenedLevel }
  fluid_limit: { ml: number; scope: FluidScope }
  intake_target: { ml: number }
  /** `measure_every_h`: the bag reading interval this catheter sets; null for the bed's default. */
  catheter: { type: CatheterType; inserted_at: string; measure_every_h: MeasureEveryH | null }
  stoma: { type: StomaType }
  drain: { site: DrainSite }
  voiding: { method: VoidingMethod }
  /** Targets are null when not set; only a dietitian sets them (charting/care-plan "Diet targets need a dietitian"). */
  diet: { type: DietType; texture: FoodTexture; kcal: number | null; protein_g: number | null }
}
/** Body of PUT /api/admissions/:id/care/:kind. Nil by mouth may leave `until` out (no planned end); a catheter its interval. */
export type CareInput<K extends CareKind = CareKind> = K extends 'nil_by_mouth'
  ? { until?: string | null }
  : K extends 'catheter'
    ? { type: CatheterType; inserted_at: string; measure_every_h?: MeasureEveryH | null }
    : K extends 'diet'
      ? { type: DietType; texture: FoodTexture; kcal?: number | null; protein_g?: number | null }
      : CareValues[K]

/** Who may set, change or end each kind's orders (charting/care-plan "Care orders need a nurse"). A total map. */
export const CARE_ORDER_ROLES: { readonly [K in CareKind]: readonly StaffRole[] } = {
  acuity: DECIDER_ROLES,
  nil_by_mouth: DECIDER_ROLES,
  thickened_fluids: DECIDER_ROLES,
  fluid_limit: DECIDER_ROLES,
  intake_target: DECIDER_ROLES,
  catheter: DECIDER_ROLES,
  stoma: DECIDER_ROLES,
  drain: DECIDER_ROLES,
  voiding: DECIDER_ROLES,
  diet: [...DECIDER_ROLES, ...DIETITIAN_ROLES],
}

interface CareOrderOf<K extends CareKind> {
  id: number
  admission_id: number
  kind: K
  value: CareValues[K]
  start_at: string
  /** Null while active. */
  end_at: string | null
  set_by: StaffRef | null
  ended_by: StaffRef | null
}
/** Discriminated on `kind`, so `order.value` narrows. `CareOrder<'catheter'>` is one kind's order. */
export type CareOrder<K extends CareKind = CareKind> = { [P in K]: CareOrderOf<P> }[K]

/** Counted intake for the chart day: approved + pending, rejected left out. */
export interface CareProgress {
  /** Chart day start (ISO). */
  since: string
  ml: number
  pending_ml: number
  of_ml: number
  /** floor(100 × ml / of_ml). */
  percent: number
}
export interface CareReview {
  id: number
  order_id: number
  at: string
  by: StaffRef | null
}
/** On GET /api/admissions items and GET /api/admissions/:id/entries. */
export interface CareStatus {
  /** Active orders, at most one per kind, in CARE_KINDS order. */
  orders: CareOrder[]
  fluid_limit: (CareProgress & { scope: FluidScope; left_ml: number }) | null
  /** `next_check`: today's next INTAKE_TARGET_CHECKS time and the mL due by then; null after the last. */
  intake_target: (CareProgress & { next_check: { at: string; ml: number } | null }) | null
  catheter: { day: number; review_due: boolean; last_review: CareReview | null } | null
}

// Care plan config: code constants, like the rest of the config surface (no env, no UI).
/** `fluid_limit_near` from this fraction of the limit. */
export const FLUID_LIMIT_WARN = 0.8
/** mL a fluid limit may be set to (and the web stepper's step and default). */
export const FLUID_LIMIT_RANGE = { min: 500, max: 3000, step: 50, default: 1500 } as const
/** mL an intake target may be set to (and the web stepper's step and default). */
export const INTAKE_TARGET_RANGE = { min: 500, max: 3000, step: 50, default: 1600 } as const
/** Local times each chart day by which this fraction of an intake target is due. */
export const INTAKE_TARGET_CHECKS: readonly { at: string; fraction: number }[] = [
  { at: '14:00', fraction: 0.5 },
  { at: '20:00', fraction: 0.75 },
]
/** `catheter_review` starts from this local time each chart day. */
export const CATHETER_REVIEW_FROM: string = CHART_DAY_START
/** The latest planned end of nil by mouth accepted, from now. */
export const NIL_BY_MOUTH_MAX_HOURS = 48
/** The earliest catheter insertion accepted, before now. */
export const CATHETER_MAX_AGE_DAYS = 365
/** Orders returned in `care_history`. */
export const CARE_HISTORY_LIMIT = 50
/** History rows the bed review shows before "Show all". */
export const CARE_HISTORY_SHOWN = 10

// ---------- level pairing (jug/bottle drop between photos → intake) ----------

export const LEVEL_CONTAINERS = ['water_jug', 'water_bottle'] as const satisfies readonly ContainerKind[]
export type LevelContainer = (typeof LEVEL_CONTAINERS)[number]

/** Body of POST /api/admissions/:id/levels. */
export interface LevelInput {
  container: LevelContainer
  volume_ml: number
  source: EntrySource
  confidence?: number | null
  /** Kept with the level, and on the intake entry the drop creates. */
  evidence?: PhotoEvidence | null
  /** The level's photo (photo media of this admission). */
  media_id?: number
  /** The labeled copy of `media_id`. */
  labeled_media_id?: number
  /** The photo read this level was drafted from. */
  read_id?: number
}

export interface Level {
  id: number
  admission_id: number
  container: LevelContainer
  volume_ml: number
  created_at: string
  media: MediaRef | null
  labeled_media: MediaRef | null
}

export interface LevelResult {
  level: Level
  /** Previous level of this container in the last 24 h, if any. */
  previous_ml: number | null
  /** Pending intake for the drop; null for a first reading or a refill. */
  entry: Entry | null
}

// ---------- bag readings (a bag's rise since its baseline → output; charting/bag-periods) ----------

export const BAG_CONTAINERS = ['urine_bag', 'stoma_bag', 'drain_bag'] as const satisfies readonly ContainerKind[]
export type BagContainer = (typeof BAG_CONTAINERS)[number]
/** The output category each bag's entries chart as. */
export const BAG_CATEGORY = { urine_bag: 'urine', stoma_bag: 'stoma', drain_bag: 'drain' } as const satisfies Record<
  BagContainer,
  EntryCategory
>
export const BAG_EVENTS = ['check', 'emptied', 'bag_changed'] as const
export type BagEvent = (typeof BAG_EVENTS)[number]
export const BAG_MAX_ML = 5000
/** One capacity per bag kind (`bag_nearly_full`, the check screen). */
export const BAG_CAPACITY_ML = { urine_bag: 2000, stoma_bag: 500, drain_bag: 1000 } as const satisfies Record<BagContainer, number>

// ---------- output devices (charting/care-plan "Output devices on chart reads") ----------

/** The care kind whose active order puts each bag on record. */
export const BAG_ORDER = { urine_bag: 'catheter', stoma_bag: 'stoma', drain_bag: 'drain' } as const satisfies Record<BagContainer, CareKind>
/** The container a voiding method's urine is measured in; null when it is not measured. */
export const VOIDING_CONTAINER = {
  urinal: 'urinal',
  bedpan: 'bedpan',
  commode: 'commode_pan',
  toilet: null,
  pads: null,
} as const satisfies Record<VoidingMethod, ContainerKind | null>

export type UrineMethod = 'catheter' | VoidingMethod
/** On GET /api/admissions items and GET /api/admissions/:id/entries. */
export interface OutputDevices {
  urine: UrineMethod
  urine_from: 'catheter' | 'voiding' | 'default'
  /** False only for `toilet` and `pads` with no catheter. */
  urine_measured: boolean
  /** The bags on record, in BAG_CONTAINERS order. */
  bags: BagContainer[]
}

/** Pure: the active orders (ended ones are ignored) → the devices on record. A catheter wins over a voiding order. */
export function outputDevices(orders: readonly CareOrder[]): OutputDevices {
  const active = orders.filter((o) => o.end_at === null)
  const has = (k: CareKind) => active.some((o) => o.kind === k)
  const voiding = active.find((o): o is CareOrder<'voiding'> => o.kind === 'voiding')
  const urine: UrineMethod = has('catheter') ? 'catheter' : (voiding?.value.method ?? 'urinal')
  return {
    urine,
    urine_from: has('catheter') ? 'catheter' : voiding ? 'voiding' : 'default',
    urine_measured: !(UNMEASURED_VOIDING as readonly string[]).includes(urine),
    bags: BAG_CONTAINERS.filter((b) => has(BAG_ORDER[b])),
  }
}
/** `bag_nearly_full` from this fraction of the capacity. */
export const BAG_NEARLY_FULL = 0.8
/** A same-event reading of the same bag this close in time (inclusive, either side) and level is a duplicate. */
export const DUPLICATE_WITHIN_MIN = 10
export const DUPLICATE_TOLERANCE_ML = 25

/** One source for the bag reading interval: server prompts, the capture screen and the round. */
export interface ReadingInterval {
  h: number
  from: 'catheter' | 'default'
}
// Private to readingInterval: scale-acuity replaces the default (and this map) with the bed's acuity.
const INTERVAL_H_BY_WARD_CODE: Readonly<Record<string, number>> = { HDU: 1 }
const DEFAULT_INTERVAL_H = 4
/** `catheter`: the ACTIVE catheter order's value; its `measure_every_h` wins over the ward default. */
export function readingInterval(
  admission: Pick<Admission, 'ward_code'>,
  catheter?: Pick<CareValues['catheter'], 'measure_every_h'> | null,
): ReadingInterval {
  const every = catheter?.measure_every_h
  if (every != null) return { h: every, from: 'catheter' }
  return { h: INTERVAL_H_BY_WARD_CODE[admission.ward_code] ?? DEFAULT_INTERVAL_H, from: 'default' }
}
/** "Emptied after photo" starts on for intervals of at least this many hours. */
export const EMPTIED_FROM_INTERVAL_H = 4
export const emptiedByDefault = (interval: ReadingInterval): boolean => interval.h >= EMPTIED_FROM_INTERVAL_H

/** Body of POST /api/admissions/:id/bag-readings. */
export interface BagReadingInput {
  container: BagContainer
  event: BagEvent
  /** Whole mL, 0..BAG_MAX_ML. */
  volume_ml: number
  source: 'photo' | 'manual'
  /** Photo only. */
  media_id?: number
  /** Photo only, from a segmented read: the labeled copy of `media_id`. */
  labeled_media_id?: number
  /** Photo only, from a read. */
  confidence?: number | null
  /** Photo only, from a read; none when the level was typed. */
  evidence?: PhotoEvidence | null
  notes?: string | null
  /** `urine_bag` only. */
  urine_colour?: UrineColour | null
  urine_rgb?: string | null
  /** As for late entries. ISO. */
  charted_at?: string
  /** The photo read this reading was drafted from (`source: 'photo'` with its evidence). A typed-level photo has no read and sends none. */
  read_id?: number
  /** A positive integer: the id of the reading a 409 `duplicate_reading` named, which staff chose to save anyway. */
  confirm_duplicate_of?: number
}
export interface BagEntryRef {
  id: number
  volume_ml: number
  status: EntryStatus
}
export interface BagReading {
  id: number
  container: BagContainer
  event: BagEvent
  volume_ml: number
  /** On read, from the readings as they now stand. 0 after a fall. */
  baseline_ml: number
  rise_ml: number
  fell: boolean
  /** The baseline the level fell below; null unless `fell`. A missed emptying's floor. */
  fell_from_ml: number | null
  residual_ml: number | null
  source: 'photo' | 'manual'
  media: MediaRef | null
  labeled_media: MediaRef | null
  /** The after-emptying photo. */
  proof_media: MediaRef | null
  evidence: PhotoEvidence | null
  created_by: StaffRef | null
  /** Charted time. */
  created_at: string
  recorded_at: string
  /** Saved more than a minute (the clock skew allowed) after its charted time. */
  late: boolean
  /** The entry this reading charted, if any; its volume may differ from `rise_ml` for a late reading. */
  entry: BagEntryRef | null
  /** Saved anyway as a repeat of this reading (charting/bag-periods "Duplicate bag reading"); null otherwise. */
  confirmed_duplicate_of: number | null
}
/** The reading a 409 `duplicate_reading` names. */
export interface BagDuplicate {
  id: number
  event: BagEvent
  volume_ml: number
  created_at: string
}
/** 409 body of POST /api/admissions/:id/bag-readings for a repeat reading. */
export interface DuplicateReadingBody {
  error: 'duplicate_reading'
  duplicate_of: BagDuplicate
}
/** 201 of POST /api/admissions/:id/bag-readings. */
export interface BagReadingResult {
  reading: BagReading
  entry: Entry | null
}
/** Body of POST /api/bag-readings/:id/after-emptying; at least one field. */
export interface AfterEmptyingInput {
  media_id?: number
  residual_ml?: number
}
export interface BagPeriod {
  container: BagContainer
  /** The opening emptying or bag change; null when unknown. */
  start_at: string | null
  /** The closing reading; the last reading when a fall followed; null while open. */
  end_at: string | null
  opened_by: 'emptied' | 'bag_changed' | null
  closed_by: 'emptied' | 'bag_changed' | null
  /** Oldest first. */
  readings: BagReading[]
  /** Sum of `rise_ml`. */
  total_ml: number
  /** total_ml / hours from start_at to the last reading, whole mL; null when start_at is null or that is 0 h. */
  rate_ml_h: number | null
}
/** `periods`: grouped in BAG_CONTAINERS order, each bag's newest first. */
export interface BagChart {
  interval_h: number
  interval_from: ReadingInterval['from']
  periods: BagPeriod[]
}

/**
 * The catheter an active order belongs to: the active order and the orders it replaced (each ending where the next
 * starts) of the same type and inserted_at, oldest first. `orders`: the admission's full catheter history, any order.
 */
export function catheterSince(orders: readonly CareOrder[], active: CareOrder<'catheter'>): CareOrder<'catheter'>[] {
  const catheters = orders.filter((o): o is CareOrder<'catheter'> => o.kind === 'catheter')
  const chain: CareOrder<'catheter'>[] = [active]
  let head = active
  for (;;) {
    const start = Date.parse(head.start_at)
    const prev = catheters.find(
      (o) =>
        o.id !== head.id &&
        o.end_at !== null &&
        Date.parse(o.end_at) === start &&
        o.value.type === active.value.type &&
        Date.parse(o.value.inserted_at) === Date.parse(active.value.inserted_at) &&
        !chain.includes(o),
    )
    if (!prev) return chain
    chain.unshift(prev)
    head = prev
  }
}

/** The low-output window `(from, to]`, ms. `bagAt` is `to` when the window ends at a bag reading, else null. */
export interface UrineWindow {
  from: number
  to: number
  bagAt: number | null
}
const HOUR_MS = 3_600_000
/**
 * charting/alerts "Low urine output": `to` is the newest urine-bag reading while it is under 2 × the interval old and
 * no pending or approved urine entry not charted from a bag reading is charted after it; otherwise now.
 */
export function urineWindow(i: {
  /** Charted times of the admission's urine-bag readings, any event. */
  urineBagReadingsAt: readonly number[]
  entries: readonly Entry[]
  intervalH: number
  now: number
}): UrineWindow {
  const windowMs = ALERT_RULES.lowOutputWindowH * HOUR_MS
  let newest: number | null = null
  for (const t of i.urineBagReadingsAt) if (t <= i.now && (newest === null || t > newest)) newest = t
  const atNow = { from: i.now - windowMs, to: i.now, bagAt: null }
  if (newest === null || i.now - newest >= 2 * i.intervalH * HOUR_MS) return atNow
  const after = newest
  const other = i.entries.some(
    (e) =>
      e.category === 'urine' &&
      e.levels === null &&
      (e.status === 'pending' || e.status === 'approved') &&
      Date.parse(e.created_at) > after,
  )
  if (other) return atNow
  return { from: newest - windowMs, to: newest, bagAt: newest }
}

/** Approved urine in `(from, to]`: a bag entry spread over (its reading before at save, its reading], else whole at its time; whole mL. */
export function urineInWindow(entries: readonly Entry[], from: number, to: number): number {
  let ml = 0
  for (const e of entries) {
    if (e.category !== 'urine' || e.status !== 'approved') continue
    const end = Date.parse(e.created_at)
    const before = e.levels?.before?.created_at
    const start = before === undefined ? NaN : Date.parse(before)
    if (Number.isFinite(start) && start < end) {
      const overlap = Math.min(end, to) - Math.max(start, from)
      if (overlap > 0) ml += (e.volume_ml * overlap) / (end - start)
    } else if (end > from && end <= to) ml += e.volume_ml
  }
  return Math.round(ml)
}

/** Readings at or above this confidence can be confirmed in one tap and batch-approved. */
export const AUTO_CONFIRM_CONFIDENCE = 0.75

// Meals: the food chart beside the fluid chart. Charting only; no nutrition advice.

export const MEAL_KINDS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealKind = (typeof MEAL_KINDS)[number]
/** Percent of the serving eaten, in the paper food chart's steps. */
export const PORTIONS = [0, 25, 50, 75, 100] as const
export type Portion = (typeof PORTIONS)[number]
export const MEAL_ISSUES = ['not_a_meal', 'blurred', 'partly_hidden', 'tray_empty_unclear'] as const
export type MealIssue = (typeof MEAL_ISSUES)[number]
export const MEAL_SOURCES = ['manual', 'photo'] as const
export type MealSource = (typeof MEAL_SOURCES)[number]
export const MAX_MEAL_ITEMS = 200

// ---------- tray reading ----------

/** What a dish on a tray is charted as. Matches the external tray dataset's `expected_items[].dish_kind`. */
export const DISH_KINDS = [
  'rice',
  'bread',
  'dal_lentils',
  'curry_vegetables',
  'meat_fish_egg',
  'soup_broth',
  'porridge_cereal',
  'salad_raw',
  'fruit',
  'dairy',
  'dessert_sweet',
  'snack',
  'other',
] as const
export type DishKind = (typeof DISH_KINDS)[number]

/** Fluids served with a meal: the drink kinds (the dataset's `expected_fluids[].fluid_kind`). */
export const MEAL_FLUID_KINDS = DRINK_KINDS satisfies readonly FluidKind[]
export type MealFluidKind = (typeof MEAL_FLUID_KINDS)[number]

/** Where a dish's portion came from. `model`: Spark's estimate. `measured`: from the served and collected coverage. */
export const PORTION_BASES = ['model', 'measured'] as const
export type PortionBasis = (typeof PORTION_BASES)[number]

/** A served photo is looked for at or after now − SERVED_TRAY_HOURS. */
export const SERVED_TRAY_HOURS = 4
/** Largest squared centre distance that can match, in thousandths² (200 thousandths). */
export const MATCH_MAX_DISTANCE = 40_000
/** Smallest served coverage that can be measured against, in thousandths. */
export const MIN_SERVED_COVERAGE = 150
/** Trace steps a tray read returns and a meal keeps, at most: two SAM steps per photo, then Spark. */
export const MAX_TRACE_STEPS = 5

/** Dish regions kept per tray photo (the largest). */
export const MAX_TRAY_REGIONS = 12
/** Mask cells on the longer side, at most: 32 × 32 bits = 128 bytes = 172 base64 characters. */
export const MASK_GRID = 32
/** Warnings a read returns and a meal keeps, at most, and their length. */
export const MAX_READ_WARNINGS = 6
export const MAX_WARNING_CHARS = 200

/** One-bit mask on a `width` × `height` grid over a box: row-major, most significant bit first, zero-padded to a byte, base64. */
export interface MaskBits {
  width: number
  height: number
  bits: string
}

/** One dish SAM found on a tray photo. The box is in source pixels, half-open. */
export interface TrayRegion {
  /** 1-based: by box centre left to right, then top to bottom, then larger first. */
  index: number
  box: SegmentBox
  /** Food on the dish's own pixels / the dish's own pixels, 0..1, 3 decimals. */
  coverage: number
  /** The dish's own mask, and the food on it, on the same grid. */
  mask: MaskBits
  food: MaskBits
}

export interface TraySegmentation {
  regions: TrayRegion[]
  /** Food pixels outside every dish / all food pixels, 3 decimals; null when SAM found no food. */
  loose_food: number | null
}

/** A dish as saved and charted. `index` 0: not in a segmented region. */
export interface DishValue {
  index: number
  name: string
  dish_kind: DishKind
  portion: Portion
}

/** A dish as read: the value, plus where it came from. */
export interface MealDish extends DishValue {
  basis: PortionBasis
  /** The region's box and coverage; null for index 0. */
  box: SegmentBox | null
  coverage: number | null
  /** Spark's portion, always; equals `portion` when basis is 'model'. */
  model_portion: Portion
  /** Non-null exactly when basis is 'measured'. */
  measure: DishMeasure | null
}

export interface DishMeasure {
  served_index: number
  /** 0..1, 3 decimals. */
  served_coverage: number
}

/** Pixel size read from the file header. */
export interface ImageSize {
  width: number
  height: number
}

/** One collected region matched to one served region. */
export interface RegionMatch {
  /** Collected region, 1-based. */
  index: number
  /** Served region, 1-based. */
  served_index: number
  /** Squared centre distance, thousandths², 0..MATCH_MAX_DISTANCE. */
  distance2: number
}

/** The served photo a tray read found, compared or not. Null on the read when none was found, or it holds the collected photo's own bytes. */
export interface TrayComparison {
  served_media_id: number
  /** SHA-256 of the served bytes the server read, lowercase hex. Must equal the media's `sha256` at save. */
  served_sha256: string
  /** The served media's created_at, ISO. */
  served_at: string
  /** Null when not compared: spark mode, budget, no collected regions, unreadable size. */
  size: ImageSize | null
  served_size: ImageSize | null
  /** Null when not compared or the served SAM failed; { regions: [], loose_food: null } when it found nothing. */
  served: TraySegmentation | null
  /** At most MAX_TRAY_REGIONS; [] when not compared. */
  matches: RegionMatch[]
}

/** Dish names in list order (never sorted by index), joined by ", ", cut to MAX_MEAL_ITEMS: a draft's and an amendment's items. */
export const joinItems = (dishes: readonly { name: string }[]): string =>
  dishes
    .map((d) => d.name)
    .join(', ')
    .slice(0, MAX_MEAL_ITEMS)

export interface MealFluid {
  index: number
  name: string
  fluid_kind: MealFluidKind
  volume_ml: number
}

/** Muse Spark's read of a tray photo (strict JSON schema), grounded by SAM's dish regions in `sam+spark` mode. */
export interface MealReading {
  /** The dishes' names and portions, for consumers written before dishes. */
  items: { name: string; portion: Portion }[]
  dishes: MealDish[]
  portion: Portion
  fluids: MealFluid[]
  confidence: number
  issues: MealIssue[]
  notes: string | null
}

export interface MealDraft {
  portion: Portion
  /** Item names joined by ", "; "" when none. */
  items: string
  /** Sum of the fluids; null when none. */
  fluid_ml: number | null
  dishes: DishValue[]
}

/** `POST /api/ai/meal`: exactly 3 requests in `sam+spark` mode, 5 with a compared served photo, exactly 1 in `spark` mode. */
export interface MealReadResult {
  mode: ReadMode
  /** SHA-256 of the uploaded image bytes, lowercase hex. A saved meal's evidence must match its photo's `sha256`. */
  image_sha256: string
  reading: MealReading
  /** Null in `spark` mode or when SAM failed (see `warnings`). */
  segmentation: TraySegmentation | null
  /** The served photo found for the bed's meal; null when none (or the same bytes). */
  comparison: TrayComparison | null
  draft: MealDraft
  /** Confidence below AUTO_CONFIRM_CONFIDENCE, or any issue. */
  needs_review: boolean
  /** At most MAX_READ_WARNINGS, each at most MAX_WARNING_CHARS. */
  warnings: string[]
  trace: CallTrace[]
  ms: number
}

/** Kept with a photo meal as the read returned it: client-reported, bounded, bound to its photo, never changed. */
export interface MealEvidence {
  mode: ReadMode
  /** SHA-256 of the photo the read used; null when none was recorded. */
  image_sha256: string | null
  reading: MealReading
  segmentation: TraySegmentation | null
  comparison: TrayComparison | null
  warnings: string[]
  trace: CallTrace[]
}

/** Evidence as a meal post carries it: the read as returned, always bound to its photo by `image_sha256`. */
export type MealEvidenceInput = MealEvidence & { image_sha256: string }

export interface MealInput {
  meal: MealKind
  portion: Portion
  items?: string | null
  fluid_ml?: number | null
  source: MealSource
  confidence?: number | null
  evidence?: MealEvidenceInput | null
  /** When it was eaten (ISO with offset); the entry rules apply. Defaults to now. */
  charted_at?: string
  /** Photo meals only: the tray photo (photo media of this admission). */
  media_id?: number
  /** Photo meals only, with segmented evidence: the labeled copy of `media_id`. */
  labeled_media_id?: number
  /** Photo meals only, exactly when the evidence has a comparison: the served tray photo it names. */
  served_media_id?: number
  dishes?: DishValue[]
  /** Photo meals only: the tray read this meal was drafted from (charting/model-accuracy "Link a meal to its read"). */
  read_id?: number
}

/** The tray photo as the server found it when the meal was saved. */
export interface TrayPhotoProof {
  media_id: number
  sha256: string
  captured_by: StaffRef | null
  captured_at: string
}

/** Built by the server when a photo meal with evidence is saved; never changed. */
export interface MealProof {
  photo: TrayPhotoProof
  /** The served tray photo, found the same way; null when the meal has none. */
  served: TrayPhotoProof | null
  confirmed: { portion: Portion; items: string | null; fluid_ml: number | null; dishes: DishValue[] }
  confirmed_by: StaffRef | null
  confirmed_at: string
}

export interface Meal {
  id: number
  admission_id: number
  meal: MealKind
  portion: Portion
  items: string | null
  fluid_ml: number | null
  source: MealSource
  confidence: number | null
  evidence: MealEvidence | null
  /** Charted time. */
  created_at: string
  recorded_at: string
  late: boolean
  created_by: StaffRef | null
  /** The pending food entry for `fluid_ml`, and its status now. */
  entry_id: number | null
  entry_status: EntryStatus | null
  voided_at: string | null
  voided_by: StaffRef | null
  void_reason: string | null
  /** The tray photo; null for a meal by hand, a voided meal, or when none was kept. */
  media: MediaRef | null
  /** The tray's labeled copy; null when none was kept, or the meal is voided. */
  labeled_media: MediaRef | null
  /** As saved. [] when none. */
  dishes: DishValue[]
  /** Null for a meal without evidence, and for meals saved before proofs were kept. */
  proof: MealProof | null
  /** The served tray photo; null when none was linked, or the meal is voided. */
  served_media: MediaRef | null
  /** Oldest first. */
  amendments: MealAmendment[]
  amended_at: string | null
}

/** The values a meal amendment may change. */
export interface MealValues {
  portion: Portion
  items: string | null
  dishes: DishValue[]
}

export interface MealAmendment {
  id: number
  at: string
  by: StaffRef | null
  reason: string
  before: MealValues
  after: MealValues
}

/** `POST /api/meals/:id/amend`. `items` is refused with `dishes`, and on a meal that has dishes. */
export interface AmendMealInput {
  portion?: Portion
  items?: string
  dishes?: DishValue[]
  reason: string
}

/** `GET /api/admissions/:id/served-tray`: the bed's newest unlinked served photo of any meal in the window, or null. */
export interface ServedTray {
  media: MediaRef | null
}

export interface VoidMealInput {
  reason: string
}

// ---------- nutrition: dietitians and referrals (charting/nutrition; no model requests) ----------
// Config: changing one is a code change. See the dietitian change's proposal, "Config".

/** `poor_meal_intake` fires when this many latest counted meals were each eaten POOR_INTAKE_PORTION or less. */
export const POOR_INTAKE_MEALS = 3
export const POOR_INTAKE_PORTION: Portion = 50
/** The window of counted meals, and of the worklist's intake counts. */
export const POOR_INTAKE_WINDOW_H = 24
export const REFERRAL_REASONS = ['poor_intake', 'weight_loss', 'swallowing', 'diet_query', 'other'] as const
export type ReferralReason = (typeof REFERRAL_REASONS)[number]
export const REFERRAL_OUTCOMES = ['diet_changed', 'supplements_started', 'monitoring', 'no_action_needed'] as const
export type ReferralOutcome = (typeof REFERRAL_OUTCOMES)[number]
export const REFERRAL_STATUSES = ['open', 'acknowledged', 'closed'] as const
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]
/** A referral note's longest length, once trimmed. */
export const REFERRAL_NOTE_MAX = 200
/** The latest `next_review` a close accepts, in calendar days from today. */
export const REFERRAL_REVIEW_MAX_DAYS = 28

export interface Referral {
  id: number
  admission_id: number
  reason: ReferralReason
  /** Staff-written, trimmed, 1–200 characters. Stored and shown; never logged, never sent to a model. */
  note: string | null
  status: ReferralStatus
  created_at: string
  created_by: StaffRef | null
  acknowledged_at: string | null
  acknowledged_by: StaffRef | null
  closed_at: string | null
  closed_by: StaffRef | null
  outcome: ReferralOutcome | null
  /** Local date 'YYYY-MM-DD'. */
  next_review: string | null
}
/** Body of POST /api/admissions/:id/referrals. */
export interface ReferralInput {
  reason: ReferralReason
  note?: string | null
}
/** Body of POST /api/referrals/:id/close. */
export interface CloseReferralInput {
  outcome: ReferralOutcome
  next_review?: string | null
}
/** On GET /api/admissions items and GET /api/admissions/:id/entries. */
export interface NutritionStatus {
  /** A dietitian is assigned, or some dietitian's wards include the admission's ward. */
  dietitian_available: boolean
  /** The current assignment, or null: routed to the ward's dietitians. */
  dietitian: DietitianAssignment | null
  /** The latest referral of any status. */
  referral: Referral | null
}
export interface WorklistPatient {
  admission: Admission
  nutrition: NutritionStatus
  /** The active diet order, or null. */
  diet: CareOrder<'diet'> | null
  /** Meals not voided and not drink-only snacks charted since `since`, and those eaten POOR_INTAKE_PORTION or less. */
  intake: { meals: number; poor_meals: number }
}
/** GET /api/nutrition/worklist. Each patient appears once, in the first list that applies. */
export interface NutritionWorklist {
  since: string
  /** A referral in progress routed to me: open, then acknowledged, oldest first. */
  patients: WorklistPatient[]
  /** The rest assigned to me, by ward id then bed. */
  assigned: WorklistPatient[]
  /** The rest routed to me with a diet order, by ward id then bed. */
  diets: WorklistPatient[]
}

/** Days of meals in the patient nutrition read. */
export const FOOD_CHART_DAYS = 3
/** Most referrals, assignments and diet orders in the patient nutrition read. */
export const NUTRITION_HISTORY_LIMIT = 20

/** One dietitian's assignment to an admission; only ever ended, so the rows are the audit trail. */
export interface DietitianAssignment {
  id: number
  admission_id: number
  staff: StaffRef
  assigned_at: string
  assigned_by: StaffRef | null
  ended_at: string | null
  ended_by: StaffRef | null
}
/** Body of PUT /api/admissions/:id/dietitian. */
export interface AssignDietitianInput {
  staff_id: number
}

export interface FoodChartDay {
  /** Local date 'YYYY-MM-DD'. */
  date: string
  /** Not voided, not drink-only snacks. */
  meals: number
  /** Of those, eaten POOR_INTAKE_PORTION or less. */
  poor_meals: number
}

/** GET /api/admissions/:id/nutrition. */
export interface NutritionView {
  admission: Admission
  nutrition: NutritionStatus
  /** Newest created_at first, at most NUTRITION_HISTORY_LIMIT. */
  referrals: Referral[]
  /** Newest assigned_at first, at most NUTRITION_HISTORY_LIMIT. */
  assignments: DietitianAssignment[]
  diet: CareOrder<'diet'> | null
  /** Newest start first, at most NUTRITION_HISTORY_LIMIT; the active order included. */
  diet_history: CareOrder<'diet'>[]
  /** 00:00 local on the first of the last FOOD_CHART_DAYS local dates. */
  since: string
  /** Since `since`, voided included, newest first. */
  meals: Meal[]
  /** FOOD_CHART_DAYS entries, newest first. */
  days: FoodChartDay[]
}

/** Model actions of one budget class since the server started (server/metrics). */
export interface ModelActionCounts {
  admitted: number
  refused: number
  /** Admitted for fewer requests than its mode plans (budget pressure, too few left, or no room to compare). */
  downgraded: number
}

/** GET /api/metrics (server/metrics): counts since the server started, by route pattern, never by patient. */
export interface OperationalMetrics {
  requests: { method: string; route: string; status: number; count: number }[]
  /** Over each route's last 1,000 requests. */
  latency_ms: { method: string; route: string; p50: number; p95: number }[]
  /** Null when the server has no model client (no API key). */
  model_budget: { cap: number; used: number; held: number; remaining: { critical: number; routine: number } } | null
  model_actions: { critical: ModelActionCounts; routine: ModelActionCounts }
  store: { bytes: number }
  media: { count: number; bytes: number }
}
