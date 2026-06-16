# 0011 — Evidence-gated greens (red-before-green replay: a green is honored only if a hook-signed red preceded it on the same scope)

- Status: **Proposed** (a design contract for future work — NOT yet built; nothing here
  ships until an epic implements it)
- Date: 2026-06-16
- Deciders: navigator (mine Mission Control's `buildProof` through an enforcement lens; bring
  home red-before-green *replay* as a pure local fold, NOT the server / `evidenceRunId` ingest
  API / signing), product-owner (selected E10; FLAG-DEFAULT + opt-in `EVIDENCE_ENFORCE` hard
  block; two independent enforcement dials, not one combined knob), architect (the evidence
  contract, the per-scope read-side fold seam reusing `greenAttestation`, the degrade-safe
  no-false-block floor)
- Relates to: **0009 (the honest gate / attestation)** — E10 is the SEQUENCE half built
  directly on top of E8's PROVENANCE half; it reuses 0009's shipped `greenAttestation` /
  `attestationTally` and its FLAG-default / opt-in-block discipline verbatim. Cross-references
  0010 (capability-aware execution): 0010's slice-granularity floor ("one behavior per red,
  red-before-green trail per behavior, at both tiers") exists precisely to keep the per-behavior
  red→green trail that THIS ADR replays legible — E10 is the consumer that makes that floor
  pay off. Builds on 0001 (the gate is a referee inside CC; outside CC, enforcement is
  honest-not-cryptographic) and 0006 (the honesty is the moat — provenance/sequence, not
  signatures). Supersedes nothing. The Mission Control server idea (E6) stays dropped/stashed;
  this keeps only the read-side replay that was always local.

## Context

### The E8 → E10 progression (one missing tooth)

E8 / ADR 0009 (the honest gate) made the bus's existing PROVENANCE count: a green `signal`
is classified `hook-signed` (`from === "run-suite"`, the CC PostToolUse referee) vs
`self-reported` (a hand-emitted role green per `AGENTS.md`). E8 answers exactly one question:

> **Was this green refereed?** (`hook-signed` vs `self-reported`.)

It does NOT answer a second, orthogonal question that TDD's whole value rests on:

> **Was this green test-FIRST?** Did a failing red precede it — i.e. is this green *proof
> that a previously-failing test now passes*, or did the code arrive first (or the test
> never failed at all) and a green was simply reported?

A green that was refereed but never had a red before it is a green for a test that may have
been written *after* the code, or a test that never failed — not evidence of red→green. E8's
own ADR named this gap explicitly and deferred it: *"the future evidence-gated greens /
red-before-green replay work (proving … that a red preceded the green) is a SEPARATE later
epic with its own contract decision and ADR — explicitly NOT E8"* (0009, Out of scope).
**E10 is that epic.** It is the teeth on top of E8: E8 attests *whether a green was
refereed*; E10 attests *whether it was test-first*, by re-deriving a red-before-green proof
from the signal trail rather than trusting a "done."

### The Mission Control inspiration (mined; design the LOCAL form)

Mission Control's brain reconstructs this proof server-side. `buildProof`
(`../mission-control/packages/brain/src/index.ts` ~L333-382) folds the per-scope signal
stream and yields a verdict that is `pass` **only if a red signal precedes a green for the
same scope**; `app.ts:422` HARD-refuses a green status that lacks evidence and FLAGS
`not-test-first` when the trail does not prove red-before-green.

For team-tactics there is **no server and no new ingest API.** The same proof is a
**pure-local fold over `.claude/state/tics.jsonl`** — because the trail MC reconstructs from
already exists on our bus and is already ground-truthed:

- `run-suite.sh:75` emits **every** suite result as a `signal` tic with **`from=run-suite`**,
  `result=green|red`, an ambient **`scope`** (from `TICS_SCOPE` per-call for fan-out else
  `.claude/state/scope`; `tics-lib.sh:35,49`), a monotonic **`seq`**, and a **`ts`**. That is
  exactly MC's per-scope ordered red/green stream — already on the local bus, no server.
- E8 already shipped the discriminator we need for "is this red/green refereed?":
  `greenAttestation(tic)` and `attestationTally` in `packages/tics/kit/hooks/tics-view.cjs`
  (L263-279). The release gate `ticsGate` (L501) is already attestation-aware after E8 and is
  the natural place to add the sequence check beside the provenance check.

E10 is therefore the same leapfrog E8 was: **the evidence already exists on our bus, and the
consumers just don't replay it.** It is a read-side fold + one opt-in knob — no server, no
new bus field, no crypto.

## Decision

Add a **pure read-side red-before-green replay** over the existing bus in `tics-view.cjs` —
a per-scope fold (`buildProof` analog) that, reusing `greenAttestation`, decides for each
scope whether its latest honored green is preceded by a hook-signed red — and surface
"a green with no red-before-green evidence" on the release gate: FLAG by default, HARD-BLOCK
only under a NEW opt-in `EVIDENCE_ENFORCE` knob (kept independent from E8's `ATTEST_ENFORCE`).
No new bus field, no emit-side change, no server, no crypto. Degrade-safe throughout.

### 1. The evidence contract (the load-bearing definition)

**"Red-before-green evidence" for a scope S:** the latest hook-signed green on S is HONORED
iff a **hook-signed red on S precedes it** by ordering (`seq`, with `ts` as tiebreak — the
same ordering `loadSignalEvents`/`loadTics` already sort by).

Precisely, the closed definitions:

- **A green on S** = a `signal` tic with `result === "green"` whose `scope` matches S
  (matching via the existing `scopeMatch`, so `S` and `S/sub` and `*` interoperate exactly
  as everywhere else in the reader — see §2 on the scope-degrade rule for `*`).
- **A red on S** = a `signal` tic with `result === "red"` whose `scope` matches S.
- **Hook-signed** (for BOTH a green and a red) = `from === "run-suite"`. This is the single
  discriminator E8 already locked (0009 §1); E10 reuses it unchanged and extends it to reds.
  - **A self-reported red is NOT evidence.** A red whose `from` is a role name (a hand-emit)
    can be fabricated as trivially as a hand-emitted green; counting it as proof-of-red-before-green
    would let an agent launder a not-test-first green by hand-emitting a red just before it.
    Only a **hook-signed** red (the referee actually observed a failing suite on S) counts as
    the red half of the evidence. (This mirrors E8's "a self-reported green is not proof"; a
    self-reported red is symmetrically not proof.) `greenAttestation` already returns
    `null` for reds — E10 adds the symmetric red test as a tiny sibling predicate
    (`isHookSignedRed(tic)` ⟺ `tic.kind === "signal" && tic.result === "red" && tic.from
    === "run-suite"`), so the existing classifier is untouched and the red rule is one new
    pure line, not a rewrite.
- **Honored** = the green is `hook-signed` AND red-before-green is satisfied on its scope.
  This is the E8 ⊕ E10 composition stated once: provenance AND sequence (see §4).

The three states E10 must distinguish for a scope S that has **≥1 hook-signed green**:

| state | hook-signed green on S | a hook-signed red precedes it on S | meaning | gate action |
|---|---|---|---|---|
| **test-first** | yes | yes | red→green proven; HONORED | none (clean) |
| **not-test-first** | yes | no | green exists, no red ever preceded it on S | FLAG; BLOCK under `EVIDENCE_ENFORCE` |
| **(no honored green)** | no (only self-reported, or zero) | n/a | nothing for E10 to replay here | none — see degrade rules below |

Boundary rules baked into the contract:

- **A scope that only ever had greens (never a hook-signed red).** This is the headline
  not-test-first case: a green with NO preceding red is, by definition, not red→green — it is
  flagged (and blocked under enforce). This is the precise teeth E10 adds over E8: E8 would
  pass this green (it is hook-signed); E10 refuses to HONOR it (no red preceded it).
- **A green with NO scope** (or `scope === "*"`). Degrade: a green that carries no specific
  scope cannot be tied to a specific red→green trail, so E10 treats it as **un-replayable —
  it is NOT a not-test-first violation** (absence of a scope is not evidence of absence of a
  red). The gate does not flag or block on a no-scope/`*` green. (This protects the solo /
  zero-config default, where `scope` is often `*`.) See §2 and the no-false-block floor §3.
- **A red after the green** does not retro-honor the green: only a red **preceding** the
  honored green (by `seq`) is evidence. (A later red is just the next cycle's failing test.)
- **One hook-signed red ever, before any green on S, is sufficient** for every subsequent
  green on S until the trail resets — E10 proves "a red preceded a green on this scope," the
  honest floor, not "every green has its own immediately-prior red." (Per-green strictness is
  noted as a future, stricter mode in Out of scope; the default is the legible floor that
  composes with 0010's per-behavior trail without demanding perfect interleaving.)

### 2. The fold (`buildProof` analog) — the locked helper seam

One pure helper in `packages/tics/kit/hooks/tics-view.cjs` (kit reader authoritative; the
installed `.claude/hooks/tics` re-derives on the next dogfood install), exported from
`module.exports`, reused by the gate:

- **`evidenceFor(targetDir, tics) -> { scopes: [{ scope, hasGreen, redBeforeGreen, honored }], anyGreen, anyNotTestFirst }`**
  — the read-side fold, the `buildProof` analog. It:
  1. Takes the bus's `signal` tics (the caller passes the already-loaded signal list, exactly
     as `ticsGate` already does for `attestationTally` — `evidenceFor` does NOT re-read the
     bus; `targetDir` is accepted only for signature symmetry / a possible direct-call form,
     and the tic list is the source of truth).
  2. Groups the **hook-signed** greens and **hook-signed** reds by `scope` (using
     `greenAttestation(t) === "hook-signed"` for greens and the sibling `isHookSignedRed(t)`
     for reds — reusing E8's discriminator, adding nothing to it).
  3. For each scope with ≥1 hook-signed green: `redBeforeGreen` ⟺ ∃ a hook-signed red on that
     scope with `seq` (then `ts`) strictly less than the scope's **latest** hook-signed
     green; `honored` = `hasGreen && redBeforeGreen`.
  4. **Scope-degrade:** greens whose scope is empty/absent or `*` are NOT placed in a
     per-scope honored/violation bucket (they are un-replayable, §1) — they contribute to
     `anyGreen` but never to `anyNotTestFirst`. (Cross-scope matching via `scopeMatch` for
     `S`/`S/sub` is honored so a sub-scope red can satisfy a parent-scope green's evidence,
     consistent with the rest of the reader; `*`-only greens remain un-replayable.)
  5. Aggregates: `anyGreen` (≥1 hook-signed green anywhere), `anyNotTestFirst` (≥1
     **scoped** hook-signed green whose scope has NO preceding hook-signed red — i.e. ≥1
     `hasGreen && !redBeforeGreen` in a real scope).

  It is a **pure, total, side-effect-free, degrade-safe fold**: non-`signal` tics, malformed
  / `null` entries, a legacy `telemetry.jsonl`-fallback bus, an empty bus → an empty
  `scopes` and `anyGreen/anyNotTestFirst === false`. **It never throws and never invents
  evidence** (the same degrade contract `attestationTally` already meets).

- **`isHookSignedRed(tic) -> boolean`** — the tiny sibling predicate (§1). Pure, total. The
  ONLY new classifier surface; `greenAttestation` is reused unchanged (it already returns
  `null` for reds, so it correctly never mis-buckets a red as a green).

**No new bus field** (confirmed, same as E8 §5): the fold reads only `from`, `result`,
`scope`, `seq`, `ts` — every one present on every signal tic ever emitted since the bus
existed. So old buses replay correctly with **zero migration**; a green predating E10 is
classified by exactly the fields it already carries. (A dedicated `evidenceRunId` /
`attestation: "test-first"` envelope field — MC's server-side shape — is rejected for the
same reason E8 rejected a new field: it would be absent on every prior green, breaking
old-bus degrade-safety, and the ordered `from`/`result`/`scope`/`seq` trail already proves
the sequence. See Out of scope.)

### 3. Where it plugs in + flag-vs-block (the gate surface)

`evidenceFor` plugs into the **release gate** `ticsGate` (`tics-view.cjs:501`), ALONGSIDE —
never replacing — the verdict gate (PO-accept + tdd-critic pass) and the E8 attestation
surface. `ticsGate` already loads the bus's `signal` tics for `attestationTally`; E10 folds
the SAME signal list with `evidenceFor` (no extra bus read) and adds an evidence
surface/block beside the attestation one.

**The knob: a NEW `EVIDENCE_ENFORCE`**, read via `cfgNum(targetDir, "EVIDENCE_ENFORCE", 0)`
(default 0 = flag-only), exactly as E8 reads `ATTEST_ENFORCE`. **Two independent enforcement
dials, by deliberate design:**

- `ATTEST_ENFORCE` (E8) = **"was it refereed?"** — block a release whose greens are all
  self-reported.
- `EVIDENCE_ENFORCE` (E10) = **"was it test-first?"** — block a release with a hook-signed
  green that has no red-before-green on its scope.

They are NOT combined into one knob because they encode different defects an adopter may want
to enforce independently (a shop may trust provenance but not yet enforce sequence, or vice
versa). Document `EVIDENCE_ENFORCE` in `packages/tdd/kit/tdd.config` next to `ATTEST_ENFORCE`
(commented; `0`/absent = flag-only; default-safe when the file or key is missing — the F1
line-anchored `^\s*KEY\s*=` parse `cfgNum` uses means a commented example reads as absent,
so the default is genuinely flag-only, never an accidentally-active block).

**The gate behavior on the one acting state (`anyNotTestFirst === true`):**

- **Without `EVIDENCE_ENFORCE`** (default): SURFACE a loud line naming the gap — e.g.
  `"⚠ green(s) without red-before-green evidence — N scope(s) have a hook-signed green that no
  hook-signed red preceded; not proven test-first (EVIDENCE_ENFORCE=0)"`, listing the
  offending scope(s) — but return the **existing exit code unchanged.** It does NOT newly
  block.
- **With `EVIDENCE_ENFORCE=1`** AND the gate would otherwise be CLEAR: REFUSE (non-zero),
  pushing an evidence problem onto the same `problems[]` the gate already uses, with a message
  naming the not-test-first scope(s) and how to clear it (supply a hook-signed red→green on
  the scope, or set `EVIDENCE_ENFORCE=0`). (If the gate already blocks on verdicts or
  attestation, the release is blocked regardless; the evidence block adds its line but changes
  no exit code already non-zero.)

**The degrade-safe no-false-block floor (the contract risk this ADR resolves), mirroring E8
§4 exactly.** The evidence layer MUST NOT add a new block — and MUST NOT print a false-alarm
line — in ANY of these states, *even with `EVIDENCE_ENFORCE=1`*:

1. **No greens at all** (`anyGreen === false`: empty bus, old bus with no green signals, a
   verdict-only release): NO block, NO line — there is no green whose evidence the gate could
   expect. The verdict/attestation gates stay the sole authority. An old/empty bus must NOT
   start failing a previously-passing release the day the adopter updates.
2. **Every scoped green is proven test-first** (`anyNotTestFirst === false`, despite
   `anyGreen === true`): NO block, NO line. Honest red→green work passes clean.
3. **Only no-scope / `*` greens** (un-replayable per §1/§2): NOT counted into
   `anyNotTestFirst`, so NO block, NO line. The solo / zero-config default (where `scope` is
   often `*`) cannot be false-blocked by E10. Absence of a scope is not evidence of absence
   of a red.
4. **Greens are all self-reported** (no hook-signed green to replay): that is E8's concern
   (attestation), not E10's. `evidenceFor` only replays hook-signed greens, so an
   all-self-reported bus produces `anyNotTestFirst === false` and E10 adds nothing — E8's
   `ATTEST_ENFORCE` is the dial for that defect, keeping the two layers cleanly separated.

In one line: **the evidence block fires only when a SCOPED HOOK-SIGNED green exists whose
scope never saw a preceding hook-signed red, AND the adopter set `EVIDENCE_ENFORCE=1`.**
Every other state is left exactly as the verdict + attestation gates decide it.

### 4. Relationship to E8 + composition (stated plainly)

- **E8 / 0009 = PROVENANCE.** "Was this green refereed?" → `hook-signed` vs `self-reported`,
  dial `ATTEST_ENFORCE`.
- **E10 / this ADR = SEQUENCE.** "Was this green test-first?" → red-before-green proven vs
  not, dial `EVIDENCE_ENFORCE`.
- **An HONORED green = hook-signed AND red-before-green** — provenance ⊕ sequence. E10
  literally builds on E8: `evidenceFor` only ever considers `hook-signed` greens/reds (it
  reuses `greenAttestation` and the sibling `isHookSignedRed`), so the sequence check is
  defined strictly over the provenance E8 already established. The two dials compose: a shop
  can enforce neither (both flag), either alone, or both; with both on, a release certifies
  only greens that were refereed AND test-first. This is the natural extension 0009 named and
  deferred.

### 5. Degrade-safety + invariants

- **Pure read-side fold, zero new runtime deps, pure Node CommonJS, Node ≥16.** One new
  exported fold (`evidenceFor`) + one tiny sibling predicate (`isHookSignedRed`) + an
  additive `ticsGate` surface/flag + one new commented `tdd.config` knob. Everything else
  (the bus, `run-suite`, `greenAttestation`/`attestationTally`, the verdict gate,
  `loadSignalEvents`) is reused unchanged. The fold is a pure data function → fully
  unit-testable with crafted tics, no clock or I/O.
- **Honest-by-default, not cryptographic (the ceiling, stated honestly).** `from=run-suite`
  is forgeable by a determined hand-emit, exactly as in E8 (ADR 0006 / the N7 finding). A
  determined agent CAN still hand-emit a fake hook-signed red and then a green to manufacture
  red-before-green evidence. E10 does NOT make that impossible; it makes the default path
  honest and the lie **visible and effortful** — the agent must now impersonate the referee's
  `from` on BOTH a red AND a green, in the right order, on the right scope. That is a strictly
  larger, more conspicuous forgery than E8's single fake green, and it is exactly "the honesty
  is the moat" (0006). Cryptographic signing is the heavier posture (Out of scope).
- **One-behavior-per-red slicing still applies when BUILDING E10** (0010 §3/§4): each behavior
  of the fold/gate is its own red→green; "coarse" never batches behaviors. (And note the
  pleasing symmetry: the very trail 0010's floor protects is the trail E10 replays.)
- **`kit/` is authoritative.** Edit only `packages/tics/kit/hooks/tics-view.cjs` (+ the
  `tdd.config` template at `packages/tdd/kit/tdd.config`); the stale fossil hook copies under
  `packages/team-tactics/claim-session/.claude/hooks/` etc. are an H1 hygiene gap, NOT E10's
  job — do not edit them.

## Resolved contract risks

- **Self-reported red as non-evidence (the headline correctness risk).** Resolved by §1: the
  red half of the evidence MUST be hook-signed (`isHookSignedRed`). A hand-emitted red is not
  proof and cannot launder a not-test-first green. The evidence is symmetric with E8: only the
  referee's red counts, just as only the referee's green is provenance.
- **The honest-not-cryptographic ceiling.** Resolved/stated by §5: E10 is provenance+sequence,
  not signature. A determined agent can forge red-then-green; E10 makes that a larger, visible,
  effortful lie, not an impossible one. The stronger posture is the separate signing epic.
- **The no-false-block floor.** Resolved by §3: the evidence block fires ONLY when a scoped
  hook-signed green has no preceding hook-signed red AND `EVIDENCE_ENFORCE=1`. No greens / all
  test-first / only `*`-scope greens / all-self-reported → NO new block and NO false-alarm
  line, even enforce-on. An old/empty/solo bus cannot turn a previously-passing release red.
- **Old-bus correctness with no migration.** Resolved by §2: the fold reads only
  `from`/`result`/`scope`/`seq`/`ts`, present on every tic ever emitted. No new field, no
  migration; pre-E10 greens replay by the fields they already carry.
- **The fold is total and degrade-safe.** Resolved by §2: `evidenceFor` returns empty/false on
  malformed / non-signal / legacy-fallback / empty input and never throws — the same contract
  `attestationTally` meets.
- **No regression to the verdict gate, the E8 attestation surface, or `report`.** Resolved by
  §3: the work is purely additive — `ticsGate` adds an evidence surface beside the verdict and
  attestation logic, folding the SAME signal list it already loads; `loadSignalEvents`'s shape
  is unchanged; `greenAttestation`/`attestationTally` are reused untouched. Existing gate/report
  tests stay green.
- **Two-dial confusion (`ATTEST_ENFORCE` vs `EVIDENCE_ENFORCE`).** Resolved by §3/§4: kept
  deliberately independent — provenance vs sequence — both read via `cfgNum` from `tdd.config`,
  both default flag-only, both line-anchored-parsed so a commented example is inactive.

## Consequences

- The bus's red/green SEQUENCE — present since the bus existed — finally counts: the release
  gate can (opt-in) refuse to certify a green that no hook-signed red preceded, closing the
  "green reported but never test-first" gap E8 explicitly left open, with a pure local
  read-side fold and no server.
- One pure fold (`evidenceFor`, the `buildProof` analog) + one tiny predicate
  (`isHookSignedRed`) + an additive `ticsGate` surface/flag + one new commented `tdd.config`
  knob. Everything else is reused unchanged. Fully unit-testable with crafted tics.
- **No bus contract change.** No new `tics.jsonl` field, no emit-side change to `run-suite.sh`.
  The only contract growth is one new pure export from `tics-view.cjs` (plus the sibling
  predicate) and one new `tdd.config` knob (`EVIDENCE_ENFORCE`, default flag-only).
- **Two independent enforcement dials.** `ATTEST_ENFORCE` (refereed?) and `EVIDENCE_ENFORCE`
  (test-first?) compose; an adopter can run neither, either, or both. With both on, a release
  certifies only greens that were refereed AND test-first.
- **Honest-by-default, not cryptographic** — the same moat as E8/0006, one notch harder to
  fake (a forger must now impersonate the referee on an ordered red AND green on the right
  scope). The stronger posture is the separate signing epic, not a tweak here.
- **Default behavior unchanged for honest flows.** A solo CC run earns hook-signed greens
  preceded by hook-signed reds on real scopes → proven test-first → no line, no block. A
  `*`-scope-only or self-reported flow is un-replayable → E10 adds nothing (E8 still surfaces
  self-reported). Nobody's existing release goes red on update.
- Invariants upheld: zero runtime deps, pure Node CommonJS, Node ≥16; `node --test` stays
  green; `selftest` passes; `kit/` authoritative (the fossil hook copies are H1, not E10).
  Nothing in this ADR is built yet — Status: Proposed.

## Out of scope (explicitly rejected or deferred for this ADR)

- **The MC server-side `evidenceRunId` ingest API / brain / multi-tenant.** Those stay
  server-shaped (E6 / Mission Control stays dropped). E10 is a pure local read-side replay of
  the trail the bus already carries — no ingest endpoint, no run-id correlation field.
- **A new `evidenceRunId` / `attestation:"test-first"` envelope field.** Rejected, same as E8
  rejected a new field: absent on every prior green → breaks old-bus degrade-safety and forces
  a migration; the ordered `from`/`result`/`scope`/`seq` trail already proves the sequence.
- **The slice-DAG / `independentFrontier` parallel scheduling.** A separate, later epic about
  WHICH slices can run in parallel. It COMPOSES with E10 (a richer slice graph would make
  per-scope red→green trails even more legible) but is NOT E10 — its own contract decision and
  ADR.
- **Cryptographic signing of tics.** The stronger-than-provenance posture (key management +
  migration). E10 is sequence over provenance (ADR 0006), not signature.
- **Per-green strict interleaving ("every green needs its OWN immediately-prior red").**
  Deferred as a possible stricter future mode. E10's default floor is "a hook-signed red
  preceded a hook-signed green on this scope," which is the legible, degrade-safe minimum that
  composes with 0010's per-behavior trail without demanding perfect red/green alternation.
- **`require-green-to-stop.sh` (the Stop hook) is untouched.** It re-RUNS the suite, so inside
  CC it is already honest; E10, like E8, targets the RELEASE-GATE consumer, not that hook.

## Alternatives considered

- **One combined `HONEST_ENFORCE` knob for both provenance and sequence.** Rejected: the two
  are different defects an adopter may want to enforce independently (trust provenance but not
  yet sequence, or vice versa). Two independent dials (§3/§4) is the locked shape; they still
  compose.
- **Count a self-reported (hand-emitted) red as the red half of the evidence.** Rejected
  (§1): a hand-emitted red is as forgeable as a hand-emitted green and would let an agent
  launder a not-test-first green by emitting a fake red just before it. Only the referee's red
  is evidence.
- **Treat a no-scope / `*` green as a not-test-first violation when it has no preceding red.**
  Rejected (§2/§3): absence of a scope is not evidence of absence of a red; flagging it would
  false-block the solo / zero-config default. No-scope/`*` greens are un-replayable, never
  violations.
- **Default hard-block on the first not-test-first green.** Rejected (PO call, mirroring 0009):
  old/solo/legacy buses legitimately carry greens whose scope never recorded a hook-signed red;
  a default block would false-fail them on update. Surface loudly by default; block only on
  opt-in `EVIDENCE_ENFORCE=1`.
- **A new `evidenceProof` envelope field emitted by `run-suite`.** Rejected — buys nothing the
  ordered `from`/`result`/`scope`/`seq` trail doesn't, and breaks old-bus degrade-safety. See
  §2 / Out of scope.
- **Build the replay server-side (port MC's `buildProof`/`app.ts` verbatim).** Rejected — the
  trail is local and the proof is a pure fold; a server adds nothing but a deployment. Keep it
  the read-side fold the local bus already affords (the same call MC's `buildProof` makes,
  minus the server).
