import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { Button } from '../../components/button.tsx'
import { ChevronRightIcon, InfoIcon, MealIcon } from '../../components/icons.tsx'
import { Peek, PeekFoot, PeekHead, PeekLines, PeekTrigger, type PeekList } from '../../components/peek.tsx'
import { usePopoverList } from '../../components/use-popover-list.ts'
import { Placeholder } from '../../components/placeholder.tsx'
import { ReferralsNextUp } from '../../components/next-up.tsx'
import { BedBadge, Chip, Notice, Section } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { api, errorText } from '../../lib/api.ts'
import { clock, plural } from '../../lib/format.ts'
import { dietitianNextUp } from '../../lib/next-up.ts'
import {
  REFERRAL_STATUS_LABEL,
  REFERRAL_STATUS_TONE,
  WORKLIST_EMPTY,
  WORKLIST_ONLY,
  isDietitian,
  worklistLoad,
  worklistSections,
  type WorklistRow,
} from '../../lib/nutrition.ts'
import { LANDING } from '../../lib/staff.ts'
import { useResource } from '../../lib/use-resource.ts'
import { useStaff } from '../../lib/use-staff.ts'
import { color, layer, motion, radius, space, text, weight } from '../../tokens.stylex.ts'

export const Route = createFileRoute('/d/')({
  staticData: { title: 'Nutrition' },
  component: Nutrition,
})

/** The dietitian's worklist. Anyone else gets the notice, and no worklist request is sent. */
function Nutrition() {
  const staff = useStaff()
  if (!isDietitian(staff)) {
    return (
      <Placeholder
        icon={MealIcon}
        title={WORKLIST_ONLY}
        {...(staff && { action: { label: 'Open your start page', to: LANDING[staff.role] } })}
      />
    )
  }
  return <Worklist />
}

function Worklist() {
  // Local API only (no model requests): one GET on open, then every 30 s while visible and not locked.
  const res = useResource('worklist', async (signal) => ({ w: await worklistLoad(api)(signal), at: Date.now() }), 30_000)
  if (res.error && !res.data) {
    return (
      <div {...stylex.props(ui.stack)}>
        <Notice tone="danger">{errorText(res.error)}</Notice>
        <span>
          <Button variant="secondary" onClick={res.reload}>
            Try again
          </Button>
        </span>
      </div>
    )
  }
  if (!res.data) {
    return (
      <p role="status" {...stylex.props(ui.muted)}>
        Loading the worklist…
      </p>
    )
  }
  const sections = worklistSections(res.data.w, res.data.at)
  const next = dietitianNextUp(res.data.w, res.data.at)
  if (sections.length === 0) return <Placeholder icon={MealIcon} title={WORKLIST_EMPTY} />
  return <Loaded sections={sections} next={next} at={res.data.at} />
}

function Loaded({
  sections,
  next,
  at,
}: {
  sections: ReturnType<typeof worklistSections>
  next: ReturnType<typeof dietitianNextUp>
  at: number
}) {
  // One peek for every row: one Root and one portal (DESIGN.md 5.1).
  const peek = usePopoverList<WorklistRow>()
  return (
    <div {...stylex.props(ui.stack)}>
      <header {...stylex.props(s.head)}>
        <h2 {...stylex.props(s.pageTitle)}>Nutrition worklist</h2>
        <p {...stylex.props(s.counts)}>
          {sections.map((sec) => COUNT[sec.key](sec.rows.length)).join(' · ')} · as of {clock(at)}
        </p>
      </header>
      <ReferralsNextUp items={next} />
      {sections.map((sec) => (
        <Section key={sec.key} compact icon={<MealIcon />} title={sec.title} count={sec.rows.length} subtitle={SUBTITLE[sec.key]}>
          <ul {...stylex.props(s.list)}>
            {sec.rows.map((r) => (
              <Row key={r.admissionId} row={r} peek={peek} />
            ))}
          </ul>
        </Section>
      ))}
      <Peek list={peek} title={(r) => r.title}>
        {(r) => (
          <>
            <PeekHead
              title={<span translate="no">{r.title}</span>}
              end={
                r.status && (
                  <Chip tone={REFERRAL_STATUS_TONE[r.status]} glyph>
                    {REFERRAL_STATUS_LABEL[r.status]}
                  </Chip>
                )
              }
            />
            <PeekLines lines={r.peek.lines} />
            {r.peek.note && <p {...stylex.props(s.note)}>{`“${r.peek.note}”`}</p>}
            <PeekFoot>
              <Button nativeButton={false} render={<Link to="/d/$id" params={{ id: String(r.admissionId) }} />}>
                Open
              </Button>
            </PeekFoot>
          </>
        )}
      </Peek>
    </div>
  )
}

const COUNT = {
  patients: (n: number) => plural(n, 'referral', 'referrals'),
  assigned: (n: number) => `${n} assigned to you`,
  diets: (n: number) => plural(n, 'diet order', 'diet orders'),
} as const

const SUBTITLE = {
  patients: 'Open referrals first, oldest first; then those acknowledged.',
  assigned: 'Assigned to you, by ward and bed.',
  diets: 'With a diet order, by ward and bed.',
} as const

/** One square per meal charted in the window: filled when more than half was eaten. The text line says the same. */
function MealPips({ meals, poor }: { meals: number; poor: number }) {
  if (meals === 0) return null
  const shown = Math.min(meals, 9)
  return (
    <span aria-hidden {...stylex.props(s.pips)}>
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} {...stylex.props(s.pip, i < meals - poor ? s.pipOn : s.pipOff)} />
      ))}
    </span>
  )
}

function Row({ row: r, peek }: { row: WorklistRow; peek: PeekList<WorklistRow> }) {
  return (
    <li {...stylex.props(s.row)}>
      <BedBadge ward={r.ward} bed={r.bed} size="sm" />
      <div {...stylex.props(s.main)}>
        <span {...stylex.props(s.titleLine)}>
          <Link to="/d/$id" params={{ id: String(r.admissionId) }} aria-label={r.title} {...stylex.props(s.title, ui.focus, s.stretched)}>
            <span translate="no">{r.patient}</span>
          </Link>
          {r.status && (
            <Chip tone={REFERRAL_STATUS_TONE[r.status]} glyph>
              {REFERRAL_STATUS_LABEL[r.status]}
            </Chip>
          )}
        </span>
        <span {...stylex.props(s.line)}>{r.referral}</span>
        <span {...stylex.props(s.meta)}>
          <MealPips meals={r.meals} poor={r.poorMeals} />
          {r.intake}
        </span>
      </div>
      <div {...stylex.props(s.end)}>
        <span {...stylex.props(s.above)}>
          <PeekTrigger list={peek} payload={r} label={`About ${r.title}`} xstyle={[s.peekBtn, ui.focus]} openStyle={s.peekBtnOpen}>
            <InfoIcon size={20} aria-hidden />
          </PeekTrigger>
        </span>
        <span aria-hidden {...stylex.props(s.chevron)}>
          <ChevronRightIcon />
        </span>
      </div>
    </li>
  )
}

const s = stylex.create({
  head: { display: 'flex', flexDirection: 'column', gap: space.xs },
  pageTitle: { margin: 0, fontSize: text.xl, fontWeight: weight.bold, letterSpacing: '-0.02em' },
  counts: { margin: 0, fontSize: text.sm, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  list: { display: 'flex', flexDirection: 'column', margin: 0, padding: 0, listStyle: 'none' },
  row: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: space.lg,
    minHeight: 64,
    paddingBlock: space.md,
    paddingInline: space.sm,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: color.grid,
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    transitionProperty: 'background-color',
    transitionDuration: motion.control,
  },
  main: { display: 'flex', flexDirection: 'column', gap: space.xs, flexGrow: 1, minWidth: 0 },
  titleLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.md },
  title: { fontSize: text.md, fontWeight: weight.bold, color: color.fg, textDecoration: 'none' },
  // The whole row opens the patient nutrition view.
  stretched: { '::after': { content: '""', position: 'absolute', inset: 0 } },
  line: { fontSize: text.sm, overflowWrap: 'anywhere' },
  meta: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space.md, fontSize: text.xs, color: color.muted },
  pips: { display: 'inline-flex', gap: space.xs },
  pip: { width: 10, height: 10, borderRadius: radius.sm, borderWidth: 1, borderStyle: 'solid', borderColor: color.borderStrong },
  pipOn: { backgroundColor: color.fg, borderColor: color.fg },
  pipOff: { backgroundColor: color.grid },
  end: { display: 'flex', alignItems: 'center', gap: space.sm, flexShrink: 0 },
  chevron: { display: 'inline-flex', color: color.muted },
  // The peek button sits above the row's stretched link, a sibling of it (never inside it).
  above: { position: 'relative', zIndex: layer.appBar },
  peekBtn: {
    display: 'inline-grid',
    placeItems: 'center',
    width: 44,
    height: 44,
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: 'transparent', ':hover': color.border },
    borderRadius: radius.md,
    backgroundColor: { default: 'transparent', ':hover': color.bg },
    color: { default: color.muted, ':hover': color.fg },
    cursor: 'pointer',
  },
  peekBtnOpen: { backgroundColor: color.accentBg, color: color.accent, borderColor: color.accent },
  note: { margin: 0, fontSize: text.sm, color: color.muted, overflowWrap: 'anywhere' },
})
