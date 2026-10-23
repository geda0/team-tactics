# 0026 — A git transport for the spool (`TIC_STORE=git`), and collision-free ordering (`seq` becomes advisory)

- **Status:** **Proposed.** It is built red→green through the phase×layer gate (layer `app`, package `@ttics/tics`).
  The first failing test pins predicate **P1** from ADR 0025. This ADR is the seam; the code follows slice by slice
  (§Slices).
- **Date:** 2026-10-23
- **Deciders:** navigator (the pull: "a bus that reaches every host"), architect (the store seam, the lossless
  append-only argument, ordering without a global counter), product-owner (the opt-in and default-safe framing;
  solo installs see no change).
- **Relates to:**
  - **0025 (field learnings, fleet run)**: needs **N1** (git transport) and **N2** (collision-free ordering), and
    predicate **P1**.
  - **0015 (parallel isolation via worktrees)**: the spool shared across worktrees (`TICS_DIR`). This ADR extends
    the same one-file-per-tic store across hosts.
  - **0008 (local fleet observability)**: the board, liveness and collision folds. They read the merged bus and
    gain hosts for free.
  - **0002 §1 (session identity)**: the `session` field. Here it becomes part of a tic's identity.
- **Supersedes:** nothing. `jsonl` and `spool` are unchanged.

## Context

The spool store (`TIC_STORE=spool`) writes one JSON file per tic. Its filename is
`<UTC ts>-<pid>-<RANDOM>.json`, so concurrent writers never touch the same file. That property is what made it safe
across worktrees (0015). It stops at the disk: `TICS_DIR` is a path, and a second host can't see it.

ADR 0025's adopter needed the bus across four machines and cloud sessions, where cross-session messages could not
reach back. It rebuilt the spool by hand: commit each tic file to a dedicated branch, fetch/rebase/retry on push. That
was the only channel that reached every participant. It also exposed the ordering flaw. `emit_tic` computes
`seq = (lines in the local store) + 1`, a count only the local host can see, so two hosts handed out the same `seq`
**61 times in 1,490 tics**, on every day of the run including the last (two roles 1 s apart).

Two facts make a git transport cheap and safe:

1. **Append-only plus unique filenames means a merge can't conflict.** Each emit *adds* one new path and never
   modifies or deletes one. Two hosts' commits touch disjoint paths, so `git rebase` replays them without conflict,
   and nothing is lost if push is retried after a rejected non-fast-forward.
2. **Identity never needed `seq`.** The reader already merges several buses (`--all` over worktrees). It needs a key
   per tic that is unique across hosts, and the spool filename plus `session` is that key by construction.

## Decision

### 1. `TIC_STORE=git` (opt-in)

| Setting | Meaning |
|---|---|
| `TIC_STORE=git` | turns it on; the default stays `jsonl` |
| `TICS_REMOTE` | (required) any git remote URL or path |
| `TICS_BRANCH` | the bus branch, default `tics-bus` |
| `TICS_GIT_DIR` | the local checkout of the bus branch, default `.claude/state/tics.git`, never the project's own tree |

**`emit_tic` with `TIC_STORE=git`:**
1. Ensure `TICS_GIT_DIR` is a clone of `TICS_REMOTE` at `TICS_BRANCH`. On the first emit to an empty remote, create
   the branch as an orphan.
2. Write the tic as one new spool file under `tics.d/` in that checkout, with a host-unique name
   (`<UTC ts>-<host-or-session>-<pid>-<random>.json`).
3. Commit only that file, then push. On a rejected push: `fetch` and `rebase` onto the remote branch, then push
   again, a bounded number of times (default 8, with jittered backoff). Rebase can't conflict (Context fact 1), so
   retries converge.
4. If every retry fails, the tic **stays committed locally** and is pushed by the next emit, or by `tics sync`. An
   emit never drops a tic and never blocks the caller with an error exit (the same never-fail contract as today's
   `>> … || true`).

**Keeping the project tree clean (P5):** when `TICS_GIT_DIR` sits inside `ROOT` (the default does), the store adds
it to the project's `info/exclude` (located with `git rev-parse --git-path info/exclude`), never to a tracked
`.gitignore`, so emits leave the project's `git status` and HEAD untouched. This happens once, when the checkout is
first created: a checkout made before this slice is not hidden retroactively (add the line by hand, or delete the
checkout and let the next emit recreate it).

**Bounded and lossless on the write side (P3):** measured on the first build, a single emit against a dead remote
ran for minutes, and one killed mid-open left no tic at all, because `_tic_git_open` fetched before the tic was
written. Hooks and agents both emit, so that froze sessions and broke the never-drop promise. The rules:
1. **Local first.** The tic is written and committed before any network call. Opening the bus checkout is a local
   init/orphan with no fetch; the first network operation is the push.
2. **Every network call runs under a watchdog** (`TICS_NET_TIMEOUT`, default 5 s) that kills its process group.
   macOS has no `timeout(1)`, so the watchdog is plain bash.
3. **Retry only on a non-fast-forward rejection** (fetch + rebase + push, bounded as before), never on a timeout or a
   network error: retrying a hang multiplies it.
4. **On a network failure, set the reader's attempt stamp and return 0.** Inside the TTL after a failed attempt,
   emits skip the network entirely; the tics ride out with the next publish or `tics sync`.
5. **Rejected: a detached asynchronous push.** It would outlive the session and race concurrent emits on the same
   checkout.

**The read side:**
- `tics` with `TIC_STORE=git` reads the **union** of the checkout's working-tree `tics.d/` (local, including
  unpushed) and the fetched remote-tracking tree (`origin/<TICS_BRANCH>`, read with `ls-tree` / `cat-file`),
  deduplicated by filename. The fold sits at the one seam every view uses (`storePaths` / `loadTics`), so log,
  inbox, board, cycle, gate, claim-check and claim-owner all see the bus. claim-check matters most: the edit
  guard calls it on every edit.
- **A read never mutates the bus checkout:** no rebase, merge or checkout. A fetch only updates the remote-tracking
  ref. Mutating on read would race concurrent emits on the same checkout and could lose unpushed work; the union
  is lossless by construction.
- **Fetch is throttled:** at most once per `TICS_FETCH_TTL` seconds (default 60), tracked by a stamp file in the
  checkout's `.git`, with a short network timeout. `tics sync` and `tics log --fetch` force one. A failed fetch is
  silent and the read falls back to what it has, so offline still exits 0.
  Two stamps: the **success** stamp records the last successful fetch into `refs/remotes/origin/<branch>` and drives
  "bus as of"; a failed fetch, or one against a remote with no bus branch yet, never sets it. The **attempt** stamp
  records the last try of any outcome and drives the TTL, so a dead remote is retried once per TTL, not on every
  read. A process fetches at most once per bus. (Measured before this rule: a dead remote cost ~10 s per
  `claim-check`, ~20 s per guarded edit.) Known gap, deferred: fetches made by an emit's open/rebase don't set the
  stamps, so the worst case is one extra fetch per TTL. The network cap is both a wall-clock limit and a
  low-speed limit, because the edit guard reads on every edit and a dead host must not hang it for minutes.
- **Reads use read-only git only** (`ls-tree`, `cat-file`, `show`, `fetch` into the tracking ref) with
  `GIT_OPTIONAL_LOCKS=0`; never a plain `status`, which can rewrite the index. Duplicates across the worktree and
  the tracking tree collapse by filename, so a tic appears once.
- **Freshness is visible:** `log` and `board` print "bus as of <last fetch>", so stale data is never mistaken for
  live (the same spirit as ADR 0025 N13).
- **`tics sync`** = fetch + rebase + push of any unpushed local tics. It is idempotent.

### 2. Collision-free ordering (`seq` becomes advisory)

- A tic's **identity** is its spool filename (the git store) or `(ts, session, seq)` (jsonl). It is never `seq`
  alone.
- The reader **orders** by `ts`, then by `session`, then by the spool filename. That is a total, stable order that
  every host computes the same way. `seq` stays in the record (back-compat, and it is still monotonic within one
  host) but is never used to dedupe or identify.
- Under `TIC_STORE=git` a missing `session` is filled from the host name, so the order key never ties on an empty
  string.

### 3. What does not change

- No new tic kind and no new bus field.
- `jsonl` and `spool` are untouched.
- The emit never runs in, commits to, or switches the project's own working tree. The bus lives in its own checkout.
- Solo installs (the default) behave exactly as before. This is a store, not a mode.

## Predicates

- **P1 (lossless under concurrency):** two emitters in separate installs (separate "hosts") emitting K tics each,
  concurrently, against one bare remote → the remote's bus branch holds exactly 2K tic files, and the set of
  messages equals the 2K emitted. *First red test, `packages/tics/test/tics.test.js`.*
- **P2 (no identity collision):** across the same run, every tic file name is unique, and the reader's merged log
  lists 2K distinct entries even when `seq` values repeat.
- **P3 (offline-safe, bounded):** with a remote that hangs, (a) the first emit, even on a fresh install, exits 0
  within ~10 s with its tic committed locally; (b) a second emit inside the TTL exits in < 1 s without touching the
  network; (c) after the remote returns, `tics sync` publishes all of them, and a re-run publishes nothing new.
- **P4 (stable order):** two readers on different hosts render the same merged bus in the same order.
- **P5 (project tree untouched):** after emits under `TIC_STORE=git`, `git status` of the project's own tree is
  unchanged.
- **P6 (the reader sees the bus):** with `TIC_STORE=git` (from `tdd.config` or the environment): (a) host A's
  `tics log` lists host B's tics and A's `claim-check` sees B's claim; (b) with the remote unreachable, A's local
  tics (unpushed included) are still listed and the read exits 0; (c) a read leaves the bus checkout's HEAD, index
  and working tree unchanged; (d) a second read within `TICS_FETCH_TTL` does no fetch; (e) `log` shows when the bus
  was last fetched.

## Slices (red→green, one behavior each)

1. **P1**: emit publishes to a bare remote, concurrent and lossless (the push-retry loop).
2. **P5**: the bus lives in `TICS_GIT_DIR`; the project tree is untouched.
2b. **P6**: the reader reads the git bus (fetch on read, offline-safe). Added after dogfooding: P1 and P5 shipped
   a bus the fleet could write but not read, because no predicate covered the read side.
3. **P3**: offline emit plus `tics sync`.
4. **P2 + P4**: the reader orders by (ts, session, filename) and identifies by filename.
5. Docs: `tic-protocol.md` store section, and `tdd.config` keys.

## Consequences

- **Good:** one bus reaches every host and cloud session that can reach a git remote. That is the adopter's
  working prototype, now tested, with a stated lossless argument. The 0008 board and collision folds work fleet-wide
  with no change, and `seq` collisions stop being a correctness concern.
- **Cost:** each emit is a commit plus push, which is slower than an append: ~100s of ms locally, seconds over a
  network. That's fine at bus rates (the adopter peaked at ~550 tics/day), but this is not a high-frequency log.
  Hook-emitted telemetry can stay on `jsonl` locally (stores are per-install).
- **Risk:** history grows without bound on the bus branch. Mitigation, deferred until a run pulls it: periodic
  squash of tics older than N days into an archive commit. The append-only argument still holds within the live
  window.
