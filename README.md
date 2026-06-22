# ttics — the team-tactics monorepo

## Quick start

### Already in a coding agent? (one-shot)
In Claude Code / Cursor / etc., paste this one message — the agent installs team-tactics
**and** bootstraps the repo in a single shot:

> Install and bootstrap team-tactics in this repo. Run `npx github:geda0/team-tactics .`, then read
> `AGENTS.md` and `CLAUDE.md`, detect the stack and set `LAYERS` + the test
> command(s) in `.claude/tdd.config`, and draft `docs/tdd/project-invariants.md` from
> the code for me to confirm. If this is an existing codebase, **adopt it and bring it
> up to standard** (characterization tests, green baseline, CI) before new work. Then
> start the first feature with the red→green loop: **`<what you want built>`**.

### From a terminal? (two steps)
```bash
npx github:geda0/team-tactics            # install into your project (or: … ./my-app)
```
Open the project in Claude Code, approve the hooks, and paste the prompt in
`KICKOFF.md` — it does the setup, so there are no config files to hand-edit.

> **Full team by default.** Every install ships the outer-loop team (product-owner / architect /
> qa-verifier / project-manager / dev-ops) alongside the inner pair; an automatic backstop notes
> substantial solo-drift at session end; an opt-in `PROMPT_DIRECTIVE=1` directive can also renew
> the operating mode every prompt. Want just the inner TDD pair? Add `--minimal`.


## Pachages

Three composable packages, each building on the one below (a DAG; `tics` is the shared
foundation both upper layers depend on directly):

- **`packages/tics`** → `@ttics/tics` — the **tic protocol**: the coordination bus, emit,
  reader (`tics log/inbox/conductor/claims/sections/cycle/gate/claim-check`, `--all`). Method-agnostic.
- **`packages/tdd`** → `@ttics/tdd` — **test-driven agent pairing**: the phase×layer gate,
  the pair roles, the inner loop. *Uses `@ttics/tics`.*
- **`packages/team-tactics`** → `team-tactics` — the **full team process**: the outer loop
  (PO/architect/qa/PM/dev-ops), sectioning, the release gate, the composing installer.
  *Uses `@ttics/tdd` + `@ttics/tics`.*

Progressive adoption: `npx tics` (protocol only) → `npx @ttics/tdd` (+ pairing) → `npx team-tactics` (+ outer loop).
