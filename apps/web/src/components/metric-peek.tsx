/**
 * The bed banner's metric peeks (web/ward "Metric peeks on stats"; DESIGN.md 5.8): In by drink kind and category, Out
 * by category, the balance sum, and each pending entry. Lazy (its own chunk); built from the loaded entries, no request.
 */
import * as stylex from '@stylexjs/stylex'
import { ALERT_RULES, type Entry, type OutputDevices, type Totals } from '@meniscus/shared'
import { bedInPeek, bedOutPeek, bedPendingPeek, type ShareRow } from '../lib/entry-peek.ts'
import { ml, percent, signedMl } from '../lib/format.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { DrinkIcon } from './drink-label.tsx'
import { PeekHead } from './peek.tsx'

export type MetricKind = 'in' | 'out' | 'balance' | 'pending'

export default function BedMetricPeekBody({
  kind,
  entries,
  totals,
  devices,
}: {
  kind: MetricKind
  entries: readonly Entry[]
  totals: Totals
  devices: Pick<OutputDevices, 'urine_measured'>
}) {
  if (kind === 'in' || kind === 'out') {
    const p = kind === 'in' ? bedInPeek(entries) : bedOutPeek(entries)
    return (
      <>
        <PeekHead
          title={`${kind === 'in' ? 'In' : 'Out'}, last 24 h`}
          sub="Approved entries"
          end={<strong {...stylex.props(s.total)}>{ml(p.total)}</strong>}
        />
        {p.rows.length === 0 ? (
          <p {...stylex.props(s.muted)}>Nothing approved yet.</p>
        ) : (
          <ul {...stylex.props(s.rows)}>
            {p.rows.map((r) => (
              <ShareLine key={`${r.drink ?? ''}:${r.label}`} row={r} dir={kind} />
            ))}
          </ul>
        )}
        {kind === 'out' && !devices.urine_measured && <p {...stylex.props(s.muted)}>Urine not measured: urine is left out.</p>}
      </>
    )
  }
  if (kind === 'balance')
    return (
      <>
        <PeekHead title="Balance, last 24 h" sub="In − out, approved entries" />
        <dl {...stylex.props(s.sum)}>
          <dt>In</dt>
          <dd>{ml(totals.in_ml)}</dd>
          <dt>Out</dt>
          <dd>−{ml(totals.out_ml)}</dd>
          <dt {...stylex.props(s.sumTotal)}>Balance</dt>
          <dd {...stylex.props(s.sumTotal)}>{signedMl(totals.balance_ml)}</dd>
        </dl>
        <p {...stylex.props(s.muted)}>
          {devices.urine_measured
            ? `Overload prompt for review past ${signedMl(ALERT_RULES.overloadBalanceMl)}.`
            : 'Urine not measured, so the balance leaves urine out.'}
        </p>
      </>
    )
  const pending = bedPendingPeek(entries)
  return (
    <>
      <PeekHead
        title="Waiting for approval"
        sub={`${pending.length} ${pending.length === 1 ? 'entry' : 'entries'} · ${ml(totals.pending_ml)}`}
      />
      {pending.length === 0 ? (
        <p {...stylex.props(s.muted)}>Nothing waiting.</p>
      ) : (
        <ul {...stylex.props(s.lines)}>
          {pending.map((p) => (
            <li key={p.id}>{p.line}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function ShareLine({ row, dir }: { row: ShareRow; dir: 'in' | 'out' }) {
  return (
    <li {...stylex.props(s.row)}>
      <span {...stylex.props(s.label)}>
        {row.drink && (
          <span {...stylex.props(s.icon)}>
            <DrinkIcon kind={row.drink} size={14} />
          </span>
        )}
        {row.label}
      </span>
      <span {...stylex.props(s.value)}>
        {ml(row.ml)}
        <span {...stylex.props(s.pct)}>{percent(row.share)}</span>
      </span>
      <span aria-hidden {...stylex.props(s.track)}>
        <span
          {...stylex.props(s.bar, row.drink ? s.drinkBar : dir === 'in' ? s.inBar : s.outBar)}
          style={{ width: `${row.share * 100}%` }}
        />
      </span>
    </li>
  )
}

const s = stylex.create({
  total: { fontSize: text.lg, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  muted: { margin: 0, fontSize: text.sm, color: color.muted },
  rows: { display: 'flex', flexDirection: 'column', gap: space.md, margin: 0, padding: 0, listStyle: 'none' },
  row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', rowGap: space.xs, alignItems: 'baseline' },
  label: { display: 'inline-flex', alignItems: 'center', gap: space.sm, fontWeight: weight.semibold },
  icon: { display: 'inline-flex', color: color.intakeText },
  value: { display: 'inline-flex', gap: space.md, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums' },
  pct: { minWidth: 36, textAlign: 'end', fontWeight: weight.regular, color: color.muted },
  track: { gridColumnStart: 1, gridColumnEnd: -1, height: 6, borderRadius: radius.sm, backgroundColor: color.grid, overflow: 'hidden' },
  bar: { display: 'block', height: '100%', borderRadius: radius.sm },
  // One intake-family shade for every drink kind (DESIGN.md 2.1 "Drink kinds"): tint with an intake outline.
  drinkBar: { backgroundColor: color.intakeBg, boxShadow: `inset 0 0 0 1px ${color.intake}` },
  inBar: { backgroundColor: color.intake },
  outBar: { backgroundColor: color.output },
  sum: {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    justifyContent: 'space-between',
    rowGap: space.xs,
    margin: 0,
    fontVariantNumeric: 'tabular-nums',
  },
  sumTotal: {
    paddingTop: space.xs,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.border,
    fontWeight: weight.bold,
    margin: 0,
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    margin: 0,
    padding: 0,
    listStyle: 'none',
    fontVariantNumeric: 'tabular-nums',
  },
})
