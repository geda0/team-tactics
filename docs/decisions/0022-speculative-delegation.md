# 0022 — Speculative delegation: the draft/verify loop (the VERIFY side ADR 0010 left open) — a fast-tier draft, a FREE mechanical verify, then a confidence-gated big-model diff review

- **Status:** **Accepted** — shipped **v0.67.0**. The one mechanical piece (the per-role acceptance column on
  `tics roster`, a read-side fold over draft-review `verdict` tics) was built red→green through the phase×layer
  gate alongside this ADR; the rest — the loop, the lanes, the budget call — is orchestrator convention, backed
  by docs + the existing bus, gated by nothing (§6). No new tic kind, no new bus field, no new hook.
- **Date:** 2026-07-04
- **Deciders:** navigator (the shape asked for by name — "offload tasks to faster models to get things done
  fast, and the larger model accepts/rejects/edits"; the confidence-gate framing that mechanical bus signals,
  not a model, decide WHEN a full review is warranted; the budget-aware scheduling call is the
  navigator/orchestrator's, like DSpark's load scheduler), architect (the mapping onto team-tactics's edge over
  DSpark — a FREE mechanical verifier, the phase×layer gate + hook-signed suite green, runs BEFORE any model
  spends tokens verifying; the lossless-rejection-per-SLICE contract; the auto-accept lane's signal set drawn
  entirely from the bus + `git diff`; convention-not-hook per 0010's load-bearing truth), product-owner (the
  acceptance-telemetry framing — draft-review verdicts fold into `tics roster` as the honest per-role record the
  navigator tunes `MODEL_<ROLE>` against, DSpark tuning its drafter on acceptance rate).
- **Relates to:** **directly extends 0010 (capability-aware execution)** — 0010 built the DRAFT side (the
  `MODEL_<ROLE>` tiering; the implementer is the safe tier-down because the failing test IS the spec; slice
  granularity scaled to the model = DSpark's small blocks against suffix decay); this ADR builds the VERIFY side
  0010 left open, reusing its vocabulary wholesale (`coarse`/`fine`, "spend capability where judgment lives",
  "never tier down the test-writer"). Builds on **0009 (the honest gate)** — the hook-signed suite green is the
  trusted mechanical floor under EVERY lane; a review verdict is self-reported judgment ON TOP, never a
  substitute. Inherits **0017 (judgment gates stay mechanical / opt-in-conventional)** — the review is judgment,
  so it is convention, not a gate. Sits on **0020 (discipline is a directive)** — the draft/verify loop is
  directed, not enforced. **Reuses the `verdict` kind from 0021** (browser-QA smoke verdict) — the exact same
  self-reported verdict-tic vocabulary (`from`, `to`, `result`), read newest-per-target, no new kind.
  **Supersedes nothing** (it is purely additive to 0010; 0010's DRAFT-side decisions stand unchanged).

## Context

DeepSeek's **DSpark** (June 27, 2026 — "Confidence-Scheduled Speculative Decoding with Semi-Autoregressive
Generation") gives the loop a name for a shape it was half-built for. In DSpark: a small **draft** module
proposes a ~5-token block; the big **target** model **verifies the whole block in ONE forward pass**
(verification ≪ generation — reading is cheap, writing is dear); a calibrated **confidence head** scores which
drafts will survive, so verification budget is spent only where it is warranted (acceptance climbs
45.7%→95.7% on chat once low-confidence drafts are filtered out); a **load-aware scheduler** trims the verify
budget under pressure; and **rejection is LOSSLESS** — accept the longest valid prefix, the target regenerates
only the tail. Per-user speedups 57–85%, output **identical** to the big model alone.

**The mapping.** ADR 0010 already built the DRAFT side at the AGENT level: `MODEL_<ROLE>` tiers a fast model
onto the constrained role (the implementer — the failing test is the spec, so it is the safe tier-down, NOT the
test-writer), and slice granularity (`coarse`/`fine`) sizes the block to the executing model exactly as DSpark
sizes its block against suffix decay. What 0010 left open is the **VERIFY side**: after the fast-tier draft
lands, who reads it, and when is that reading worth the capable model's attention?

**team-tactics has an edge DSpark lacks: a FREE mechanical verifier.** DSpark's target model must forward-pass
every draft block to verify it. team-tactics has a verifier that costs **zero model tokens** and runs before any
model spends a thing — the **phase×layer gate + the hook-signed suite green** (0009). The verification pipeline
is therefore three-staged, cheapest-first:

> **draft (fast model) → mechanical verify (the suite — free, hook-signed) → confidence-gated big-model diff review.**

The suite is the floor under everything. The big-model review sits on top, and — this is the DSpark move — it is
spent only where the mechanical signals say it is warranted, because **reading a diff is far cheaper than
writing the code** (DSpark's verify-in-one-pass economics, at the agent level: the orchestrator reads a diff, it
does not re-derive the slice). This ADR captures and locks the loop; it does not re-derive it.

## Decision

Add **speculative delegation** — the draft/verify loop — as a new orchestrator convention extending 0010's
draft side. Six sub-decisions.

### 1. The draft/verify loop — accept | edit | reject, as a `verdict` tic

After a fast-tier draft goes green (the mechanical verify passed — the suite is the floor), the **orchestrator**
(the capable model) **reviews the DIFF**, not the code-writing task. Reading a diff is the agent-level analog of
DSpark verifying a block in one pass: far cheaper than the generation it checks. The review resolves to **three
outcomes**, emitted as a **`verdict` tic FROM the orchestrator TO the drafting role** (the 0021 vocabulary,
reused verbatim — no new kind), with an explicit `result`:

- **`accept`** — the draft stands; the slice is done.
- **`edit`** — the orchestrator fixes small issues **inline**, in the **refactor phase** (the capable model
  spends a little writing where the draft was close-but-imperfect; DSpark's "regenerate only the tail").
- **`reject`** — the draft is not salvageable inline: **re-delegate with a sharper brief**, or the orchestrator
  **takes the slice itself**.

The verdict is self-reported judgment (0009) read newest-per-target, exactly as any reviewer verdict in
`tics log`/`cycle`. It never gates; the suite already did the gating.

### 2. Lossless rejection — reject the SLICE, never the run

Rejection is **lossless in the DSpark sense**: reject the **slice**, not the run. Keep everything already
accepted — **the longest valid prefix** — and redo **only** the rejected slice. There is **never a full redo**.
This is the direct agent-level image of DSpark accepting the longest valid prefix and regenerating only the
tail, and it is why speculative delegation is cheap: a bad draft costs one slice, not the epic.

### 3. Confidence-gated review — mechanical bus signals decide WHEN a full review is warranted (the confidence-head analog)

DSpark's confidence head scores which drafts merit verification; team-tactics's confidence head is **already on
the bus** — no model, no new mechanism. Two lanes:

- **AUTO-ACCEPT lane** (skip the per-slice diff review — the hook-signed green is the floor, and `tdd-critic`
  keeps SAMPLING every few cycles exactly as today) when **ALL** hold:
  1. **first-try green** — no red-streak on the slice (the draft passed the mechanical verify on the first go);
  2. **small diff** — ≲80 lines;
  3. **only in-scope files touched**;
  4. **no test-file edits by the implementer** (the implementer does not author the spec — 0010).
- **MANDATORY review** when **ANY** of the four fail.

Every one of these signals is **observable from what's already there** — `signal`/`block` tics and the
red-streak on the bus, plus `git diff`. No confidence model, no new emitter, no new field. The mechanical floor
scores the draft; the capable model is spent only above the line.

### 4. Budget-aware scheduling — the load-scheduler analog

Under **time/cost pressure** (parallel fan-out, long queues), review **only low-confidence slices** (trim the
verify budget to where it matters most); **relaxed** → review everything. This is the
**navigator/orchestrator's judgment call**, precisely as DSpark's scheduler trims the verify budget under load.
It is a call, not a knob — the orchestrator reads the queue and decides.

### 5. Acceptance telemetry — draft-review verdicts fold into `tics roster` (the ONE mechanical piece)

DSpark tunes its drafter on **acceptance rate**; the navigator tunes `MODEL_<ROLE>` (0010) the same way. So the
draft-review verdicts (`to=<role>`, `result=accept`/`edit`/`reject`) **fold into `tics roster` as a per-role
acceptance column** — the honest record of how often each role's drafts are accepted as-is vs edited vs rejected.
A role whose drafts are chronically rejected is a **visible signal to re-tier** (0010's `MODEL_<ROLE>` is the
lever); a role at high accept rate confirms the tier is right. This is a **read-side fold over `verdict` tics**
— the 0004/0008/0009/0019 projection pattern — and is **the one mechanical increment**, built red→green through
the gate alongside this ADR. It adds no write path and no new kind; it reads verdicts already on the bus.

### 6. Convention, not a hook (inherits 0010's load-bearing truth)

The whole loop is an **orchestrator convention**, and that is the honest ceiling — the same posture 0010 locked
for the draft side. **The hooks never see the spawn, and they never see the diff review.** A PreToolUse "review
gate" hook would be theater: there is no seam on "the orchestrator read a diff and decided accept/edit/reject,"
just as 0010 established there is no seam on "the orchestrator spawned model X." The **judgment stays the
orchestrator's**; the **mechanical floor is already enforced** — the phase×layer gate + the hook-signed suite
green (0009) run under every lane, refereeing edits, re-running the suite, forbidding a finish on red. We surface
and record (the roster column); we do not fake a gate we cannot build. **The honesty is the moat.**

## Consequences

- **Throughput up.** The fast tier drafts; the capable model **reads diffs instead of writing code** — the
  DSpark verify-in-one-pass economics at the agent level. The capable model's context stays **shallow** (diffs,
  not code-writing), which is itself a saving: it holds more of the epic because it isn't spending attention
  generating each slice.
- **Review cost is bounded by the auto-accept lane.** The capable model's attention is spent only on
  low-confidence slices (§3); a stream of first-try-green, small, in-scope drafts flows through without a
  per-slice review, with `tdd-critic`'s sampling cadence as the standing backstop.
- **Rejection is cheap** (§2) — a bad draft costs one slice, never the run; the longest valid prefix is kept.
- **The risk, stated honestly: auto-accepted mediocre-but-green code can accumulate.** The suite catches
  regressions, **not** mediocrity or drift — green ≠ well-designed (the 0009 honest-gate lesson). Mitigations,
  all already present: (1) **`tdd-critic`'s sampling cadence** (the over-build / test-quality audit keeps
  sampling every few cycles, auto-accept lane or not); (2) **acceptance telemetry** (§5) makes a **low-quality
  drafter visible** as a poor accept rate, so the mediocrity surfaces in the roster rather than hiding; (3) the
  review verdict is **self-reported** (0009) — it is judgment on top of the floor, **never a substitute for the
  suite**.
- **Invariants upheld:** **zero new runtime deps**; **no new tic kind** (reuses `verdict` from 0021) and **no
  new bus field** (the roster column is a read-side fold over verdicts already emitted); **degrade-safe** (a run
  with no draft-review verdicts → an empty acceptance column, never an error; the loop is entirely opt-in
  orchestrator behavior); **no change to the phase×layer gate, run-suite, or the honest-gate floor** — the
  hooks' edit/stop/gate referee is untouched (§6). **`kit/` authoritative** — the loop's guidance lands in the
  orchestrator protocol's canonical homes (CLAUDE.md delegation section, `docs/tdd/outer-loop.md`), the same
  homes 0010's tiering guidance uses.

## Out of scope (explicitly rejected or deferred)

- **REJECTED: a PreToolUse "review gate" hook.** No seam exists — the hooks never see the diff review, exactly
  as 0010 established they never see the spawn. A hook claiming to gate it would be theater (§6, 0010, 0017).
- **REJECTED: auto-selecting models by measured acceptance rate.** The acceptance column (§5) is a **signal for
  navigator judgment**, not an input to an automatic re-tiering loop. Adaptive-from-telemetry model selection is
  the navigator's call, not automation — consistent with 0010's own deferral of "adaptive slice-sizing from
  telemetry" to a future ADR with its own contract.
- **REJECTED: per-token / streaming verification.** DSpark verifies token blocks; agents draft **slices**, not
  tokens. The unit of speculative delegation is the red→green slice (0010's `coarse`/`fine`), and the verify
  unit is the diff of that slice — not a token stream.
- **REJECTED: changing the test-writer tier.** 0010 locked it and this ADR does not reopen it — **never tier
  down the judgment roles.** Speculative delegation drafts the CONSTRAINED role (the implementer, whose
  correctness the referee checks); it does not touch the roles that author the spec / contract / audit.

## Alternatives considered

- **(a) Review every slice unconditionally.** Rejected — it burns the capable model's attention on
  obviously-fine drafts (first-try-green, small, in-scope). DSpark's entire point is **confidence-gated**
  verification: spend the verifier only where it is warranted. The auto-accept lane (§3) is that gate.
- **(b) Auto-accept everything that goes green.** Rejected — the suite catches **regressions, not mediocrity or
  drift**. Green ≠ well-designed (the 0009 honest-gate lesson). The mandatory-review lane (§3) and `tdd-critic`'s
  sampling exist precisely because a green suite is a floor, not a ceiling.
- **(c) A second LLM as verifier-of-record, replacing the critic.** Rejected — it adds cost, **duplicates the
  `tdd-critic`** (which already audits over-build / test-quality and already samples every few cycles), and
  invents a parallel authority where one already exists. The orchestrator's diff review + the critic's sampling
  cover it without a new standing verifier role.
- **(d) Enforce the loop via a hook.** Rejected per 0010 and 0017 — the judgment is the orchestrator's, the
  hooks never see the spawn or the diff, and a gate that claims to referee judgment it cannot observe is
  dishonest. Convention + the existing mechanical floor is the honest ceiling (§6).
