import type { RefObject } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import type { Admission } from '@meniscus/shared'
import { bedCard } from '../lib/qr.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { Sheet } from './sheet.tsx'

export type Bed = Pick<Admission, 'bed' | 'qr_token' | 'ward_code' | 'ward_name'>

const qrSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/** Printable bed card. Heavy (QR encoder): import lazily, see `bed-qr-button.tsx`. No patient name or MRN: cards sit on the bed in public view. */
export function QrCard({ a }: { a: Bed }) {
  const card = bedCard(a, window.location.origin)
  return (
    <div {...stylex.props(s.card)}>
      <span {...stylex.props(s.label)}>{card.label}</span>
      <span {...stylex.props(s.hint)}>{card.ward}</span>
      <img src={qrSrc(card.svg)} alt={`QR code for ${card.label}`} {...stylex.props(s.qr)} />
      <span {...stylex.props(s.hint)}>Scan with the phone camera to log intake or output</span>
    </div>
  )
}

/** Overlay with one bed's QR code. Controlled; loaded on first open by `BedQrButton`. No requests. */
export function QrDialog({
  a,
  open,
  onOpenChange,
  returnFocus,
}: {
  a: Bed
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: RefObject<HTMLElement | null>
}) {
  const card = bedCard(a, window.location.origin)
  return (
    <Sheet
      open={open}
      onClose={() => onOpenChange(false)}
      finalFocus={returnFocus}
      title={card.label}
      description={`${card.ward}. Scan with the phone camera to open this bed's capture screen.`}
      cancelLabel={null}
      actions={
        <>
          <Button variant="secondary" nativeButton={false} render={<Link to="/a/bed/$token" params={{ token: a.qr_token }} />}>
            Open capture
          </Button>
          <Dialog.Close render={<Button />}>Done</Dialog.Close>
        </>
      }
    >
      <img src={qrSrc(card.svg)} alt={`QR code for ${card.label}`} {...stylex.props(s.qrLarge)} />
    </Sheet>
  )
}

const s = stylex.create({
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    width: '100%',
    padding: space.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    breakInside: 'avoid',
    textAlign: 'center',
  },
  label: { fontSize: text.xl, fontWeight: weight.heavy },
  qr: { width: 168, height: 168, imageRendering: 'pixelated' },
  hint: { fontSize: text.sm, color: color.muted, textAlign: 'center' },
  qrLarge: { width: 'min(260px, 70vw)', aspectRatio: '1', imageRendering: 'pixelated' },
})
