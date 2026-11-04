import { ALERT_TONE, IDDSI_FOOD_LEVELS } from '@meniscus/shared'
import type {
  AcuityLevel,
  Alert,
  BagContainer,
  BagEvent,
  ContainerKind,
  DietType,
  DishKind,
  DrainSite,
  StomaType,
  VoidingMethod,
  Entry,
  FoodTexture,
  ReadingIssue,
  RejectReason,
} from '@meniscus/shared'

export const ALERT_LABEL: Record<Alert['kind'], string> = {
  low_urine_output: 'Low output',
  mismatch: 'Intake/output mismatch',
  intake_incomplete: 'Intake incomplete',
  overload: 'Overload',
  logging_gap: 'Logging gap',
  appearance: 'Appearance',
  nil_by_mouth_intake: 'Intake while NBM',
  nil_by_mouth_overdue: 'NBM past planned end',
  drink_too_thin: 'Drink too thin',
  drink_consistency_unrecorded: 'Consistency not recorded',
  fluid_limit_near: 'Near fluid limit',
  fluid_limit_reached: 'Fluid limit reached',
  intake_target_behind: 'Behind intake target',
  catheter_review: 'Catheter review',
  bag_reading_due: 'Bag reading due',
  bag_reading_overdue: 'Bag reading overdue',
  bag_level_fell: 'Bag level fell',
  bag_nearly_full: 'Bag nearly full',
  bag_without_device: 'Bag not on care plan',
  poor_meal_intake: 'Poor meal intake',
}

/** Severity of each prompt (moved to @meniscus/shared so the ward summary's `worst_tone` uses the same map). */
export { ALERT_TONE }

/** A bed's acuity level (charting/acuity), as its chip and the bed review say it. */
export const ACUITY_LABEL: Record<AcuityLevel, string> = { critical: 'Critical', watch: 'Watch', stable: 'Stable' }
/** The acuity chip's tone (DESIGN.md 7.5): always beside its label. */
/** A diet order's type (charting/care-plan "Diet order"), as the care plan, the badges and the worklist say it. */
export const DIET_LABEL: Record<DietType, string> = {
  regular: 'Regular',
  diabetic: 'Diabetic',
  renal: 'Renal',
  low_salt: 'Low salt',
  low_fat: 'Low fat',
  high_energy: 'High energy',
  gluten_free: 'Gluten free',
}
/** `IDDSI 6 Soft & bite-sized`: a diet's texture. */
export const FOOD_TEXTURE_LABEL = Object.fromEntries(IDDSI_FOOD_LEVELS.map((l) => [l.level, `IDDSI ${l.level} ${l.name}`])) as Record<
  FoodTexture,
  string
>
export const ACUITY_TONE: Record<AcuityLevel, 'danger' | 'warn' | 'neutral'> = { critical: 'danger', watch: 'warn', stable: 'neutral' }

/** Worst tone across a bed's prompts and queue: drives the card's status bar. */
export function bedTone(alerts: Alert[], pending: number): 'danger' | 'warn' | 'info' | 'pending' | 'ok' {
  const tones = alerts.map((a) => ALERT_TONE[a.kind])
  if (tones.includes('danger')) return 'danger'
  if (tones.includes('warn')) return 'warn'
  if (tones.includes('info')) return 'info'
  return pending ? 'pending' : 'ok'
}

/** A bed's status chip, from its worst tone: the ward dashboard and the bed review show the same text. */
export const STATUS_LABEL: Record<ReturnType<typeof bedTone>, string> = {
  danger: 'Review now',
  warn: 'Review',
  info: 'Check',
  pending: 'Pending',
  ok: 'On track',
}

/** An entry's status chip and its tone (DESIGN.md 2.1 tone map). */
export const ENTRY_STATUS_LABEL: Record<Entry['status'], string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
export const ENTRY_STATUS_TONE: Record<Entry['status'], 'pending' | 'ok' | 'neutral'> = {
  pending: 'pending',
  approved: 'ok',
  rejected: 'neutral',
}

/** The read's mode, in words. */
export const MODE_LABEL: Record<'sam+spark' | 'spark', string> = { 'sam+spark': 'SAM + Spark', spark: 'Spark only' }

export const CATEGORY_LABEL: Record<Entry['category'], string> = {
  water: 'Drink',
  food: 'Food',
  iv: 'IV fluid',
  urine: 'Urine',
  stoma: 'Stoma',
  drain: 'Drain',
  vomit: 'Vomit',
}

export const SOURCE_LABEL: Record<Entry['source'], string> = { photo: 'Photo', voice: 'Voice note', text: 'Typed note', manual: 'By hand' }

/** Output device values (charting/care-plan "Output device order values"), as the care plan, its forms and the badges say them. */
export const STOMA_LABEL: Record<StomaType, string> = { colostomy: 'Colostomy', ileostomy: 'Ileostomy' }
export const DRAIN_LABEL: Record<DrainSite, string> = { abdominal: 'Abdominal', chest: 'Chest', pelvic: 'Pelvic', wound: 'Wound' }
export const VOIDING_LABEL: Record<VoidingMethod, string> = {
  urinal: 'Urinal',
  bedpan: 'Bedpan',
  commode: 'Commode',
  toilet: 'Toilet',
  pads: 'Pads',
}

/** "Urine bag": a bag at the start of a sentence. */
export const BAG_NAME: Record<BagContainer, string> = { urine_bag: 'Urine bag', stoma_bag: 'Stoma bag', drain_bag: 'Drain bag' }
export const BAG_EVENT_LABEL: Record<BagEvent, string> = { check: 'Check', emptied: 'Emptied', bag_changed: 'Bag changed' }

export const CONTAINER_LABEL: Record<ContainerKind, string> = {
  urine_bag: 'urine bag',
  urinal: 'urinal',
  water_jug: 'water jug',
  water_bottle: 'water bottle',
  cup: 'cup',
  measuring_jug: 'measuring jug',
  stoma_bag: 'stoma bag',
  drain_bag: 'drain bag',
  bedpan: 'bedpan',
  commode_pan: 'commode pan',
  emesis_basin: 'emesis basin',
  food_tray: 'food tray',
  other: 'container',
  none: 'no container',
}

export const ISSUE_LABEL: Record<ReadingIssue, string> = {
  no_container: 'No container found',
  no_marks: 'No marks visible',
  blurry: 'Blurry',
  angled: 'Taken at an angle',
  occluded: 'Partly hidden',
  foam: 'Foam on top',
  multiple_containers: 'Several containers',
}

/** Friendly names for the model steps in a read's trace. */
export const STEP_LABEL: Record<string, string> = {
  'sam:container': 'SAM 3.1 · container outline',
  'sam:liquid': 'SAM 3.1 · liquid area',
  'sam:dish': 'SAM 3.1 · dish outlines',
  'sam:food': 'SAM 3.1 · food areas',
  'sam:served-dish': 'SAM 3.1 · served dish outlines',
  'sam:served-food': 'SAM 3.1 · served food areas',
  'spark:read': 'Muse Spark · reading',
  asr: 'Speech-to-text',
  'spark:note': 'Muse Spark · note',
  'spark:explain': 'Muse Spark · explanation',
  'spark:meal': 'Muse Spark · tray',
}

/** What a dish is charted as, in words (the tray reading's `dish_kind`). */
export const DISH_LABEL: Record<DishKind, string> = {
  rice: 'Rice',
  bread: 'Bread',
  dal_lentils: 'Dal / lentils',
  curry_vegetables: 'Curry / vegetables',
  meat_fish_egg: 'Meat, fish, egg',
  soup_broth: 'Soup / broth',
  porridge_cereal: 'Porridge / cereal',
  salad_raw: 'Salad',
  fruit: 'Fruit',
  dairy: 'Dairy',
  dessert_sweet: 'Dessert / sweet',
  snack: 'Snack',
  other: 'Other',
}

export const REJECT_LABEL: Record<RejectReason, string> = {
  wrong_bed: 'Wrong bed',
  duplicate: 'Duplicate',
  unreadable: 'Unreadable',
  wrong_volume: 'Wrong volume',
  not_given: "Didn't happen",
  other: 'Other',
}

/** Plain names for the models behind each trace step. */
export const MODEL_NAME: Record<string, string> = {
  'sam-3.1': 'SAM 3.1',
  'muse-spark-1.3': 'Muse Spark',
  'muse-voice-transcribe-1.0': 'Speech-to-text',
}
