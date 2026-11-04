import type { ReactNode, RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Dialog } from '@base-ui/react/dialog'
import { Button } from './button.tsx'
import { FocusableWhenDisabled } from './button-context.ts'
import { sheet } from './sheet.styles.ts'
import { Notice } from './ui.tsx'

type Layer = 'base' | 'nested' | 'overLock'

type Common = {
  title: ReactNode
  description?: ReactNode
  /** `Saved in the name of <name and role>.` on any dialog that writes; pass the `staffLabel()`. */
  savedAs?: string | null
  /** The inline refusal or failure, above the actions. */
  error?: ReactNode
  /** The commit (last). Cancel comes first, from `cancelLabel`. */
  actions?: ReactNode
  /** `null` hides Cancel (a dialog with its own close). */
  cancelLabel?: string | null
  /** The head's trailing control (an icon close on long sheets). */
  aside?: ReactNode
  layer?: Layer
  wide?: boolean
  /** Where focus goes on close; by default back to the control that opened it. */
  finalFocus?: boolean | RefObject<HTMLElement | null>
  initialFocus?: boolean | RefObject<HTMLElement | null>
  children?: ReactNode
}

const layerStyles = (l: Layer) =>
  l === 'nested'
    ? ([sheet.nestedBackdrop, sheet.nested] as const)
    : l === 'overLock'
      ? ([sheet.overLockBackdrop, sheet.overLock] as const)
      : ([null, null] as const)

/**
 * The one dialog (DESIGN.md 5.2; web/interface "One dialog layout"): a bottom sheet up to 640 px, a centred card from
 * 641 px. Title and description, the body, `Saved in the name of …`, the error, then Cancel and the commit.
 * Controlled: `open` defaults to true for dialogs mounted only while shown.
 */
export function Sheet({
  open = true,
  onClose,
  dismissible = true,
  title,
  description,
  savedAs,
  error,
  actions,
  cancelLabel = 'Cancel',
  aside,
  layer = 'base',
  wide = false,
  finalFocus,
  initialFocus,
  children,
}: Common & { open?: boolean; onClose: () => void; dismissible?: boolean }) {
  const [backdrop, popup] = layerStyles(layer)
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()} disablePointerDismissal={!dismissible}>
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(sheet.backdrop, backdrop)} />
        <Dialog.Popup finalFocus={finalFocus} initialFocus={initialFocus} {...stylex.props(sheet.popup, popup, wide && sheet.wide)}>
          <div {...stylex.props(sheet.head)}>
            <div {...stylex.props(sheet.headMain)}>
              <Dialog.Title {...stylex.props(sheet.title)}>{title}</Dialog.Title>
              {description && <Dialog.Description {...stylex.props(sheet.sub)}>{description}</Dialog.Description>}
            </div>
            {aside}
          </div>
          {children}
          {savedAs !== undefined && (
            <p {...stylex.props(sheet.savedAs)}>{savedAs ? `Saved in the name of ${savedAs}.` : 'Nobody is signed in on this device.'}</p>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          {(cancelLabel !== null || actions) && (
            <div {...stylex.props(sheet.actions)}>
              <FocusableWhenDisabled value>
                {cancelLabel !== null && <Dialog.Close render={<Button variant="secondary" />}>{cancelLabel}</Dialog.Close>}
                {actions}
              </FocusableWhenDisabled>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** A confirm (Base UI `AlertDialog`) on the same layout: no outside dismissal, Cancel then the commit. */
export function ConfirmSheet({
  open = true,
  onClose,
  title,
  description,
  savedAs,
  error,
  actions,
  cancelLabel = 'Cancel',
  layer = 'base',
  finalFocus,
  initialFocus,
  children,
}: Omit<Common, 'aside' | 'wide'> & { open?: boolean; onClose: () => void }) {
  const [backdrop, popup] = layerStyles(layer)
  return (
    <AlertDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop {...stylex.props(sheet.backdrop, backdrop)} />
        <AlertDialog.Popup finalFocus={finalFocus} initialFocus={initialFocus} {...stylex.props(sheet.popup, popup)}>
          <div {...stylex.props(sheet.headMain)}>
            <AlertDialog.Title {...stylex.props(sheet.title)}>{title}</AlertDialog.Title>
            {description && <AlertDialog.Description {...stylex.props(sheet.sub)}>{description}</AlertDialog.Description>}
          </div>
          {children}
          {savedAs !== undefined && (
            <p {...stylex.props(sheet.savedAs)}>{savedAs ? `Saved in the name of ${savedAs}.` : 'Nobody is signed in on this device.'}</p>
          )}
          {error && <Notice tone="danger">{error}</Notice>}
          <div {...stylex.props(sheet.actions)}>
            <FocusableWhenDisabled value>
              {cancelLabel !== null && <AlertDialog.Close render={<Button variant="secondary" />}>{cancelLabel}</AlertDialog.Close>}
              {actions}
            </FocusableWhenDisabled>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
