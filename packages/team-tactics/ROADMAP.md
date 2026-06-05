# Roadmap & priorities

team-tactics is built by its own method and steered by what real runs actually use.

## Core — exercised in every run; keep it sharp
- The **inner TDD loop** (red→green→refactor) + the **phase×layer gate**.
- The **tic protocol** as durable, structured coordination memory (signal/block/delegate/handoff/verdict).
- **Non-destructive install/update** + version discipline.
- **Cross-tool portability** — the method is tool-agnostic; Claude Code's hooks are the *live*
  referee; **CI + the pre-commit gate** are the *portable* referee (see `docs/tdd/tool-support.md`).

## Built but opt-in — don't extend until a real run pulls it
- Parallel **sectioning** (DDD bounded contexts), the **coupling kit** (contract/need/claim),
  **enforced claims**, the **shared spool bus** across worktrees, **divide-and-conquer** fan-out.
- Field evidence (the gvp run: 5 versions, two layers, prod) shows real use was a **solo TDD
  loop + tic telemetry** — the parallel machinery sat idle. It is ready when a project needs it,
  but it is **not** the bottleneck for adoption.

## The priority principle
**Harden the core and the cross-tool story before adding coordination primitives.** New
parallelism/coordination features should be *pulled by a real run that needed them*, not pushed
ahead of demand. When in doubt, invest in: friendliness, honest docs, the portable referee, and
making the solo loop frictionless under any tool.

## Field learnings — Based + gvp ingest (2026-06)

Two real adoptions, two usage modes, both green:
- **Based** (98 tics): a heavy *delegated* pairing loop — 27 delegate + 37 handoff across M1–M4,
  the gate firing, invariants proven, releases tagged. The inner loop runs hard.
- **gvp** (18 tics): a *solo* orchestrator + hook telemetry; 9/10 invariants proven, CI/CD + prod.
  Plus ~18 parallel Cursor worktrees that emitted **zero** tics — real parallel work, invisible to
  the bus (Cursor doesn't run the Claude Code hooks).

What it taught (and what shipped from it):
- **Parallel-coordination machinery is idle in both** (no contract/need/claim/release/sections).
  Demand for parallelism is real (gvp's 18 branches) but happens where the bus can't see it.
  → Don't add more coordination kinds. **Do** bridge cross-tool work onto the bus: the portable
  **post-commit `commit` tic** (git runs it under any tool) — `npx tics install-hooks`.
- **The inner loop is the workhorse; the outer (review) loop was off-bus** (qa/PO/navigator rulings
  lived in docs). → outer-loop roles now emit `verdict` tics; `tics cycle` surfaces the inner loop
  and nudges the tdd-critic cadence.
- **Invariants-first is the real driver** — the method (TDD + invariants) carries; coordination
  machinery is secondary. Keep the core sharp; let real runs pull new features.
