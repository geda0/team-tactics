# 0013 — The per-tool witness (a faithful activity record on the existing bus: a `note from=witness` per tool call, hidden-by-default, opt-in)

- Status: **Accepted** (a design panel LOCKED this contract; we build it this session)
- Date: 2026-06-16
- Deciders: navigator (mine Mission Control's PostToolUse activity capture through a
  faithful-record lens — bring home a per-tool witness as the enabler for a deferred
  onboarding-overhead (OO) metric, NOT a server / telemetry-ingest API / dashboard),
  product-owner (selected E12; opt-in `TOOL_WITNESS=1` default-OFF; v1 witnesses ALL tools
  when on; no de-pollution), architect (the distinct `from=witness` identity, the reuse of
  the existing `note` kind + the existing bus, the `tics log` hide-by-default + `tics report`
  tally folds, the degrade-safe knob-off floor)
- Relates to: **0008 (local fleet observability)** — E12 is the same read-side-fold-over-the-
  existing-bus family in `tics-view.cjs` / `cli.js`, and follows 0008's decision to make the
  bus the SINGLE telemetry source (the old `telemetry.jsonl` was deprecated in favor of bus
  `signal`s). **0009 (the honest gate)** and **0011 (evidence-gated greens)** — E12 is the
  same nudge-and-record posture: a RECORD, measurement, **never a gate** (no hook blocks on
  tool usage), exactly like the attestation/evidence surfaces RECORD provenance without
  coercing it. It is ORTHOGONAL to E8/E10: the witness records ACTIVITY, it does NOT make a
  green more trustworthy. Same convention/record family as **0005 (operate the full
  framework)** / **0006 (the honesty is the moat)** / **0010 (capability-aware execution)**.
  Builds on the `run-suite.sh` PostToolUse precedent (`run-suite.sh:75` reads the tool payload
  and emits a tic) and on **0012**'s emit-side reuse discipline (reuse an existing kind + the
  bus, no new envelope field). Supersedes nothing. The Mission Control server (E6) stays
  dropped — E12 keeps only the local PostToolUse capture that was always local.

## Context

### The gap: there is no faithful activity record

team-tactics' bus records COORDINATION (delegates, handoffs, verdicts, signals, needs) and
the referee's suite results — but it records nothing about the raw ACTIVITY of a session: how
many edits, how many reads, how many shell runs, how many bus-reads a given piece of work took
to land. That record is the prerequisite for the deferred **onboarding-overhead (OO)** metric
— "how much tool churn does it cost a fresh session to get productive in this repo?" — which
needs a faithful per-tool activity trace to classify and aggregate. Today there is no such
trace, and no place that consumes one.

### The Mission Control inspiration (mined; design the LOCAL form)

Mission Control captures activity server-side via a PostToolUse hook that posts each tool
invocation to its brain. For team-tactics there is **no server and no ingest API.** The same
capture is a **single PostToolUse hook that appends ONE existing-kind tic per tool call to the
existing bus**, because everything the record needs already exists:

- **The PostToolUse precedent is already in the kit.** `run-suite.sh` is a PostToolUse hook
  (matcher `Edit|Write|MultiEdit`) that reads the tool payload (jq with a grep fallback) and
  emits a tic at `run-suite.sh:75` via `emit_tic`. E12 generalizes exactly that shape to a
  `*` matcher and emits a `note` instead of a `signal`.
- **The bus is the single source.** 0008 deprecated the old `telemetry.jsonl` in favor of bus
  signals; the witness writes to the SAME bus (`.claude/state/tics.jsonl`), keeping ONE store.
- **`emit_tic` already stamps the envelope.** Phase, layer, scope, and session are filled in
  by `emit_tic` (`tics-lib.sh`); the witness passes only `from` / `to` / kind / `msg` / `ref`
  and inherits a fully-stamped tic — no new envelope field, no new plumbing.
- **The read-side already folds the bus.** `tics log` already HIDES noise by default
  (`collapseRunSuite` folds consecutive `run-suite` signals into one row, `tics-view.cjs:54-64`,
  applied in `ticsLog` at `:66`), and `tics report` is already a pure aggregating fold over bus
  signals (`cli.js:515`, with the `attestationTally` tally at `:552` as the precedent for a
  grouped count). E12 adds a hide-filter and a tally beside those.

E12 is therefore the same leapfrog as the read-side-fold ADRs: **the record the bus can
already carry, that the consumers just don't capture or surface.** It is one tiny PostToolUse
hook (gated by an opt-in knob) + one log-hide filter + one report tally — no server, no new tic
kind, no new envelope field, no separate witness store.

## Decision

Add an **opt-in PostToolUse witness hook** that emits ONE `note` tic with the distinct
identity `from=witness` per tool call (default OFF), plus a **`tics log` hide-by-default
filter** for those notes and a **`tics report` per-tool tally** that folds them. NO new tic
kind, NO new envelope field, NO server, NO separate witness store, NO hook gate. Degrade-safe
throughout: knob off → the hook no-ops and an existing install behaves EXACTLY as today.

### 1. The witness note — shape + WHY a distinct `from=witness` (the load-bearing definition)

A **witness** is an ordinary `note` tic, emitted through the existing `emit_tic`, carrying a
distinct sender identity:

- **`from = "witness"`** — the locked identity string. NOT a role name. This single choice is
  what makes the rest of the contract clean (below).
- **`to = "*"`** — a broadcast note (it addresses no role; it is a record, not a DM).
- **`kind = note`** — the existing general kind. No new kind.
- **`msg = "used <Tool>"`** — where `<Tool>` is the tool NAME read from the PostToolUse payload
  field **`.tool_name`** (the same payload `run-suite.sh` already parses, via jq with a grep
  fallback). The tool name lives in `msg` so the `report` tally can group on it by a pure
  string fold.
- **`ref = <edited path>`** — the file path IF the tool payload carries one
  (`.tool_input.file_path // .tool_input.path`, exactly the field `run-suite.sh:20-22` reads);
  empty otherwise. `ref` is corroborating context only; the tally keys on `msg`.
- **phase / layer / scope / session** — stamped by `emit_tic`, unchanged. The witness passes
  nothing extra; the envelope is identical to every other tic.

Emitted by the existing emitter, unchanged in shape:

```
emit_tic witness "*" note "used <Tool>" "<edited-path-or-empty>"
```

**WHY a distinct `from=witness` identity (the load-bearing choice).** The witness MUST be
distinguishable from a role's own `note` at a glance and by a pure fold, for two reasons:

1. **It lets `tics log` HIDE the witness without touching real coordination.** The hide filter
   keys on `from === "witness"` — so it removes ONLY witness notes and can NEVER accidentally
   hide a role's genuine `note`. (Symmetric to `collapseRunSuite`, which keys folding on
   `from === "run-suite"` so it only ever folds the referee's signals.)
2. **It lets `tics report` TALLY the witness without contaminating any other count.** The
   per-tool tally counts ONLY `from === "witness"` notes; a role's `note` (which carries a real
   role name as `from`) can never be miscounted as tool usage, and a witness note can never be
   mistaken for a role's coordination note.

A reused role name (or `run-suite`) would collide with existing semantics. A bare unmarked
`note` would be indistinguishable from a role's note — the log could not hide it safely and the
report could not tally it cleanly. The distinct, reserved `from=witness` string is the minimal
discriminator that makes both folds total and safe. **Lock the identity string: `witness`.**

### 2. The PostToolUse hook `tool-witness.sh` — opt-in, default-OFF (the degrade-safe floor)

A new PostToolUse hook `tool-witness.sh`, wired in `settings.json` on a **`*` matcher** (every
tool call), **gated by the knob `TOOL_WITNESS`**:

- **`TOOL_WITNESS=1` in `tdd.config` turns it ON; absent / `0` = OFF (the default).** The hook
  reads the knob first and **no-ops (exit 0, emits nothing) when off** — so an existing install
  that never sets the knob behaves EXACTLY as today: zero new tics, an unchanged bus, an
  unchanged `tics log`, an unchanged `tics report`. This is the load-bearing default.
- **When ON**, the hook reads the tool name from `.tool_name` and the optional path from
  `.tool_input.file_path // .tool_input.path` (jq with the grep fallback, mirroring
  `run-suite.sh:18-23`), then emits the §1 witness note via `emit_tic`.
- **Never throws.** Following `run-suite.sh` / `emit_tic` discipline (`set -uo pipefail`, the
  `|| true` append), a missing payload field, an absent jq, or an unwritable bus degrades to a
  no-op — the witness can never break the agent's tool call or the suite run.

Document the knob in `packages/tdd/kit/tdd.config` (commented; absent / `0` = OFF; default-safe
when the file or key is missing), the same posture as `ATTEST_ENFORCE` (0009) and
`CLAIMS_ENFORCE`. The knob is read by the SHELL hook (like `CLAIMS_ENFORCE`'s `:-…` read), not
by a Node fold.

### 3. `tics log` hides `from=witness` notes by default (`ticsLog`)

`ticsLog` (`tics-view.cjs:66`) FILTERS OUT `from === "witness"` notes by default — the
coordination thread stays readable exactly as it is today, even on a witnessed bus. This is the
same readability discipline as `collapseRunSuite` (which folds the referee's signal spam into
one row); here the witness notes are hidden rather than folded, because a per-tool record has no
useful collapsed form in the thread.

- **Default:** witness notes are hidden (the filter drops `from === "witness"`).
- **`--witness` flag (and/or folded into the existing `--all`):** SHOWS them, for when an
  operator wants the raw activity trace inline.
- The filter is purely additive in `ticsLog` and changes no other view. `tics inbox` is
  unaffected (witness notes are `to="*"`, but they are a record, not an ask; if inbox noise
  ever matters, the same `from === "witness"` filter applies — out of scope for v1).

### 4. `tics report` adds a per-tool usage tally (`report` in `cli.js`)

`report` (`cli.js:515`) ADDS a per-tool usage tally: a pure fold that counts `from === "witness"`
`note`s grouped by the tool name in `msg`. It renders BESIDE the existing layers/cycles/retries
table and the attestation split (`cli.js:552`) — a new section, e.g. "tool usage: Edit=N,
Read=M, Bash=K, …". The fold:

- Reads the bus (the same source `report` already loads), selects `from === "witness"` notes,
  groups by the tool name parsed from `msg`, and counts. A pure data function over the bus —
  fully unit-testable with crafted tics, no clock or I/O.
- **Degrade-safe:** an empty bus, an old bus, or a bus with zero witness notes (the
  default-off case) → NO tally section (or an empty one) and the existing report output renders
  unchanged. It never throws and never invents a count.

### 5. The honest framing — a RECORD, not a gate

E12 is **measurement, not enforcement: no hook EVER blocks on tool usage, and none is
proposed.** The witness RECORDS what tools a session used; it does not judge, threshold, or
fail on it. This is the same nudge-and-record posture as 0005/0006/0009/0010/0011. It is also
ORTHOGONAL to E8 (the honest gate) and E10 (evidence-gated greens): a witness note records
ACTIVITY — it does NOT make a green more trustworthy, prove a referee ran, or attest a code
state. It composes with them (it adds an activity surface beside the attestation surface) but
changes nothing about how greens are trusted.

The witness is the **ENABLER for the deferred OO metric**, which will be a SEPARATE consumer
that reads `from=witness` notes and classifies/aggregates them into an onboarding-overhead
signal. That classifier is explicitly OUT of scope here (below); E12 ships only the faithful
record + the hide/tally folds that keep it legible.

### 6. Which tools — `*` matcher, witness ALL when on (v1)

The `*` matcher witnesses ALL tool calls when the knob is on. v1 deliberately does NOT skip
self-referential bus reads (e.g. the agent running `tics`/`Bash` to read the bus). Keeping v1
simple (witness all when on) is the right floor: the opt-in/default-off bound already prevents
this from affecting any non-participating install, and a real consumer (OO) can filter or
classify on read. **De-pollution** (skipping bus-read tool calls, or self-referential `tics`
invocations) is noted as a possible follow-on, NOT v1 (below).

### 7. Degrade-safety + invariants

- **Knob off → the hook no-ops** (exit 0, emits nothing). An existing install that never sets
  `TOOL_WITNESS=1` is byte-for-byte unaffected: same bus, same `tics log`, same `tics report`.
  This is the load-bearing default.
- **Empty / no-witness bus → the read side is unchanged.** `tics report` shows no tally (or an
  empty one) and `tics log` is identical, because the hide-filter and the tally key on
  `from === "witness"` and there are none. No migration: an old bus has zero witness notes, so
  every read-side fold degrades to "as today."
- **Never throws.** The hook follows `run-suite.sh` / `emit_tic` discipline (missing field /
  absent jq / unwritable bus → no-op, never a stack trace); the folds are total (malformed /
  non-witness / `null` entries are simply skipped).
- **No bus contract change.** No new `tics.jsonl` field and no new tic kind: the witness is a
  `note` (existing kind) with the reserved `from=witness` (an existing field's reserved value)
  and `msg`/`ref` (existing slots). The single source-of-truth bus (0008) is unchanged in
  shape.
- **`kit/` is authoritative.** Build only the kit sources: the new `tool-witness.sh` under the
  kit hooks dir, the `settings.json` wiring + the `tdd.config` knob in the kit, the hide-filter
  in `packages/tics/kit/hooks/tics-view.cjs` (`ticsLog`), and the tally in
  `packages/team-tactics/bin/cli.js` (`report`). The installed `.claude/hooks/*` re-derive on
  the next dogfood install. The stale fossil hook copies under
  `packages/team-tactics/claim-session/.claude/hooks/` etc. are an H1 hygiene gap, NOT E12's
  job — do not edit them.
- Invariants upheld: zero runtime deps, pure Node CommonJS (Node ≥16) for the folds, POSIX
  shell for the hook; `node --test` stays green; `selftest` passes.

## Resolved contract risks

- **Bus volume — every tool call appends a line (the headline operational risk).** Resolved by
  §2/§3/§4: the witness is **opt-in and default-OFF**, so it adds ZERO tics to any install that
  doesn't choose it; the bus is **append-only, local, and gitignored**, so growth is local
  churn, not a committed-history or shared-state cost; `tics log` **hides** witness notes by
  default so the coordination thread stays readable on a witnessed bus; and `tics report`
  **aggregates** them into a compact tally. The HONEST LIMIT is stated, not hidden: a long
  WITNESSED session grows `tics.jsonl` (one line per tool call) — acceptable precisely because
  it is opted-in and bounded by the default-off floor, and the OO follow-on may sample or scope
  the trace if the volume ever needs trimming. v1 does not sample (keep it faithful; bound it
  with opt-in).
- **A witness note confused with a role's coordination note / contaminating a count.** Resolved
  by §1: the distinct, reserved `from=witness` identity makes both folds key on a value no role
  ever emits — the log hide can NEVER drop a role's `note`, and the report tally can NEVER
  miscount a role's `note` as tool usage. The identity string is locked.
- **Reusing `note` + the bus rather than a new kind / a separate witness store.** Resolved by
  §1/§7: a new tic kind or a separate store would (a) split the single source-of-truth bus that
  0008 deliberately consolidated, and (b) — for a new kind — be absent on every prior bus,
  breaking old-bus degrade-safety and forcing a migration. The existing `note` kind + the
  reserved `from=witness` carry the record with zero new contract, hidden-by-default for
  readability and tallied on read.
- **A witnessed install breaking the agent's tool call or the suite.** Resolved by §2: the hook
  follows `run-suite.sh`'s `set -uo pipefail` + `|| true` discipline and no-ops on any missing
  field / absent jq / unwritable bus — it can never throw into the tool call.
- **The read-side folds throwing on a malformed / legacy bus.** Resolved by §3/§4/§7: the hide
  filter and the tally are total — non-witness, malformed, and `null` entries are skipped; an
  old/empty bus yields an unchanged log and no tally; neither fold ever throws or invents a
  count.

## Consequences

- The bus gains a **faithful per-tool activity record** (a `note from=witness` per tool call)
  WITHOUT a new kind, a new envelope field, a server, or a separate store — the enabler for the
  deferred OO metric, which becomes buildable against a stable witness-note shape.
- One small PostToolUse hook (`tool-witness.sh`, `*` matcher, gated by `TOOL_WITNESS`) + one
  knob in `tdd.config` + one hide-filter in `ticsLog` + one per-tool tally in `report`.
  Everything else (the bus, `emit_tic`, the `note` kind, `tics log`, `tics report`,
  `loadSignalEvents`/`loadTics`) is reused unchanged. The tally is a pure data function →
  fully unit-testable with crafted tics.
- **No bus contract change.** No new `tics.jsonl` field and no new tic kind: the witness is a
  `note` with the reserved `from=witness`. Old buses replay with zero migration (no witness
  notes → an unchanged log and no tally).
- **Default behavior unchanged for every existing install.** Knob off (the default) → the hook
  no-ops, the bus is identical, `tics log` and `tics report` are identical. Nobody's bus
  changes shape or volume unless they opt in.
- **A RECORD, not a gate.** No hook blocks on tool usage; E12 makes activity VISIBLE and
  TALLYABLE, the same nudge-and-record family as 0005/0006/0009/0010/0011. It composes with
  E8/E10 but is orthogonal — it records activity, it does not make greens more trustworthy.
- The honest limit is acknowledged: a long witnessed session grows the (local, gitignored,
  append-only) jsonl by one line per tool call — bounded by opt-in/default-off, made readable
  by log-hide and report-tally, with sampling/scoping deferred to the OO follow-on.
- Invariants upheld: zero runtime deps, pure Node CommonJS (Node ≥16) for the folds, POSIX
  shell for the hook; `node --test` stays green; `selftest` passes; `kit/` authoritative (the
  fossil hook copies are H1, not E12). Status: Accepted — we build it this session.

## Out of scope (explicitly rejected or deferred for this ADR)

- **The OO (onboarding-overhead) classifier / metric itself.** E12 ships the RECORD (the
  witness notes) + the hide/tally folds; the metric that CONSUMES those notes — classifying and
  aggregating them into an onboarding-overhead signal — is a SEPARATE later consumer with its
  own contract decision and ADR. Explicitly NOT E12.
- **A separate witness store** (a dedicated `witness.jsonl` or a side channel). Rejected — it
  splits the single source-of-truth bus that 0008 consolidated (deprecating `telemetry.jsonl`).
  The witness writes to the one bus as a `note from=witness`.
- **A new tic kind or a new envelope FIELD for the witness.** Rejected, same as 0009/0011/0012
  rejected a new field/kind: a new kind/field is absent on every prior bus → breaks old-bus
  degrade-safety and forces a migration; the existing `note` kind + the reserved `from=witness`
  + the existing `msg`/`ref` slots already carry the record.
- **Any hook GATE on tool usage.** Out of scope by design (§5) — E12 is a record/measurement,
  not a gate; the value is a faithful trace, not coercion. No PostToolUse/Stop gate fails on
  tool usage, and none is proposed.
- **De-pollution / skipping self-referential bus reads** (e.g. not witnessing the agent's own
  `tics`/bus-read tool calls). v1 witnesses ALL tools when on (§6); filtering or de-polluting
  the trace (or sampling a high-volume session) is a possible follow-on, NOT v1. The opt-in /
  default-off floor and the OO consumer's read-side filtering bound the concern for now.
- **Witnessing when OFF / making the witness default-on.** Rejected — default-off is the
  load-bearing degrade-safe floor; a default-on witness would change every install's bus volume
  and `tics log` on update.

## Alternatives considered

- **A separate witness stream / store** (a dedicated witness log distinct from the bus).
  Rejected: it contradicts the single-bus direction 0008 set (which deprecated the old
  `telemetry.jsonl` in favor of bus signals). A second store would re-fragment telemetry,
  duplicate the read/aggregate plumbing, and give the OO consumer two sources to reconcile. The
  merged design keeps ONE store — a `note from=witness` on the existing bus — hidden-by-default
  for readability and tallied on read.
- **A new dedicated `witness` (or `tool`) tic kind / an envelope field for the tool name.**
  Rejected: a new kind/field is absent on every prior bus, breaking old-bus degrade-safety and
  forcing a migration — for no gain, because the existing `note` kind carries the record and the
  `msg`/`ref`/`from` slots carry the tool name, path, and identity. The reserved
  `from=witness` value is the whole discriminator the folds need.
- **Show witness notes inline in `tics log` (no hide-by-default).** Rejected: it pollutes the
  coordination thread — a witnessed session would bury the delegates/handoffs/verdicts under a
  per-tool-call stream. The merged design HIDES witness notes by default (keyed on
  `from === "witness"`, like `collapseRunSuite` folds the referee's spam) and exposes them via
  `--witness`/`--all` when the raw trace is wanted.
- **Witness all tools always (no opt-in knob).** Rejected: it would change every install's bus
  volume and `tics log` on update, violating degrade-safety. The merged design gates the hook
  on `TOOL_WITNESS=1` (default OFF), so an existing install is byte-for-byte unaffected until it
  opts in.
- **The merge:** generalize `run-suite.sh`'s PostToolUse capture to a `*` matcher and emit a
  `note from=witness` (beats "new-kind/store" — one bus, no field, no migration), gated by an
  opt-in `TOOL_WITNESS` knob default-off (beats "always-on" — degrade-safe), hidden by default
  in `tics log` and tallied in `tics report` (beats "shown-inline" — the thread stays
  readable). One small hook + one knob + one log-hide + one report-tally. That is the locked v1
  contract above.
