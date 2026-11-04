/**
 * The Base UI half of the one Popover wrapper (DESIGN.md 5.1, design.md D9): a lazy chunk, loaded the first time any
 * peek or outcome-bar popup opens, so no route pays for it at first paint. `popover.tsx` holds the triggers.
 */
import type { ReactNode } from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import * as stylex from '@stylexjs/stylex'
import type { PopoverList } from './use-popover-list.ts'
import { color, layer, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'

export type PopupProps<P> = {
  list: PopoverList<P>
  children: (payload: P) => ReactNode
  popupLabel: (payload: P) => string
  variant: 'tip' | 'card'
  side: 'top' | 'bottom' | 'left' | 'right'
  sheet: boolean
}

/** A virtual anchor along the viewport's bottom edge, so a sheet-mode peek sits there. */
const bottomEdge = {
  getBoundingClientRect: () => {
    const w = document.documentElement.clientWidth
    const h = window.innerHeight
    return { x: 0, y: h, top: h, bottom: h, left: 0, right: w, width: w, height: 0, toJSON: () => ({}) } as DOMRect
  },
}

export default function PopoverPopup<P>({ list, children, popupLabel, variant, side, sheet }: PopupProps<P>) {
  const id = list.state.open
  const trigger = id === null ? null : (list.triggers.get(id) ?? null)
  const payload = id === null ? undefined : list.payloads.get(id)
  const pinned = list.state.pinned
  return (
    <BasePopover.Root
      open={id !== null && payload !== undefined}
      onOpenChange={(open, d) => {
        if (open) return
        // A press on the open trigger is its own toggle (lib/peek.ts `press`), not a press outside.
        const target = d.event?.target
        if (d.reason === 'outside-press' && trigger && target instanceof Node && trigger.contains(target)) return d.cancel()
        list.ctl.close()
      }}
    >
      {payload === undefined || !trigger ? null : (
        <BasePopover.Portal>
          <BasePopover.Positioner
            anchor={sheet ? bottomEdge : trigger}
            side={sheet ? 'top' : side}
            sideOffset={sheet ? 0 : 6}
            collisionPadding={sheet ? 0 : 8}
            {...(sheet && { positionMethod: 'fixed' as const })}
            {...stylex.props(s.positioner)}
          >
            <BasePopover.Popup
              data-peek-popup=""
              aria-label={popupLabel(payload)}
              // Pinned (a tap, click, Enter or Space) moves focus inside; hover leaves it where it is.
              initialFocus={pinned}
              // Escape or Close returns focus to the trigger that opened it.
              finalFocus={pinned ? { current: trigger } : false}
              onPointerEnter={() => list.ctl.enterPeek()}
              onPointerLeave={() => list.ctl.leavePeek()}
              {...stylex.props(variant === 'tip' ? s.tip : s.card, sheet && s.sheet)}
            >
              {children(payload)}
              {sheet && <BasePopover.Close {...stylex.props(s.close)}>Close</BasePopover.Close>}
            </BasePopover.Popup>
          </BasePopover.Positioner>
        </BasePopover.Portal>
      )}
    </BasePopover.Root>
  )
}

const s = stylex.create({
  positioner: { zIndex: layer.peek },
  tip: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.tip,
    color: color.onTip,
    fontSize: text.sm,
    lineHeight: text.leadingTight,
    outline: 'none', // focus-ok: popup container, focus moves inside
    boxShadow: shadow.raised,
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transitionProperty: 'opacity',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    width: 'min(400px, calc(100vw - 16px))',
    maxHeight: '70vh',
    overflowY: 'auto',
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    color: color.fg,
    fontSize: text.sm,
    lineHeight: text.leading,
    boxShadow: shadow.raised,
    outline: 'none', // focus-ok: popup container, focus moves inside
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transform: { default: 'none', ':is([data-starting-style],[data-ending-style])': 'translateY(4px)' },
    transitionProperty: 'opacity, transform',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  sheet: {
    width: '100vw',
    maxHeight: '80vh',
    paddingBottom: `calc(${space.xl} + env(safe-area-inset-bottom))`,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    transform: { default: 'none', ':is([data-starting-style],[data-ending-style])': 'translateY(16px)' },
  },
  close: {
    alignSelf: 'stretch',
    minHeight: 44,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    backgroundColor: color.bg,
    color: color.fg,
    font: 'inherit',
    fontWeight: weight.semibold,
    cursor: 'pointer',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
})
