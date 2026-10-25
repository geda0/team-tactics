# 0030 — The fleet lane strategy: the verifier before the lanes (ADR 0025 stages 0–3 as read-side folds)

- **Status:** **Proposed.** Built red→green, slice by slice (§Slices), in `@ttics/tics` (folds, `tics` verbs) and
  `@ttics/tdd` (run-suite stamps its kit version). No new tic kind and no new bus field: every convention below
  rides on kinds that exist on `main` today, so it composes with ADR 0028 (tics-kinds) and 0029 (tic integrity)
  when they merge, without depending on them.
- **Date:** 2026-10-24
- **Deciders:** navigator (the pull: "use the same lane strategy that makes the pipeline solid and faster for the
  team"), architect (the stage order and the read-side-only split below), product-owner (every verb is silent on
  a solo install that declares nothing).
- **Relates to:**
  - **0022 / 0023 (speculative delegation, speculative lanes)**: the pipeline strategy this ADR lifts to the
    fleet: a mechanical floor, confidence-gated auto-accept, lossless per-unit rejection, a triage lane that only
    adds review.
  - **0025 (field learnings, fleet run)**: implements N4 (leases, host capabilities, fault domains), N6 (stage
    gates), N7 (declared predicates), N8 (quarantine), N10 (delegation fold), N11 (acknowledged handoffs), N13
    (referee liveness) and their predicates P2–P9, in 0025 §4's dependency order. N9 (the fleet role pack) stays
    last and is **not** built here: it should package these, not precede them.
  - **0026 / 0027 (git transport, fleet visibility)**: the one bus and the identity fallback every fold reads.
  - Field research: `reports/Lane strategy for the team.md` (outside this repo), whose verdict was "feasible,
    but build the verifier before the lanes".
- **Supersedes:** nothing.

## Context

The pipeline is fast *because* it is solid: a hook-signed suite is the floor, so a first-try-green small diff can
be auto-accepted and the capable reviewer reads only what is left. The tics-project fleet had the shape of 0023's
Lane B (a leader fanning out to about twelve lanes, an independent auditor) and none of the floor:

- lane suites ran 235 red against 33 green, so "first-try green" meant nothing;
- no stage gate existed (`gate_status.sh`, retro action A3, was never built), and the "pilot before polish" rule
  slipped because it was prose;
- 819 of 990 fleet-day tics were broadcast, so no verdict or brief could be acknowledged;
- the leader and its failover shared one account and failed together;
- claims carried no lease, and a session stalled on a permission prompt looked alive;
- two "hook-gated" slices ran with no hook armed, and nothing said so.

The queueing arithmetic in the research says one serial reviewer serves twelve lanes only if roughly 60% of
candidates auto-accept, and only mechanical gates can supply that honestly. So the order is fixed: make green mean
something, make verdicts addressable and lanes survivable, add review coverage cheaply, and only then let work
advance without a reviewer.

## Decision

Eight read-side folds behind new `tics` verbs, each configured in `tdd.config` and **off or silent when nothing is
declared**. Tic conventions use existing kinds: `verdict`, `note`, `claim`, `session`, `block`, `delegate`,
`handoff` (and `assign` when ADR 0028 lands; the folds already accept it).

### Stage 0 — make green mean something

1. **Stage gate (N6).** `STAGES` in `tdd.config` declares an artifact's evidence chain as `stage:role[,role]`
   pairs, e.g. `STAGES="preflight:dev-ops pilot:auditor fairness:auditor,tdd-critic"`. A stage verdict is a
   `verdict` tic whose `ref` is the artifact's sha and whose `msg` starts with `gate:<stage>`; its `result` is
   `pass` or anything else. `tics gate --sha <sha>` exits **1** when any declared stage lacks a passing verdict
   *at that sha* from every role it names (the latest verdict per stage and role wins), **0** when all are
   present, and **2** when `STAGES` is empty or malformed. **Only verdicts from the roles a stage declares count
   as its evidence**, everywhere (gate, predicates, advance), so a lane cannot self-report its own stage green.
   Evidence is per sha, so a change after a stage
   invalidates exactly the stages that have not re-run on the new sha and keeps nothing stale. The identity
   `triage` may never be a stage role (§6); a `STAGES` that names it is malformed.
2. **Declared predicates (N7, with N12's ordering as its first case).** `PREDICATES` declares
   `requires:<A>:before:<B>` (a `gate:B` verdict at a sha with no earlier passing `gate:A` verdict at that sha
   fires) and `kill:<stage>>=<number>` / `kill:<stage><=<number>` (the latest `gate:stage` verdict at a sha whose
   `result` is a number crossing the line fires). `tics predicates` lists what fires and exits 1 if anything does;
   `tics predicates --emit <from>` emits exactly **one** `block` tic per firing, `ref` `pred:<name>:<sha>`,
   citing the tripping verdict's seq, and never a second for the same ref (P4).
3. **Honest quarantine (N8).** A quarantine is a `note` tic with `result` `quarantine`, `ref` the test id and
   `msg` `owner=<role> until=<YYYY-MM-DD> <reason>`; a `note` with `result` `unquarantine` and the same `ref`
   lifts it. `tics quarantine` lists active and **expired** quarantines and exits 1 when any has expired: a
   quarantine past its date turns the baseline red again (P5). A quarantine without an owner or a valid date is
   reported as invalid and counts as expired. `tics gate --sha` refuses while any quarantine is expired.

### Stage 1 — addressable verdicts, survivable lanes

4. **Acknowledged handoffs (N11).** A dispatch is a `delegate`, `handoff` or `assign` with a non-empty `ref`. It
   is **directed** when `to` names one role (not `*`, `fleet`, `all` or empty) and stays **open** until a tic
   *from that addressee* cites its `ref`, of any kind (the fold keys on `ref` + `to`, never on kind). `tics acks`
   lists open dispatches, marks those older than `ACK_MINUTES` (default 10) **unacknowledged**, and lists
   broadcast dispatches separately as **undirected — cannot be acknowledged**. Exit 1 when anything is
   unacknowledged (P7). Hosts' clocks differ, so an addressee tic up to `ACK_SKEW_SEC` (default 120) *before*
   the dispatch still acks it. Dispatches older than `ACK_WINDOW_MIN` (default 1440) collapse to one count line;
   a dispatch with no parseable `ts` can never age and is reported **invalid** (exit 1). `tics board` adds a
   one-line count **only when `ACK_MINUTES` is declared**: every TDD install emits directed delegates to
   in-session subagents, which do not ack (§Dogfood), so a default line would nag them all.
5. **Leases, host capabilities and fault domains (N4).**
   - **Lease.** With `CLAIMS_LEASE_SEC` > 0, a claim lapses when its holder has emitted no *progress* tic for
     that long. Progress is any tic except a bare `session` heartbeat, so a session that only says "I am alive"
     (or sits on a permission prompt) loses its lease. A lapsed claim no longer blocks `claim-check`. Default 0:
     unchanged behaviour.
   - **Registry.** A member declares itself with a `session` tic whose `msg` carries `caps=<a,b,...>` and
     `domain=<name>` (the account or org whose usage limit it shares). `tics fleet` prints one row per member:
     role, session, domain, caps, current job (its latest active claim, else the latest dispatch addressed to it),
     liveness, lease state.
   - **Correlated outage.** With `FLEET_LEAD` and `FLEET_FAILOVER` set to role names, `tics fleet` flags
     **SAME FAULT DOMAIN** when the two roles' latest declared domains are equal, and exits 1.
6. **Referee liveness with the kit version (N13).** `run-suite` stamps `"kit":"<version>"` into its signal (the
   version file the installer lays). `tics cycle` prints `referee: armed (kit <v>)` when a hook-identity tic exists
   since `.claude/state/session-started`, `armed (kit <v>, installed <w> — restart to re-arm)` when the versions
   differ, and `referee: UNARMED — greens this session are self-reported` when none exists (P9). The newest hook
   tic's kit is the one compared. A kit install (manifest present) with **no** `session-started` marker is
   UNARMED too ("the hooks never ran in this checkout"); a tics-only install, which has no referee, prints
   nothing. It infers from
   evidence and assumes nothing about when the host loads hooks (current Claude Code docs say edited hooks
   hot-reload; the 0.70 fleet trial observed the opposite; the fold is right either way).
7. **Delegation fold (N10).** For roles listed in `FLEET_LEAD`, `tics delegation` reports dispatches against
   self-work (notes, verdicts, self-addressed dispatches, and claims on a `ref` previously dispatched to another
   role). Only a directed dispatch to another role counts as delegation; broadcasts are counted apart. It excludes
   claims whose `msg` says `failover`, prints each lead as `<role>  dispatch/self <d>/<s>`, flags a lead with no
   dispatch as `NO DELEGATION`, and names the owning role "to staff" when that role has no
   tics (P6). Silent, exit 0, when no lead is declared.

### Stage 2 — fleet Lane A, coverage only

8. **Triage precision.** A triage verdict is a `verdict` from `triage` with `result` `concerns` or `pass` and
   `ref` the item. A role in `TRIAGE_REVIEWERS` (default `tdd-critic auditor`) confirms or dismisses it with a
   `verdict` on the same `ref` whose `result` is `confirm` or `dismiss`; nobody else can, so the drafting lane
   cannot clear a flag on its own work, and a new concern after a ruling is pending again. `tics triage` prints confirmed, dismissed and pending flags and the precision
   confirmed / (confirmed + dismissed). Triage never gates: neither `tics gate` (fixed role list) nor
   `tics gate --sha` (refuses `triage` in `STAGES`) reads it (0023 coverage-monotonicity).

### Stage 3 — confidence-gated auto-advance, mechanical stages only

9. **`tics advance <sha>`.** `AUTO_STAGES` names the stages whose verifier is mechanical (e.g.
   `AUTO_STAGES="preflight release_zip similarity"`); each must also appear in `STAGES`, and an empty
   `AUTO_STAGES` is a config error, never a vacuous advance. An artifact is **first-try green** when, for every
   auto stage and every role it declares, the latest verdict at that sha passes *and the first one did too*. `tics advance <sha>` prints `AUTO-ADVANCE` (exit 0) only when the artifact is
   first-try green, no predicate fires on it, no triage `concerns` on it is pending or confirmed, and no
   quarantine has expired. Otherwise `REVIEW` (exit 1) with every reason. Auto-advance covers the auto stages
   only: `tics gate --sha` still requires the judgment stages, so a reviewer's verdict is never skipped.
   `tics advance --stats` prints the auto-advance fraction across shas with stage verdicts and the block rate on
   auto-advanced shas (blocks citing the sha), which is the first attributable speed and quality measure.

## Slices (red→green, in order)

| Slice | Predicate (test name prefix `F`) |
|---|---|
| F1 stage gate | `--sha` exits 1/0/2 as specified; per-sha evidence; latest wins; `triage` in `STAGES` is malformed |
| F2 predicates | `requires…before` and `kill` fire; `--emit` writes one `block` per firing, never two (P4) |
| F3 quarantine | active vs expired vs invalid; exit 1 on expiry; `gate --sha` refuses while expired (P5) |
| F4 acks | directed open → acked by addressee citing ref of any kind; another role citing it does not ack; broadcast listed undirected; age threshold (P7) |
| F5 leases + registry | heartbeat-only holder lapses, progress renews; lapsed claim frees `claim-check`; `tics fleet` rows; same-fault-domain flag (P2-adjacent) |
| F6 referee liveness | unarmed / armed / armed-with-mismatch from evidence; run-suite stamps kit (P9) |
| F7 delegation | silent without a lead; ratio 0 flagged; one dispatch changes it; failover claim exempt; staff suggestion (P6) |
| F8 triage | precision math; pending flags; triage never gates |
| F9 advance | first-try green; a fail-then-pass is not; predicates, triage and quarantine force REVIEW; `--stats` |

Review findings were pinned as tests before their fixes: the draft review (`edit`) as F1f, F2d, F9f–F9h and F10,
the dogfood run as F4e and F5d, and the tdd-critic's CONCERNS as C1–C7 (role-filtered evidence, triage
reviewers, the opt-in board line, linear `--stats`, clock skew and invalid ts, boundary cases, CLI routing).

## Dogfood (this repo's own `tics-bus`, 2026-10-24)

The build ran the method on the shared bus: contract → red → delegate green to a fast-tier implementer → capable
draft review (`edit`, 6 defects) → independent tdd-critic (`CONCERNS`, 7 findings) → fixes, each pinned by a red
test first. Running the new verbs on the real bus found:

- **In-session subagents never acknowledge their brief.** 68 directed dispatches, 11 acked by the addressee. The
  SubagentStop hook emits `handoff` from `subagent` with no `ref`, by design ("agents don't hand-emit
  handoffs"). N11 works for separate fleet sessions; for in-session roles the hook would have to cite the open
  brief. Follow-up, not built here.
- **History floods an unbounded fold**: two days of past briefs all showed as unacknowledged → `ACK_WINDOW_MIN`.
- **The referee was honestly UNARMED for this build**: the kit was installed into a checkout that is not the
  session's project, so no hook ran and every green here is self-reported. The first build printed *no*
  referee line at all in that case (no `session-started` marker), the very silence N13 targets; F6d pinned it
  and `tics cycle` now says UNARMED. Hook-signed greens need a session started inside the repo.

## Consequences

- **Good:** the fleet gets a mechanical floor for non-code work (stage evidence per sha), addressable
  coordination, and the first numbers that can attribute "faster" (auto-advance fraction against block rate).
  All of it is reads over the bus that already exists, so an adopter can run the verbs on a historical bus
  today.
- **Cost:** eight verbs and ten config keys (`STAGES`, `PREDICATES`, `AUTO_STAGES`, `ACK_MINUTES`,
  `ACK_WINDOW_MIN`, `ACK_SKEW_SEC`, `CLAIMS_LEASE_SEC`, `FLEET_LEAD`, `FLEET_FAILOVER`, `TRIAGE_REVIEWERS`). Conventions in `msg` (`gate:<stage>`, `owner=… until=…`,
  `caps=… domain=…`) are parsed text, which ADR 0028's typed fields may later replace; the folds isolate the
  parsing in one place each.
- **Risk:** `kill` thresholds and `AUTO_STAGES` are adopter judgment; a wrong `AUTO_STAGES` auto-advances work
  that needed a reviewer. Mitigation: auto-advance never satisfies a judgment stage of `tics gate --sha`, and
  `--stats` makes a rising block rate on auto-advanced work visible.
- **Not built:** N9 (the role pack), N3 (ruling tics), N5 (digest), fleet Lane B (bundle/host-level
  `fan-out`). They come after this lands and a fleet run reports its `--stats`.
