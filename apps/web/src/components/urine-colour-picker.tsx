import { URINE_COLOURS, URINE_REFERENCE, type UrineColour } from '@meniscus/shared'
import { URINE_LABEL } from '../lib/urine.ts'
import { ChoiceChips } from './choice-chips.tsx'

/** Seven labelled colour chips with their swatch. Picking one replaces the read colour (the caller drops the photo colour). */
export function UrineColourPicker({ value, onChange }: { value: UrineColour | null | undefined; onChange: (c: UrineColour) => void }) {
  return (
    <ChoiceChips
      legend="Urine colour"
      hideLegend
      options={URINE_COLOURS.map((c) => [c, URINE_LABEL[c], URINE_REFERENCE[c]] as const)}
      value={value ?? null}
      onChange={onChange}
    />
  )
}
