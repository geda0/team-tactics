# 0027 — Fleet visibility: every role that posts is on the board, with or without a session id

- **Status:** **Proposed.** Built red→green through the phase×layer gate (layer `app`, package `@ttics/tics`),
  slice by slice (§Slices). Read-side only: no hook, tic kind or bus field changes.
- **Date:** 2026-10-23
- **Deciders:** navigator (the pull: "visibility, of the team and fleet"), architect (identity fallback in the
  fleet fold), product-owner (a solo install sees its own roles; nothing new nags it).
- **Relates to:**
  - **0025 (field learnings, fleet run)**: needs **N4** (session registry) and **N11** (acknowledged handoffs),
    and the ROADMAP ingest's first lesson: the team could not see itself.
  - **0008 (local fleet observability)**: the board, liveness and collision folds this ADR corrects.
  - **0002 §1 (session identity)**: the `session` field the board keys on.
- **Supersedes:** nothing.

## Context

`fleetModel` (behind `tics board` and the fleet-health line of `tics cycle`) builds its members from the `session`
field only. A tic with an empty `session` is dropped from the board.

On the tics-project fleet bus that dropped the people who mattered most. The leader (341 tics), the coordinator
(112) and macm12 (119) carried no session id on any tic. Only 10 distinct sessions appear in 1,492 tics, so
`tics board` on that bus showed the auditor and a few cloud lanes, and **no leader at all**. A gvp-style solo
install, which rarely sets `TICS_SESSION`, sees an empty board for the same reason.

Requiring the id at emit time (ADR 0025 P2) is still right, but it only helps future tics. The read side can make
every existing bus legible today.

## Decision

1. **Identity fallback.** A member is keyed by its `session` when it has one. A tic with no session (empty, or
   the `*` wildcard) counts toward a role member keyed by its `from`, shown as `<role> (no session)`. The missing
   id is itself made visible, so the gap nudges N4 instead of hiding.
2. **The referee is not a member.** A tic without a session from a hook identity (`run-suite`, `guard`, which
   also emit `need`, `claim` and `stuck`) or of a hook-only kind (`signal`, `block`, `commit`, `session`, per
   ADR 0014 §3, plus `stuck`) is telemetry, not a participant, so it never creates a member.
3. **Collisions stay session-only.** Two roles without session ids on one scope are not evidence of two live
   sessions, so the collision fold is unchanged (no false alarms).
4. **Liveness and STUCK apply to role members** exactly as to sessions: last tic → live / idle / stale. A role
   member's held scope comes from its active claims with no session, so a dead leader holding a claim reads STUCK.

## Predicates

- **V1:** on a bus where a role emits with no session id, `fleetModel` lists that role as a member with its last ts
  and liveness, and the board row names it with `(no session)`.
- **V2:** hook telemetry with no session (the hook identities, or a hook-only kind) creates no member.
- **V3:** a stale role member holding an active no-session claim is STUCK; two no-session roles on one scope are
  not a collision.

## Slices (red→green, one behavior each)

1. **V1 + V2**: the identity fallback and the telemetry exclusion (one fold change).
2. **V3**: STUCK and collisions for role members.

## Consequences

- **Good:** every bus already on disk, the tics-project fleet bus included, shows its whole team on the board.
  Solo installs see their own roles instead of "the agent bus is empty".
- **Cost:** a session that *also* emits some tics without its id shows twice (once as a session, once as a role).
  That is accepted: it is accurate about what the bus records, and it disappears once emits carry ids (N4 / P2).
