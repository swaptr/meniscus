import * as stylex from '@stylexjs/stylex'
import { color, space, text, weight } from '../tokens.stylex.ts'
import { Segmented } from './segmented.tsx'
import { ui } from './ui.styles.ts'
import { TimeField } from './form-fields.tsx'
import { clock } from '../lib/format.ts'

/** An hour ago, "HH:MM": the starting point for "Earlier". */
const hourAgo = () => clock(Date.now() - 3_600_000)

/** "When did it happen?": null is now; "HH:MM" is earlier, within the last 24 h. The caller checks the time. */
export function WhenField({
  value,
  onChange,
  error,
}: {
  value: string | null
  onChange: (v: string | null) => void
  error: string | null
}) {
  return (
    <div {...stylex.props(s.when)}>
      <span {...stylex.props(s.label)}>When did it happen?</span>
      <div {...stylex.props(ui.row)}>
        <Segmented
          label="When did it happen?"
          size="lg"
          value={value === null ? 'now' : 'earlier'}
          options={[
            ['now', 'Now'],
            ['earlier', 'Earlier'],
          ]}
          onChange={(v) => onChange(v === 'now' ? null : hourAgo())}
        />
        {value !== null && <TimeField label="Time it happened" hideLabel value={value} onChange={onChange} />}
      </div>
      {error ? (
        <span role="alert" {...stylex.props(s.error)}>
          {error}
        </span>
      ) : (
        value !== null && <span {...stylex.props(ui.muted)}>Within the last 24 h. A time later than now means yesterday.</span>
      )}
    </div>
  )
}

const s = stylex.create({
  when: { display: 'flex', flexDirection: 'column', gap: space.sm },
  label: { fontSize: text.sm, fontWeight: weight.semibold },
  error: { fontSize: text.sm, fontWeight: weight.semibold, color: color.danger },
})
