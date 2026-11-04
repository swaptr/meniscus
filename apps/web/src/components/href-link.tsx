import type { MouseEvent, ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'

type Props = {
  /** A built in-app href (`/n/w/2?view=quality`), from a pure helper such as `lib/nav.ts`. */
  href: string
  children: ReactNode
  xstyle?: stylex.StyleXStyles
  current?: boolean
  label?: string
  onNavigate?: () => void
  translate?: 'no'
}

/** An in-app link from a built href: a real `<a>` (opens in a new tab, copies) that navigates client-side on a plain click. */
export function HrefLink({ href, children, xstyle, current, label, onNavigate, translate }: Props) {
  const router = useRouter()
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onNavigate?.()
    void router.navigate({ href })
  }
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-label={label}
      translate={translate}
      {...stylex.props(xstyle)}
    >
      {children}
    </a>
  )
}
