# Spec Delta

## ADDED Requirements

### Requirement: Database connection settings
Loading configuration SHALL fail with an error that names the variable and never contains its password when `DATABASE_URL` or `DATABASE_SESSION_URL` is set to anything but a `postgres://` or `postgresql://` URL, or names a host other than `localhost`, `127.0.0.1` or `::1` without `sslmode=verify-full`. It makes no model request and opens no connection.

#### Scenario: Remote host without certificate check
- **WHEN** configuration is loaded with `DATABASE_URL=postgresql://meniscus_app:Xy9-secret@db.abcdefghij.supabase.co:5432/postgres?sslmode=require`
- **THEN** loading fails with an error naming `DATABASE_URL` and `sslmode=verify-full`
- **AND** the error text does not contain `Xy9-secret`

#### Scenario: Remote host with certificate check
- **WHEN** configuration is loaded with `DATABASE_URL=postgresql://meniscus_app:Xy9-secret@db.abcdefghij.supabase.co:5432/postgres?sslmode=verify-full` and `DATABASE_CA_FILE` naming a readable PEM file
- **THEN** loading succeeds

#### Scenario: Local database without TLS
- **WHEN** configuration is loaded with `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres` (the local Supabase stack)
- **THEN** loading succeeds

#### Scenario: Not a database URL
- **WHEN** configuration is loaded with `DATABASE_URL=./data/meniscus.db`
- **THEN** loading fails with an error naming `DATABASE_URL`

### Requirement: Session connection
Loading configuration SHALL fail when the session connection URL, `DATABASE_SESSION_URL` or else `DATABASE_URL`, names port 6543, which is Supavisor's transaction mode. That mode cannot hold the session that migrations, notification listeners and the queue worker need. Request queries may use port 6543 through `DATABASE_URL`. It makes no model request.

#### Scenario: Transaction mode only
- **WHEN** configuration is loaded with `DATABASE_URL=postgresql://meniscus_app.abcdefghij:Xy9-secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres?sslmode=verify-full` and no `DATABASE_SESSION_URL`
- **THEN** loading fails with an error naming `DATABASE_SESSION_URL` and port 6543
- **AND** the error text does not contain `Xy9-secret`

#### Scenario: Transaction mode for requests, session mode for the worker
- **WHEN** configuration is loaded with that `DATABASE_URL` and `DATABASE_SESSION_URL=postgresql://meniscus_app.abcdefghij:Xy9-secret@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=verify-full`, and the server starts
- **THEN** loading succeeds
- **AND** migrations and every notification listener connect to port 5432, and request queries to port 6543

### Requirement: Schema migrated on start
Before it listens, the server SHALL apply, in order and once each, every committed migration the `meniscus` schema's migration journal does not yet record, on the session connection and under a lock that makes a second server starting at the same time wait and then apply nothing. A database already at the latest migration starts with no schema change. A failed migration stops the start, changing nothing. Starting makes no model request.

#### Scenario: Empty database
- **WHEN** the server starts on an empty database
- **THEN** schema `meniscus` holds every table of the build, and its migration journal records each committed migration once
- **AND** `GET /api/wards`, signed in as Anita Thomas, returns the four demo wards 2C, 3A, 5B and HDU

#### Scenario: Bootstrapped role
- **WHEN** the bootstrap SQL has created role `meniscus_app` with `CREATE` on the database, and the server starts as `meniscus_app`
- **THEN** the start succeeds, and every table in schema `meniscus` is owned by `meniscus_app`

#### Scenario: Second start
- **WHEN** a 200 mL water entry is recorded for 3A bed 1 and the server is stopped and started again on the same database
- **THEN** the migration journal holds the same rows as before, and no table, column, index or trigger in `meniscus` changed
- **AND** 3A bed 1's entry list still contains the 200 mL entry

#### Scenario: Two servers start at once
- **WHEN** two servers start at the same moment on one empty database
- **THEN** both start, and the migration journal records each committed migration exactly once

### Requirement: Tables closed to Supabase's APIs
Every table in the server's `meniscus` schema SHALL have row level security enabled, with no policy and no privilege granted to the `anon`, `authenticated` or `service_role` roles. The server refuses to start when a table breaks this rule. The server's own role owns the tables and is their only client. It makes no model request.

#### Scenario: Every table
- **WHEN** the schema has been created on an empty database
- **THEN** every table in schema `meniscus` has row level security enabled
- **AND** none of `anon`, `authenticated` or `service_role` has any privilege on schema `meniscus` or on any of its tables

#### Scenario: Anonymous read
- **WHEN** a session using role `anon` runs `SELECT * FROM meniscus.entry` on a database holding three entries
- **THEN** the query fails with SQLSTATE `42501` (insufficient privilege)

#### Scenario: Granted by mistake
- **WHEN** `SELECT` on `meniscus.entry` is granted to `anon` and a session using role `anon` runs `SELECT count(*) FROM meniscus.entry` on a database holding three entries
- **THEN** the count is 0

#### Scenario: Table without RLS
- **WHEN** table `meniscus.example` is created without row level security in a migrated database, and the server starts
- **THEN** start fails with an error naming `meniscus.example`

### Requirement: Storage secrets never revealed
The passwords in `DATABASE_URL` and `DATABASE_SESSION_URL`, and the values of `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, SHALL never appear in a log line, an HTTP response or `GET /api/metrics`. It makes no model request.

#### Scenario: Database down at start
- **WHEN** the server starts with `DATABASE_URL=postgresql://meniscus_app:pw-7f3a9c@127.0.0.1:1/postgres` and nothing listens on port 1
- **THEN** start fails, and its log names host `127.0.0.1` and `ECONNREFUSED`
- **AND** nothing it wrote to stdout or stderr contains `pw-7f3a9c`

#### Scenario: Database lost during a request
- **WHEN** the database connection fails while `GET /api/admissions` runs
- **THEN** the response is 500 with the body `{"error":"internal_error"}` only
- **AND** no log line contains the database password

#### Scenario: Storage request refused
- **WHEN** the media store answers an upload with HTTP 403 and `S3_SECRET_ACCESS_KEY=sk-test-55aa`, with the chart on Postgres
- **THEN** the upload's response is 503 with the body `{"error":"media_unavailable"}` only
- **AND** no log line contains `sk-test-55aa` or the access key id
