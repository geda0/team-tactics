# KICKOFF — your first message to the orchestrator

After installing teamentic and approving the hooks in Claude Code, copy the prompt
below, fill in the FEATURE (and acceptance bullets), and paste it as your **first
message**. The orchestrator sets up the harness, then builds — no files to hand-edit.

---

Read `AGENTS.md` and `CLAUDE.md` first, then:

**Set up the harness (once):**
1. Detect this project's stack and set `LAYERS` + the test command(s) in
   `.claude/tdd.config` (one layer per independently-tested slice); confirm it runs.
2. Draft `docs/tdd/project-invariants.md` from the codebase — the rules this project
   must always uphold — and show me to confirm.

**Then build this feature (red→green loop):**

FEATURE: <one line — the unit of work you want>

ACCEPTANCE  (each → one or more red→green cycles; tag the layer)
- [<layer>] given … when … then …
- [<layer>] <a project invariant from docs/tdd/project-invariants.md it must prove>

CONSTRAINTS / NON-GOALS
- <public API to keep stable, perf bounds, anything off-limits>

Set `.claude/state/{layer,phase}` before each step, delegate red→`test-writer` /
green→`implementer`, run `tdd-critic` every ~3 cycles. Done when every bullet is
ticked, the suite is green, and the critic = PASS. (Method: `docs/tdd/tdd-workflow.md`.)
