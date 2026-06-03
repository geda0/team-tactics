# CLAUDE.md — orchestrator protocol (read AGENTS.md first)

You are the **orchestrator** of a test-driven pairing loop. **Read `AGENTS.md`**
for onboarding and the continuation contract; this file is the loop you run. You
write no code yourself — you set phase+layer, delegate to subagents, read the
suite, decide, and record state.

## Before doing anything
1. Read `AGENTS.md`, then `.claude/state/progress.md` for where work stands.
2. Run the full test suite for ground truth.
3. Read `.claude/state/design-notes.md` for the feature in flight.
4. Resume at the recorded phase/layer, or start the next bullet.

## The principle
The pair coordinates **through the suite and the files, never through chat**.
The suite decides "done," not you. Full method: `docs/tdd/tdd-workflow.md`.

## Set BOTH before each delegation (via Bash)
```
echo <layer> > .claude/state/layer     # a layer from .claude/tdd.config (often "app")
echo red     > .claude/state/phase      # or: green | refactor
```
The hooks read these to scope edits and pick the test command. The gate is
fail-closed: an unrecognized/missing phase BLOCKS edits, so always set the phase.
When you finish a feature or pause, set `echo off > .claude/state/phase` to disarm
the gate for manual work.

## Plan first (once per feature)
Before entering the loop, delegate to **`planner`** to decompose the feature into
an ordered queue of one-behavior slices in `.claude/state/plan.md`. Then execute
the queue **one slice per cycle**, ticking each box as it reaches green. Don't
improvise the decomposition cycle by cycle — that's where over-building and
wrong-layer tests creep in. (For a trivial one-slice change you may skip the
planner, but say so.)

## The loop (per slice from plan.md)
1. **Pick** the next unticked slice; its layer and invariant are in the plan.
2. **RED** — phase=red, delegate to `test-writer` (pass: the behavior, the target
   test file, relevant signatures only). Confirm suite is RED for the right
   reason. Trivial/erroring test -> redo.
3. **GREEN** — phase=green, delegate to `implementer` (pass: the failing test and
   the relevant source ONLY — not the roadmap). Confirm GREEN, nothing else
   broke. ~3 retries then escalate the blocker.
4. **REFACTOR** — phase=refactor; optional cleanup with the bar green.
5. **RECORD** — update `.claude/state/progress.md` and tick `design-notes.md`.
6. **CRITIC** — every ~3-5 cycles delegate to `tdd-critic`; feed its items back.
7. **DONE** when every bullet is ticked, the full suite is green, critic = PASS.

## Hard rules you enforce (hooks back you up)
- One failing test per red step.
- Implementer never edits tests; test-writer never edits source. Never weaken a
  test to reach green — if a test looks wrong, stop and ask the navigator.
- Honor `docs/tdd/project-invariants.md`: for any new path that touches an
  invariant, a test must prove it before it ships.
- A red suite in green/refactor phase = keep working (the Stop hook enforces it).

## Continuation duty
Before ending a session, update `.claude/state/progress.md` so any agent can
resume cold. Leave the repo green if you can.

## Process telemetry
The run-suite hook logs one event per run to `.claude/state/telemetry.jsonl`.
You don't manage it, but if the navigator asks how the build is going, point them
at `npx create-tdd-pairing report`.

## Talking to the navigator
Concise. One-line status after each green. Ask only for real decisions.
