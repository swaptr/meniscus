import { lazy, Suspense, useState } from 'react'
import type { CareKind, CareStatus } from '@meniscus/shared'
import { PlusIcon } from './icons.tsx'
import { Button } from './button.tsx'

// The care-plan form loads on first use, keeping dialog code out of the route bundle.
const CareFormDialog = lazy(() => import('./care-forms.tsx').then((m) => ({ default: m.CareFormDialog })))

/**
 * "Add catheter" ("Add stoma", "Add drain") for a bag read on a bed without it: opens that kind's care-plan form, whose
 * Save sends one PUT, then `reload`. Shown only to those who may order the kind; no model request.
 */
export function AddDevice({
  kind,
  label,
  admissionId,
  wardCode,
  care,
  reload,
  onDone,
}: {
  kind: CareKind
  label: string
  admissionId: number
  wardCode: string
  care: CareStatus
  reload: () => unknown
  onDone: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="touch" onClick={() => setOpen(true)}>
        <PlusIcon /> {label}
      </Button>
      {open && (
        <Suspense fallback={null}>
          <CareFormDialog
            kind={kind}
            changing={false}
            admissionId={admissionId}
            wardCode={wardCode}
            care={care}
            reload={reload}
            onClose={() => setOpen(false)}
            onDone={(text) => {
              setOpen(false)
              onDone(text)
            }}
          />
        </Suspense>
      )}
    </>
  )
}
