# 0002 — Multi-session coordination on one working tree (concurrent sessions, one repo)

- Status: Proposed
- Date: 2026-06-05
- Feature: (backlog) multi-session mode — see slice breakdown at the foot of this ADR
- Deciders: architect (seam), product-owner (scope)
- Scope: `@ttics/tics` kit (`tics-lib.sh` emit, `tics-view.cjs` reader, `tic.sh`,
  the `tics` reader CLI, the `tics`/`tdd` githooks); `@ttics/tdd` kit
  (`guard-edit-scope.sh`, the SubagentStop/Stop hooks). No change to the on-bus
  record shape is required for the core; the additions are new tic *kinds* and two
  new gates, not a new store.

## Context

The product's coordination model assumes **one orchestrated run** per working tree:
an orchestrator sets `.claude/state/{phase,layer,scope}` and fans work out to
subagents, and the edit-scope guard (ADR-shaped by `guard-edit-scope.sh`) keeps the
fan-out's writes disjoint via auto-claims on the shared tic bus.

Today (observed live) **two separate Claude sessions edited the same git working
tree at once** and collided three ways:

1. a **shared git index** — one session ran `git add`/`git commit` while the other
   was mid-edit, so the commit captured a half-written tree;
2. **overlapping edits** to one file (`packages/team-tactics/bin/cli.js`) — both
   sessions wrote it;
3. **racing version bumps** — both sessions drove toward a release, each bumping
   `package.json` / preparing a tag, unaware of the other.

The framework prevents disjoint-write collisions **within** one orchestrated run, but
**nothing coordinated the two sessions.** The two sessions are not two pairs under one
conductor; they are two conductors. There is no shared notion of "who is live, where,
and under which scope," and the git/release step is outside the claim mechanism
entirely.

### What the existing primitives already give us (the load-bearing insight)

Two sessions on **one tree share one bus** — `.claude/state/tics.jsonl` (or the
`tics.d/` spool). Everything that reads or writes that bus is therefore already
cross-session by construction. In particular:

- **Claims already enforce disjoint writes across sessions.** `guard-edit-scope.sh →
  claim_guard()` runs on every `Edit|Write|MultiEdit` **and** (ADR 0001) every Bash
  write-redirect. When `.claude/state/scope` is set it (a) `claim-check`s the path
  against the shared bus and **blocks (exit 2)** any path actively held by *another*
  scope, and (b) auto-claims a still-unclaimed path for the editing scope. The reader
  (`activeClaims`/`claimCheck` in `tics-view.cjs`) is the single source of truth and
  reads the shared bus. So **collision #2 is already solved** — *provided* the two
  sessions set **distinct scopes**.

  This is the pivot of this ADR: most of the file-level cross-session safety is
  **convention + discoverability** (two sessions must each pick a distinct scope, and
  must have the guard armed), **not new mechanism.**

- **The bus is concurrency-safe in spool mode.** `TIC_STORE=spool` writes one file per
  tic under `tics.d/` (no shared-file append or `seq` race). Two sessions appending to
  the default single `tics.jsonl` *can* interleave/garble a line; spool mode removes
  that. Multi-session mode should therefore **require `TIC_STORE=spool`.**

- **`--all` already merges across worktrees.** If the two sessions ever move to
  *separate* git worktrees of the same repo (the cleaner answer; see "Boundary"),
  `loadTicsAll` already unions their buses, so `tics conductor`/`claims` see both.
  Sharing the bus is solved; only the *meaning* (sessions) is missing.

### What is genuinely NOT covered (the real gaps)

1. **Session identity.** A session has no stable id, does not announce itself, and is
   not visible in any view. `tics conductor`/`sections` group by **scope**, not by
   session, and there is no "who is live right now" anywhere. Two sessions can also
   silently pick the *same* scope (or both leave scope unset), which **defeats**
   claim enforcement (`claim_guard` returns early when `scope` is empty;
   `scopeMatch(s, s)` is always true, so same-scope sessions never block each other).

2. **The git / release level is outside claims entirely.** Claims gate **tool edits**.
   They do **not** gate:
   - `git add` / `git commit` / tag / version bump — the **staging+index race**
     (collision #1) and the **release race** (collision #3) live here;
   - **programmatic writes that bypass the guard** — `node -e "fs.writeFileSync('package.json', …)"`,
     `sed -i`, a helper script. This is the **same bypass class ADR 0001 documents as
     irreducible** for a PreToolUse hook, and crucially ADR 0001's Bash branch only
     catches `>`/`>>`/`tee`, **not** a programmatic write. A version bump done via
     `npm version` or `node -e` therefore claims nothing and races freely.

   So the highest-stakes collisions (the index and the release) are exactly the ones
   the claim guard cannot see.

3. **Staleness.** A session that dies (crash, closed terminal, `kill`) leaves its
   claims **active forever** — there is no release-on-stop and no TTL. The next session
   is then blocked by a ghost. (`section done` auto-releases a *section's* claims, but
   that is a deliberate "this work shipped" act, not death recovery.)

4. **The no-scope default is unsafe under concurrency.** Single-session, "no scope"
   sensibly means "unconstrained, don't partition." Multi-session, two unscoped
   sessions race with **zero** enforcement. The default must change *in multi-session
   mode*: **fail-closed** (require a scope) rather than fail-open.

## Decision

Model multi-session coordination as **"a session is a top-level scope namespace, and
the shared bus is the coordinator."** No new store, no daemon, no lockfile-as-truth:
the append-only bus that already carries claims also carries **session presence** and
**release intent**, and two new gates consult it. We add tic *kinds* and gates; we do
not add a second mechanism.

### 1. Session identity — a `session` tic + a session-stamped scope (NEW kind, REUSED bus)

Introduce a `session` tic kind (open/close lifecycle, mirroring `section`):

```
tic.sh <sid> "*" session open  "<label>"  <sid> open
tic.sh <sid> "*" session close "<label>"  <sid> done
```

- **Session id (`sid`)** is a short stable token chosen at session start. Prefer Claude
  Code's session identifier if exposed to a hook; else `S-<short-hostname>-<pid>` or a
  user-supplied label (`S-release`, `S-feat-auth`). It is recorded in
  `.claude/state/session` (a new state file) so every emit can stamp it.
- **`emit_tic` stamps the session.** `tics-lib.sh` reads `.claude/state/session` (or a
  `TICS_SESSION` env override, mirroring `TICS_SCOPE`) and writes it as a new
  `session` field on **every** tic. This makes *every* claim/handoff attributable to a
  session, which is what lets a stale-claim sweep (gap 3) and the conductor (gap 1)
  know *who* owns what. The field is additive — older readers ignore an unknown key;
  the reader's dedup key (`tics-view.cjs` `push`) should include `session` so two
  sessions' otherwise-identical tics don't collapse.
- **Scope is namespaced under the session, not invented per session.** A session does
  **not** replace the section/pair scope convention — it **prefixes** it. The
  recommended convention becomes `<session>/<section>/<pair>` (or, for a solo session,
  just `<session>`). Because `scopeMatch` is prefix-aware (`s.indexOf(f + "/") === 0`),
  `tics log --scope <session>` shows one session's whole thread, and **two sessions
  with distinct sids can never share a scope prefix** — which is precisely the
  property that makes `claim_guard` block cross-session edits (gap 1's "they might pick
  the same scope" failure mode is closed by construction).
- **The conductor learns sessions.** `ticsConductor`/a new `tics sessions` view reads
  the `session` open/close tics and the per-session active claims and prints
  *"who is live + where + holding what."* This is the missing "is anyone else working
  this tree right now?" answer an arriving session needs **before** it starts.

**Reused:** the bus, `emit_tic`, `tic.sh` dispatch, `scopeMatch` prefix semantics, the
`section`-style open/done lifecycle, `activeClaims`. **New:** the `session` kind, the
`session` field + `.claude/state/session` + `TICS_SESSION`, the `tics sessions` view.

### 2. Release serialization — a release claim + a pre-commit cross-session check (NEW gate, REUSED claim model)

The git/release step (gap 2) needs two things claims-on-edits cannot give:

**(a) A coarse "release lock" expressed as a claim on a well-known token.** Treat
"the right to cut a release / bump the version / touch the index for a landing" as a
**claimable resource** named by convention, e.g. `claim ref=RELEASE` (and/or
`claim ref=package.json` so a programmatic version bump is at least *declared*). A
session about to release:

```
tic.sh <sid> "*" claim "release lock" RELEASE
# … bump, commit, tag …
tic.sh <sid> "*" release "release done" RELEASE
```

`tics claims` / `claim-owner RELEASE` then answers "is a release already in flight?"
This reuses the **entire** existing claim/release machinery and `activeClaims` reader;
it adds **no** mechanism — only a naming convention and a doc/recipe. It is honest
about its limit: it is **advisory** for any actor that doesn't run the guard (see
boundary), which is why we add (b).

**(b) A pre-commit cross-session claim check (NEW, fail-closed at the git boundary).**
git runs `pre-commit` under **any** tool, so this is the one place we can gate the
*index/commit* regardless of how the write happened (heredoc, `sed -i`, `node -e`,
another tool). Extend the `@ttics/tdd` `pre-commit` hook (which already runs the
green-bar gate) to, **before** allowing the commit:

1. compute the set of staged files (`git diff --cached --name-only`);
2. for each, run `tics claim-check <file> <this-session-scope>` against the shared bus;
3. if any staged file is **actively claimed by a *different live session*** (a scope
   whose session prefix differs from this session's, and whose session is not
   `close`d) → **block the commit** with the owner and a "coordinate / wait /
   `--no-verify`" message;
4. if `RELEASE` is claimed by another live session and this commit looks like a
   release (touches `package.json` version / a tag is being created) → block likewise.

This closes collisions #1 and #3 at the only choke point that sees them: a commit that
captures another session's in-progress file, or a second concurrent release, is
refused at `git commit` time even though the *write* bypassed the PreToolUse guard.
Bypass remains `git commit --no-verify` / `PRECOMMIT_GATE=0`, consistent with the
existing green-gate's escape hatch — a referee, not a sandbox (ADR 0001's framing).

**Reused:** `claim`/`release` kinds, `activeClaims`/`claimCheck`, the existing
`pre-commit` hook entry point + its `--no-verify`/env escape. **New:** the staged-file
claim-check loop in `pre-commit`, the `RELEASE` token convention, the "different *live*
session" predicate (needs the session field + open/close from §1).

### 3. Staleness — release-on-stop (primary) + a TTL sweep (backstop) (NEW, REUSED reader)

Two complementary releases so a dead session never wedges a live one (gap 3):

- **Release-on-stop (primary).** The session's terminal hook emits a `session close`
  **and releases the session's still-active claims.** A `session close` in the reader
  is defined to **auto-release every active claim whose scope is under that session's
  prefix** — exactly mirroring how `section done` auto-releases a section's claims in
  `activeClaims` today. So a single `session close` tic frees the namespace. Wiring:
  the Stop hook (orchestrator session end) and/or a SessionEnd hook emits it. Because
  this is a derived-in-the-reader rule, even a session that emits *only* `session
  close` (no per-file `release`) is fully cleaned up.
- **TTL sweep (backstop for hard death).** A crashed session never reaches Stop, so add
  an optional staleness rule in `activeClaims`: a claim whose **owning session has had
  no tic for `> CLAIMS_TTL`** (config, default e.g. 2h; `0` = disabled) is treated as
  inactive. Computed from the bus (each session's last-seen `ts`), so it is **pure
  reader logic, no timer/daemon.** A blocked session can also be told (in the block
  message) how to force-release a known-dead session:
  `tic.sh <my-sid> "*" release "reclaim stale" <token>`.

**Reused:** the `release` kind, the `activeClaims` "subtract closed-section claims"
pattern (we add a sibling "subtract closed/stale-session claims"), the bus `ts`.
**New:** the `session close` auto-release rule, the TTL config + sweep in `activeClaims`,
a terminal hook that emits `session close`.

### 4. No-scope default — fail-closed in multi-session mode (NEW guard branch, REUSED config)

Single-session behavior is unchanged: no scope ⇒ no partitioning (fail-open), because
one conductor doesn't need claims. Multi-session mode flips it. Gate it behind a config
flag (e.g. `MULTI_SESSION=1` in `.claude/tdd.config`, set when more than one session
will share the tree):

- When `MULTI_SESSION=1` and `.claude/state/scope` (or session) is **empty**, the
  guard **blocks the edit** with: *"multi-session mode is on but this session has no
  scope/session set — set `.claude/state/session` + `.claude/state/scope` so your
  writes are partitioned, or you will collide with the other session."*
- This is the deliberate inversion of `claim_guard`'s current early-return on empty
  scope. It is **scoped to the flag** so the common single-session case keeps its
  fail-open ergonomics (a blocked `ls`-equivalent here would be as bad as ADR 0001
  warns).

**Reused:** `claim_guard`'s structure, `.claude/tdd.config`. **New:** the
`MULTI_SESSION` flag + the empty-scope block branch.

### What is REUSED vs NEW (summary)

| Concern | Reused (already there) | New (this ADR) |
|---|---|---|
| File-level disjoint writes across sessions | `claim_guard` + `activeClaims`/`claimCheck` on the **shared bus** | nothing — it already works **iff** scopes are distinct + guard armed |
| Cross-worktree visibility | `loadTicsAll` (`--all`) | nothing |
| Concurrency-safe append | `TIC_STORE=spool` | *require* spool in multi-session mode (doc/config) |
| Session identity / "who's live" | `section` lifecycle pattern, `scopeMatch` prefixes, `emit_tic` | `session` kind, `session` field + `.claude/state/session`/`TICS_SESSION`, `tics sessions` |
| Release / index race | `pre-commit` hook + its escape hatch; `claim`/`release` | `RELEASE` claim convention; **staged-file claim-check in `pre-commit`** |
| Staleness | `release`; the "closed section auto-releases claims" rule in `activeClaims` | `session close` auto-release; `CLAIMS_TTL` sweep in `activeClaims` |
| No-scope default | `claim_guard` early-return; `.claude/tdd.config` | `MULTI_SESSION` fail-closed branch |

### The boundary (state it honestly)

- **This coordinates Claude sessions on ONE tree via a SHARED bus. It is a referee,
  not a sandbox** (same framing as ADR 0001). The PreToolUse guard still cannot see
  *programmatic* or *indirect* writes (`node -e`, `sed -i`, helper scripts) — that
  residual is unchanged and irreducible for a PreToolUse hook. The **`pre-commit`
  claim-check is the backstop** that catches the *consequence* (a commit capturing a
  contested file), exactly as the green-gate backstops an undetected write that breaks
  the suite. A write that both bypasses the guard **and** never gets committed (a
  scratch file, an un-added edit clobbered in place) is outside any tic's reach.
- **`git commit --no-verify` and `PRECOMMIT_GATE=0` bypass the release gate**, by
  design — the framework never *prevents* a determined human, it makes the safe path
  the default and the unsafe path explicit.
- **The cleaner long-term answer is one worktree per session** (`git worktree add`):
  then there is **no shared index** (collision #1 vanishes at the OS level), edits are
  physically isolated, and `--all` already merges the buses for cross-session
  visibility. This ADR makes the **same-tree** case safe because it is the case that
  bit us today and the case adopters fall into by accident; it should also **recommend
  the worktree-per-session pattern** as the structurally-stronger option in the doc.
  (Worktree mode still benefits from §1 session identity and the §2 `RELEASE` claim, so
  the two are complementary, not alternatives.)
- **Not a distributed lock.** The bus is eventually-consistent append-only on a local
  filesystem; in spool mode two sessions can both *believe* they won a race in the
  sub-millisecond window before each sees the other's claim tic. This is acceptable at
  session scale (humans/agents operate at seconds, not microseconds) and is the same
  trade the project already accepts by avoiding SQLite (tic-protocol §"shared bus").
  The `pre-commit` check is the serialization point that actually matters for the
  destructive operation (the commit).

## Consequences

- **Positive.** The three observed collisions get a coherent, mechanism-light answer
  built entirely on the existing bus: file edits (already covered once scopes are
  distinct — now made *discoverable* and *enforced-by-default* via session-prefixed
  scopes + fail-closed mode), the index/release race (new `pre-commit` claim-check at
  the one choke point that sees it), and ghosts (release-on-stop + TTL). No new store,
  no daemon, no new dependency; zero-dep / Node≥16 / bash-hook portability invariants
  are preserved. Most of the win is **convention + discoverability + two small gates**,
  which is the honest characterization.
- **Negative / accepted.** Adopters now have a `session` concept to set
  (`.claude/state/session`) — friction that single-session users avoid by leaving
  `MULTI_SESSION=0` (default), so the common case is untouched. The `pre-commit` check
  adds latency and a new way to be blocked at commit time (mitigated by `--no-verify`
  and a precise owner message). The TTL is a heuristic (a long-but-alive session past
  TTL could have a claim reclaimed) — mitigate with a generous default and "stale-only
  if no tic at all," and keep `CLAIMS_TTL=0` as the off switch. The append-only bus is
  not a true lock (documented above).
- **Record shape.** Adding a `session` field to every tic is additive (unknown keys
  ignored); the reader dedup key and the per-scope/per-section group-bys gain a
  session dimension. No migration of existing logs is needed — old tics simply have no
  session (treated as `*`/legacy).
- **Selftest / proof obligations (for the implementing loop, not this ADR).** Each
  slice below ships with a test: a `session` open/close round-trips and shows in
  `tics sessions`; two distinct-session scopes block each other's edit while
  same-session does not; a `pre-commit` with a staged file claimed by another *live*
  session exits non-zero and a `session close` (or `--no-verify`) clears it; a
  `session close` auto-releases that session's claims in `tics claims`; a TTL-expired
  session's claim is treated inactive; `MULTI_SESSION=1` + empty scope blocks an edit
  while `MULTI_SESSION=0` allows it.

## Alternatives considered

- **A real lockfile / `flock` on the index or a `release.lock` file as the source of
  truth.** Rejected as the *primary* model: it is a second mechanism beside the bus,
  doesn't show in any tic view, leaves its own staleness problem (a held `flock` after
  a crash), and `flock` portability across the hook environments is uneven. The bus +
  `pre-commit` check gives the same serialization at the operation that matters with
  zero new mechanism. (A lockfile could be a future hardening *inside* the `pre-commit`
  check for the index specifically, but it is not needed for the decision.)
- **A coordination daemon / SQLite with row locks.** Rejected: breaks the zero-dep /
  Node≥16 / bash-hook portability invariants for wins not needed at session scale —
  the same reasoning tic-protocol.md already gives for avoiding SQLite. Sessions
  operate at human/agent timescales; append-only + a commit-time check suffices.
- **Mandate one git worktree per session and add nothing.** Rejected as the *whole*
  answer (though strongly recommended as a pattern): it solves the index race and
  physical edit isolation, but it does **not** give session presence ("who's live"),
  does **not** serialize a *release* (two worktrees can both bump version and both
  merge), and does nothing for the same-tree case adopters fall into by accident, which
  is the case that actually bit us. §1 + §2 are complementary to worktrees and this ADR
  recommends both.
- **Require scope globally (fail-closed for everyone).** Rejected: it would break the
  single-session ergonomics ADR 0001 is careful to preserve (a blocked benign edit is
  unacceptable). Fail-closed is gated behind `MULTI_SESSION=1` so only the concurrent
  case pays for it.
- **Make claims block on *same* scope too (so two sessions that picked the same scope
  still collide-detect).** Rejected: same-scope-is-one-unit is the foundational
  semantic of the whole claim/section model (a pair shares a scope on purpose).
  Session-prefixed scopes (§1) make a shared scope across sessions *impossible by
  construction*, which is the right fix — don't weaken the within-scope semantic.
```
