# 0010 — Capability-aware execution (model tiering per role + slice granularity scaled to the model)

- Status: **Proposed** (a design for future work — NOT yet built; nothing here ships until
  an epic implements it)
- Date: 2026-06-16
- Deciders: navigator (the brainstorm: spend capability where JUDGMENT lives, economize
  where the task is CONSTRAINED; safe-to-tier-down is the IMPLEMENTER, not the test-writer;
  resize "a behavior" to the model, never batch failing behaviors), architect (the config
  shape + the orchestrator-convention-not-hook-gate framing + the attestation-granularity
  floor on "coarse")
- Relates to: 0005 (full-team by default — the same nudge-and-record family) and 0006 (the
  solo-drift backstop: detection, not enforcement, when the lever is the orchestrator's
  behavior, which the bash hooks cannot gate). Builds on 0001 (the gate is a referee inside
  CC; it referees EDITS, it does not spawn agents). Cross-references 0009 (the honest gate /
  attestation): the slice-granularity floor below protects the per-behavior red-before-green
  provenance 0009 makes count. Supersedes nothing.

## Context

A navigator brainstorm surfaced two related capability-matching mechanisms. This ADR
captures and locks them; it does not re-derive them.

The governing principle inverts the naive "a more capable model can do more, so give it more
tests":

> **Spend capability where JUDGMENT lives; economize where the task is CONSTRAINED.**

Map that onto the loop's roles:

- **Judgment-heavy → capable model.** **test-writer** (what to assert, the negatives, the
  edge cases — the spec is being *authored* here), **architect** (the contract/seam — the
  shape both sides build to), **tdd-critic** (the over-build / test-quality audit),
  **product-owner** (prioritization + acceptance). These roles *decide what is correct*; a
  weak model here produces a weak spec, a leaky contract, or a missed over-build, and the
  error propagates.
- **Constrained → cheap/fast model.** **implementer** (minimal green). The failing test IS
  the spec; the task is "make exactly this red go green with the least code." A constrained
  task is precisely where a cheaper model can succeed, because correctness is *checked by the
  referee*, not *judged by the model*. **The safe-to-tier-down role is the IMPLEMENTER, NOT
  the test-writer** — tiering down the test-writer would economize on the very judgment the
  principle says to protect.

The second mechanism follows from the first: **slice granularity should scale to the
executing model.** A capable model can take a COARSER behavior-slice (a whole behavior plus
its edge cases / negatives in one red→green); a cheap/fast model gets a FINER slice (one
narrow assertion per red→green). The slice is sized to who is executing it.

### The load-bearing architectural truth

Both mechanisms are **orchestrator-level conventions**, and that is the honest ceiling on
their enforcement:

- The **orchestrator is an agent.** It is the thing that spawns subagents (picks which model
  executes a role) and sizes the slice it hands to test-writer / implementer.
- The **bash hooks do NOT spawn agents.** They referee *edits* (phase × layer), re-run the
  suite, and read/append the bus. They have no visibility into, and no control over, which
  model the orchestrator chose or how big a slice it cut. There is no PreToolUse seam on
  "spawn a subagent with model X" that a hook could gate.

Therefore this **cannot be hook-enforced**, and we will not pretend otherwise. The honest
design is exactly the family of ADR 0005/0006 and the prompt-directive: **config defaults +
documented orchestrator guidance + (optional) observability — nudge and record, never gate.**
We explicitly do **not** design a hook that "enforces" model choice or slice size; such a
hook is not possible (the hooks never see the spawn), and shipping one that claims to would
be dishonest. **The honesty is the moat** (ADR 0006): we record what actually happened and
make the convention visible; we do not fake a gate we cannot build.

## Decision

### 1. Config shape — `MODEL_<ROLE>` in `tdd.config` (orchestrator-consumed)

Per-role model selection is configured with keys of the form **`MODEL_<ROLE>`** in
`tdd.config`, where `<ROLE>` is the role name **uppercased with hyphens mapped to
underscores** — because role names contain hyphens (`test-writer`) but config keys must be
valid shell identifiers, and the existing knobs are all-caps (`SOLO_DRIFT_CYCLES`,
`ATTEST_ENFORCE`, `CLAIMS_TTL`). The locked mapping:

| role | key |
|---|---|
| test-writer | `MODEL_TEST_WRITER` |
| implementer | `MODEL_IMPLEMENTER` |
| architect | `MODEL_ARCHITECT` |
| tdd-critic | `MODEL_TDD_CRITIC` |
| product-owner | `MODEL_PRODUCT_OWNER` |
| qa-verifier | `MODEL_QA_VERIFIER` |
| project-manager | `MODEL_PROJECT_MANAGER` |
| dev-ops | `MODEL_DEV_OPS` |

- **Value** = a model identifier — a free-form string the orchestrator passes through to its
  spawn (e.g. its Task-tool model parameter). team-tactics does not interpret or validate the
  string; it is opaque pass-through, so the knob never needs to know the host's model catalog.
- **Read path = the ORCHESTRATOR (an agent reading `tdd.config`), not a hook.** This is the
  load-bearing distinction from every other knob in `tdd.config`: `ATTEST_ENFORCE`,
  `CLAIMS_TTL`, etc. are read by hooks (shell `:-` or Node `cfgNum`) *at edit/stop/gate time*.
  `MODEL_<ROLE>` is read by the orchestrator *at spawn time*, because the spawn is the
  orchestrator's act, not a hook's. The ADR states this plainly so no one later tries to wire
  a hook to it.
- **Default-safe (zero change to today's behavior).** An **absent** `MODEL_<ROLE>` → the
  orchestrator uses its default model for that role (exactly today's behavior). No key set →
  the framework behaves identically to before this ADR. Degrade-safe is the default.
- **If a value is ever read programmatically** (e.g. a future observability surface that
  parses `tdd.config`), it MUST use the F1 line-anchored parse — the same `^\s*KEY\s*=`
  regex `cfgNum` uses (`tics-view.cjs:250`) — so a **commented example reads as absent
  (inactive)**, never as an accidentally-active default. The commented `MODEL_*` examples in
  the `tdd.config` template are therefore inert until uncommented.

### 2. Documented defaults — the recommended tiering, where the orchestrator will honor it

The recommended tiering (the brainstorm's principle, made concrete):

- **Capable model:** `test-writer`, `architect`, `tdd-critic`, `product-owner`.
- **Cheap/fast model:** `implementer`.
- Other outer-loop roles (`qa-verifier`, `project-manager`, `dev-ops`) default to the
  orchestrator's default model; an adopter may tier them per the same principle (qa-verifier
  leans judgment; dev-ops/project-manager lean constrained), but this ADR does not mandate a
  default for them.

Because the lever is the orchestrator's behavior, the defaults must live where the
orchestrator actually reads its operating rules — in THREE places, kept consistent:

1. **CLAUDE.md orchestrator protocol** — a one-line rule in the delegation section: spend
   capability where judgment lives; tier the implementer down, never the test-writer; honor
   `MODEL_<ROLE>` from `tdd.config` when set.
2. **`docs/tdd/outer-loop.md` (the full-team kit copy at
   `packages/team-tactics/kit/presets/full-team/docs/outer-loop.md`)** — a brief note in the
   loop's BUILD/role guidance restating the principle and the `MODEL_<ROLE>` knob.
3. **Commented `MODEL_*` examples in the `tdd.config` template** (the kit copy at
   `packages/tdd/kit/tdd.config`) — alongside the other commented knobs, with the
   recommended tiering shown as comments (inactive until uncommented).

These three are where a future implementing epic writes the guidance; this ADR records that
they are the canonical homes. (The `kit/` copies are authoritative; the installed `.claude/`
re-derives on the next dogfood install — invariant: "kit is the single source of truth".)

### 3. Slice-granularity contract — two tiers, one preserved invariant

Define a closed two-value vocabulary for the size of a red→green slice, picked by the
planner/orchestrator from the EXECUTING model's capability:

- **`coarse`** — one **whole behavior including its negatives / edge cases**, taken in a
  single red→green→(refactor). For a capable executor (whose judgment can hold the whole
  behavior in one cycle).
- **`fine`** — one **narrow assertion (one cell)** per red→green→(refactor). For a cheap/fast
  executor, where a tightly-scoped task is what lets a cheaper model succeed.

The orchestrator picks the tier from the model it is about to spawn for the slice (capable →
`coarse`; cheap/fast → `fine`). The slice is sized to the executor.

**THE LOCKED INVARIANT (the whole point — both tiers obey it):**

> **One failing BEHAVIOR per red→green, and a red-before-green trail per behavior — at BOTH
> tiers.** You resize *what counts as "a behavior"* to the model; you do **NOT** relax
> "one failing behavior per red."

Precisely:

- **`coarse` is NOT "many failing behaviors batched."** A coarse slice is still **one**
  behavior; its edge cases / negatives are facets of that single behavior, exercised within
  the one red→green. It is emphatically not "write N red tests across N behaviors, then one
  big-bang implementation." That is rejected in Out of scope below — it breaks minimal-green
  and erodes attestation granularity.
- **`fine` is the floor, not a different rule** — it is the same invariant at its smallest:
  one assertion is one (sub-)behavior, one red, one green.
- **The red-before-green trail per behavior is preserved at both tiers.** Each behavior still
  produces a red, then a green — so the per-behavior provenance that ADR 0009 (the honest
  gate / attestation) classifies, and that any future evidence-gated-greens / red-before-green
  replay work would prove, stays at behavior granularity. **Coarse must not coarsen so far
  that a single green attests to a tangle of behaviors that the bus can no longer tell apart.**

### 4. The attestation-granularity floor — how coarse is too coarse (the key risk, resolved)

The risk a coarser slice introduces: if "coarse" drifts toward "one giant slice," a single
green signal would stand in for an unbounded pile of behaviors, and the per-behavior
red-before-green provenance ADR 0009 makes count would erode (the future evidence-gated-greens
proof granularity erodes with it). Resolution — the **floor**:

- **A coarse slice is bounded to ONE behavior** (its edge cases are facets of that behavior).
  "One behavior" is the unit at which the red→green→signal trail must remain legible: one
  red, one green, attributable to one behavior. Coarse widens the *content* of a behavior's
  cycle (negatives + edges together) — it never widens the *count* of behaviors a single
  red→green covers.
- **If a "behavior" is too big to express as one honest red (multiple independent failures
  that a reader could not attribute to a single behavior), it is two behaviors — split it,
  regardless of model tier.** The attestation trail's legibility is the floor; model
  capability never licenses crossing it.
- This keeps `coarse` strictly *between* `fine` and the rejected "batch many reds then
  big-bang" — capable-but-still-one-behavior — so the E8/0009 attestation and any future
  evidence-gated-greens proof keep behavior granularity at both tiers.

### 5. Observability (optional) — record the chosen model on the `delegate` tic

**Decision: in scope for E9 as a documented OPTIONAL convention; the implementation is a
follow-on, not required for the config + guidance to ship.**

The honest "record what actually happened" lever: when the orchestrator delegates, it can
record the model it chose for that role on the `delegate` tic, via the **existing EXTRA_JSON
hatch** — the 7th positional arg of `emit_tic` / `tic.sh` (a raw JSON fragment appended to
the envelope, the same hatch `run-suite` uses for `,"exit":N,"durationSec":N`; see
`tics-lib.sh:14,49`). For example:

```
tic.sh orchestrator implementer delegate '<slice>' <id> '' ',"model":"<id>","slice":"fine"'
```

- This is **purely additive** — no new bus field is *required* of any other emitter, no
  envelope schema change; an absent `model`/`slice` on a `delegate` tic is the
  zero-config/old-bus case and must read as "unknown" (degrade-safe), never as a default or
  an error.
- It lets `tics report` / `tics board` surface model-per-role (and, with a host cost source,
  cost-per-role) — the honest record of which model actually ran which role, in the ADR
  0006/0009 spirit of "make what happened visible."
- **In scope = the convention is documented now; the surfacing in `report`/`board` is a
  follow-on increment** (it is a read-side fold over `delegate` tics, exactly the 0008/0009
  pattern). E9's config + orchestrator guidance do not depend on it landing first.

### 6. The honest framing (restated, load-bearing)

`MODEL_<ROLE>`, the documented defaults, the slice tiers, and the optional `delegate`-tic
record are **orchestrator conventions backed by config + docs + (optional) observability** —
the same nudge-and-record posture as full-team-by-default (0005) and the solo-drift backstop
(0006). The bash hooks **do not and cannot** gate model choice or slice size, because they
never see the spawn. We surface and record; we do not fake a gate. The one hard invariant
that the hooks DO still referee is unchanged and untouched: one failing test before green,
no stopping on red (that is an *edit/stop* gate, not a *spawn* gate) — and §3's locked
"one behavior per red, both tiers" rides on top of it as a convention, not as a new hook.

## Resolved contract risks

- **"Coarse" eroding attestation granularity (the headline risk).** Resolved by §3 + §4: a
  coarse slice is bounded to ONE behavior with a preserved red-before-green trail; the floor
  is the legibility of the per-behavior red→green→signal trail (ADR 0009). Capability widens a
  behavior's *content*, never the *count* of behaviors per green. "Batch many reds then
  big-bang" is rejected (Out of scope).
- **Pretending the convention is enforced.** Resolved by §6: stated explicitly as an
  orchestrator convention the hooks cannot gate (no spawn seam). Nudge + record, never gate —
  the 0005/0006 family. No "model-enforcing hook" is designed.
- **A commented `MODEL_*` example accidentally activating.** Resolved by §1: any programmatic
  read uses the F1 line-anchored `^\s*KEY\s*=` parse, so commented examples read as absent;
  and the orchestrator's own read should follow the same "commented ⇒ inactive" rule.
- **Old/zero-config bus or install regressing.** Resolved by §1 + §5: absent `MODEL_<ROLE>`
  → today's default model (zero behavior change); absent `model`/`slice` on a `delegate` tic
  → "unknown", never an error. No migration; the convention is purely additive.
- **Tiering down the wrong role.** Resolved by §1 + §2: the locked principle and defaults put
  capable on test-writer/architect/tdd-critic/product-owner and cheap/fast on implementer;
  the ADR states explicitly that the test-writer is NOT the role to tier down.

## Consequences

- An adopter can spend model budget where judgment lives and economize on the constrained
  implementer, via plain `tdd.config` knobs, with the recommended tiering documented in the
  three canonical homes (§2). Absent config = today's behavior, so nobody's existing run
  changes on update.
- Slice granularity becomes an explicit, two-tier convention (`coarse` / `fine`) scaled to
  the executor, with the one-behavior-per-red invariant preserved at both tiers and an
  attestation-granularity floor that protects ADR 0009's per-behavior provenance and any
  future evidence-gated-greens proof.
- The honest record of which model ran which role is available via the existing EXTRA_JSON
  hatch on the `delegate` tic — no new bus field, a read-side surfacing as a follow-on.
- **No enforcement is added or implied.** This is the 0005/0006 nudge-and-record family; the
  hooks' edit/stop/gate referee is unchanged. The framework's honesty about its own
  enforcement ceiling is preserved.
- Invariants upheld: **zero new runtime deps** (config + docs + one EXTRA_JSON convention,
  all over existing mechanism); **degrade-safe** (no config → today's behavior; absent tic
  fields → "unknown"); **`kit/` authoritative** (the homes in §2 are the kit copies). Nothing
  in this ADR is built yet — Status: Proposed.

## Out of scope (explicitly rejected or deferred for this ADR)

- **REJECTED: "write N failing tests across N behaviors, then one big-bang implementation."**
  This is NOT what `coarse` means and it is rejected: it breaks minimal-green (the
  implementer would build past any single red) and erodes attestation/proof granularity (one
  green could no longer be tied to one behavior's red). `coarse` is one behavior, richer
  content, single red→green (§3, §4).
- **DEFERRED (separate, adjacent): characterization / coverage-batch slicing.** Generating a
  batch of characterization tests over existing untested code (a coverage backfill) is a
  different mode from the red→green behavior slice this ADR sizes. It is a separate idea with
  its own design; not folded in here.
- **DEFERRED (noted future, not this ADR): adaptive slice-sizing from telemetry.** Using the
  observed cycle telemetry / `delegate`-tic model record to *automatically* tune the tier per
  role over time is a plausible later epic. This ADR fixes the two static tiers and the
  manual/orchestrator-judgment pick; an adaptive-from-telemetry sizer is a future contract
  decision with its own ADR.
- **NOT a hook.** No PreToolUse/Stop hook that "enforces" model choice or slice size — the
  hooks never see the spawn; such a gate is impossible and would be dishonest (§6).

## Alternatives considered

- **`MODEL_<role>` with the hyphenated/lowercase role name (`MODEL_test-writer`).** Rejected:
  not a valid shell identifier (hyphen), and inconsistent with every existing all-caps knob.
  Locked the uppercased-underscore form `MODEL_TEST_WRITER` (§1).
- **Tier the test-writer down too (naive "capable agent → more / cheaper everywhere").**
  Rejected by the governing principle: the test-writer authors the spec (judgment); a weak
  spec propagates. The implementer is the safe-to-tier-down role.
- **Make slice size relax "one behavior per red" for capable models.** Rejected: that would
  trade away the loop's core invariant and 0009's per-behavior provenance. `coarse` widens a
  behavior's content, never the count of behaviors per red (§3, §4).
- **A hook that gates model choice / slice size.** Rejected as impossible (no spawn seam in
  the hooks) and dishonest to claim. Config + docs + optional observability is the honest
  ceiling (§6).
- **A new dedicated `model` envelope field on every tic.** Rejected for E9: the EXTRA_JSON
  hatch on the `delegate` tic carries it additively with no schema change and no old-bus
  migration, matching the 0009 "no new bus field" posture.
