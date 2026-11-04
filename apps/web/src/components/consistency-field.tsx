import * as stylex from '@stylexjs/stylex'
import { IDDSI_DRINK_LEVELS, type IddsiLevel } from '@meniscus/shared'
import { iddsiChip } from '../lib/care.ts'
import { space } from '../tokens.stylex.ts'
import { Notice } from './ui.tsx'
import { ChoiceChips } from './choice-chips.tsx'

/**
 * A drink's consistency: IDDSI chips `0 Thin` … `4 Extremely thick`, none picked when `value` is null. `notice` (a drink
 * thinner than ordered) shows under the chips and never blocks saving. `levels` narrows the chips (1–4 for an order).
 */
export function ConsistencyField<L extends IddsiLevel>({
  value,
  onChange,
  notice = null,
  label = 'Consistency',
  levels,
}: {
  value: L | null | undefined
  onChange: (level: L) => void
  notice?: string | null
  label?: string
  levels?: readonly L[]
}) {
  const shown = levels ?? IDDSI_DRINK_LEVELS.map((l) => l.level as L)
  return (
    <div {...stylex.props(s.field)}>
      <ChoiceChips
        legend={label}
        options={shown.map((level) => [String(level), iddsiChip(level)] as const)}
        value={value == null ? null : String(value)}
        onChange={(v) => onChange(Number(v) as L)}
      />
      {notice && <Notice tone="warn">{notice}</Notice>}
    </div>
  )
}

const s = stylex.create({
  field: { display: 'flex', flexDirection: 'column', gap: space.sm },
})
