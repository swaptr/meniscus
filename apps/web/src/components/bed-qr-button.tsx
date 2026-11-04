import { lazy, Suspense, useRef, useState } from 'react'
import { Button } from './button.tsx'
import { QrIcon } from './icons.tsx'
import type { Bed } from './bed-qr.tsx'

// The dialog and the QR encoder load on first use, keeping them out of the route bundles.
const QrDialog = lazy(() => import('./bed-qr.tsx').then((m) => ({ default: m.QrDialog })))
export const LazyQrCard = lazy(() => import('./bed-qr.tsx').then((m) => ({ default: m.QrCard })))

/** QR button for a bed; opens the bed's code in an overlay. No requests. */
export function BedQrButton({ a }: { a: Bed }) {
  const [open, setOpen] = useState(false)
  const [used, setUsed] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const label = `${a.ward_code} · Bed ${a.bed}`
  return (
    <>
      <Button
        ref={ref}
        variant="secondary"
        aria-label={`Show QR code for ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setUsed(true)
          setOpen(true)
        }}
      >
        <QrIcon size={16} />
        QR
      </Button>
      {used && (
        <Suspense fallback={null}>
          <QrDialog a={a} open={open} onOpenChange={setOpen} returnFocus={ref} />
        </Suspense>
      )}
    </>
  )
}
