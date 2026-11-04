import {
  AUTO_CONFIRM_CONFIDENCE,
  READ_AGREEMENT_TOLERANCE,
  DRINK_LABEL,
  isDrinkKind,
  type ContainerKind,
  type ContainerReading,
  type DraftEntry,
  type DrinkKind,
  type EntryCategory,
  type FluidKind,
} from '@meniscus/shared'

const FLUID_CATEGORY: Record<FluidKind, EntryCategory | null> = {
  urine: 'urine',
  stoma_output: 'stoma',
  drain_fluid: 'drain',
  vomit: 'vomit',
  water: 'water',
  tea: 'water',
  coffee: 'water',
  milk: 'water',
  juice: 'water',
  coconut_water: 'water',
  buttermilk: 'water',
  ors: 'water',
  supplement: 'water',
  soup: 'food',
  other: null,
  none: null,
}

const CONTAINER_CATEGORY: Partial<Record<ContainerKind, EntryCategory>> = {
  urinal: 'urine',
  urine_bag: 'urine',
  stoma_bag: 'stoma',
  drain_bag: 'drain',
  bedpan: 'urine',
  commode_pan: 'urine',
  emesis_basin: 'vomit',
  water_jug: 'water',
  water_bottle: 'water',
  cup: 'water',
}

const OUTPUT_CATEGORIES: ReadonlySet<EntryCategory> = new Set(['urine', 'stoma', 'drain', 'vomit'])

/** The chart category a reading maps to: the liquid's, else the container's; null when neither identifies one. */
export function readingCategory(fluid: FluidKind, container: ContainerKind): EntryCategory | null {
  return FLUID_CATEGORY[fluid] ?? CONTAINER_CATEGORY[container] ?? null
}

/** Whether a reading is an output (urine, stoma, drain, vomit). */
export const isOutputReading = (fluid: FluidKind, container: ContainerKind): boolean => {
  const category = readingCategory(fluid, container)
  return category !== null && OUTPUT_CATEGORIES.has(category)
}

/** Pure: model reading → suggested chart entry. Liquid type beats container type. Intake is named by its drink, output by its container. */
export function toDraft(r: ContainerReading): DraftEntry | null {
  const category = readingCategory(r.fluid, r.container)
  if (!category) return null
  const intake = !OUTPUT_CATEGORIES.has(category)
  const drink: DrinkKind | null = !intake ? null : isDrinkKind(r.fluid) ? r.fluid : category === 'water' ? 'other' : null
  const item = intake
    ? (r.drink_name ?? (drink && drink !== 'other' ? DRINK_LABEL[drink] : null))
    : r.container === 'other' || r.container === 'none'
      ? null
      : r.container.replace(/_/g, ' ')
  return {
    direction: intake ? 'in' : 'out',
    category,
    volume_ml: r.volume_ml,
    item,
    notes: r.appearance,
    ...(category === 'urine' && r.urine_colour ? { urine_colour: r.urine_colour, urine_rgb: r.urine_rgb ?? null } : {}),
    drink,
  }
}

/** Below this, the entry is shown with its photo for manual reading instead of one-tap confirm. */
export { AUTO_CONFIRM_CONFIDENCE }

/**
 * Pure: should a human read the photo? Low confidence, no value, or SAM and
 * Spark disagreeing on how full the container is.
 */
export function needsReview(r: ContainerReading, fillFraction: number | null): string[] {
  const reasons: string[] = []
  if (r.volume_ml === null) reasons.push('no volume read')
  if (r.confidence < AUTO_CONFIRM_CONFIDENCE) reasons.push(`low confidence (${r.confidence.toFixed(2)})`)
  if (!r.marks_visible) reasons.push('no graduation marks visible')
  if (fillFraction !== null && r.volume_ml !== null && r.capacity_ml) {
    const sparkFill = r.volume_ml / r.capacity_ml
    // Wide tolerance: geometric fill ignores taper and bag shape.
    if (Math.abs(sparkFill - fillFraction) > READ_AGREEMENT_TOLERANCE) {
      reasons.push(`segmentation fill ${Math.round(fillFraction * 100)}% vs reading ${Math.round(sparkFill * 100)}%`)
    }
  }
  return reasons
}
