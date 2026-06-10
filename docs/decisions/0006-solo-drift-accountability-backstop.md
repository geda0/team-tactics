# 0006 — Solo-drift accountability backstop

- Status: Accepted
- Date: 2026-06-10
- Deciders: navigator ("notice substantial solo-drift at session end, don't force
  delegation"), architect (Stop-hook seam + the session-scoped tic count)
- Relates to: 0005 (full framework by default). This is its detection backstop.

## Context

ADR 0005 flipped the stance to full-team-by-default and renews the directive every
prompt (`prompt-directive.sh`). But a nudge is not a check: full-team is **installed +
nudged, not observable**. It happened in the wild — an orchestrator session shipped
**5 releases with ZERO delegations**; nothing surfaced it until the bus was read after
the fact. BUILT ≠ ACTIVATED has a sibling failure: **ACTIVATED-BY-DEFAULT ≠ ACTUALLY-USED.**

We want substantial solo-drift **noticed at session end**, not silent. Constraints from
the navigator:

- **Non-blocking.** Delegation is a workflow choice; a solo session can be the right
  call (a one-line fix, a spike). The backstop must NEVER prevent stop. It is a NOTE.
- **Low-noise.** It must trip only on *substantial* solo work — never on a quick fix or
  a read-only session. A nag that fires on trivial work gets muted and the signal dies.
- **Opt-out.** A knob to silence it entirely.

Key signal insight (why this is cheap and reliable):

- **`handoff` tics are an un-forgeable "the team was engaged" signal.** The SubagentStop
  hook (`subagent-handoff.sh`) auto-emits a `handoff` whenever *any* subagent returns.
  No agent has to remember to call `tic.sh` — engaging the team emits the proof. (More
  robust than manual `delegate` tics, which depend on an explicit call.)
- **`signal` tics measure substantial work.** `run-suite.sh` emits exactly one `signal`
  per suite run — roughly one per red/green cycle. Counting them since session start is
  a faithful proxy for "real work happened this session."

So the trip is a pure read of the bus: **full-team installed AND signal-tics-since-start
≥ threshold AND zero handoff-tics-since-start.**

## Decision

1. **Placement — a NEW Stop hook, `solo-drift-check.sh`, wired alongside
   `require-green-to-stop.sh`** (not folded into it). The green gate is a *blocking*
   correctness check that re-runs the suite; this is a *non-blocking* accountability
   NOTE that only reads the bus. Folding mixes a blocker with an advisory in one exit
   path and couples two unrelated failure modes; the cost of a separate hook is purely
   mechanical (settings wiring + both installer lists + the "every wired hook exists"
   guard) and the kit already pays that cost for six hooks. Clean separation wins.

   Wire it on **`Stop` only**, not `SubagentStop`. SubagentStop fires when a *subagent*
   returns — and any SubagentStop firing means a handoff was just emitted, so by
   definition the session is not solo. The backstop belongs at the end of the
   orchestrator's turn (`Stop`).

2. **Session scoping — a SessionStart marker.** `session-green-check.sh` (SessionStart)
   stamps `.claude/state/session-started` with an ISO8601 UTC timestamp
   (`date -u +%Y-%m-%dT%H:%M:%SZ`) — the same format `emit_tic` writes to the bus's
   `ts`. The Stop hook counts `handoff` and `signal` tics whose `ts >= marker`. ISO8601
   UTC sorts lexicographically, so a plain string `>` comparison in POSIX sh is correct
   ordering — no date math.

   - **No marker → fail-open (no nag).** A pre-0006 session, a hand-run, or a session
     that never hit SessionStart simply isn't scoped; silence is correct.
   - **Multi-session caveat (accepted):** the marker is one shared file, so concurrent
     sessions on one tree overwrite each other's start time. The count then covers "since
     the most recent SessionStart" rather than strictly this session. Acceptable: the
     common case is single-session, and the failure mode of the shared marker is
     *under*-counting (a later session resets the clock) → *fewer* false nags, never a
     wrong block. Multi-session teams coordinate through the bus already.

3. **Trip condition (all three; else silent):**
   - full-team installed — `.claude/agents/product-owner.md` exists; and
   - `signal`-tics with `ts >= marker` **≥ `SOLO_DRIFT_CYCLES`** (default 3); and
   - `handoff`-tics with `ts >= marker` **== 0**.

   On trip: print a prominent multi-line NOTE to **stderr** naming the solo-drift (N
   cycles, 0 handoffs) and pointing at the team + the opt-out, then **`exit 0`** (must
   not block). Below threshold, any handoff, no marker, or minimal install → silent
   `exit 0`. Count BOTH stores (jsonl append + `tics.d/*.json` spool), matching
   `emit_tic`'s own seq computation, so a spool-mode bus is read too.

4. **Config (lib.sh defaults + tdd.config template):**
   - `TEAM_ACCOUNTABILITY=1` (default on; `0` disables the whole check).
   - `SOLO_DRIFT_CYCLES=3` (signal-tic threshold to count as "substantial").

5. **Edges:** minimal install (no product-owner.md) → never nags (the team isn't even
   installed, so solo is the only mode). No marker → no nag. Below threshold → silent.
   ≥1 handoff → silent. Non-Claude-Code tools don't fire `Stop` (CC-only); that's fine —
   the portable git hooks cover commit/push paths for those.

## Consequences

- Solo-drift on a real body of work is surfaced **at session end, every time**, while a
  quick fix or read-only session stays silent — the low-noise bar the navigator set.
- The check is a pure bus read (plus one `[ -f ]`): no suite run, negligible cost, no
  blocking path. It can never wedge a stop.
- One more hook on the kit's settings surface + both installer lists + the guard test —
  the standard mechanical cost, paid once.
- It measures *engagement* (any handoff), not *quality* of delegation — a session with a
  single token handoff reads as "team engaged." Accepted: this is an accountability
  backstop, not a workflow auditor; richer "did you delegate the *right* things" analysis
  belongs to `tics report`, not a Stop nag.
- Shared-marker under-count on concurrent sessions biases toward silence, not false
  alarms (see Decision 2).

## Alternatives considered

- **Fold into `require-green-to-stop.sh`.** Rejected: mixes a blocking correctness gate
  with a non-blocking advisory; two failure modes in one exit path is the kind of
  coupling the kit avoids elsewhere.
- **Block on solo-drift.** Rejected by the navigator's framing — delegation is a choice;
  forcing it would punish legitimate solo sessions and breed work-arounds.
- **Count manual `delegate` tics instead of `handoff`.** Rejected: `delegate` requires an
  explicit `tic.sh` call the orchestrator can forget; `handoff` is auto-emitted by the
  SubagentStop hook, so it can't be skipped while still using the team.
- **A wall-clock or edit-count threshold for "substantial."** Rejected: `signal` tics
  already exist, are hook-emitted (un-forgeable), and map directly to cycles — no new
  bookkeeping.
- **A SessionEnd hook instead of Stop.** The kit standardizes on `Stop`/`SubagentStop`
  for end-of-turn (the green gate lives there); reuse the established seam.
