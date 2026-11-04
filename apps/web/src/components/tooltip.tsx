import type { ReactElement, ReactNode } from 'react'
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip'
import * as stylex from '@stylexjs/stylex'
import { color, radius, space, text } from '../tokens.stylex.ts'

export const TooltipProvider = BaseTooltip.Provider

type Props = {
  content: ReactNode
  children: ReactElement
  side?: BaseTooltip.Positioner.Props['side']
}

export function Tooltip({ content, children, side = 'bottom' }: Props) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6}>
          <BaseTooltip.Popup {...stylex.props(styles.popup)}>{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  )
}

const styles = stylex.create({
  popup: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    borderRadius: radius.md,
    backgroundColor: color.fg,
    color: color.bg,
    fontSize: text.sm,
    lineHeight: text.leadingTight,
  },
})
