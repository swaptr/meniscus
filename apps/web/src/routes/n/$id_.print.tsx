import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { BalanceTimeline } from '../../components/balance-timeline.tsx'
import { Button } from '../../components/button.tsx'
import { BackIcon, PrintIcon } from '../../components/icons.tsx'
import { Notice } from '../../components/ui.tsx'
import { ui } from '../../components/ui.styles.ts'
import { api, errorText } from '../../lib/api.ts'
import { printRows } from '../../lib/charts.ts'
import { useResource } from '../../lib/use-resource.ts'
import { color, radius, space, text, weight } from '../../tokens.stylex.ts'
import { seenSwatch } from '../../lib/urine.ts'
import { UrineSwatch } from '../../components/urine-swatch.tsx'
import { clock, dayMonth } from '../../lib/format.ts'
import { loadPrintPhotos, photosSettled, printPhotos, type PrintPhoto } from '../../lib/print-photos.ts'

export const Route = createFileRoute('/n/$id_/print')({
  staticData: { title: 'Daily I&O chart' },
  component: PrintSheet,
})

const stamp = (t: number) => `${dayMonth(t)} ${clock(t)}`

/** Each listed photo fetched once, full size, as an object URL; `ready` once every one has painted or failed. */
function usePrintPhotos(photos: readonly PrintPhoto[]) {
  const key = photos.map((p) => p.media_id).join(',')
  const [state, setState] = useState<{ key: string; urls: Map<number, string>; failed: Set<number>; painted: Set<number> }>({
    key: '',
    urls: new Map(),
    failed: new Set(),
    painted: new Set(),
  })
  useEffect(() => {
    if (!key) return
    const c = new AbortController()
    const made: string[] = []
    void loadPrintPhotos(
      api.media,
      key.split(',').map((id) => ({ media_id: Number(id) })),
      (id, blob) => {
        if (c.signal.aborted) return
        const url = blob ? URL.createObjectURL(blob) : null
        if (url) made.push(url)
        setState((prev) => {
          // The first photo of a new list starts its state; the old list's is dropped.
          const s =
            prev.key === key ? prev : { key, urls: new Map<number, string>(), failed: new Set<number>(), painted: new Set<number>() }
          return url
            ? { ...s, urls: new Map(s.urls).set(id, url) }
            : { ...s, failed: new Set(s.failed).add(id), painted: new Set(s.painted).add(id) }
        })
      },
      c.signal,
    )
    return () => {
      c.abort()
      for (const u of made) URL.revokeObjectURL(u)
    }
  }, [key])
  const current = state.key === key
  return {
    urls: current ? state.urls : new Map<number, string>(),
    failed: current ? state.failed : new Set<number>(),
    ready: !key || (current && photosSettled(photos, state.painted)),
    settle: (id: number) => setState((s) => (s.painted.has(id) ? s : { ...s, painted: new Set(s.painted).add(id) })),
  }
}

/** The paper intake/output form: one row per clock hour, approved entries only. One read, no model request. */
function PrintSheet() {
  const { id } = Route.useParams()
  const bed = useResource(`print:${id}`, async (signal) => {
    const [list, meals] = await Promise.all([api.entries(Number(id), signal), api.meals(Number(id), signal)])
    return { ...list, meals, at: Date.now() }
  })
  const photos = bed.data ? printPhotos(bed.data.entries, bed.data.meals, bed.data.at) : []
  const shots = usePrintPhotos(photos)

  if (bed.error && !bed.data) return <Notice tone="danger">{errorText(bed.error)}</Notice>
  if (!bed.data) return <p {...stylex.props(ui.muted)}>Loading chart…</p>
  const { admission, entries, at, urine_seen, devices } = bed.data
  const urine = seenSwatch(urine_seen)
  const { rows, totals, outHead, note } = printRows(entries, at, devices)
  const pending = entries.filter((e) => e.status === 'pending')

  return (
    <article {...stylex.props(s.sheet)}>
      <div data-no-print {...stylex.props(ui.row, s.tools)}>
        {/* Printing waits until every photo has loaded or failed (web/ward "Photos on the printed chart"). */}
        <Button disabled={!shots.ready} onClick={() => window.print()}>
          <PrintIcon /> {shots.ready ? 'Print' : 'Loading photos…'}
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link to="/n/$id" params={{ id }} />}>
          <BackIcon /> Back to bed
        </Button>
      </div>

      <header {...stylex.props(s.head)}>
        <div>
          <h2 {...stylex.props(s.title)}>Fluid intake and output chart</h2>
          <p {...stylex.props(s.sub)}>
            {admission.ward_name} · Bed {admission.bed}
          </p>
        </div>
        <dl {...stylex.props(s.facts)}>
          <dt>Patient</dt>
          <dd>{admission.patient}</dd>
          <dt>MRN</dt>
          <dd>{admission.mrn}</dd>
          <dt>Weight</dt>
          <dd>{admission.weight_kg ? `${admission.weight_kg} kg` : 'Not recorded'}</dd>
          <dt>Period</dt>
          <dd>
            {stamp(rows[0]!.start)} to {stamp(at)}
          </dd>
        </dl>
      </header>

      <section aria-label="Fluid balance, last 24 hours" {...stylex.props(s.chart)}>
        <BalanceTimeline entries={entries} now={at} devices={devices} still />
      </section>

      <table {...stylex.props(s.table)}>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(s.th, s.left)}>
              Hour
            </th>
            <th scope="col" {...stylex.props(s.th)}>
              Intake mL
            </th>
            <th scope="col" {...stylex.props(s.th)}>
              {outHead}
            </th>
            <th scope="col" {...stylex.props(s.th)}>
              Running balance mL
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.start}>
              <th scope="row" {...stylex.props(s.td, s.left, s.hour)}>
                {r.hour}
              </th>
              <td {...stylex.props(s.td, !r.in && s.zero)}>{r.in}</td>
              <td {...stylex.props(s.td, !r.out && s.zero)}>{r.out}</td>
              <td {...stylex.props(s.td)}>{r.balance}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" {...stylex.props(s.td, s.left, s.total)}>
              Total
            </th>
            <td {...stylex.props(s.td, s.total)}>{totals.in}</td>
            <td {...stylex.props(s.td, s.total)}>
              {totals.out}
              {urine && (
                <span {...stylex.props(s.colour)}>
                  <UrineSwatch swatch={urine} size="sm" />
                </span>
              )}
            </td>
            <td {...stylex.props(s.td, s.total)}>
              {totals.balance}
              {note && <span {...stylex.props(s.unmeasured)}>{note}</span>}
            </td>
          </tr>
        </tfoot>
      </table>

      {photos.length > 0 && (
        <section aria-labelledby="print-photos" {...stylex.props(s.photos)}>
          <h3 id="print-photos" {...stylex.props(s.photosHead)}>
            Photos
          </h3>
          <ul {...stylex.props(s.photoGrid)}>
            {photos.map((p) => {
              const url = shots.urls.get(p.media_id)
              return (
                <li key={p.key} {...stylex.props(s.photoCell)}>
                  {url ? (
                    <img
                      src={url}
                      alt={`${p.title}${p.labeled ? ', labeled copy' : ''}`}
                      onLoad={() => shots.settle(p.media_id)}
                      onError={() => shots.settle(p.media_id)}
                      {...stylex.props(s.photoImg)}
                    />
                  ) : (
                    <div {...stylex.props(s.photoMissing)}>{shots.failed.has(p.media_id) ? 'Photo not available' : 'Loading photo…'}</div>
                  )}
                  <p {...stylex.props(s.photoTitle)}>{p.title}</p>
                  {!p.labeled && <p {...stylex.props(s.photoNote)}>No labeled copy</p>}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <p {...stylex.props(s.note)}>
        Approved entries only, by charted time.
        {pending.length > 0 &&
          ` ${pending.length} entr${pending.length === 1 ? 'y' : 'ies'} (${pending.reduce((n, e) => n + e.volume_ml, 0)} mL) waiting for approval ${pending.length === 1 ? 'is' : 'are'} not included.`}{' '}
        Printed {stamp(at)} from Meniscus.
      </p>
      <div {...stylex.props(s.signs)}>
        <span {...stylex.props(s.sign)}>Checked by (nurse)</span>
        <span {...stylex.props(s.sign)}>Signature and time</span>
      </div>
    </article>
  )
}

const s = stylex.create({
  colour: { display: 'block', marginTop: space.xs, fontWeight: weight.regular },
  unmeasured: { display: 'block', marginTop: space.xs, fontWeight: weight.regular, fontSize: text.xs },
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.lg,
    // A4 less the page margins is about 186 mm; 760 px fits it at the browser's 96 dpi.
    maxWidth: 760,
    marginInline: 'auto',
    padding: { default: space.xl, '@media print': 0 },
    backgroundColor: color.bg,
    borderRadius: radius.lg,
    color: color.fg,
  },
  tools: { justifyContent: 'flex-end' },
  chart: { breakInside: 'avoid' },
  head: { display: 'flex', justifyContent: 'space-between', gap: space.xl, flexWrap: 'wrap', alignItems: 'flex-start' },
  title: { fontSize: text.xl, fontWeight: weight.heavy },
  sub: { color: color.muted, fontWeight: weight.semibold },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    columnGap: space.lg,
    rowGap: space.xs,
    margin: 0,
    fontSize: text.sm,
  },
  table: { width: '100%', borderCollapse: 'collapse', breakInside: 'auto', fontVariantNumeric: 'tabular-nums', fontSize: text.sm },
  th: {
    paddingBlock: space.sm,
    paddingInline: space.md,
    textAlign: 'end',
    fontWeight: weight.bold,
    borderBottomWidth: 2,
    borderBottomStyle: 'solid',
    borderBottomColor: color.fg,
  },
  td: {
    paddingBlock: space.xs,
    paddingInline: space.md,
    textAlign: 'end',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.border,
  },
  left: { textAlign: 'start' },
  hour: { fontWeight: weight.semibold },
  zero: { color: color.muted },
  total: {
    fontWeight: weight.heavy,
    borderTopWidth: 2,
    borderTopStyle: 'solid',
    borderTopColor: color.fg,
    borderBottomWidth: 0,
    paddingBlock: space.sm,
  },
  note: { fontSize: text.sm, color: color.muted },
  photos: { display: 'flex', flexDirection: 'column', gap: space.md },
  photosHead: { margin: 0, fontSize: text.lg, fontWeight: weight.bold, breakAfter: 'avoid' },
  // Two across on paper (about 90 mm each): the copy's labels are drawn at 2.2% of its shorter side, so they stay legible.
  photoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))',
    gap: space.lg,
    margin: 0,
    padding: 0,
    listStyle: 'none',
  },
  photoCell: { display: 'flex', flexDirection: 'column', gap: space.xs, breakInside: 'avoid', margin: 0 },
  photoImg: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
  },
  photoMissing: {
    display: 'grid',
    placeItems: 'center',
    aspectRatio: '4 / 3',
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    color: color.muted,
    fontSize: text.sm,
  },
  photoTitle: { margin: 0, fontSize: text.sm, fontWeight: weight.semibold, fontVariantNumeric: 'tabular-nums' },
  photoNote: { margin: 0, fontSize: text.xs, color: color.muted },
  signs: { breakInside: 'avoid', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: space.xxl, marginTop: space.xl },
  sign: {
    paddingTop: space.sm,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: color.fg,
    fontSize: text.sm,
    color: color.muted,
  },
})
