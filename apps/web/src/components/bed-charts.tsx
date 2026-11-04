import { clock } from '../lib/format.ts'
import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { Admission, Alert, BagChart, CareStatus, Entry, OutputDevices, UrineSeen } from '@meniscus/shared'
import { drinkTitle } from '../lib/drinks.ts'
import { peekPhotoBox, stripThumbs } from '../lib/entry-peek.ts'
import { useMediaUrl } from '../lib/use-media.ts'
import { breakdown, photoStrip, photoStripLabel, rateCaption, rateWindow, urineRate, urineRuns } from '../lib/charts.ts'
import { entrySwatch, seenSwatch } from '../lib/urine.ts'
import { CATEGORY_LABEL } from '../lib/labels.ts'
import { BalanceTimeline } from './balance-timeline.tsx'
import { RateChart, StackBars } from './charts.tsx'
import { ChartIcon, ChevronDownIcon, NoPhotoIcon, PhotosIcon } from './icons.tsx'
import { PopoverTrigger } from './popover.tsx'
import { Chip, Section } from './ui.tsx'
import { ui } from './ui.styles.ts'
import type { PopoverList } from './use-popover-list.ts'
import { UrineSwatch } from './urine-swatch.tsx'
import { color, motion, radius, space, text, weight } from '../tokens.stylex.ts'

/**
 * The bed's last 24 h at a glance: the balance timeline (with care orders and prompts), the urine rate, what went in
 * and out, and the capture photos behind a `Photos <n>` toggle, fetched only once it is opened. No other requests.
 */
export function BedCharts({
  admission,
  entries,
  now,
  onOpen,
  urineSeen = null,
  bags,
  devices,
  care = null,
  alerts = [],
  peek,
}: {
  admission: Admission
  entries: Entry[]
  now: number
  /** Opens an entry (its peek, or its details): photo marks, the readout's entries and the photo strip. */
  onOpen: (e: Entry) => void
  /** The admission's latest urine colour (from the server). */
  urineSeen?: UrineSeen | null
  /** The chart read's bag periods and interval: the rate ends where the low-output prompt's window ends. */
  bags?: BagChart
  /** The bed's devices: while urine is not measured, the balance says so and no urine rate is drawn. */
  devices: Pick<OutputDevices, 'urine_measured'>
  /** The bed's care read: a fluid limit or intake target is drawn on the timeline. */
  care?: CareStatus | null
  /** The bed's open prompts, on the timeline's alert lane. */
  alerts?: readonly Alert[]
  /** The bed review's entry peek, opened by photo marks, the readout's entries and the strip's thumbnails. */
  peek?: PopoverList<Entry>
}) {
  const [showPhotos, setShowPhotos] = useState(false)
  const rate = devices.urine_measured ? urineRate(entries, admission.weight_kg, admission.admitted_at, now, bags) : null
  const caption = rate && rate.length ? rateCaption(rateWindow(entries, bags, now), now) : null
  const split = breakdown(entries, now)
  const photos = photoStrip(entries, now)
  return (
    <Section
      icon={<ChartIcon />}
      title="Last 24 hours"
      subtitle="Approved entries move the lines. Pending entries are outlined on the hourly bars."
      compact
      actions={
        photos.length > 0 && (
          <button
            type="button"
            aria-expanded={showPhotos}
            aria-controls="bed-photos"
            onClick={() => setShowPhotos(!showPhotos)}
            {...stylex.props(s.toggle, ui.focus, showPhotos && s.toggleOn)}
          >
            <PhotosIcon size={16} />
            {photoStripLabel(entries, now)}
            <ChevronDownIcon size={16} {...stylex.props(s.chevron, showPhotos && s.chevronOpen)} />
          </button>
        )
      }
    >
      {showPhotos && (
        // Fetched only now, through the shared media cache (web/ward "Photo strip": closed sends nothing).
        <ul id="bed-photos" aria-label="Capture photos, newest first" {...stylex.props(s.strip)}>
          {stripThumbs(entries, now, showPhotos).map(({ entry: e, mediaId }) => (
            <li key={e.id} {...stylex.props(s.item)}>
              <StripThumb entry={e} mediaId={mediaId} peek={peek} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
      <div {...stylex.props(s.grid)}>
        <div {...stylex.props(s.cell, s.wide)}>
          <BalanceTimeline entries={entries} now={now} devices={devices} care={care} alerts={alerts} onOpenEntry={onOpen} peek={peek} />
        </div>
        <div {...stylex.props(s.cell)}>
          <RateChart points={rate} now={now} measured={devices.urine_measured} seen={seenSwatch(urineSeen)} />
          {caption && <p {...stylex.props(s.rateCaption)}>{caption}</p>}
        </div>
        <div {...stylex.props(s.cell)}>
          <StackBars
            inSegs={split.in}
            outSegs={split.out}
            inTotal={split.inTotal}
            outTotal={split.outTotal}
            urineRuns={urineRuns(entries, now)}
          />
        </div>
      </div>
    </Section>
  )
}

/** One thumbnail: the photo from the media cache (the no-photo icon until it paints), opening the entry's peek. */
function StripThumb({
  entry: e,
  mediaId,
  peek,
  onOpen,
}: {
  entry: Entry
  mediaId: number | null
  peek?: PopoverList<Entry>
  onOpen: (e: Entry) => void
}) {
  const box = peekPhotoBox(useMediaUrl(mediaId))
  const label = `Photo at ${clock(e.created_at)}: ${drinkTitle(e)?.label ?? CATEGORY_LABEL[e.category]} ${e.volume_ml} mL`
  const inner = (
    <>
      <span {...stylex.props(s.thumbBox)}>
        {box.show === 'photo' ? (
          <img src={box.url} alt="" decoding="async" {...stylex.props(s.thumb)} />
        ) : (
          <NoPhotoIcon size={20} aria-label={box.label} {...stylex.props(s.noPhoto)} />
        )}
        {e.status === 'pending' && (
          <span {...stylex.props(s.badge)}>
            <Chip tone="pending">Pending</Chip>
          </span>
        )}
      </span>
      <span {...stylex.props(s.caption)}>
        <strong>{clock(e.created_at)}</strong>
        <span {...stylex.props(s.capLine)}>
          {drinkTitle(e)?.label ?? CATEGORY_LABEL[e.category]} {e.volume_ml} mL
        </span>
        {entrySwatch(e) && <UrineSwatch swatch={entrySwatch(e)!} size="sm" />}
      </span>
    </>
  )
  return peek ? (
    <PopoverTrigger list={peek} payload={e} label={label} xstyle={[s.thumbBtn, ui.focus]}>
      {inner}
    </PopoverTrigger>
  ) : (
    <button type="button" onClick={() => onOpen(e)} aria-label={label} {...stylex.props(s.thumbBtn, ui.focus)}>
      {inner}
    </button>
  )
}

const s = stylex.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 900px)': 'repeat(2, minmax(0, 1fr))' },
    gap: space.lg,
  },
  cell: {
    minWidth: 0,
    padding: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.border,
    backgroundColor: color.bg,
  },
  wide: {
    gridColumnStart: { default: 'auto', '@media (min-width: 900px)': 1 },
    gridColumnEnd: { default: 'auto', '@media (min-width: 900px)': -1 },
  },
  strip: {
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: 108,
    gap: space.md,
    margin: 0,
    padding: 0,
    paddingBottom: space.sm,
    listStyle: 'none',
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
  },
  item: { scrollSnapAlign: 'start' },
  thumbBtn: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.accent },
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: color.bg,
    color: color.fg,
    font: 'inherit',
    cursor: 'pointer',
    textAlign: 'start',
  },
  thumbBox: { position: 'relative', display: 'grid', placeItems: 'center', aspectRatio: '3 / 4', backgroundColor: color.subtle },
  noPhoto: { color: color.muted },
  thumb: { display: 'block', width: '100%', height: '100%', objectFit: 'cover' },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.md,
    minHeight: 44,
    paddingInline: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: color.borderStrong,
    backgroundColor: { default: color.bg, ':hover': color.subtle },
    color: color.fg,
    font: 'inherit',
    fontSize: text.sm,
    fontWeight: weight.semibold,
    fontVariantNumeric: 'tabular-nums',
    cursor: 'pointer',
  },
  toggleOn: { backgroundColor: color.accentBg, borderColor: color.accent },
  chevron: { transitionProperty: 'transform', transitionDuration: motion.control },
  chevronOpen: { transform: 'rotate(180deg)' },
  rateCaption: { margin: 0, fontSize: text.sm, color: color.muted },
  caption: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
    padding: space.sm,
    fontSize: text.xs,
    fontVariantNumeric: 'tabular-nums',
  },
  capLine: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  badge: { position: 'absolute', top: space.sm, left: space.sm },
})
