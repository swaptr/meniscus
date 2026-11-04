/**
 * A drink's icon and its `<Kind> <mL>` label and name (web/ward "Drinks named on the bed review"). One Lucide module per
 * icon, never the barrel. The `Drink` picker lives in `drink-picker.tsx`, so rows and charts don't pull in the form fields.
 */
import type { ComponentType } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { DrinkKind } from '@meniscus/shared'
import type { LucideProps } from 'lucide-react'
import Blend from 'lucide-react/icons/blend'
import Citrus from 'lucide-react/icons/citrus'
import Coffee from 'lucide-react/icons/coffee'
import CupSoda from 'lucide-react/icons/cup-soda'
import Droplet from 'lucide-react/icons/droplet'
import Droplets from 'lucide-react/icons/droplets'
import GlassWater from 'lucide-react/icons/glass-water'
import Leaf from 'lucide-react/icons/leaf'
import Milk from 'lucide-react/icons/milk'
import Soup from 'lucide-react/icons/soup'
import TreePalm from 'lucide-react/icons/tree-palm'
import { DRINK_LABEL, drinkTitle } from '../lib/drinks.ts'
import { color, radius, space, text, weight } from '../tokens.stylex.ts'

export const DRINK_ICON: Record<DrinkKind, ComponentType<LucideProps>> = {
  water: GlassWater,
  tea: Leaf,
  coffee: Coffee,
  milk: Milk,
  juice: Citrus,
  coconut_water: TreePalm,
  buttermilk: Blend,
  ors: Droplets,
  supplement: CupSoda,
  soup: Soup,
  other: Droplet,
}

/** The kind's icon in `intakeText`, named by the kind's label for assistive tech. 14 in rows and chips, 16 inline. */
export function DrinkIcon({ kind, size = 16 }: { kind: DrinkKind; size?: 14 | 16 | 20 | 24 }) {
  const Icon = DRINK_ICON[kind]
  return (
    <span {...stylex.props(s.icon)}>
      <Icon size={size} role="img" aria-label={DRINK_LABEL[kind]} aria-hidden={false} />
    </span>
  )
}

/** `[icon] Tea 150 mL · masala chai`: the name only when it differs from the label. `volume` omitted: no mL. */
export function DrinkLabel({
  drink,
  item,
  volume,
  sep = ' ',
  size = 16,
  chip = false,
}: {
  drink: DrinkKind
  item: string | null
  volume?: number | null
  /** Between the label and the mL: ' ' on the bed review, ' · ' on the check screen. */
  sep?: string
  /** 14 in dense rows and chips, 16 inline (DESIGN.md 5.24). */
  size?: 14 | 16
  /** The drink chip: the one intake shade (`intakeBg` with an `intake` edge), never a hue per kind. */
  chip?: boolean
}) {
  const t = drinkTitle({ drink, item })!
  return (
    <span {...stylex.props(s.label, chip && s.chip)}>
      <DrinkIcon kind={drink} size={size} />
      <span {...stylex.props(s.kind)}>
        {t.label}
        {volume != null ? `${sep}${volume} mL` : ''}
      </span>
      {t.name && <span {...stylex.props(s.name)}>{t.name}</span>}
    </span>
  )
}

const s = stylex.create({
  label: { display: 'inline-flex', alignItems: 'center', gap: space.sm, flexWrap: 'wrap', minWidth: 0 },
  icon: { display: 'inline-flex', flexShrink: 0, lineHeight: 0, color: color.intakeText },
  kind: { fontWeight: weight.semibold, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  name: { color: color.muted, fontWeight: weight.regular },
  chip: {
    minHeight: 24,
    paddingInline: space.md,
    borderRadius: radius.pill,
    backgroundColor: color.intakeBg,
    color: color.intakeText,
    boxShadow: `inset 0 0 0 1px ${color.intake}`,
    fontSize: text.xs,
  },
})
