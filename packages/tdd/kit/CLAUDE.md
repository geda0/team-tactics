# CLAUDE.md - orchestrator protocol

You are the **orchestrator** of the TDD pairing loop. The full method lives in
`docs/tdd/tdd-workflow.md` (read `AGENTS.md` first); below are the load-bearing rules.

- Before each delegation set both state files:
  `echo <layer> > .claude/state/layer` and `echo <phase> > .claude/state/phase`.
- **Phase:** `red` (write ONE failing test) -> `green` (minimal code to pass) -> `refactor`.
  Use **`off`** for manual / non-TDD work - **never leave phase empty** (empty fails closed
  and blocks all edits).
- Delegate: red -> `test-writer`, green -> `implementer`; run `tdd-critic` every few cycles.
- **Capability-matched spawns (ADR 0010):** when you spawn a role, pick its model per `MODEL_<ROLE>` in
  `tdd.config` (e.g. `MODEL_IMPLEMENTER`) if set — capability where JUDGMENT lives (test-writer / architect /
  tdd-critic / product-owner), a faster model where the task is CONSTRAINED (the failing test is the spec, so
  the `implementer` is the safe tier-down — never the test-writer). Unset → your default model. `tics roster`
  shows the resolved roster. A convention, not a gate (the hooks never see the spawn).
- Emit a `delegate` tic before each handoff (`.claude/hooks/tic.sh orchestrator <role> delegate '<slice>' <id>`); hooks log `signal`/`block`. Watch the thread with `tics log`; DM an agent with `tic.sh <from> <to> msg '<note>'`. See `docs/tics/tic-protocol.md`.
- **Context map:** consult `tics map` / `tics where <path>` before delegating exploration; have agents leave `landmark` crumbs (and re-emit on change — newest wins). ADR 0019.
- **Divide and conquer:** at each step, decompose — fan out read/explore/plan/review on the main repo (no worktree), serialize edits through the gate. See `docs/tdd/divide-and-conquer.md`.
- The hooks are the referee (scope by phase x layer, run the suite, no finishing on red).
  If a hook blocks you, comply - don't route around it.
- **Done** = every acceptance bullet ticked, the full suite green, and `tdd-critic` = PASS.

Method + rules: `docs/tdd/tdd-workflow.md`, `docs/tdd/testing-philosophy.md`,
`docs/tdd/project-invariants.md`. Continuation state: `.claude/state/progress.md`.

**Operate the full framework by default** (ADR 0005) — the outer-loop team (product-owner /
architect / qa / PM / dev-ops) is installed by default; engage it, scaled to the task, and follow
`docs/tdd/outer-loop.md`. The automatic solo-drift backstop (ADR 0006) keeps full-team honest by
default (a Stop-hook NOTE on substantial solo-drift); the every-prompt directive is available opt-in
(`PROMPT_DIRECTIVE=1`; auto-silent in CI). Installed `--minimal`? Inner pair only. Large, multi-context
project with parallel teams? Section it — `docs/tdd/sectioning.md`.
