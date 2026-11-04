/**
 * "Served tray" in Meal capture: one photo of the tray as it is served, kept for the bed with the selected meal as
 * `served_meal` (one `POST /media`). No model request and no meal; a failed upload says so and is not resent.
 */
import { useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { MealKind } from '@meniscus/shared'
import { api } from '../lib/api.ts'
import { uploadServed } from '../lib/meals.ts'
import { PhotoTooLargeError, photoTooLargeMessage, shrinkPhoto } from '../lib/photo.ts'
import { space } from '../tokens.stylex.ts'
import { Button } from './button.tsx'
import { CameraIcon } from './icons.tsx'
import { ui } from './ui.styles.ts'
import { flash } from '../lib/toast.ts'

export function ServedTrayTile({ admissionId, meal, disabled }: { admissionId: number; meal: MealKind; disabled: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const setDone = (d: { ok: boolean; text: string }) => flash({ tone: d.ok ? 'ok' : 'warn', text: d.text })
  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      setDone(await uploadServed(api, admissionId, meal, await shrinkPhoto(file), new Date()))
    } catch (err) {
      // Over the cap after shrinking: nothing was sent.
      if (err instanceof PhotoTooLargeError) setDone({ ok: false, text: photoTooLargeMessage() })
      else setDone({ ok: false, text: 'Served tray photo not kept. You can still photograph the tray when it is collected.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div {...stylex.props(s.tile)}>
      <div {...stylex.props(ui.row)}>
        <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={disabled || busy}>
          <CameraIcon />
          {busy ? 'Keeping…' : 'Served tray'}
        </Button>
        <span {...stylex.props(ui.muted)}>Photograph the tray as it is served; it is compared when collected.</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void onFile(f)
        }}
        {...stylex.props(ui.hiddenInput)}
        tabIndex={-1}
        aria-hidden
      />
    </div>
  )
}

const s = stylex.create({
  tile: { display: 'flex', flexDirection: 'column', gap: space.sm },
})
