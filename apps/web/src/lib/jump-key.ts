/** The quick jump's shortcut, apart from its matcher so the shell stays small (design.md D9). Pure. */
const TEXT_INPUTS = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'time', 'date', 'datetime-local', ''])

/** True when a key typed now goes into a field, so `/` must type a slash, not open the jump. */
export function isTypingTarget(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el?.tagName) return false
  if (el.isContentEditable) return true
  const tag = el.tagName.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  return tag === 'INPUT' && TEXT_INPUTS.has((el.type ?? '').toLowerCase())
}

/** The shortcut: `/`, or Ctrl+K (Cmd+K on a Mac), outside a text field. */
export function isJumpKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  target: Parameters<typeof isTypingTarget>[0],
): boolean {
  if (isTypingTarget(target) || e.altKey) return false
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) return true
  return (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)
}
