# team-tactics

Bootstrap the **team-tactics kit** into any project with one command. The kit
makes Claude Code agents build software by test-driven pairing — a `test-writer`
and an `implementer` ping-pong red→green while Claude Code hooks enforce the
discipline (no source edits in red, no test edits in green, no finishing on a
red bar). Works for a single package or a multi-layer monorepo.

> **team-tactics is the composition root of the `ttics` monorepo.** It composes two
> layers and installs both into your project:
> - **`@ttics/tics`** — the protocol: the agent-to-agent tic bus + grouping/coupling
>   (sections, claims, the conductor view).
> - **`@ttics/tdd`** — the pairing gate: the test-writer/implementer agents + the
>   fail-closed hooks that enforce red→green.
>
> The dependency DAG is `team-tactics → { @ttics/tdd → @ttics/tics, @ttics/tics }`
> (team-tactics depends on the protocol directly too — you can run the bus without the
> gate). `@ttics/tics` and `@ttics/tdd` are the composable layers; installing
> team-tactics gives you both, wired together, plus the presets below.

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

## Commands
Install / maintain — run from anywhere (fetches the kit from the repo):
```bash
npx github:geda0/team-tactics [init] [target]   # install (default)
npx github:geda0/team-tactics update [target]    # refresh agents/hooks/docs, keep your files
npx github:geda0/team-tactics selftest [target]  # verify the gate works in YOUR environment
npx github:geda0/team-tactics --force [target]   # also reset seeded (user-owned) files
npx github:geda0/team-tactics --minimal [target]  # inner TDD pair only (opt out of the default full team)
```
Read the bus — after install, the kit ships a local reader (no fetch, no target):
```bash
.claude/hooks/tics report          # process metrics from the suite 'signal' tics
.claude/hooks/tics log             # the agent-to-agent thread (merges every worktree's bus; --here for local)
.claude/hooks/tics inbox <role>    # tics addressed to a role (slack-like inbox)
.claude/hooks/tics conductor       # live grouping + coupling view (sections + active claims)
.claude/hooks/tics sections        # the open/done sections (work groups)
.claude/hooks/tics claims          # files currently claimed (coupling), and by whom
.claude/hooks/tics sessions        # who's active on this repo (multi-session cooperation)
.claude/hooks/tics todo [<id>]     # your open assignments + the pool to grab (worker/peer view)
.claude/hooks/tics fan-out <spec>  # plan-time disjointness gate before fanning out parallel pairs
```

`selftest` fires synthetic PreToolUse/PostToolUse/Stop payloads at the installed
hooks and asserts the exit codes — so you can confirm the gate actually enforces
in your bash/jq/Claude Code version instead of taking it on faith. Run it after
install and in CI.

Each feature begins with a **planner** pass that writes an ordered queue of
one-behavior slices to `.claude/state/plan.md`; the loop executes them one per
cycle. Every suite run logs a telemetry event, and `report` turns that into
process metrics (cycles, retries per layer, durations) so you can see — and
improve — how the loop is performing.

## Parallel pairs: grouping & coupling

The composed kit makes it safe to run more than one pair at once. From the
**`@ttics/tics`** protocol layer, scoped edits **auto-claim** the files they touch and
**open a section** for the working unit, so two parallel pairs can't silently edit the
same file (the gate blocks a claimed path for a foreign scope — collision-safe by
construction). You watch and plan it with:

- **`tics conductor`** — one live view of grouping (sections) + coupling (active
  claims): who owns what, what's open vs done.
- **`tics sections`** / **`tics claims`** — the work groups and the file claims on their own.
- **`tics fan-out <spec>`** — a *plan-time* disjointness gate: feed it a partition
  spec (one section per line, `<section> <file>...`) and it refuses to fan out if two
  sections would touch the same file — catching collisions *before* any pair starts,
  not just at runtime.

These ship with the installed kit (run them via the installed `.claude/hooks/tics <cmd>`).
For the full model — sections, the shared spool bus across
worktrees, and divide-and-conquer fan-out — see the kit's own docs at
`docs/tics/tic-protocol.md` and `docs/tdd/divide-and-conquer.md`.

## Non-destructive by design
- **Mechanism** (agents, hooks, method docs) is refreshed on every run.
- **Your files** (`.claude/tdd.config`, `.claude/state/`,
  `docs/tdd/project-invariants.md`) are seeded once and never clobbered.
- Existing `AGENTS.md` / `CLAUDE.md` / `KICKOFF.md` get a thin **managed block**
  (refreshed on update) with your content preserved as an overlay below it;
  `settings.json` is content-merged (kit hooks added, your keys kept).

Re-run anytime to pull updates; `--force` resets the seeded files.

## Other ways to run
```bash
npx github:geda0/team-tactics#v0.22.0   # pin a specific released version (a git tag) — reproducible
npx ./team-tactics-<version>.tgz        # from a local tarball (offline)
```
> Heads-up: bare `npx tics` / `npx team-tactics` is **not** this tool (those names
> aren't published to npm — `tics` is an unrelated package). Always install via
> `npx github:geda0/team-tactics`, then run bus commands with `.claude/hooks/tics`.

## What gets installed
```
.claude/agents/        planner, test-writer, implementer, tdd-critic + (default) the outer-loop
                       team: product-owner, architect, qa-verifier, project-manager, dev-ops
.claude/hooks/         guard-edit-scope, run-suite (+telemetry), require-green-to-stop,
                       session-green-check, subagent-handoff, solo-drift-check,
                       prompt-directive (opt-in) — bash
.claude/settings.json  hook wiring (SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/SubagentStop)
.claude/tdd.config     your layers + test commands (yours to edit)
.claude/state/         progress.md, design-notes.md, plan.md (slice queue),
                       phase (seeded 'off'), layer, telemetry.jsonl
docs/tdd/              tdd-workflow, testing-philosophy, conventions,
                       project-invariants
.github/workflows/     tdd-verify.yml (clean-checkout verify in CI)
AGENTS.md CLAUDE.md KICKOFF.md
```

## The gate is fail-closed
`phase` is seeded `off` (disarmed) so ordinary editing works. During a cycle the
orchestrator sets `red`/`green`/`refactor`. Any *unrecognized or missing* phase
**blocks** edits — a forgotten phase can't silently bypass the referee. Run
`selftest` to confirm this holds in your environment.

## Requirements & caveats
- Node >= 16 to run the bootstrapper.
- The hooks are bash scripts — on Windows use WSL or git-bash.
- Claude Code hook event names and exit-code semantics shift between releases;
  confirm against code.claude.com/docs/en/hooks and watch one dry cycle before
  relying on the gate.

## Developing team-tactics
team-tactics dogfoods its own harness. `kit/` is the source of truth; the `.claude/`
install is generated. After cloning:

```bash
node bin/cli.js .     # materialize the dev harness (.claude/, gate, docs) from kit/
node --test           # the suite
```

Approve the hooks in Claude Code, then edit the product under `bin/` and `kit/`
(what the gate guards); re-run `node bin/cli.js .` after changing `kit/`.

Proprietary — © 2026 geda0. All rights reserved. See [LICENSE](LICENSE).
