import { useEffect, useRef } from 'react'
import { Select } from '@base-ui/react/select'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronsIcon, InChargeIcon } from './icons.tsx'
import { color, layer, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { picker as p } from './nurse-picker.styles.ts'

export interface NurseSelectProps {
  bed: string
  value: number | null
  label: string
  options: { value: number | null; label: string }[]
  disabled?: boolean
  onChange: (staffId: number | null) => void
  /** Opened by a press on the stand-in trigger before this code had loaded. */
  defaultOpen?: boolean
  /** The stand-in had keyboard focus when it was swapped out: carry it over (unless it has moved on meanwhile). */
  focusOnMount?: boolean
  /** A board row: smaller text and padding, no icon (still 44 px tall). */
  compact?: boolean
}

/** The select behind `NursePicker`, loaded on first use (Base UI's positioning and focus code is most of its size). */
export function NurseSelect({ bed, value, label, options, disabled, onChange, defaultOpen, focusOnMount, compact }: NurseSelectProps) {
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusOnMount && !defaultOpen && document.activeElement === document.body) trigger.current?.focus()
  }, [focusOnMount, defaultOpen])
  return (
    <Select.Root items={options} value={value} onValueChange={(v) => onChange(v)} disabled={disabled} defaultOpen={defaultOpen}>
      <Select.Trigger ref={trigger} aria-label={`Nurse for bed ${bed}`} {...stylex.props(p.trigger, compact && p.compact)}>
        {!compact && <InChargeIcon size={16} aria-hidden />}
        <Select.Value {...stylex.props(p.value)}>{() => label}</Select.Value>
        <Select.Icon {...stylex.props(p.chevron)}>
          <ChevronsIcon size={16} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false} {...stylex.props(s.positioner)}>
          <Select.Popup {...stylex.props(s.popup)}>
            <Select.List {...stylex.props(s.list)}>
              {options.map((o) => (
                <Select.Item key={o.value ?? 'none'} value={o.value} {...stylex.props(s.item)}>
                  <Select.ItemIndicator {...stylex.props(s.indicator)}>
                    <CheckIcon size={16} />
                  </Select.ItemIndicator>
                  <Select.ItemText {...stylex.props(s.itemText)}>{o.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  )
}

const s = stylex.create({
  positioner: { zIndex: layer.peek, outline: 'none' }, // focus-ok: positioner wrapper, never focused
  popup: {
    minWidth: 'var(--anchor-width)',
    paddingBlock: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
    outline: 'none', // focus-ok: popup container, focus moves to its items
  },
  list: { maxHeight: 'var(--available-height)', overflowY: 'auto' },
  item: {
    display: 'grid',
    gridTemplateColumns: '20px 1fr',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingInline: space.lg,
    fontSize: text.md,
    fontWeight: weight.semibold,
    color: color.fg,
    cursor: 'pointer',
    outline: 'none', // focus-ok: the highlighted item takes the subtle fill and accent edge
    userSelect: 'none',
    backgroundColor: { default: 'transparent', ':is([data-highlighted])': color.subtle },
    boxShadow: { default: 'none', ':is([data-highlighted])': `inset 2px 0 0 ${color.accent}` },
  },
  indicator: { gridColumnStart: 1, display: 'flex', color: color.accent },
  itemText: { gridColumnStart: 2 },
})
