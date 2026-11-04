/**
 * Test fixtures for labeled copies (web/capture "Labeled copy drawn at the bed"): segmented and Spark-only photo
 * evidence, and a stand-in for the canvas renderer, which node has no DOM for. Synthetic values only.
 */
import type { ContainerKind, FluidKind, MediaRef, PhotoEvidence, Segmentation } from '@meniscus/shared'
import type { CopySubject } from './labeled-copy.ts'
import { copyRenderer } from './media.ts'

export const SHA = 'c0ffee'.padEnd(64, '0')

export const segmentation = (over: Partial<Segmentation> = {}): Segmentation => ({
  container: { left: 100, top: 80, right: 400, bottom: 900 },
  fluid: { left: 110, top: 520, right: 390, bottom: 890 },
  fill_fraction: 0.463,
  fluid_volume_ml: 930,
  container_mask: { width: 2, height: 2, bits: '8A==' },
  fluid_mask: { width: 1, height: 1, bits: 'gA==' },
  ...over,
})

/** A photo read's evidence: `sam+spark` with segmentation, or `spark` with none. */
export function photoEvidence(
  mode: 'sam+spark' | 'spark',
  container: ContainerKind = 'urine_bag',
  fluid: FluidKind = 'urine',
  volume = 930,
): PhotoEvidence {
  return {
    kind: 'photo',
    mode,
    image_sha256: SHA,
    reading: {
      container,
      fluid,
      volume_ml: volume,
      capacity_ml: 2000,
      marks_visible: true,
      reading_basis: 'marks',
      appearance: null,
      confidence: 0.9,
      issues: [],
    },
    segmentation: mode === 'spark' ? null : segmentation(),
    review_reasons: [],
    trace: [],
    colour: null,
  }
}

/** Replaces the canvas renderer: records each draw and answers a small labeled JPEG, or fails when `fail`. */
export function fakeCopies(opts: { fail?: boolean } = {}) {
  const draws: { photo: Blob; subject: CopySubject }[] = []
  const was = copyRenderer.draw
  copyRenderer.draw = (photo, subject) => {
    draws.push({ photo, subject })
    if (opts.fail) return Promise.reject(new Error('no canvas'))
    return Promise.resolve(new Blob([new Uint8Array([0xff, 0xd8, 0x4c, 0xff, 0xd9])], { type: 'image/jpeg' }))
  }
  return { draws, restore: () => void (copyRenderer.draw = was) }
}

/** Media upload answers numbered from `first`: the photo, then its copy. */
export function mediaAnswers(first = 31) {
  let next = first
  return (over: Partial<MediaRef> = {}): Response =>
    Response.json(
      {
        id: next++,
        kind: 'photo',
        mime: 'image/jpeg',
        size: 4,
        duration_ms: null,
        created_at: '2026-11-02T12:00:00.000Z',
        sha256: null,
        served_meal: null,
        ...over,
      } satisfies MediaRef,
      { status: 201 },
    )
}
