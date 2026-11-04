import type { ComponentType, ReactNode } from 'react'
import { Link, useMatchRoute, type LinkProps } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { color, space, text, weight } from '../tokens.stylex.ts'

export type MenuItem = {
  label: string
  icon?: ComponentType<{ size?: number }>
  /** Route to navigate to (client-side, type-checked); otherwise a button calling `onSelect`. */
  to?: LinkProps['to']
  onSelect?: () => void
  /** Right-aligned extra, e.g. a count badge. */
  trailing?: ReactNode
  disabled?: boolean
}

type Props = {
  items: MenuItem[]
  /** Label of the selected button item. Link items derive active state from the router. */
  selected?: string
  /** Wraps the list in a labelled <nav> landmark. */
  label?: string
  /** Fires after any item is chosen, e.g. to close a drawer. */
  onItemSelect?: (item: MenuItem) => void
  /** `lg` for touch surfaces such as the mobile drawer. */
  size?: 'md' | 'lg'
}

// Flat, single-level, edge-to-edge menu: sidebar nav, settings lists, action lists.
export function MenuList({ items, selected, label, onItemSelect, size = 'md' }: Props) {
  const list = (
    <ul {...stylex.props(styles.list)}>
      {items.map((item) => (
        <li key={item.to ?? item.label}>
          <MenuEntry
            item={item}
            size={size}
            selected={item.label === selected}
            onSelect={() => {
              item.onSelect?.()
              onItemSelect?.(item)
            }}
          />
        </li>
      ))}
    </ul>
  )

  return label ? <nav aria-label={label}>{list}</nav> : list
}

type EntryProps = {
  item: MenuItem
  size: 'md' | 'lg'
  selected: boolean
  onSelect: () => void
}

function MenuEntry({ item, size, selected, onSelect }: EntryProps) {
  const matchRoute = useMatchRoute()
  const isLink = item.to !== undefined && !item.disabled
  const active = isLink ? Boolean(matchRoute({ to: item.to, fuzzy: true })) : selected
  const { icon: Icon } = item

  // Merge with stylex.props rather than Link's activeProps: Link concatenates
  // class strings, which breaks StyleX's last-style-wins guarantee.
  const props = {
    onClick: onSelect,
    ...stylex.props(styles.item, sizes[size], active && styles.itemActive, item.disabled && styles.itemDisabled),
  }
  const content = (
    <>
      {Icon && (
        <span {...stylex.props(styles.icon, active && styles.iconActive)}>
          <Icon size={16} />
        </span>
      )}
      <span {...stylex.props(styles.label)}>{item.label}</span>
      {item.trailing}
    </>
  )

  return isLink ? (
    <Link to={item.to} {...props}>
      {content}
    </Link>
  ) : (
    <button type="button" disabled={item.disabled} aria-pressed={selected || undefined} {...props}>
      {content}
    </button>
  )
}

const sizes = stylex.create({
  md: { height: 32, fontSize: text.md },
  lg: { height: 44, fontSize: text.lg },
})

const styles = stylex.create({
  list: {
    display: 'flex',
    flexDirection: 'column',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: space.md,
    width: '100%',
    paddingInline: space.lg,
    borderStyle: 'none',
    fontWeight: weight.regular,
    textAlign: 'start',
    textDecoration: 'none',
    color: color.muted,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in srgb, ${color.fg} 5%, transparent)`,
    },
    cursor: 'pointer',
    outline: {
      default: 'none',
      ':focus-visible': `2px solid ${color.accent}`,
    },
    outlineOffset: 2,
  },
  itemActive: {
    color: color.fg,
    backgroundColor: {
      default: `color-mix(in srgb, ${color.accent} 10%, transparent)`,
      ':hover': `color-mix(in srgb, ${color.accent} 14%, transparent)`,
    },
  },
  itemDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    backgroundColor: {
      default: 'transparent',
      ':hover': 'transparent',
    },
  },
  icon: {
    display: 'inline-flex',
    color: color.muted,
  },
  iconActive: {
    color: color.accent,
  },
  label: {
    flexGrow: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
})
