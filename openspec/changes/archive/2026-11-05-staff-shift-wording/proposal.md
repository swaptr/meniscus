## Why

Archiving landing-and-login-page left web/staff "Staff on shift" over the 500-character limit, so `openspec validate --all --strict` fails.

## What Changes

- Shorten the "Staff on shift" requirement text; no behaviour change. Its scenarios are copied unchanged.

## Impact

- `openspec/specs/web/staff/spec.md` only. No code or test change.
