/** The `Drink` picker on the check screen (web/capture "Drink on the check screen"). */
import type { DrinkKind } from '@meniscus/shared'
import { DRINK_OPTIONS } from '../lib/drinks.ts'
import { SelectField } from './form-fields.tsx'

/** The `Drink` picker: the project's labelled `SelectField` (48 px, 17 px), unset until picked when `value` is null. */
export function DrinkPicker({ value, onChange }: { value: DrinkKind | null | undefined; onChange: (kind: DrinkKind) => void }) {
  return <SelectField label="Drink" value={value} options={DRINK_OPTIONS} onChange={onChange} placeholder="Choose the drink" />
}
