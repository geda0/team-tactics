# 0007 — A locally-customized agent survives `update` (graduates to user-owned)

- Status: Accepted
- Date: 2026-06-10
- Deciders: navigator (FREEZE: preserve the adopter's bytes, park the kit version
  beside for opt-in re-sync), product-owner (selected N8, recommended preserve),
  architect (the refresh-contract seam)
- Relates to: 0005 (full framework by default — this removes a friction *against*
  keeping the team installed). Extends the non-destructive-update promise from
  hooks (`local.d/*.sh`, slice B3) to the agent `.md` files. Supersedes nothing.

## Context

`update` REFRESHES every kit agent: the inner pair (`test-writer`, `implementer`,
`tdd-critic`, `planner` from `@ttics/tdd`) and, under the sticky `full-team` preset,
the five outer-loop roles (`product-owner`, `architect`, `qa-verifier`,
`project-manager`, `dev-ops`). All go through `refresh()` in `cli.js`, which on a
locally-modified file backs the old copy up to `<file>.bak` and overwrites with the
kit version.

For a mechanism file (a hook, `lib.sh`) that is correct: the mechanism MUST stay
current and the kit's version is authoritative. For an **agent**, the prose IS the
product surface an adopter is meant to tailor — Based customized all five outer-loop
agents (project seam, AWS specifics, the brief, release log, DoD content). On every
`update` those edits were clobbered into `.bak` and had to be hand-re-merged. That is
a recurring tax that pushes adopters toward `--minimal` — the opposite of ADR 0005's
full-by-default stance.

The natural fix elsewhere in the kit — an overlay/extension file (as hooks get with
`local.d/*.sh`) — is **infeasible for agents**: Claude Code loads exactly one `.md`
per role under `.claude/agents/`, keyed by the `name:` frontmatter. There is no
documented multi-file composition per role (two files with the same `name:` collide
rather than merge). Hooks can compose because the gate sources many shell files at
runtime; agent loading has no such seam. So preservation, not overlay, is the only
mechanism available.

## Decision

**On `update`, a locally-MODIFIED agent is PRESERVED byte-for-byte; the kit's current
version is parked beside it for opt-in adoption.** Concretely, in the AGENT refresh
path only:

1. **Detect modified vs pristine the same way `refresh()` already does** — compare the
   on-disk sha256 to the prior-manifest sha for that path. Modified ⇒ on-disk differs
   from the recorded sha. On a FIRST install there is no prior file (and no prior sha),
   so nothing is "modified" — it is a normal seed/refresh; preserve triggers only on an
   UPDATE where a tracked agent's bytes have diverged.

2. **Modified agent ⇒ preserve.** Leave the adopter's file untouched. Write the kit's
   version beside it as `.claude/agents/<role>.md.kit-<KITVERSION>` (the running kit
   version, == `tics --version` == the manifest `kitVersion`). This is deliberately NOT
   `.bak`: `.bak` reads as "your old copy, safe to delete"; here the parked file is the
   inverse — the NEW kit version, available to diff/adopt. No `.bak` is written on the
   preserve path.

3. **Pristine agent ⇒ refresh as today.** On-disk sha == prior sha ⇒ overwrite in place,
   no sidecar. Customization-preservation must never freeze agents nobody touched; the
   kit still flows by default to untouched roles.

4. **`--force` ⇒ take the kit version.** With `--force`, a modified agent is overwritten
   by the kit version, parity with how `--force` resets seeded (user-owned) files.

5. **Re-update keeps only the CURRENT kit version's sidecar.** The sidecar is named by
   version, so a newer kit overwrites only its own `<role>.md.kit-<newver>` and does not
   accumulate stale `.kit-*` files for old versions. (Naming-by-version makes "don't
   multiply sidecars for the same version" automatic; a prior version's sidecar from an
   intermediate update is left as a historical diff target — acceptable, and the adopter
   can delete it. We do NOT sweep older `.kit-*` files.)

6. **Discoverability, one line, only on a preserve.** When ≥1 agent was preserved, the
   run names the preserved agent(s) and points at the parked `.kit-<version>` as how to
   adopt kit changes, and tallies a "preserved" count in the manifest summary line
   (parallel to the existing backups tally). Nothing extra prints on an update where no
   agent was preserved — same terse rule as the B3 backup pointer.

7. **Gitignore.** The managed `.gitignore` block must ignore the sidecar. The existing
   `.claude/**/*.bak` pattern does NOT cover `<role>.md.kit-<version>` (no `.bak`
   suffix), nor does `*.team-tactics.*`. Extend the managed block with a pattern that
   covers it (e.g. `.claude/agents/*.md.kit-*`).

**Scope.** This behavior is the AGENT files ONLY. Hooks, `lib.sh`, method/entry docs,
the portable git hooks, the settings merge, and the entry-doc overlay keep their
current overwrite-and-`.bak` (or merge) behavior unchanged. The cleanest implementation
is a `refreshAgent(...)` variant of `refresh(...)` (or a `{ agent: true }` flag on
`refresh`) called by BOTH agent loops; the non-agent `refresh(...)` calls are untouched.

## Consequences

- **The contract changes: a customized agent graduates from kit-owned to user-owned.**
  This is the substantive reason this is an ADR and not just a code comment — it moves a
  file class boundary. A mechanism agent the adopter has edited is, for refresh purposes,
  now treated like a `seedOnce` file (preserved), with the kit version offered alongside
  rather than auto-applied.
- The Based friction is removed: an `update` no longer clobbers a tailored agent;
  re-syncing kit improvements becomes a one-glance diff against the parked sidecar.
- **Accepted cost:** a customized agent stops auto-receiving kit improvements until the
  adopter diffs the parked `.kit-<version>` and re-syncs. That is the adopter's
  deliberate trade for having customized it; the parked file makes it cheap. `--force`
  is always the escape hatch back to the kit copy.
- Untouched agents still track the kit automatically (Decision 3), so a never-customizing
  adopter sees zero behavior change and no new files.
- One new code path + one extended gitignore pattern + a "preserved" tally; no new
  dependency, pure-Node installer.

## Alternatives considered

- **Overlay / extension file (`agents/local.d/<role>.md`), as hooks get.** Rejected —
  INFEASIBLE. Claude Code loads one `.md` per role keyed by `name:`; there is no
  documented per-role composition (same-`name:` files collide, an appended file is never
  loaded into the role). Hooks compose because the gate sources shell files at runtime;
  agent loading has no equivalent seam.
- **Overwrite + a louder `.bak` pointer (option b).** Rejected by the navigator. It makes
  the clobber legible but the adopter STILL re-merges from `.bak` on every update — it
  does not relieve the friction Based actually hit; it only narrates it.
- **Park as `.bak` (reuse the existing suffix).** Rejected: `.bak` semantically means
  "your old copy," but the parked file is the NEW kit version. Reusing the suffix would
  mislead and would mix with the mechanism `.bak` files in output and gitignore.
- **Sweep all stale `.kit-*` on each update.** Not done: naming by version already
  prevents same-version duplication; sweeping prior-version sidecars is extra file
  deletion for marginal tidiness and risks removing a diff target the adopter is mid-use.
