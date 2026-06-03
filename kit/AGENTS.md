# AGENTS.md — start here, every agent, every session

Single entry point for any AI agent working in this repo (Claude Code, an
SDK-driven agent, any tool). Read this first.

> Claude Code loads `CLAUDE.md` automatically; it points back here.

## 1. How work is done here
This project is built by **test-driven pairing between agents**. No production
code is written without a failing test demanding it — and that's enforced by
hooks, not honor system. Two agents ping-pong: a **test-writer** writes one
failing test (RED), an **implementer** writes the minimal code to pass it
(GREEN), either cleans up while green (REFACTOR). A **tdd-critic** audits quality
every few cycles; an **orchestrator** runs the loop and writes no code. They
coordinate **through the test suite and the files, never through chat.** Full
method: `docs/tdd/tdd-workflow.md`.

## 2. Required reading order
1. This file.
2. `.claude/state/progress.md` — current state of work; where to resume.
2b. `.claude/state/plan.md` — the slice queue for the feature in flight.
3. `.claude/state/design-notes.md` — the feature in flight.
4. `docs/tdd/project-invariants.md` — rules this project must always uphold.
5. `docs/tdd/testing-philosophy.md` — what to test, and where.
6. `CLAUDE.md` (if you are the orchestrator) — the exact loop.

## 3. How to continue prior work (the continuation contract)
State that must survive across sessions lives in files, because every agent
starts fresh:

| File | Answers |
|------|---------|
| `.claude/state/progress.md`     | What's done, what's next, current phase/layer, blockers |
| `.claude/state/design-notes.md` | Feature goal, acceptance checklist, decisions |
| `.claude/state/plan.md`         | Ordered slice queue; the next unticked slice is next up |
| `docs/tdd/project-invariants.md`| The rules every change must respect |

To resume: read `progress.md`, run the test suite for ground truth, re-enter the
loop at the recorded phase/layer. **Before ending a session, update
`progress.md`** and leave the bar green if you can.

## 4. The rails you cannot go around
- No production code in the `red` phase; no test edits in the `green` phase.
- **Never weaken or delete a test to reach green.** If a test seems wrong, stop
  and raise it.
- Never finish a turn with a failing suite in green/refactor phase.
- One failing test per red step.
The gate is fail-closed — an unrecognized or missing `phase` blocks edits, so it can't be bypassed by forgetting to set it; `off` disarms it for manual work. If a hook blocks you, it's doing its job — read its message and comply.

## 5. Project invariants
The non-negotiable rules live in `docs/tdd/project-invariants.md`. For any new
path that touches one, write the test that proves it first.
