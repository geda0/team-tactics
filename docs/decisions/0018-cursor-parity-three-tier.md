# 0018 — Cursor↔Claude-Code parity: the three enforcement tiers, and closing the delivery drift to Cursor

- Status: **Accepted** (built through the red→green gate; suites green: team-tactics 142, tics 65, tdd 12.
  The shipped teeth — `refreshCursorRule` on update, the thin-pointer Cursor rule, the committed-`.mdc` /
  gitignored-`mcp.json` split, and `RESERVED_FROM`-unforgeable hook identities — are covered by tests in the
  team-tactics and tics suites.)
- Date: 2026-06-17
- Deciders: architect (the three-tier model as the load-bearing frame, where each tier's seam reaches
  Cursor, the single-source-of-truth pointer over a method copy, the gitignore split, the reserved-identity
  boundary), navigator (the honest-provenance line — a role's `from` stays self-asserted, only the HOOK
  identities become reserved; no new authentication invented), product-owner (the adopter-facing promise:
  Cursor reaches parity *in principle and in delivery*, with the irreducible CC-only gap stated plainly,
  not hidden).
- Relates to: makes the parity story of **0014 (tics MCP server)** and **0016 (MCP in Claude Code)** honest
  in *delivery*, not just *in principle* — 0014/0016 established the immovable ceiling (an MCP server cannot
  enforce, in any host), this ADR fixes the parts that were portable but not actually reaching Cursor.
  Hardens **0017 (judgment gates mechanical)** by making GT-1's `from=subagent` delegation signal
  **unforgeable** at the emit boundary (reserved hook identities), and reuses 0017's GT-3 security guard as
  the named tier-3 CC-only surface that Cursor honestly does not get. Rests on **0006 (solo-drift backstop)**
  and **0009 (the honest gate)** without changing them — solo-drift stays a per-CC-session backstop, and a
  hand-emitted green stays `self-reported`. **Supersedes nothing.**

## Context

### The trigger: a proactive parity sweep found "parity in principle" was not "parity in delivery"

0014 and 0016 settled the *principle* of Cursor↔Claude-Code parity: the method is tool-agnostic, the bus is
shared, and the enforcement ceiling (an MCP server cannot intercept a tool call, block an edit, sign a
green, or refuse to finish on red — ADR 0014/0016) is immovable. On paper, Cursor was at parity for
everything below that ceiling. A proactive sweep found it was **not** — the drift was concentrated not in
*what* parity required but in *how it reached Cursor*:

- The managed Cursor rule (`.cursor/rules/tics.mdc`) was written **fresh-init only** (`mcpInstall`), so an
  adopter who installed once and then `ttics update`d kept a **permanently stale** rule — the rule was the
  delivery vehicle for every Cursor-facing guidance change, and that vehicle never moved on update.
- The rule **copied** method guidance rather than pointing at the single source (`AGENTS.md`), so it could
  drift from the canonical method independently.
- The honesty story had a hole: a Cursor agent emitting over MCP `tic_emit` could self-assert any `from`,
  including `subagent` — the exact identity 0017's GT-1 trusts as the unforgeable "a subagent really
  returned" signal.

### The frame: team-tactics has THREE enforcement tiers, and they reach Cursor differently

State this first, because every decision below is "which tier, and how does it reach Cursor." The drift is
only legible against this model:

- **Tier 1 — METHOD (tool-agnostic).** red→green→refactor, phase×layer scope, the roles. Single-sourced in
  `AGENTS.md` + `docs/tdd/`. **Both tools** — it is just text any agent reads. The only failure mode here is
  *copy-drift*: a second copy of the method that rots independently.

- **Tier 2 — PORTABLE referee (any tool).** The git hooks installed by `npx tics install-hooks`: the
  **pre-commit green-bar** (a red suite blocks the commit), the **post-commit `commit`-tic** emitter, and the
  **pre-push release gate (GT-2, ADR 0017)** on a `v*` tag push — plus CI. These fire in git, not in a
  CC-specific hook seam, so they work under **any tool that commits**. GT-2 is therefore **portable to
  Cursor**: a Cursor adopter who runs `install-hooks` gets the release gate. The failure mode here is
  *non-discovery*: the portable referee exists but Cursor adopters are never told to run it.

- **Tier 3 — CC-only referee.** The `.claude/settings.json` hooks: `guard-edit-scope` (the phase×layer edit
  gate, including the **GT-3 security guard**, ADR 0017), `run-suite` green-signing, `require-green-to-stop`,
  GT-1 solo-drift, and the `SubagentStop` `from=subagent` handoff. These intercept tool use through a
  CC-specific seam (PreToolUse / PostToolUse / Stop). **No equivalent seam exists in Cursor** — MCP cannot
  intercept a tool call (the 0014/0016 ceiling), and `.cursor/` has no hook-event surface. This tier is
  **irreducibly CC-only**. The failure mode here is *dishonesty*: pretending Cursor gets it, or worse,
  letting a Cursor agent forge a tier-3 signal onto the shared bus.

The sweep's finding maps cleanly: tier 1 had latent copy-drift in the Cursor rule, tier 2 was portable but
undelivered (the rule never recommended `install-hooks`), and tier 3 had an honesty hole (forgeable
`from=subagent`) plus under-documentation of what Cursor genuinely lacks.

## Decision

Close the delivery drift to Cursor along the three tiers, and record the three-tier model as a **checkable
invariant** future kit changes must respect. Five shipped changes:

### 1. `refreshCursorRule` on every update (tier-1 delivery; `cli.js` L161)

The managed `.cursor/rules/tics.mdc` is now refreshed on `ttics update`, modeled exactly on
`refreshGitHooks` (`cli.js` L141) — the same **refresh-if-present, never-create-on-update, never-clobber-
foreign** posture:

- **Refresh-if-present:** if `.cursor/rules/tics.mdc` does not exist, return — Cursor install is opt-in, an
  update never imposes it (`cli.js` L163, mirrors `refreshGitHooks` L149).
- **Managed sentinel:** the file is rewritten only if it carries the `team-tactics: managed` marker; a
  foreign or user-authored rule of the same name is left untouched (`cli.js` L164).
- **Never-create-on-update:** fresh creation stays in `mcpInstall` (the fresh-init opt-in, ADR 0014 §4 /
  0016 §1); the refresh path only keeps an *already-managed* rule current.

This makes the `.mdc` the live delivery vehicle for Cursor-facing guidance, exactly as `refreshGitHooks`
makes the portable git hooks the live delivery vehicle for the referee. Before this, adopters' Cursor rules
were permanently stale after the first install.

### 2. The Cursor rule is a THIN POINTER, not a method copy (`tics-mcp.cjs` `writeCursorRule`, L370)

`writeCursorRule` was rewritten so the rule **points at `AGENTS.md`** for the method (tier 1's single source
of truth — `cjs` L381) rather than restating it. It does three things and no more:

- Names `AGENTS.md` (then `docs/tdd/tdd-workflow.md` + `docs/tdd/tool-support.md`) as the canonical method —
  **no copy to drift**.
- Recommends **`npx tics install-hooks`** to get the portable tier-2 referee (`cjs` L393): the pre-commit
  green-bar + the pre-push release gate that fire under any tool. This is the fix for tier 2's
  non-discovery — the rule now *delivers* the portable gate to the Cursor adopter.
- Is **honest about tier 3**: it states plainly (`cjs` L390–392) that the Claude Code referee — the
  phase×layer edit gate, **the security-surface guard**, green-bar signing, no-finish-on-red — **does NOT
  run in Cursor**, and that the bus contributions land `unrefereed` (self-reported), never hook-signed.

### 3. The `.mdc` rule stays COMMITTED + refreshed; `.cursor/mcp.json` (and `.mcp.json`) stay GITIGNORED

A deliberate split, because the two files have different natures:

- **`.cursor/rules/tics.mdc` is team-shared guidance, like `AGENTS.md`** — it carries no machine-specific
  data, it should be reviewed in PRs, and every teammate should get the same refreshed rule. So it is
  **committed and refreshed on update** (decision 1).
- **`.cursor/mcp.json` and `.mcp.json` hold machine-specific absolute paths** (the `node` binary and the
  `tics-mcp.cjs` launcher path) and are **regenerated per-machine** by `mcp-install`. So they are
  **gitignored** (`cli.js` L257–259: "MCP server configs hold machine-specific absolute paths — never commit
  (re-generate via mcp-install)").

The rule of thumb the split records: **managed *guidance* is committed and refreshed; machine-specific
*config* is gitignored and regenerated.**

### 4. Hook identities are reserved / unforgeable (`tics-mcp.cjs` `RESERVED_FROM` L77; `tic.sh` L14)

The hook-only `from` identities — **`subagent`, `run-suite`, `guard`, `witness`** — can no longer be
self-asserted by any agent on either emit path:

- **MCP `tic_emit`** rejects a reserved `from` at the tool boundary, before shelling `tic.sh`
  (`tics-mcp.cjs` L193): a Cursor agent (or any MCP caller) emitting `from=subagent` gets a tool error and
  nothing is recorded.
- **`tic.sh`** rejects the same four identities for its first positional arg (`tic.sh` L14): a hand-emit over
  the shell script can't forge them either.
- The hooks themselves still emit these identities — but they do so via **`emit_tic`** in `tics-lib.sh`
  (the run-suite / SubagentStop / guard / witness hooks call `emit_tic` directly, not the `tic.sh`
  front door), so the reserved-`from` reject in `tic.sh` does not block them.

**This makes GT-1's `from=subagent` delegation signal UNFORGEABLE.** 0017's GT-1 counts only handoffs with
`from=subagent` (the `SubagentStop` emission) as "real delegation," precisely because an orchestrator
narrating a solo run could not forge that identity. Reserving the identity at *both* emit boundaries closes
the last hand-emit path — including the new MCP `tic_emit` door that 0016 opened to Bash-less roles and
0014 opened to Cursor.

**The honest-provenance boundary (navigator's line, stated plainly).** This does NOT turn `from` into
authentication. A **role's** `from` (orchestrator, implementer, test-writer, a Cursor agent's role name)
remains **self-asserted provenance**, exactly as before (0009/0014 §3a) — the bus records what the agent
claims, and the honesty layer classifies by *content* (`from === "run-suite"` ⇒ `hook-signed`), not by
trusting the claimant. What changed is narrower and surgical: the four **HOOK** identities are now
**reserved** — they are the names the referee emits, agents are blocked from minting them. We did not invent
a credential; we fenced off the four strings the gate's attestation depends on.

### 5. `tool-support.md` rewritten to the explicit three-tier model + the v0.60 teeth

`docs/tdd/tool-support.md` is rewritten from the prior two-halves framing ("method" vs "the CC referee") to
the explicit **three tiers** above, so an adopter can see, per tier, exactly what each tool gets: the method
(both), the portable referee they should turn on with `install-hooks` (any tool, incl. Cursor — with the
0017 GT-2 release gate), and the CC-only referee (the phase×layer gate **and the GT-3 security guard**) that
Cursor honestly does not run.

## Consequences

- **Cursor reaches parity in DELIVERY, not just in principle.** The managed rule is refreshed on update
  (tier 1 no longer rots), points at the single-source method (no copy-drift), and actively recommends the
  portable tier-2 referee (`install-hooks` → green-bar + GT-2 release gate). What Cursor adopters were
  *entitled* to is now actually *delivered* to them.

- **The three-tier model is now a CHECKABLE INVARIANT.** Future kit changes that touch the Cursor surface
  must respect it, and it is concrete enough to check:
  1. **Method (tier 1) stays single-sourced and pointed-to by both surfaces** — `AGENTS.md`/`docs/tdd` is
     the one copy; the Cursor rule and CC docs point at it, never re-state it.
  2. **The portable referee (tier 2) is recommended to Cursor** — the managed rule tells the Cursor adopter
     to run `install-hooks` so the green-bar + GT-2 release gate apply under any tool.
  3. **Tier 3 is CC-only and documented as such** — any new `.claude/settings.json` hook is named in
     `tool-support.md` and the Cursor rule as a thing Cursor does not get, never silently assumed portable.

- **What is irreducibly CC-only, and it is documented honestly.** The phase×layer edit gate AND the GT-3
  security guard do **not** run in Cursor — there is no MCP/`.cursor/` seam to intercept a tool call
  (0014/0016 ceiling). Both the `.mdc` rule (decision 2) and `tool-support.md` (decision 5) now say this
  plainly. This is stated as a boundary, not patched over with a false claim of portability.

- **Solo-drift stays a per-CC-session backstop, by design — not a cross-tool team meter.** A cross-tool
  `from=cursor` delegation is **not** counted by GT-1 solo-drift. That is **deliberate, not a bug**:
  solo-drift (0006/0017) is a per-CC-session honesty backstop that fires inside a Claude Code Stop hook; it
  has no visibility into, and makes no claim about, a Cursor session's team engagement. Reserving
  `from=subagent` (decision 4) makes the signal it *does* count unforgeable; it does not, and should not,
  turn solo-drift into a cross-tool team-engagement gauge. Cross-tool coordination is observed on the shared
  bus (0015), not enforced by a per-session backstop.

- **The honesty layer is strengthened without inventing authentication.** GT-1's delegation signal is now
  unforgeable on every emit path (MCP + shell), while a role's `from` stays the same self-asserted
  provenance it always was. No crypto, no credential, no bus field — just four reserved strings fenced off
  at the two agent-facing emit doors.

- **Cost, accepted.** One new `refreshCursorRule` function on the update path; a reserved-identity check at
  two emit boundaries (`tic_emit` + `tic.sh`); a rewritten Cursor rule and `tool-support.md`; the
  gitignore split made explicit. No change to the phase×layer gate, run-suite, the honest-gate/evidence
  surfaces, or the MCP tool surface (the 0014 `EMITTABLE_KINDS` enum is unchanged; `RESERVED_FROM` is an
  additional, orthogonal check on `from`).

## Out of scope (explicitly rejected or deferred)

- **Any phase×layer or security-guard enforcement in Cursor.** Structurally impossible — no Cursor seam
  intercepts a tool call (0014/0016 ceiling). Tier 3 is CC-only; this ADR documents that honestly rather
  than faking it. An adopter who wants the full referee runs the work in Claude Code; Cursor gets the
  method, the portable git-hook referee, and honest bus participation.

- **Counting cross-tool `from=cursor` delegation in solo-drift.** Rejected as a category error — solo-drift
  is a per-CC-session backstop, not a cross-tool team meter. Reserving `from=subagent` hardens the signal it
  counts; turning it into a cross-tool gauge would require a per-session model the framework does not have
  and is out of scope (the same boundary 0017 drew: these teeth measure engagement at a seam, not the
  judgment behind it).

- **Making `from` authenticated.** Rejected — a role's `from` stays self-asserted provenance (0009). Only
  the four HOOK identities are reserved. Inventing a per-agent credential is a much larger surface (0014
  notes the only future cross-check would be the conversation-id Cursor delivers to *hooks via STDIN*, which
  Cursor does not expose to MCP) and is not needed to make GT-1's signal unforgeable.

- **Committing `.cursor/mcp.json` / `.mcp.json`.** Rejected (decision 3) — they hold machine-specific
  absolute paths and are regenerated per-machine by `mcp-install`; only the machine-agnostic `.mdc`
  *guidance* is committed and refreshed.

- **Copying the method into the Cursor rule for offline/standalone readability.** Rejected (decision 2) — a
  second copy is exactly the tier-1 copy-drift the sweep found. The rule points at `AGENTS.md`; the single
  source of truth has one copy.

## Alternatives considered

- **(a) Leave the Cursor rule fresh-init-only and tell adopters to re-run `mcp-install` after an update.**
  Rejected — a "remember to re-run it" step is the anti-pattern (same lesson as 0005's amendment): adopters
  won't, and the rule rots silently. `refreshCursorRule` on update makes the delivery automatic, exactly as
  `refreshGitHooks` already does for the portable hooks.

- **(b) Keep the method copied in the `.mdc` so a Cursor agent has it inline.** Rejected — copy-drift. The
  thin pointer to `AGENTS.md` keeps one canonical method; the rule covers only the bus + the
  enforcement-you-do-and-don't-get-in-Cursor delta.

- **(c) Restrict the reserved identities only at the MCP `tic_emit` boundary (not in `tic.sh`).** Rejected —
  that would leave the shell front door open: a Bash-having role could hand-emit `from=subagent` over
  `tic.sh` and forge GT-1's signal. Both agent-facing emit doors must reject the reserved identities; the
  hooks keep emitting them via `emit_tic`, which is not an agent-facing door.

- **(d) Make `from` authenticated end-to-end instead of just reserving the hook identities.** Rejected as
  out of proportion and impossible in the MCP host (no per-call caller credential — 0014 §3a). Reserving the
  four hook strings is the smallest change that makes GT-1's signal unforgeable while leaving the honest,
  self-asserted-provenance model of role `from` intact.

- **(e) Document tier 3 as "not yet supported in Cursor" (implying a future bridge).** Rejected — it is not
  a roadmap gap, it is an immovable ceiling (0014/0016). Documenting it as honestly CC-only is more truthful
  than implying parity is coming; what *is* portable (tier 2) is recommended explicitly instead.
