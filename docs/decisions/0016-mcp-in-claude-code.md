# 0016 — The tics MCP server inside Claude Code: convenience + capability OVER the hooks, never a second enforcement path

- Status: **Accepted** (shipped in v0.58.0 through the red→green gate; the Phase-1 end-to-end smoke
  is now DONE. In a live Claude Code session the kit dogfooded itself: a Bash-less `test-writer`
  subagent — which had no bus voice before — emitted a `handoff` over `mcp__tics__tic_emit` and the
  tic LANDED on the shared bus (verified via `tics log`, #1007), and the orchestrator emits over MCP
  too (#1004); a full delegate→handoff→delegate→handoff cycle ran over the framework's own tools
  (#1005/#1007/#1010/#1012), with the Bash-having `implementer` correctly falling back to `tic.sh`
  (it was not granted MCP — least privilege held). Phase-0 facts below were verified against the
  official Claude Code docs (code.claude.com/docs, 2026-06-16) and the shipped kit at HEAD.)
- Date: 2026-06-17
- Deciders: navigator (wants the gate UNTOUCHED and the subagent grants kept NARROW — least
  privilege, not "inherit all MCP tools"; owns the invasive-vs-opt-in `.mcp.json`-on-fresh-install
  knob), architect (the `.mcp.json` contract + writer shape mirroring `writeCursorMcp`, which
  Bash-less roles get which `mcp__tics__*` tools, the convenience-not-enforcement framing, the
  build-slice list), product-owner (the marquee value — the constrained inner pair finally gets
  a coordination-bus voice — and the install-time CC approval nudge).
- Relates to: **EXTENDS 0014 (the tics MCP server)** to a second host. 0014 brought the MCP
  server to Cursor / Claude Desktop, where there are NO hooks, so MCP is the ONLY participation
  path; this ADR brings the SAME server into Claude Code, where the hooks ARE the enforcement and
  MCP therefore sits strictly ON TOP — convenience + capability, never a referee. Inherits 0014 §3
  unchanged: `tic_emit` still rejects `signal`/`block`/`commit`/`session` (the honesty rule), and
  the v0.57 optional `session` arg (0014 §3a) is reused for CC sub-actor self-stamping. Relies on
  **0015 (the worktree model)** — the bus the CC `.mcp.json` server reads/writes is the one shared
  spool bus across worktrees. Touches the honest-gate / evidence / attestation surfaces (0009 /
  0011) only by RESTING on them, never by changing them. Builds on the Bash-less inner-pair role
  constraints and the answerable-asks loop (**0012**) — which this ADR makes reachable from
  `test-writer` for the first time. **Supersedes nothing.**

## Context

### The load-bearing framing: an MCP server cannot enforce — in ANY host

State this first because everything below depends on it. **An MCP server is a tool SURFACE, not
an interceptor.** It exposes tools the agent MAY call (read bus state, emit a tic when the agent
chooses to call a tool); it has no seam to intercept the agent's file edits, no way to block an
out-of-phase write, and no way to run a referee suite and refuse to finish on red. There is no
MCP hook that fires *around* the host agent's actions — the agent calls a tool or it does not.

> **An MCP server CANNOT enforce anything, in any host.** It cannot intercept tool use, cannot
> block an edit, cannot sign a green, cannot refuse to finish on red. It can only offer tools and
> record what the agent voluntarily emits.

Enforcement in team-tactics is, and remains, the **HOOKS** — and only the hooks:

- **PreToolUse guard** — intercepts a file edit and blocks it when it is out of phase / out of
  scope (emits `block`).
- **PostToolUse run-suite** — runs the suite after an edit and signs the result onto the bus as a
  `signal` green/red with `from === "run-suite"` (the `hook-signed` provenance 0009 classifies and
  0011 reuses as red-before-green evidence).
- **Stop require-green** — refuses to finish a turn on a red bar.

Those hooks intercept tool use through a CC-specific seam (PreToolUse / PostToolUse / Stop).
**MCP has no such seam.** So the relationship between MCP and enforcement is opposite in the two
hosts, but the *principle* is identical:

- **In Cursor** (0014): there are NO hooks, so **no enforcement exists at all**. MCP is the ONLY
  participation path. What keeps it honest is the attestation + kind-exclusion layer
  (self-reported greens, the excluded hook-only kinds) — not the MCP server, which enforces
  nothing.
- **In Claude Code** (this ADR): the hooks ARE the enforcement and they run regardless of MCP.
  MCP sits ON TOP of an environment that is *already refereed*. It is therefore **pure convenience**
  (a nicer, safer, narrower interface than raw `Bash`) plus **capability** (it reaches roles that
  have no `Bash` at all). **Adding MCP to CC does NOT dilute the gate** — the gate was never MCP's
  job, MCP never touched the gate's seam, and the gate keeps firing on every edit exactly as before.

Same "MCP = participation, not enforcement" rule as 0014; opposite surrounding reason.

### The real motivation: the Bash-less inner pair has no voice

CC already participates fully on the bus — *for roles that have `Bash`*. The orchestrator and the
`implementer` read their inbox and emit tics by shelling the `tics` CLI / `tic.sh` over `Bash`,
under the hooks. But the constrained inner-pair subagents are **deliberately `Bash`-less** so the
failing test stays their only spec and they cannot wander into arbitrary shell. Verified frontmatter
at HEAD (`packages/tdd/kit/agents/`):

- **`test-writer`** — `tools: Read, Grep, Glob, Edit`
- **`tdd-critic`** — `tools: Read, Grep, Glob`
- **`planner`** — `tools: Read, Grep, Glob, Edit`

None of them has `Bash`, so **today they cannot touch the bus at all** — they can neither read
their inbox nor emit a tic:

- **`test-writer` cannot raise a `need`.** The answerable-asks loop (0012) — the precise mechanism
  for "I'm blocked on a decision, ask and get answered" — is **unreachable from exactly the role
  most likely to need it**. A test-writer that hits an ambiguous spec mid-task has no way to ask.
- **`tdd-critic` cannot emit its own `verdict`.** Its whole output is a `pass`/`concerns`/`block`
  verdict, yet with no emit path it must **ask the orchestrator to relay it** — losing provenance
  (the bus records the orchestrator speaking, not the critic).

Granting these roles **narrow MCP tools** — NOT `Bash` — gives them scoped bus participation
*without* arbitrary shell. That is the marquee value of this ADR, and it is strictly better than
the obvious alternative of granting `Bash`: `Bash` would hand a constrained role the full shell and
break the very constraint that makes the role safe. The MCP tools are a keyhole; `Bash` is the
front door.

### Verified Phase-0 facts (official Claude Code docs, code.claude.com/docs, 2026-06-16)

- **CC subagents CAN use MCP tools from a project `.mcp.json`.** The grant mechanism chosen here is
  the **explicit `tools:` frontmatter allowlist** using the `mcp__<server>__<tool>` name format
  (e.g. `mcp__tics__tic_emit`). (The docs also permit *default-inherit* by omitting `tools:`
  entirely, and per-subagent `mcpServers:` scoping; we use the explicit narrow allowlist for least
  privilege — see Alternatives (b).)
- **`.mcp.json` lives at the repo root**, top-level key `mcpServers`, a stdio entry of shape
  `{ "type": "stdio", "command": <node>, "args": [<repo>/.claude/hooks/tics-mcp.cjs, <repo>] }` —
  **identical in shape to the `.cursor/mcp.json`** the installer already writes (`writeCursorMcp`,
  `tics-mcp.cjs` L331–353): same `type`/`command`/`args` triple, same `process.execPath` for the
  node binary, same `[tics-mcp.cjs, target]` argv. **The file's location IS the project scope** —
  there is no scope field to set.
- **Conditional (document, don't automate):** a project `.mcp.json` server requires a **one-time
  interactive approval** on the next CC launch before its tools become live — the same "inert until
  approved" reality the Cursor installer already prints for `.cursor/mcp.json`. The installer writes
  the file; it cannot click the approval. This is documented in the install note, never automated.
- **`deny` permission rules in `settings.json` apply uniformly to subagents.** (We ship no MCP
  `deny` rule — there is nothing to deny; the narrow allowlist is the whole permission story.)
- **Plugin-packaged subagents cannot use `mcpServers:`/`hooks:` frontmatter.** Irrelevant today —
  tics ships its agents as *project* agents (`.claude/agents/`), not as a plugin — but noted because
  it forecloses a future *plugin* packaging that would want per-subagent `mcpServers:` scoping.

### Grounded against the shipped kit (HEAD)

- `writeCursorMcp(target)` (`packages/tics/kit/hooks/tics-mcp.cjs` L331) already does the exact
  thing we need to mirror: it merges into an existing `mcpServers` object, backs a malformed file up
  to `.bak` before starting clean, and writes the `tics` stdio entry. The new `.mcp.json` writer is
  the same function pointed at a different path.
- `mcpInstall(target)` (L380) calls `writeCursorMcp` + `writeCursorRule` and prints the
  inert-until-approved NOTE. We extend it to ALSO write `.mcp.json` and add a CC line to the note.
- The v0.56 fresh-install auto-run is real and gated correctly: `cli.js` L373 runs
  `tics.mcpInstall(target)` only when `!priorManifest.kitVersion` (first install) — **never on
  update**. Extending `mcpInstall` to write `.mcp.json` automatically rides this same gate.
- `EMITTABLE_KINDS` (L73) already excludes `signal`/`block`/`commit`/`session` and `tic_emit`
  already honors the optional `session` arg (L204) by setting `TICS_SESSION` on the one `tic.sh`
  call — both reused unchanged.

## Decision

Make the **same** tics MCP server usable INSIDE Claude Code, as a **convenience + capability layer
OVER the hooks — never a second enforcement path**, by two additive changes:

1. **The installer also writes a project `.mcp.json`** so the `tics` server is available to CC.
2. **The Bash-less inner-pair subagents are granted the narrow tics MCP tools** so they finally get
   a coordination-bus voice.

### 1. The installer writes `.mcp.json` (mirror `writeCursorMcp`)

Extend `mcpInstall` — which today writes `.cursor/mcp.json` + `.cursor/rules/tics.mdc` — to ALSO
write the project **`.mcp.json`** at the repo root. The writer is a near-clone of `writeCursorMcp`:

- Top-level key `mcpServers`; the `tics` entry is
  `{ "type": "stdio", "command": process.execPath, "args": [ <repo>/.claude/hooks/tics-mcp.cjs, <repo> ] }`
  — **identical shape to `.cursor/mcp.json`** (the location is what makes it CC-scoped vs Cursor-scoped).
- **Merge-not-clobber**, with `.bak`-on-malformed — the exact non-invasive posture `writeCursorMcp`
  already holds (preserve a foreign `mcpServers` object; back up an unparseable file before starting
  clean). An adopter's existing `.mcp.json` (e.g. another team's MCP server) is preserved; only the
  `tics` key is added/updated.

Both entry points pick this up for free: `ttics mcp-install` (explicit) and the v0.56 fresh-install
auto-run (`cli.js` L373, gated on `!priorManifest.kitVersion`) now set up BOTH Cursor and Claude
Code. The install note gains a CC line:

> *"Approve the `tics` MCP server in Claude Code on its next launch — a project `.mcp.json` server
> is inert until you approve it once."*

The installer writes the file; **it cannot click the approval** (Phase-0 conditional) — so this is
documented, never automated, exactly as the Cursor "enable + approve in Settings" note already is.

### 2. Grant the Bash-less roles the narrow tics MCP tools (NOT Bash)

Append to the `tools:` frontmatter of the three Bash-less roles (in the kit at
`packages/tdd/kit/agents/`, which is authoritative — the installed `.claude/agents/` copy is
refreshed from it on update):

- `test-writer`: `Read, Grep, Glob, Edit` **+ `mcp__tics__tic_emit, mcp__tics__tics_inbox, mcp__tics__tics_review, mcp__tics__tics_board`**
- `tdd-critic`: `Read, Grep, Glob` **+ `mcp__tics__tic_emit, mcp__tics__tics_inbox, mcp__tics__tics_review, mcp__tics__tics_board`**
- `planner`: `Read, Grep, Glob, Edit` **+ `mcp__tics__tic_emit, mcp__tics__tics_inbox, mcp__tics__tics_review, mcp__tics__tics_board`**

That is **four** narrow tools each — read your inbox, see open needs, see the fleet board, and emit
an honest tic — and **no `Bash`**. (The 0014 surface also exposes `tics_log` and `tics_answer`; the
inner pair's per-turn loop is "see what's addressed to me, raise/answer a need, contribute," which
these four cover. The set can grow under a later additive note if a role needs `tics_log`/`tics_answer`
— that is purely additive on an existing contract and needs no new ADR.)

**`tdd-critic` GETS `tic_emit`, and this does NOT violate its read-only invariant.** Emitting a
`verdict`/`note` is **coordination, not a code or test edit**: `tic_emit` cannot write a source
file, cannot run an edit, and — by 0014 §3 — cannot forge a `signal`/`block`/`commit`. The critic's
invariant is "suggests, never edits *code or tests*," and a tic is neither. So the critic can finally
speak its own `verdict` *as itself*, with correct provenance, instead of relaying through the
orchestrator.

**Safe to ship unconditionally.** Because the grant is "may use this MCP tool *if it exists*," a role
with the grant on a machine where the `.mcp.json` server is not yet approved simply finds the tools
absent and **degrades to exactly today's behavior** (no bus voice, no error). There is no broken
state — the grant is dormant until approval, then live.

### 3. The honesty boundary is unchanged (and stronger for the Bash-less roles)

`tic_emit` still rejects `signal`/`block`/`commit`/`session` at the tool boundary (0014 §3,
`EMITTABLE_KINDS`, `tics-mcp.cjs` L73/L189) — inherited verbatim. Its meaning differs by role:

- **For the Bash-less roles, this is honesty BY CONSTRUCTION.** MCP `tic_emit` is their *only* emit
  path (they have no `Bash`, no `tic.sh`), so they **physically cannot** forge a referee `signal`,
  a guard `block`, or a `commit`. The role that most needs a voice gets the *safest* possible voice.
- **For the Bash-having roles (orchestrator / implementer), this is a safer default, not new
  enforcement.** They *could* still shell `tic.sh` with any kind over `Bash` — the hooks, not MCP,
  are what keep those honest (a hand-emitted green lands `self-reported`, never `hook-signed`; 0009).
  Routing their voluntary coordination through `tic_emit` is merely a narrower, safer door; it adds
  no gate and removes none.

The v0.57 optional `session` arg (0014 §3a) is reused: a CC fan-out of subagents can self-stamp
distinct `session` identity (provenance, not authentication) so concurrent sub-actors are
distinguishable on the board/conductor — same seam, same `TICS_SESSION` env on the one `tic.sh` call.

## Consequences

- **The inner pair finally participates.** The answerable-asks loop (0012) becomes **reachable from
  `test-writer`** — a blocked test-writer can raise a `need` and be answered, instead of being mute.
  `tdd-critic` emits its **own** `verdict`/`note` with correct provenance, instead of asking the
  orchestrator to relay it. The `planner` can post its plan-time `need`s. The roles that were
  deliberately `Bash`-less are no longer deliberately *voiceless*.
- **One install sets up both tools.** `ttics mcp-install` and the fresh-install auto-run now wire
  BOTH `.cursor/mcp.json` (Cursor) and `.mcp.json` (Claude Code), each merge-not-clobber, from one
  step. A new adopter gets cross-tool coordination out of the box in *both* hosts.
- **The gate is untouched.** No hook changes, no PreToolUse/PostToolUse/Stop change, no `signal`
  provenance change, no bus field, no new dependency. MCP sits on top of the already-refereed CC
  environment; the phase×layer gate fires on every edit exactly as before. Adding MCP did not, and
  structurally could not, dilute enforcement.
- **Least privilege over breadth.** The grant is four narrow `mcp__tics__*` tools per role, NOT
  `Bash` and NOT a default-inherit of every MCP tool. A constrained role gains a keyhole, keeps its
  constraint.
- **Dormant-safe.** With the server unapproved the granted tools simply don't exist and the agent
  behaves as today — so the grants ship unconditionally with no broken intermediate state. The only
  manual step is the one-time CC approval, which the install note flags.
- **Forecloses one future packaging path (noted, not blocking).** Plugin-packaged subagents cannot
  carry `mcpServers:`/`hooks:` frontmatter; tics ships project agents today, so this is irrelevant
  now, but a future *plugin* distribution could not use per-subagent `mcpServers:` scoping and would
  have to rely on the project `.mcp.json` + an explicit `tools:` allowlist (which is what we ship).

## Out of scope (explicitly rejected or deferred)

- **Any enforcement of CC via MCP.** Structurally impossible — an MCP server has no seam to
  intercept tool use, block an edit, sign a green, or refuse to finish on red. Enforcement is the
  hooks and stays the hooks. This ADR is convenience + capability, never a second referee.
- **Replacing the `tics` CLI.** MCP is additive. CC reads still work over the `tics` CLI via `Bash`
  for `Bash`-having roles; the MCP tools are an optional, narrower, also-`Bash`-less interface — not
  a replacement.
- **Granting `Bash` to the constrained roles.** Rejected (Alternatives (a)) — too broad; it breaks
  the role constraint that makes the inner pair safe. The narrow MCP tools are the whole point.
- **Auto-approving the `.mcp.json` server.** Out of scope — CC requires a one-time user approval and
  the installer cannot click it. We write the file and document the approval; we never automate it.
- **Wrapping the hook-only kinds or adding new tools.** `signal`/`block`/`commit`/`session` stay
  excluded from `tic_emit` (0014 §3, inherited). No new MCP tools are added here; the surface is the
  0014 surface, now reachable from CC.
- **The invasive-vs-opt-in `.mcp.json`-on-fresh-install choice is a navigator knob.** Recommendation
  below; the navigator owns the final call.

### The invasive-on-fresh-install recommendation (a navigator knob)

Whether to write `.mcp.json` **invasively on a fresh install** (the v0.56 posture) or make it
**opt-in**: the recommendation is **invasive-on-fresh-install, for consistency with the v0.56
`.cursor/mcp.json` behavior** — it is precisely what *delivers* the subagent-voice value (an opt-in
server ships dormant and undiscoverable, the exact failure v0.56 fixed for Cursor). It stays safe:
merge-not-clobber preserves a foreign `.mcp.json`, the fresh-install gate (`!priorManifest.kitVersion`)
means **updates never re-impose it**, and the server is **still inert until the user approves it in
CC**. But this is called out plainly as the navigator's knob, not the architect's unilateral call.

## Alternatives considered

- **(a) Give the Bash-less subagents `Bash` instead of MCP tools.** Rejected. `Bash` is the entire
  shell — it would let a constrained role run arbitrary commands, breaking the deliberate constraint
  that the failing test is its only spec and `Read/Grep/Glob/Edit` its only reach. The four narrow
  `mcp__tics__*` tools give exactly the bus voice the role needs and nothing more. A keyhole, not a
  front door.
- **(b) Default-inherit all MCP tools by omitting `tools:`.** Rejected on least-privilege. Omitting
  `tools:` would hand each role *every* tool on *every* approved MCP server (now and future), not the
  four bus tools it needs. We want a narrow, explicit, per-role allowlist in the `mcp__<server>__<tool>`
  format so the grant is auditable and bounded.
- **(c) Keep relaying `tdd-critic`'s verdict through the orchestrator forever.** Rejected. Relaying
  loses provenance — the bus records the orchestrator speaking, not the critic — and forces a
  round-trip for what is a one-line coordination emit. The critic should speak its own `verdict` as
  itself; `tic_emit` is coordination, not an edit, so it does not violate the critic's read-only
  invariant.
- **(d) Ship the `.mcp.json` writer as a *new* function rather than mirroring `writeCursorMcp`.**
  Rejected as needless duplication. The merge-not-clobber + `.bak`-on-malformed logic is identical;
  the only difference is the target path (repo-root `.mcp.json` vs `.cursor/mcp.json`). The writer
  is the same shape pointed at a different path — clone the proven behavior, do not re-derive it.

## Phase-1 verification (future, flagged)

The Phase-0 facts above are **doc-derived** (official CC docs + the shipped kit), not yet run
end-to-end in Claude Code. Before this ADR moves to **Accepted**, run the smoke test: write
`.mcp.json`, approve the `tics` server on CC launch, spawn a `test-writer` carrying the
`mcp__tics__*` grant, have it call `tic_emit` (kind `need`), and **confirm the tic lands** via
`tics log` with the right `from` (and, for a fan-out, the right self-stamped `session`). That
empirical confirmation — that a Bash-less CC subagent's tic actually reaches the shared bus — is
the gate from Proposed to Accepted.
