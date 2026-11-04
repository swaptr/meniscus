import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { AdmissionSummary } from '@meniscus/shared'
import { Button } from '../../components/button.tsx'
import { Placeholder } from '../../components/placeholder.tsx'
import { BedIcon, RoundIcon } from '../../components/icons.tsx'
import { BedBadge, Notice, Section, ToneGlyph } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { api, errorText } from '../../lib/api.ts'
import { bedTone, STATUS_LABEL } from '../../lib/labels.ts'
import { shortName } from '../../lib/staff.ts'
import { useResource } from '../../lib/use-resource.ts'
import { color, layout, radius, space, text, weight } from '../../tokens.stylex.ts'

export const Route = createFileRoute('/a/')({
  staticData: { title: 'Capture' },
  component: PickBed,
})

/** Admissions grouped by ward, in the server's order (ward code, then bed). */
function byWard(all: AdmissionSummary[]) {
  const wards = new Map<number, { id: number; code: string; name: string; beds: AdmissionSummary[] }>()
  for (const a of all) {
    const w = wards.get(a.ward_id) ?? { id: a.ward_id, code: a.ward_code, name: a.ward_name, beds: [] }
    w.beds.push(a)
    wards.set(a.ward_id, w)
  }
  return [...wards.values()]
}

// On the ward the bed QR opens /a/bed/<token> directly; this list is the fallback. Simple density (DESIGN.md 7.2):
// one target per bed (at least 52 px), no ward statistics, a status glyph with its word for screen readers.
function PickBed() {
  const hospital = useResource('hospital', (signal) => api.admissions(undefined, signal))
  if (hospital.error) return <Notice tone="danger">{errorText(hospital.error)}</Notice>
  if (!hospital.data) return <p {...stylex.props(ui.muted)}>Loading beds…</p>
  if (!hospital.data.length) return <Placeholder icon={BedIcon} title="No beds" description="No admitted patients." />
  return (
    <div {...stylex.props(ui.stack, s.page)}>
      <Notice role="none">Scan the QR card on the bed with the phone camera, or pick the bed below.</Notice>
      {byWard(hospital.data).map((w) => (
        <Section
          key={w.id}
          title={
            <span {...stylex.props(s.wardTitle)}>
              <span {...stylex.props(s.code)}>{w.code}</span>
              <span {...stylex.props(s.wardName)}>{w.name}</span>
            </span>
          }
          actions={
            <Button variant="secondary" nativeButton={false} render={<Link to="/a/round" search={{ ward: w.id }} />}>
              <RoundIcon size={16} aria-hidden />
              Start ward round
            </Button>
          }
        >
          <ul {...stylex.props(s.grid)}>
            {w.beds.map((a) => {
              const tone = bedTone(a.alerts, a.pending)
              return (
                <li key={a.id} {...stylex.props(s.cell)}>
                  <Link to="/a/bed/$token" params={{ token: a.qr_token }} {...stylex.props(ui.focus, s.bed)}>
                    <span {...stylex.props(s.bedTop)}>
                      <BedBadge ward={w.code} bed={a.bed} size="sm" />
                      {tone !== 'ok' && <ToneGlyph tone={tone} size={16} />}
                    </span>
                    <span {...stylex.props(s.name)}>
                      {shortName(a.patient)}
                      <span {...stylex.props(ui.srOnly)}>
                        , bed {a.bed}, {STATUS_LABEL[tone]}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </Section>
      ))}
    </div>
  )
}

const PHONE_UP = '@media (min-width: 641px)'

const s = stylex.create({
  page: { maxWidth: layout.content, marginInline: 'auto', width: '100%' },
  wardTitle: { display: 'inline-flex', alignItems: 'center', gap: space.md, minWidth: 0 },
  code: {
    display: 'inline-grid',
    placeItems: 'center',
    minWidth: layout.tap,
    paddingInline: space.md,
    paddingBlock: space.xs,
    borderRadius: radius.md,
    backgroundColor: color.accent,
    color: color.onAccent,
    fontSize: text.sm,
    fontWeight: weight.heavy,
  },
  wardName: { overflowWrap: 'anywhere' },
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(3, minmax(0, 1fr))', [PHONE_UP]: 'repeat(6, minmax(0, 1fr))' },
    gap: space.md,
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  cell: { display: 'flex', minWidth: 0 },
  bed: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: space.sm,
    width: '100%',
    minHeight: layout.tapGloved,
    padding: space.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.accent },
    borderRadius: radius.md,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    textDecoration: 'none',
  },
  bedTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%' },
  name: { fontSize: text.sm, fontWeight: weight.semibold, minWidth: 0, overflowWrap: 'anywhere', lineHeight: text.leadingTight },
})
