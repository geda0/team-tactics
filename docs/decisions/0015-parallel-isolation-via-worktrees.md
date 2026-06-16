# 0015 — Parallel isolation via git worktrees (supersedes 0002, 0003, 0004)

- Status: **Accepted** (navigator decision 2026-06-16). Supersedes 0002, 0003, 0004.
- Deciders: navigator (slim the framework — remove multi-session-on-one-tree; rely on
  the default git worktrees), architect (the remove/keep boundary + the removal plan).
- Relates to: keeps the spool shared-bus from 0004 §2; the honest-gate (0009),
  evidence (0011), witness (0013), MCP (0014) surfaces are untouched.

## Context

0002 made it safe for >1 session to share ONE tree: session identity, a pre-commit
cross-session claim-check + `RELEASE` lock, `CLAIMS_TTL`, and a `MULTI_SESSION`
fail-closed scope guard. 0003 leaned into one shared tree with cooperation primitives
(`tics sessions`/`tics todo`, JOIN beacons). 0004 auto-provisioned a session id from the
worktree name and pointed the bus at the git-common-dir.

Operating it (and conducting two real parallel sessions) revealed the problem: **two
sessions on one tree share `.claude/state/phase`, `suite-status`, and claims — so one
session's in-progress red bar (and its `phase=green`) blocks the whole tree and the
conductor, and a stray/artifact claim cross-blocks the other section.** Git worktrees
already solve write-isolation at the filesystem/index layer: each worktree is a separate
tree, index, and `.claude/state`. The entire on-one-tree coordination protocol is
complexity that worktrees make unnecessary.

## Decision

**Rely on git worktrees for parallel isolation — one worktree per track.** Each worktree is
its own session with its own tree, index, and `.claude/state`; git provides write-isolation,
so there is **no in-tree session-coordination protocol**. The tics bus stays the shared
coordination + observability substrate **across** worktrees via one concurrency-safe spool
bus (`TIC_STORE=spool` + `TICS_DIR` at the git-common-dir) and the reader's cross-worktree
merge (`loadTicsAll`).

### What worktrees replace
- Session `open`/`close` beacons + the `tics sessions` registry → a worktree's existence *is*
  the registry; its removal is unambiguous (no close beacon, no stale-TTL).
- The `MULTI_SESSION` fail-closed scope guard → git index isolation makes two sessions
  colliding on one tree impossible; scoping stays an opt-in observability/claim convention,
  not a safety gate.
- The cross-session pre-commit claim-check + `RELEASE` lock → each worktree has its own index;
  the pre-commit keeps **only** the green-bar suite gate.
- `tics todo <session>` per-session work pool → a worktree owns its whole backlog;
  cross-worktree handoffs use plain role-addressed `delegate`/`handoff`/`need` tics.
- release-on-session-close / `CLAIMS_TTL` stale-drop → **release-on-section-done** is the sole
  claim-freeing mechanism.

### Removed vs kept boundary
**REMOVED (on-one-tree coordination):** the `MULTI_SESSION` knob + guard branch;
`_tics_multi`/`_auto_session` auto-provision + the session JOIN beacon; `ticsSessions` +
`ticsTodo` views (+ CLI/KNOWN/dispatch/exports); `sessClosed`/`sessLatest`/`CLAIMS_TTL`
lifecycle in `activeClaims`+`fleetModel`; `fleetModel` collisions + orphan-by-session-death;
the pre-commit cross-session block + `RELEASE` lock; the `CLAIMS_TTL` config knob; the
tic-protocol "Multiple sessions on one repo" recipe; the two-peer-sessions-on-shared-state
workflow variant.

**KEPT (cross-worktree bus):** the spool bus (`TIC_STORE=spool`/`TICS_DIR`/`storePaths`);
`loadTicsAll` cross-worktree merge + `--all`/`--here`; `claimCheck`/`claimOwner`/`claimSession`
reading `loadTicsAll` (a peer worktree's claim is visible + blocks); the `session` tic field
(attribution + the mcp `session` kind); `livenessTier` + `fleetModel` members/byScope/tally;
`CLAIMS_ENFORCE` + the claim_guard enforce path; the worktree-bus SessionStart nudge;
`refreshGitHooks`/git-common-dir hooks; post-commit + the green-bar pre-commit.

**CORE (untouched):** the phase×layer gate, `run-suite`, `require-green-to-stop`, the tic
protocol + `emit_tic`, and the 0009/0011/0013/0014 surfaces.

### Sectioning collapses to: one worktree per track + a shared spool bus
`docs/tdd/sectioning.md` becomes the single parallel-work model: each track is a git
worktree; all worktrees share ONE spool bus at the git-common-dir; the conductor/board/claims
correlate across them via `loadTicsAll`. Git isolates; the bus observes.

## Execution plan (run on a CLEAR tree — line numbers re-baselined post-E12)

1. Remove the `MULTI_SESSION` fail-closed guard (guard-edit-scope.sh + lib.sh default; drop MS2 test).
2. Remove session auto-provision (`_tics_multi`/`_auto_session` + caller; the JOIN beacon; drop N1).
3. Remove the `tics sessions` view (+ CLI/KNOWN/dispatch/export; drop MS1).
4. Remove the `tics todo` view (+ CLI/KNOWN/dispatch/export + `tdSession` parse; drop C2/C3).
5. Strip session-lifecycle from `activeClaims` (sessClosed/sessLatest/release-on-close/stale-TTL),
   keep section-done; simplify `claimsFor` (drop the CLAIMS_TTL read); drop MS5 + C1.
6. `fleetModel` in ONE slice: drop ttlMs/sessClosed/orphan-by-death + collisions; keep
   members/byScope/tally/liveness; drop the orphan + F1/CLAIMS_TTL tests.
7. Remove the cross-session pre-commit block (keep the green-bar gate); drop MS3/MS4/C1-beacon
   tests. **`claimSession` function + CLI STAY** (only its pre-commit consumer goes).
8. Config + docs: drop the `MULTI_SESSION`/`CLAIMS_TTL` knob block (note worktree isolation +
   the spool block); rewrite the tdd-workflow two-peer variant; replace the tic-protocol
   "Multiple sessions" recipe with a 3-line worktree note.
9. This ADR + mark 0002/0003/0004 Superseded. Final full-suite + selftest + lockstep green.

(Removals are suite-green-gated refactors — there is no red→green for deleting a feature; a
tdd-critic audit replaces the per-slice red.)

## Risks (carry into execution)

- **Line-number drift:** all refs predate E12 (dd4cf69) — re-derive against the current tree.
- **mcp `session` kind:** keep the `session` field + the emittable `session` kind; remove only
  the lifecycle *consumers* — don't break a paused mcp build's tool enum.
- **`claimSession` split:** keep the function + CLI (cross-worktree visibility; exercised by
  tics.test.js + cli.test.js); remove only its pre-commit consumer.
- **`fleetModel` entanglement:** do orphan/collision/TTL in one slice; don't leave a half-wired
  fold that throws on a merged bus.
- **Dangling dispatch:** drop a view's export AND its KNOWN/dispatch in the same slice.
- **Distribution/lockstep tests:** the `claim-session`/`claim-owner` FOSSIL DIRS in
  distribution.test.js are name-keyed — don't touch; package count stays 4.

## Consequences

Simpler model — git is the isolator, the bus is the observer; fewer knobs. The honest-gate
(0009) + evidence (0011) + witness (0013) + mcp (0014) surfaces are untouched. The removal is a
~9-slice suite-green-gated pass. (0008's prose references release-on-session-close/CLAIMS_TTL/
ticsSessions become stale — a deferred doc-tidy, not part of this removal.)
