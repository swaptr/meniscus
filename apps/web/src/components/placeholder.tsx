import type { ComponentType } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'
import { Button } from './button.tsx'

/** Rendered as the primary Button: navigates with `to`, or runs `onClick`. */
export type PlaceholderAction = { label: string } & ({ to: LinkProps['to']; onClick?: never } | { onClick: () => void; to?: never })

type Props = {
  icon: ComponentType<{ size?: number }>
  title: string
  description?: string
  action?: PlaceholderAction
}

// Stand-in for a screen with no content yet: empty lists, not found, errors.
export function Placeholder({ icon: Icon, title, description, action }: Props) {
  return (
    <section {...stylex.props(styles.root)}>
      <span {...stylex.props(styles.icon)}>
        <Icon size={20} />
      </span>
      <div {...stylex.props(styles.copy)}>
        <h2 {...stylex.props(styles.title)}>{title}</h2>
        {description && <p {...stylex.props(styles.text)}>{description}</p>}
      </div>
      {action &&
        (action.to !== undefined ? (
          <Button nativeButton={false} render={<Link to={action.to} />}>
            {action.label}
          </Button>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        ))}
    </section>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space.lg,
    paddingBlock: `calc(4 * ${space.lg})`,
    paddingInline: space.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: `calc(2 * ${radius.md})`,
    textAlign: 'center',
  },
  icon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: '50%',
    color: color.accent,
    backgroundColor: `color-mix(in srgb, ${color.accent} 10%, transparent)`,
  },
  copy: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.sm,
    maxWidth: 320,
  },
  title: {
    fontSize: text.lg,
    fontWeight: weight.semibold,
    lineHeight: text.leadingTight,
  },
  text: {
    color: color.muted,
  },
})
