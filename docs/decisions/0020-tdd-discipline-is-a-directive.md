# 0020 — TDD-discipline drift is a directive, not a hook (the `off` escape hatch)

- Status: **Accepted**
- Date: 2026-06-18
- Deciders: navigator (the decisive correction — see Context), architect.
- Relates to: **0005** (operate the full framework by default), **0006** (solo-drift backstop),
  **0011** (evidence-gated greens), **0018** (single source of truth + Cursor parity).

## Context

Forensics on a real Claude Code adopter found a session that *stopped doing TDD mid-task*.
It opened with a proper red→green firefly fix, then hit canvas/snow work, judged it
"plumbing," set `phase=off` (which fully disarms the gate — `guard-edit-scope.sh`:
`off) return 0`), and edited source directly for the rest of the session. The bus shows it
plainly: last `test-writer` delegate at 00:59, then 17h of work with 0 delegations and 16
green suite signals with **no preceding red**. A defect shipped to staging *twice* — snow
rendered always-on instead of daytime-only — even though the "does it snow today?" predicate
was a one-line testable function. `off` is whole-slice and binary, so it swept the *testable
logic* along with the genuinely-visual remainder (a `destination-out` trail artifact, which is
irreducibly un-unit-testable).

We built a candidate fix: `off-drift-check.sh`, a Stop hook (the structural twin of solo-drift,
ADR 0006) that NOTEs when a session accrues off-phase source greens with no red-before-green.
It was correct and tested. **We then rejected it**, because the navigator pointed at the actual
minimal correction:

> "all I had to do to correct the agent is: **USE THE FULL COMPLETE TEAM TACTICS FRAMEWORK**."
> "this should be for **all**, not only CC."

Three facts make that decisive: (a) a single navigator directive re-engaged the identical live
drift **in real time** — before the next edit, free, zero maintenance; (b) a Stop hook is
**Claude-Code-only** (Cursor never runs hooks), but the correction must reach every tool; (c)
the hook fires at *Stop*, **after** the defect already shipped — strictly weaker than the
real-time directive it would mechanize.

## Decision

**TDD-discipline drift — including the `off` escape hatch — is corrected by a tool-agnostic
directive + method guidance, not a new enforcement hook.** This keeps the framework's load-bearing
boundary intact: the hooks enforce the **mechanical** (test-first phase, green bar, scope); whether
an agent is *using the full method* is a **judgment** the navigator asserts (ADR 0005), now made
persistent in the docs so the agent gets it without the navigator repeating themselves.

Concretely, shipped here:
- A top-level **"use the full framework by default — don't drop to `off` to dodge TDD on logic"**
  directive in `AGENTS.md` — the single source of truth read by *every* tool, and pointed-to by the
  Cursor rule (ADR 0018). (CLAUDE.md already carried the CC-side version; AGENTS.md did not.)
- **Visual-work method guidance** in `docs/tdd/tdd-workflow.md`: before reaching for `off` on
  visual/canvas/CSS work, split the testable predicate out of the pixels and TDD it; only the
  irreducible render is `off`-exempt, and it earns a **qa-verifier** verdict (an auditable bus
  record), not eyeballing.

## Consequences

- The correction reaches **all tools** (tier 1, the method), not just CC. No new CC-only
  enforcement surface, no new hook to keep green.
- The navigator's real-time directive stays the **primary** tool; the docs make it the default
  posture so drift is rarer to begin with.
- Accepted cost: this is **not mechanically enforced**. A fully-unattended session with no
  navigator and no one reading the docs could still drift in `off`. We accept it — the
  proportionate, tool-agnostic fix beats a CC-only hook that fires too late, and two existing
  backstops already cover adjacent failure modes (solo-drift for team-disengagement; the
  evidence-gate for greens-without-red at release).

## Meta-principle (the reusable lesson)

Not every observed failure is a missing mechanism. The framework's teeth are for the mechanical;
**discipline lapses are the navigator's to correct, by directive** (ADR 0005). Mechanizing every
judgment lapse into a hook is over-reach — and a hook is CC-only, while the directive is universal,
real-time, and free. When a one-line directive fixes it, prefer the directive.

## Out of scope

- The evidence-gate (ADR 0011 — greens-without-red, surfaced at `tics gate`/release) and
  solo-drift (ADR 0006 — team-disengagement) are unchanged; they are distinct, already-shipped
  backstops for different signals.

## Alternatives considered

- **`off-drift-check.sh` Stop hook** (built, then rejected): an auto-NOTE on off-phase
  source-greens-with-no-red. Rejected — CC-only, fires at Stop (after a defect can ship), and
  disproportionate to a directive that does the job sooner and everywhere.
- **A run-suite-time warning** (the first green-in-off-with-no-red): earlier than Stop, but
  naggier and still CC-only.
- **Do nothing**: the directive existed in CLAUDE.md but not AGENTS.md, so a Cursor/other-tool
  agent never received it — hence the AGENTS.md addition.
