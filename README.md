# teamentic

Bootstrap the **teamentic kit** into any project with one command. The kit
makes Claude Code agents build software by test-driven pairing — a `test-writer`
and an `implementer` ping-pong red→green while Claude Code hooks enforce the
discipline (no source edits in red, no test edits in green, no finishing on a
red bar). Works for a single package or a multi-layer monorepo.

## Quick start
Run inside your project (or pass a target path):
```bash
npx teamentic            # install into the current directory
npx teamentic ./my-app   # install into a specific path
```

Then:
1. Edit `.claude/tdd.config` — set `LAYERS` and the test command(s) for your stack.
2. Fill in `docs/tdd/project-invariants.md`.
3. Open the project in Claude Code, approve the hooks, run one dry cycle.
4. Fill in `KICKOFF.md` and paste it to the orchestrator to start a feature.

## Commands
```bash
npx teamentic [init] [target]   # install (default)
npx teamentic update [target]   # refresh agents/hooks/docs, keep your files
npx teamentic selftest [target] # verify the gate works in YOUR environment
npx teamentic report [target]   # summarize cycle telemetry (process metrics)
npx teamentic --force [target]  # also reset seeded (user-owned) files
npx teamentic --preset full-team [target]  # also install the outer-loop team (PO/architect/QA/PM/dev-ops)
npx teamentic help
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
npx github:<owner>/teamentic        # straight from a git repo
npx ./teamentic-0.5.0.tgz           # from a local tarball (offline)
```

## What gets installed
```
.claude/agents/        planner, test-writer, implementer, tdd-critic
.claude/hooks/         guard-edit-scope, run-suite (+telemetry), require-green-to-stop,
                       session-green-check (baseline check) — bash
.claude/settings.json  hook wiring (PreToolUse/PostToolUse/Stop/SubagentStop/SessionStart)
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

MIT licensed.
