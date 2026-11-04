@AGENTS.md

## Claude Code specifics

- **Hooks** (`.claude/settings.json`):
  - After every edit, the file is formatted and linted, and specs or traces are re-checked when relevant. A failure comes back to you, so fix it forward.
  - Before stopping with uncommitted changes, OpenSpec validation, spec:check, typecheck and tests must pass.
  - Bash commands that loop against the model API, run the eval or image synthesis with `--yes`, or read `.env` are blocked. The cases are in `.claude/hooks/guard-bash.test.sh`.
- **Protected paths** (permission deny):
  - `openspec/specs/**` and `openspec/changes/archive/**`: written only by `openspec archive`.
  - Generated files: `pnpm-lock.yaml`, `routeTree.gen.ts`, and the OpenSpec skills and commands (`openspec update` owns those).
- **OpenSpec workflow**: `/opsx:explore`, `/opsx:propose <name>`, `/opsx:apply`, `/opsx:archive`. Use the `spec-reviewer` agent on a change before `/opsx:apply` and before `/opsx:archive`.
- **Path-scoped rules** in `.claude/rules/` load when you touch matching files: specs, tests, the Meta client, server, web.
- Clear context between proposing and applying a non-trivial change.
