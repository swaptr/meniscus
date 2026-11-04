/**
 * One bed on the ward dashboard (DESIGN.md 5.9; web/ward "Bed tile encodings", "Ward board on wide screens"): a board
 * row from 1100 px, a tile below, both from `bedTile()` over the ward's one load. The whole row or tile is a link to
 * the bed (stretched link); the 44 px `About bed <n>` button that opens the bed peek and the nurse picker are siblings
 * of that link, above it, never inside it. No request.
 */
import { lazy, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { AdmissionSummary } from '@meniscus/shared'
import { acuityChips } from '../lib/acuity.ts'
import { bedTile, type TileBag } from '../lib/bed-tile.ts'
import { careBadges } from '../lib/care.ts'
import { stripName } from '../lib/chart-text.ts'
import { CATEGORY_HUE } from '../lib/hues.ts'
import { ALERT_LABEL, ALERT_TONE } from '../lib/labels.ts'
import { referralChip } from '../lib/nutrition.ts'
import { color, layer, radius, space, text, weight } from '../tokens.stylex.ts'
import { Gauge } from './gauge.tsx'
import { HrefLink } from './href-link.tsx'
import { InfoIcon } from './icons.tsx'
import { Peek, PeekTrigger, type PeekList } from './peek.tsx'
import { MirroredBars } from './spark.tsx'
import { AcuityMark, BedBadge, Chip, ToneGlyph } from './ui.tsx'
import { bars, ui } from './ui.styles.ts'

// The peek's content is its own chunk, loaded on first open (DESIGN.md 5.1 "Lazy content").
const BedPeekBody = lazy(() => import('./bed-peek-body.tsx'))

export type BedPeekList = PeekList<AdmissionSummary>

const BAG_HUE: Record<string, string> = { urine_bag: CATEGORY_HUE.urine, stoma_bag: CATEGORY_HUE.stoma, drain_bag: CATEGORY_HUE.drain }

/** The ward's one bed peek: one Root and one portal for every row's button. */
export function BedPeek({ list, now }: { list: BedPeekList; now: number }) {
  return (
    <Peek list={list} title={(a) => `Bed ${a.bed} · ${a.patient}`} minHeight={220}>
      {(a) => <BedPeekBody a={a} now={now} />}
    </Peek>
  )
}

type Props = {
  a: AdmissionSummary
  now: number
  /** The ward's one scale for the 24 h bars (`scaleShared`). */
  max: number
  peek: BedPeekList
  /** `Nurse: Anita T.`, or the nurse picker for those who assign beds. */
  nurse: ReactNode
}

function Prompts({ a }: { a: AdmissionSummary }) {
  const shown = a.alerts.slice(0, 2)
  const more = a.alerts.length - shown.length
  return (
    <>
      {shown.map((x, i) => (
        // By index: a bed can hold two prompts of one kind (two `bag_without_device`).
        <Chip key={`${x.kind}:${i}`} tone={ALERT_TONE[x.kind]} glyph>
          {ALERT_LABEL[x.kind]}
        </Chip>
      ))}
      {more > 0 && <Chip tone="neutral">+{more}</Chip>}
    </>
  )
}

/** The board's prompts: glyph and words on a line that wraps, at most two, then `+<n> more`. */
function PromptLines({ a, suggestion }: { a: AdmissionSummary; suggestion: { text: string; reasons: string } | null }) {
  const shown = a.alerts.slice(0, suggestion ? 1 : 2)
  const more = a.alerts.length - shown.length
  return (
    <ul {...stylex.props(s.lines)}>
      {suggestion && (
        <li title={suggestion.reasons} {...stylex.props(s.line)}>
          <ToneGlyph tone="warn" size={14} />
          <span>
            {suggestion.text}
            <span {...stylex.props(ui.srOnly)}>: {suggestion.reasons}</span>
          </span>
        </li>
      )}
      {shown.map((x, i) => (
        // By index: a bed can hold two prompts of one kind (two `bag_without_device`).
        <li key={`${x.kind}:${i}`} {...stylex.props(s.line)}>
          <ToneGlyph tone={ALERT_TONE[x.kind]} size={14} />
          <span>{ALERT_LABEL[x.kind]}</span>
        </li>
      ))}
      {more > 0 && <li {...stylex.props(s.line, s.lineMore)}>+{more} more</li>}
    </ul>
  )
}

function Bags({ bags, levels, compact }: { bags: TileBag[]; levels: AdmissionSummary['bag_levels']; compact?: boolean }) {
  if (!bags.length) return compact ? <span {...stylex.props(ui.srOnly)}>No bag</span> : null
  return (
    <span {...stylex.props(s.bags)}>
      {bags.map((b, i) => (
        <span key={i} {...stylex.props(s.bag)}>
          {b.fill === null ? (
            <span {...stylex.props(s.meta)}>
              {b.name} {b.level}
            </span>
          ) : (
            <Gauge
              name={b.name}
              level={levels?.[i]?.level_ml ?? 0}
              capacity={levels?.[i]?.capacity_ml ?? 0}
              at={levels?.[i] ? Date.parse(levels[i].read_at) : null}
              state={b.due === 'Overdue' ? 'overdue' : b.due === 'Due' ? 'due' : 'ok'}
              fill={BAG_HUE[b.container] ?? CATEGORY_HUE.urine}
            />
          )}
        </span>
      ))}
    </span>
  )
}

function Balance({ t, inline }: { t: ReturnType<typeof bedTile>; inline?: boolean }) {
  const [figure, unit] = [t.balance.text.replace(/ mL$/, ''), 'mL']
  return (
    <span {...stylex.props(s.balance, inline && s.balanceInline)}>
      <span {...stylex.props(s.balanceFig, t.balance.tone === 'warn' && s.warnText)}>
        {figure}
        <span {...stylex.props(s.unit)}> {unit}</span>
      </span>
      <span {...stylex.props(s.meta)}>{t.balance.note ?? t.balance.inOut}</span>
    </span>
  )
}

function PeekButton({ a, peek, label }: { a: AdmissionSummary; peek: BedPeekList; label: string }) {
  return (
    <span {...stylex.props(s.above)}>
      <PeekTrigger list={peek} payload={a} label={label} xstyle={[s.peekBtn, ui.focus]} openStyle={s.peekBtnOpen}>
        <InfoIcon size={20} aria-hidden />
      </PeekTrigger>
    </span>
  )
}

/** A tile (below 1100 px): badge, name and status; the 24 h bars; balance, bags, pending and prompts. */
export function BedTile({ a, now, max, peek, nurse }: Props) {
  const t = bedTile(a, now)
  const acuity = acuityChips(a.acuity)
  const badges = careBadges(a.care, now)
  const referral = referralChip(a.nutrition)
  return (
    <li {...stylex.props(s.tileCell)}>
      <article {...stylex.props(s.tile, bars[t.tone])}>
        <div {...stylex.props(s.tileTop)}>
          <BedBadge ward={t.ward} bed={t.bed} size="md" />
          <span {...stylex.props(s.who)}>
            <HrefLink href={t.href} xstyle={[s.name, s.stretched]} translate="no">
              {t.patient}
            </HrefLink>
            <span {...stylex.props(s.meta)}>
              {a.mrn}
              {a.weight_kg ? ` · ${a.weight_kg} kg` : ''}
            </span>
            <AcuityMark level={t.acuity.level} label={t.acuity.label} />
          </span>
          <span {...stylex.props(s.tileEnd)}>
            <Chip tone={t.tone} glyph>
              {t.status}
            </Chip>
            <PeekButton a={a} peek={peek} label={t.peekLabel} />
          </span>
        </div>

        {(acuity.suggestion || badges.length > 0 || referral) && (
          <div {...stylex.props(s.chips)}>
            {acuity.suggestion && (
              <span title={acuity.suggestion.reasons}>
                <Chip tone="warn">
                  {acuity.suggestion.text}
                  <span {...stylex.props(ui.srOnly)}>: {acuity.suggestion.reasons}</span>
                </Chip>
              </span>
            )}
            {badges.map((b) => (
              <Chip key={b} tone="neutral">
                {b}
              </Chip>
            ))}
            {referral && <Chip tone="neutral">{referral}</Chip>}
          </div>
        )}

        <div {...stylex.props(s.strip)}>
          <span aria-hidden {...stylex.props(s.stripHead)}>
            <span>Last 24 h</span>
            <span>now</span>
          </span>
          <MirroredBars
            in_ml={a.hourly.in_ml}
            out_ml={a.hourly.out_ml}
            in_logged={a.hourly.in_logged}
            max={max}
            name={stripName(a.hourly, now)}
          />
        </div>

        <div {...stylex.props(s.tileFigs)}>
          <Balance t={t} />
          <Bags bags={t.bags} levels={a.bag_levels} />
          {t.pending && (
            <span aria-label={`${a.pending} pending`} {...stylex.props(s.pending)}>
              {t.pending}
            </span>
          )}
        </div>

        <div {...stylex.props(s.chips)}>
          <Prompts a={a} />
          {!a.alerts.length && !a.pending && <span {...stylex.props(s.none)}>Nothing to review</span>}
        </div>

        {nurse && <div {...stylex.props(s.above, s.tileNurse)}>{nurse}</div>}
      </article>
    </li>
  )
}

/** A board row (from 1100 px): the same encodings in aligned columns under `BoardHead`. */
export function BoardRow({ a, now, max, peek, nurse }: Props) {
  const t = bedTile(a, now)
  const acuity = acuityChips(a.acuity)
  const badges = careBadges(a.care, now)
  const referral = referralChip(a.nutrition)
  return (
    <li {...stylex.props(s.row, bars[t.tone])}>
      <span {...stylex.props(s.cellBed)}>
        <BedBadge ward={t.ward} bed={t.bed} size="sm" />
        <span {...stylex.props(s.who)}>
          <HrefLink href={t.href} xstyle={[s.name, s.rowName, s.stretched]} translate="no">
            {t.patient}
          </HrefLink>
          {nurse && <span {...stylex.props(s.above, s.rowNurse)}>{nurse}</span>}
        </span>
      </span>
      <span {...stylex.props(s.cellStack)}>
        <AcuityMark level={t.acuity.level} label={t.acuity.label} />
      </span>
      <span {...stylex.props(s.cellStack)}>
        <Chip tone={t.tone} glyph>
          {t.status}
        </Chip>
      </span>
      <span {...stylex.props(s.cellStrip)}>
        <MirroredBars
          in_ml={a.hourly.in_ml}
          out_ml={a.hourly.out_ml}
          in_logged={a.hourly.in_logged}
          max={max}
          name={stripName(a.hourly, now)}
          height={28}
        />
        {(a.alerts.length > 0 || acuity.suggestion) && <PromptLines a={a} suggestion={acuity.suggestion} />}
      </span>
      <span {...stylex.props(s.cellNum)}>
        <Balance t={t} inline />
      </span>
      <span {...stylex.props(s.cellStack)}>
        <Bags bags={t.bags} levels={a.bag_levels} compact />
      </span>
      <span {...stylex.props(s.cellNum)}>
        {t.pending ? (
          <span aria-label={`${a.pending} pending`} {...stylex.props(s.pending)}>
            {t.pending}
          </span>
        ) : (
          <span {...stylex.props(ui.srOnly)}>None pending</span>
        )}
      </span>
      <ul aria-label="Care" {...stylex.props(s.lines, s.care)}>
        {[...badges, ...(referral ? [referral] : [])].map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <PeekButton a={a} peek={peek} label={t.peekLabel} />
    </li>
  )
}

/** The board's column headers, each naming its column. */
export function BoardHead() {
  return (
    <div aria-hidden {...stylex.props(s.row, s.headRow)}>
      <span>Bed</span>
      <span>Acuity</span>
      <span>Status</span>
      <span {...stylex.props(s.headStrip)}>
        <span>Last 24 h</span>
        <span {...stylex.props(s.headScale)}>now</span>
      </span>
      <span>Balance</span>
      <span>Bags</span>
      <span>Pending</span>
      <span>Care</span>
      <span />
    </div>
  )
}

const BOARD_COLUMNS = 'minmax(160px, 1.1fr) 68px 108px minmax(104px, 2fr) 104px 52px 56px minmax(72px, 1fr) 44px'

const s = stylex.create({
  above: { position: 'relative', zIndex: layer.appBar },
  meta: { fontSize: text.xs, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  none: { fontSize: text.sm, color: color.muted },
  unit: { fontSize: text.xs, fontWeight: weight.semibold, color: color.muted },
  warnText: { color: color.warnText },
  who: { display: 'flex', flexDirection: 'column', gap: space.xs, flexGrow: 1, minWidth: 0 },
  name: {
    color: color.fg,
    fontSize: text.md,
    fontWeight: weight.semibold,
    textDecoration: { default: 'none', ':hover': 'underline' },
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  rowName: { fontSize: text.sm },
  stretched: {
    outline: 'none', // focus-ok: the tile or row draws the ring on :focus-within
    '::after': { content: '""', position: 'absolute', inset: 0 },
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  bags: { display: 'flex', flexWrap: 'wrap', gap: space.md, alignItems: 'center' },
  bag: { display: 'inline-flex' },
  balance: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0 },
  balanceInline: { alignItems: 'flex-end', textAlign: 'end', whiteSpace: 'nowrap' },
  balanceFig: { fontSize: text.lg, fontWeight: weight.bold, fontVariantNumeric: 'tabular-nums', color: color.fg, whiteSpace: 'nowrap' },
  pending: { fontSize: text.md, fontWeight: weight.bold, color: color.pending, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
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
    backgroundColor: { default: 'transparent', ':hover': color.subtle },
    color: { default: color.muted, ':hover': color.fg },
    cursor: 'pointer',
  },
  peekBtnOpen: { backgroundColor: color.accentBg, color: color.accent, borderColor: color.accent },

  // Tile.
  tileCell: { display: 'flex', minWidth: 0 },
  tile: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    width: '100%',
    minWidth: 0,
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.borderStrong },
    borderRadius: radius.md,
    backgroundColor: color.bg,
    outlineWidth: { default: 0, ':focus-within': 2 },
    outlineStyle: 'solid',
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  tileTop: { display: 'flex', alignItems: 'flex-start', gap: space.md, minWidth: 0 },
  tileEnd: { display: 'flex', alignItems: 'center', gap: space.xs, flexShrink: 0 },
  strip: { display: 'flex', flexDirection: 'column', gap: space.xs },
  stripHead: { display: 'flex', justifyContent: 'space-between', fontSize: text.xs, color: color.muted },
  tileFigs: { display: 'flex', alignItems: 'center', gap: space.xl, flexWrap: 'wrap' },
  tileNurse: { display: 'flex', paddingTop: space.md, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: color.grid },

  // Board.
  row: {
    position: 'relative',
    display: 'grid',
    gridTemplateColumns: BOARD_COLUMNS,
    alignItems: 'center',
    columnGap: space.sm,
    minHeight: 64,
    paddingBlock: space.md,
    paddingInlineEnd: space.sm,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: color.grid,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    outlineWidth: { default: 0, ':focus-within': 2 },
    outlineStyle: 'solid',
    outlineColor: color.accent,
    outlineOffset: 2,
  },
  headRow: {
    minHeight: 0,
    paddingBlock: space.sm,
    backgroundColor: color.subtle,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.muted,
    borderBottomColor: color.border,
    // Aligns with the rows' 4 px status edge.
    borderInlineStartWidth: 4,
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: 'transparent',
  },
  headStrip: { display: 'flex', justifyContent: 'space-between', gap: space.sm, paddingInline: space.sm },
  headScale: { fontWeight: weight.regular, fontVariantNumeric: 'tabular-nums' },
  cellBed: { display: 'flex', alignItems: 'center', gap: space.md, minWidth: 0 },
  rowNurse: { display: 'flex', minWidth: 0 },
  cellStack: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: space.xs, minWidth: 0 },
  cellStrip: { display: 'flex', flexDirection: 'column', gap: space.xs, minWidth: 0, paddingInline: space.sm },
  cellNum: { display: 'flex', justifyContent: 'flex-end', minWidth: 0 },
  lines: { display: 'flex', flexDirection: 'column', gap: space.xs, margin: 0, padding: 0, listStyle: 'none', minWidth: 0 },
  line: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.sm,
    fontSize: text.xs,
    fontWeight: weight.semibold,
    color: color.fg,
    lineHeight: text.leadingTight,
  },
  lineMore: { color: color.muted, paddingInlineStart: space.xl },
  care: { fontSize: text.xs, fontWeight: weight.semibold, color: color.fg, lineHeight: text.leadingTight },
})
