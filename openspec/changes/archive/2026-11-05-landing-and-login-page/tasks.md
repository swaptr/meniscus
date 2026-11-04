## 1. Spec and tests

- [x] 1.1 Delta spec for web/staff: MODIFIED "Staff on shift", ADDED "Landing page" and "Sign-in page"; `openspec validate landing-and-login-page --strict`.
- [x] 1.2 Citing tests in `apps/web/src/lib/landing.test.ts` and `apps/web/src/lib/staff.test.ts`; see them fail.

## 2. Implementation

- [x] 2.1 `lib/staff.ts`: `LOGIN`, `safeNext`, `signedOutRoute`, `landingPath(path, staff, next)`.
- [x] 2.2 `routes/login.tsx` with `validateSearch` for `next`; regenerate `routeTree.gen.ts` with the web build.
- [x] 2.3 `components/session-gate.tsx`: signed out, `/` shows the landing page, `/login` the sign-in screen, any other path redirects to `/login?next=`; signed in, `/` and `/login` open `landingPath`.
- [x] 2.4 `lib/landing.ts` copy and `components/landing.tsx`: hero, animated read illustration (transform, opacity and stroke-dashoffset only, `none` under reduced motion), three staggered steps, the note, "Sign in"; fits 320 px.
- [x] 2.5 `lib/screens.ts`: `/login` in the layout audit's routes.

## 3. Verify

- [x] 3.1 `pnpm --filter @meniscus/web test`, `pnpm typecheck`, `pnpm lint`, `pnpm spec:check`, `openspec validate --all --strict`.
- [x] 3.2 Look at `/` and `/login` at 320, 390 and 1100 px in a browser (user, before archive).
