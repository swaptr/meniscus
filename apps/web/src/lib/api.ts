/**
 * Typed client for the Meniscus server. Same-origin `/api`, authorised by the session cookie (the dev/preview proxy forwards it).
 * One call = one HTTP request; no retries.
 */
import type {
  AcuityLevel,
  AmendMealInput,
  MealKind,
  ServedTray,
  BudgetRefusal,
  Meal,
  MealInput,
  MealReadResult,
  VoidMealInput,
  AdmissionSummary,
  AmendInput,
  AfterEmptyingInput,
  BagReading,
  BagReadingInput,
  BagReadingResult,
  CareInput,
  CareKind,
  CareOrder,
  CareReview,
  CloseReferralInput,
  EntryEvent,
  HospitalSummary,
  Admission,
  CaptureReadResult,
  ContainerKind,
  ReadMode,
  Entry,
  EntryInput,
  EntryList,
  Explanation,
  Level,
  LevelInput,
  LevelResult,
  Logged,
  MediaRef,
  ModelQuality,
  NoteResult,
  NutritionView,
  NutritionWorklist,
  DietitianAssignment,
  Referral,
  ReferralInput,
  ReviewInput,
  SourceKind,
  Staff,
  WardQuality,
  AssignBedsInput,
  InChargeInput,
  SessionInfo,
  SessionInput,
  SignInRequired,
  WardAccess,
  WardAccessInput,
  WardTeam,
  BagDuplicate,
} from '@meniscus/shared'

/** One field problem of a 400 `invalid_request`. */
export interface ApiIssue {
  path: string
  message: string
}

type ApiBudget = { limit: BudgetRefusal['limit']; budgetClass: BudgetRefusal['budget_class']; retryAfterMs: number }

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: number
  readonly code: string
  readonly retryable: boolean
  /** A 400's field problems, as the server sent them. */
  readonly issues?: ApiIssue[]
  /** A 429 `request_budget_exceeded`: its limit, class and wait (from `Retry-After`, else `retry_after_ms`). */
  readonly budget?: ApiBudget
  /** A 409 `duplicate_reading`: the stored reading this one repeats (charting/bag-periods). */
  readonly duplicate?: BagDuplicate
  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
    issues?: ApiIssue[],
    budget?: ApiBudget,
    duplicate?: BagDuplicate,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.retryable = retryable
    this.issues = issues
    this.budget = budget
    this.duplicate = duplicate
  }
}

/** A model read refused by the server's request budget: read again only from `until` (epoch ms), and only on a tap. */
export interface Refusal {
  until: number
  budgetClass: BudgetRefusal['budget_class']
  limit: BudgetRefusal['limit']
}

/** The refusal in a failed read, with `until` from when the answer came (`at`); null for any other failure. */
export function refusalOf(err: unknown, at: number): Refusal | null {
  if (!(err instanceof ApiError) || !err.budget) return null
  return { until: at + err.budget.retryAfterMs, budgetClass: err.budget.budgetClass, limit: err.budget.limit }
}

/** A 429 body's budget refusal, if it is one. `Retry-After` is whole seconds (model-api/http-errors). */
function budgetOf(status: number, body: Record<string, unknown>, retryAfter: string | null): ApiError['budget'] {
  if (status !== 429 || body.error !== 'request_budget_exceeded') return undefined
  const limit = body.limit === 'concurrent' ? 'concurrent' : 'hourly'
  const budgetClass = body.budget_class === 'critical' ? 'critical' : 'routine'
  const secs = Number(retryAfter)
  const ms = Number.isFinite(secs) && secs > 0 ? secs * 1000 : Number(body.retry_after_ms)
  return { limit, budgetClass, retryAfterMs: Number.isFinite(ms) && ms > 0 ? ms : 60_000 }
}

/** A 409 body's repeated reading, if it is one. */
function duplicateOf(status: number, body: Record<string, unknown>): BagDuplicate | undefined {
  if (status !== 409 || body.error !== 'duplicate_reading') return undefined
  const d = body.duplicate_of as Partial<BagDuplicate> | undefined
  return d && typeof d.id === 'number' && typeof d.created_at === 'string' && typeof d.volume_ml === 'number' && d.event
    ? { id: d.id, event: d.event, volume_ml: d.volume_ml, created_at: d.created_at }
    : undefined
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/** What the API needs from the app's session; lib/session.ts binds it at start-up. */
export interface ApiSession {
  /** The signed-in person's id, or null. */
  staffId: () => number | null
  /** A 401 `sign_in_required` came back from `path` (never retried). */
  expired: (path: string) => void
}
const app: ApiSession = { staffId: () => null, expired: () => {} }
export const bindSession = (s: ApiSession) => void Object.assign(app, s)

/** Sign-in and sign-out: no `X-Staff-Id` (the server ignores it there), and a 401 there is an answer, not an ended session. */
const isSession = (path: string) => path === '/session'

/**
 * Same-origin, so the `HttpOnly` session cookie goes with every request. Every non-GET except to `/session` carries
 * the signed-in person's id as `X-Staff-Id`; reads carry none. A 401 `sign_in_required` calls `expired` and throws.
 */
export function createApi(
  fetchImpl: Fetch = (i, init) => fetch(i, init),
  staffId: () => number | null = () => app.staffId(),
  expired: (path: string) => void = (path) => app.expired(path),
) {
  /** One request; a failure status throws ApiError with the server's code. `answers` are statuses returned instead. */
  async function send(path: string, init?: RequestInit & { json?: unknown; answers?: number[] }): Promise<Response> {
    const { json, answers, ...rest } = init ?? {}
    const headers: Record<string, string> = {}
    if (json !== undefined) headers['content-type'] = 'application/json'
    const who = (rest.method ?? 'GET') !== 'GET' && !isSession(path) ? staffId() : null
    if (who !== null) headers['X-Staff-Id'] = String(who)
    let res: Response
    try {
      res = await fetchImpl(`/api${path}`, {
        ...rest,
        ...(json !== undefined && { body: JSON.stringify(json) }),
        ...(Object.keys(headers).length > 0 && { headers }),
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      throw new ApiError(0, 'offline', 'Cannot reach the server. Check the connection.', true)
    }
    if (!res.ok && !answers?.includes(res.status)) {
      const body: unknown = res.headers.get('content-type')?.includes('json') ? await res.json() : null
      const b = (body ?? {}) as { error?: string; message?: string; retryable?: boolean; issues?: unknown }
      const issues = Array.isArray(b.issues) ? (b.issues as ApiIssue[]) : undefined
      const err = new ApiError(
        res.status,
        b.error ?? 'http_error',
        b.message ?? `Request failed (${res.status})`,
        b.retryable ?? false,
        issues,
        budgetOf(res.status, (body ?? {}) as Record<string, unknown>, res.headers.get('retry-after')),
        duplicateOf(res.status, (body ?? {}) as Record<string, unknown>),
      )
      if (res.status === 401 && err.code === 'sign_in_required' && !isSession(path)) expired(`/api${path}`)
      throw err
    }
    return res
  }
  async function call<T>(path: string, init?: RequestInit & { json?: unknown; answers?: number[] }): Promise<T> {
    const res = await send(path, init)
    return (res.headers.get('content-type')?.includes('json') ? await res.json() : null) as T
  }
  const form = (fields: Record<string, Blob | string | undefined>) => {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
    return f
  }
  const idField = (id: number | undefined) => (id === undefined ? undefined : String(id))
  const post = { method: 'POST' } as const
  const put = { method: 'PUT' } as const

  return {
    /** Who is signed in (200), or the sign-in screen's hospital and demo accounts (401). */
    session: async (signal?: AbortSignal) =>
      (await (await send('/session', { signal, answers: [401] })).json()) as SessionInfo | SignInRequired,
    /** Sign in or unlock: one password check. */
    signIn: (input: SessionInput) => call<SessionInfo>('/session', { method: 'POST', json: input }),
    /** Always 204, with or without a live session. */
    signOut: async () => void (await send('/session', { method: 'DELETE' })),
    wards: (signal?: AbortSignal) => call<HospitalSummary>('/wards', { signal }),
    team: (wardId: number, signal?: AbortSignal) => call<WardTeam>(`/wards/${wardId}/team`, { signal }),
    setInCharge: (wardId: number, input: InChargeInput) => call<WardTeam>(`/wards/${wardId}/in-charge`, { ...put, json: input }),
    assignBeds: (wardId: number, input: AssignBedsInput) => call<WardTeam>(`/wards/${wardId}/assignments`, { ...put, json: input }),
    /** Break-the-glass: the reason and a password check, for a ward outside the person's wards. */
    recordAccess: (wardId: number, input: WardAccessInput) => call<WardAccess>(`/wards/${wardId}/access`, { ...post, json: input }),
    /** Whole hospital, or one ward. */
    admissions: (ward?: number, signal?: AbortSignal) =>
      call<AdmissionSummary[]>(ward === undefined ? '/admissions' : `/admissions?ward=${ward}`, { signal }),
    bed: (token: string, signal?: AbortSignal) => call<Admission>(`/beds/${encodeURIComponent(token)}`, { signal }),
    entries: (admissionId: number, signal?: AbortSignal) => call<EntryList>(`/admissions/${admissionId}/entries`, { signal }),
    addEntry: (admissionId: number, input: EntryInput) => call<Entry>(`/admissions/${admissionId}/entries`, { ...post, json: input }),
    review: (entryId: number, input: ReviewInput) => call<Entry>(`/entries/${entryId}/review`, { ...post, json: input }),
    amend: (entryId: number, input: AmendInput) => call<Entry>(`/entries/${entryId}/amend`, { ...post, json: input }),
    events: (entryId: number, signal?: AbortSignal) => call<EntryEvent[]>(`/entries/${entryId}/events`, { signal }),
    photoUrl: (entryId: number) => `/api/entries/${entryId}/photo`,
    /** Keeps a photo or recording for the bed; link it with `media_id`. No model request. */
    uploadMedia: (admissionId: number, kind: SourceKind, file: Blob, durationMs?: number | null, servedMeal?: MealKind) =>
      call<MediaRef>(`/admissions/${admissionId}/media`, {
        ...post,
        body: form({ file, kind, duration_ms: durationMs == null ? undefined : String(Math.round(durationMs)), served_meal: servedMeal }),
      }),
    /** The bed's newest served tray photo still waiting to be compared (any meal, last 4 h), or `media: null`. No model request. */
    servedTray: (admissionId: number, signal?: AbortSignal) => call<ServedTray>(`/admissions/${admissionId}/served-tray`, { signal }),
    /** The kept bytes, fetched once by a viewer (the token-adding proxy applies, as for every call). */
    media: async (mediaId: number, signal?: AbortSignal) => (await send(`/media/${mediaId}`, { signal })).blob(),
    levels: (admissionId: number, signal?: AbortSignal) => call<Level[]>(`/admissions/${admissionId}/levels`, { signal }),
    addLevel: (admissionId: number, input: LevelInput) => call<LevelResult>(`/admissions/${admissionId}/levels`, { ...post, json: input }),
    /** A bag's level: 201 with the reading and the entry its rise charted, if any. No model request. */
    addBagReading: (admissionId: number, input: BagReadingInput) =>
      call<BagReadingResult>(`/admissions/${admissionId}/bag-readings`, { ...post, json: input }),
    /** The after-emptying photo and/or residual of an emptying or bag change; once, while no later reading exists. */
    afterEmptying: (readingId: number, input: AfterEmptyingInput) =>
      call<BagReading>(`/bag-readings/${readingId}/after-emptying`, { ...post, json: input }),
    /** Start or replace an order: 201 with the new order, or 200 with the unchanged active one. No model request. */
    setCare: <K extends CareKind>(admissionId: number, kind: K, value: CareInput<K>) =>
      call<CareOrder>(`/admissions/${admissionId}/care/${kind}`, { ...put, json: value }),
    /** End the active order of this kind: 200 with the ended order, or 404 when none is active. */
    endCare: (admissionId: number, kind: CareKind) => call<CareOrder>(`/admissions/${admissionId}/care/${kind}`, { method: 'DELETE' }),
    /** Set the bed's acuity: one PUT of the `acuity` care order (charting/acuity). No model request. */
    setAcuity: (admissionId: number, level: AcuityLevel) =>
      call<CareOrder>(`/admissions/${admissionId}/care/acuity`, { ...put, json: { level } }),
    /** Back to the ward default: one DELETE of the active acuity order. No model request. */
    clearAcuity: (admissionId: number) => call<CareOrder>(`/admissions/${admissionId}/care/acuity`, { method: 'DELETE' }),
    /** Today's catheter necessity review: 201, or 409 `already_reviewed`. */
    reviewCatheter: (admissionId: number) => call<CareReview>(`/admissions/${admissionId}/care/catheter/review`, post),
    /** Refer to the ward's dietitians: 201, or 409 `no_dietitian` / `referral_open`. No model request. */
    refer: (admissionId: number, input: ReferralInput) => call<Referral>(`/admissions/${admissionId}/referrals`, { ...post, json: input }),
    /** 200, or 409 `not_open`. Dietitians only. */
    acknowledgeReferral: (referralId: number) => call<Referral>(`/referrals/${referralId}/acknowledge`, post),
    /** 200, or 409 `already_closed`. Dietitians only. */
    closeReferral: (referralId: number, input: CloseReferralInput) =>
      call<Referral>(`/referrals/${referralId}/close`, { ...post, json: input }),
    /** The signed-in dietitian's referrals. No model request. */
    worklist: (signal?: AbortSignal) => call<NutritionWorklist>('/nutrition/worklist', { signal }),
    /** Assign a dietitian: 201 with the assignment, or 200 when it is the current one. No model request. */
    assignDietitian: (admissionId: number, staffId: number) =>
      call<DietitianAssignment>(`/admissions/${admissionId}/dietitian`, { ...put, json: { staff_id: staffId } }),
    /** End the assignment: 200, or 409 `not_assigned` / `no_dietitian`. No model request. */
    handBack: (admissionId: number) => call<DietitianAssignment>(`/admissions/${admissionId}/dietitian`, { method: 'DELETE' }),
    /** The patient nutrition view: referrals, assignments, diet orders and the 3-day food chart. No model request. */
    nutritionView: (admissionId: number, signal?: AbortSignal) => call<NutritionView>(`/admissions/${admissionId}/nutrition`, { signal }),
    staff: (signal?: AbortSignal) => call<Staff[]>('/staff', { signal }),
    quality: (wardId: number, signal?: AbortSignal) => call<WardQuality>(`/wards/${wardId}/quality`, { signal }),
    /** The ward's model accuracy over the last `days`: counts and rates only. No model request. */
    /** `wardId` null: the whole hospital, with no `ward` parameter. */
    modelQuality: (wardId: number | null, days: number, signal?: AbortSignal) =>
      call<ModelQuality>(`/quality/model?${wardId === null ? '' : `ward=${wardId}&`}days=${days}`, { signal }),
    meals: (admissionId: number, signal?: AbortSignal) => call<Meal[]>(`/admissions/${admissionId}/meals`, { signal }),
    addMeal: (admissionId: number, input: MealInput) => call<Meal>(`/admissions/${admissionId}/meals`, { ...post, json: input }),
    voidMeal: (mealId: number, input: VoidMealInput) => call<Meal>(`/meals/${mealId}/void`, { ...post, json: input }),
    amendMeal: (mealId: number, input: AmendMealInput) => call<Meal>(`/meals/${mealId}/amend`, { ...post, json: input }),
    /**
     * 3 model requests, 5 when the bed's served tray photo of `meal` is compared, or 1 in Spark-only mode, set by the
     * server; 1 when the budget is short, 0 when refused (429). `admissionId` and `meal` find the served photo; neither
     * is sent upstream.
     */
    readMeal: (photo: Blob, o: { admissionId?: number | undefined; meal?: MealKind | undefined } = {}, signal?: AbortSignal) =>
      call<Logged<MealReadResult>>('/ai/meal', {
        ...post,
        body: form({ image: photo, admission_id: idField(o.admissionId), meal: o.admissionId === undefined ? undefined : o.meal }),
        signal,
      }),
    /** At most 3 model requests: 3 in `sam+spark` mode, 1 in `spark` (the response's `mode` says which), 0 when refused. `admissionId` names the bed (never sent upstream); the answer has its `read_id`. */
    read: (
      photo: Blob,
      o: { hint?: ContainerKind | undefined; mode?: ReadMode | undefined; admissionId?: number | undefined } = {},
      signal?: AbortSignal,
    ) =>
      call<Logged<CaptureReadResult>>('/ai/read', {
        ...post,
        body: form({ image: photo, hint: o.hint, mode: o.mode, admission_id: idField(o.admissionId) }),
        signal,
      }),
    /** 1 model request. */
    note: (text: string, admissionId?: number, signal?: AbortSignal) =>
      call<Logged<NoteResult>>('/ai/note', {
        ...post,
        json: { text, ...(admissionId !== undefined && { admission_id: admissionId }) },
        signal,
      }),
    /** 2 model requests. */
    voiceNote: (audio: Blob, admissionId?: number, signal?: AbortSignal) =>
      call<Logged<NoteResult>>('/ai/voice-note', { ...post, body: form({ audio, admission_id: idField(admissionId) }), signal }),
    /** 1 model request. */
    explain: (admissionId: number, signal?: AbortSignal) =>
      call<Explanation>('/ai/explain', { ...post, json: { admission_id: admissionId }, signal }),
  }
}

export type Api = ReturnType<typeof createApi>
export const api = createApi()

/** web/capture "Budget refusal offers manual entry", for `limit: "concurrent"`. */
export const BUSY_TEXT = 'Model reads are busy. Read again in a few seconds, or enter by hand.'

/** Short, staff-facing text for any failure. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.budget) return err.budget.limit === 'concurrent' ? BUSY_TEXT : 'Model reads are used up for now. Enter by hand.'
    if (err.code === 'rate_limited' || err.status === 429) return 'Too many requests right now. Wait a minute and try again.'
    if (err.code === 'unauthorized') return 'This device is not authorised for Meniscus.'
    if (err.code === 'forbidden') return 'Not allowed for your role on this ward. Ask the nurse in charge.'
    if (err.code === 'sign_in_required') return 'You were signed out, so this was not saved. Unlock, then try again.'
    if (err.code === 'invalid_credentials') return 'Wrong password'
    if (err.code === 'already_reviewed') return 'Already reviewed today'
    if (err.code === 'no_dietitian') return 'No dietitian covers this ward, so the referral was not sent.'
    if (err.code === 'referral_open') return 'This patient is already referred to a dietitian.'
    if (err.code === 'not_open') return 'This referral is already acknowledged or closed.'
    if (err.code === 'already_closed') return 'This referral is already closed.'
    if (err.code === 'not_assigned') return 'No dietitian is assigned to this patient.'
    // web/capture "Recording too long": a fixed sentence, never the server's message.
    if (err.code === 'audio_too_long') return 'Recording over 10 minutes. Record a shorter note.'
    if (err.code === 'model_api_not_configured') return 'AI reading is not configured on the server. Enter the volume by hand.'
    return err.message
  }
  return err instanceof Error ? err.message : String(err)
}
