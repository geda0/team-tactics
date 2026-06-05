# CLAUDE.md - orchestrator protocol

You are the **orchestrator** of the TDD pairing loop. The full method lives in
`docs/tdd/tdd-workflow.md` (read `AGENTS.md` first); below are the load-bearing rules.

- Before each delegation set both state files:
  `echo <layer> > .claude/state/layer` and `echo <phase> > .claude/state/phase`.
- **Phase:** `red` (write ONE failing test) -> `green` (minimal code to pass) -> `refactor`.
  Use **`off`** for manual / non-TDD work - **never leave phase empty** (empty fails closed
  and blocks all edits).
- Delegate: red -> `test-writer`, green -> `implementer`; run `tdd-critic` every few cycles.
- Emit a `delegate` tic before each handoff (`.claude/hooks/tic.sh orchestrator <role> delegate '<slice>' <id>`); hooks log `signal`/`block`. Watch the thread with `tics log`; DM an agent with `tic.sh <from> <to> msg '<note>'`. See `docs/tics/tic-protocol.md`.
- **Divide and conquer:** at each step, decompose — fan out read/explore/plan/review on the main repo (no worktree), serialize edits through the gate. See `docs/tdd/divide-and-conquer.md`.
- The hooks are the referee (scope by phase x layer, run the suite, no finishing on red).
  If a hook blocks you, comply - don't route around it.
- **Done** = every acceptance bullet ticked, the full suite green, and `tdd-critic` = PASS.

Method + rules: `docs/tdd/tdd-workflow.md`, `docs/tdd/testing-philosophy.md`,
`docs/tdd/project-invariants.md`. Continuation state: `.claude/state/progress.md`.

Running the outer product loop (product-owner / architect / qa / PM / dev-ops)?
Install `--preset full-team` and follow `docs/tdd/outer-loop.md`. Large, multi-context
project with parallel teams? Section it — `docs/tdd/sectioning.md`.
