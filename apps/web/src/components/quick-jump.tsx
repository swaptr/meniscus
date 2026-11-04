/**
 * Quick jump (DESIGN.md 4.4; web/interface "Quick jump"): a search dialog over the staff member's wards and the beds
 * already loaded. Arrow keys move, Enter opens, Escape closes (focus returns). A lazy chunk; sends no request.
 */
import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { useRouter } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { matches } from '../lib/jump.ts'
import { useSnapshot } from '../lib/use-snapshot.ts'
import { useStaff } from '../lib/use-staff.ts'
import { color, layer, motion, radius, shadow, space, text, weight } from '../tokens.stylex.ts'

export function QuickJump({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const staff = useStaff()
  const snap = useSnapshot()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const results = matches(query, staff?.wards ?? [], snap).slice(0, 12)
  const at = Math.min(active, Math.max(0, results.length - 1))
  const go = (href: string) => {
    onOpenChange(false)
    setQuery('')
    void router.navigate({ href })
  }
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setQuery('')
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop {...stylex.props(s.backdrop)} />
        <Dialog.Popup {...stylex.props(s.popup)}>
          <Dialog.Title {...stylex.props(s.title)}>Jump to</Dialog.Title>
          <input
            type="search"
            role="combobox"
            aria-expanded
            aria-controls="jump-results"
            aria-activedescendant={results[at] ? `jump-${at}` : undefined}
            aria-label="Ward, bed or patient"
            placeholder="Ward, bed or patient"
            autoComplete="off"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((a) => Math.min(a + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && results[at]) {
                e.preventDefault()
                go(results[at].href)
              }
            }}
            {...stylex.props(s.input)}
          />
          <ul id="jump-results" role="listbox" aria-label="Results" {...stylex.props(s.list)}>
            {results.map((r, i) => (
              <li
                key={r.href}
                id={`jump-${i}`}
                role="option"
                aria-selected={i === at}
                onPointerMove={() => setActive(i)}
                onClick={() => go(r.href)}
                {...stylex.props(s.option, i === at && s.optionActive)}
              >
                <span translate={r.kind === 'bed' ? 'no' : undefined}>{r.label}</span>
              </li>
            ))}
            {!results.length && <li {...stylex.props(s.none)}>No ward or loaded bed matches.</li>}
          </ul>
          <p {...stylex.props(s.hint)}>Beds appear once their ward has been opened.</p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const s = stylex.create({
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: layer.dialogBackdrop,
    backgroundColor: `color-mix(in srgb, ${color.fg} 45%, transparent)`,
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transitionProperty: 'opacity',
    transitionDuration: motion.overlay,
  },
  popup: {
    position: 'fixed',
    zIndex: layer.dialog,
    top: '12vh',
    left: '50%',
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    width: 'min(520px, calc(100vw - 32px))',
    maxHeight: '70vh',
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    color: color.fg,
    boxShadow: shadow.raised,
    transform: { default: 'translateX(-50%)', ':is([data-starting-style],[data-ending-style])': 'translateX(-50%) translateY(4px)' },
    opacity: { default: 1, ':is([data-starting-style],[data-ending-style])': 0 },
    transitionProperty: 'opacity, transform',
    transitionDuration: motion.overlay,
    transitionTimingFunction: motion.ease,
  },
  title: { margin: 0, fontSize: text.lg, fontWeight: weight.bold },
  input: {
    minHeight: 48,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    borderRadius: radius.md,
    fontSize: text.lg,
    color: color.fg,
    backgroundColor: color.bg,
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: 2,
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none', overflowY: 'auto' },
  option: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 44,
    paddingInline: space.md,
    borderRadius: radius.md,
    fontSize: text.md,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
  },
  optionActive: { backgroundColor: color.accentBg, boxShadow: `inset 3px 0 0 ${color.accent}` },
  none: { paddingInline: space.md, paddingBlock: space.md, color: color.muted, fontSize: text.sm },
  hint: { margin: 0, fontSize: text.xs, color: color.muted },
})
