# ttics — for testers

Thanks for kicking the tyres. This is **private, proprietary, pre-release** software shared
with you for evaluation only — please **do not redistribute** it or the tarball (see `LICENSE`).

`ttics` is a TDD-pairing kit for AI coding agents (Claude Code, and cross-tool): it enforces a
red→green→refactor gate, and coordinates one or many agents through an append-only "tic" bus —
so agent work stays disciplined, collision-safe, and observable instead of drifting.

## Install (≈30 seconds)

You need **Node 18+** and **bash** (macOS, Linux, or Windows + WSL/Git-Bash). No npm install,
no registry, no account.

```bash
tar -xzf ttics-<version>.tgz -C ~/ttics-kit      # extract the tarball I sent you
cd /path/to/your/project                          # a git repo you can experiment in
node ~/ttics-kit/packages/team-tactics/bin/cli.js init .
```

That lays the kit into your project's `.claude/` (hooks, agents, docs) — non-destructively
(it backs up anything it would change). Verify it:

```bash
node ~/ttics-kit/packages/team-tactics/bin/cli.js selftest .   # expect: ALL PASS
```

> Prefer one command each time? If I've added you to the private repo instead, you can skip the
> tarball: `npx github:geda0/team-tactics#v<version> init .` (needs git access to the repo).

## What to try

1. **Read `KICKOFF.md`** in your project root — it has a copy-paste prompt to start an agent
   on a real TDD slice. That's the intended first run.
2. **Feel the gate.** Set `echo red > .claude/state/phase` and `echo app > .claude/state/layer`,
   then have your agent try to edit a *source* file — the guard blocks it ("write the failing
   test first"); a *test* file is allowed. Flip to `green` and it inverts.
3. **See the telemetry.** After some work: `.claude/hooks/tics log` (the agent-to-agent thread),
   `.claude/hooks/tics cycle` (where am I?), `.claude/hooks/tics conductor` (who owns what).
4. **(Adventurous) parallel pairs.** Write a partition file (`<section> <file>...` per line) and
   run `.claude/hooks/tics fan-out partition.txt` — it refuses overlapping file sets *before* you
   fan out. See `docs/tdd/divide-and-conquer.md`.

## Sending feedback

This is exactly the stage where your friction is gold. Please tell me:

- What worked / what felt magical, and what was confusing or annoying.
- Anything that **broke**, with the command + output (and `node --version`, your OS/shell).
- Did the gate ever get in your way wrongly? Did a green ever feel untrustworthy?

→ **geda071@gmail.com** (or wherever we're already talking). Short notes are perfect.

Thank you — this directly shapes the next version.
