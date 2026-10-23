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

## Field learnings — tics-project fleet ingest (2026-10)

The first run to use the parallel machinery for real: a leader dispatching about a dozen builder lanes
across four Macs, a remote PC, rented GPU hosts and cloud sessions, with an independent read-only
auditor, from 10-17 to 10-23. Mined from **every branch** of the adopter's repo, not only its shared
bus branch: **2,218 distinct tics** across 106 branches, of which the shared bus held 1,492. The
needs it pulls are in ADR 0025. What the distributed run taught:

- **The bus was partitioned, and the shared view lied by omission.** 726 tics (33%) never reached the
  shared bus: the lanes' whole inner loop (run-suite 307, subagent 163, orchestrator 150, test-writer
  33, implementer 31) stayed on lane branches that were never merged. On the fleet days the shared bus
  showed 99.3% `phase=off`, but across all branches 490 of 1,596 tics were in a red/green/refactor
  cycle. The TDD loop ran; the fleet couldn't see it. → **The bus must be one place regardless of the
  working branch**: the git transport (ADR 0026) publishes every emit to one bus branch.
- **Lane suites ran red most of the time, unseen.** Of the lanes' 268 run-suite signals, 235 were red
  and 33 green, plus 39 `stuck` tics. Nobody on the shared bus could tell a red baseline from a red
  cycle.
- **Addressing was broadcast, so nothing could be acknowledged.** 819 of 990 fleet-day tics went to
  `fleet`, and all 18 `assign` tics went to `fleet` with the addressee named in prose. The leader
  addressed 335 of its 341 tics to `fleet`. An ack fold needs a directed `to`; the real dispatches
  went by direct message, off the bus entirely. → acked handoffs (ADR 0025 N11) require a directed
  addressee, and direct dispatches must be mirrored as tics.
- **Identity was mostly missing.** Only 10 distinct session ids appear on the shared bus. The leader,
  coordinator and macm12 carried none on any tic; the auditor and the cloud lanes that did carry one
  were the easiest to follow. 13 tics carried `seq` 0, the shared bus has 61 duplicate seqs and 53
  ts-order inversions, and the lane branches ran their own counters (411–796).
- **One account is one fault domain.** On 10-22 between 12:17 and 12:38 the leader, the coordinator,
  macM1 and macm12 all hit usage limits, and the bus went silent for three hours (12:38 → 15:22).
  The designated failover (the coordinator) failed with the leader. Cloud lanes went dark for up to
  7.5 h, because a paused cloud session waits for a human "continue". → the roster needs each
  session's **host capabilities and fault domain**, and a failover role must sit in a different one.
- **Liveness and recovery were done by hand.** The leader ran stall checks itself ("STUCK: holds Q16
  with no tic for 34 min", seq 614, 623); one worker was silent because it sat on a permission prompt
  (`requires_action`). Recovery was a hand-rolled `RESUMABLE` checkpoint tic (7 of them) and work
  reassigned by claim (622, 641). Claims carried no lease, so a dead holder kept its claim until a
  human noticed. → liveness, claim leases and resumable checkpoints belong in the session registry
  (ADR 0025 N4), not in the lead's head.
- **What held:** the read-only auditor (95 verdicts, 14 blocks, a session id on every tic and no gap
  over an hour while active); the tic as evidence (every retro claim cites a seq); and the verbatim
  relay of navigator rulings.

The priority principle holds: this run **pulled** the coordination features it needed. The order is
in ADR 0025 §4: transport first, then the read-side folds that make the bus legible at fleet scale.
