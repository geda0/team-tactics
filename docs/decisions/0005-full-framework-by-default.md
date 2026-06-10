# 0005 — Full framework on by default (opt-out, not opt-in)

- Status: Accepted
- Date: 2026-06-10
- Deciders: navigator ("engage full team should be by default, framework full usage should be
  in every prompt"), architect (installer default + the UserPromptSubmit seam)

## Context

Every usage ingest (Based, gvp) shows the same thing: the framework's power is **under-activated**.
`--preset full-team` was an opt-in flag rarely passed; the outer loop and multi-session stayed
dormant; gvp's 3-session run engaged the cooperation substrate 0%. The recurring lesson of the
whole project is **BUILT ≠ ACTIVATED** — capability behind an opt-in is capability that doesn't
get used. SessionStart NOTEs were shown to fade (gvp: obeyed 0/2) while per-action guard BLOCKs
were obeyed 8/8 — salience has to be *renewed*, not announced once.

Navigator directive (2026-06-10): flip the stance from opt-in to **full power by default**.

## Decision

1. **The installer default preset is `full-team`.** A plain `npx github:geda0/team-tactics`
   installs the outer-loop team (product-owner, architect, qa-verifier, project-manager, dev-ops)
   alongside the inner pair. Opt out with **`--minimal`** (alias `--preset minimal` / `--preset
   none`), which is **sticky** in the manifest (`preset: "minimal"`) so `update` won't re-add the
   team. Existing plain installs (`preset: null`) adopt full-team on their next `update` — they
   were on the implicit old default; an explicit `--minimal` is remembered.

2. **A `UserPromptSubmit` hook injects the standing operating directive into _every_ prompt.**
   SessionStart fires once; `UserPromptSubmit` fires every turn — so "framework full usage in
   every prompt" maps to this event. The hook emits a concise reminder: operate the full
   framework (outer loop + inner TDD pair + tic protocol + multi-session) **by default, scaled to
   the task** — set phase+layer, delegate, coordinate through tics. Opt out with
   `PROMPT_DIRECTIVE=0`. Kept terse (a few lines) so it informs without drowning the prompt.

3. **Docs describe full-by-default** (CLAUDE.md / AGENTS.md / KICKOFF.md / README): the team is
   present by default; `--minimal` is the lean path.

Outer-loop personas remain **invoked as-needed** — installing them by default makes them
*available*, not *mandatory*; the agent still scales engagement to the task.

## Consequences

- Power is on out of the box; a lean inner-only loop is an explicit, sticky choice.
- The every-prompt directive keeps the full operating mode salient turn-over-turn (the fix for the
  fade that NOTEs suffered).
- Costs, accepted: five extra agent files for everyone (cheap `.md`, used as-needed); a small,
  opt-out context injection each prompt. Guard against over-ceremony by wording the directive
  "scaled to the task," not "delegate everything."
- A new hook event (`UserPromptSubmit`) joins the kit's settings surface; selftest covers it.

## Follow-ups

- The N1–N9 ingest roadmap continues (N1 pt2 cross-worktree bus, etc.) — full-by-default makes the
  multi-session substrate the *default* path, raising the value of finishing it.

## Amendment (2026-06-10) — the every-prompt directive becomes OPT-IN; the reactive backstop is the default accountability

The **core of 0005 stands**: a plain `npx github:geda0/team-tactics` still **installs the full
team by default** (Decision 1 unchanged; `--minimal` is still the sticky opt-out). What flips is
**Decision 2's default**: the proactive `UserPromptSubmit` directive (`prompt-directive.sh`) moves
from **default-ON (opt-out)** to **default-OFF (opt-in)**, enabled with `PROMPT_DIRECTIVE=1`. The
**default accountability is now the automatic reactive solo-drift backstop** (ADR 0006 / N10), which
is already wired on `Stop` and needs zero config.

Rationale (navigator-confirmed):

- **Default-on every-prompt injection is too invasive for shared/prod branches.** Continuous
  per-prompt context injection is noise the moment a checkout is shared or production-facing.
- **A manual `PROMPT_DIRECTIVE=0` disable is itself a "manual step that won't happen" smell** — the
  same anti-pattern 0005 was built to defeat. Relying on every adopter to remember to silence it on
  the wrong branch fails the same way opt-in activation failed.
- **The shared/prod-branch case can't be auto-detected.** Branch semantics are workflow-dependent —
  `main` is the dev branch in trunk-based repos but production in branch-based ones — so the hook
  cannot self-gate by branch. There is no safe automatic default for *proactive* injection.
- **The reactive backstop reaches the same goal automatically.** ADR 0006 surfaces *substantial*
  solo-drift at session end (full-team installed AND ≥`SOLO_DRIFT_CYCLES` signal-tics AND zero
  handoff-tics) as a non-blocking NOTE — keeping full-team honest **without per-prompt noise or
  per-branch config**. Detection, not exhortation, becomes the default guarantee.

What does **not** change:

- Full team is still **INSTALLED** by default (Decision 1); `--minimal` is still the sticky opt-out.
- The every-prompt directive **remains available, opt-in** (`PROMPT_DIRECTIVE=1`) for devs who want
  continuous proactive reinforcement; when enabled it **still self-disables in CI** (the line-11 CI
  guard is kept).
- Decision 3 (docs describe full-by-default) holds — only the directive's framing shifts from
  "renewed every prompt" to "available, opt-in; the reactive backstop is the default accountability."

Net: the activation guarantee shifts from *proactive-by-default + reactive backstop* to
*reactive-by-default + proactive opt-in*. The reactive path (0006) is the zero-config default; the
proactive path (this Decision 2) is the opt-in enhancement.
