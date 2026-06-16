# 0004 — Self-provisioning multi-session (the substrate engages itself)

- Status: **Superseded by ADR 0015** (parallel isolation via git worktrees). Was: Accepted.
  Note: 0004's §2 spool-bus (`TIC_STORE=spool` at the git-common-dir) carries forward into 0015.
- Date: 2026-06-10
- Supersedes nothing; **completes ADR 0003** (cooperation on one tree).
- Deciders: navigator (proceed), architect (bus/identity seam)

## Context

ADR 0003 built the cooperation substrate — session identity, claims, `MULTI_SESSION`
fail-closed, cross-session pre-commit, spool sharing. The **first real multi-session run**
(gvp, 3 Sonnet sessions, 2026-06-06) engaged it **0%**: 82 tics all `session:""`, 0 claims,
`MULTI_SESSION` unset, jsonl not spool, 7 fragmented buses. Two forks built the same thing.

Two root causes, both proven in the wild:
1. **BUILT ≠ ACTIVATED.** The substrate needs 4 manual steps (set a session id, set a scope,
   `MULTI_SESSION=1`, `TIC_STORE=spool`+`TICS_DIR`). None happened — even when the operator
   *explicitly* invoked multi-session. A SessionStart NOTE warned twice and was ignored
   (NOTEs were obeyed 0/2; guard BLOCKs were obeyed 8/8 — **blocks change behavior, notes don't**).
2. **The host forces worktree-per-session.** Claude Desktop's fork flow (and Cursor) puts each
   session in its OWN git worktree and snapshot-copies the bus. ADR 0003's "one shared tree" is
   not available as a default; sessions then `cd` into one tree and work unprotected anyway.

## Decision

**The kit provisions the substrate itself when it detects multi-session — zero manual setup.**
Detection = `MULTI_SESSION=1` (explicit) **OR** the process is running inside a *linked git
worktree* (the host-forced topology). When detected:

1. **Auto session identity.** If no id is set (`TICS_SESSION` env and `.claude/state/session`
   both empty), derive one from the **worktree identity** — `basename` of `git rev-parse
   --show-toplevel` (fallback: `basename "$ROOT"`). It is stable across all of a session's hook
   invocations and unique per worktree (the host's own per-session boundary). Resolved lazily in
   `emit_tic`; **never written to the shared `state/session` file** (that file is per-tree and
   concurrent sessions on one tree would stomp it — the SHARED-FILE hazard).

2. **Auto shared bus.** With >1 worktree and no explicit `TIC_STORE`/`TICS_DIR`, the bus
   resolves to a **spool at the git common dir** (`$(git rev-parse --git-common-dir)/tics-bus`),
   so every worktree's session emits to ONE bus (emission-side sharing — `--all` only fixed
   reads). Spool is one-file-per-tic → concurrency-safe → also kills the jsonl `seq` race.

3. **NOTE → BLOCK.** When multi-session is detected but the bus is still fragmented/unconfigured,
   the guard BLOCKs (the kit's proven attention mechanism), not merely NOTEs.

**Conservative by construction:** a single session in the main worktree with no `MULTI_SESSION`
sees *no change* — same id (empty), same jsonl, same ergonomics. Opt out with `AUTO_PROVISION=0`.

## Consequences

- The substrate engages with zero setup in exactly the topology the host imposes — the gvp run,
  re-run under this ADR, would have had stable per-session ids on one shared spool, claims live,
  duplicate work blocked.
- Session id is derived, not stored → no cross-session stomp of `state/session`.
- Spool-by-default under multi-session removes the seq race without a format change for solo use.
- Accepted cost: id = worktree name (not a human label); a user who wants a friendlier id still
  sets `TICS_SESSION`. Two sessions sharing ONE tree (no worktrees) still need `TICS_SESSION` to
  differ — documented; the common real case (worktree-per-session) is handled automatically.

## Implementation notes

- **pt1 (v0.34.0):** `emit_tic` auto-derives the session id from the worktree (above).
- **pt2 (v0.36.0) — cross-worktree claim visibility, simpler than "relocate the bus".** The read
  views already merge sibling worktrees (`--all` default, with a dedup that collapses snapshot
  copies). The only gap was that the *enforcement* readers (`claimCheck`/`claimOwner`/`claimSession`,
  used by the guard + pre-commit) read the LOCAL bus only. Pt2 switches those three to `loadTicsAll`
  — so a peer's claim in another worktree is now seen and blocks — reusing the proven merge instead
  of relocating the bus to a common-dir spool. A single shared spool (and the jsonl seq-race fix)
  becomes a follow-up under N2, not a prerequisite for cross-visibility.

## Follow-ups (other ingest slices, not this ADR)

- N2 collision-proof seq fallback for explicit-jsonl multi-writer use.
- N5 `update` refreshes/manifest-tracks git hooks; N6 pre-push tag-vs-lockstep gate.
- N3 bus-assignment surfacing; N4 per-process phase/scope (env-first).
