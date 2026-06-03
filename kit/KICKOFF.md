# KICKOFF - paste this (filled in) to start a feature

FEATURE
<one-line description of the unit of work>

ACCEPTANCE CRITERIA  (each -> one or more red->green cycles; tag the layer)
- [<layer>] given ... when ... then ...
- [<layer>] <a project invariant from docs/tdd/project-invariants.md it must prove>

CONSTRAINTS / NON-GOALS
- <public API to keep stable, perf bounds, anything off-limits>

Then: set `.claude/state/layer` + `phase`, delegate red->`test-writer` / green->`implementer`,
run `tdd-critic` every ~3 cycles. Done when every bullet is ticked, the suite is green, and
the critic = PASS. (Method: `docs/tdd/tdd-workflow.md`.)
