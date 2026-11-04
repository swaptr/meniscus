import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { REFERRAL_NOTE_MAX, REFERRAL_REASONS, type ReferralReason } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { REFER, REFERRAL_REASON_LABEL, referBody, referralAction } from '../lib/nutrition.ts'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { f } from './form.styles.ts'
import { Sheet } from './sheet.tsx'
import { sheet } from './sheet.styles.ts'

const REASONS = REFERRAL_REASONS.map((r) => [r, REFERRAL_REASON_LABEL[r]] as const)

/** Refer the bed to the ward's dietitians: a reason and an optional note, then one request and the reload. */
export function ReferralDialog({
  admissionId,
  bed,
  onClose,
  onDone,
  reload,
}: {
  admissionId: number
  /** `3A-6`, for the title. */
  bed: string
  onClose: () => void
  onDone: (message: string) => void
  reload: () => void
}) {
  const staff = useStaff()
  const [reason, setReason] = useState<ReferralReason | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const body = referBody(reason, note)
  const over = note.trim().length > REFERRAL_NOTE_MAX
  const send = async () => {
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      onDone(await referralAction(api, { op: 'refer', admissionId, body }, reload))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Sheet
      onClose={onClose}
      title={`${REFER}, ${bed}`}
      description="The dietitians covering this ward see it on their worklist."
      savedAs={staffLabel(staff)}
      error={error}
      actions={
        <Button disabled={busy || body === null} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Send'}
        </Button>
      }
    >
      <ChoiceChips legend="Reason" options={REASONS} value={reason} onChange={setReason} />
      <div {...stylex.props(f.field)}>
        <label htmlFor="referral-note" {...stylex.props(f.label)}>
          Note (optional)
        </label>
        <input
          id="referral-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-describedby="referral-note-hint"
          aria-invalid={over}
          {...stylex.props(f.input)}
        />
        <span id="referral-note-hint" role={over ? 'alert' : undefined} {...stylex.props(over ? sheet.error : f.hint)}>
          {over ? `At most ${REFERRAL_NOTE_MAX} characters.` : `Up to ${REFERRAL_NOTE_MAX} characters.`}
        </span>
      </div>
    </Sheet>
  )
}
