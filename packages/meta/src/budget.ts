import { MetaBudgetError } from './errors.ts'

/** Which hourly ceiling a reservation is checked against. `high` may use the whole cap; `normal` stops short of the reserve. */
export type Priority = 'high' | 'normal'

export interface BudgetOptions {
  /** Max requests sent per rolling hour, plus those held by open tickets. */
  perHour: number
  /** Max requests in flight at once (a ticket holds its `peak` for its whole life). */
  maxConcurrent: number
  /**
   * Share of `perHour` (integer percent, 0–90) that only `high` reservations may use:
   * `normal` ones stop at `perHour − ⌊perHour · reservePct / 100⌋`. Default 0, one ceiling for all.
   * A reserve is a refusal rule, not a queue: nothing is ever held back for later or retried.
   */
  reservePct?: number
}

/**
 * A whole action's slots, reserved all or nothing by `RequestBudget.reserve`.
 * Pass it as `CallOptions.ticket` on each call of the action; the transport takes one slot per HTTP request.
 * Nothing is queued: a ticket only exists once every slot it needs was free.
 */
export interface Ticket {
  readonly priority: Priority
  /** Hourly slots held and not yet sent. */
  readonly left: number
  /** Called by the transport once per HTTP request. Takes from the budget that issued the ticket; never throws a budget error. Throws a plain Error when no slot is left. Returns the request's release. */
  take(): () => void
  /** Returns unsent slots and the in-flight hold. Idempotent; call it in `finally` when the action ends. */
  release(): void
}

const HOUR = 3_600_000
/** A concurrent refusal clears as soon as a request settles; callers may try again after this. */
const CONCURRENT_RETRY_MS = 5_000
/** The excess is held by running actions, not sent: they settle within a request timeout or so. */
const HELD_RETRY_MS = 60_000

const issuer = new WeakMap<Ticket, RequestBudget>()

/** The budget that issued `ticket`, so a transport can refuse a ticket from another budget. */
export function ticketBudget(ticket: Ticket): RequestBudget | undefined {
  return issuer.get(ticket)
}

/**
 * Fail-fast request budget. An action reserves all its requests before anything is sent
 * (`reserve`), or a single request takes a slot on its own (`acquire`); over budget throws
 * MetaBudgetError instead of queueing or spending. The client never retries; `retryAfterMs`
 * only tells callers when trying again could succeed.
 */
export class RequestBudget {
  #sent: number[] = []
  #held = 0
  #inFlight = 0
  #total = 0
  readonly #reserve: number

  readonly options: BudgetOptions
  private readonly now: () => number

  constructor(options: BudgetOptions, now: () => number = Date.now) {
    this.options = options
    this.now = now
    const pct = options.reservePct ?? 0
    if (!Number.isInteger(pct) || pct < 0 || pct > 90) throw new RangeError(`reservePct must be an integer 0–90, got ${pct}`)
    this.#reserve = Math.floor((options.perHour * pct) / 100)
  }

  #prune(t: number) {
    while (this.#sent.length && this.#sent[0]! <= t - HOUR) this.#sent.shift()
  }

  #ceiling(priority: Priority) {
    return priority === 'high' ? this.options.perHour : this.options.perHour - this.#reserve
  }

  #used() {
    return this.#sent.length + this.#held
  }

  /** Would `requests` fit under `priority`'s hourly ceiling now? Hourly only: in-flight slots are not checked. Pure; nothing is taken. */
  fits(requests: number, priority: Priority = 'normal'): boolean {
    this.#prune(this.now())
    return this.#used() + requests <= this.#ceiling(priority)
  }

  /**
   * All or nothing: holds `requests` hourly slots and `peak` in-flight slots (default 1) for one
   * action, or throws MetaBudgetError holding nothing. No queueing, no waiting, no retries.
   */
  reserve(requests: number, o: { priority?: Priority; peak?: number } = {}): Ticket {
    const priority = o.priority ?? 'normal'
    const peak = o.peak ?? 1
    const t = this.now()
    this.#prune(t)
    const ceiling = this.#ceiling(priority)
    if (this.#used() + requests > ceiling) {
      throw new MetaBudgetError(
        `request budget exhausted: ${ceiling} per hour at ${priority} priority`,
        'hourly',
        this.#hourlyRetry(requests, ceiling, t),
        priority,
      )
    }
    if (this.#inFlight + peak > this.options.maxConcurrent) {
      throw new MetaBudgetError(
        `too many concurrent requests: limit ${this.options.maxConcurrent}`,
        'concurrent',
        CONCURRENT_RETRY_MS,
        priority,
      )
    }
    this.#held += requests
    this.#inFlight += peak
    let left = requests
    let active = 0
    let released = false
    const ticket: Ticket = {
      priority,
      get left() {
        return left
      },
      take: () => {
        if (released) throw new Error('ticket already released')
        if (left <= 0) throw new Error('ticket has no request left')
        if (active >= peak) throw new Error(`ticket allows ${peak} request(s) in flight`)
        left--
        active++
        this.#held--
        this.#sent.push(this.now())
        this.#total++
        let done = false
        return () => {
          if (done) return
          done = true
          active--
        }
      },
      release: () => {
        if (released) return
        released = true
        this.#held -= left
        left = 0
        this.#inFlight -= peak
      },
    }
    issuer.set(ticket, this)
    return ticket
  }

  /** When an hourly refusal could clear: the k-th oldest send leaving the hour, 60 s when the excess is held, 1 h when the action alone exceeds its ceiling. */
  #hourlyRetry(requests: number, ceiling: number, t: number): number {
    if (requests > ceiling) return HOUR
    const k = this.#used() + requests - ceiling
    if (k > this.#sent.length) return HELD_RETRY_MS
    return Math.max(1_000, this.#sent[k - 1]! + HOUR - t)
  }

  /** One request at normal priority, taken at once. Returns the release function; call it exactly once. */
  acquire(): () => void {
    const ticket = this.reserve(1)
    const done = ticket.take()
    return () => {
      done()
      ticket.release()
    }
  }

  stats() {
    const t = this.now()
    this.#prune(t)
    const used = this.#used()
    return {
      total: this.#total,
      lastHour: this.#sent.length,
      held: this.#held,
      inFlight: this.#inFlight,
      perHour: this.options.perHour,
      maxConcurrent: this.options.maxConcurrent,
      reservePct: this.options.reservePct ?? 0,
      /** Requests a `high` / `normal` reservation could still take now. */
      remaining: {
        high: Math.max(0, this.#ceiling('high') - used),
        normal: Math.max(0, this.#ceiling('normal') - used),
      } satisfies Record<Priority, number>,
    }
  }
}
