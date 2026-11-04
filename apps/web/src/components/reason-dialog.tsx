import { useRef, useState, type FormEvent } from 'react'
import { useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { api } from '../lib/api.ts'
import { cancelTo, grantAccess, REASON_MAX, reasonBody } from '../lib/rota.ts'
import { session } from '../lib/session.ts'
import { staffLabel } from '../lib/staff.ts'
import { grants } from '../lib/use-access.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, radius, space, text } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { Sheet } from './sheet.tsx'
import { f } from './form.styles.ts'
import { PasswordField } from './form-fields.tsx'
import { AlertIcon, ShieldIcon } from './icons.tsx'

/**
 * Break-the-glass: a reason and the person's password, sent as one `POST /api/wards/:id/access` on "Open ward". A wrong
 * password keeps the reason and empties the password. "Cancel" sends nothing and goes back (or to `fallback`, `/n` by default).
 */
export function ReasonDialog({ wardId, wardName, fallback = '/n' }: { wardId: number; wardName: string | null; fallback?: '/n' | '/d' }) {
  const staff = useStaff()
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const body = reasonBody(reason, password)
  const ward = wardName ?? 'This ward'

  const cancel = () => {
    const to = cancelTo(canGoBack, fallback)
    if (to === 'back') router.history.back()
    else void navigate({ to })
  }
  const open = async (e: FormEvent) => {
    e.preventDefault()
    if (!body || !staff || busy) return
    setBusy(true)
    setError(null)
    const r = await grantAccess(api, wardId, staff.id, body, Date.now(), grants)
    // Accepted: the gate re-renders with the ward.
    if (!r.ok) {
      setError(r.error)
      setPassword('')
      setBusy(false)
      passwordRef.current?.focus()
    }
  }

  return (
    <Sheet
      onClose={cancel}
      dismissible={false}
      cancelLabel={null}
      title={`${ward} is not one of your wards`}
      description="To open it, give a reason and confirm with your password. The reason is recorded with your name and the time, for review."
      aside={
        <span aria-hidden {...stylex.props(s.icon)}>
          <ShieldIcon size={20} />
        </span>
      }
    >
      <form onSubmit={(e) => void open(e)} noValidate {...stylex.props(s.form)}>
        {/* For password managers: whose password this is. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          value={session.username()}
          readOnly
          tabIndex={-1}
          aria-hidden
          {...stylex.props(f.offscreen)}
        />
        <div {...stylex.props(f.field)}>
          <label htmlFor="access-reason" {...stylex.props(f.label)}>
            Reason
          </label>
          <textarea
            id="access-reason"
            rows={3}
            maxLength={REASON_MAX}
            required
            value={reason}
            placeholder="e.g. Covering HDU during break"
            aria-describedby="access-reason-count"
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
            {...stylex.props(f.input, s.textarea)}
          />
          <span id="access-reason-count" {...stylex.props(f.hint, s.count)}>
            {reason.trim().length}/{REASON_MAX}
          </span>
        </div>
        <PasswordField
          ref={passwordRef}
          label="Your password"
          name="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setError(null)
          }}
        />
        {error && (
          <p role="alert" {...stylex.props(f.error)}>
            <AlertIcon size={16} />
            {error}
          </p>
        )}
        <p {...stylex.props(s.by)}>Signed in as {staffLabel(staff)}.</p>
        <div {...stylex.props(s.actions)}>
          <Button type="button" variant="secondary" size="lg" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" size="lg" disabled={!body || busy}>
            {busy ? 'Opening…' : 'Open ward'}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}

const s = stylex.create({
  icon: {
    display: 'grid',
    placeItems: 'center',
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: color.warnBg,
    color: color.warnText,
  },
  form: { display: 'flex', flexDirection: 'column', gap: space.lg },
  textarea: { minHeight: 88, paddingBlock: space.md, resize: 'vertical', fontFamily: 'inherit', lineHeight: text.leading },
  count: { alignSelf: 'flex-end', fontVariantNumeric: 'tabular-nums' },
  by: { fontSize: text.sm, color: color.muted },
  actions: { display: 'flex', justifyContent: 'flex-end', gap: space.md, flexWrap: 'wrap' },
})
