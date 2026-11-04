/**
 * The dietitian dialogs, loaded on first use: "Assign dietitian…" (one `GET /api/staff`, the dietitians covering the
 * ward first, then "Assign": one PUT) and the confirmations for "Take over…" and "Hand back…" (one request each). Each
 * success reloads its screen. No model requests.
 */
import { useEffect, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { api, errorText } from '../lib/api.ts'
import { dietitianAction, dietitianChoices } from '../lib/nutrition.ts'
import { staffLabel } from '../lib/staff.ts'
import { useStaff } from '../lib/use-staff.ts'
import { Button } from './button.tsx'
import { ChoiceChips } from './choice-chips.tsx'
import { ConfirmSheet, Sheet } from './sheet.tsx'
import { ui } from './ui.styles.ts'

export function AssignDietitianDialog({
  admissionId,
  wardId,
  wardName,
  reload,
  onClose,
  onDone,
}: {
  admissionId: number
  wardId: number
  wardName: string
  reload: () => unknown
  onClose: () => void
  onDone: (message: string) => void
}) {
  const staff = useStaff()
  const [choices, setChoices] = useState<{ id: number; label: string }[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const c = new AbortController()
    api.staff(c.signal).then(
      (roster) => setChoices(dietitianChoices(roster, wardId, wardName)),
      (err: unknown) => !c.signal.aborted && setError(errorText(err)),
    )
    return () => c.abort()
  }, [wardId, wardName])

  const assign = async () => {
    if (picked === null) return
    setBusy(true)
    setError(null)
    try {
      const r = await dietitianAction(api, { op: 'assign', admissionId, staffId: Number(picked) }, reload)
      onDone(r.text)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Sheet
      onClose={onClose}
      title="Assign dietitian"
      description="The patient’s referrals and diet orders go to this dietitian, instead of the ward’s."
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      actions={
        <Button disabled={busy || picked === null} onClick={() => void assign()}>
          {busy ? 'Saving…' : 'Assign'}
        </Button>
      }
    >
      {choices === null && !error ? (
        <p role="status" {...stylex.props(ui.muted)}>
          Loading the dietitians…
        </p>
      ) : choices && choices.length === 0 ? (
        <p {...stylex.props(ui.muted)}>No dietitian is on the roster.</p>
      ) : (
        choices && (
          <ChoiceChips
            legend="Dietitian"
            options={choices.map((c) => [String(c.id), c.label] as const)}
            value={picked}
            onChange={setPicked}
          />
        )
      )}
    </Sheet>
  )
}

/**
 * `Take over from Joel M.?` or `Hand back to the ward dietitians?`: one request on confirm, then the reload. A refusal
 * (the hand back's 409 `no_dietitian`) closes it too, with `ok` false, so the screen shows why; nothing more is sent.
 */
export function ConfirmDialog({
  title,
  description,
  confirm,
  run,
  onClose,
  onDone,
}: {
  title: string
  description: string
  confirm: string
  run: () => Promise<{ ok: boolean; text: string }>
  onClose: () => void
  onDone: (message: string, ok: boolean) => void
}) {
  const staff = useStaff()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await run()
      return onDone(r.text, r.ok)
    } catch (err) {
      setError(errorText(err))
    }
    setBusy(false)
  }
  return (
    <ConfirmSheet
      onClose={onClose}
      title={title}
      description={description}
      savedAs={staff ? staffLabel(staff) : null}
      error={error}
      actions={
        <Button disabled={busy} onClick={() => void go()}>
          {busy ? 'Saving…' : confirm}
        </Button>
      }
    />
  )
}
