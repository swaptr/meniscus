import { Button } from './button.tsx'
import { ConfirmSheet } from './sheet.tsx'

/** "Switch user" with unsaved work: the question, "Cancel" (keeps everything) and "Discard and switch". Loaded on first ask. */
export function SwitchUserConfirm({
  question,
  busy,
  onCancel,
  onConfirm,
}: {
  question: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    // Above the lock, which offers "Switch user" too.
    <ConfirmSheet
      layer="overLock"
      onClose={onCancel}
      title={question}
      description="Unsaved drafts and round readings on this device are lost. Entries already saved are not affected."
      actions={
        <Button variant="danger" disabled={busy} onClick={onConfirm}>
          Discard and switch
        </Button>
      }
    />
  )
}
