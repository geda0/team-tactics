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
