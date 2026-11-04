import { use, type ReactNode } from 'react'
import { Button as BaseButton } from '@base-ui/react/button'
import * as stylex from '@stylexjs/stylex'
import { color, layout, radius, space, text, weight } from '../tokens.stylex.ts'
import { ButtonIconSize, FocusableWhenDisabled } from './button-context.ts'
import { ui } from './ui.styles.ts'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
/** touch 44 px (the minimum target, the default), lg 52 px (capture and sign-in commits). */
type Size = 'touch' | 'lg'

type Props = Omit<BaseButton.Props, 'className' | 'style'> & {
  variant?: Variant
  size?: Size
  /** Square icon-only button; pass an `aria-label`. */
  icon?: boolean
  /** Full width of its container (capture commits on phones). */
  block?: boolean
  /** Keeps the idle label's width while a busy label (`Saving…`) replaces it. */
  minWidth?: number
  children?: ReactNode
}

// The one button primitive (DESIGN.md 5.16): actions, icon buttons, and links via `render`.
export function Button({ variant = 'primary', size = 'touch', icon = false, block = false, minWidth, children, ...props }: Props) {
  const keepFocusable = use(FocusableWhenDisabled)
  return (
    <BaseButton
      focusableWhenDisabled={keepFocusable}
      {...props}
      style={minWidth ? { minWidth } : undefined}
      className={(state) =>
        stylex.props(
          styles.base,
          ui.focus,
          sizes[size],
          icon && iconSizes[size],
          block && styles.block,
          variants[variant],
          state.disabled && styles.disabled,
        ).className
      }
    >
      <ButtonIconSize value={size === 'lg' ? 20 : 16}>{children}</ButtonIconSize>
    </BaseButton>
  )
}

const styles = stylex.create({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: radius.md,
    fontFamily: 'inherit',
    fontWeight: weight.semibold,
    lineHeight: text.leadingTight,
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    flexShrink: 0,
  },
  block: { width: '100%' },
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
})

const sizes = stylex.create({
  touch: {
    minHeight: layout.tap,
    minWidth: layout.tap,
    paddingInline: space.xl,
    fontSize: text.md,
  },
  lg: {
    minHeight: layout.tapGloved,
    minWidth: layout.tapGloved,
    paddingInline: space.xxl,
    fontSize: text.lg,
  },
})

const iconSizes = stylex.create({
  touch: { width: layout.tap, paddingInline: 0 },
  lg: { width: layout.tapGloved, paddingInline: 0 },
})

const variants = stylex.create({
  primary: {
    backgroundColor: {
      default: color.accent,
      ':hover:not([data-disabled])': color.accentStrong,
    },
    borderColor: 'transparent',
    color: color.onAccent,
  },
  secondary: {
    backgroundColor: {
      default: color.bg,
      ':hover:not([data-disabled])': color.subtle,
    },
    borderColor: color.borderStrong,
    color: color.fg,
  },
  danger: {
    backgroundColor: {
      default: color.bg,
      ':hover:not([data-disabled])': color.dangerBg,
    },
    borderColor: color.danger,
    color: color.danger,
  },
  ghost: {
    backgroundColor: {
      default: 'transparent',
      ':hover:not([data-disabled])': color.subtle,
    },
    borderColor: 'transparent',
    color: color.accent,
  },
})
