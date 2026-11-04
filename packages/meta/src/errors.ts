/**
 * Error taxonomy. Every failure the client can produce is a MetaError with a
 * `retryable` verdict; the client itself never retries — callers decide.
 *
 *   MetaError
 *   ├─ MetaApiError         HTTP error from the API (status, code, Retry-After)
 *   │  └─ MetaContentPolicyError  code content_policy_violation; never retryable
 *   ├─ MetaConnectionError  network failure, no HTTP response
 *   │  └─ MetaTimeoutError  client-side timeout (request may still be billed)
 *   ├─ MetaBudgetError      local request budget refused the call (nothing sent)
 *   ├─ MetaResponseError    HTTP 200 but response failed / incomplete / refused
 *   ├─ MetaOutputError      output did not parse or failed schema validation
 *   └─ InvalidImageRequestError  image call failed the local check (nothing sent)
 *
 * Caller cancellation is not wrapped: the signal's own reason is rethrown.
 */

export class MetaError extends Error {
  override name = 'MetaError'
  readonly retryable: boolean = false
}

/** Docs: https://dev.meta.ai/docs/error-handling */
export class MetaApiError extends MetaError {
  override name = 'MetaApiError'
  override readonly retryable: boolean
  readonly status: number
  /** `error.type`, e.g. invalid_request_error, rate_limit_error. */
  readonly type: string | undefined
  /** `error.code`, e.g. invalid_api_key, rate_limit_exceeded, model_not_found. */
  readonly code: string | undefined
  readonly param: string | undefined
  /** Parsed Retry-After, when the API sent one. */
  readonly retryAfterMs: number | undefined
  readonly endpoint: string

  constructor(
    message: string,
    status: number,
    type: string | undefined,
    code: string | undefined,
    param: string | undefined,
    retryAfterMs: number | undefined,
    endpoint: string,
  ) {
    super(message)
    this.status = status
    this.type = type
    this.code = code
    this.param = param
    this.retryAfterMs = retryAfterMs
    this.endpoint = endpoint
    // Docs: only 429/500/503 are transient ("use exponential backoff"); 502 is undocumented,
    // 504 "do not simply retry"; never 400/401/402/403/404/413. The client still never retries.
    this.retryable = status === 429 || status === 500 || status === 503
  }
}

/**
 * A safety refusal (`error.code` content_policy_violation), on any endpoint.
 * Docs: https://dev.meta.ai/docs/image-generation, https://dev.meta.ai/docs/error-handling
 * Never retryable, whatever the status.
 */
export class MetaContentPolicyError extends MetaApiError {
  override name = 'MetaContentPolicyError'
  override readonly retryable = false
}

export class MetaConnectionError extends MetaError {
  override name = 'MetaConnectionError'
  override readonly retryable: boolean = true
  readonly endpoint: string
  constructor(message: string, endpoint: string, options?: ErrorOptions) {
    super(message, options)
    this.endpoint = endpoint
  }
}

export class MetaTimeoutError extends MetaConnectionError {
  override name = 'MetaTimeoutError'
  readonly timeoutMs: number
  constructor(timeoutMs: number, endpoint: string) {
    super(`request to ${endpoint} timed out after ${timeoutMs} ms`, endpoint)
    this.timeoutMs = timeoutMs
  }
}

/**
 * The local budget refused a call or a whole action before anything was sent.
 * Retryable after `retryAfterMs`; the client itself still never retries.
 */
export class MetaBudgetError extends MetaError {
  override name = 'MetaBudgetError'
  override readonly retryable = true
  readonly limit: 'hourly' | 'concurrent'
  /** When trying again could succeed. */
  readonly retryAfterMs: number
  /** The priority whose ceiling refused it. */
  readonly priority: 'high' | 'normal'
  constructor(message: string, limit: 'hourly' | 'concurrent', retryAfterMs: number, priority: 'high' | 'normal') {
    super(message)
    this.limit = limit
    this.retryAfterMs = retryAfterMs
    this.priority = priority
  }
}

export class MetaResponseError extends MetaError {
  override name = 'MetaResponseError'
  readonly responseId: string
  readonly status: string
  readonly code: string | undefined
  constructor(message: string, responseId: string, status: string, code: string | undefined) {
    super(message)
    this.responseId = responseId
    this.status = status
    this.code = code
  }
}

export class MetaOutputError extends MetaError {
  override name = 'MetaOutputError'
  readonly issues: readonly string[]
  readonly raw?: string
  constructor(message: string, issues: readonly string[] = [], raw?: string) {
    super(message)
    this.issues = issues
    this.raw = raw
  }
}

/** An image generation or edit failed the local check; nothing was sent. */
export class InvalidImageRequestError extends MetaError {
  override name = 'InvalidImageRequestError'
}
