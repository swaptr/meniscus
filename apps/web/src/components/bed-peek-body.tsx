/**
 * The bed peek's content (web/ward "Bed peek on the ward dashboard"), a lazy chunk: the bed's prompts in words, its in,
 * out and balance against any limit, each bag against its capacity with when it is due, its care orders and its
 * pending count, from the ward's one load, with links to the bed and its waiting list. No request.
 */
import * as stylex from '@stylexjs/stylex'
import type { AdmissionSummary } from '@meniscus/shared'
import { bedPeek } from '../lib/bed-peek.ts'
import { bedTile } from '../lib/bed-tile.ts'
import { ALERT_TONE } from '../lib/labels.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { HrefLink } from './href-link.tsx'
import { PeekFoot, PeekHead } from './peek.tsx'
import { AcuityMark, Chip, ToneGlyph } from './ui.tsx'
import { ui } from './ui.styles.ts'

export default function BedPeekBody({ a, now }: { a: AdmissionSummary; now: number }) {
  const p = bedPeek(a, now)
  const t = bedTile(a, now)
  return (
    <div {...stylex.props(s.body)}>
      <PeekHead
        title={<span translate="no">{p.title}</span>}
        sub={<AcuityMark level={t.acuity.level} label={t.acuity.label} />}
        end={
          <Chip tone={t.tone} glyph>
            {t.status}
          </Chip>
        }
      />
      {p.prompts.length > 0 && (
        <section aria-label="Prompts" {...stylex.props(s.block)}>
          <ul {...stylex.props(s.list)}>
            {p.prompts.map((line, i) => (
              <li key={i} {...stylex.props(s.prompt)}>
                <ToneGlyph tone={ALERT_TONE[a.alerts[i]!.kind]} size={16} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p {...stylex.props(s.fact, s.num)}>{p.balance}</p>
      {p.bags.length > 0 && (
        <ul aria-label="Bags" {...stylex.props(s.list)}>
          {p.bags.map((b, i) => (
            <li key={i} {...stylex.props(s.fact, s.num)}>
              {b}
              {t.bags[i]?.due && (
                <>
                  {' '}
                  <Chip tone={t.bags[i].due === 'Overdue' ? 'danger' : 'warn'}>{t.bags[i].due}</Chip>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {p.care.length > 0 && (
        <div aria-label="Care orders" {...stylex.props(s.chips)}>
          {p.care.map((c) => (
            <Chip key={c} tone="neutral">
              {c}
            </Chip>
          ))}
        </div>
      )}
      {p.pending && <p {...stylex.props(s.fact, s.pending)}>{p.pending}</p>}
      <PeekFoot>
        {p.links.toReversed().map((l, i) => (
          <HrefLink key={l.href} href={l.href} xstyle={[s.link, i === p.links.length - 1 && s.primary, ui.focus]}>
            {l.label}
          </HrefLink>
        ))}
      </PeekFoot>
    </div>
  )
}

const s = stylex.create({
  body: { display: 'flex', flexDirection: 'column', gap: space.md, minWidth: 0 },
  block: { display: 'flex', flexDirection: 'column', gap: space.xs },
  list: { display: 'flex', flexDirection: 'column', gap: space.xs, margin: 0, padding: 0, listStyle: 'none' },
  prompt: { display: 'flex', alignItems: 'center', gap: space.md, fontSize: text.sm, fontWeight: weight.semibold },
  fact: { margin: 0, fontSize: text.sm, color: color.fg },
  num: { fontVariantNumeric: 'tabular-nums' },
  pending: { color: color.pending, fontWeight: weight.semibold },
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    paddingInline: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    color: color.fg,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    fontSize: text.sm,
    fontWeight: weight.semibold,
    textDecoration: 'none',
  },
  primary: {
    borderColor: color.accent,
    backgroundColor: { default: color.accent, ':hover': color.accentStrong },
    color: color.onAccent,
  },
})
