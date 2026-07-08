# 0023 — Two advanced speculative lanes: a fast-tier CRITIC TRIAGE that only ADDS review coverage, and PARALLEL speculative slices (block drafting at project scale) — both convention, no gate change

- **Status:** **Proposed** (spec only — the confidence rules are defined here; build follows on navigator
  greenlight). Like 0022, both lanes are orchestrator convention resting on the existing bus + the phase×layer
  gate; **no new tic kind, no new bus field, no gate change** (§Decision.7). The single mechanical claim each
  lane makes about the code — the release gate's role list (Lane A) and the `tics fan-out` disjointness command
  (Lane B) — is **verified against the current source** in §Context, not asserted.
- **Date:** 2026-07-06
- **Deciders:** navigator (the shape asked for by name — "offload tasks to faster models to get things done
  fast," now pushed two ways: a cheap first-pass reviewer that *widens* coverage, and concurrent drafting of
  independent slices for wall-clock latency; the budget-scheduling framing carried forward from 0022 — the
  orchestrator reads the queue and decides where the capable model is spent), architect (the two load-bearing
  invariants that keep each lane honest — Lane A's *coverage-monotonicity* [triage can only ADD signal, never
  shrink the capable critic's cadence] and Lane B's *review-then-merge losslessness* [a rejected slice reverts
  nothing already merged]; the mapping of both onto DSpark's confidence-head + load-scheduler; the mechanical
  claims verified against `tics-view.cjs`), product-owner (the two precision/acceptance tallies — triage flags
  the capable critic CONFIRMS vs dismisses, and the unchanged `drafts a/e/r` roster fold for parallel slices —
  as the honest per-role records the navigator tunes `MODEL_TRIAGE` / `MODEL_IMPLEMENTER` against, per 0022's
  acceptance-data principle).
- **Relates to:** **directly extends 0022 (speculative delegation)** and reuses its vocabulary wholesale —
  **draft lanes**, **confidence signals** (the mechanical bus + `git diff` signals that decide WHEN the capable
  model is spent), **lossless rejection** (reject the SLICE, never the run — the longest valid prefix stands),
  **acceptance telemetry** (`verdict` tics folded into `tics roster`), and **convention-not-hook** (the hooks
  never see the spawn or the review). 0022 built the *single-stream* draft/verify loop (one drafter, one
  reviewer, one worktree); this ADR adds the two lanes 0022 named but deferred: a **triage** lane on the review
  side and a **parallel** lane on the draft side. Inherits **0010 (capability-aware execution)** — both lanes are
  `MODEL_<ROLE>` tiering applied further (a fast tier for triage; fast-tier implementers drafting concurrently).
  Builds on **0009 (the honest gate)** — each parallel worktree's hook-signed suite green is the trusted
  mechanical floor per slice; a triage flag is self-reported judgment ON TOP, never a substitute, and (Lane A's
  crux) **never feeds the release gate**. Sits on **0015 (parallel isolation via git worktrees)** — Lane B is
  "git isolates, the bus observes" applied to speculative drafting: N worktrees, one shared spool bus
  (`TIC_STORE=spool`). Inherits **0017 (judgment gates stay conventional)** and **0020 (discipline is a
  directive)** — both lanes are directed, not enforced. **Reuses the `verdict` kind** (0021, via 0022) for both
  the triage flag and the per-slice draft review — **no new kind. Supersedes nothing** (purely additive to 0022;
  0022's single-stream loop stands unchanged and is the degenerate N=1, triage-off case of this ADR).

## Context

0022 locked the single-stream speculative loop: a fast-tier draft → the FREE mechanical verify (the phase×layer
gate + hook-signed suite green) → a confidence-gated big-model diff review resolving to accept/edit/reject, with
lossless per-slice rejection and a `drafts a/e/r` roster tally. Two questions 0022 named but left to a later ADR:

1. **Review COVERAGE.** In 0022 the capable `tdd-critic` samples "every few cycles," and the auto-accept lane
   lets first-try-green, small, in-scope drafts flow through *without* a per-slice review. The honest risk 0022
   stated: **auto-accepted mediocre-but-green code can accumulate** — the suite catches regressions, not
   mediocrity or drift. DSpark's answer to "which drafts merit verification?" is a calibrated **confidence
   head** that predicts survival cheaply. team-tactics's cheapest confidence signals are mechanical (§0022.3),
   but some smells — a hardcoded return, a weakened assertion — are **test-shaped and invisible to a line-count
   or file-scope check**. A *cheap model reading every diff* is the agent-level confidence head for exactly
   those. The load-bearing constraint: such a head must **only widen** coverage, never narrow it.

2. **Draft THROUGHPUT at project scale.** 0022's loop is serial: one slice drafted, verified, reviewed, then the
   next. When the plan has provably independent slices, DSpark's semi-autoregressive move — draft multiple
   blocks and verify them together — maps onto **concurrent drafting in separate worktrees** (0015), with the
   capable model **batch-reviewing** the diffs. The win is **wall-clock latency**, not tokens (N worktrees run
   N suites).

**The two mechanical claims each lane rests on, verified against `packages/tics/kit/hooks/tics-view.cjs` at this
commit** (both re-checked against source, not memory):

- **(Lane A) The release gate reads a FIXED role list and ignores any other `from`.** `ticsGate` (`tics-view.cjs`
  ~L450) filters the bus to `kind === "verdict"`, keys the *latest* verdict per `from`, and blocks release
  unless **`product-owner`** and **`tdd-critic`** verdicts both resolve `pass` (the loop `for (const role of
  ["product-owner", "tdd-critic"])`), with **`qa-verifier`** as an optional third gate (`latest["qa-verifier"]`
  blocks only if present and not `pass`). **No other `from` identity is read by the gate.** Therefore a verdict
  emitted `from` a *distinct* triage role (name: **`triage`**) is invisible to the release gate — it can never
  gate a release. This is the mechanical guarantee behind Lane A's "an unrefereed fast-model opinion must not
  gate releases" (0009). (`triage` is also absent from `ticsRoster`'s `ROLES` list ~L296, and the `drafts a/e/r`
  tally counts only `result` ∈ {accept, edit, reject} ~L297 — so triage's `concerns`/`pass` verdicts pollute
  neither the gate nor the roster acceptance column.)
- **(Lane B) The plan-time disjointness command exists.** `tics fan-out <partition-spec-file>` (`fanOut`,
  `tics-view.cjs` ~L495; dispatched `case "fan-out"` ~L561) reads a partition spec (one section per line,
  `<section> <file>...`), builds a `file -> [section names]` owner map, and **refuses to greenlight** (`return
  1`, "Not safe to fan out as-is") when any file is claimed by two sections; it prints "All partitions disjoint
  — safe to fan out" (`return 0`) only when every file has a single owner. This is the plan-time gate Lane B's
  independence precondition runs through *before* any worktree is spawned; auto-claim (0015) catches residual
  collisions at RUNTIME.

## Decision

Add **two advanced speculative lanes** extending 0022, each an orchestrator convention. Lane A is a review-side
lane (a fast-tier triage reviewer); Lane B is a draft-side lane (parallel speculative slices). Seven
sub-decisions.

### Lane A — CRITIC TRIAGE

### 1. A fast-tier first-pass reviewer that FLAGS, and its one load-bearing invariant

Add an optional **fast-tier triage reviewer** that reads **every** slice's diff cheaply and **flags the
suspicious ones** — the agent-level confidence head (DSpark) predicting which drafts warrant the capable model's
attention. It is spawned per the `MODEL_TRIAGE` tier (§3) and reviews diffs the auto-accept lane (§0022.3) would
otherwise wave through un-read.

**The invariant that keeps it safe (this is the whole point of the lane — coverage-monotonicity):**

> **Triage only ADDS review signal. The capable `tdd-critic`'s unconditional sampling cadence (0022 — "every few
> cycles") NEVER shrinks because triage exists.**

The critic samples on the same cadence it does today, triage on or off. Triage's output is *purely additive*:
a flag *requests an extra* capable review of a slice the critic's sampling might not have reached this cycle.
Two consequences fall straight out of the invariant, and they are the safety argument:

- **A triage FALSE NEGATIVE (missed smell) can never reduce coverage below today's baseline** — because today's
  baseline (the critic's cadence + the auto-accept floor) is untouched. Triage failing to flag a bad slice
  leaves coverage exactly where 0022 left it; it does not *subtract*.
- **A triage FALSE POSITIVE costs at most one extra capable review** — the capable critic reads the flagged
  diff, dismisses it, moves on. The downside of over-flagging is bounded by one big-model diff-read (cheap, by
  0022's verify-in-one-pass economics), never a wrong merge or a blocked release.

Because the worst case of a fast, imperfect triage model is "one wasted capable review" and the best case is
"caught a smell the mechanical signals couldn't see," triage is **strictly non-negative** for coverage. That
asymmetry is why the lane is safe to run with a cheap, uncalibrated model.

### 2. The triage verdict shape — reuse `verdict`, result `concerns`/`pass`, FROM a distinct `triage` identity

No new result vocabulary and no new kind. A triage pass emits a **`verdict` tic** (0021/0022) **FROM `triage`**:

- **`concerns`** — the diff has a smell (§4); **flag it for a capable review.** The orchestrator/critic reads the
  flagged diff and either **confirms** (escalate to a 0022 draft review — accept/edit/reject) or **dismisses**.
- **`pass`** — no smell found; no flag. (Not a green light to skip the critic's sampling — see §1; `pass` only
  means "triage adds no request this slice.")

**The FROM identity is a distinct role name, `triage`, chosen precisely because `tics gate` ignores it.** Per the
verified claim above, `ticsGate` reads verdicts only from `product-owner` / `tdd-critic` / `qa-verifier`; a
`from: triage` verdict is invisible to the release gate. A `concerns` from triage therefore **flags for review
without ever blocking a release** — the whole reason for the distinct identity (an unrefereed fast-model opinion
must not gate releases — 0009). Reusing `product-owner`/`tdd-critic`'s existing `concerns` result keeps the
vocabulary at four results total (pass/concerns/accept/edit/reject already on the bus) — no new result word.

### 3. Config — `MODEL_TRIAGE`, absent → lane OFF

Lane A is gated by **`MODEL_TRIAGE` in `tdd.config`** (a fast tier, e.g. the same tier as `MODEL_IMPLEMENTER`):

- **Set** → the orchestrator spawns the triage reviewer on that tier for the first-pass diff read.
- **Absent** → **the lane is off; zero behavior change.** No triage spawn, no triage verdicts, and the loop is
  exactly 0022's single-stream review. (Degrade-safe by construction, like `MODEL_<ROLE>` in 0010.)

Like every `MODEL_<ROLE>`, this is a convention the orchestrator reads, not a gate the hooks enforce — the hooks
never see the spawn (0010/0022.6).

### 4. What triage looks for — the checklist (test-shaped smells the mechanical signals can't see)

The mechanical confidence signals (§0022.3 — first-try green, ≲80 lines, in-scope files, no test edits) are
**line-count and file-scope** checks; they are blind to what a diff *says*. Triage reads the diff for the
**test-shaped smells** those signals miss:

- **Hardcoded returns** — a function that returns a literal matching the one asserted value rather than computing
  it (green-by-cheating; the classic "faked green" the critic hunts).
- **Weakened assertions** — an assertion loosened, deleted, or turned tautological to make a slice pass.
- **Out-of-slice creep** — edits that are technically in-scope by file but drift beyond the slice's brief
  (scope-by-file passes; scope-by-intent doesn't).
- **Suspicious deletions** — removed tests, removed edge-case branches, or removed guards that quietly shrink
  what the suite proves.

These are exactly the over-build / test-quality smells `tdd-critic` audits (§0022 mitigation 1); triage is a
*cheap first pass* over the same checklist, widening how often a diff gets *any* smell-read — never replacing the
critic's authoritative audit.

### 5. Telemetry — the triage PRECISION tally (tune `MODEL_TRIAGE` on it)

Every triage `concerns` flag is later **CONFIRMED or DISMISSED** by the capable critic (§2). The ratio
**confirmed / (confirmed + dismissed)** is the **triage precision** — the honest record of whether the cheap
model is flagging real smells or crying wolf, and the lever for tuning `MODEL_TRIAGE` (0022's acceptance-data
principle applied to the review side). Low precision (mostly dismissed flags) → the tier is too weak, re-tier;
high precision → the cheap model is earning its keep. Like the 0022 roster column, this is a **read-side fold
over `verdict` tics already on the bus** (triage `concerns` verdicts + the critic's confirm/dismiss follow-ups)
— no new write path, no new kind. Whether it surfaces as a roster column, a `tics` sub-view, or a manual read is
a build-time call left to the greenlight; the ADR fixes only *what is measured* (precision) and *that it reads
verdicts already emitted*.

### Lane B — PARALLEL SPECULATIVE SLICES

### 6. Concurrent fast-tier drafts in worktrees, batch-reviewed serially by the capable model

Independent slices are **drafted CONCURRENTLY** by fast-tier implementers in **separate git worktrees** (0015 —
git isolates, the bus observes), and the **capable orchestrator BATCH-REVIEWS the diffs serially** (each still a
0022 draft review, or auto-accepted per 0022's four signals). This is DSpark's parallel drafting at the agent
level: pay the draft cost concurrently, verify serially, keep the capable model on the cheap side (reading).

**Preconditions — ALL must hold before any worktree is spawned:**

1. **Slices provably independent** — disjoint files. Use the plan's layer/scope tags to partition, then run
   **`tics fan-out <partition-spec>`** (the verified command, §Context) — it must print "All partitions disjoint
   — safe to fan out" (`return 0`). Any `[OVERLAP]` → the slices are NOT independent; serialize them or split
   the file (fix the seam) before fanning out.
2. **Each worktree runs its own gate/suite** — the phase×layer gate + hook-signed suite green (0009) is the
   per-slice mechanical floor, independently, in each worktree. A slice is not "drafted" until its own worktree
   is green.
3. **One shared spool bus** — `TIC_STORE=spool` with `TICS_DIR` at the git-common-dir (0015), so all worktrees'
   drafts, greens, and reviews land on one bus the capable model reads.

**The batch-review protocol:**

- **Merge order = plan order.** Slices merge in the plan's declared order, deterministically.
- **Each draft is reviewed BEFORE its merge** — reviewed per 0022 (accept/edit/reject) or auto-accepted per
  0022's four confidence signals. **Review-then-merge**, never merge-then-review (alternative (c), rejected).
- **A rejected slice does not block the others** — lossless per-slice rejection (0022.2) at project scale: keep
  every accepted slice, re-draft only the rejected one. The parallel batch degrades to "one slice re-drafted,"
  never "the batch redone."
- **A merge conflict is an automatic review trigger** — a **fifth confidence signal specific to this lane**
  (extending 0022.3's four). A slice that was auto-accept-eligible loses that status the moment its merge
  conflicts: a conflict means the disjointness assumption was violated in practice (files the plan called
  independent weren't), so the capable model MUST read it. Conflict → mandatory review, regardless of the other
  four signals.

**The red-storm race variant.** On a **stuck slice** (a red streak that won't go green — 0022's mandatory-review
trigger, escalated), **race 2–3 fast-tier drafts of ALTERNATIVE approaches** in parallel worktrees. **First green
+ accepted review wins**; the **losers are discarded WITHOUT review** — their cost was the point of racing (you
bought a working approach with wasted concurrent draft cost, exactly as DSpark spends draft compute it may throw
away). Discarding losers un-reviewed is *not* a coverage gap: only the winner merges, and the winner gets the
normal 0022 review.

**Cost honesty (stated plainly, per 0022's cost-honesty posture).** **N worktrees = N suites running
concurrently.** The win is **wall-clock latency** (slices drafted in parallel instead of in series), **NOT
tokens** — the draft tokens are spent regardless, and the race variant spends *extra* tokens on discarded
losers. Lane B trades compute for latency; run it when latency is the constraint (a long independent-slice
queue, a deadline), not to save tokens.

**Telemetry.** Per-slice accept/edit/reject flows into the **existing `drafts a/e/r` roster tally UNCHANGED**
(§0022.5; verified — `ticsRoster` folds `verdict` results by `to` role, source-agnostic to whether the draft was
serial or parallel). Parallel drafting needs no new telemetry: the roster already records what it needs to.

### 7. Both lanes: convention-not-hook, no new tic kinds, no gate changes (inherits 0010/0017/0022)

Neither lane adds a hook, a tic kind, or a gate change. **Lane A** reuses `verdict`/`concerns`/`pass` from a
`from: triage` identity the gate already ignores. **Lane B** reuses `verdict`/accept/edit/reject, the `tics
fan-out` disjointness command, the worktree + spool bus (0015), and the phase×layer gate per worktree — all
already built. The **judgment stays the orchestrator's** (which slices are independent; which diffs to review;
when to race; when to fan out under a deadline); the **mechanical floor is already enforced** per worktree. We
surface and record (the triage precision fold, the unchanged roster tally); we do not fake a gate we cannot
build. **The honesty is the moat** (0022.6).

## Consequences

- **Review coverage widens without narrowing (Lane A).** Every slice the auto-accept lane would wave through now
  gets a cheap smell-read; the capable critic's cadence is untouched, so coverage is **monotonically ≥ 0022's**.
  The 0022 risk ("auto-accepted mediocre-but-green code accumulates") is mitigated further: a cheap first pass
  catches test-shaped smells before they accumulate, and the triage-precision tally makes a weak triage model
  visible rather than silently useless.
- **Wall-clock latency drops on independent-slice batches (Lane B)** — the fast tier drafts N slices
  concurrently; the capable model reads N diffs serially (cheap). The capable model's context stays shallow
  (diffs, not code-writing), holding more of the epic, exactly as in 0022 but now across a batch.
- **Rejection stays lossless at scale.** A rejected slice re-drafts alone (Lane B); a discarded race-loser costs
  only its wasted draft tokens (the red-storm variant). No revert war, no batch redo.
- **Cost is honestly a trade, not a saving (Lane B).** N suites run; the race variant burns discarded losers.
  The win is latency; the ADR says so and gates the lane on the navigator's latency-vs-token judgment (0022's
  budget-scheduling call).
- **The risk, stated honestly.** (Lane A) A cheap triage model with **low precision** floods the capable critic
  with false-positive flags — bounded to "one extra capable review each" by §1, but a persistently noisy tier
  wastes real attention; the **precision tally** (§5) is the visible re-tier signal. (Lane B) A **wrong
  disjointness call** (files the plan called independent but weren't) surfaces as a merge conflict — caught by
  the fifth confidence signal (mandatory review on conflict, §6) and, at runtime, by auto-claim (0015); the
  precondition `tics fan-out` gate (§6) catches it at plan time before either fires.
- **Invariants upheld:** **zero new runtime deps**; **no new tic kind** (reuses `verdict`); **no new bus field**
  (triage precision + the roster tally are read-side folds over verdicts already emitted); **no gate change**
  (verified — the release gate's role list is untouched, and `from: triage` is outside it); **degrade-safe**
  (`MODEL_TRIAGE` absent → Lane A off; no fan-out → Lane B never engages; both collapse to 0022's single stream);
  **`kit/` authoritative** — both lanes' guidance lands in the orchestrator protocol's canonical homes
  (CLAUDE.md delegation section, `docs/tdd/outer-loop.md`, `docs/tdd/divide-and-conquer.md` for the parallel
  lane), the homes 0010/0022 use.

## Out of scope (explicitly rejected or deferred)

- **REJECTED: auto-model-selection.** Neither the triage-precision tally (Lane A §5) nor the `drafts a/e/r`
  roster (Lane B) feeds an automatic re-tiering loop. They are **signals for navigator judgment** — the lever is
  the navigator setting `MODEL_TRIAGE` / `MODEL_<ROLE>`, not automation reading the tally and re-tiering. (Same
  deferral 0022 and 0010 made; a future ADR with its own contract if ever.)
- **REJECTED: triage REPLACING the critic.** Triage is a *cheap first pass that flags for* the capable critic; it
  is not the authoritative audit and its cadence-monotonicity invariant (§1) is meaningless if it were allowed to
  *substitute* for the critic's sampling. The critic remains the verifier-of-record for over-build / test-quality
  (0022 alternative (c) — a second LLM replacing the critic — stays rejected).
- **REJECTED / DEFERRED: parallel drafting of DEPENDENT slices.** Lane B fans out **only provably-disjoint**
  slices (the `tics fan-out` gate, §6). Dependent slices — where slice B's spec depends on slice A's
  implementation — must be serialized (0022's single stream). Speculatively drafting B against an
  unfinished/unreviewed A would make rejection a revert war (the merge-first failure alternative (c) forbids),
  and is out of scope here.
- **DEFERRED: the exact surfacing of the triage-precision tally** (roster column vs sub-view vs manual read) — a
  build-time call on the greenlight; the ADR fixes only *what* is measured and that it reads existing verdicts.

## Alternatives considered

- **(a) Run the capable critic on EVERY slice (no triage lane).** Rejected — it burns the capable model's
  attention on obviously-fine drafts, which is the exact cost the auto-accept lane (0022.3) exists to avoid.
  **The triage lane exists precisely to widen coverage WITHOUT this burn:** a cheap model reads every diff and
  the capable model is spent only on flagged ones. Capable-on-every-slice re-introduces the cost 0022 already
  ruled out; triage is the confidence-gated middle path (DSpark's confidence head, not target-verifies-all).
- **(b) Let triage verdicts feed the release gate.** Rejected — **an unrefereed fast-model opinion must not gate
  releases** (0009). A cheap, uncalibrated triage model producing a `concerns` that *blocks a release* would let
  a false positive from the weakest model in the fleet stop a ship. The distinct `from: triage` identity (§2),
  verified invisible to `ticsGate` (§Context), is the mechanical guarantee this never happens: triage flags for
  *review*, only `product-owner` / `tdd-critic` / `qa-verifier` gate the *release*.
- **(c) Speculative MERGE-then-review for the parallel lane.** Rejected — merging a draft before reviewing it
  makes rejection a **revert war**: an unaccepted slice is already in the tree, and backing it out risks
  entangling later merges. **Review-then-merge keeps rejection lossless** (0022.2): a rejected slice never
  entered the tree, so re-drafting it disturbs nothing. Merge-first trades the losslessness that makes
  speculative delegation cheap in the first place. (Merge conflicts are handled as a review *trigger* under
  review-then-merge — §6 — not as a merge-first revert.)
