import { Link } from '@tanstack/react-router'
import * as stylex from '@stylexjs/stylex'
import { LANDING_COPY } from '../lib/landing.ts'
import { LOGIN } from '../lib/staff.ts'
import { color, motion, radius, space, text, weight } from '../tokens.stylex.ts'
import { BrandMark } from './brand-mark.tsx'
import { Button } from './button.tsx'
import { CameraIcon, ChevronRightIcon, InfoIcon, ReviewIcon, SparkIcon } from './icons.tsx'
import { LandingHero } from './landing-hero.tsx'

const STEP_ICONS = [CameraIcon, SparkIcon, ReviewIcon] as const

/**
 * The public landing page at `/`, signed out (web/staff "Landing page"): what Meniscus does, an illustration of the
 * reads and a way to sign in. It sends nothing; the session gate has already sent the one `GET /api/session`.
 */
export function Landing() {
  return (
    <div {...stylex.props(s.page)}>
      <div {...stylex.props(s.frame)}>
        <header {...stylex.props(s.top)}>
          <BrandMark size="lg" />
          <Button variant="secondary" nativeButton={false} render={<Link to={LOGIN} />}>
            {LANDING_COPY.signIn}
          </Button>
        </header>

        <main {...stylex.props(s.main)}>
          <section aria-labelledby="landing-title" {...stylex.props(s.hero)}>
            <div {...stylex.props(s.copy, s.enter)}>
              <h1 id="landing-title" {...stylex.props(s.title)}>
                {LANDING_COPY.tagline}
              </h1>
              <p {...stylex.props(s.pitch)}>{LANDING_COPY.pitch}</p>
              <div {...stylex.props(s.actions)}>
                <Button size="lg" nativeButton={false} render={<Link to={LOGIN} />}>
                  {LANDING_COPY.signIn}
                  <ChevronRightIcon size={20} aria-hidden />
                </Button>
              </div>
              <p {...stylex.props(s.note)}>
                <InfoIcon size={16} aria-hidden />
                <span>{LANDING_COPY.note}</span>
              </p>
            </div>
            <LandingHero />
          </section>

          <section aria-labelledby="steps-title" {...stylex.props(s.stepsBlock)}>
            <h2 id="steps-title" {...stylex.props(s.h2)}>
              {LANDING_COPY.stepsTitle}
            </h2>
            <ol {...stylex.props(s.steps)}>
              {LANDING_COPY.steps.map((step, i) => {
                const Icon = STEP_ICONS[i]!
                return (
                  <li key={step.title} {...stylex.props(s.step, s.stepIn, STAGGER[i])}>
                    <span {...stylex.props(s.stepHead)}>
                      <span {...stylex.props(s.stepIcon, i === 2 ? s.iconOk : i === 1 ? s.iconSpark : s.iconCapture)}>
                        <Icon size={20} aria-hidden />
                      </span>
                      <span {...stylex.props(s.stepNum)}>{i + 1}</span>
                    </span>
                    <h3 {...stylex.props(s.stepTitle)}>{step.title}</h3>
                    <p {...stylex.props(s.stepBody)}>{step.body}</p>
                  </li>
                )
              })}
            </ol>
          </section>
        </main>

        <footer {...stylex.props(s.foot)}>
          {LANDING_COPY.product} · fictional demo patients only · {LANDING_COPY.note}
        </footer>
      </div>
    </div>
  )
}

const REDUCE = '@media (prefers-reduced-motion: reduce)'
const WIDE = '@media (min-width: 880px)'
const PHONE = '@media (max-width: 520px)'

// Only opacity and transform move (DESIGN.md 2.8); every animation is `none` under reduced motion.
const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'none' } })

const delay = stylex.create({
  step0: { animationDelay: '0.3s' }, // motion-ok: the steps rise with the hero
  step1: { animationDelay: '0.45s' }, // motion-ok: staggered by 150 ms
  step2: { animationDelay: '0.6s' }, // motion-ok: staggered by 150 ms
})
const STAGGER = [delay.step0, delay.step1, delay.step2] as const

const s = stylex.create({
  page: {
    minHeight: '100dvh',
    paddingBlock: { default: space.xxl, [PHONE]: space.xl },
    paddingInline: { default: space.xxl, [PHONE]: space.lg },
    paddingBottom: `calc(${space.xl} + env(safe-area-inset-bottom))`,
    backgroundColor: color.canvas,
    backgroundImage: `radial-gradient(900px 420px at 85% -80px, color-mix(in srgb, ${color.intake} 14%, transparent), transparent), radial-gradient(700px 380px at 0% 30%, color-mix(in srgb, ${color.accent} 10%, transparent), transparent)`,
    color: color.fg,
    fontSize: text.md,
    lineHeight: text.leading,
    overflowX: 'hidden',
  },
  frame: { display: 'flex', flexDirection: 'column', gap: space.xxxl, maxWidth: 1080, marginInline: 'auto' },
  top: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.lg },
  main: { display: 'flex', flexDirection: 'column', gap: { default: 56, [PHONE]: space.xxxl } },
  hero: {
    display: 'grid',
    gap: space.xxxl,
    alignItems: 'center',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [WIDE]: 'minmax(0, 1fr) minmax(0, 1fr)' },
    paddingTop: { default: space.xxl, [WIDE]: 48 },
  },
  copy: { display: 'flex', flexDirection: 'column', gap: space.xl, minWidth: 0 },
  enter: {
    animationName: { default: rise, [REDUCE]: 'none' },
    animationDuration: motion.signature,
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  title: {
    fontSize: { default: text.hero, [WIDE]: '44px' },
    fontWeight: weight.heavy,
    letterSpacing: '-0.025em',
    lineHeight: 1.08,
    textWrap: 'balance',
  },
  pitch: { fontSize: text.lg, color: color.muted, maxWidth: '36em', textWrap: 'pretty' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: space.lg, paddingTop: space.sm },
  note: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.md,
    paddingBlock: space.sm,
    paddingInline: space.lg,
    borderRadius: radius.pill,
    backgroundColor: color.infoBg,
    color: color.info,
    fontSize: text.sm,
    fontWeight: weight.semibold,
  },

  stepsBlock: { display: 'flex', flexDirection: 'column', gap: space.xl },
  h2: { fontSize: text.xl, fontWeight: weight.heavy, letterSpacing: '-0.01em' },
  steps: {
    display: 'grid',
    gap: space.xl,
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    padding: space.xxl,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: color.border, ':hover': color.accent },
    borderRadius: radius.lg,
    backgroundColor: color.bg,
    transitionProperty: 'border-color, transform',
    transitionDuration: motion.control,
    transitionTimingFunction: motion.ease,
    transform: { default: 'none', ':hover': 'translateY(-2px)' },
  },
  stepIn: {
    animationName: { default: rise, [REDUCE]: 'none' },
    animationDuration: motion.signature,
    animationTimingFunction: motion.ease,
    animationFillMode: 'both',
  },
  stepHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  stepIcon: { display: 'inline-grid', placeItems: 'center', width: 44, height: 44, borderRadius: radius.md },
  iconCapture: { backgroundColor: color.intakeBg, color: color.intakeText },
  iconSpark: { backgroundColor: color.pendingBg, color: color.pending },
  iconOk: { backgroundColor: color.okBg, color: color.ok },
  stepNum: { fontSize: text.sm, fontWeight: weight.bold, color: color.muted, fontVariantNumeric: 'tabular-nums' },
  stepTitle: { fontSize: text.lg, fontWeight: weight.bold },
  stepBody: { fontSize: text.md, color: color.muted },

  foot: { fontSize: text.xs, color: color.muted, textAlign: 'center', paddingTop: space.xl },
})
