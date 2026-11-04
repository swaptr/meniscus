import type { ComponentType, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { OutputDevices, Totals } from '@meniscus/shared'
import type { Swatch } from '../lib/urine.ts'
import { UrineSwatch } from './urine-swatch.tsx'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { confidenceChip, signedMl } from '../lib/format.ts'
import { stepperNames, stepVolume, VOLUME_STEP } from '../lib/volume.ts'
import { overloadTone } from '../lib/ward.ts'
import { Button } from './button.tsx'
import { AlertIcon, ClockIcon, DangerIcon, InfoIcon, MinusIcon, OkIcon, PlusIcon } from './icons.tsx'
import { bars, marks, tints, ui } from './ui.styles.ts'

export type Tone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'pending' | 'in' | 'out'

type Icon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>

/** Each status tone's Lucide glyph (DESIGN.md 2.1): status is never colour alone. */
export const TONE_ICON: Partial<Record<Tone, Icon>> = {
  danger: DangerIcon,
  warn: AlertIcon,
  info: InfoIcon,
  pending: ClockIcon,
  ok: OkIcon,
}

/** A status tone's glyph in its mark colour, decorative (the label beside it carries the meaning). */
export function ToneGlyph({ tone, size = 14 }: { tone: Tone; size?: 14 | 16 | 20 | 24 }) {
  const I = TONE_ICON[tone] ?? InfoIcon
  return (
    <span aria-hidden {...stylex.props(s.glyph, marks[tone])}>
      <I size={size} aria-hidden />
    </span>
  )
}

/**
 * The only page container (DESIGN.md 5.5): `bg`, 1 px `border`, `radius.md`, no shadow. `tone` adds the 4 px leading
 * edge (banners and bed tiles only). `count` is a chip beside the title; `note` a one-line `xs` muted line.
 */
export function Section({
  title,
  icon,
  subtitle,
  count,
  actions,
  tone,
  compact = false,
  id,
  children,
}: {
  title?: ReactNode
  /** A small muted Lucide icon before the title (no icon tiles). */
  icon?: ReactNode
  subtitle?: ReactNode
  count?: number
  actions?: ReactNode
  tone?: Tone
  /** Dense screens: padding `lg` instead of `xl`. */
  compact?: boolean
  id?: string
  children: ReactNode
}) {
  return (
    <section id={id} {...stylex.props(s.section, compact && s.compact, tone && bars[tone])}>
      {(title || actions) && (
        <header {...stylex.props(s.sectionHead)}>
          <div {...stylex.props(s.sectionTitles)}>
            {title && (
              <h2 {...stylex.props(s.sectionTitle)}>
                {icon && (
                  <span aria-hidden {...stylex.props(s.sectionIcon)}>
                    {icon}
                  </span>
                )}
                {title}
                {count !== undefined && <Chip tone="neutral">{count}</Chip>}
              </h2>
            )}
            {subtitle && <p {...stylex.props(s.sectionSub)}>{subtitle}</p>}
          </div>
          {actions && <div {...stylex.props(s.sectionActions)}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * Inline, persistent context (DESIGN.md 5.4). `role` follows intent: `alert` for a danger result (the default for
 * `danger`), `status` for an announced result, none for static guidance (the default otherwise).
 */
export function Notice({
  tone = 'info',
  role,
  action,
  children,
}: {
  tone?: Tone
  role?: 'alert' | 'status' | 'none'
  action?: ReactNode
  children: ReactNode
}) {
  const r = role ?? (tone === 'danger' ? 'alert' : 'none')
  return (
    <div role={r === 'none' ? undefined : r} {...stylex.props(s.notice, tints[tone], bars[tone])}>
      <ToneGlyph tone={tone} size={20} />
      <div {...stylex.props(s.noticeBody)}>{children}</div>
      {action}
    </div>
  )
}

/**
 * A chip (DESIGN.md 5.6): 24 px, `pill`, `xs`/600, at most 3 words. Status chips pass `glyph` for the tone's icon;
 * fact chips are `neutral` (a `subtle` fill with a 1 px `border` ring). Chips are never targets.
 */
export function Chip({
  tone = 'warn',
  dot = false,
  glyph = false,
  inset = false,
  children,
}: {
  tone?: Tone
  /** Legacy: a status chip's leading mark; now drawn as the tone's glyph. */
  dot?: boolean
  glyph?: boolean
  /** Kept for callers on inset panels; neutral chips always carry their ring. */
  inset?: boolean
  children: ReactNode
}) {
  const showGlyph = (glyph || dot) && TONE_ICON[tone] !== undefined
  return (
    <span {...stylex.props(s.chip, tints[tone], tone === 'neutral' && s.chipNeutral, inset && tone === 'neutral' && s.chipInset)}>
      {showGlyph && <ToneGlyph tone={tone} />}
      {children}
    </span>
  )
}

/** A model's confidence, the one way (web/interface "Confidence written one way"): `Photo · 82%`, warn below 75%. */
export function ConfidenceChip({ source, confidence }: { source: string; confidence: number }) {
  const c = confidenceChip(source, confidence)
  return <Chip tone={c.tone}>{c.text}</Chip>
}

/** The 24-hour totals as vitals. The balance takes the overload tone, none while urine is not measured. */
export function TotalsRow({
  totals,
  urine = null,
  devices,
}: {
  totals: Totals
  urine?: Swatch | null
  devices?: Pick<OutputDevices, 'urine_measured'> | null
}) {
  return (
    <dl {...stylex.props(s.totals)}>
      <Stat tone="in" label="In · 24 h" value={totals.in_ml} />
      <Stat tone="out" label="Out · 24 h" value={totals.out_ml} extra={urine && <UrineSwatch swatch={urine} size="sm" />} />
      <Stat
        tone={overloadTone(totals.balance_ml, devices)}
        label="Balance"
        value={totals.balance_ml}
        format={(v) => signedMl(v).replace(/ mL$/, '')}
      />
      <Stat tone="pending" label="Pending" value={totals.pending_ml} />
    </dl>
  )
}

/** A figure with its label and unit (`mL` by default, `''` for counts). */
export function Stat({
  label,
  value,
  tone = 'neutral',
  format = String,
  unit = 'mL',
  extra,
}: {
  label: string
  value: number | string
  tone?: Tone
  format?: (v: number) => string
  unit?: string
  /** A line under the value, e.g. the latest urine colour under Out. */
  extra?: ReactNode
}) {
  return (
    <div {...stylex.props(s.stat, tints[tone])}>
      <dt {...stylex.props(s.statLabel)}>{label}</dt>
      <dd {...stylex.props(s.statValue)}>
        {typeof value === 'number' ? format(value) : value}
        {unit && <span {...stylex.props(s.unit)}> {unit}</span>}
      </dd>
      {extra && <dd {...stylex.props(s.statExtra)}>{extra}</dd>}
    </div>
  )
}

/**
 * An inline count in a header (DESIGN.md 5.8): `subtle` fill, 44 px, the status chip then the figure. Rendered as a
 * button when `onClick` is given (a metric peek's trigger), else as text.
 */
export function StatChip({
  tone = 'neutral',
  label,
  value,
  unit = '',
  pressed,
  ...rest
}: {
  tone?: Tone
  label: ReactNode
  value: ReactNode
  unit?: string
  pressed?: boolean
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style' | 'value'>) {
  const body = (
    <>
      <Chip tone={tone} glyph>
        {label}
      </Chip>
      <span {...stylex.props(s.statChipValue)}>
        {value}
        {unit && <span {...stylex.props(s.unit)}> {unit}</span>}
      </span>
    </>
  )
  if (!rest.onClick && !rest['aria-haspopup']) return <span {...stylex.props(s.statChip)}>{body}</span>
  return (
    <button type="button" {...rest} {...stylex.props(s.statChip, s.statChipButton, ui.focus, pressed && s.statChipOpen)}>
      {body}
    </button>
  )
}

/** A bed's number on the accent fill with its ward code above (DESIGN.md 5.6): sm 44, md 52, lg 56. */
export function BedBadge({ ward, bed, size = 'md' }: { ward?: string | null; bed: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span {...stylex.props(s.badge, badgeSizes[size])}>
      {ward && <span {...stylex.props(s.badgeWard)}>{ward}</span>}
      <span {...stylex.props(s.badgeBed, size === 'sm' && s.badgeBedSm)}>{bed}</span>
    </span>
  )
}

/** Acuity: the three-step ink glyph, then its word (DESIGN.md 2.1 acuity ramp). Never a status colour. */
export function AcuityMark({ level, label }: { level: 'critical' | 'watch' | 'stable'; label: string }) {
  const filled = level === 'critical' ? 3 : level === 'watch' ? 2 : 1
  return (
    <span {...stylex.props(s.acuity)}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden {...stylex.props(acuityInk[level])}>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={i * 5} y={8 - i * 4} width="4" height={4 + i * 4} rx="1" {...stylex.props(i < filled ? s.stepOn : s.stepOff)} />
        ))}
      </svg>
      {label}
    </span>
  )
}

/** ▲ intake or ▼ output, an SVG glyph in the direction colour (DESIGN.md 5.6). */
export function Direction({ dir, label }: { dir: 'in' | 'out'; label?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      {...stylex.props(marks[dir], s.direction)}
    >
      <path d={dir === 'in' ? 'M6 1 L11 10 L1 10 Z' : 'M6 11 L11 2 L1 2 Z'} fill="currentColor" />
    </svg>
  )
}

/** Big +/- volume control for gloved hands (DESIGN.md 5.15): 52 px buttons, the value `num`/700 with its unit. */
export function Stepper({
  value,
  onChange,
  min = 1,
  max,
  step = VOLUME_STEP,
  label,
  unit = 'mL',
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  /** The field: the group name and the buttons' (`Less <label>` / `More <label>`). */
  label: string
  /** After the value: `mL` (volumes), `kcal` or `g protein` (diet targets). */
  unit?: string
}) {
  const to = (delta: number) => onChange(Math.min(max ?? Infinity, stepVolume(value, delta, min)))
  const names = stepperNames(label)
  return (
    <div role="group" aria-label={label} {...stylex.props(s.stepper)}>
      <Button variant="secondary" size="lg" icon aria-label={names.less} onClick={() => to(-step)} disabled={value <= min}>
        <MinusIcon size={20} aria-hidden />
      </Button>
      <output aria-live="polite" {...stylex.props(s.stepValue)}>
        {value}
        <span {...stylex.props(s.unit)}> {unit}</span>
      </output>
      <Button
        variant="secondary"
        size="lg"
        icon
        aria-label={names.more}
        onClick={() => to(step)}
        disabled={max !== undefined && value >= max}
      >
        <PlusIcon size={20} aria-hidden />
      </Button>
    </div>
  )
}

/** A lazy section's place while its chunk loads: its height reserved, never an empty jump (DESIGN.md 10). */
export function Reserve({ h }: { h: number }) {
  return <div aria-busy {...stylex.props(s.reserve(h))} />
}

const s = stylex.create({
  reserve: (h: number) => ({ minHeight: h, borderRadius: radius.md, backgroundColor: color.subtle }),
  glyph: { display: 'inline-flex', flexShrink: 0, lineHeight: 0 },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.xl,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    minWidth: 0,
  },
  compact: { padding: space.lg },
  sectionHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap' },
  sectionTitles: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    fontSize: text.lg,
    fontWeight: weight.bold,
    letterSpacing: '-0.01em',
  },
  sectionIcon: { display: 'inline-flex', color: color.muted, lineHeight: 0 },
  sectionSub: { fontSize: text.xs, color: color.muted },
  sectionActions: { display: 'flex', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.md,
    fontWeight: weight.regular,
  },
  noticeBody: { flexGrow: 1, minWidth: 0 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    paddingInline: space.md,
    minHeight: 24,
    borderRadius: radius.pill,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    whiteSpace: 'nowrap',
    lineHeight: text.leadingTight,
    fontVariantNumeric: 'tabular-nums',
  },
  chipNeutral: { boxShadow: `inset 0 0 0 1px ${color.border}` },
  chipInset: { backgroundColor: color.bg },
  totals: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: space.md, margin: 0 },
  stat: { display: 'flex', flexDirection: 'column', gap: space.xs, padding: space.lg, borderRadius: radius.md },
  statLabel: { fontSize: text.xs, fontWeight: weight.semibold },
  statExtra: { margin: 0, marginTop: space.xs, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  statValue: {
    margin: 0,
    fontSize: text.num,
    fontWeight: weight.bold,
    letterSpacing: '-0.02em',
    fontVariantNumeric: 'tabular-nums',
    color: color.fg,
  },
  unit: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted, letterSpacing: 0 },
  statChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.subtle,
    color: color.fg,
    borderWidth: 0,
    fontFamily: 'inherit',
  },
  statChipButton: { cursor: 'pointer', backgroundColor: { default: color.subtle, ':hover': color.grid } },
  statChipOpen: { boxShadow: `inset 0 -2px 0 ${color.accent}` },
  statChipValue: { fontSize: text.lg, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  badge: {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    color: color.onAccent,
    lineHeight: 1,
  },
  badgeWard: { fontSize: text.xs, fontWeight: weight.bold, marginBottom: space.xs },
  badgeBed: { fontSize: text.xl, fontWeight: weight.heavy, fontVariantNumeric: 'tabular-nums' },
  badgeBedSm: { fontSize: text.lg },
  acuity: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontSize: text.xs, fontWeight: weight.bold, color: color.fg },
  stepOn: { fill: 'currentColor' },
  stepOff: { fill: color.grid },
  direction: { flexShrink: 0 },
  stepper: { display: 'flex', alignItems: 'center', gap: space.md },
  stepValue: { minWidth: 110, textAlign: 'center', fontSize: text.num, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
})

const badgeSizes = stylex.create({
  sm: { width: 44, height: 44 },
  md: { width: 52, height: 52 },
  lg: { width: 56, height: 56 },
})

const acuityInk = stylex.create({
  critical: { color: color.critical },
  watch: { color: color.watch },
  stable: { color: color.stable },
})
