import { useReducer, useRef, useState, type FormEvent } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { DemoAccount } from '@meniscus/shared'
import { emptySignInForm, personLabel, session, signInForm, type Person } from '../lib/session.ts'
import { DEMO_HINT, demoGroups, ROLE_LABEL } from '../lib/staff.ts'
import { useSession } from '../lib/use-staff.ts'
import { color, radius, shadow, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { f } from './form.styles.ts'
import { PasswordField, TextField } from './form-fields.tsx'
import { AlertIcon, KeyIcon } from './icons.tsx'
import { BrandMark } from './brand-mark.tsx'
import { PRODUCT } from '../lib/brand.ts'
import { StaffAvatar } from './staff-avatar.tsx'

/**
 * Who's signing in: username and password (one `POST /api/session`), "Recent on this device" and, with demo sign-in on,
 * "Demo accounts". Shown at `/login` until someone is signed in; `next` (the URL asked for) opens after.
 */
export function SignIn() {
  const state = useSession()
  const [form, dispatch] = useReducer(signInForm, emptySignInForm)
  const [busy, setBusy] = useState(false)
  const password = useRef<HTMLInputElement>(null)
  const recent = session.recent()
  const groups = demoGroups(state.demo_accounts)
  const hospital = state.hospital ?? PRODUCT

  const pick = (p: Pick<Person, 'username'>) => {
    dispatch({ type: 'pick', username: p.username })
    password.current?.focus()
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || !form.username.trim() || !form.password) return
    setBusy(true)
    const r = await session.signIn(form.username, form.password)
    // Signed in: this screen is replaced by the page asked for.
    if (!r.ok) {
      dispatch({ type: 'failed', error: r.error })
      setBusy(false)
      password.current?.focus()
    }
  }

  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.frame, groups.length > 0 && s.frameWide)}>
        <header {...stylex.props(s.brand)}>
          <BrandMark markOnly size="lg" />
          <span {...stylex.props(s.brandText)}>
            <span {...stylex.props(s.product)}>{PRODUCT}</span>
            <span {...stylex.props(s.hospital)}>{hospital}</span>
          </span>
        </header>

        <div {...stylex.props(s.columns, groups.length > 0 && s.columnsWide)}>
          <main {...stylex.props(s.card)} aria-labelledby="sign-in-title">
            <div {...stylex.props(s.titles)}>
              <h1 id="sign-in-title" {...stylex.props(s.title)}>
                Who's signing in?
              </h1>
              <p {...stylex.props(s.sub)}>Sign in with your own account. Everything you record or approve carries your name.</p>
            </div>

            {state.error && (
              <div role="alert" {...stylex.props(f.error)}>
                <AlertIcon size={16} />
                <span {...stylex.props(s.grow)}>{state.error}</span>
                <Button variant="secondary" onClick={() => void session.check()}>
                  Try again
                </Button>
              </div>
            )}

            {recent.length > 0 && (
              <section aria-labelledby="recent-title" {...stylex.props(s.block)}>
                <h2 id="recent-title" {...stylex.props(s.h2)}>
                  Recent on this device
                </h2>
                <ul role="list" {...stylex.props(s.recent)}>
                  {recent.map((p) => (
                    <li key={p.username}>
                      <PersonButton person={p} on={form.username === p.username} onPick={() => pick(p)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <form onSubmit={(e) => void submit(e)} noValidate {...stylex.props(s.form)}>
              <TextField
                label="Username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={form.username}
                onChange={(e) => dispatch({ type: 'username', value: e.target.value })}
              />
              <PasswordField
                ref={password}
                name="password"
                enterKeyHint="go"
                required
                value={form.password}
                onChange={(e) => dispatch({ type: 'password', value: e.target.value })}
              />
              {form.error && (
                <p role="alert" {...stylex.props(f.error)}>
                  <AlertIcon size={16} />
                  {form.error}
                </p>
              )}
              <Button type="submit" size="lg" disabled={busy || !form.username.trim() || !form.password}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <p {...stylex.props(s.fine)}>
              Shared ward device: the app locks after 5 minutes without use. Use "Switch user" when you hand it over.
            </p>
          </main>

          {groups.length > 0 && (
            <section aria-labelledby="demo-title" {...stylex.props(s.card, s.demo)}>
              <div {...stylex.props(s.titles)}>
                <h2 id="demo-title" {...stylex.props(s.demoTitle)}>
                  <KeyIcon size={16} /> Demo accounts
                </h2>
                <p {...stylex.props(s.hint)}>{DEMO_HINT}</p>
              </div>
              {groups.map((g) => (
                <div key={g.title} role="group" aria-label={g.title} {...stylex.props(s.block)}>
                  <h3 {...stylex.props(s.h2)}>{g.ward === null ? `${g.title}, all wards` : `Ward ${g.ward}`}</h3>
                  <ul role="list" {...stylex.props(s.accounts)}>
                    {g.accounts.map((a) => (
                      <li key={a.username}>
                        <PersonButton person={a} on={form.username === a.username} onPick={() => pick(a)} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </div>

        <p {...stylex.props(s.foot)}>Fictional demo patients only. {PRODUCT} is a charting aid, not a diagnostic device.</p>
      </div>
    </div>
  )
}

function PersonButton({ person, on, onPick }: { person: Person | DemoAccount; on: boolean; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={on} aria-label={personLabel(person)} onClick={onPick} {...stylex.props(s.person, on && s.personOn)}>
      <StaffAvatar name={person.name} role={person.role} size="sm" />
      <span {...stylex.props(s.personText)}>
        <span {...stylex.props(s.personName)}>{person.name}</span>
        <span {...stylex.props(s.personRole)}>{ROLE_LABEL[person.role]}</span>
      </span>
    </button>
  )
}

const WIDE = '@media (min-width: 880px)'
const PHONE = '@media (max-width: 520px)'

const s = stylex.create({
  page: {
    minHeight: '100dvh',
    paddingBlock: { default: 48, [PHONE]: space.xl },
    paddingInline: { default: space.xxl, [PHONE]: space.lg },
    paddingBottom: `calc(${space.xl} + env(safe-area-inset-bottom))`,
    backgroundColor: color.canvas,
    backgroundImage: `radial-gradient(1200px 400px at 50% -120px, color-mix(in srgb, ${color.accent} 14%, transparent), transparent)`,
    color: color.fg,
    fontSize: text.md,
    lineHeight: text.leading,
  },
  frame: { display: 'flex', flexDirection: 'column', gap: space.xl, maxWidth: 440, marginInline: 'auto' },
  frameWide: { maxWidth: { default: 440, [WIDE]: 1000 } },
  brand: { display: 'flex', alignItems: 'center', gap: space.lg },
  brandText: { display: 'flex', flexDirection: 'column', lineHeight: text.leadingTight },
  product: { fontSize: text.lg, fontWeight: weight.heavy, letterSpacing: '-0.01em' },
  hospital: { fontSize: text.sm, fontWeight: weight.semibold, color: color.muted },
  columns: { display: 'grid', gap: space.xl, alignItems: 'start' },
  columnsWide: { gridTemplateColumns: { default: '1fr', [WIDE]: 'minmax(0, 420px) minmax(0, 1fr)' } },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xl,
    padding: { default: space.xxl, [PHONE]: space.xl },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    boxShadow: shadow.raised,
  },
  demo: { boxShadow: shadow.card, gap: space.lg },
  titles: { display: 'flex', flexDirection: 'column', gap: space.sm },
  title: { fontSize: text.num, fontWeight: weight.heavy, letterSpacing: '-0.02em', lineHeight: text.leadingTight },
  sub: { fontSize: text.md, color: color.muted },
  grow: { flexGrow: 1 },
  block: { display: 'flex', flexDirection: 'column', gap: space.md },
  h2: { fontSize: text.xs, fontWeight: weight.bold, letterSpacing: '0.06em', color: color.muted },
  recent: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 170px), 1fr))', gap: space.sm, listStyle: 'none' },
  accounts: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))', gap: space.sm, listStyle: 'none' },
  form: { display: 'flex', flexDirection: 'column', gap: space.lg },
  fine: { fontSize: text.sm, color: color.muted },
  demoTitle: { display: 'flex', alignItems: 'center', gap: space.md, fontSize: text.lg, fontWeight: weight.bold, color: color.fg },
  hint: {
    alignSelf: 'flex-start',
    paddingBlock: space.sm,
    paddingInline: space.lg,
    borderRadius: radius.md,
    backgroundColor: color.infoBg,
    color: color.info,
    fontSize: text.sm,
    fontWeight: weight.semibold,
  },
  person: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    minHeight: 52,
    paddingInline: space.md,
    paddingBlock: space.sm,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.muted },
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    textAlign: 'start',
    cursor: 'pointer',
    outline: { default: 'none', ':focus-visible': `2px solid ${color.accent}` },
    outlineOffset: 2,
  },
  personOn: {
    borderColor: { default: color.accent, ':hover': color.accent },
    backgroundColor: { default: color.okBg, ':hover': color.okBg },
  },
  personText: { display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: text.leadingTight },
  personName: { fontSize: text.md, fontWeight: weight.semibold, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  personRole: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted },
  foot: { fontSize: text.xs, color: color.muted, textAlign: 'center' },
})
