/**
 * A refresh every `ms` while the tab is visible and nothing pauses it (the lock, a ward still waiting for a reason).
 * Local API reads only: never a model request. Returns the stop.
 */
export function createPoll({
  ms,
  paused,
  visible,
  tick,
}: {
  ms: number
  paused: () => boolean
  visible: () => boolean
  tick: () => void
}): () => void {
  const timer = setInterval(() => {
    if (!paused() && visible()) tick()
  }, ms)
  return () => clearInterval(timer)
}
