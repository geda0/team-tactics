# @ttics/tics — the tic protocol

Structured, file-mediated agent-to-agent coordination: an append-only bus (jsonl, or a
concurrency-safe spool), an emit mechanism, and a read-only reader. Method-agnostic — the
foundation (no dependencies) that **@ttics/tdd** (pairing) and **team-tactics** (the full
process) build on. Agents coordinate *through the bus and the files*, never through chat.

## Install

```sh
npx @ttics/tics .          # lay the kit into ./ (init | install | update are aliases)
```

> Not yet on npm — today the protocol ships inside the full kit:
> `npx github:geda0/team-tactics`. The à-la-carte `npx @ttics/tics` form lands when
> the packages are published. (`tics` on npm is an unrelated package — don't run it.)

This writes the mechanism into the target's `.claude/`:

- `.claude/hooks/tics-lib.sh` — the `emit_tic` function + the store.
- `.claude/hooks/tic.sh` — the EMIT entrypoint (call it from Bash).
- `.claude/hooks/tics`, `.claude/hooks/tics-view.cjs` — the READ-ONLY reader.
- `docs/tics/tic-protocol.md` — the spec.
- the managed `.gitignore` block for the bus (`tics.jsonl`, `tics.d/`, suite-status, telemetry).

`npx @ttics/tics selftest` runs an emit + read round-trip in a temp dir.

## The bus model

A **tic** is one structured communication unit appended to an append-only bus. Each tic carries:

```
ts  seq  kind  from  to  phase  layer  scope  msg  ref  result
```

Two store backends (set `TIC_STORE`):

- `jsonl` (default) — append one line per tic to `.claude/state/tics.jsonl`.
- `spool` — write one file per tic under `.claude/state/tics.d/` (concurrency-safe; parallel
  worktrees can share a spool). `TICS_DIR` / `TICS_FILE` redirect the spool / jsonl path so
  several worktrees write to one bus.

**Scope** is ambient and resolved per emit: `TICS_SCOPE` (per-call, for fan-out) → the
`.claude/state/scope` file → the active layer → `*`. Convention: `<section>/<pair>`. `phase`
and `layer` are read from `.claude/state/{phase,layer}` at emit time. The reader's `--all`
flag merges every git worktree's bus for a whole-picture view.

## Emit

`tic.sh` only appends; it never reads. The reader is the read side.

```sh
.claude/hooks/tic.sh <from> <to> <kind> "<msg>" [ref] [result]
```

```sh
# delegate a slice, then claim a file before editing it
.claude/hooks/tic.sh orchestrator implementer delegate "auth slice" auth-42
.claude/hooks/tic.sh implementer "*" claim "editing login" src/auth/login.ts
```

**Kinds:** `delegate handoff signal block verdict msg note claim release contract need
section commit`.

## Read

The installed reader is `.claude/hooks/tics` (full command set). The same reader ships as the
`tics` command via `npx @ttics/tics <cmd>` for a subset (see *npx surface* below).

```sh
.claude/hooks/tics <command> [--scope <s>] [--all]
```

### Command reference

```sh
tics log [--witness]           # the thread, newest last (run-suite signals fold to xN); --witness shows tool-use notes (ADR 0013)
tics inbox <role>              # tics addressed to <role> or broadcast (to = *)
tics cycle                     # current phase/layer/scope + last suite + cycles since last critic
tics board                     # scope-grouped fleet board: members + liveness + STUCK/orphan/collision
tics roster                    # the configured model per role (MODEL_<ROLE> in tdd.config) — ADR 0010
tics review                    # OPEN needs awaiting an answer (the navigator queue) — ADR 0012
tics answer <handle> <text>    # answer an open need: guidance msg to the asker, settles the need (--from <role>)
tics gate                      # release gate: product-owner + tdd-critic (+ qa) verdicts must pass
```

**Grouping — sections** (a section's lifecycle is `open` → `done`):

```sh
tics sections                  # live partition map: each section [open|active|done] + tics/claims/contracts/needs
tics section-status <name>     # the latest lifecycle status of one section (empty if never opened)
```

**Coupling — claims** (a scope claims a file via `ref`; `release` frees it):

```sh
tics claims                    # active claims (claim minus release) by scope
tics claim-check <file> <scope># yes/no guard; exit 3 if <file> is held by another scope
tics claim-owner <file>        # which scope holds <file> (empty if free)
```

**release-on-done:** marking a section `done` auto-releases its claims, so the partition frees
up for reassignment. This is centralized — every claim consumer (`claims`, `claim-check`,
`claim-owner`, `conductor`) sees the section's claims as released once it is done.

**Cross-pair view + plan-time gate:**

```sh
tics conductor                 # per-scope summary: section status + active claims + needs + contracts
                               #   (claims show "(freed)" once the section is done)
tics fan-out <spec>            # plan-time disjointness gate over a partition spec; exit 1 on overlap
```

`fan-out`'s spec is one section per line — `<section> <file>...` — and it assigns each section a
scope (`<section>/S<n>`). It refuses to greenlight (exit 1) when two sections claim the same
file, catching collisions before any pair starts (auto-claim catches them at runtime).

### Flags

- `--scope <s>` — filter `log` / `inbox` to a scope (matches the scope and its `<scope>/…` children).
- `--all` / `--here` — `log`/`conductor`/`claims`/`sections`/`gate` **merge every git worktree's
  bus BY DEFAULT** (whole-picture telemetry, deduped); `--here` restricts to the local bus. `--all`
  is the explicit form of the default.

### npx surface

`npx @ttics/tics <cmd>` exposes the read subset `log inbox conductor claims sections cycle gate
claim-check` (plus `init`/`install`/`update`, `selftest`, `help`). The grouping/coupling commands
`section-status`, `claim-owner`, and `fan-out` are available through the installed reader
(`.claude/hooks/tics`). With no command, it prints this README's head.

Spec: `docs/tics/tic-protocol.md`.
