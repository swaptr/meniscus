import * as stylex from '@stylexjs/stylex'
import { color, space } from '../tokens.stylex.ts'
import type { ApiStatus } from '../lib/use-api-status.ts'

export function ConnectionStatus({ status }: { status: ApiStatus }) {
  return (
    <span role="status" {...stylex.props(styles.row)}>
      <span aria-hidden="true" {...stylex.props(styles.dot, statusStyles[status])} />
      {STATUS_LABEL[status]}
    </span>
  )
}

const STATUS_LABEL: Record<ApiStatus, string> = {
  checking: 'Connecting',
  ok: 'Online',
  down: 'Offline',
}

const styles = stylex.create({
  row: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.sm,
    color: color.fg,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
})

const statusStyles = stylex.create({
  checking: { backgroundColor: color.warn },
  ok: { backgroundColor: color.ok },
  down: { backgroundColor: color.danger },
})
