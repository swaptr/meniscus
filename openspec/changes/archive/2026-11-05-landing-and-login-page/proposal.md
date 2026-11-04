## Why

Signed out, the app showed the sign-in form at whatever URL was opened, `/` included, so a judge or a new ward opening the deployed app saw a password form with no word about what Meniscus is. A public landing page at `/` explains the product in one screen, and sign-in gets its own address, `/login`, that links and the landing page can point at.

## What Changes

- `/` signed out shows a landing page: the product name, a one-line pitch, an animated illustration of a read (a container filling, its outline traced, a draft chip), three "how it works" steps, the not-a-diagnostic-device note and a "Sign in" button to `/login`. Every animation is off under reduced motion. It sends nothing beyond `GET /api/session`.
- The sign-in screen moves to `/login`, unchanged. Signed out, any other app URL redirects to `/login?next=<the URL>`; after sign-in the app opens `next` when it is a path on this site, else the role's landing page.
- Signed in, `/` and `/login` open the role's landing page (or a safe `next`), as `/` did before.
- No server change, no model request.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web/staff`: "Staff on shift" (signed-out routes now redirect to `/login`); ADDED "Landing page" and "Sign-in page".

## Impact

- `apps/web`: `src/routes/login.tsx` (new), `src/components/landing.tsx` (new), `src/lib/landing.ts` (new, copy), `src/lib/staff.ts` (`LOGIN`, `safeNext`, `signedOutRoute`, `landingPath` with `next`), `src/components/session-gate.tsx`, `src/lib/screens.ts` (audit route), `src/routeTree.gen.ts` (regenerated).
- Bed card links (web/bed-qr "Bed link needs sign-in") keep their behaviour through `next`.
