import * as stylex from '@stylexjs/stylex'

// Design contract v2 "Graduated" (apps/web/DESIGN.md §2). Every text/background and mark/track pair
// is checked by src/tokens.test.ts with the WCAG 2.2 formula in lib/contrast.ts.
// Status colours always come with a glyph and a label; direction colours are data, never status.

export const color = stylex.defineVars({
  // Neutrals: saline and ink.
  fg: '#13212f',
  muted: '#4d5d6c',
  bg: '#ffffff',
  /** Page background ("saline") and app bar. */
  canvas: '#eaf0f2',
  subtle: '#f4f7f8',
  /** Sidebar background. */
  rail: '#e5ecef',
  border: '#d0dbe0',
  /** Chart gridlines and in-sheet row dividers (recessive by design). */
  grid: '#e4eaed',
  /** Input, choice-chip, switch-off, segmented and gauge outlines, chart axes (3.59:1 on bg). */
  borderStrong: '#78899a',

  // Action.
  accent: '#0f766e',
  accentStrong: '#0b5c56',
  accentBg: '#e3f1ef',
  onAccent: '#ffffff',

  // Status (mark / tint); warnText is the warn text and any warn-toned meter fill.
  ok: '#137336',
  okBg: '#e2f5e7',
  warn: '#b07800',
  warnText: '#855900',
  warnBg: '#fcefc7',
  danger: '#b91c1c',
  dangerBg: '#fde8e8',
  info: '#0e5aa7',
  infoBg: '#e1edf9',
  pending: '#6d28d9',
  pendingBg: '#efe9fd',

  // Direction: intake saline blue, output mulberry.
  intake: '#2a78d6',
  intakeText: '#1a5fb4',
  intakeBg: '#e3eefb',
  output: '#9a4a8a',
  outputText: '#7d3570',
  outputBg: '#f5e6f1',

  // Acuity: an ordinal ink ramp, never a status tone.
  critical: '#13212f',
  watch: '#5b6b7a',
  stable: '#9aa8b4',

  // Sequential ramps, light to dark.
  intake1: '#86b6ef',
  intake2: '#3987e5',
  intake3: '#1c5cab',
  intake4: '#0d366b',
  output1: '#cf92c2',
  output2: '#b06aa2',
  output3: '#86407a',
  output4: '#5a2452',

  // Readout and tooltip.
  tip: '#13212f',
  onTip: '#ffffff',
})

export const space = stylex.defineVars({
  xs: '2px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  xxl: '24px',
  xxxl: '32px',
})

export const text = stylex.defineVars({
  xs: '12px',
  sm: '13px',
  md: '15px',
  lg: '17px',
  xl: '22px',
  num: '26px',
  hero: '32px',
  leading: '1.4',
  leadingTight: '1.2',
})

export const weight = stylex.defineVars({
  regular: '400',
  semibold: '600',
  bold: '700',
  heavy: '800',
})

export const radius = stylex.defineVars({
  sm: '4px',
  md: '8px',
  lg: '12px',
  pill: '999px',
})

export const shadow = stylex.defineVars({
  /** Nothing on the page casts a shadow (DESIGN.md 2.5). */
  card: 'none',
  /** Floating layers only: peeks, dialogs, sheets, toast, quick jump, drawer. */
  raised: '0 6px 24px rgba(19, 33, 47, 0.16), 0 1px 3px rgba(19, 33, 47, 0.10)',
})

export const layout = stylex.defineVars({
  tap: '44px',
  tapGloved: '52px',
  /** Fixed bottom tab bar height on phones (plus the safe-area inset). */
  tabBar: '64px',
  sidebar: '248px',
  appBar: '56px',
  content: '1080px',
  wide: '1400px',
  board: '1400px',
})

/** DESIGN.md 2.7. No other z-index. */
export const layer = stylex.defineVars({
  appBar: '1',
  tabBar: '2',
  drawer: '9',
  dialogBackdrop: '10',
  dialog: '11',
  nestedBackdrop: '12',
  nested: '13',
  peek: '20',
  viewerBackdrop: '20',
  viewer: '21',
  toast: '30',
  lock: '100',
  overLockBackdrop: '110',
  overLock: '111',
})

const REDUCE = '@media (prefers-reduced-motion: reduce)'

/** DESIGN.md 2.8: every duration is 0ms under reduced motion, in this one place. */
export const motion = stylex.defineVars({
  control: { default: '120ms', [REDUCE]: '0ms' },
  overlay: { default: '150ms', [REDUCE]: '0ms' },
  signature: { default: '480ms', [REDUCE]: '0ms' },
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
})
