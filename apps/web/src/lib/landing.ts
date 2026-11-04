/** Copy and numbers for the public landing page at `/` (web/staff "Landing page"). Pure, so tests read it without a DOM. */
import { URINE_COLOURS, type UrineColour } from '@meniscus/shared'
import { PRODUCT } from './brand.ts'
import { URINE_LABEL } from './urine.ts'

/**
 * The reads the hero plays in turn (detect, outline, measure, draft). Every number shown comes from these: the level
 * is drawn at `to` (a share of the container's height), and its labels and chip are `capacity × share`. The urine bag
 * is first, and the still frame under reduced motion.
 */
export const LANDING_READS = [
  {
    kind: 'bag',
    name: 'Urine bag',
    detect: 'SAM 3.1 · urine bag 0.97',
    region: 'liquid 0.94',
    capacity: 1000,
    from: 0.04,
    to: 0.45,
    rest: 0.03,
    direction: 'output',
  },
  {
    kind: 'iv',
    name: 'IV bag',
    detect: 'SAM 3.1 · IV bag 0.96',
    region: 'fluid 0.93',
    capacity: 500,
    from: 1,
    to: 0.5,
    rest: 0.5,
    direction: 'intake',
  },
  {
    kind: 'cup',
    name: 'Water glass',
    detect: 'SAM 3.1 · glass 0.95',
    region: 'water 0.92',
    capacity: 300,
    from: 0.8,
    to: 0.2,
    rest: 0.2,
    direction: 'intake',
  },
  {
    kind: 'tray',
    name: 'Meal tray',
    detect: 'SAM 3.1 · plate 0.97',
    region: 'rice',
    capacity: 0,
    from: 1,
    to: 0.25,
    rest: 0.25,
    direction: 'intake',
  },
] as const

export type LandingRead = (typeof LANDING_READS)[number]

/** mL at a share of the container. */
export const mlAt = (read: LandingRead, share: number) => Math.round(read.capacity * share)
const pctOf = (share: number) => `${Math.round(share * 100)}%`

/** The measurement drawn beside the level: what is in the container and how full it is. */
export const measureText = (read: LandingRead) =>
  read.kind === 'bag' ? `${mlAt(read, read.to)} mL · fill ${pctOf(read.to)}` : `${mlAt(read, read.to)} mL left · ${pctOf(read.to)}`

/** Muse Spark's draft: the bag's volume and colour, what ran in from the IV bag, what was drunk from the glass. */
export const draftText = (read: LandingRead, colour: UrineColour) =>
  read.kind === 'bag'
    ? `${mlAt(read, read.to)} mL urine · ${URINE_LABEL[colour].toLowerCase()}`
    : read.kind === 'iv'
      ? `IV ${mlAt(read, read.from) - mlAt(read, read.to)} mL`
      : `Water ${mlAt(read, read.from) - mlAt(read, read.to)} mL`

/** The bag emptied down to its residual: what was poured out. */
export const emptiedText = (read: LandingRead) => `Emptied ${mlAt(read, read.to) - mlAt(read, read.rest)} mL`

/** The plate is four portions, eaten one bite at a time; the labels follow what is left. */
export const BITES = 3
export const coverageText = (eaten: number) => `coverage ${100 - 25 * eaten}%`
export const trayDraft = (eaten: number) => (eaten === 0 ? 'Lunch served' : `Lunch ${['¼', '½', '¾'][eaten - 1]} eaten`)
/** When each bite is taken, in ms from the start of the tray's read. */
export const BITE_AT_MS = [700, 1400, 2100] as const

/** How long each read stays on screen before the next one, in ms: the urine bag also shows it being emptied. */
export const readMs = (read: LandingRead) => (read.kind === 'bag' ? 9000 : 6500)

/** A urine colour from the app's scale, picked anew each time the bag comes round (`random` in [0, 1)). */
export const pickColour = (random: number): UrineColour => URINE_COLOURS[Math.floor(random * URINE_COLOURS.length)] ?? 'yellow'

/** The read shown after `i`, wrapping. */
export const nextRead = (i: number) => (i + 1) % LANDING_READS.length

export const LANDING_COPY = {
  product: PRODUCT,
  tagline: 'Fluid charts that keep up with the ward',
  pitch:
    'A photo or voice note at the bed becomes a draft fluid intake and output entry that a nurse approves, read by Meta’s Muse Spark, SAM 3.1 and speech-to-text.',
  reads: LANDING_READS,
  chipLabel: 'Muse Spark draft',
  steps: [
    { title: 'Capture at the bed', body: 'Photograph a urine bag, jug or meal tray, or say what was drunk. No typing with gloves on.' },
    {
      title: 'AI drafts the entry',
      body: 'SAM 3.1 outlines the container and the liquid; Muse Spark reads the volume and writes a draft.',
    },
    {
      title: 'Nurse approves',
      body: 'The nurse checks the labelled photo, corrects it if needed, and approves. Nothing is charted without them.',
    },
  ],
  note: 'Not a diagnostic device; nurses approve every entry',
  signIn: 'Sign in',
  stepsTitle: 'How it works',
  illustration:
    'Reads in turn: a 1000 mL urine bag filled to 450 mL and emptied, a 500 mL IV bag run down to 250 mL, a glass of water drunk down by 180 mL and a lunch plate eaten to a quarter, each detected, outlined and measured by SAM 3.1, with Muse Spark’s draft entry',
} as const
