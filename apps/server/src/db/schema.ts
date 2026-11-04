/**
 * The chart's tables in Postgres (Drizzle ORM), one file so drizzle-kit loads it without resolving schema imports.
 * Times are `timestamptz` read as `Date`; JSON is `jsonb`; closed lists are `text` with a CHECK. Every table lives in schema `meniscus`, which Supabase's Data API does not expose.
 *
 * A change here ships as a migration: `pnpm --filter @meniscus/server db:generate`, then commit `apps/server/drizzle/`.
 * Triggers and grants are not in Drizzle's DSL; they live in the custom migration `0001_*.sql`.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { ACUITY_LEVELS, MEAL_KINDS, REFERRAL_NOTE_MAX, STAFF_ROLES } from '@meniscus/shared'

export const meniscus = pgSchema('meniscus')

/** `timestamptz`, read and written as a JS `Date` (the store maps epoch ms in and ISO strings out). */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
/** An identity primary key; `BY DEFAULT`, so the seeds and tests may name an id. Never reused. */
const id = () => integer('id').primaryKey().generatedByDefaultAsIdentity()
const staffRef = (name: string) => integer(name).references(() => staff.id)
const mediaRef = (name: string) => integer(name).references((): AnyPgColumn => media.id)
const list = (values: readonly (string | number)[]) => sql.raw(values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(', '))

export const ward = meniscus.table(
  'ward',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    specialty: text('specialty').notNull(),
    capacity: integer('capacity').notNull(),
    // charting/acuity: the level of the ward's beds that have no acuity order.
    default_acuity: text('default_acuity', { enum: ACUITY_LEVELS }).notNull().default('stable'),
  },
  (t) => [
    check('ward_capacity', sql`${t.capacity} >= 0`),
    check('ward_default_acuity', sql`${t.default_acuity} IN (${list(ACUITY_LEVELS)})`),
  ],
)

/** Staff ids are the demo roster's (DEMO_STAFF), always given explicitly; no identity. */
export const staff = meniscus.table(
  'staff',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    role: text('role', { enum: STAFF_ROLES }).notNull(),
    username: text('username').unique(),
    password_hash: text('password_hash'),
  },
  (t) => [check('staff_role', sql`${t.role} IN (${list(STAFF_ROLES)})`)],
)

export const admission = meniscus.table(
  'admission',
  {
    id: id(),
    ward_id: integer('ward_id')
      .notNull()
      .references(() => ward.id),
    bed: text('bed').notNull(),
    patient: text('patient').notNull(),
    weight_kg: doublePrecision('weight_kg'),
    mrn: text('mrn').notNull(),
    qr_token: text('qr_token').notNull().unique(),
    admitted_at: ts('admitted_at').notNull(),
  },
  (t) => [unique('admission_ward_id_bed_unique').on(t.ward_id, t.bed), index('admission_ward').on(t.ward_id)],
)

export const media = meniscus.table(
  'media',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    // The bytes are the object <sha256[0:2]>/<sha256> in the media store (server/storage), never in the database.
    size: integer('size').notNull(),
    duration_ms: integer('duration_ms'),
    created_at: ts('created_at').notNull(),
    created_by: staffRef('created_by'),
    sha256: text('sha256').notNull(),
    // A served tray photo's meal (MEAL_KINDS, photos only; checked at the route); NULL for other media.
    served_meal: text('served_meal', { enum: MEAL_KINDS }),
    // When an entry, level or meal first named this media; NULL until then. Set by the `media_linked` triggers
    // (migration 0004), so expiry reads only never-linked rows (charting/media "Unlinked media expires").
    linked_at: ts('linked_at'),
  },
  (t) => [
    index('media_created').on(t.created_at),
    index('media_unlinked')
      .on(t.created_at)
      .where(sql`${t.linked_at} IS NULL`),
    index('media_sha256').on(t.sha256),
    index('media_served')
      .on(t.admission_id, t.served_meal, t.created_at)
      .where(sql`${t.served_meal} IS NOT NULL`),
  ],
)

export const entry = meniscus.table(
  'entry',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    category: text('category').notNull(),
    volume_ml: integer('volume_ml').notNull(),
    item: text('item'),
    notes: text('notes'),
    source: text('source').notNull(),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    created_at: ts('created_at').notNull(),
    reviewed_at: ts('reviewed_at'),
    recorded_ml: integer('recorded_ml').notNull(),
    evidence: jsonb('evidence'),
    recorded_at: ts('recorded_at').notNull(),
    created_by: staffRef('created_by'),
    reviewed_by: staffRef('reviewed_by'),
    approved_ml: integer('approved_ml'),
    amended_at: ts('amended_at'),
    reject_reason: text('reject_reason'),
    urine_colour: text('urine_colour'),
    urine_rgb: text('urine_rgb'),
    media_id: mediaRef('media_id'),
    level_id: integer('level_id').references((): AnyPgColumn => level.id),
    prev_level_id: integer('prev_level_id').references((): AnyPgColumn => level.id),
    iddsi_level: integer('iddsi_level'),
    // water and food only; checked against DRINK_KINDS at the route, as iddsi_level is.
    drink: text('drink'),
    // The labeled copy of media_id (SAM regions drawn in on the device); unlinked with it on reject.
    labeled_media_id: mediaRef('labeled_media_id'),
  },
  (t) => [
    check('entry_direction', sql`${t.direction} IN ('in', 'out')`),
    check('entry_volume_ml', sql`${t.volume_ml} > 0`),
    check('entry_status', sql`${t.status} IN ('pending', 'approved', 'rejected')`),
    index('entry_admission_created').on(t.admission_id, t.created_at),
    // Unlink checks (reject, void, expiry) look media up from each side.
    index('entry_media').on(t.media_id),
    index('entry_level').on(t.level_id),
    index('entry_labeled_media').on(t.labeled_media_id),
  ],
)

export const entry_event = meniscus.table(
  'entry_event',
  {
    id: id(),
    entry_id: integer('entry_id')
      .notNull()
      .references(() => entry.id),
    kind: text('kind', { enum: ['recorded', 'approved', 'corrected', 'rejected', 'amended'] }).notNull(),
    at: ts('at').notNull(),
    staff_id: staffRef('staff_id'),
    from_ml: integer('from_ml'),
    to_ml: integer('to_ml'),
    from_category: text('from_category'),
    to_category: text('to_category'),
    reason: text('reason'),
    note: text('note'),
    from_colour: text('from_colour'),
    to_colour: text('to_colour'),
    from_iddsi: integer('from_iddsi'),
    to_iddsi: integer('to_iddsi'),
    from_drink: text('from_drink'),
    to_drink: text('to_drink'),
    from_item: text('from_item'),
    to_item: text('to_item'),
  },
  (t) => [
    check('entry_event_kind', sql`${t.kind} IN ('recorded', 'approved', 'corrected', 'rejected', 'amended')`),
    index('entry_event_entry').on(t.entry_id, t.at, t.id),
  ],
)

/** Jug, bottle and bag levels. The bag columns (charting/bag-periods) are NULL on jug and bottle levels. */
export const level = meniscus.table(
  'level',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    container: text('container').notNull(),
    volume_ml: integer('volume_ml').notNull(),
    created_at: ts('created_at').notNull(),
    evidence: jsonb('evidence'),
    media_id: mediaRef('media_id'),
    event: text('event', { enum: ['check', 'emptied', 'bag_changed'] }),
    residual_ml: integer('residual_ml'),
    recorded_at: ts('recorded_at'),
    created_by: staffRef('created_by'),
    proof_media_id: mediaRef('proof_media_id'),
    source: text('source', { enum: ['photo', 'manual'] }),
    // Saved anyway as a repeat of this reading (charting/bag-periods "Duplicate bag reading").
    confirmed_duplicate_of: integer('confirmed_duplicate_of').references((): AnyPgColumn => level.id),
    labeled_media_id: mediaRef('labeled_media_id'),
  },
  (t) => [
    check('level_volume_ml', sql`${t.volume_ml} >= 0`),
    check('level_event', sql`${t.event} IN ('check', 'emptied', 'bag_changed')`),
    check('level_residual_ml', sql`${t.residual_ml} >= 0`),
    check('level_source', sql`${t.source} IN ('photo', 'manual')`),
    index('level_admission_container').on(t.admission_id, t.container, t.created_at),
    index('level_media').on(t.media_id),
    index('level_proof_media').on(t.proof_media_id),
    index('level_labeled_media').on(t.labeled_media_id),
  ],
)

export const meal = meniscus.table(
  'meal',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    meal: text('meal', { enum: MEAL_KINDS }).notNull(),
    portion: integer('portion').notNull(),
    items: text('items'),
    fluid_ml: integer('fluid_ml'),
    source: text('source', { enum: ['manual', 'photo'] }).notNull(),
    confidence: doublePrecision('confidence'),
    evidence: jsonb('evidence'),
    created_at: ts('created_at').notNull(),
    recorded_at: ts('recorded_at').notNull(),
    created_by: staffRef('created_by'),
    entry_id: integer('entry_id').references(() => entry.id),
    voided_at: ts('voided_at'),
    voided_by: staffRef('voided_by'),
    void_reason: text('void_reason'),
    media_id: mediaRef('media_id'),
    dishes: jsonb('dishes'),
    proof: jsonb('proof'),
    served_media_id: mediaRef('served_media_id'),
    amended_at: ts('amended_at'),
    labeled_media_id: mediaRef('labeled_media_id'),
  },
  (t) => [
    check('meal_meal', sql`${t.meal} IN (${list(MEAL_KINDS)})`),
    check('meal_portion', sql`${t.portion} IN (0, 25, 50, 75, 100)`),
    check('meal_fluid_ml', sql`${t.fluid_ml} > 0`),
    check('meal_source', sql`${t.source} IN ('manual', 'photo')`),
    index('meal_admission_created').on(t.admission_id, t.created_at),
    index('meal_media').on(t.media_id),
    index('meal_labeled_media').on(t.labeled_media_id),
    // One meal per served photo: closes the race between two saves of the same served tray.
    uniqueIndex('meal_served_media')
      .on(t.served_media_id)
      .where(sql`${t.served_media_id} IS NOT NULL`),
  ],
)

/** Meal amendments: the values before and after, kept as written (trigger `meal_event_kept`). */
export const meal_event = meniscus.table(
  'meal_event',
  {
    id: id(),
    meal_id: integer('meal_id')
      .notNull()
      .references(() => meal.id),
    kind: text('kind', { enum: ['amended'] }).notNull(),
    at: ts('at').notNull(),
    staff_id: staffRef('staff_id'),
    reason: text('reason').notNull(),
    before: jsonb('before').notNull(),
    after: jsonb('after').notNull(),
  },
  (t) => [check('meal_event_kind', sql`${t.kind} IN ('amended')`), index('meal_event_meal').on(t.meal_id, t.at, t.id)],
)

/** Ward teams: rank 0 is the home ward, higher ranks the wards covered (or, for an overseer, overseen). */
export const staff_ward = meniscus.table(
  'staff_ward',
  {
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    ward_id: integer('ward_id')
      .notNull()
      .references(() => ward.id),
    rank: integer('rank').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staff_id, t.ward_id] }),
    unique('staff_ward_staff_id_rank_unique').on(t.staff_id, t.rank),
    index('staff_ward_ward').on(t.ward_id),
  ],
)

/** The nurse in charge of a ward for one shift; a nurse is in charge of one ward per shift. */
export const ward_shift = meniscus.table(
  'ward_shift',
  {
    ward_id: integer('ward_id')
      .notNull()
      .references(() => ward.id),
    shift_start: ts('shift_start').notNull(),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    set_by: staffRef('set_by'),
    set_at: ts('set_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ward_id, t.shift_start] }),
    unique('ward_shift_staff_id_shift_start_unique').on(t.staff_id, t.shift_start),
  ],
)

export const bed_assignment = meniscus.table(
  'bed_assignment',
  {
    ward_id: integer('ward_id')
      .notNull()
      .references(() => ward.id),
    shift_start: ts('shift_start').notNull(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    set_by: staffRef('set_by'),
    set_at: ts('set_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ward_id, t.shift_start, t.admission_id] })],
)

/** Break-the-glass: append-only, read by no endpoint. */
export const ward_access = meniscus.table(
  'ward_access',
  {
    id: id(),
    ward_id: integer('ward_id')
      .notNull()
      .references(() => ward.id),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    reason: text('reason').notNull(),
    created_at: ts('created_at').notNull(),
  },
  (t) => [check('ward_access_reason', sql`length(${t.reason}) BETWEEN 1 AND 200`), index('ward_access_ward').on(t.ward_id, t.created_at)],
)

/** Care orders: time ranges, only ever ended, so the rows are the audit trail. No CHECK on kind (the route validates it). */
export const care_order = meniscus.table(
  'care_order',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    kind: text('kind').notNull(),
    value: jsonb('value').notNull(),
    start_at: ts('start_at').notNull(),
    end_at: ts('end_at'),
    set_by: staffRef('set_by'),
    ended_by: staffRef('ended_by'),
    created_at: ts('created_at').notNull(),
  },
  (t) => [
    check('care_order_range', sql`${t.end_at} IS NULL OR ${t.end_at} >= ${t.start_at}`),
    // At most one active order per admission and kind.
    uniqueIndex('care_order_active')
      .on(t.admission_id, t.kind)
      .where(sql`${t.end_at} IS NULL`),
    index('care_order_admission').on(t.admission_id, t.start_at),
  ],
)

/** One necessity review per catheter order and chart day (`chart_day`: the chart day's start). */
export const care_review = meniscus.table(
  'care_review',
  {
    id: id(),
    order_id: integer('order_id')
      .notNull()
      .references(() => care_order.id),
    chart_day: ts('chart_day').notNull(),
    at: ts('at').notNull(),
    staff_id: staffRef('staff_id'),
  },
  (t) => [unique('care_review_order_id_chart_day_unique').on(t.order_id, t.chart_day)],
)

/**
 * Dietitian referrals (charting/nutrition): one row per referral, a column pair per step, only ever filled in, so the
 * rows are the audit trail. Status is derived. No CHECK on reason or outcome (the route validates them).
 */
export const referral = meniscus.table(
  'referral',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    reason: text('reason').notNull(),
    note: text('note'),
    created_at: ts('created_at').notNull(),
    created_by: staffRef('created_by'),
    acknowledged_at: ts('acknowledged_at'),
    acknowledged_by: staffRef('acknowledged_by'),
    closed_at: ts('closed_at'),
    closed_by: staffRef('closed_by'),
    outcome: text('outcome'),
    /** A local date, YYYY-MM-DD. */
    next_review: text('next_review'),
  },
  (t) => [
    check('referral_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND ${sql.raw(String(REFERRAL_NOTE_MAX))}`),
    check('referral_closed', sql`(${t.closed_at} IS NULL) = (${t.outcome} IS NULL)`),
    check('referral_acknowledged_at', sql`${t.acknowledged_at} IS NULL OR ${t.acknowledged_at} >= ${t.created_at}`),
    check('referral_closed_at', sql`${t.closed_at} IS NULL OR ${t.closed_at} >= ${t.created_at}`),
    // One referral in progress per admission.
    uniqueIndex('referral_in_progress')
      .on(t.admission_id)
      .where(sql`${t.closed_at} IS NULL`),
    index('referral_admission').on(t.admission_id, t.created_at),
  ],
)

/**
 * Dietitian assignments (charting/nutrition "Assign a dietitian"): one row per assignment, only ever ended. No CHECK that
 * staff_id is a dietitian (the route checks the role; a roster change keeps history).
 */
export const admission_dietitian = meniscus.table(
  'admission_dietitian',
  {
    id: id(),
    admission_id: integer('admission_id')
      .notNull()
      .references(() => admission.id),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    assigned_at: ts('assigned_at').notNull(),
    assigned_by: staffRef('assigned_by'),
    ended_at: ts('ended_at'),
    ended_by: staffRef('ended_by'),
  },
  (t) => [
    check('admission_dietitian_range', sql`${t.ended_at} IS NULL OR ${t.ended_at} >= ${t.assigned_at}`),
    check('admission_dietitian_ended', sql`(${t.ended_at} IS NULL) = (${t.ended_by} IS NULL)`),
    // At most one current assignment per admission.
    uniqueIndex('admission_dietitian_current')
      .on(t.admission_id)
      .where(sql`${t.ended_at} IS NULL`),
    index('admission_dietitian_admission').on(t.admission_id, t.assigned_at),
  ],
)

/** Only a hash of each session token is kept. */
export const session = meniscus.table('session', {
  token_hash: text('token_hash').primaryKey(),
  staff_id: integer('staff_id')
    .notNull()
    .references(() => staff.id),
  created_at: ts('created_at').notNull(),
  last_seen_at: ts('last_seen_at').notNull(),
  expires_at: ts('expires_at').notNull(),
})

/** The read log (charting/model-accuracy): closed-list values, numbers and ids only (src/ai/read-log.ts). */
export const model_read = meniscus.table(
  'model_read',
  {
    id: id(),
    kind: text('kind').notNull(),
    mode: text('mode'),
    models: jsonb('models').$type<string[]>().notNull(),
    hint: text('hint'),
    staff_id: integer('staff_id')
      .notNull()
      .references(() => staff.id),
    admission_id: integer('admission_id').references(() => admission.id),
    created_at: ts('created_at').notNull(),
    confidence: doublePrecision('confidence'),
    issues: jsonb('issues').notNull(),
    needs_review: boolean('needs_review').notNull(),
    drafts: integer('drafts').notNull(),
    output: jsonb('output').notNull(),
  },
  (t) => [check('model_read_drafts', sql`${t.drafts} >= 0`), index('model_read_created').on(t.created_at)],
)

/** One saved record per draft of a read; meal_id is for the tray follow-up. */
export const read_link = meniscus.table(
  'read_link',
  {
    read_id: integer('read_id')
      .notNull()
      .references(() => model_read.id),
    draft: integer('draft').notNull(),
    entry_id: integer('entry_id')
      .unique()
      .references(() => entry.id),
    level_id: integer('level_id')
      .unique()
      .references(() => level.id),
    meal_id: integer('meal_id')
      .unique()
      .references(() => meal.id),
    linked_at: ts('linked_at').notNull(),
  },
  (t) => [
    primaryKey({ name: 'read_link_once', columns: [t.read_id, t.draft] }),
    check('read_link_one', sql`num_nonnulls(${t.entry_id}, ${t.level_id}, ${t.meal_id}) = 1`),
  ],
)
