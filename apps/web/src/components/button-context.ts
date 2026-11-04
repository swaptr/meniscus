import { createContext, use } from 'react'

/** The icon size inside a button: 16 at `touch`, 20 at `lg` (DESIGN.md 5.16). Icons read it with `useButtonIconSize()`. */
export const ButtonIconSize = createContext<16 | 20>(16)
export const useButtonIconSize = () => use(ButtonIconSize)

/**
 * Inside a dialog's actions, a disabled commit stays focusable (`aria-disabled`), so the dialog's focus guards always
 * have a last control to wrap from: with a natively disabled last button, Tab escaped the dialog (ui-polish 4.6).
 */
export const FocusableWhenDisabled = createContext(false)
