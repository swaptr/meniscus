import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@base-ui/react/radio-group'
import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { choiceItems } from '../lib/choice.ts'
import { color, layout, radius, space, text, weight } from '../tokens.stylex.ts'
import { CheckIcon } from './icons.tsx'
import { ui } from './ui.styles.ts'

/** An option: its value, its label (a label may be two lines), and an optional colour swatch (urine colour). */
export type Choice<T extends string> = readonly [T, ReactNode] | readonly [T, ReactNode, string]

/**
 * The one choice chip (DESIGN.md 5.14; web/interface "One choice chip"): pick one of 2–8 values in a form. Base UI
 * `RadioGroup` of 48 px chips; arrow keys move, one tab stop. Selected: the accent fill, white text and a check; never a
 * status colour. `size="lg"` (56 px) on attendant screens.
 */
export function ChoiceChips<T extends string>({
  legend,
  options,
  value,
  onChange,
  hideLegend = false,
  size = 'md',
  disabled,
}: {
  legend: string
  options: readonly Choice<T>[]
  value: T | null
  onChange: (value: T) => void
  hideLegend?: boolean
  size?: 'md' | 'lg'
  disabled?: boolean
}) {
  const items = choiceItems(
    options.map((o) => [o[0], o] as const),
    value,
  )
  return (
    <fieldset {...stylex.props(s.fieldset)}>
      <legend {...stylex.props(hideLegend ? ui.srOnly : s.legend)}>{legend}</legend>
      <RadioGroup
        aria-label={legend}
        value={value ?? ''}
        onValueChange={(v) => onChange(v as T)}
        disabled={disabled}
        {...stylex.props(s.grid)}
      >
        {items.map((i) => (
          <Radio.Root key={i.value} value={i.value} {...stylex.props(s.chip, ui.focus, size === 'lg' && s.lg, i.checked && s.on)}>
            <ChipBody checked={i.checked} label={i.label[1]} swatch={i.label[2]} />
          </Radio.Root>
        ))}
      </RadioGroup>
    </fieldset>
  )
}

/** Pick several (DESIGN.md 5.14): the same chip as pressed toggles in a Base UI `ToggleGroup`. */
export function ChoiceToggles<T extends string>({
  legend,
  options,
  values,
  onChange,
  hideLegend = false,
}: {
  legend: string
  options: readonly Choice<T>[]
  values: readonly T[]
  onChange: (values: T[]) => void
  hideLegend?: boolean
}) {
  return (
    <fieldset {...stylex.props(s.fieldset)}>
      <legend {...stylex.props(hideLegend ? ui.srOnly : s.legend)}>{legend}</legend>
      <ToggleGroup multiple aria-label={legend} value={[...values]} onValueChange={(v) => onChange(v)} {...stylex.props(s.grid)}>
        {options.map((o) => {
          const on = values.includes(o[0])
          return (
            <Toggle key={o[0]} value={o[0]} {...stylex.props(s.chip, ui.focus, on && s.on)}>
              <ChipBody checked={on} label={o[1]} swatch={o[2]} />
            </Toggle>
          )
        })}
      </ToggleGroup>
    </fieldset>
  )
}

function ChipBody({ checked, label, swatch }: { checked: boolean; label: ReactNode; swatch?: string | undefined }) {
  return (
    <>
      {swatch && <span aria-hidden {...stylex.props(s.swatch)} style={{ backgroundColor: swatch }} />}
      <span {...stylex.props(s.label)}>{label}</span>
      {checked && (
        <span aria-hidden {...stylex.props(s.check)}>
          <CheckIcon size={14} aria-hidden />
        </span>
      )}
    </>
  )
}

const s = stylex.create({
  fieldset: { display: 'flex', flexDirection: 'column', gap: space.sm, borderWidth: 0, padding: 0, margin: 0, minWidth: 0 },
  legend: { padding: 0, marginBottom: space.sm, fontSize: text.sm, fontWeight: weight.semibold, color: color.fg },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 124px), 1fr))', gap: space.sm },
  chip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    minHeight: 48,
    minWidth: layout.tap,
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    fontFamily: 'inherit',
    fontSize: text.sm,
    fontWeight: weight.semibold,
    lineHeight: text.leadingTight,
    textAlign: 'center',
    cursor: 'pointer',
    userSelect: 'none',
  },
  lg: { minHeight: 56, fontSize: text.md },
  on: {
    borderColor: color.accent,
    backgroundColor: { default: color.accent, ':hover': color.accentStrong },
    color: color.onAccent,
  },
  label: { minWidth: 0 },
  check: { display: 'inline-flex', lineHeight: 0 },
  swatch: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
  },
})
