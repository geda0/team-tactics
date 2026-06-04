# Project invariants — team-tactics

Rules this project must always uphold; every change proves the relevant ones.

## The package
- **Zero runtime dependencies.** Pure Node (CommonJS), Node >= 16. `npx tics`
  must run with nothing to install.
- **`node --test` stays green** and **`node bin/cli.js selftest <install>` passes** —
  the gate must really enforce (red blocks source, green blocks tests, fail-closed on
  empty phase) in a live install.

## Non-destructive installs/updates (the whole point)
- **Never clobber user files.** Mechanism (agents/hooks/method docs) is refreshed;
  user-owned files (tdd.config, state, project-invariants) are seeded once. A locally
  modified mechanism file is backed up to `.bak`, never silently overwritten (manifest
  sha tracking).
- **Managed blocks + overlay.** Entry docs get a thin managed block; user content is
  kept as an overlay. settings.json is content-merged (kit hooks added, user keys
  kept). `.gitignore` is managed via a marker block.
- **Backward compatible.** `update` recognizes legacy `tdd-pairing` markers + the old
  `.tdd-pairing` manifest path and migrates them in place (no duplicate blocks).

## Single source of truth
- The **kit payload (`kit/`) is authoritative**; an install's `.claude/` is a copy.
  After editing `kit/`, re-run the dogfood install so this repo's `.claude/` matches.

## Hygiene
- No secrets; MIT. The published package ships only what `package.json` `files`
  lists (`bin/`, `kit/`, `README.md`) plus `LICENSE`.
