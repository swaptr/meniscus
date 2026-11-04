import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import * as stylex from '@stylexjs/stylex'
import { lockLine, session, type Person } from '../lib/session.ts'
import { color, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { f } from './form.styles.ts'
import { PasswordField, TextField } from './form-fields.tsx'
import { lockCover } from './lock.styles.ts'
import { AlertIcon, LockIcon } from './icons.tsx'
import { StaffAvatar } from './staff-avatar.tsx'
import { SwitchUserButton } from './switch-user.tsx'

/**
 * The lock: an opaque cover over the screen, which stays mounted (and inert) behind it, so drafts, round readings and a
 * model read in flight survive. "Unlock" is one `POST /api/session` as the locked person; it never repeats a request.
 * A plain modal (no dialog library): everything else on the page is inert while it shows, dialogs left open included,
 * and focus starts in it. Its code loads when the screen first locks (`SessionGate`), not with the app.
 */
export function Lock({ person }: { person: Person }) {
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState(person.username)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const usernameRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // Known from sign-in or "Recent on this device"; asked only if this device has forgotten it.
  const askUsername = person.username === ''

  // Modal by hand: the rest of the page (the app, and any dialog portal left open) is inert, and still, until unlocked.
  useEffect(() => {
    const others = [...document.body.children].filter((el) => el !== coverRef.current && !el.hasAttribute('inert'))
    for (const el of others) el.setAttribute('inert', '')
    // No scrolling of the hidden page behind, and no scrollbar beside the cover.
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    ;(askUsername ? usernameRef : passwordRef).current?.focus()
    return () => {
      for (const el of others) el.removeAttribute('inert')
      root.style.overflow = overflow
    }
  }, [askUsername])

  const unlock = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    const r = askUsername ? await session.signIn(username, password) : await session.unlock(password)
    if (!r.ok) {
      setError(r.error)
      setPassword('')
      setBusy(false)
      passwordRef.current?.focus()
    }
  }

  return createPortal(
    <div ref={coverRef} {...stylex.props(lockCover.cover)}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-sub`} {...stylex.props(s.popup)}>
        <div {...stylex.props(s.head)}>
          <StaffAvatar name={person.name} role={person.role} size="lg" />
          <span aria-hidden {...stylex.props(s.badge)}>
            <LockIcon size={14} strokeWidth={2.25} />
          </span>
        </div>
        <div {...stylex.props(s.titles)}>
          <h2 id={titleId} {...stylex.props(s.title)}>
            {lockLine(person)}
          </h2>
          <p id={`${titleId}-sub`} {...stylex.props(s.sub)}>
            Unlock with your password to carry on where you left off. Nothing unsaved is lost.
          </p>
        </div>
        <form onSubmit={(e) => void unlock(e)} noValidate {...stylex.props(s.form)}>
          {askUsername ? (
            <TextField
              ref={usernameRef}
              label="Username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          ) : (
            // For password managers: whose password this is.
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={person.username}
              readOnly
              tabIndex={-1}
              aria-hidden
              {...stylex.props(f.offscreen)}
            />
          )}
          <PasswordField
            ref={passwordRef}
            name="password"
            enterKeyHint="go"
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
          <Button type="submit" size="lg" disabled={busy || !password || (askUsername && !username.trim())}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
        <div {...stylex.props(s.other)}>
          <span {...stylex.props(s.otherText)}>Not {person.name.split(' ')[0]}?</span>
          <SwitchUserButton size="touch" />
        </div>
      </div>
    </div>,
    document.body,
  )
}

const s = stylex.create({
  popup: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xl,
    width: 'min(420px, 100%)',
    padding: { default: space.xxl, '@media (max-width: 520px)': space.xl },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
    color: color.fg,
  },
  head: { position: 'relative', alignSelf: 'flex-start' },
  badge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    display: 'grid',
    placeItems: 'center',
    width: 28,
    height: 28,
    borderWidth: 3,
    borderStyle: 'solid',
    borderColor: color.bg,
    borderRadius: radius.pill,
    backgroundColor: color.fg,
    color: color.bg,
  },
  titles: { display: 'flex', flexDirection: 'column', gap: space.sm },
  title: { margin: 0, fontSize: text.xl, fontWeight: weight.heavy, letterSpacing: '-0.02em', lineHeight: text.leadingTight },
  sub: { margin: 0, fontSize: text.md, color: color.muted },
  form: { display: 'flex', flexDirection: 'column', gap: space.lg },
  other: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
  },
  otherText: { fontSize: text.sm, color: color.muted, fontWeight: weight.semibold },
})
