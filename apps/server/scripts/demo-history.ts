/**
 * Fills the empty demo hospital with 24 h of fictional chart history for the demo video.
 * Story beds on Neurology Ward 5B:
 *
 *   5B-4  intake 2100 mL logged, low urine output   → low output + mismatch (the founder story);
 *         its latest urinal is dark amber             → appearance (dark only counts with low output)
 *   5B-2  IV-heavy positive balance                  → overload
 *   5B-5  pink-tinged urine in the latest urinal     → appearance
 *   5B-3  nothing drunk for 7 h                      → logging gap
 *   5B-1  two pending high-confidence captures       → batch approve
 *   5B-6  one pending low-confidence photo reading   → manual review
 *
 * Elsewhere: HDU-2 on IV fluids (overload), 3A-5 with two pending captures, and a routine,
 * prompt-free day on every other occupied bed.
 *
 * Dietitian beds (charting/nutrition), routine beds whose three meals are each eaten 50% or less:
 *
 *   3A-6  meals 25, 50 and 0%, not referred                → poor meal intake (and "Refer to dietitian")
 *   3A-7  meals 0, 50 and 25%, referred by Anita Thomas and
 *         acknowledged by Sana Mirza                       → no prompt; "Referred to dietitian · Sana M." on its card
 *
 * Dietitian care (dietitian-care; no prompt raised or cleared):
 *
 *   HDU-3  renal diet, IDDSI 7, 1800 kcal and 60 g protein, set by Sana Mirza → "Renal diet" badge; on her "Diet orders"
 *   5B-6   regular diet, IDDSI 6, set by Grace Lee              → "Food IDDSI 6" badge; on her "Diet orders"
 *   2C-3   assigned to Sana Mirza, a closed weight_loss referral → on her "Your patients"
 *   3A     one accepted tray with a dish renamed by Anita Thomas (rice → jeera rice when a lunch was charted) → an amended-dish mark
 *
 * Fixed records, for the timeline and the Data quality view:
 *
 *   3A-1  urinal read as 450 mL, corrected to 400 mL at approval
 *   3A-2  approved drink amended afterwards (jug re-measured)
 *   HDU-1 drink entered by hand six hours after it happened (late)
 *   2C-3  same urinal photographed twice; the second rejected as a duplicate
 *
 * Both are urinals so they stay entries: the app saves a urine bag photo as a bag reading, never as an entry.
 *
 * Meals: two or three per bed over the last day (by hand, or a tray photo with a synthetic read), some
 * with soup or dal charted as pending food intake; one 3A meal voided as a duplicate. Story beds get
 * meals without fluid so their prompts stay as described.
 *
 * Served trays (tray-comparison): 3A-1's lunch compared with its served photo (the dal measured), then amended by Anita
 * Thomas; 2C-3 has a served lunch photo waiting. Never 2C-2 (bag-alerts' demo guard reads its meal fluids).
 *
 * Urine carries a colour: photographed bags a synthetic `#rrggbb` (mostly pale straw), and 5B-3's
 * voice note names its colour in words only (no rgb).
 *
 * Care orders (charting/care-plan), each set through the store by the ward's own nurse:
 *
 *   HDU-3  fluid limit 1000 mL total; 820 mL today incl. 200 mL pending → near fluid limit (82%)
 *   HDU-1  urethral catheter inserted five days ago, last reviewed yesterday → catheter day 6, review due
 *   5B-6   thickened fluids, IDDSI 2; a level-0 drink and a drink with none → drink too thin, consistency not recorded
 *   2C-1   nil by mouth until 14:00, a drink charted during it            → intake while NBM; past its planned end after 14:00
 *   3A-4   intake target 1600 mL; 600 mL today                            → behind intake target from the 14:00 check
 *   5B-5   acuity watch (charting/acuity); HDU beds are critical by the ward default, every other bed stable, and a
 *          stable bed with a red prompt (5B-4's low output, 5B-2's overload) shows "Suggested critical · Review"
 *
 * Bag readings (charting/bag-periods): each bed's urine bag is read and emptied through the store, so its rises, periods
 * and prompts come from the real code path; every bag entry is approved by the ward's nurse except each bag's newest.
 *
 *   HDU-1  emptied 4-hourly overnight and 6 h ago, then hourly
 *          checks rising ~62 mL                                  → hourly periods, no bag prompt (catheter review only)
 *   3A-3   emptied every ~4 h, one early partial emptying with an
 *          after-emptying photo and 30 mL left; checked 30 min ago → no prompt (catheter reviewed today)
 *   2C-5   emptied ~400 mL every 4 h, last checked 4.5 h ago      → urine bag reading due (catheter reviewed today)
 *   2C-6   checked at 800 mL, then at 150 mL 2 h ago             → bag level fell (pending, for "Add missed emptying")
 *   2C-2   catheter ordered 24.5 h ago with "Bag reading every 2 h" (reviewed today); urine bag changed then, checked
 *          every 2 h (~110 mL a time), emptied once 12.5 h ago, newest check 30 min ago at 660 mL; drain bag checked by
 *          hand at 300, 560 and 820 mL (1 h ago)                → bag nearly full (the drain, 82% of 1000 mL)
 *          Decay with no write: just after +1.5 h bag reading due (more than 2 h since the newest check); at +3.5 h
 *          bag reading overdue, low urine output (the window returns to now, with no approved urine) and
 *          "Suggested critical · Review".
 *   2C-3   ileostomy bag emptied by hand at 300, 260 and 280 mL about every 6 h, checked at 150 mL 1 h ago → no prompt
 *
 * Output devices (patient-devices), as care orders, so each bed's capture choices, badges and prompts follow them:
 *
 *   catheter (urine bag)  HDU-1, 3A-3, 2C-5, 2C-6 (reviewed today) and 2C-2, which also has an abdominal drain
 *   stoma                 2C-3, an ileostomy from admission
 *   commode               2C-1, 3A-4 and 5B-6; bedpan HDU-3
 *   toilet, not measured  3A-7: no urine charted, so neither low output nor overload despite its intake
 *   urinal (the default)  every other bed
 *
 * Each photographed urine entry is read in its bed's own vessel (urinal, bedpan or commode pan, drawn like the urinal);
 * urine bag photos exist only as the catheter beds' bag readings. A guard checks the devices, that no bed raises
 * `bag_without_device`, and the vessels.
 *
 * Model accuracy (charting/model-accuracy): a read is logged a minute before each record the app would have drafted
 * from one (every voice and typed entry, every photo entry, every jug level and every bag reading), by the same staff
 * member for the same bed, and the record links it. The mix the Data quality view shows:
 *
 *   accepted            every other linked record (every approved photo urine entry included) and every linked bag reading
 *   pending             the pending captures: the voice notes and the urine photos of 5B-1, 5B-6 and 3A-5
 *   corrected_by_nurse  3A-1 (450 → 400 mL at approval) and 3A-2 (voice 200 → 250 mL amend)
 *   edited_at_capture   3A-6: a urinal read as 300 mL, saved as 400 mL
 *   rejected            2C-3's duplicate
 *   abandoned           3A-6: a urinal read as 350 mL 14 h ago, never saved
 *   negative_confirmed  3A-5: no container in view, nothing drafted, 9 h ago
 *   negative_overridden 3A-6: no container, drafted water, saved as a pending 200 mL drink
 *
 * Trays (accuracy-views): every photo meal with evidence has a tray read a minute before it, by the same staff member
 * for the same bed, and the meal links it. Its tray rows show:
 *
 *   accepted            every other linked photo meal, its fluid approved or with none
 *   pending             the newest photo meals with fluid, still pending
 *   rejected            3A-4's lunch voided as a duplicate (always a tray photo)
 *   edited_at_capture   every third tray (the second dish saved finished), and one older 3A tray whose curry the read
 *                       took for dal, saved as curry (the dish kind correction under "Most changed")
 *   corrected_by_nurse  3A-1's compared lunch (curry amended by Anita Thomas), and one older 3A tray whose fluid entry
 *                       the nurse rejected as a duplicate (meal fluid `removed`)
 *   negative_confirmed  3A-5: a `not_a_meal` tray read with no draft, 2 h ago
 *   open                3A-6: Ravi Kumar's lunch tray read an hour ago (rice 50, dal 100, 150 mL), never saved; the
 *                       browser check saves it
 *   retaken             one 3A meal over 12 h old: its bed read twice by the same staff 4 minutes apart, the first never
 *                       saved (it would otherwise be abandoned)
 *
 * A guard checks that mix (negative_confirmed per kind: photo 1, tray 1), and that every bed's prompts are as they were
 * before the 3A-5 and 3A-6 additions.
 *
 * Run it between 14:00 and 08:00 to see every one of these prompts; earlier runs show the NBM and target badges
 * without the two time-based prompts. Limits and targets count the chart day (from 08:00). After seeding, a guard
 * checks each of these beds raises exactly its intended prompts for the time of the run, and throws otherwise.
 *
 * Entries are attributed to the fictional demo roster, each by the ward's own team: no attendant approves, amends,
 * rejects or voids; IV fluids are recorded by nurses; HDU, with no attendants, is charted by its nurses. Photo, voice and typed entries carry
 * synthetic read evidence (model steps, reading, SAM boxes): made up here, not model output.
 *
 * Kept media is synthetic too: drawn PNGs of the bags, jugs, cups and trays whose shapes match the stored SAM boxes,
 * and for each voice note a short WAV of beeps (labelled synthetic in the file) with the transcript split into timed
 * turns. 5B-4's jug is two level pairs (1500 → 1100 → 650 mL), so its intake entries show the before and after photos.
 *
 *   pnpm --filter @meniscus/server demo
 *
 * No model requests. Refuses to touch a database (DATABASE_URL) that already has entries.
 */
import { count, isNotNull } from 'drizzle-orm'
import type {
  DishKind,
  DishValue,
  Meal,
  MealDish,
  MealFluidKind,
  AlertKind,
  BagContainer,
  BagEvent,
  CaptureReadResult,
  ContainerKind,
  MealDraft,
  MealReadResult,
  DraftEntry,
  DrinkKind,
  Entry,
  EntryCategory,
  EntryEvidence,
  EntrySource,
  FluidKind,
  IddsiLevel,
  MealEvidenceInput,
  MealKind,
  OutputDevices,
  PhotoEvidence,
  Portion,
  RejectReason,
  Segmentation,
  UrineColour,
  VoidingMethod,
} from '@meniscus/shared'
import {
  BAG_CONTAINERS,
  CATEGORY_DIRECTION,
  DECIDER_ROLES,
  IN_CHARGE_ROLES,
  TEAM_ROLES,
  MIN_N,
  READ_OUTCOMES,
  URINE_REFERENCE,
  VOIDING_CONTAINER,
  chartDay,
  joinItems,
  liquidVolumeMl,
} from '@meniscus/shared'
import { toDraft } from '../src/ai/draft.ts'
import { readRow, type ReadRow } from '../src/ai/read-log.ts'
import { matchRegions, measureDishes } from '../src/ai/compare.ts'
import { imageSize } from '../src/ai/image-size.ts'
import { layoutTray, packMask } from '../src/ai/tray.ts'
import { modelQuality } from '../src/chart/model-accuracy.ts'
import { chartView, worklistView } from '../src/chart/view.ts'
import { config } from '../src/config.ts'
import { createDb, migrateDb } from '../src/db/client.ts'
import { admission, entry, read_link } from '../src/db/schema.ts'
import { sha256Hex } from '../src/hash.ts'
import { DEMO_STAFF, DEMO_TEAMS } from '../src/store/demo-hospital.ts'
import { seedMedia, type SeedInput } from '../src/lab/seed-media.ts'
import { createMediaStore } from '../src/store/media/create.ts'
import { MediaStoreError } from '../src/store/media/port.ts'
import { openPgStore } from '../src/store/pg/store.ts'
import { evenTurns, toneWav } from './synthetic-audio.ts'
import { bagPhoto, trayMasks, trayPhoto, vesselPhoto } from './synthetic-photo.ts'

const HOUR = 3_600_000
if (config.DATABASE_URL === undefined) {
  console.error('demo history: DATABASE_URL is not set (run pnpm dev:stack for a local Postgres, then set it in .env)')
  process.exit(1)
}
const url = config.DATABASE_URL
await migrateDb({ url: config.DATABASE_SESSION_URL ?? url, caFile: config.DATABASE_CA_FILE })
const handle = createDb({ url, caFile: config.DATABASE_CA_FILE, max: config.DATABASE_POOL_MAX })

const now = Date.now()
const clock = { t: now }
const store = await openPgStore(handle.db, { now: () => clock.t, close: () => handle.close() })
// Photos and tones go to the configured media store (MEDIA_STORE; the bucket with s3), written before the summary line.
const media = createMediaStore(config)
const kept = seedMedia(store, media)

const [{ n = 0 } = {}] = await handle.db.select({ n: count() }).from(entry)
if (n > 0) {
  console.error(`demo history: the database already has ${n} entries; demo history only fills an empty ward. Use an empty database.`)
  await store.close()
  process.exit(2)
}
// Admitted two days ago, so the 6 h and 3 h rules apply.
await handle.db.update(admission).set({ admitted_at: new Date(now - 48 * HOUR) })

type Row = [bed: string, hoursAgo: number, category: EntryCategory, ml: number, opts?: Opts]
type WardRow = [ward: string, ...Row]
interface Opts {
  item?: string
  notes?: string
  source?: EntrySource
  confidence?: number
  status?: 'approved' | 'pending' | 'rejected'
  /** Staff ids; default to the ward's own team (see `recordersOf`, `nursesOf`). */
  by?: number
  reviewer?: number
  /** Approved with this volume instead (a correction). */
  approveAs?: number
  reason?: RejectReason
  note?: string
  /** Amended this many hours after approval. */
  amend?: { ml: number; reason: string; by: number; after: number }
  /** Saved this many hours after it happened (a late entry). */
  lateBy?: number
  /** Urine colour; photo urine defaults to pale straw. `rgb` only for photos. */
  colour?: UrineColour
  rgb?: string
  /** A water-jug level pair: the row's entry is the drop from `from` to `to` (a baseline level is added if needed). */
  jug?: { from: number; to: number }
  /** A drink's IDDSI level. */
  iddsi?: IddsiLevel
  /** A drink's kind (drink-types); set on every `water` row by `withDrinks`. */
  drink?: DrinkKind
  /**
   * The vessel a photographed urine entry was read in: the bed's own (patient-devices), set by the history loop from
   * its voiding order. A urine bag photo is never an entry: the app saves it as a bag reading.
   */
  container?: UrineVessel
  /** The volume the read drafted, when the attendant saved another (an edit at capture). */
  drafted?: number
}

/** Synthetic pale-straw shades for photographed bags; varied so the runs read as real photos. */
const PALE = ['#efe39b', '#f1e6a6', '#ead77e', '#e7d073', '#f0e29a']
function urineColour(category: EntryCategory, o: Opts, n: number): { urine_colour?: UrineColour; urine_rgb?: string | null } {
  if (category !== 'urine') return {}
  const colour = o.colour ?? (o.source === 'photo' ? 'pale' : undefined)
  if (!colour) return {}
  const rgb = o.source === 'photo' ? (o.rgb ?? (colour === 'pale' ? PALE[n % PALE.length]! : URINE_REFERENCE[colour])) : null
  return { urine_colour: colour, urine_rgb: rgb }
}

const STORY: Row[] = [
  // bed 4: intake well documented, output low → "review before ordering tests"
  ['4', 20, 'water', 400, { source: 'photo', confidence: 0.91, item: 'water jug: 1500 → 1100 mL', jug: { from: 1500, to: 1100 } }],
  ['4', 18, 'urine', 600, { source: 'photo', confidence: 0.88 }],
  ['4', 16, 'water', 300, { source: 'voice', item: 'tea' }],
  ['4', 13, 'food', 500, { source: 'photo', confidence: 0.8, item: 'lunch: dal, rice, soup' }],
  ['4', 9, 'water', 450, { source: 'photo', confidence: 0.9, item: 'water jug: 1100 → 650 mL', jug: { from: 1100, to: 650 } }],
  ['4', 5, 'water', 250, { source: 'text', item: 'coconut water' }],
  ['4', 4, 'urine', 150, { source: 'photo', confidence: 0.86, notes: 'dark amber, clear', colour: 'dark', rgb: '#c4892a' }],
  ['4', 2, 'water', 200, { source: 'voice', item: 'tea' }],
  // bed 2: IV running, balance climbing
  ['2', 12, 'iv', 1500, { source: 'manual', item: 'normal saline' }],
  ['2', 8, 'urine', 500, { source: 'photo', confidence: 0.9 }],
  ['2', 6, 'iv', 1000, { source: 'manual', item: 'normal saline' }],
  ['2', 2, 'urine', 400, { source: 'photo', confidence: 0.87 }],
  ['2', 1, 'water', 300, { source: 'voice' }],
  // bed 5: pink tinge seen in the photo
  ['5', 10, 'water', 700, { source: 'photo', confidence: 0.92 }],
  ['5', 7, 'urine', 300, { source: 'photo', confidence: 0.85, notes: 'yellow, clear', colour: 'yellow', rgb: '#e0c04f' }],
  ['5', 3, 'urine', 350, { source: 'photo', confidence: 0.83, notes: 'pink tinge', colour: 'pink', rgb: '#dfa29c' }],
  ['5', 2, 'water', 600, { source: 'photo', confidence: 0.9 }],
  // bed 3: nothing drunk since this morning
  ['3', 7, 'water', 300, { source: 'voice', item: 'water' }],
  ['3', 5, 'urine', 250, { source: 'photo', confidence: 0.9 }],
  ['3', 2, 'urine', 200, { source: 'voice', notes: 'yellow', colour: 'yellow' }],
  // bed 1: quiet, two captures waiting
  ['1', 11, 'water', 500, { source: 'photo', confidence: 0.9 }],
  ['1', 8, 'urine', 450, { source: 'photo', confidence: 0.9 }],
  ['1', 4, 'urine', 300, { source: 'photo', confidence: 0.92 }],
  ['1', 1, 'water', 250, { source: 'photo', confidence: 0.88 }],
  ['1', 0.5, 'urine', 400, { source: 'photo', confidence: 0.92, status: 'pending', notes: 'pale yellow, clear' }],
  ['1', 0.3, 'water', 200, { source: 'voice', confidence: 0.8, status: 'pending', item: 'orange juice' }],
  // bed 6: one unsure reading for the nurse to check; thickened fluids (IDDSI 2) ordered
  ['6', 9, 'water', 600, { source: 'photo', confidence: 0.9, iddsi: 2 }],
  ['6', 7, 'water', 200, { source: 'photo', confidence: 0.9, item: 'water' }], // saved on a round: no consistency recorded
  ['6', 5.5, 'water', 150, { source: 'voice', item: 'water', by: 3, iddsi: 0 }], // thinner than ordered
  ['6', 5, 'urine', 400, { source: 'photo', confidence: 0.9 }],
  ['6', 2, 'water', 300, { source: 'photo', confidence: 0.9, iddsi: 2 }],
  ['6', 0.4, 'urine', 300, { source: 'photo', confidence: 0.6, status: 'pending', notes: 'pan tilted, marks partly hidden' }],
]

const ANITA = 4
const GRACE = 5
const MEERA = 6
const NIKHIL = 7
const DIVYA = 8
const SANA = 11

const EXTRA: WardRow[] = [
  // Fixed records (see the header).
  [
    '3A',
    '1',
    3.2,
    'urine',
    450,
    { source: 'photo', confidence: 0.84, notes: 'pale yellow, clear', container: 'urinal', by: 1, reviewer: ANITA, approveAs: 400 },
  ],
  [
    '3A',
    '2',
    5.5,
    'water',
    200,
    { source: 'voice', item: 'water', by: 2, reviewer: ANITA, amend: { ml: 250, reason: 'jug re-measured', by: GRACE, after: 1 } },
  ],
  ['HDU', '1', 8, 'water', 200, { source: 'manual', item: 'water', by: NIKHIL, reviewer: NIKHIL, lateBy: 6 }],
  ['2C', '3', 2.6, 'urine', 400, { source: 'photo', confidence: 0.9, notes: 'pale yellow, clear', container: 'urinal', by: 1 }],
  [
    '2C',
    '3',
    2.55,
    'urine',
    400,
    {
      source: 'photo',
      confidence: 0.9,
      notes: 'pale yellow, clear',
      container: 'urinal',
      by: 1,
      status: 'rejected',
      reviewer: MEERA,
      reason: 'duplicate',
      note: 'same bag photographed twice',
    },
  ],
  // HDU bed 2: renal patient on IV fluids, balance climbing
  ['HDU', '2', 20, 'iv', 1000, { source: 'manual', item: 'normal saline' }],
  ['HDU', '2', 16, 'urine', 400, { source: 'photo', confidence: 0.9 }],
  ['HDU', '2', 12, 'iv', 1000, { source: 'manual', item: 'normal saline' }],
  ['HDU', '2', 8, 'urine', 350, { source: 'photo', confidence: 0.88 }],
  ['HDU', '2', 4, 'iv', 1000, { source: 'manual', item: 'normal saline' }],
  ['HDU', '2', 2.5, 'water', 200, { source: 'voice', item: 'water' }],
  ['HDU', '2', 2, 'urine', 300, { source: 'photo', confidence: 0.9 }],
  // 3A bed 5: two captures waiting on top of a routine day
  ['3A', '5', 0.4, 'urine', 350, { source: 'photo', confidence: 0.9, status: 'pending', notes: 'pale yellow, clear' }],
  ['3A', '5', 0.2, 'water', 200, { source: 'voice', confidence: 0.8, status: 'pending', item: 'tea' }],
]

const DRINKS = ['water', 'tea', 'water jug', 'juice', 'coconut water']
const SOURCES = ['photo', 'voice', 'photo', 'text'] as const

/** A quiet, prompt-free day: a drink and an emptied bag about every 3 h, the latest within 2 h. */
function routine(ward: string, bed: string, n: number): WardRow[] {
  const shift = (n % 3) * 0.3
  const rows: WardRow[] = []
  for (const [i, h] of [22, 19, 16, 13, 10, 7, 4, 1].entries()) {
    const source = SOURCES[(n + i) % SOURCES.length]!
    const item = DRINKS[(n + i) % DRINKS.length]!
    rows.push([
      ward,
      bed,
      h + shift,
      'water',
      250 + ((n * 37 + i * 13) % 5) * 25,
      { source, item, ...(source === 'photo' && { confidence: 0.9 }) },
    ])
  }
  for (const [i, h] of [21, 18, 15, 12, 9, 6, 3, 1.5].entries()) {
    rows.push([
      ward,
      bed,
      h + shift,
      'urine',
      300 + ((n * 29 + i * 11) % 5) * 25,
      { source: 'photo', confidence: 0.86 + (n % 4) * 0.02, notes: 'pale yellow, clear' },
    ])
  }
  return rows
}

/**
 * Who acts on a ward is its own team (DEMO_TEAMS): nurses approve, amend, reject and void, and chart IV fluids;
 * attendants record everything else, and on a ward with none (HDU) its nurses chart their own patients.
 */
const teamOf = (ward: string) => DEMO_STAFF.filter((s) => DEMO_TEAMS[s.id]?.includes(ward) && TEAM_ROLES.includes(s.role))
const nursesOf = (ward: string) =>
  teamOf(ward)
    .filter((s) => IN_CHARGE_ROLES.includes(s.role))
    .map((s) => s.id)
const recordersOf = (ward: string) => {
  const attendants = teamOf(ward)
    .filter((s) => !DECIDER_ROLES.includes(s.role))
    .map((s) => s.id)
  return attendants.length ? attendants : nursesOf(ward)
}
const pick = (ids: number[], i: number) => {
  if (!ids.length) throw new Error('demo history: a ward with nobody to act on it')
  return ids[i % ids.length]!
}

type UrineVessel = 'urinal' | 'bedpan' | 'commode_pan'
type Vessel = 'water_jug' | 'measuring_jug' | 'cup' | UrineVessel
/** Drawn vessels: capacity and the container box in the synthetic photo's pixels. */
const VESSEL: Record<Vessel, { capacity: number; box: { left: number; top: number; right: number; bottom: number } }> = {
  water_jug: { capacity: 1500, box: { left: 290, top: 300, right: 670, bottom: 1120 } },
  measuring_jug: { capacity: 1000, box: { left: 310, top: 440, right: 650, bottom: 1120 } },
  cup: { capacity: 400, box: { left: 330, top: 720, right: 630, bottom: 1120 } },
  urinal: { capacity: 1000, box: { left: 300, top: 420, right: 660, bottom: 1120 } },
  bedpan: { capacity: 1000, box: { left: 300, top: 420, right: 660, bottom: 1120 } },
  commode_pan: { capacity: 1500, box: { left: 300, top: 420, right: 660, bottom: 1120 } },
}
/** The colour drawn for each drink kind in a synthetic photo. */
const DRINK_COLOUR: Record<DrinkKind, string> = {
  water: '#cfe6f4',
  tea: '#b77a3c',
  coffee: '#6f4a2e',
  milk: '#f4f1e8',
  juice: '#f0a234',
  coconut_water: '#ecefdc',
  buttermilk: '#eef0e6',
  ors: '#e9eedf',
  supplement: '#e8dcc4',
  soup: '#d79b3a',
  other: '#d8dde3',
}
/** What a photographed drink is (its kind, read as that fluid), and the colour drawn for it. */
function drinkOf(o: Opts, category: EntryCategory): { fluid: FluidKind; colour: string } {
  if (category === 'food') return { fluid: 'soup', colour: DRINK_COLOUR.soup }
  const drink = o.drink ?? 'water'
  return { fluid: drink, colour: DRINK_COLOUR[drink] }
}
/**
 * SAM-shaped masks for synthetic evidence (ui-polish "Masks kept with the segmentation"): the container and liquid as
 * the rounded shapes `synthetic-photo.ts` draws (corner radius in source pixels), packed at MASK_GRID over their boxes
 * as a read packs SAM's rasters, with the liquid's region volume (fill × capacity). Synthetic geometry, never model output.
 */
const rounded = (b: { left: number; top: number; right: number; bottom: number }, r: number) =>
  packMask(b, (x, y) => {
    const dx = Math.max(b.left + r - x, 0, x - (b.right - r))
    const dy = Math.max(b.top + r - y, 0, y - (b.bottom - r))
    return dx * dx + dy * dy <= r * r
  })
function withMasks(seg: Segmentation, capacity: number, containerR: number, fluidR: number): Segmentation {
  return {
    ...seg,
    container_mask: seg.container ? rounded(seg.container, containerR) : null,
    fluid_mask: seg.fluid ? rounded(seg.fluid, fluidR) : null,
    fluid_volume_ml: liquidVolumeMl(seg.fill_fraction, capacity),
  }
}
const markBasis = (ml: number) => {
  const low = Math.floor(ml / 100) * 100
  return ml % 100 === 0 ? `liquid surface level with the ${ml} mL mark` : `liquid surface between the ${low} and ${low + 100} mL marks`
}
const photoTrace = (jitter: number) => [
  { step: 'sam:container', model: 'sam-3.1', ms: 1900 + jitter },
  { step: 'sam:liquid', model: 'sam-3.1', ms: 2000 + jitter },
  { step: 'spark:read', model: 'muse-spark-1.3', ms: 3800 + 2 * jitter, input_tokens: 1750, output_tokens: 110 },
]

/** A synthetic read of a drink or jug level in a drawn vessel. */
function vesselEvidence(vessel: Vessel, ml: number, fluid: FluidKind, colour: string, confidence: number, n: number): PhotoEvidence {
  const { capacity, box } = VESSEL[vessel]
  const h = box.bottom - box.top
  const fill = Math.min(0.97, ml / capacity + ((n % 5) - 2) * 0.008)
  return {
    kind: 'photo',
    mode: 'sam+spark',
    reading: {
      container: vessel satisfies ContainerKind,
      fluid,
      volume_ml: ml,
      capacity_ml: capacity,
      marks_visible: true,
      reading_basis: markBasis(ml),
      appearance: null,
      confidence,
      issues: [],
    },
    segmentation: withMasks(
      {
        container: { ...box, confidence: 0.94 },
        fluid: {
          left: box.left + 10,
          top: Math.round(box.bottom - fill * h),
          right: box.right - 10,
          bottom: box.bottom - 8,
          confidence: 0.9,
        },
        fill_fraction: Math.round(fill * 1000) / 1000,
      },
      capacity,
      16,
      10,
    ),
    review_reasons: [],
    trace: photoTrace((n * 37) % 400),
    colour,
  }
}

/** Synthetic read evidence shaped like a real read; never model output. */
function evidenceFor(bed: string, category: EntryCategory, ml: number, o: Opts, n: number): EntryEvidence | null {
  const jitter = (n * 37) % 400
  if (o.source === 'photo' && category === 'urine' && o.container) {
    const { urine_colour = null, urine_rgb = null } = urineColour(category, o, n)
    const ev = vesselEvidence(o.container, o.drafted ?? ml, 'urine', urine_rgb ?? '#e2c35b', o.confidence ?? 0.88, n)
    return { ...ev, reading: { ...ev.reading, appearance: o.notes ?? 'pale yellow, clear', urine_colour, urine_rgb } }
  }
  // A urine bag: only a bag reading's photo (the bag-reading loop below), never an entry's.
  if (o.source === 'photo' && category === 'urine') {
    const fill = Math.min(0.95, ml / 2000 + ((n % 5) - 2) * 0.01)
    const bottom = 1180
    const top = 140
    const surface = Math.round(bottom - fill * (bottom - top))
    const low = Math.floor(ml / 100) * 100
    const { urine_colour = null, urine_rgb = null } = urineColour(category, o, n)
    return {
      kind: 'photo',
      mode: 'sam+spark',
      reading: {
        container: 'urine_bag',
        fluid: 'urine',
        volume_ml: ml,
        capacity_ml: 2000,
        marks_visible: true,
        reading_basis:
          ml % 100 === 0 ? `liquid surface level with the ${ml} mL mark` : `liquid surface between the ${low} and ${low + 100} mL marks`,
        appearance: o.notes ?? 'pale yellow, clear',
        urine_colour,
        urine_rgb,
        confidence: o.confidence ?? 0.88,
        issues: (o.confidence ?? 1) < 0.7 ? ['occluded'] : [],
      },
      segmentation: withMasks(
        {
          container: { left: 280, top, right: 720, bottom, confidence: 0.93 },
          fluid: { left: 296, top: surface, right: 704, bottom: bottom - 12, confidence: 0.9 },
          fill_fraction: Math.round(fill * 1000) / 1000,
        },
        2000,
        40,
        26,
      ),
      review_reasons: (o.confidence ?? 1) < 0.7 ? ['Low confidence reading: check the photo'] : [],
      trace: photoTrace(jitter),
      colour: urine_rgb ?? '#e2c35b',
    }
  }
  if (o.source === 'photo' && (category === 'water' || category === 'food')) {
    const { fluid, colour } = drinkOf(o, category)
    const ev = vesselEvidence(ml <= 350 ? 'cup' : 'measuring_jug', ml, fluid, colour, o.confidence ?? 0.88, n)
    // The read named the drink (capture/photo-reading "Drink name bounds"); the draft's item is that name.
    return { ...ev, reading: { ...ev.reading, drink_name: category === 'water' ? (o.item ?? null) : null } }
  }
  if (o.source === 'voice' || o.source === 'text') {
    const what = o.item ?? (category === 'urine' ? 'urine' : 'water')
    const transcript =
      o.source === 'voice'
        ? category === 'urine'
          ? `bed ${bed} passed ${ml} mL${o.colour ? ` ${o.colour}` : ''} urine`
          : `bed ${bed} had ${what} ${ml} mL`
        : `${what} ${ml} ml`
    return {
      kind: o.source,
      transcript,
      draft_ml: ml,
      trace: [
        ...(o.source === 'voice' ? [{ step: 'asr', model: 'muse-voice-transcribe-1.0', ms: 800 + jitter }] : []),
        { step: 'spark:note', model: 'muse-spark-1.3', ms: 1900 + jitter, input_tokens: 900, output_tokens: 60 },
      ],
      // The synthetic tone's length and the transcript at even times (see synthetic-audio.ts).
      ...(o.source === 'voice' && evenTurns(transcript)),
    }
  }
  return null
}

let mediaCount = 0
/** Keeps the synthetic photo or tone behind a read, as the app would upload it; its id for the record. */
async function mediaFor(admissionId: number, ev: EntryEvidence | null, by: number): Promise<number | undefined> {
  let input: SeedInput | null = null
  const bytes = ev?.kind === 'photo' ? photoBytes(ev) : null
  if (bytes) {
    input = { kind: 'photo', mime: 'image/png', bytes }
  } else if (ev?.kind === 'voice' && ev.turns) {
    input = { kind: 'voice', mime: 'audio/wav', bytes: toneWav(ev.duration_ms ?? 0, ev.turns), duration_ms: ev.duration_ms ?? null }
  }
  if (!input) return undefined
  mediaCount++
  return (await kept.keep(admissionId, input, by))!.id
}

/** The synthetic photo drawn for segmented photo evidence; null without a container and fluid region. */
function photoBytes(ev: PhotoEvidence): Uint8Array | null {
  if (!ev.segmentation?.container || !ev.segmentation.fluid) return null
  const { container, fluid } = ev.segmentation
  const colour = ev.colour ?? '#e2c35b'
  return ev.reading.container === 'urine_bag'
    ? bagPhoto(container, fluid, colour)
    : vesselPhoto(container, fluid, colour, ev.reading.capacity_ml ?? 1000)
}

/** The pipeline result behind synthetic photo evidence, as `/api/ai/read` would have returned it. */
const photoResult = (ev: PhotoEvidence): CaptureReadResult => ({
  mode: ev.mode,
  // Synthetic history: the SHA-256 of the synthetic photo drawn for it (of its reading when none is drawn), as a read names its bytes.
  image_sha256: ev.image_sha256 ?? sha256Hex(photoBytes(ev) ?? new TextEncoder().encode(`demo read ${JSON.stringify(ev.reading)}`)),
  reading: ev.reading,
  segmentation: ev.segmentation,
  draft: toDraft(ev.reading),
  needs_review: ev.review_reasons.length > 0,
  warnings: ev.review_reasons,
  trace: ev.trace,
  ms: ev.trace.reduce((s, c) => s + c.ms, 0),
})

let readCount = 0
/**
 * Logs the read the app would have made for a record (charting/model-accuracy), a minute before it is saved, by the same
 * staff member for the same bed; its id for the record's `read_id`. Built with the app's own `readRow`, so only closed-list
 * values and numbers are kept. Synthetic, never model output; no model request.
 */
async function logRead(
  admissionId: number,
  by: number,
  read: { kind: 'photo'; evidence: PhotoEvidence } | { kind: 'text' | 'voice'; drafts: DraftEntry[]; trace: PhotoEvidence['trace'] },
): Promise<number> {
  const saved = clock.t
  clock.t -= 60_000
  const ctx = { staffId: by, admissionId }
  const row: ReadRow =
    read.kind === 'photo'
      ? readRow('photo', photoResult(read.evidence), ctx)
      : readRow(read.kind, { entries: read.drafts, reply: null, trace: read.trace }, ctx)
  const id = await store.recordRead(row)
  clock.t = saved
  readCount++
  return id
}

/**
 * Logs the tray read the app would have made for a photo meal (charting/model-accuracy "Tray reads are logged"), `before`
 * ms before `clock.t`, by the same staff member for the same bed, built with the app's own `readRow('tray', …)` from the
 * meal's synthetic evidence and draft. Its id for the meal's `read_id`. Synthetic, never model output; no model request.
 */
async function logTrayRead(
  admissionId: number,
  by: number,
  evidence: MealEvidenceInput,
  draft: MealDraft,
  before = 60_000,
): Promise<number> {
  const saved = clock.t
  clock.t -= before
  const result: MealReadResult = {
    ...evidence,
    draft,
    needs_review: evidence.reading.confidence < 0.75 || evidence.reading.issues.length > 0,
    ms: evidence.trace.reduce((s, c) => s + c.ms, 0),
  }
  const id = await store.recordRead(readRow('tray', result, { staffId: by, admissionId }))
  clock.t = saved
  readCount++
  return id
}
/** A tray read's draft, as the pipeline builds it from the read's dishes and fluids. */
const trayDraft = (reading: MealEvidenceInput['reading']): MealDraft => {
  const fluid = reading.fluids.reduce((n, f) => n + f.volume_ml, 0)
  return {
    portion: reading.portion,
    items: joinItems(reading.dishes),
    fluid_ml: fluid > 0 ? fluid : null,
    dishes: reading.dishes.map(({ index, name, dish_kind, portion }) => ({ index, name, dish_kind, portion })),
  }
}

/** A water-jug reading as a level: its own photo and read, and the drop entry when it is lower than the last one. */
async function jugLevel(admissionId: number, ml: number, confidence: number, n: number, by: number): Promise<Entry | null> {
  const evidence = vesselEvidence('water_jug', ml, 'water', '#cfe6f4', confidence, n)
  const media_id = await mediaFor(admissionId, evidence, by)
  const read_id = await logRead(admissionId, by, { kind: 'photo', evidence })
  const r = await store.addLevel(
    admissionId,
    { container: 'water_jug', volume_ml: ml, source: 'photo', confidence, evidence, media_id, read_id },
    by,
  )
  return r!.entry
}

// ---------- care plan stories, placed relative to the chart day ----------

const day = chartDay(now)
/** `HH:MM` on the chart day's date (local). */
const onDayDate = (hm: string) => {
  const d = new Date(day.start)
  const [h = 0, m = 0] = hm.split(':').map(Number)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime()
}
/** Hours ago, but inside the chart day: a minute after its start at the earliest (or now, in its first minute). */
const inDay = (h: number) => Math.min(h * HOUR, Math.max(0, now - day.start - 60_000)) / HOUR
const ADMITTED = now - 48 * HOUR
/** 2C-1: nil by mouth until 14:00 on the chart day's date, from the earlier of 10:00 that day and an hour ago. */
const NBM_UNTIL = onDayDate('14:00')
const NBM_START = Math.min(onDayDate('10:00'), now - HOUR)
/** Beds whose intake rows are the story's; they keep their routine output. */
const careBeds = new Set(['HDU-3', '2C-1', '3A-4'])
const CARE_ROWS: WardRow[] = [
  // HDU-3: 820 of a 1000 mL total limit today, 200 mL of it pending.
  ['HDU', '3', inDay(2.5), 'water', 400, { source: 'photo', confidence: 0.9, item: 'water' }],
  ['HDU', '3', inDay(1.5), 'iv', 220, { source: 'manual', item: 'normal saline' }],
  ['HDU', '3', inDay(0.5), 'water', 200, { source: 'voice', item: 'tea', status: 'pending' }],
  // 2C-1: a drink charted while nil by mouth, still pending.
  ['2C', '1', (now - (NBM_START + now) / 2) / HOUR, 'water', 150, { source: 'voice', item: 'water', status: 'pending' }],
  // 3A-4: 600 mL today against a 1600 mL target.
  ...[2.5, 1.5, 0.5].map((h): WardRow => ['3A', '4', inDay(h), 'water', 200, { source: 'text', item: 'water' }]),
]
/** A care bed's routine rows: its output, and for HDU-3 and 2C-1 the drinks before the chart day or nil by mouth. */
function careRoutine(ward: string, bed: string, n: number): WardRow[] {
  const before = { 'HDU-3': day.start, '2C-1': NBM_START }[key(ward, bed)]
  return routine(ward, bed, n).filter((r) => CATEGORY_DIRECTION[r[3]] === 'out' || (before !== undefined && now - r[2] * HOUR < before))
}

const admissions = await store.admissions()
const key = (ward: string, bed: string) => `${ward}-${bed}`
const beds = new Map(admissions.map((a) => [key(a.ward_code, a.bed), a.id]))
const scripted = new Set(['5B-1', '5B-2', '5B-3', '5B-4', '5B-5', '5B-6', 'HDU-2'])

/**
 * A bag reading: hours ago, event, level, an after-emptying residual (with its proof photo), and the bag (`urine_bag`,
 * photographed, unless named; any other bag is read by hand).
 */
type BagStep = [hoursAgo: number, event: BagEvent, level: number, residual?: number, container?: BagContainer]
const BAG_STORIES: Record<string, BagStep[]> = {
  'HDU-1': [
    // Emptied 4-hourly overnight (the day's output, so its 24 h balance stays even), then checked hourly.
    [18.2, 'emptied', 400],
    [14.2, 'emptied', 420],
    [10.2, 'emptied', 380],
    [6.2, 'emptied', 450],
    [5.2, 'check', 62],
    [4.2, 'check', 125],
    [3.2, 'check', 188],
    [2.2, 'check', 250],
    [1.2, 'check', 313],
    [0.2, 'check', 375],
  ],
  '3A-3': [
    [14, 'emptied', 380],
    [10, 'emptied', 400],
    [7.5, 'emptied', 185, 30],
    [3.5, 'emptied', 430],
    [0.5, 'check', 120],
  ],
  '2C-5': [
    [13.5, 'emptied', 410],
    [9.5, 'emptied', 390],
    [5.5, 'emptied', 400],
    [4.5, 'check', 90],
  ],
  '2C-6': [
    [14, 'emptied', 600],
    [10, 'check', 300],
    [5.5, 'check', 800],
    [2, 'check', 150],
  ],
  // patient-devices: 2C-3's ileostomy bag, by hand, emptied about every 6 h; the newest a check at 150 of 500 mL.
  '2C-3': [
    [19, 'emptied', 300, undefined, 'stoma_bag'],
    [13, 'emptied', 260, undefined, 'stoma_bag'],
    [7, 'emptied', 280, undefined, 'stoma_bag'],
    [1, 'check', 150, undefined, 'stoma_bag'],
  ],
  // bag-alerts: a 2 h catheter interval; the urine bag ~110 mL every 2 h, and the drain bag nearly full.
  '2C-2': [
    [24.5, 'bag_changed', 0],
    [22.5, 'check', 110],
    [20.5, 'check', 220],
    [18.5, 'check', 330],
    [16.5, 'check', 440],
    [14.5, 'check', 550],
    [12.5, 'emptied', 660],
    [10.5, 'check', 110],
    [9, 'check', 300, undefined, 'drain_bag'],
    [8.5, 'check', 220],
    [6.5, 'check', 330],
    [5, 'check', 560, undefined, 'drain_bag'],
    [4.5, 'check', 440],
    [2.5, 'check', 550],
    [1, 'check', 820, undefined, 'drain_bag'],
    [0.5, 'check', 660],
  ],
}
/** Urine bag beds (the catheter beds) chart their urine as bag readings: their routine urine rows are dropped, their intake kept. */
const bagBeds = new Set(
  Object.entries(BAG_STORIES).flatMap(([bed, steps]) => (steps.some((st) => (st[4] ?? 'urine_bag') === 'urine_bag') ? [bed] : [])),
)

/**
 * Output devices (patient-devices), as care orders below: catheters on the bag beds, 2C-2's drain, 2C-3's ileostomy, and
 * how the other beds pass urine. Every bed not listed is on the urinal default.
 */
const VOIDING: Record<string, Exclude<VoidingMethod, 'urinal'>> = {
  '2C-1': 'commode',
  '3A-4': 'commode',
  '5B-6': 'commode',
  'HDU-3': 'bedpan',
  '3A-7': 'toilet',
}
/** The vessel each bed's photographed urine is read in (VOIDING_CONTAINER), or null when its urine is not measured. */
const urineVessel = (bed: string): UrineVessel | null => VOIDING_CONTAINER[VOIDING[bed] ?? 'urinal']
/** Unmeasured beds (the toilet) chart no urine: their routine urine rows are dropped too. */
const unmeasuredBeds = new Set(Object.keys(VOIDING).filter((b) => urineVessel(b) === null))

/**
 * drink-types: what each bed drinks (fictional). Every `water` row but a jug drop gets a kind, and its item names the
 * drink. Volumes, times, statuses and IDDSI levels are unchanged, so no prompt moves.
 */
const BED_DRINKS: Record<string, DrinkKind[]> = {
  '3A-4': ['tea', 'coffee', 'coconut_water', 'water'],
  '3A-1': ['juice', 'water'],
  '2C-1': ['ors', 'water'],
  'HDU-2': ['ors'],
  '3A-6': ['buttermilk', 'water', 'tea'],
  'HDU-3': ['supplement', 'tea'],
}
/** The names a drink is charted under, varied by row. */
const DRINK_NAMES: Record<DrinkKind, string[]> = {
  water: ['water'],
  tea: ['masala chai', 'tea', 'ginger chai'],
  coffee: ['filter coffee'],
  milk: ['milk'],
  juice: ['orange juice', 'sweet lime juice'],
  coconut_water: ['coconut water'],
  buttermilk: ['chaas'],
  ors: ['ORS'],
  supplement: ['nutrition shake'],
  soup: ['soup'],
  other: ['drink'],
}
/** A drink's kind from its item, for beds with no story of their own: tea, coconut water, juice, else water. */
const kindOfItem = (item: string | undefined): DrinkKind =>
  item?.includes('tea') || item?.includes('chai')
    ? 'tea'
    : item?.includes('coconut')
      ? 'coconut_water'
      : item?.includes('juice')
        ? 'juice'
        : 'water'
let drinkRow = 0
function withDrinks(row: WardRow): WardRow {
  const [ward, bed, h, category, ml, o = {}] = row
  if (category !== 'water' || o.jug) return row
  const i = drinkRow++
  const story = BED_DRINKS[key(ward, bed)]
  const drink = story ? story[i % story.length]! : kindOfItem(o.item)
  const names = DRINK_NAMES[drink]
  // A specific name already given is kept (`orange juice`); a generic one (`tea`, `juice`, `water jug`) gets the drink's name.
  const generic = !o.item || ['tea', 'juice', 'water', 'water jug'].includes(o.item) || kindOfItem(o.item) !== drink
  const item = generic ? names[i % names.length]! : o.item!
  return [ward, bed, h, category, ml, { ...o, drink, item }]
}

const HISTORY: WardRow[] = [
  ...STORY.map((r): WardRow => ['5B', ...r]),
  ...EXTRA,
  ...CARE_ROWS,
  ...admissions
    .filter((a) => !scripted.has(key(a.ward_code, a.bed)))
    .flatMap((a, n) => (careBeds.has(key(a.ward_code, a.bed)) ? careRoutine : routine)(a.ward_code, a.bed, n)),
]
  .filter(([ward, bed, , category]) => !((bagBeds.has(key(ward, bed)) || unmeasuredBeds.has(key(ward, bed))) && category === 'urine'))
  // Each photographed urine entry is read in its bed's own vessel, named in its item on a bedpan or commode bed.
  .map(([ward, bed, h, category, ml, o = {}]): WardRow => {
    const vessel = category === 'urine' && o.source === 'photo' ? urineVessel(key(ward, bed)) : null
    if (!vessel) return [ward, bed, h, category, ml, o]
    return [
      ward,
      bed,
      h,
      category,
      ml,
      { ...o, container: vessel, ...(vessel !== 'urinal' && !o.item && { item: vessel.replace('_', ' ') }) },
    ]
  })
  .map(withDrinks)

/**
 * The read behind an entry, where the app makes one: every voice and typed note, and every photo. No entry carries a
 * urine bag photo (the app saves one as a bag reading); a bag-photo entry would have no read and count in nothing.
 */
async function entryRead(
  admissionId: number,
  by: number,
  ev: EntryEvidence | null,
  category: EntryCategory,
  ml: number,
  o: Opts,
  n: number,
) {
  if (ev?.kind === 'photo')
    return ev.reading.container === 'urine_bag' ? undefined : await logRead(admissionId, by, { kind: 'photo', evidence: ev })
  if (ev?.kind !== 'voice' && ev?.kind !== 'text') return undefined
  const draft: DraftEntry = {
    direction: CATEGORY_DIRECTION[category],
    category,
    volume_ml: ml,
    item: o.item ?? null,
    notes: o.notes ?? null,
    ...(category === 'urine' && { urine_colour: urineColour(category, o, n).urine_colour ?? null }),
    // As notes.ts sets it: a drink's kind (`other` when not named), food only a real kind.
    drink: category === 'water' ? (o.drink ?? 'other') : category === 'food' ? (o.drink ?? null) : null,
  }
  return await logRead(admissionId, by, { kind: ev.kind, drafts: [draft], trace: ev.trace })
}

for (const [n, [ward, bed, hoursAgo, category, ml, o = {}]] of HISTORY.toSorted((a, b) => b[2] - a[2]).entries()) {
  // Whole milliseconds: stories placed relative to the chart day give fractional hours.
  const charted = Math.round(now - hoursAgo * HOUR)
  clock.t = charted + (o.lateBy ?? 0) * HOUR
  const admissionId = beds.get(key(ward, bed))
  if (admissionId === undefined) throw new Error(`demo history: no admission on ${ward} bed ${bed}`)
  // IV fluids are charted by the ward's nurses; everything else by its recorders.
  const by = o.by ?? pick(category === 'iv' ? nursesOf(ward) : recordersOf(ward), n)
  let e: Entry
  if (o.jug) {
    // The jug as it was filled, unless the last level already is that reading.
    const last = (await store.levels(admissionId))!.find((l) => l.container === 'water_jug')
    if (last?.volume_ml !== o.jug.from) {
      clock.t = charted - 1.5 * HOUR
      await jugLevel(admissionId, o.jug.from, 0.9, n + 1, by)
      clock.t = charted
    }
    const drop = await jugLevel(admissionId, o.jug.to, o.confidence ?? 0.9, n, by)
    if (drop?.volume_ml !== ml) throw new Error(`demo history: jug drop on bed ${bed} is not ${ml} mL`)
    e = drop
  } else {
    const evidence = evidenceFor(bed, category, ml, o, n)
    // The drawn photo or tone (synthetic) is uploaded first, then linked, as the app does.
    const media_id = await mediaFor(admissionId, evidence, by)
    const read_id = await entryRead(admissionId, by, evidence, category, ml, o, n)
    e = (await store.addEntry(
      admissionId,
      {
        direction: CATEGORY_DIRECTION[category],
        category,
        volume_ml: ml,
        item: o.item ?? null,
        notes: o.notes ?? null,
        source: o.source ?? 'manual',
        confidence: o.confidence ?? null,
        evidence,
        ...urineColour(category, o, n),
        ...(o.iddsi !== undefined && { iddsi_level: o.iddsi }),
        ...(o.drink !== undefined && { drink: o.drink }),
        ...(o.lateBy ? { charted_at: new Date(charted).toISOString() } : {}),
        ...(media_id !== undefined && { media_id }),
        ...(read_id !== undefined && { read_id }),
      },
      by,
    ))!
  }
  clock.t = Math.min(clock.t + 10 * 60_000, now) // reviewed ten minutes later, or now
  const status = o.status ?? 'approved'
  if (status === 'pending') continue
  await store.review(e.id, status === 'approved' ? 'approve' : 'reject', {
    volumeMl: o.approveAs,
    staffId: o.reviewer ?? pick(nursesOf(ward), Math.floor(hoursAgo / 12)),
    reason: o.reason,
    note: o.note ?? null,
  })
  if (o.amend) {
    clock.t += o.amend.after * HOUR
    await store.amend(e.id, { volume_ml: o.amend.ml, reason: o.amend.reason }, o.amend.by)
  }
}
// Bag readings, in time order per bed, through the store as the app saves them (synthetic photos and reads).
let bagCount = 0
for (const [bedKey, steps] of Object.entries(BAG_STORIES)) {
  const admissionId = beds.get(bedKey)
  if (admissionId === undefined) throw new Error(`demo history: no admission on ${bedKey}`)
  const [ward = '', bed = ''] = bedKey.split('-')
  for (const [i, [hoursAgo, event, level, residual, container = 'urine_bag']] of steps.entries()) {
    const n = bagCount++
    clock.t = Math.round(now - hoursAgo * HOUR)
    const by = pick(recordersOf(ward), i)
    const newest = !steps.slice(i + 1).some((s) => (s[4] ?? 'urine_bag') === container)
    if (container !== 'urine_bag') {
      // Read by hand: no photo, no read.
      const r = await store.addBagReading(admissionId, { container, event, volume_ml: level, source: 'manual' }, by)
      if (!r) throw new Error(`demo history: the ${bedKey} ${container} reading was not saved`)
      if (r.entry && !newest) {
        clock.t = Math.min(clock.t + 10 * 60_000, now)
        await store.review(r.entry.id, 'approve', { staffId: pick(nursesOf(ward), i) })
      }
      continue
    }
    const o: Opts = { source: 'photo', confidence: 0.9 }
    const evidence = evidenceFor(bed, 'urine', level, o, n)
    if (evidence?.kind !== 'photo') throw new Error('demo history: a bag reading without a photo read')
    const media_id = await mediaFor(admissionId, evidence, by)
    const read_id = await logRead(admissionId, by, { kind: 'photo', evidence })
    const r = await store.addBagReading(
      admissionId,
      {
        container: 'urine_bag',
        event,
        volume_ml: level,
        source: 'photo',
        confidence: o.confidence,
        evidence,
        ...urineColour('urine', o, n),
        ...(media_id !== undefined && { media_id }),
        read_id,
      },
      by,
    )
    if (!r) throw new Error(`demo history: the ${bedKey} bag reading was not saved`)
    if (residual !== undefined) {
      // The bag photographed after emptying, with what was left in it: set before its next reading.
      clock.t += 2 * 60_000
      const proof = await mediaFor(admissionId, evidenceFor(bed, 'urine', residual, o, n + 1), by)
      const kept = await store.afterEmptying(r.reading.id, { residual_ml: residual, ...(proof !== undefined && { media_id: proof }) })
      if (!kept.ok) throw new Error(`demo history: the ${bedKey} after-emptying record was not kept`)
    }
    // Approved by the ward's nurse ten minutes later, except the entry of each bag's newest reading.
    if (r.entry && !newest) {
      clock.t = Math.min(clock.t + 10 * 60_000, now)
      await store.review(r.entry.id, 'approve', { staffId: pick(nursesOf(ward), i) })
    }
  }
}

// Meals: fictional trays. The read evidence below is made up here, not model output; the dish regions come from the
// real `layoutTray` over the masks of the drawn tray (region 1 the plate, 2 the bowl, 3 the cup).
type Dish = { name: string; kind: DishKind; region: number }
type MenuFluid = { name: string; kind: MealFluidKind; ml: number; region: number }
const MENU: Record<MealKind, { dishes: Dish[]; fluid: MenuFluid | null }> = {
  breakfast: {
    dishes: [
      { name: 'idli', kind: 'porridge_cereal', region: 1 },
      { name: 'sambar', kind: 'dal_lentils', region: 2 },
      { name: 'banana', kind: 'fruit', region: 1 },
    ],
    fluid: { name: 'milk', kind: 'milk', ml: 150, region: 3 },
  },
  lunch: {
    dishes: [
      { name: 'rice', kind: 'rice', region: 1 },
      { name: 'dal', kind: 'dal_lentils', region: 2 },
      { name: 'vegetable curry', kind: 'curry_vegetables', region: 1 },
    ],
    fluid: { name: 'dal', kind: 'other', ml: 150, region: 2 },
  },
  snack: {
    dishes: [
      { name: 'biscuits', kind: 'snack', region: 1 },
      { name: 'fruit', kind: 'fruit', region: 1 },
    ],
    fluid: { name: 'tea', kind: 'tea', ml: 150, region: 3 },
  },
  dinner: {
    dishes: [
      { name: 'roti', kind: 'bread', region: 1 },
      { name: 'soup', kind: 'soup_broth', region: 2 },
      { name: 'paneer curry', kind: 'curry_vegetables', region: 1 },
    ],
    fluid: { name: 'soup', kind: 'soup', ml: 200, region: 2 },
  },
}
const mealAt = (t: number): MealKind => {
  const d = new Date(t)
  const m = d.getHours() * 60 + d.getMinutes()
  return m >= 300 && m < 630 ? 'breakfast' : m >= 630 && m < 900 ? 'lunch' : m >= 900 && m < 1080 ? 'snack' : 'dinner'
}
const PORTION_STEPS: Portion[] = [100, 75, 50, 100, 25, 75]
/**
 * Dietitian beds (charting/nutrition): their three meals (3.2, 8.5 and 14.8 h ago) each eaten 50% or less. The routine
 * cycle never gives three in a row at 50% or less, so no other bed raises poor meal intake.
 */
const POOR_PORTIONS: Record<string, Portion[]> = { '3A-6': [25, 50, 0], '3A-7': [0, 50, 25] }
const storyBeds = new Set([...scripted, ...careBeds])
let meals = 0
/** accuracy-views' meal mix: one retaken tray read (a 3A meal over 12 h old) and one fluid entry rejected by a nurse. */
let retakeDone = false
let fluidRejected = false
/** And one older 3A tray whose curry the read took for dal: staff saved it as curry (a dish kind correction). */
let curryMisread = false
/**
 * dietitian-care: accepted 3A photo meals, one of which gets its `rice` renamed by Anita Thomas. Lunch is the only menu
 * with rice and the meal times move with the seeding time, so one older 3A tray saved as read (8.5 or 14.8 h ago) is
 * served lunch's dishes whatever its meal: the rename always has a `rice` dish.
 */
let riceTrayDone = false
const renameCandidates: { meal: Meal; charted: number }[] = []
for (const [n, a] of admissions.entries()) {
  const story = storyBeds.has(key(a.ward_code, a.bed))
  for (const [k, hoursAgo] of [3.2, 8.5, 14.8].entries()) {
    const charted = now - hoursAgo * HOUR
    // No meal while 2C-1 is nil by mouth.
    if (key(a.ward_code, a.bed) === '2C-1' && charted >= NBM_START) continue
    const meal = mealAt(charted)
    const base = MENU[meal]
    const portion = POOR_PORTIONS[key(a.ward_code, a.bed)]?.[k] ?? PORTION_STEPS[(n + k) % PORTION_STEPS.length]!
    // 3A-4's duplicate (voided below) is always a tray photo, so its tray read is `rejected` in the Data quality view.
    const photo = (n + k) % 2 === 0 || (a.ward_code === '3A' && a.bed === '4' && k === 1)
    const withFluid = !story && base.fluid !== null && portion > 0 && k !== 2
    const fluid_ml = withFluid ? Math.round((base.fluid!.ml * portion) / 100 / 10) * 10 : null
    // The tray as photographed (a synthetic drawing), kept with the meal; its read is bound to those bytes.
    const bytes = photo ? trayPhoto(portion, n + k) : null
    const masks = photo ? trayMasks(portion, n + k) : null
    const segmentation = masks ? layoutTray(masks.dishes, masks.foods) : null
    const region = (index: number) => segmentation?.regions.find((r) => r.index === index) ?? null
    const misread =
      photo && !curryMisread && !story && a.ward_code === '3A' && k > 0 && base.dishes.some((d) => d.kind === 'curry_vegetables')
    if (misread) curryMisread = true
    // The rice tray is an older 3A tray saved as read: not the retaken read below, the curry misread or the rejected fluid.
    const retakeNext = photo && !retakeDone && !story && a.ward_code === '3A' && hoursAgo > 12
    const riceTray =
      photo &&
      !riceTrayDone &&
      !story &&
      a.ward_code === '3A' &&
      k > 0 &&
      !misread &&
      !retakeNext &&
      !(fluid_ml !== null && !fluidRejected) &&
      (n + k) % 3 !== 0 &&
      a.bed !== '4'
    if (riceTray) riceTrayDone = true
    const menu = riceTray ? { ...base, dishes: MENU.lunch.dishes } : base
    const read: MealDish[] = menu.dishes.map((d, i) => ({
      index: d.region,
      name: d.name,
      dish_kind: misread && d.kind === 'curry_vegetables' ? 'dal_lentils' : d.kind,
      portion: i === 0 ? portion : PORTION_STEPS[(n + i) % PORTION_STEPS.length]!,
      basis: 'model',
      box: region(d.region)?.box ?? null,
      coverage: region(d.region)?.coverage ?? null,
      model_portion: i === 0 ? portion : PORTION_STEPS[(n + i) % PORTION_STEPS.length]!,
      measure: null,
    }))
    // What was saved: the read, except that every third tray the attendant saw the second dish finished.
    const dishes: DishValue[] = read.map(({ index, name, portion: p }, i) => ({
      index,
      name,
      dish_kind: menu.dishes[i]!.kind,
      portion: i === 1 && (n + k) % 3 === 0 ? 100 : p,
    }))
    const evidence: MealEvidenceInput | null = bytes
      ? {
          mode: 'sam+spark',
          image_sha256: sha256Hex(bytes),
          segmentation,
          comparison: null,
          warnings: [],
          reading: {
            items: read.map((d) => ({ name: d.name, portion: d.portion })),
            dishes: read,
            portion,
            fluids: fluid_ml
              ? [{ index: menu.fluid!.region, name: menu.fluid!.name, fluid_kind: menu.fluid!.kind, volume_ml: fluid_ml }]
              : [],
            confidence: 0.78 + ((n * 7 + k) % 15) / 100,
            issues: [],
            notes: portion === 100 ? 'Plates and bowls empty.' : 'Some food left on the tray.',
          },
          trace: [
            { step: 'sam:dish', model: 'sam-3.1', ms: 1700 + ((n * 37 + k * 11) % 400) },
            { step: 'sam:food', model: 'sam-3.1', ms: 1800 + ((n * 41 + k * 13) % 400) },
            { step: 'spark:meal', model: 'muse-spark-1.3', ms: 1900 + ((n * 131 + k * 57) % 900), input_tokens: 1600, output_tokens: 140 },
          ],
        }
      : null
    clock.t = charted + 5 * 60_000
    const by = pick(recordersOf(a.ward_code), n + k)
    const tray = bytes ? await kept.keep(a.id, { kind: 'photo', mime: 'image/png', bytes }, by) : undefined
    if (tray) mediaCount++
    // Every photo meal with evidence was drafted from a tray read a minute before it. One 3A meal over 12 h old outside
    // the story beds was read twice by the same staff member 4 minutes apart; the first read is never saved (retaken).
    const retake = !!evidence && retakeNext
    if (retake) {
      await logTrayRead(a.id, by, evidence, trayDraft(evidence.reading), 5 * 60_000)
      retakeDone = true
    }
    const readId = evidence ? await logTrayRead(a.id, by, evidence, trayDraft(evidence.reading)) : undefined
    const m = (await store.addMeal(
      a.id,
      {
        meal,
        portion,
        items: menu.dishes.map((d) => d.name).join(', '),
        ...(photo && { dishes }),
        fluid_ml,
        source: photo ? 'photo' : 'manual',
        confidence: evidence?.reading.confidence ?? null,
        evidence,
        charted_at: new Date(charted).toISOString(),
        ...(tray && { media_id: tray.id }),
        ...(readId !== undefined && { read_id: readId }),
      },
      by,
    ))!
    meals++
    // Older meal fluids were approved on the round; the latest stays pending. One older 3A tray's fluid was a duplicate
    // of a drink already charted, so the nurse rejected it (its read: corrected_by_nurse, the fluid `removed`).
    let dup = false
    if (m.entry_id !== null && k > 0) {
      clock.t += 20 * 60_000
      dup = !fluidRejected && !story && readId !== undefined && a.ward_code === '3A'
      if (dup) fluidRejected = true
      if (dup) await store.review(m.entry_id, 'reject', { staffId: pick(nursesOf(a.ward_code), n + k), reason: 'duplicate' })
      else await store.review(m.entry_id, 'approve', { staffId: pick(nursesOf(a.ward_code), n + k) })
    }
    if (a.ward_code === '3A' && a.bed === '4' && k === 1) {
      clock.t += 30 * 60_000
      await store.voidMeal(m.id, 'duplicate: same tray recorded twice', GRACE)
    }
    // dietitian-care: 3A trays saved exactly as read, their fluid approved or none, for the dish rename below.
    const asRead = readId !== undefined && !misread && !retake && !dup && (n + k) % 3 !== 0 && !(a.bed === '4' && k === 1)
    if (a.ward_code === '3A' && !story && asRead && (m.entry_id === null || k > 0)) renameCandidates.push({ meal: m, charted })
  }
}

// Served trays (charting/meals, tray-comparison): no model request. 3A-1's lunch tray was photographed as served and
// again as collected; its read compares the two, so the dal (the one dish citing its bowl) is measured and the plate's
// two dishes keep the model's portion. Anita Thomas then amends the curry. 2C-3 has a served lunch photo waiting, so
// opening Meal there preselects lunch. Neither is 2C-2, whose meal fluids bag-alerts' demo guard depends on.
{
  const bed = beds.get('3A-1')!
  const by = pick(recordersOf('3A'), 0)
  const servedAt = Math.round(now - 2.75 * HOUR)
  const charted = Math.round(now - 2 * HOUR)
  const seed = 41
  const servedBytes = trayPhoto(0, seed)
  const collectedBytes = trayPhoto(50, seed)
  const servedMasks = trayMasks(0, seed)
  const collectedMasks = trayMasks(50, seed)
  const servedSeg = layoutTray(servedMasks.dishes, servedMasks.foods)
  const segmentation = layoutTray(collectedMasks.dishes, collectedMasks.foods)
  const size = imageSize(collectedBytes, 'image/png')
  const servedSize = imageSize(servedBytes, 'image/png')
  if (!size || !servedSize) throw new Error('demo history: the synthetic tray photos have no readable size')
  clock.t = servedAt
  const servedRef = (await kept.keep(bed, { kind: 'photo', mime: 'image/png', bytes: servedBytes, served_meal: 'lunch' }, by))!
  mediaCount++
  const matches = matchRegions(segmentation.regions, size, servedSeg.regions, servedSize)
  const region = (index: number) => segmentation.regions.find((r) => r.index === index) ?? null
  const model: MealDish[] = MENU.lunch.dishes.map((d, i) => {
    const p: Portion = i === 1 ? 25 : 50
    return {
      index: d.region,
      name: d.name,
      dish_kind: d.kind,
      portion: p,
      basis: 'model',
      box: region(d.region)?.box ?? null,
      coverage: region(d.region)?.coverage ?? null,
      model_portion: p,
      measure: null,
    }
  })
  const read = measureDishes(model, segmentation, servedSeg, matches)
  if (read.filter((d) => d.basis === 'measured').length !== 1) throw new Error('demo history: the compared lunch must measure one dish')
  const evidence: MealEvidenceInput = {
    mode: 'sam+spark',
    image_sha256: sha256Hex(collectedBytes),
    segmentation,
    comparison: {
      served_media_id: servedRef.id,
      served_sha256: sha256Hex(servedBytes),
      served_at: servedRef.created_at,
      size,
      served_size: servedSize,
      served: servedSeg,
      matches,
    },
    warnings: [],
    reading: {
      items: read.map((d) => ({ name: d.name, portion: d.portion })),
      dishes: read,
      portion: 50,
      fluids: [],
      confidence: 0.84,
      issues: [],
      notes: 'Some food left on the tray.',
    },
    trace: [
      { step: 'sam:dish', model: 'sam-3.1', ms: 1720 },
      { step: 'sam:food', model: 'sam-3.1', ms: 1810 },
      { step: 'sam:served-dish', model: 'sam-3.1', ms: 1690 },
      { step: 'sam:served-food', model: 'sam-3.1', ms: 1770 },
      { step: 'spark:meal', model: 'muse-spark-1.3', ms: 2240, input_tokens: 1750, output_tokens: 150 },
    ],
  }
  clock.t = charted + 5 * 60_000
  const tray = (await kept.keep(bed, { kind: 'photo', mime: 'image/png', bytes: collectedBytes }, by))!
  mediaCount++
  const readId = await logTrayRead(bed, by, evidence, trayDraft(evidence.reading))
  const saved = (await store.addMeal(
    bed,
    {
      meal: 'lunch',
      portion: 50,
      items: joinItems(read),
      dishes: read.map(({ index, name, dish_kind, portion }) => ({ index, name, dish_kind, portion })),
      fluid_ml: null,
      source: 'photo',
      confidence: evidence.reading.confidence,
      evidence,
      charted_at: new Date(charted).toISOString(),
      media_id: tray.id,
      served_media_id: servedRef.id,
      read_id: readId,
    },
    by,
  ))!
  meals++
  clock.t = charted + 50 * 60_000
  const amended = await store.amendMeal(
    saved.id,
    {
      dishes: read.map(({ index, name, dish_kind, portion }) => ({
        index,
        name,
        dish_kind,
        portion: name === 'vegetable curry' ? 75 : portion,
      })),
      reason: 'curry bowl rechecked',
    },
    ANITA,
  )
  if (!amended.ok) throw new Error('demo history: the 3A-1 lunch amendment was not recorded')
  // 2C-3: a served lunch tray, photographed an hour ago and not yet collected.
  clock.t = Math.round(now - HOUR)
  await kept.keep(
    beds.get('2C-3')!,
    { kind: 'photo', mime: 'image/png', bytes: trayPhoto(0, 43), served_meal: 'lunch' },
    pick(recordersOf('2C'), 0),
  )
  mediaCount++
}

// Dietitian referral (charting/nutrition): 3A-7 referred by its nurse 2.5 h ago, acknowledged by the dietitian 1.5 h ago,
// so its poor meals raise no prompt. 3A-6 is left unreferred, to show the prompt and "Refer to dietitian". Written
// before the prompt snapshot below, which therefore already holds both.
{
  const bed7 = beds.get('3A-7')!
  clock.t = Math.round(now - 2.5 * HOUR)
  const r = await store.refer(bed7, { reason: 'poor_intake', note: null }, ANITA)
  if (!r.ok) throw new Error('demo history: the 3A-7 referral was not recorded')
  clock.t = Math.round(now - 1.5 * HOUR)
  if (!(await store.acknowledgeReferral(r.referral.id, SANA)).ok) throw new Error('demo history: the 3A-7 referral was not acknowledged')
}

// Care orders, by each ward's own nurse.
const at = (t: number) => {
  clock.t = t
}
at(ADMITTED + 0.5 * HOUR)
// patient-devices: how each bed's output is collected, by the ward's nurse at admission.
const WARD_NURSE: Record<string, number> = { '2C': MEERA, '3A': ANITA, '5B': GRACE, HDU: DIVYA }
for (const [bed, method] of Object.entries(VOIDING))
  await store.setCare(beds.get(bed)!, 'voiding', { method }, WARD_NURSE[bed.split('-')[0]!])
await store.setCare(beds.get('2C-3')!, 'stoma', { type: 'ileostomy' }, MEERA)
await store.setCare(beds.get('HDU-3')!, 'fluid_limit', { ml: 1000, scope: 'total' }, DIVYA)
await store.setCare(beds.get('5B-6')!, 'thickened_fluids', { level: 2 }, GRACE)
await store.setCare(beds.get('3A-4')!, 'intake_target', { ml: 1600 }, ANITA)
await store.setCare(beds.get('5B-5')!, 'acuity', { level: 'watch' }, GRACE)
// Inserted at 11:00 five calendar days ago: catheter day 6.
const inserted = new Date(now)
inserted.setDate(inserted.getDate() - 5)
inserted.setHours(11, 0, 0, 0)
await store.setCare(beds.get('HDU-1')!, 'catheter', { type: 'urethral', inserted_at: inserted.toISOString() }, NIKHIL)
// Reviewed at 09:10 in the previous chart day; none yet today.
const previous = new Date(day.start)
at(new Date(previous.getFullYear(), previous.getMonth(), previous.getDate() - 1, 9, 10).getTime())
if (!(await store.reviewCatheter(beds.get('HDU-1')!, NIKHIL)).ok)
  throw new Error('demo history: the HDU-1 catheter review was not recorded')
at(NBM_START)
await store.setCare(beds.get('2C-1')!, 'nil_by_mouth', { until: new Date(NBM_UNTIL).toISOString() }, MEERA)
// 3A-3, 2C-5 and 2C-6: catheters inserted two days ago, reviewed today by the ward's nurse (so only the bag prompts show).
for (const [bed, nurse] of [
  ['3A-3', ANITA],
  ['2C-5', MEERA],
  ['2C-6', MEERA],
] as const) {
  at(ADMITTED + HOUR)
  await store.setCare(beds.get(bed)!, 'catheter', { type: 'urethral', inserted_at: new Date(ADMITTED + HOUR).toISOString() }, nurse)
  at(now - inDay(0.25) * HOUR)
  if (!(await store.reviewCatheter(beds.get(bed)!, nurse)).ok) throw new Error(`demo history: the ${bed} catheter review was not recorded`)
}
// 2C-2 (bag-alerts): a catheter inserted and ordered 24.5 h ago with a 2 h bag-reading interval, reviewed today.
at(now - 24.5 * HOUR)
await store.setCare(
  beds.get('2C-2')!,
  'catheter',
  { type: 'urethral', inserted_at: new Date(now - 24.5 * HOUR).toISOString(), measure_every_h: 2 },
  MEERA,
)
// patient-devices: its abdominal drain, set with the catheter, so its drain readings are in force.
await store.setCare(beds.get('2C-2')!, 'drain', { site: 'abdominal' }, MEERA)
at(now - inDay(0.25) * HOUR)
if (!(await store.reviewCatheter(beds.get('2C-2')!, MEERA)).ok) throw new Error('demo history: the 2C-2 catheter review was not recorded')

// dietitian-care (charting/care-plan "Diet order", charting/nutrition "Assign a dietitian"), through the store, before the
// prompt snapshots below; none raises or clears a prompt or changes a meal outcome.
//
//   HDU-3  renal diet, IDDSI 7, 1800 kcal, 60 g protein, by Sana Mirza 30 h ago
//   5B-6   regular diet, IDDSI 6, by Grace Lee 20 h ago
//   2C-3   weight_loss referral by Meera Pillai 40 h ago, acknowledged by Sana Mirza 30 h ago, Sana Mirza assigned 18 h
//          ago by Meera Pillai, closed supplements_started 6 h ago with a review in 3 days
//   3A     one accepted tray's `rice` renamed `jeera rice` by Anita Thomas an hour after it, keeping each dish's kind,
//          portion and region, so its outcome stays accepted
{
  at(now - 30 * HOUR)
  await store.setCare(beds.get('HDU-3')!, 'diet', { type: 'renal', texture: 7, kcal: 1800, protein_g: 60 }, SANA)
  at(now - 20 * HOUR)
  await store.setCare(beds.get('5B-6')!, 'diet', { type: 'regular', texture: 6 }, GRACE)
  const c23 = beds.get('2C-3')!
  at(now - 40 * HOUR)
  const r = await store.refer(c23, { reason: 'weight_loss', note: 'Lost weight at home' }, MEERA)
  if (!r.ok) throw new Error('demo history: the 2C-3 referral was not recorded')
  at(now - 30 * HOUR)
  if (!(await store.acknowledgeReferral(r.referral.id, SANA)).ok) throw new Error('demo history: the 2C-3 referral was not acknowledged')
  at(now - 18 * HOUR)
  if (!(await store.assignDietitian(c23, SANA, MEERA)).ok) throw new Error('demo history: Sana Mirza was not assigned to 2C-3')
  at(now - 6 * HOUR)
  const review = new Date(now)
  const nextReview = new Date(review.getFullYear(), review.getMonth(), review.getDate() + 3)
  const pad = (x: number) => String(x).padStart(2, '0')
  const next_review = `${nextReview.getFullYear()}-${pad(nextReview.getMonth() + 1)}-${pad(nextReview.getDate())}`
  if (!(await store.closeReferral(r.referral.id, { outcome: 'supplements_started', next_review }, SANA)).ok) {
    throw new Error('demo history: the 2C-3 referral was not closed')
  }
  const target = renameCandidates.find((c) => c.meal.dishes.some((d) => d.name === 'rice'))
  if (!target) throw new Error('demo history: no accepted 3A tray with rice to rename')
  const from = target.meal.dishes.find((d) => d.name === 'rice')!
  at(target.charted + HOUR)
  const renamed = await store.amendMeal(
    target.meal.id,
    {
      dishes: target.meal.dishes.map((d) => (d === from ? { ...d, name: 'jeera rice' } : d)),
      reason: 'dish name corrected',
    },
    ANITA,
  )
  if (!renamed.ok) throw new Error('demo history: the 3A dish rename was not recorded')
  console.log(`demo history: renamed ${from.name} on meal ${target.meal.id} (admission ${target.meal.admission_id})`)
}

// ---------- model accuracy: reads with no record, an edit at capture and an overridden negative ----------
// All on 3A beds outside the story beds; a snapshot of every bed's prompts checks they change nothing.
clock.t = now
const promptsOf = async () => {
  const prompts = new Map<number, string>()
  for (const a of admissions) {
    const view = await chartView(store, (await store.admission(a.id))!)
    prompts.set(
      a.id,
      view.alerts
        .map((x) => x.kind)
        .toSorted()
        .join(),
    )
  }
  return prompts
}
const promptsBefore = await promptsOf()
const bed6 = beds.get('3A-6')!
const bed5 = beds.get('3A-5')!
const nurse3A = nursesOf('3A')[0]!
const RAVI = 1
/** Synthetic tray read evidence for the model accuracy mix: made up here, not model output. No photo is kept. */
const trayEvidence = (
  reading: Omit<MealEvidenceInput['reading'], 'items'>,
  mode: 'sam+spark' | 'spark' = 'sam+spark',
): MealEvidenceInput => ({
  mode,
  image_sha256: sha256Hex(new TextEncoder().encode(`demo tray ${reading.portion} ${reading.dishes.length}`)),
  segmentation: null,
  comparison: null,
  warnings: [],
  reading: { ...reading, items: reading.dishes.map((d) => ({ name: d.name, portion: d.portion })) },
  trace: [
    { step: 'sam:dish', model: 'sam-3.1', ms: 1700 },
    { step: 'sam:food', model: 'sam-3.1', ms: 1800 },
    { step: 'spark:meal', model: 'muse-spark-1.3', ms: 2100, input_tokens: 1600, output_tokens: 120 },
  ],
})
const readDish = (index: number, name: string, dish_kind: DishKind, portion: Portion): MealDish => ({
  index,
  name,
  dish_kind,
  portion,
  basis: 'model',
  box: null,
  coverage: null,
  model_portion: portion,
  measure: null,
})
const emptyTray = trayEvidence({ dishes: [], portion: 0, fluids: [], confidence: 0.3, issues: ['not_a_meal'], notes: null })
const openLunch = trayEvidence({
  dishes: [readDish(0, 'rice', 'rice', 50), readDish(0, 'dal', 'dal_lentils', 100)],
  portion: 50,
  fluids: [{ index: 0, name: 'dal', fluid_kind: 'other', volume_ml: 150 }],
  confidence: 0.86,
  issues: [],
  notes: null,
})
const [attendant3A = 1] = recordersOf('3A')
/** A synthetic photo read with no container in view: container `none`, the given fluid, no volume. */
const noContainer = (fluid: FluidKind): PhotoEvidence => ({
  kind: 'photo',
  mode: 'sam+spark',
  reading: {
    container: 'none',
    fluid,
    volume_ml: null,
    capacity_ml: null,
    marks_visible: false,
    reading_basis: 'no container in view',
    appearance: null,
    confidence: 0.4,
    issues: ['no_container'],
  },
  segmentation: null,
  review_reasons: ['No container found: check the photo'],
  trace: photoTrace(120),
  colour: null,
})
{
  // edited_at_capture: a urinal read as 300 mL, saved as 400 mL, approved.
  const o: Opts = { source: 'photo', confidence: 0.88, notes: 'pale yellow, clear', container: 'urinal', drafted: 300 }
  clock.t = Math.round(now - 6.6 * HOUR)
  const evidence = evidenceFor('6', 'urine', 400, o, 901)
  const media_id = await mediaFor(bed6, evidence, attendant3A)
  const read_id = await entryRead(bed6, attendant3A, evidence, 'urine', 400, o, 901)
  const e = (await store.addEntry(
    bed6,
    {
      direction: 'out',
      category: 'urine',
      volume_ml: 400,
      source: 'photo',
      confidence: 0.88,
      evidence,
      ...urineColour('urine', o, 901),
      media_id,
      read_id,
    },
    attendant3A,
  ))!
  clock.t += 10 * 60_000
  await store.review(e.id, 'approve', { staffId: nurse3A })
  // abandoned: a urinal read as 350 mL 14 h ago, never saved.
  clock.t = Math.round(now - 14 * HOUR)
  const left = evidenceFor('6', 'urine', 350, { ...o, drafted: undefined }, 902)
  if (left?.kind === 'photo') await logRead(bed6, attendant3A, { kind: 'photo', evidence: left })
  // negative_confirmed: no container in view and nothing drafted, 9 h ago.
  clock.t = Math.round(now - 9 * HOUR)
  await logRead(bed5, attendant3A, { kind: 'photo', evidence: noContainer('none') })
  // Trays (accuracy-views): a 3A-5 tray read with nothing on it (`not_a_meal`, no draft) 2 h ago, negative_confirmed.
  clock.t = Math.round(now - 2 * HOUR) + 60_000
  await logTrayRead(bed5, attendant3A, emptyTray, trayDraft(emptyTray.reading))
  // open: Ravi Kumar read 3A-6's lunch tray an hour ago and has not saved it (the browser check saves it).
  clock.t = Math.round(now - HOUR) + 60_000
  await logTrayRead(bed6, RAVI, openLunch, trayDraft(openLunch.reading))
  // negative_overridden: no container, but it drafted water; saved as a 200 mL drink, still pending.
  clock.t = Math.round(now - HOUR)
  const overridden = noContainer('water')
  const overriddenRead = await logRead(bed6, attendant3A, { kind: 'photo', evidence: overridden })
  await store.addEntry(
    bed6,
    {
      direction: 'in',
      category: 'water',
      volume_ml: 200,
      item: 'water',
      drink: 'water',
      source: 'photo',
      confidence: 0.4,
      evidence: overridden,
      read_id: overriddenRead,
    },
    attendant3A,
  )
}

// Guard: the read mix the Data quality view shows, and every bed's prompts as they were before the additions above.
clock.t = now
{
  const since = now - 7 * 24 * HOUR
  const reads = await store.readOutcomeRows(since)
  const hospital = modelQuality(reads, now, { ward: null, days: 7 })
  const total = Object.fromEntries(READ_OUTCOMES.map((o) => [o, hospital.kinds.reduce((s, k) => s + k.outcomes[o], 0)]))
  const want: [string, boolean][] = [
    ['corrected_by_nurse >= 2', total.corrected_by_nurse! >= 2],
    ['edited_at_capture >= 1', total.edited_at_capture! >= 1],
    ['rejected >= 1', total.rejected! >= 1],
    ['abandoned = 1', total.abandoned === 1],
    ['negative_overridden = 1', total.negative_overridden === 1],
    ['nothing_drafted = 0', total.nothing_drafted === 0],
  ]
  // negative_confirmed = 2, per kind: the photo rows 1 (3A-5's no_container read) and the tray rows 1 (its not_a_meal read).
  const byKind = (kind: string, o: (typeof READ_OUTCOMES)[number]) =>
    hospital.kinds.filter((k) => k.kind === kind).reduce((s, k) => s + k.outcomes[o], 0)
  want.push(['photo negative_confirmed = 1', byKind('photo', 'negative_confirmed') === 1])
  want.push(['tray negative_confirmed = 1', byKind('tray', 'negative_confirmed') === 1])
  // accuracy-views' tray mix.
  want.push(['tray rejected >= 1', byKind('tray', 'rejected') >= 1])
  want.push(['tray edited_at_capture >= 1', byKind('tray', 'edited_at_capture') >= 1])
  want.push(['tray corrected_by_nurse >= 2', byKind('tray', 'corrected_by_nurse') >= 2])
  want.push(['tray open = 1', byKind('tray', 'open') === 1])
  want.push(['tray retaken = 1', byKind('tray', 'retaken') === 1])
  want.push(['meal_fluid.removed >= 1', hospital.meal_fluid.removed >= 1])
  want.push(['no tray read linked to an entry', !reads.some((r) => r.kind === 'tray' && r.links.some((l) => l.entry || l.level))])
  const ward3A = (await store.wards()).find((w) => w.code === '3A')!
  const photo3A = modelQuality(await store.readOutcomeRows(since, ward3A.id), now, { ward: ward3A, days: 7 }).kinds[0]!
  want.push([`3A photo accepted rate shown (${photo3A.accepted.n}/${photo3A.accepted.of})`, photo3A.accepted.pct !== null])
  const tray3A = modelQuality(await store.readOutcomeRows(since, ward3A.id), now, { ward: ward3A, days: 7 }).kinds.find(
    (k) => k.kind === 'tray' && k.mode === 'sam+spark',
  )!
  want.push([`3A tray sam+spark bar drawn (${tray3A.accepted.of} decided)`, tray3A.accepted.of >= MIN_N])
  const isBag = (r: (typeof reads)[number]) =>
    r.output.kind === 'photo' && (BAG_CONTAINERS as readonly string[]).includes(r.output.container)
  want.push(['a bag reading linked', reads.some((r) => r.links.some((l) => l.level?.event != null))])
  want.push(['no bag read linked to an entry', !reads.some((r) => isBag(r) && r.links.some((l) => l.entry))])
  const failed = want.filter(([, ok]) => !ok).map(([what]) => what)
  if (failed.length) throw new Error(`demo history: read mix ${JSON.stringify(total)} fails ${failed.join('; ')}`)
  const promptsAfter = await promptsOf()
  for (const [id, before] of promptsBefore) {
    if (promptsAfter.get(id) !== before)
      throw new Error(`demo history: bed ${id} prompts went from [${before}] to [${promptsAfter.get(id)}]`)
  }
}

// Guard: each care story bed raises exactly its intended prompts at the time of the run.
clock.t = now
const INTENDED: Record<string, AlertKind[]> = {
  'HDU-3': ['fluid_limit_near'],
  'HDU-1': ['catheter_review'],
  '5B-6': ['drink_too_thin', 'drink_consistency_unrecorded'],
  '2C-1': ['nil_by_mouth_intake', ...(now >= NBM_UNTIL ? (['nil_by_mouth_overdue'] as const) : [])],
  '3A-4': now >= onDayDate('14:00') ? ['intake_target_behind'] : [],
  // Bag beds (HDU-1's bag shows no prompt: checked 12 min ago, hourly).
  '3A-3': [],
  '2C-5': ['bag_reading_due'],
  '2C-6': ['bag_level_fell'],
  // bag-alerts: 2C-2's drain bag at 820 of 1000 mL; its urine output in the 6 h to the newest bag reading is 220 mL.
  '2C-2': ['bag_nearly_full'],
  // Dietitian beds: 3A-6's poor meals prompt; 3A-7's are held while it is referred.
  '3A-6': ['poor_meal_intake'],
  // patient-devices: 3A-7 uses the toilet, so its ~2400 mL intake and no output raise neither low output nor overload.
  '3A-7': [],
  // patient-devices: 2C-3's ileostomy is in force from admission; 150 mL is below 80% of 500 mL.
  '2C-3': [],
}
for (const [bed, want] of Object.entries(INTENDED)) {
  const got = (await chartView(store, (await store.admission(beds.get(bed)!))!)).alerts.map((a) => a.kind)
  if (got.toSorted().join() !== want.toSorted().join()) {
    throw new Error(`demo history: ${bed} raises [${got.join(', ')}], not [${want.join(', ')}]`)
  }
}

// Guard (patient-devices): each bed's devices, no bed raising bag_without_device, and photo urine in each bed's own vessel.
{
  const DEVICES: Record<string, OutputDevices> = {}
  const catheter = (bags: BagContainer[] = []): OutputDevices => ({
    urine: 'catheter',
    urine_from: 'catheter',
    urine_measured: true,
    bags: ['urine_bag', ...bags],
  })
  for (const a of admissions) {
    const bed = key(a.ward_code, a.bed)
    const method = VOIDING[bed]
    DEVICES[bed] = method
      ? { urine: method, urine_from: 'voiding', urine_measured: method !== 'toilet', bags: [] }
      : { urine: 'urinal', urine_from: 'default', urine_measured: true, bags: [] }
  }
  for (const bed of ['HDU-1', '3A-3', '2C-5', '2C-6']) DEVICES[bed] = catheter()
  DEVICES['2C-2'] = catheter(['drain_bag'])
  DEVICES['2C-3'] = { ...DEVICES['2C-3']!, bags: ['stoma_bag'] }
  const failed: string[] = []
  for (const a of admissions) {
    const bed = key(a.ward_code, a.bed)
    const v = await chartView(store, (await store.admission(a.id))!)
    if (JSON.stringify(v.devices) !== JSON.stringify(DEVICES[bed])) failed.push(`${bed} devices ${JSON.stringify(v.devices)}`)
    if (v.alerts.some((x) => x.kind === 'bag_without_device')) failed.push(`${bed} raises bag_without_device`)
    const want = v.devices.urine === 'catheter' ? null : VOIDING_CONTAINER[v.devices.urine]
    // Entries the app saved as entries: a bag reading's own entry (its levels) carries the reading's photo.
    for (const e of (await store.entries(a.id))!.entries.filter((x) => x.levels === null)) {
      if (e.evidence?.kind !== 'photo') continue
      if (e.evidence.reading.container === 'urine_bag') failed.push(`${bed} entry ${e.id} has urine bag evidence`)
      if (e.category !== 'urine') continue
      if (e.evidence.reading.container !== want) failed.push(`${bed} urine entry ${e.id} read in ${e.evidence.reading.container}`)
    }
  }
  // Every photo urine entry links a read.
  const linkRows = await handle.db.select({ entry_id: read_link.entry_id }).from(read_link).where(isNotNull(read_link.entry_id))
  const linked = new Set(linkRows.map((r) => r.entry_id))
  for (const a of admissions) {
    for (const e of (await store.entries(a.id))!.entries) {
      if (e.levels === null && e.category === 'urine' && e.evidence?.kind === 'photo' && !linked.has(e.id)) {
        failed.push(`${key(a.ward_code, a.bed)} photo urine entry ${e.id} links no read`)
      }
    }
  }
  if (failed.length) throw new Error(`demo history: devices guard fails ${failed.join('; ')}`)
}

// Guard (drink-types): every seeded drink has its kind, the kinds vary, and a photo drink's read is that kind.
{
  const failed: string[] = []
  const kinds = new Set<DrinkKind>()
  for (const a of admissions) {
    for (const e of (await store.entries(a.id))!.entries) {
      if (e.category !== 'water') continue
      if (e.drink === null) failed.push(`${key(a.ward_code, a.bed)} drink ${e.id} has no kind`)
      else kinds.add(e.drink)
      if (e.evidence?.kind === 'photo' && e.evidence.reading.fluid !== e.drink)
        failed.push(`${key(a.ward_code, a.bed)} drink ${e.id} read as ${e.evidence.reading.fluid}, charted as ${e.drink}`)
    }
  }
  if (kinds.size < 6) failed.push(`only ${kinds.size} drink kinds (${[...kinds].join(', ')})`)
  if (failed.length) throw new Error(`demo history: drinks guard fails ${failed.join('; ')}`)
}

// Guard: no bed but 3A-6 raises poor meal intake.
for (const a of admissions) {
  const bed = key(a.ward_code, a.bed)
  if (bed !== '3A-6' && (await chartView(store, (await store.admission(a.id))!)).alerts.some((x) => x.kind === 'poor_meal_intake')) {
    throw new Error(`demo history: ${bed} raises poor_meal_intake`)
  }
}

// Guard (dietitian-care): Sana Mirza's worklist.
{
  const sana = (await store.member(SANA))!
  const w = await worklistView(store, sana)
  const names = (ps: { admission: { ward_code: string; bed: string } }[]) =>
    ps.map((p) => key(p.admission.ward_code, p.admission.bed)).join()
  const got = { patients: names(w.patients), assigned: names(w.assigned), diets: names(w.diets) }
  const want = { patients: '3A-7', assigned: '2C-3', diets: '5B-6,HDU-3' }
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    throw new Error(`demo history: Sana Mirza's worklist is ${JSON.stringify(got)}, not ${JSON.stringify(want)}`)
  }
}

try {
  await media.check()
  await kept.flush()
} catch (err) {
  await store.close()
  console.error(
    `demo history: the media store refused the seed (${err instanceof MediaStoreError ? err.message : 'error'}${config.MEDIA_STORE === 's3' ? '; run pnpm dev:s3' : ''}). The database already holds the history: reset it with a fresh database (e.g. drop and recreate meniscus_dev) and run again.`,
  )
  process.exit(1)
}
if (media.kind === 'memory') console.error('demo history: MEDIA_STORE=memory, so the photos and tones are not kept (set MEDIA_STORE=s3)')
await store.close()
console.log(
  `demo history: ${HISTORY.length} fictional entries, ${bagCount} bag readings, ${meals} meals, ${readCount} logged reads and ${mediaCount} synthetic photos and tones across ${admissions.length} beds in the database`,
)
