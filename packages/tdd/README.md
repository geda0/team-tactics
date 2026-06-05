# @ttics/tdd — test-driven agent pairing

The core pairing method on top of **@ttics/tics**: a phase×layer gate (red→green→refactor),
the pair roles (test-writer / implementer / tdd-critic / planner), and the inner loop —
enforced by Claude Code hooks, recorded as tics.

@ttics/tdd **composes @ttics/tics** (the tic protocol — the agent-to-agent coordination bus).
Installing lays the tic protocol first, then the pairing gate on top of it: the hooks emit
`signal` / `block` / `claim` / `section` / `handoff` tics so the loop is observable through
`tics log`, `tics conductor`, and friends.

## Install

Progressive adoption — run it in your project root:

```sh
npx @ttics/tdd init        # or: npx @ttics/tdd .
```

This composes @ttics/tics, then lays the gate hooks, the pair roles, the tdd docs
(`docs/tdd/`), `settings.json`, and a seeded `.claude/tdd.config`. Re-run with `update`
to refresh the mechanism (your `tdd.config` and `state/` are seeded once, never clobbered).
For the full team process around this loop, see **team-tactics**.

## The phase×layer gate

The orchestrator writes two state files before each delegation; the hooks read them to scope
edits and pick the test command:

```sh
echo backend > .claude/state/layer   # the active layer (e.g. app | backend | frontend | e2e)
echo red     > .claude/state/phase   # red | green | refactor | off
```

`guard-edit-scope.sh` (PreToolUse on `Edit|Write|MultiEdit`) enforces the TDD contract by
phase × layer:

| phase      | what may be edited                                              |
|------------|-----------------------------------------------------------------|
| `red`      | **only** the active layer's TEST files (write ONE failing test) |
| `green`    | tests are **frozen** — source only (make the existing test pass)|
| `refactor` | anything in the layer (the Stop hook keeps the bar green)       |
| `off`      | gate disarmed for manual / non-TDD edits                        |

An out-of-contract edit exits 2 — the tool is **blocked**, the reason is returned to the
model, and a `block` tic is recorded so the refusal shows up in the agent-to-agent thread.
An empty or unrecognized phase **fails closed** (blocks), because a missing phase is exactly
how the gate would be bypassed.

`run-suite.sh` (PostToolUse on `Edit|Write|MultiEdit`) is the arbiter: after an edit that
touches the layer's tests or source it runs that layer's test command, writes
`.claude/state/suite-status`, surfaces the result, and emits one `signal` tic per run (red /
green) so the process can be measured. Set `TYPECHECK_CMD` to gate honest-green — a passing
suite then also runs the type-check, so a vitest-green / tsc-red cycle (e.g.
`noUncheckedIndexedAccess`) can't pass the signal.

## The green bar (Stop hooks)

```
phase=green|refactor + red suite  →  cannot stop
```

`require-green-to-stop.sh` (Stop / SubagentStop) refuses to finish on a red bar when the
phase is `green` or `refactor`. A red bar in `red` is correct (you just wrote a failing
test), so it's allowed there. A cached red is re-verified — it re-runs the layer's suite
before blocking, and corrects a stale status if the suite actually passes now.

`session-green-check.sh` (SessionStart) **warns** (does not block) when the baseline suite
is red at session start, so the loop doesn't start on a broken floor where every new failing
test looks like progress. Disable with `SESSION_BASELINE_CHECK=0`, or point `BASELINE_CMD`
at a fast smoke subset.

`subagent-handoff.sh` (SubagentStop) auto-emits a `handoff` tic when a subagent returns
(with the current suite result), so agents never hand-emit handoffs.

## Collision-safe parallel pairs (auto-claim + auto-section)

Disjoint-write fan-out is collision-safe with **zero manual bookkeeping**. Give each pair a
scope and the guard does the rest:

```sh
echo <section>/<pair> > .claude/state/scope
```

On the first scoped edit, `guard-edit-scope.sh`:

- **auto-opens the section** — emits a `section open` for the scope's first component, so the
  partition map (`tics sections` / `tics conductor`) populates itself; and
- **auto-claims the file** — emits a `claim` for it (first toucher owns it).

With `CLAIMS_ENFORCE` (default on) it then **blocks** an edit to a file held by *another*
scope, emitting a `need` for the conflict. Both the open and the claim are **idempotent** —
it never re-opens or re-claims, so the telemetry stays meaningful. An unscoped editor isn't
partitioned and isn't enforced; set `CLAIMS_ENFORCE=0` to disarm. This is what makes
`tics conductor` / `tics sections` light up on their own. See the "running parallel pairs"
recipe in `docs/tdd/divide-and-conquer.md`.

## The roles (agents the kit installs)

- **test-writer** — writes ONE failing test for the behavior; never touches source.
- **implementer** — writes the minimal code to reach green; never edits tests, never weakens
  a test to pass.
- **tdd-critic** — audits test quality and feeds findings back into the loop.
- **planner** — decomposes the work into independent slices.

Read the method: `docs/tdd/tdd-workflow.md`. The full team process is **team-tactics**.
