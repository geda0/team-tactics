# 0009 — The honest gate (attestation-aware greens: count the provenance the bus already carries)

- Status: Accepted
- Date: 2026-06-15
- Deciders: navigator (mine the Mission Control ecosystem through an enforcement
  lens; bring home attest-then-gate-on-attestation, NOT the server/evidence-API/signing),
  product-owner (selected E8; FLAG-DEFAULT + opt-in `ATTEST_ENFORCE` hard block — option a;
  no new bus field), architect (the discriminator, the read-side fold seam, the gate's
  degrade-safe no-false-block rule)
- Relates to: 0006 (the honesty is the moat — provenance, not cryptography) and 0008
  (the same read-side-fold-over-the-existing-bus pattern in `tics-view.cjs`). Builds on
  0001 (the gate is a referee inside CC; outside CC enforcement evaporates). Supersedes
  nothing. The Mission Control server idea (E6) stays dropped/stashed; this keeps only the
  read-side classification that was always local.

## Context

We mined the Mission Control ecosystem (`../mission-control`, `../mc-client`,
`../mc-cursor`) through an **enforcement** lens. The central finding:

team-tactics' value is that its Claude Code hooks **physically** gate edits (phase×layer)
and block stopping on red — **but hooks only fire inside Claude Code.** For a non-CC agent
(Cursor) that enforcement evaporates: `AGENTS.md` tells such an agent to self-enforce by
HAND-EMITTING a green —
`tic.sh <role> '*' signal '[<layer>] suite green' <ref> green`. Mission Control never
solved *making* a non-CC agent run your hooks (even its directives are ignorable; its brain
only records and serves). The honest substitute it built — and the highest-value thing to
bring home — is **attest-then-gate-on-attestation**: you cannot force the referee, but the
counting/reporting/release-gate consumers can refuse to *trust* a green they cannot prove
the referee produced (MC's `detectAttestation` hook-signed-vs-self-reported split).

**The leapfrog: the provenance ALREADY exists on our bus, and the consumers just ignore
it.** Two ground-truthed facts:

1. **The hook-signed green.** `packages/tdd/kit/hooks/run-suite.sh:75` emits every suite
   result as a `signal` tic with **`from=run-suite`**, `result=green|red`, and EXTRA_JSON
   `,"exit":N,"durationSec":N`. `run-suite` is a CC PostToolUse hook, so a `from=run-suite`
   green is hook-signed (the L73-74 comment: "hook-emitted ... agents cannot forge a
   signal").
2. **The self-reported green.** A hand-emitted green carries a **role name** as `from`
   (`implementer`, `orchestrator`, …) and no `exit`/`durationSec` — distinguishable today,
   but treated identically by every consumer.

The consumers that ignore the difference are all read-side folds in `tics-view.cjs` /
`cli.js`:

- `loadSignalEvents` (`tics-view.cjs:39`) returns ALL `signal` tics (with a legacy
  `telemetry.jsonl` fallback). `report()` (`cli.js:515`) consumes it and buckets greens
  (`L.cycles` for green-in-green) **but never inspects `e.from`** — every green counts
  equally.
- `ticsGate` (`tics-view.cjs:461`) — the RELEASE gate — reads ONLY `verdict` tics
  (product-owner accept + tdd-critic pass) and never checks whether the work's greens were
  hook-refereed.
- `ticsCycle` (`tics-view.cjs:428`) shows "last suite" with no provenance.

E8 makes the existing provenance **count**: classify each green `signal` as hook-signed vs
self-reported, surface the split loudly in `report`, and make "was the referee actually run
on the work being released?" an explicit, surfaced, opt-in-gateable fact. This is
honest-by-default, not cryptographic — a determined agent can still forge a `from`, but the
lie becomes visible and effortful ("the honesty is the moat", ADR 0006).

**Not in scope of the mechanism (do NOT redesign):** `require-green-to-stop.sh` (the Stop
hook) re-RUNS the suite before it lets the agent stop, so inside CC it is already honest.
E8 targets the COUNTING / REPORTING / RELEASE-GATE consumers, not that hook.

## Decision

Add a **pure read-side classification fold** over the existing bus in `tics-view.cjs`:
a per-tic green-attestation classifier, a tally fold over a list of signals, the `report`
split + loud call-out, and an attestation surface on `ticsGate` that is FLAG-ONLY by default
and hard-blocks only under an opt-in `ATTEST_ENFORCE` knob. **No new bus field**, no
emit-side change, no server, no crypto. Degrade-safe throughout (old/empty bus, solo
default, honest non-CC degradation never break, over-count, or false-alarm).

### 1. The attestation discriminator (precise — the load-bearing definition)

A green `signal` tic is classified into a **closed two-value vocabulary**:

- **`hook-signed`** ⟺ the tic is a green-result `signal` whose **`from === "run-suite"`**.
  `run-suite` is the only emitter of refereed suite results (a CC PostToolUse hook), so this
  `from` is the provenance.
- **`self-reported`** ⟺ the tic is a green-result `signal` whose `from` is anything else
  (a role name — what a non-CC/Cursor agent hand-emits per `AGENTS.md`).

`from === "run-suite"` is the **sole discriminator.** `exit` / `durationSec` are *corroborating*
only (a hook-signed green carries them; a hand-emit does not) — the classifier does NOT test
them, because:
- A `from=run-suite` green is hook-signed *by definition* (the emitter, not the payload, is
  the trust anchor). Adding an `exit`/`durationSec` requirement would needlessly demote an
  old hook-signed green if the EXTRA_JSON shape ever drifts — i.e. it would *cost*
  degrade-safety for no provenance gain.
- Keeping the test to `from` keeps it forgiving and the same as the existing `from ===
  "run-suite"` checks already in `collapseRunSuite` (`tics-view.cjs:60`) — one canonical
  notion of "this came from the referee".

**A green is "proof of pass"; reds are not the concern.** The classifier only classifies
GREENS. Anything that is not a green-result `signal` — a red signal, a non-`signal` kind, a
tic with no `from`, a malformed/`null` entry — is **not a hook-signed green**: the classifier
returns `null` (un-classified) and **never throws, never invents provenance**. This is the
degrade rule: a non-green or malformed tic simply contributes to neither bucket.

> Precise green test: `t && t.kind === "signal" && t.result === "green"`. (`run-suite`'s
> EXTRA_JSON sets `result` literally to `green`/`red`; a hand-emitted green per AGENTS.md
> passes `green` as the result arg. The classifier matches that exact string; it does not
> sniff `msg`.)

### 2. Helper shape (names + where dispatched) — the locked seam

Two pure helpers in `packages/tics/kit/hooks/tics-view.cjs` (the kit reader is
authoritative; the installed `.claude/hooks/tics` re-derives on the next dogfood install,
a release step), exported from `module.exports` and reused by BOTH consumers:

- **`greenAttestation(tic) -> 'hook-signed' | 'self-reported' | null`** — the E8-1
  foundation. Pure, total, side-effect-free over ONE tic. Returns `null` for anything that
  is not a green-result `signal` (per §1's degrade rule). This is the single source of truth
  for "is this green hook-signed?"; every other surface folds over it.
- **`attestationTally(signals) -> { hookSigned, selfReported, greens }`** — the fold the
  renderers consume. Walks a list of signal tics, calls `greenAttestation` on each, and
  counts: `hookSigned` + `selfReported` = `greens` (the totals reconcile, by construction —
  a green is exactly one of the two; non-greens are skipped). Accepts the same shape
  `loadSignalEvents` returns (it tolerates the legacy `telemetry.jsonl` fallback entries:
  those have no `from`/`result` matching a green signal → they classify as `null` and are
  simply not counted, preserving degrade-safety on a legacy bus).

**Dispatch (which consumer calls which):**

- **`report()` (`packages/team-tactics/bin/cli.js:515`)** consumes the @ttics/tics fold:
  it already calls `TV.loadSignalEvents(targetDir)`; it now also calls
  `TV.attestationTally(events)` to render the split + the loud self-reported call-out
  (E8-2). The render lives in `cli.js`; its display test lives in `team-tactics`'s suite
  (`packages/team-tactics/test/ticsview.test.js`). The pure fold is tested in
  `packages/tics/test/tics.test.js`.
- **`ticsGate()` (`tics-view.cjs:461`)** loads the bus's `signal` tics (it currently loads
  only `verdict` tics — it ADDITIVELY also reads signals for the attestation surface),
  folds them with `attestationTally`, and ADDS an attestation surface/block ALONGSIDE the
  existing verdict logic (E8-3). It does NOT replace or weaken the verdict gate.

No new command, no new dispatch entry in `bin/tics.js` / `main()` — E8 enriches existing
surfaces (`report`, `gate`), it does not add a view. `loadSignalEvents`'s return shape is
UNCHANGED (additive consumption only; the guard/report consumers keep their current data).

This is the minimum that lets the inner loop build each slice against a stable shape: E8-1
ships `greenAttestation` (+ `attestationTally`); E8-2 has `report` render the tally; E8-3
has `ticsGate` fold the tally and add the flag/block. The increment plan is the planner's;
the names, the discriminator, and the rules below are the locked contract.

### 3. `report` surfaces the split (E8-2) — visibility, no false alarm

- `report()` prints the green count broken into hook-signed vs self-reported (from
  `attestationTally`); the two reconcile to the total greens.
- When the bus contains **≥1 self-reported green**, `report` prints a **loud, unmissable
  call-out** that self-reported (un-refereed) greens exist, so they cannot silently inflate
  the pass rate.
- When **every** green is hook-signed (or there are zero greens), `report` prints **NO**
  such call-out (no false alarm on an all-refereed bus).
- On an OLD bus (greens predating E8) or an EMPTY bus, `report` does not throw, does not
  over-count, and the existing output (layers / cycles / retries / window) still renders.
  An old/legacy bus's greens are hand-classified by `from` exactly as any other green —
  there is no migration, because the discriminator reads only fields the bus has always
  carried.

### 4. The green-aware release gate (E8-3) — FLAG-default, opt-in hard block

`ticsGate` keeps its existing authority unchanged (product-owner accept + tdd-critic pass —
the verdict gate is the primary release authority). The attestation layer is ADDED beside
it, governed by the precise rules below.

**The knob: `ATTEST_ENFORCE`**, read via the existing `cfgNum(targetDir, "ATTEST_ENFORCE",
0)` (default 0 = flag-only). It mirrors the *intent* of `CLAIMS_ENFORCE` (an opt-in
enforcement posture) but is read from `tdd.config` via `cfgNum`, because the gate is a Node
read-side fold — unlike `CLAIMS_ENFORCE`, which the shell hooks read via `:-1`. Document it
in `packages/tdd/kit/tdd.config` alongside `CLAIMS_ENFORCE` (commented; `0`/absent = flag
only; default-safe when the file or key is missing).

**Define "no hook-signed green evidence" precisely.** Over the gate's signal set, classify
greens with `attestationTally`. There are exactly three states:

| greens | hook-signed | self-reported | meaning |
|---|---|---|---|
| 0 | 0 | 0 | **no greens at all** (empty/old bus, or a verdict-only release) |
| ≥1 | ≥1 | any | **has hook-signed evidence** |
| ≥1 | 0 | ≥1 | **all-self-reported** — greens exist but NONE was refereed |

The attestation gate acts ONLY on the third state (`greens ≥ 1 && hookSigned === 0`):

- **Without `ATTEST_ENFORCE`** (default): SURFACE a loud line naming the gap ("N greens on
  the bus, none hook-signed — no proof the referee was run on this work"), but return the
  **existing verdict-based exit code unchanged.** It does NOT newly block.
- **With `ATTEST_ENFORCE=1`** AND the verdict gate would otherwise be CLEAR: REFUSE
  (non-zero) with a message that no hook-signed green proves the release was refereed — the
  opt-in hard block. (If the verdict gate already blocks, the release is blocked regardless;
  the attestation block adds its line but changes no exit code that was already non-zero.)

**The degrade-safe no-false-block rule (the contract risk this ADR resolves).** The
attestation layer MUST NOT add a new block — and MUST NOT print a false-alarm line — in any
of these states, *even with `ATTEST_ENFORCE=1`*:

1. **Has ≥1 hook-signed green** (state 2): NO new block, NO false-alarm line — the verdict
   gate behaves exactly as today. Honest greens pass clean.
2. **Zero greens** (state 1: empty bus, old bus with no green signals, or a release whose
   work didn't run the suite): NO new block — there is no provenance the gate could *expect*,
   so absence is not a violation. The verdict gate stays the sole authority. An old/empty bus
   must NOT start failing a previously-passing release the day the adopter updates.

In other words: **the attestation block fires only when greens are PRESENT and EVERY one is
self-reported, AND the adopter opted in.** "Present greens, all un-refereed" is the one
honest-degradation case the adopter can choose to treat as a release defect; every other
state is left exactly as the verdict gate decides it. A non-CC agent that only ever
hand-emits greens earns zero hook-signed greens — that is SURFACED (the flag line) by
default and only blocks if the adopter opts in; it is the CORRECT honest degradation, not a
silent failure and not a default false-fail.

### 5. No new bus field (confirmed)

The discriminator is the existing `from` (+ corroborating EXTRA_JSON `exit`/`durationSec`,
not tested). **No `attestation` envelope field is added**, because:

- A new field would be ABSENT on every green predating E8, so old buses would mis-classify
  (or force a migration) — directly breaking the degrade-safety invariant. The existing
  `from` is present on every tic ever emitted, so old buses classify correctly with zero
  migration.
- The provenance is already unforgeable-in-normal-use: `run-suite` is a CC PostToolUse hook,
  and a hand-emit cannot honestly set `from=run-suite` (doing so is precisely the visible,
  effortful lie ADR 0006 makes the moat). A cryptographic signature would be a different,
  heavier posture (out of scope — see below).

Considered and rejected: an explicit `attestation: "hook-signed"` field emitted by
`run-suite`. Rejected for E8 — it buys nothing the `from` discriminator doesn't, and it
breaks old-bus degrade-safety. (If a future epic ever needs *cryptographic* attestation —
"evidence-gated greens / red-before-green replay", see Out of scope — that is a separate
contract decision with its own ADR and migration note, not a quiet field add here.)

## Resolved contract risks

- **The gate never false-blocks (the headline risk).** Resolved by §4: the attestation
  block fires ONLY in state 3 (`greens ≥ 1 && hookSigned === 0`) AND only under
  `ATTEST_ENFORCE=1`. An empty bus, an old bus, a verdict-only release, and any bus with
  ≥1 hook-signed green add NO new block and NO false-alarm line — the verdict gate stays the
  primary authority and its exit code is untouched. An old/empty bus cannot turn a
  previously-passing release red.
- **Old-bus correctness with no migration.** Resolved by §5: the discriminator reads only
  `from`, present on every tic ever emitted, so greens predating E8 classify correctly with
  zero migration and no new field.
- **The classifier is total and degrade-safe.** Resolved by §1: `greenAttestation` returns
  `null` for any non-green-result-signal / malformed / `null`-`from` input and never throws;
  the tally skips `null`s, so a legacy `telemetry.jsonl`-fallback bus (entries with no
  green-signal shape) simply counts zero of each — no crash, no over-count.
- **Totals reconcile.** Resolved by §2: every green is exactly one of `hook-signed` /
  `self-reported`; `hookSigned + selfReported === greens` by construction, so the `report`
  split is self-consistent and cannot over-count.
- **No regression to the verdict gate or to `report`'s existing output.** Resolved by §2/§3:
  the work is purely additive — `ticsGate` adds a surface beside the verdict logic;
  `report` adds a split + call-out beside the existing layers/cycles/retries/window table;
  `loadSignalEvents`'s return shape is unchanged. Existing report/gate tests stay green.
- **`ATTEST_ENFORCE` vs `CLAIMS_ENFORCE` read-path divergence.** Flagged and resolved:
  `CLAIMS_ENFORCE` is read by the SHELL hooks (`:-1`); `ATTEST_ENFORCE` is read by the NODE
  gate via `cfgNum` from `tdd.config`. They share the opt-in *posture* (and live next to each
  other in `tdd.config`) but not the read mechanism — by design, because they live in
  different layers. `cfgNum`'s line-anchored regex (post-F1) means the commented example in
  `tdd.config` reads as absent (0) — so the default is genuinely flag-only, not an
  accidentally-active block.

## Consequences

- The provenance the bus has carried since v0.24.0 finally **counts**: `report` shows how
  much of the green rate is refereed vs self-reported, and the release gate can (opt-in)
  refuse to certify a release whose greens were never refereed — closing the non-CC
  enforcement gap the Mission Control mining surfaced, with a pure local read-side fold.
- One pure classifier (`greenAttestation`) + one pure fold (`attestationTally`) + an
  additive `report` split/call-out + an additive `ticsGate` surface/flag. Everything else
  (the bus, the emitter, the verdict gate, `loadSignalEvents`) is reused unchanged. Both
  helpers are pure data functions → fully unit-testable with crafted tics, no clock or I/O.
- **No bus contract change.** No new `tics.jsonl` field, no emit-side change to
  `run-suite.sh`. The only contract growth is two new pure exports from `tics-view.cjs` and
  one new `tdd.config` knob (`ATTEST_ENFORCE`, default flag-only).
- **Honest-by-default, not cryptographic.** `from=run-suite` is forgeable by a determined
  hand-emit, exactly as `commit`/`signal` are outside CC (ADR 0001 / the N7 finding). E8
  makes the lie *visible and effortful* (it must impersonate the referee's `from`), which is
  the moat — it does not make the lie impossible. If an adopter ever needs the stronger
  posture, the path is the separate evidence-gated-greens epic, not a tweak here.
- Invariants upheld: zero runtime deps, pure Node CommonJS, Node ≥16; `node --test` stays
  green; `selftest` passes; the kit reader (`kit/`) is authoritative (edit only
  `packages/tics/kit/hooks/tics-view.cjs` — the stale fossil copies under
  `packages/team-tactics/claim-session/.claude/hooks/` and `claim-owner/...` are an H1
  hygiene gap, NOT E8's job; do not edit them).
- **Default behavior is unchanged for honest flows.** A solo CC run earns hook-signed greens
  (run-suite fires) → no call-out, no block. A non-CC run earns self-reported greens → a
  visible `report` call-out + a gate flag line, but no block unless the adopter sets
  `ATTEST_ENFORCE=1`. Nobody's existing release goes red on update.

## Out of scope (skip/defer per the mining — do NOT pull into E8)

- **No MCP server, no server-side evidence/ingest API, no multi-tenant.** Those stay
  server-shaped (and E6/Mission-Control stays dropped). E8 is a pure local read-side fold +
  one flag knob.
- **No autonomy / spend caps.** A different governance surface entirely; not part of the
  attestation read-side.
- **No cryptographic signing of tics.** E8 is provenance (`from`), not signature (ADR 0006).
  Signing is a heavier posture with its own key-management + migration story.
- **`require-green-to-stop.sh` is untouched.** The Stop hook re-RUNS the suite, so inside CC
  it is already honest; E8 is about the COUNTING / REPORTING / RELEASE-GATE consumers.
- **Cross-reference — E8 is the "attest" half only.** It classifies and surfaces the
  provenance already on the bus and gates (opt-in) on its presence. The future
  **evidence-gated greens / red-before-green replay** work (proving a green corresponds to a
  specific code state, or that a red preceded the green) is a SEPARATE later epic with its
  own contract decision and ADR — explicitly NOT E8.

## Alternatives considered

- **Default hard block on all-self-reported greens.** Rejected (PO call, locked here): the
  solo default and every old bus may legitimately carry only hand-emitted greens, and a
  non-CC agent that only hand-emits earns zero hook-signed greens — the CORRECT honest
  degradation. A default block would false-fail those flows the day they update. Surface
  loudly by default; block only on opt-in `ATTEST_ENFORCE=1`.
- **A new `attestation` envelope field emitted by `run-suite`.** Rejected — buys nothing the
  `from` discriminator doesn't, and breaks old-bus degrade-safety (absent on every prior
  green → mis-classification or a forced migration). See §5.
- **Test `exit`/`durationSec` as part of the discriminator.** Rejected as the primary test —
  it would demote an old hook-signed green if the EXTRA_JSON shape drifts, costing
  degrade-safety for no provenance gain. The emitter (`from`) is the trust anchor; the
  EXTRA_JSON fields are corroborating only.
- **Classify reds too / gate on red→green ordering.** Rejected for E8 — a green is the
  "proof of pass"; reds are not proof and not the trust surface. Ordering/replay is the
  separate evidence-gated-greens epic.
- **Put the classifier in `cli.js` (next to the `report` render).** Rejected — the gate
  (`tics-view.cjs`) also needs it, and `tics-view.cjs` is the shared zero-dep reader both
  entrypoints load. The pure fold belongs there; only the *render* belongs in `cli.js`.
