## ADDED Requirements

### Requirement: Demo accounts and sign-in
Each demo staff member SHALL have their lowercase first name as username and password, set when the store opens for any who have none. Demo sign-in is on unless `NODE_ENV=production` without `MENISCUS_DEMO_LOGIN=1`. When on, the 401 of `GET /api/session` lists every demo account as `{ username, name, role, ward }`. When off, it lists none, and a demo password gets 401 `invalid_credentials`. It makes no model request.

#### Scenario: Demo accounts listed
- **WHEN** a fresh store runs in development, and `GET /api/session` is sent with no session
- **THEN** the 401 body has `hospital: "Meniscus Demo Hospital"` and lists 10 `demo_accounts`, including `{ username: "anita", name: "Anita Thomas", role: "nurse", ward: "3A" }` and `{ username: "lakshmi", name: "Lakshmi Iyer", role: "matron", ward: null }`
- **AND** `POST /api/session` with `{ username: "lakshmi", password: "lakshmi" }` gets 201

#### Scenario: Production refuses demo passwords
- **WHEN** the server runs with `NODE_ENV=production` and an API token, without `MENISCUS_DEMO_LOGIN`
- **THEN** `POST /api/session` with `{ username: "ravi", password: "ravi" }` gets 401 with `error: invalid_credentials`
- **AND** `GET /api/session` with no session returns `demo_accounts: []`
- **AND** with `MENISCUS_DEMO_LOGIN=1` set, the same sign-in gets 201

## REMOVED Requirements

### Requirement: Demo sign-in in production
**Reason**: The store no longer upgrades older files (charting/entries "Store schema version"), so the behaviour for files from before this requirement is gone. The rest of the requirement is unchanged and continues as "Demo accounts and sign-in", without the scenario about older store files.
**Migration**: Tests cite "Demo accounts and sign-in". Delete the data directory (`DATA_DIR`, `apps/server/data/` by default) and restart, or re-seed it with `scripts/demo-history.ts`.
