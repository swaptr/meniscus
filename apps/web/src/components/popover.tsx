/**
 * The app's one Popover wrapper (DESIGN.md 5.1). Every peek and the outcome-bar popup use it. The open rules live in
 * `lib/peek.ts` (tested without a DOM): a fine pointer resting `delay` ms (400) opens it, it closes `closeDelay` ms
 * (150) after the pointer leaves trigger and popup, a tap, click, Enter or Space opens it pinned, focus alone never
 * opens it, Escape or a press outside closes it (focus back to the trigger), and one list shares one popup across its
 * triggers. Triggers are plain buttons; the Base UI popup is a lazy chunk loaded on the first open (design.md D9).
 */
import { lazy, Suspense, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { usePopoverList, type PopoverList } from './use-popover-list.ts'
import type { PopupProps } from './popover-popup.tsx'

const PopoverPopup = lazy(() => import('./popover-popup.tsx')) as <P>(p: PopupProps<P>) => ReactNode

type TriggerProps<P> = {
  list: PopoverList<P>
  payload: P
  /** The trigger's accessible name; omit when its children name it. */
  label?: string
  children: ReactNode
  xstyle?: stylex.StyleXStyles
  /** Extra state style while this trigger's popup is open. */
  openStyle?: stylex.StyleXStyles
}

export function PopoverTrigger<P>({ list, payload, label, children, xstyle, openStyle }: TriggerProps<P>) {
  const id = useId()
  const ref = useRef<HTMLButtonElement>(null)
  const open = list.state.open === id
  useLayoutEffect(() => {
    const el = ref.current
    if (el) list.triggers.set(id, el)
    list.payloads.set(id, payload)
    return () => {
      list.triggers.delete(id)
      list.payloads.delete(id)
    }
  }, [list, id, payload])
  return (
    <button
      ref={ref}
      type="button"
      data-peek-trigger=""
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      onPointerEnter={(e) => list.ctl.enter(id, e.pointerType)}
      onPointerLeave={() => list.ctl.leave(id)}
      onClick={() => list.ctl.press(id)}
      {...stylex.props(xstyle, open && openStyle)}
    >
      {children}
    </button>
  )
}

type RootProps<P> = {
  list: PopoverList<P>
  /** The popup's content for the open trigger's payload. */
  children: (payload: P) => ReactNode
  /** The popup's accessible name for a payload. */
  popupLabel: (payload: P) => string
  /** `tip`: a dark one-line card (outcome bars). `card`: the peek's white card. */
  variant?: 'tip' | 'card'
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Bottom sheet: anchored to the viewport's bottom edge, full width (peeks up to 640 px). */
  sheet?: boolean
}

export function PopoverRoot<P>({ list, children, popupLabel, variant = 'card', side = 'bottom', sheet = false }: RootProps<P>) {
  // Mounted from the first open on, so later closes animate out.
  const [used, setUsed] = useState(false)
  if (!used && list.state.open !== null) setUsed(true)
  if (!used) return null
  return (
    <Suspense fallback={null}>
      <PopoverPopup list={list} popupLabel={popupLabel} variant={variant} side={side} sheet={sheet}>
        {children}
      </PopoverPopup>
    </Suspense>
  )
}

type Props = {
  /** The trigger button's accessible name. */
  label: string
  /** The popup's accessible name. */
  popupLabel: string
  content: ReactNode
  /** The trigger's visual children; hidden from assistive tech, since `label` names the button. */
  children: ReactNode
  xstyle?: stylex.StyleXStyles
  side?: 'top' | 'bottom' | 'left' | 'right'
}

/** A single trigger with its own popup, in the dark tip style (the outcome bars). Same rules as every peek. */
export function Popover({ label, popupLabel, content, children, xstyle, side = 'bottom' }: Props) {
  const list = usePopoverList<true>()
  return (
    <>
      <PopoverTrigger list={list} payload label={label} xstyle={xstyle}>
        {children}
      </PopoverTrigger>
      <PopoverRoot list={list} popupLabel={() => popupLabel} variant="tip" side={side}>
        {() => content}
      </PopoverRoot>
    </>
  )
}
