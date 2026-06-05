# @ttics/tdd — test-driven agent pairing

The core pairing method on top of **@ttics/tics**: a phase×layer gate (red→green→refactor),
the pair roles (test-writer / implementer / tdd-critic / planner), and the inner loop —
enforced by Claude Code hooks, recorded as tics.

- Install: `npx @ttics/tdd .` — composes @ttics/tics, then lays the gate hooks, roles, tdd docs,
  settings, and a seeded `tdd.config`.
- The gate: `.claude/state/phase` ∈ red|green|refactor|off; edits scoped by layer; can't finish on red.
- Read the method: `docs/tdd/tdd-workflow.md`. The full team process is **team-tactics**.
