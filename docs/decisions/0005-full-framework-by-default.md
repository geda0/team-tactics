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
