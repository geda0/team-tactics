# 0025 — Field learnings from a fleet run (1,490 tics, 34 roles, 4 machines + cloud): the run that pulls the coordination roadmap

- **Status:** **Proposed.** This is a field ingest plus a contribution order: docs only, no code. Each contribution in
  §4 gets its own ADR and goes through the red→green gate when it is built. Nothing here changes a hook, a tic kind or
  a bus field.
- **Date:** 2026-10-23
- **Deciders:** navigator (asked for the switch from "use the framework" to "grow the framework from what the run
  taught"), architect (the gap → core/pack/adopter split in §3 and the order in §4), product-owner (the priority
  principle below; each item names the evidence that pulls it).
- **Relates to:**
  - **ROADMAP "The priority principle"**: new coordination features must be *pulled by a real run that needed them*.
    The two earlier ingests (Based, 98 tics; gvp, 18 tics) found the parallel machinery idle. This run is the first
    that used it, and it shows which parts it outgrew.
  - **0008 (local fleet observability)**: the board and liveness fold. This run needed it across machines.
  - **0011 / 0017 (evidence-gated greens, mechanical judgment gates)**: the gates this run had to rebuild by hand
    for non-code work.
  - **0015 (parallel isolation via worktrees)**: the spool shared across worktrees. This run needed it across
    hosts.
  - **0024 (enforcement is host-dependent)**: a dated forensic read of an adopter's bus, the same method used here.
- **Supersedes:** nothing.

## Context

**The adopter.** tics-project is an evaluation-task factory. It builds benchmark task bundles (instruction, starting
state, sealed grader, reference solution), hardens them against reward hacking, and measures their difficulty with
model runs, before a navigator uploads them to an external platform. It installed team-tactics with the full team and
ran from 2026-10-17 to 2026-10-23. For the first four days it worked as a classic TDD adopter (chassis and grader code
through the phase×layer gate). Then it grew into a **fleet**: a leader session dispatching about a dozen builder lanes
(cloud sessions), three worker Macs, a remote PC, rented GPU hosts, an independent read-only auditor and a PM, all
coordinating through one bus.

**How the bus was read.** It was replayed from the adopter's bus branch at the end of the run, one JSON file per
tic. All counts are exact over the 1,490 records. A later pass over **every branch** of the adopter's repo (105, of which 28 carry a bus) found
2,218 distinct tics: 726 (33%) never reached the bus branch. They are the lanes' inner loop, which stayed on lane
branches that were never merged (the Bus partition row). The other rows count the bus branch only.

### Evidence

| Measure | Count |
|---|---|
| Tics | **1,490** (10-17: 12, 10-19: 227, 10-20: 170, 10-21: 93, **10-22: 550, 10-23: 438**) |
| Distinct `from` values | 34; the top 8 are leader 341, orchestrator 173, subagent 133, worker-mac-1 119, worker-mac-2 114, coordinator 111, auditor 108, run-suite 90 |
| Kinds | status 384, verdict 302, note 251, handoff 149, delegate 108, signal 99, msg 46, claim 32, need 18, assign 18, blocker 13, contract 11, landmark 11, block 10, stuck 9 |
| Phase at emit | **off 1,170 (78.5%)**, red 197, green 106, refactor 16. On the two fleet days: **off 981 of 988 (99.3%)** |
| Inner-loop roles (last active) | test-writer 25 (10-20), implementer 3 (10-19), tdd-critic 8 (10-21), planner 2 (10-20), run-suite 90 (10-21) |
| Outer-loop roles | architect 22 (last 10-21), product-owner 3, dev-ops 4, **qa-verifier 0, project-manager 0** (a "pm" role appears 3 times, ad hoc) |
| Roles the adopter invented | leader 341, coordinator 111, auditor 108, lane builders 173 combined (9 lane identities), red-team 11, contract-auditor 11, difficulty-prober 3, chassis-steward 9 |
| The independent auditor's verdicts | 95: 52 concerns, 27 pass, **14 block** |
| Corrections or retractions in `msg` | 29 (leader 13, auditor 6, coordinator 4, lanes 6) |
| Navigator rulings relayed verbatim | 38 |
| Landmarks (ADR 0019) | 11 in total, **none after 10-21** |
| **Duplicate `seq` values** | **61**, on every day including the last (seq 1452 was emitted by two roles 1 s apart) |
| Tics carrying a `session` id | 219 of 1,490 (14.7%) |
| Status-like tics (status / note / signal / msg) | 780 (52%), against 330 decision-like (verdict / block / assign) |
| Baseline suite at every session start | red (268 tests: 6 failures, 36 errors), warned by `session-green-check` every time and never fixed |
| Peer sessions visible at close | ~55, most idle; several renamed by their job drifting ("build X" sessions doing Y) |
| **The lead's own mix** (leader, 341 tics) | note 183, verdict 87, status 32, **assign 18**, claim 8 (its own), blocker 4, block 2. Most dispatches went by direct message rather than `assign`, so the bus undercounts delegation |
| **Bus partition** (all 105 branches, 28 with a bus) | 726 of 2,218 tics only on lane branches: run-suite 307, subagent 163, orchestrator 150, test-writer 33, implementer 31. Fleet days across all branches: **490 of 1,596 in red/green/refactor**. Lane run-suite: 235 red, 33 green, 39 stuck |
| Addressing | 819 of 990 fleet-day tics broadcast (817 `fleet`, 2 `*`); **all 18 `assign` tics to `fleet`**, the addressee named only in prose |
| Off-bus channel (the coordinator's DM log, 10-22 15:48Z on) | leader↔coordinator **255** direct messages (206 sent by the coordinator in all, 160 received), against the leader's 18 bus `assign` tics. Most sends returned "delivery not confirmed" |
| Correlated outage | 10-22 12:17–12:38: leader, coordinator, macM1 and macm12 all at usage limits (one account); no tic 12:38 → 15:22. Cloud lanes silent up to 7.5 h |
| Briefs that never landed | 3 lanes briefed while idle never acknowledged and never posted. The lead found out only at a stall check (seq 1401) |

### What the adopter built by hand, and why

1. **A cross-host bus over git.** The spool (one file per tic, `TICS_DIR`) is shared only between worktrees on one
   disk. The fleet spanned four machines and cloud sessions. Cloud sessions could not send cross-session messages
   back, and session-to-session DMs reported "delivery not confirmed" for most peers. The adopter committed spool files
   to a dedicated branch through a post helper that rebases and retries. **The bus became the only channel that
   worked everywhere.** Its seq was still racy (61 duplicates), because `seq` is "line count + 1" at emit time
   (`tics-lib.sh`) and two hosts can't see each other's count.
2. **A stage pipeline for non-code work.** The deliverables were bundles, not features: prose, data, a grader and
   a zip. The adopter defined S0–S8 gates (similarity, fairness, exploit replay, difficulty pilot, release) with an
   evidence tic per stage per artifact sha. These lived in an auditor-kept rulebook and were enforced by the auditor's
   judgment. **The phase×layer referee had nothing to grip** at the fleet level: the bus branch shows `off` for
   99.3% of the fleet days. That figure is partly a visibility artifact, though: the lanes ran 490 in-cycle tics on
   their own branches that never merged. The referee gripped the code work and missed the bundle work.
3. **Kill lines as rules nobody could fire mechanically.** Examples: "a weak-model pilot ≥ 0.96 kills", "no reward
   curve before the pilot". On the last night one bundle went through about two hours of grader hardening (curve,
   13-mode exploit matrix, three zip fingerprints) before the 17-minute pilot that killed it. The rule existed, but
   only as prose.
4. **Authority by quotation.** Uploads, purchases and waivers belonged to the navigator alone, and the auditor
   refused any ruling that wasn't quoted verbatim (38 relays). There is no tic kind for a ruling, so the authority
   chain was a convention inside `msg`.
5. **A roster rebuilt by hand.** Lanes were addressed by session names that no longer matched their work. Only
   14.7% of tics carried a session id, so "who is lane 11, and is it alive?" took reading the thread.
6. **Reading cost.** Half the bus was status traffic (52%). The leader alone posted 23% of all tics, and every role
   re-read the thread to find the decisions in it.
7. **A lead that did instead of delegated.** This came from a separate review of roles and the reporting line, done
   for the navigator. The leader's tics are mostly its own notes and verdicts (270 of 341), against 18 `assign` tics
   and 8 claims of its own (589, 596, 622, 636, 641, 647, 699, 701). Two of those (622, 641) were stated takebacks
   from a worker at its usage limit, which is legitimate failover. The other six took audit, QA, analysis and PM-chore
   work owned by other roles onto the lead's own host, and none was handed back. Meanwhile the roles that owned that
   work sat at 0 tics. Some of its own duties (the end-of-run resume refresh) fell to another role. Handoffs had
   no acknowledgement: briefs to idle sessions sat unread, and nothing flagged them until a stall check (1401). Work
   was also assigned before its dependency existed: one lane's scope changed four times, and one task was assigned
   twice and never started. The fixed outer-loop roles show the mirror image: they existed and got no work
   (qa-verifier 0, project-manager 0).

### What held up (keep it)

- **The tic as the unit of evidence.** Every claim in the adopter's retro cites a seq. Disputes were settled by
  pointing at tics, not memory: two false claims were retracted within minutes on bus evidence.
- **An independent, read-only verifier role.** The auditor can't build, fix or dispatch, which is why its 14
  blocks held, including against the leader and under a deadline.
- **The inner loop where it applied.** Chassis and grader code went red→green under the gate, refereed by the
  hooks.

## Decision

Treat this run as the pull the ROADMAP asks for, and split what it needs into three homes.

### §3 Where each need belongs

| Need (evidence) | Home | Why there |
|---|---|---|
| **N1 Git transport for the spool** (§Context 1; 61 seq collisions; the only channel that reached every host; 726 tics stranded on lane branches) | `@ttics/tics` core | Method-agnostic. Any multi-host adopter needs it. |
| **N2 Collision-free ordering**: `seq` becomes advisory, and order is by (ts, session, content hash) with a stable tie-break. Readers never trust `seq` for identity | `@ttics/tics` core | Required by N1. Already true in fact today: spool filenames are unique and seqs are not. |
| **N3 `ruling` tic kind** carrying a verbatim quote, source and grantee. Gated actions cite a ruling ref, and `tics board` flags actions with no ruling | `@ttics/tics` core | Authority is general, and it composes with 0017's mechanical gates. |
| **N4 Session registry**: session id on every emit by default, `tics roster` mapping role → session → current job across hosts, and stale or renamed sessions flagged. Each session also declares its **host capabilities** (e.g. Node, Docker, GPU, x86) and its **fault domain** (the account whose usage limit it shares). Claims carry a **lease** that lapses without a tic | `@ttics/tics` core | Extends 0008's liveness fold across hosts. Evidence: the leader ran stall checks by hand (614, 623); a correlated outage took the lead and its failover down together; test work was later routed to a host without Node |
| **N5 `tics digest`**: decisions and verdicts verbatim, status runs folded, and a per-role "since I last read" view | `@ttics/tics` reader | Pure read-side, no bus change. |
| **N6 Evidence-chain stage gates**: an artifact (sha) declares its stages, and each stage requires verdict tics from named roles. `tics gate <sha>` refuses a release with a missing stage, and stage tics carry the sha | `@ttics/tdd` core, opt-in | Generalizes 0011 / 0017 from "the suite went green" to "the declared evidence exists". Gives non-code work a referee instead of `off`. |
| **N7 Declared predicates on a scope**: e.g. `requires: pilot-verdict before curve`, or `kill: weak >= 0.96`. They are evaluated against evidence tics and fire as `block` tics | `@ttics/tdd` core, opt-in | The mechanical form of a kill line. Stays default-safe, as in 0017. |
| **N8 Honest quarantine**: `quarantine <test> --owner --until`, with escalation when the baseline stays red across N sessions | `@ttics/tdd` core | A warning that never escalates was ignored for a week. Quarantine makes the red floor a dated debt instead of noise. |
| **N9 A fleet role pack**: leader (dispatch), independent auditor (read-only, rulebook-keeping), lanes (builders), PM (clock and cap) | **new sibling package**, beside `team-tactics` | The fixed outer-loop roles didn't fit: qa-verifier 0 tics, project-manager 0, product-owner 3. Roles should be packs on one core. `team-tactics` stays one pack, and the fleet is another. |
| **N10 Delegation-ratio fold for lead roles**: per lead, dispatch (`assign` + `delegate` + dispatching handoffs) against self-work (notes + claims *on work another role owns*), with the lead's undone own duties flagged. A claim with a stated failover reason (the owner is at a limit or unreachable) does not count as self-work. **Staff the role:** when a lead claims a role's work and that role has 0 tics, the fold suggests spawning that role (the adopter's AGENTS.md, "Growing the team") instead of only flagging the lead. The ADR 0006 solo-drift backstop, applied to the fleet lead. It applies **only to a role declared as a lead** (by the fleet pack); a solo install has none, so the fold is silent there | `@ttics/tics` reader (fold); the threshold lives in the fleet pack | §Context 7: 18 assigns against 270 notes and verdicts. Six claims took other roles' work while those roles sat at 0 tics, and two were failover. A read-side fold over existing kinds, needing no bus change. It only counts what reaches the bus, so dispatch must go through tics (or be mirrored there) to be seen |
| **N11 Acknowledged handoffs**: an `assign` / `delegate` / `handoff` names a **directed** addressee (not `fleet`) and stays *open* until that addressee emits a tic citing it. `tics board` flags it to the sender as unacknowledged after N minutes | `@ttics/tics` reader (fold over `ref`) | §Context 7 and seq 1401: briefs to idle sessions never landed, and nothing said so. Rides on N4 (who is alive) |
| **N12 Dependency-gated assign**: an `assign` may declare `needs: <ref>`, and stays blocked, not delivered, until a tic satisfying `<ref>` exists | `@ttics/tdd` core, opt-in; a special case of N7 | §Context 7: one scope changed four times, and one task was assigned twice and never started |
| **N13 Referee liveness**: a session states "referee armed: yes/no" from evidence that the hooks loaded (a hook-emitted tic or marker since session start). `tics cycle` and the board show it, and a green claimed while the referee is unarmed is classified self-reported automatically | `@ttics/tdd` core | Found while growing the framework from this run: the kit was installed into a live session whose hooks load only at session start, so two delegated slices ran "hook-gated" with no hook ever firing. The only tell was an absence: no suite-status, telemetry or session-started file and no hook tic on the bus. ADR 0011's hook-signed vs self-reported split failed silent at the session level |
| The S0–S8 definitions, exploit catalogue, grader chassis, model-run recipes | **stays in the adopter** | Domain-specific. The adopter expresses them through N6/N7. |

**Rule of the split:** a need moves into the core only if it is method-agnostic, and it stays opt-in unless every
run benefits. Role and process shapes become packs. Domain stays with the adopter.

### §4 Contribution order

1. **This ADR** (the ingest: evidence plus split).
2. **N1 + N2, the git transport with collision-free ordering.** It is the largest daily pain, and the adopter's
   helper is a working prototype to characterize-test before it replaces anything. Its own ADR has to settle push
   contention (rebase-retry vs append-only refs) and the read-side fetch cadence.
3. **N4 + N5 + N11 + N10, the session registry, digest, acknowledged handoffs and the delegation fold.** All
   read-side folds, so low risk. They make N1's bus readable at fleet scale and show the lead's delegation honestly.
4. **N6 + N7 (with N12 as N7's first case), evidence-chain stage gates and declared predicates.** The largest design: it gives the referee back
   to non-code work. It needs an architect-owned seam ADR and the tdd-critic before build.
5. **N3, ruling tics.** Small once N6 exists, because gated actions then have something to cite.
6. **N8, quarantine.** It is independent and can go at any point after 2.
   **N13, referee liveness**, is independent and small, and every other gate's honesty depends on it: it can go
   at any point.
7. **N9, the fleet role pack.** Last: it should compose N1–N8 and N10–N12, not invent around their absence. It
   carries the N10 threshold for its lead role.

Each step is pulled by a named row in §Context. If a later run shows one isn't needed, it drops, per the priority
principle.

## Consequences

- **Good:** the roadmap's "built but opt-in" coordination machinery gets its first real-run evidence. Each
  contribution names the tic counts that justify it. A fleet adopter no longer has to rebuild the bus, the gates and
  the roster outside the framework.
- **Cost:** N6/N7 make the gate model larger, beyond the phase×layer gate. That is accepted only as opt-in, and
  only with the evidence for it: the bundle work (gates S0–S8) ran entirely at `off`, so the current referee offered
  nothing there. (The bus branch's 99.3% `off` overstates it: the lanes' code work ran in-cycle on unmerged branches.)
- **Risk:** one adopter's shape could over-fit the core. That is the reason for the §3 rule (agnostic → core,
  process → pack, domain → adopter), and why this ADR is Proposed until N1's own ADR ships.

## Predicates (for the ADRs that implement §4)

- **P1 (N1/N2):** two hosts emitting concurrently produce no lost tics and no reader-visible identity collision.
  Tested with two emitters against one bare remote.
- **P2 (N4):** every tic emitted through the kit carries a non-empty session id. `tics roster` resolves role →
  session → last job.
- **P3 (N6):** `tics gate <sha>` exits non-zero when any declared stage of `<sha>` lacks its required verdict, and
  zero when all are present.
- **P4 (N7):** a declared predicate that fires emits exactly one `block` tic citing the evidence tic that tripped
  it.
- **P5 (N8):** a quarantined test past its `--until` date turns the baseline red again.
- **P6 (N10):** on a bus with no declared lead role (a solo install), the fold reports nothing. On a bus where a lead role emits only notes and verdicts, the delegation fold reports a ratio of 0 and
  flags it. One `assign` from that role changes the ratio. A claim on another role's work counts as self-work, and
  the same claim carrying a stated failover reason does not. When the claimed work's owning role has 0 tics, the
  fold names that role as one to staff.
- **P7 (N11):** an `assign` with no addressee tic citing it within N minutes shows as unacknowledged on the board.
  A citing tic clears it.
- **P8 (N12):** an `assign` declaring `needs: <ref>` is reported blocked while no tic satisfies `<ref>`, and open
  once one does.
- **P9 (N13):** with no hook-emitted tic or marker since session start, `tics cycle` reports the referee unarmed,
  and a green from that window is classified self-reported. One hook marker arms it.
