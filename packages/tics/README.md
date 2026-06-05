# @ttics/tics — the tic protocol

Structured, file-mediated agent-to-agent coordination: an append-only bus (jsonl, or a
concurrency-safe spool), an emit mechanism, and a reader. Method-agnostic — the foundation
that **@ttics/tdd** (pairing) and **team-tactics** (the full process) build on.

- Install: `npx @ttics/tics .` — lays `.claude/hooks/{tics-lib.sh,tic.sh,tics,tics-view.cjs}` + `docs/tics/` + the gitignore bus lines.
- Emit: `.claude/hooks/tic.sh <from> <to> <kind> "<msg>" [ref] [result]`
- Read: `.claude/hooks/tics <log | inbox <role> | conductor | claims | sections | cycle | gate | claim-check> [--scope S] [--all]`

Kinds: `delegate handoff signal block verdict msg note claim release contract need commit`.
`--all` merges every git worktree's bus. Spec: `docs/tics/tic-protocol.md`.
