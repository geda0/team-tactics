# 0003 — Multi-session COOPERATION on one working tree (combine power, don't isolate)

- Status: **Superseded by ADR 0015** (parallel isolation via git worktrees). Was: Proposed.
- Date: 2026-06-05
- Feature: (backlog) multi-session cooperation — see the slice breakdown at the foot
- Deciders: architect (seam), product-owner (scope), human navigator (principle)
- Supersedes: **ADR 0002 in part.** 0002's *safety substrate* (session identity, the
  `MULTI_SESSION` fail-closed guard, the pre-commit cross-session claim-check, the
  `RELEASE` lock) stands and is reframed here. 0002's *recommendation* — "the cleaner
  long-term answer is **one git worktree per session**" (0002 §Boundary, §Alternatives,
  and the MS6 doc it produced) — is **REVERSED** by this ADR.
- Scope: `@ttics/tics` (the bus verbs + reader views — `tics sessions`, `inbox`,
  `conductor`), `@ttics/tdd` (the SubagentStop/Stop hooks where a presence handshake
  attaches), and the protocol/recipe docs. **No change to the on-bus record shape**:
  every cooperation move below is an existing tic kind addressed to a session id. The
  additions are *conventions + one presence handshake + a worker-loop recipe*, not a
  new store or new mechanism.

## Context

### The principle correction

ADR 0002 solved "two sessions collided on one tree" and then recommended the
structurally cleanest *isolation* — one `git worktree` per session. The navigator has
corrected the principle:

> Separate worktrees defeat our purpose and separate our power. The whole idea of the
> framework is COOPERATION and power COMBINATION — horizontal scaling. A multi-session
> should use the SAME work-dir and JOIN FORCES with the running session (master/worker,
> or joint-forces sharing work).

This is right, and it is a *purpose* correction, not a mechanism one. A worktree forks
the team into two teams working two trees: it removes collisions by removing
cooperation. That is the opposite of the goal. The goal is **N sessions on ONE shared
tree, combining their throughput toward one shared effort** — adding a session is like
adding a worker to a team, not spinning up a parallel universe. More hands on the same
table, not a second table.

So the model is no longer "isolate so you don't collide." It is "**cooperate on one
tree; the safety substrate makes cooperating safe.**"

### What 0002 already shipped — reframed as the cooperation substrate

0002's mechanisms (MS1–MS4, MS6) shipped and are **kept**. Their *purpose* is recast:
they are not isolation — they are the **anti-double-work / anti-clobber hygiene** that
lets sessions share one tree *without stepping on each other*:

| Shipped (0002) | Was framed as | Reframed purpose (this ADR) |
|---|---|---|
| **MS1** `session` field on every tic + `tics sessions` | session identity | the **presence + attribution** layer cooperation needs: who is live, where, holding what |
| **MS2** `MULTI_SESSION=1` fail-closed on unscoped edits | safety default | makes each session *declare a lane* so two workers never silently write the same file |
| **MS3** pre-commit cross-session claim-check | index-race fix | lets workers commit independently on the shared tree without capturing each other's half-written files |
| **MS4** `RELEASE` lock (claim on `RELEASE`) | release-race fix | serializes the one *shared* act (cut a release) so cooperating workers don't both bump+tag |

That substrate is the floor. On top of it, **cooperation is almost entirely already
present in the bus**, and what is missing is small.

### The cooperation primitives already on the bus (read in `packages/tics/kit/hooks/`)

Two sessions on one tree share one bus (`tics.jsonl` / `tics.d/`). Everything that
reads or writes it is cross-session by construction. The coordination verbs already
exist and already work across sessions:

- **`delegate` / `handoff`** — assign a slice / return it with its result. `to` is a
  free-form addressee; `tic.sh` does not constrain it to a role (it rejects only
  leading-`-` flag bleed). **A `delegate` addressed `to <session-id>` is already a
  legal tic** — assigning work to a *session* needs no new kind, only a convention.
- **`inbox <name>`** — `ticsInbox` filters `to ∈ {<name>, *}`. It takes any string, so
  **`tics inbox <session-id>` already returns that session's work queue today.** The
  per-session work queue exists; it is just undocumented and unaddressed-by-convention.
- **`claim` / `release` / `section`** — partition + ownership on the shared tree, with
  `activeClaims` as the single source of truth, auto-claim on edit, release-on-done.
  This is exactly the "a worker owns its slice while it works it" primitive.
- **`need` / `contract`** — request help / publish a seam. `need` is precisely the
  "I'm blocked, a peer please join" signal; `contract` hands a seam to whoever picks
  up the dependent slice.
- **`tics sessions` / `tics conductor`** — the coordination views: who is active
  (sessions) and the cross-scope claims/needs/contracts picture (conductor).

So the bus is *already* a shared work-queue + coordination medium across sessions. The
honest statement: **most of cooperation is reuse.** What is genuinely missing is the
*entry and flow* — how a fresh session JOINS a running effort, signals it is available,
receives a slice, and how a lead hands one to a *specific* session.

### What is genuinely NOT covered (the real, small gap)

1. **No JOIN / presence handshake.** The `session` kind exists (open/close, MS1), but
   *nothing emits `session open` automatically* and there is no convention for a fresh
   session to announce "I'm here and available for work." `tics sessions` shows a
   session only *after* it has emitted some tic; a session that wants to join an effort
   has no defined first move and no "available" signal a lead can see.
2. **No assign-to-session convention.** `delegate to <session-id>` is *legal* but
   *undocumented*; there is no agreed addressee form, so a lead session has no
   conventional way to route a slice to a named worker (vs. broadcasting to a role).
3. **No worker loop.** There is no documented "poll my inbox → claim the slice →
   execute → hand back → pull the next" recipe. The pieces (inbox, claim, handoff)
   exist; the loop that strings them into horizontal scaling does not.
4. **No "pass a slice I can't finish" convention for peers.** `handoff` returns work to
   the orchestrator; there is no documented `handoff to *` ("anyone available, take
   this") for the leaderless joint-forces case.

Every one of these is a **convention or a tiny presence emit**, not a new mechanism.

## Decision

Adopt **multi-session cooperation on one shared tree**, in two patterns that share one
substrate and one bus. Reverse 0002's worktree recommendation. Add exactly **one thin
mechanism (a presence/JOIN handshake)** and a set of **conventions** layered on the
existing verbs; reuse everything else.

### The model (one tree, combined power)

- **One working tree, one shared bus** (`TIC_STORE=spool` so concurrent appends are
  race-free — already required by 0002 MS-substrate). Sessions are *workers on one
  team*, not separate teams. Throughput scales horizontally by adding sessions.
- **`MULTI_SESSION=1`** is on whenever >1 session shares the tree (0002 MS2): every
  session declares a lane (scope), so cooperating workers never silently collide.
- Cooperation flows over the **existing verbs**: `delegate`/`handoff` move work,
  `inbox` is each session's queue, `claim`/`section` own a slice while it's worked,
  `need`/`contract` ask for / publish help, `tics sessions`/`conductor` are the
  coordination views.

### Pattern A — Master / worker (a conductor + joiners)

A **lead session** partitions the goal into sections/slices and assigns each to a
**worker session**; workers poll, claim, execute on the shared tree, hand back, and
pull the next. Add a worker session ⇒ add throughput.

**JOIN handshake (the thin new mechanism):**

1. A fresh session picks an id and announces presence + availability:
   ```
   echo S-w2 > .claude/state/session
   tic.sh S-w2 "*" session open "worker available" S-w2 open
   ```
   `session open` with msg "available" is the **"I'm here, give me work"** signal. It
   shows immediately in `tics sessions` (status `active`), so the lead sees the new
   worker. (This is the one genuinely new emit-point; see "thin mechanism" below for
   how it can be automated so a worker need not remember it.)
2. The lead sees the joiner in `tics sessions` and assigns a slice **addressed to that
   session id**:
   ```
   tic.sh S-lead S-w2 delegate "slice: ranking RankedFeed sort" ranking/S2
   ```
   `delegate to S-w2` is an existing kind with a session-id addressee (the new
   convention, not a new kind).

**Worker loop (the recipe):**

```
# once: join
echo S-w2 > .claude/state/session
tic.sh S-w2 "*" session open "worker available" S-w2 open

# loop:
.claude/hooks/tics inbox S-w2          # my queue: delegates to me (or *)
echo ranking/S2 > .claude/state/scope  # take the assigned lane (claims engage)
#   … edit — auto-claim owns my files; rival sessions are kept out by claim-check …
tic.sh S-w2 S-lead handoff "slice done (suite: green)" ranking/S2 green
tic.sh S-w2 "*" section done ranking ranking done   # frees the lane for reassignment
#   → back to inbox for the next delegate; if none, emit session open "available" again
```

The lead drives the outer plan (PLAN/partition), reads `tics conductor` to see each
worker's section/claims, reassigns freed sections, and runs `tics gate` before any
release. **The existing orchestrator/conductor IS the lead**; a worker session is a new
peer that the lead delegates to over the bus instead of spawning a subagent in-process.
The difference from in-process fan-out: a *subagent* is one session's child; a *worker
session* is its own Claude session that joins the same tree — that is the horizontal
scaling.

### Pattern B — Joint-forces (peers, no fixed master)

No designated lead. Any session may pick up unclaimed/announced work, pass work it
can't finish, or call for help — the bus is the shared queue.

- **Take an announced/unclaimed slice.** A slice offered to the pool is a
  `delegate to "*"` (or a `section` that is open but unclaimed). A peer claims it by
  setting its scope and editing (auto-claim takes ownership; first toucher wins, so two
  peers grabbing the same slice resolve at the claim, not by collision).
- **Pass a slice you can't finish.** `handoff to "*"` ("anyone available, take this")
  — a peer-to-pool handoff (vs. the master/worker `handoff to S-lead`). Release your
  claim so a peer can take it: `release <ref>`.
- **Call a peer to join.** `need "extra hands on ranking"` (existing kind) is the
  joint-forces "please join" signal; an available peer answers by claiming the slice.
- **Availability** is the same `session open "available"` presence signal as Pattern A;
  peers watch `tics sessions` to see who is free.

Both patterns are the *same primitives*; master/worker just designates one session as
the partitioner. A team can start joint-forces and elect a lead, or a lead can drop and
the rest continue as peers — no mechanism change either way.

### The thin new mechanism vs. pure convention (be honest)

| Cooperation need | Reused (already works) | Genuinely new |
|---|---|---|
| Per-session work queue | `tics inbox <name>` (takes any addressee) | nothing — `inbox <session-id>` works today |
| Assign work to a session | `delegate` (free-form `to`) | **convention only:** address `to <session-id>` |
| Own a slice while working it | `claim`/`section` + auto-claim + release-on-done | nothing |
| Request help / publish a seam | `need` / `contract` | nothing |
| Pass work to the pool | `handoff` (free-form `to`) | **convention only:** `handoff to "*"` |
| See who's live + where | `tics sessions`, `tics conductor` | nothing |
| **JOIN / "I'm available"** | the `session` open/close kind (MS1) | **the one thin mechanism:** a `session open "available"` *presence emit* + the convention/automation that a fresh session emits it on start (and re-emits when idle/available) |

The single honestly-new piece is the **presence handshake**: a session emitting
`session open` (available) on entry so it appears in `tics sessions` and can be
assigned to. Everything else is convention over verbs that already exist. To make the
handshake not depend on a worker *remembering* to emit it, it can be wired the way MS1
already wires session identity: a session-start emit (the same place `.claude/state/session`
is read) emits `session open` when `MULTI_SESSION=1` and a session id is set — and the
Stop/SessionEnd hook already-specified in 0002 §3 emits the matching `session close`
(which auto-releases the session's claims, so a worker leaving frees its lane for the
next worker). That wiring is the only code beyond docs; the rest of cooperation is the
recipe doc and the addressing convention.

### What this REVERSES in 0002

0002 said the *structurally stronger* answer is one worktree per session and the
same-tree machinery is the fallback for the case adopters "fall into by accident." This
ADR inverts that ranking:

- **Same shared tree is the RECOMMENDED, primary model** — it is what enables
  cooperation/horizontal scaling. The 0002 safety substrate is what makes it *safe*,
  so the case adopters land in is also the recommended case (no more "you fell into the
  fallback").
- **Worktree-per-session is demoted to a niche escape valve**, not a recommendation:
  use it only when two efforts are genuinely *independent* (different features that
  must not share a tree) — i.e. when you explicitly do NOT want to combine power. By
  definition that is *not* multi-session cooperation; it is two separate single-session
  runs that happen to share a repo, and `tics … --all` still unions their buses for
  visibility.

0002 §1 (session identity), §2 (release lock + pre-commit check), §3 (release-on-stop +
TTL), §4 (fail-closed) all **stand unchanged** — they are the substrate this builds on.

### The boundary (state it honestly)

- **A referee, not a sandbox** (unchanged from 0001/0002). The PreToolUse guard still
  can't see programmatic/indirect writes; the pre-commit claim-check remains the
  backstop at the choke point. Cooperation does not change this — it relies on it.
- **Not a distributed scheduler.** Assignment is advisory tics on an
  eventually-consistent append-only bus. Two sessions can momentarily both believe they
  hold an unassigned slice; the **claim** (first toucher wins) and the **pre-commit
  check** are the real serialization points, exactly as in 0002. At human/agent
  timescales (seconds), this is sufficient — the same trade the project already makes
  by avoiding SQLite.
- **Presence is best-effort.** `session open "available"` is a hint, not a lock; a
  worker that crashes after announcing availability is reaped by the 0002 §3
  release-on-stop / TTL sweep, so a stale "available" worker doesn't wedge the lead
  (the lead simply reassigns the freed lane).
- **The lead is a role, not a privilege.** Nothing enforces a single master; "lead" is
  whichever session chooses to partition. Two sessions both trying to lead is a
  coordination smell visible in `tics conductor` (two partitioners), resolved socially
  — the framework surfaces it rather than locking it.

## Consequences

- **Positive.** The framework now expresses its actual purpose — *combine power on one
  tree* — with almost no new mechanism: cooperation is the existing bus verbs +
  conventions + one presence handshake. Horizontal scaling is "add a worker session,"
  and the 0002 substrate makes that safe (lanes, claim-check, release lock, reaping).
  Master/worker and joint-forces are the *same* primitives, so teams flow between them
  without reconfiguration. Zero-dep / Node≥16 / bash-hook portability invariants are
  preserved (no daemon, no scheduler, no new store).
- **Negative / accepted.** "Lead" and "available" are conventions, not enforced — two
  would-be leads or a forgotten join are possible (mitigated by the conductor view
  surfacing both, and by auto-emitting `session open` on start). The bus is not a true
  scheduler, so slice assignment is advisory and the real serialization is the
  claim/commit (documented). A worker that ignores its inbox is simply idle — the
  framework records, it does not compel.
- **Record shape.** No change. Every cooperation move is an existing kind
  (`session`/`delegate`/`handoff`/`claim`/`release`/`need`/`contract`) with an
  addressee that may now be a session id. Old logs are unaffected.
- **Doc change required.** The MS6 section of `tic-protocol.md` (`## Multiple sessions
  on one repo`) currently *recommends* one worktree per session (step 4) — that
  recommendation is now wrong and must be replaced by the cooperation recipe (see
  "What to change in the MS6 doc," below, and the C5 slice). The kit copy
  (`packages/tics/kit/docs/tic-protocol.md`, byte-identical today) must change in
  lockstep.
- **Proof obligations (for the implementing loop, not this ADR).** Each slice ships
  with a test: a `session open "available"` round-trips and the session shows `active`
  in `tics sessions`; `tics inbox <session-id>` returns a `delegate` addressed to that
  id; a worker setting the assigned scope auto-claims its files and a *rival* session
  is blocked by claim-check while the *same* session is not; a `handoff to "*"` and a
  `need` appear in `tics conductor`; a `session close` auto-releases the worker's claims
  (frees the lane). No test should assert worktree isolation — that path is demoted.

## Alternatives considered

- **Keep 0002's worktree-per-session recommendation.** Rejected on principle: it
  isolates and so *defeats* cooperation/power-combination, which is the framework's
  purpose. Demoted to a niche escape valve for genuinely independent efforts.
- **A real scheduler / work-queue daemon (assign-and-lease, leader election).**
  Rejected: breaks zero-dep / portability for wins not needed at session scale, and
  duplicates what the bus + claim already provide. The bus is the queue; the claim is
  the lease; `tics sessions` is the presence view — a daemon adds a second mechanism
  for nothing.
- **A new `join`/`available` tic kind.** Considered, rejected as unnecessary: the
  `session` kind (open/close, MS1) already models presence, and `session open` with msg
  "available" *is* the join signal. Adding a kind would fragment the lifecycle. The
  thin mechanism is *emitting* `session open` on start (automation + convention), not a
  new kind. (If a dedicated "available/idle" beacon later proves needed — e.g. to
  distinguish "open but busy" from "open and idle" — it should be a `result`/`msg`
  convention on the existing `session` kind, not a new kind.)
- **A new `assign` kind for master→worker.** Rejected: `delegate` already means
  "hand a slice down" and its `to` is free-form; `delegate to <session-id>` is the
  assignment with zero new mechanism. Re-using `delegate` also means the existing
  inbox/conductor views render assignments for free.
- **Enforce a single master (lock the lead role).** Rejected: the framework surfaces
  coordination, it doesn't impose org structure; joint-forces (no master) is a
  first-class pattern. Two leads is a visible smell, not an error to lock out.
