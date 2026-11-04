import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { REFERRAL_OUTCOMES, REFERRAL_REVIEW_MAX_DAYS, type ReferralOutcome } from '@meniscus/shared'
import { api, errorText } from '../lib/api.ts'
import { REFERRAL_OUTCOME_LABEL, closeBody, referralAction, reviewBounds } from '../lib/nutrition.ts'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { f } from './form.styles.ts'
import { Sheet } from './sheet.tsx'

const OUTCOMES = REFERRAL_OUTCOMES.map((o) => [o, REFERRAL_OUTCOME_LABEL[o]] as const)

/** Close a referral with an outcome and an optional next review date: one request, then the reload. Dietitians only. */
export function CloseReferralDialog({
  referralId,
  now,
  onClose,
  onDone,
  reload,
}: {
  referralId: number
  now: number
  onClose: () => void
  onDone: (message: string) => void
  reload: () => void
}) {
  const staff = useStaff()
  const [outcome, setOutcome] = useState<ReferralOutcome | null>(null)
  const [review, setReview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bounds = reviewBounds(now)
  const body = closeBody(outcome, review)
  const save = async () => {
    if (!body) return
    setBusy(true)
    setError(null)
    try {
      onDone(await referralAction(api, { op: 'close', id: referralId, body }, reload))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <Sheet
      onClose={onClose}
      title="Close referral"
      description="Record what was done. The bed’s meals count towards the prompt again from now."
      savedAs={staffLabel(staff)}
      error={error}
      actions={
        <Button disabled={busy || body === null} onClick={() => void save()}>
          {busy ? 'Closing…' : 'Close referral'}
        </Button>
      }
    >
      <ChoiceChips legend="Outcome" options={OUTCOMES} value={outcome} onChange={setOutcome} />
      <div {...stylex.props(f.field)}>
        <label htmlFor="referral-review" {...stylex.props(f.label)}>
          Next review (optional)
        </label>
        <input
          id="referral-review"
          type="date"
          min={bounds.min}
          max={bounds.max}
          value={review}
          onChange={(e) => setReview(e.target.value)}
          aria-describedby="referral-review-hint"
          {...stylex.props(f.input)}
        />
        <span id="referral-review-hint" {...stylex.props(f.hint)}>
          {`From today to ${REFERRAL_REVIEW_MAX_DAYS} days on.`}
        </span>
      </div>
    </Sheet>
  )
}
