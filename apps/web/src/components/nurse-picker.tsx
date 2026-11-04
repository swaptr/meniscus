import { lazy, startTransition, Suspense, useState, type FocusEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronsIcon, InChargeIcon } from './icons.tsx'
import { picker as s } from './nurse-picker.styles.ts'
import type { NurseSelectProps } from './nurse-select.tsx'

const load = () => import('./nurse-select.tsx')
// Set once the select's code is in: pickers mounted after that render the select straight away.
let loaded = false
const NurseSelect = lazy(() =>
  load().then((m) => {
    loaded = true
    return { default: m.NurseSelect }
  }),
)

type Props = Omit<NurseSelectProps, 'defaultOpen' | 'focusOnMount'>

/**
 * A bed's nurse for this shift: the team's nurses and `Unassigned`. One change = one PUT, made by the caller. The
 * trigger reads like the bed's nurse line elsewhere (`Nurse: Divya K.`).
 *
 * The select's code loads on first use, not with the ward: until then a stand-in that looks the same holds its place.
 * Hover or touch fetches the code; a press opens the select once it is in, and keyboard focus moves over to it.
 */
export function NursePicker(props: Props) {
  const [live, setLive] = useState<{ open: boolean; focus: boolean } | null>(() => (loaded ? { open: false, focus: false } : null))
  // A transition, so the stand-in stays in place (and focused) until the select is ready to replace it.
  const goLive = (open: boolean, focus: boolean) => startTransition(() => setLive({ open, focus }))
  return (
    <Suspense fallback={<StandIn {...props} />}>
      {live ? (
        <NurseSelect {...props} defaultOpen={live.open} focusOnMount={live.focus} />
      ) : (
        <StandIn {...props} onWarm={() => void load()} onPress={() => goLive(true, false)} onKeyboardFocus={() => goLive(false, true)} />
      )}
    </Suspense>
  )
}

/** The select's closed trigger, without the select: same element, attributes and content as `Select.Trigger`. */
function StandIn({
  bed,
  label,
  disabled,
  compact,
  onWarm,
  onPress,
  onKeyboardFocus,
}: Props & { onWarm?: () => void; onPress?: () => void; onKeyboardFocus?: () => void }) {
  return (
    <button
      type="button"
      role="combobox"
      aria-expanded={false}
      aria-haspopup="listbox"
      aria-label={`Nurse for bed ${bed}`}
      disabled={disabled}
      onPointerEnter={onWarm}
      onFocus={(e: FocusEvent<HTMLButtonElement>) => {
        if (e.currentTarget.matches(':focus-visible')) onKeyboardFocus?.()
      }}
      onClick={onPress}
      {...stylex.props(s.trigger, compact && s.compact)}
    >
      {!compact && <InChargeIcon size={16} aria-hidden />}
      <span {...stylex.props(s.value)}>{label}</span>
      <span aria-hidden {...stylex.props(s.chevron)}>
        <ChevronsIcon size={16} />
      </span>
    </button>
  )
}
