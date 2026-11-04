import { lazy, Suspense, useState } from 'react'
import { session, switchQuestion } from '../lib/session.ts'
import { SWITCH_USER } from '../lib/staff.ts'
import { hasUnsaved } from '../lib/unsaved.ts'
import { useStaff } from '../lib/use-staff.ts'
import { Button } from './button.tsx'
import { SwitchUserIcon } from './icons.tsx'

// The confirm (a dialog) loads only when the question is asked, keeping dialog code out of the first load.
const SwitchUserConfirm = lazy(() => import('./switch-user-confirm.tsx').then((m) => ({ default: m.SwitchUserConfirm })))

/**
 * "Switch user": one `DELETE /api/session`, then the sign-in screen. With unsaved work it asks first; "Cancel" keeps
 * everything as it was. `icon`: the phone header's square button.
 */
export function SwitchUserButton({ icon = false, size = 'touch' }: { icon?: boolean; size?: 'touch' | 'lg' }) {
  const staff = useStaff()
  const [question, setQuestion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    await session.switchUser()
    // This button unmounts with the screen it was on.
  }
  const onClick = () => {
    const q = switchQuestion(staff, hasUnsaved())
    if (q) setQuestion(q)
    else void go()
  }

  return (
    <>
      <Button
        variant="secondary"
        size={size}
        icon={icon}
        aria-label={icon ? SWITCH_USER : undefined}
        title={icon ? SWITCH_USER : undefined}
        disabled={busy}
        onClick={onClick}
      >
        <SwitchUserIcon size={16} />
        {!icon && SWITCH_USER}
      </Button>
      {question !== null && (
        <Suspense fallback={null}>
          <SwitchUserConfirm question={question} busy={busy} onCancel={() => setQuestion(null)} onConfirm={() => void go()} />
        </Suspense>
      )}
    </>
  )
}
