# 0014 — The tics MCP server (`tics mcp`): a Cursor / Claude-Desktop access path onto the shared tic bus (PARTICIPATION, not enforcement)

- Status: **Proposed** (design finalized; verified against current Cursor + MCP-spec + npm facts
  2026-06-16; ready to build — but NOT yet built, and nothing here ships until an epic implements
  it, so this is not yet Accepted. A prior 0014 was reverted with the v0.54.0 slim-down; this ADR
  starts clean against the post-slim-down kit and does not inherit it.)
- Date: 2026-06-16
- Deciders: navigator (reviews this ADR before any code; wants a TIGHT tool surface — the
  minimal viable participation loop, not a wrapper for every reader), architect (the transport
  contract, the tool surface + which reader export each wraps, the honesty-rule kind-exclusion,
  the `tics mcp` / `tics mcp-install` shape, the build-slice list), product-owner (participation
  vs enforcement framing; the install-time Cursor nudge).
- Relates to: **0015 (the worktree model)** — the bus is now the SHARED coordination substrate
  ACROSS git worktrees (one spool bus at the git-common-dir; "git isolates, the bus observes").
  This MCP server is a non-CC tool's ACCESS PATH onto that same shared bus: a CC worktree
  participates via hooks, a Cursor session participates via MCP, both reading/writing the one
  `TIC_STORE=spool` / `TICS_DIR` bus. Builds DIRECTLY on the shipped honesty layer that makes
  non-CC participation safe: **0009 (the honest gate)** — a hand-emitted green lands
  `self-reported`, not `hook-signed`; **0011 (evidence-gated greens)** — a green is honored only
  if a hook-signed red preceded it; **0012 (the answerable-asks loop)** — `tics_answer` wraps the
  already-shipped `ticsAnswer` require-to-read / shell-to-emit pattern. Reuses the reader
  (`tics-view.cjs`) and `tic.sh` exactly as the existing CLI does; adds NO bus field, NO crypto,
  NO new dependency. Supersedes nothing.

## Context

### The access gap (what MCP closes) vs the enforcement ceiling (what it cannot)

team-tactics' coordination substrate is the **tic bus**: an append-only, concurrency-safe
spool of structured agent-to-agent communication units (`.claude/state/tics.d/`, shared across
worktrees via `TICS_DIR` per 0015). Inside Claude Code, agents participate in that bus through
**hooks**: the PostToolUse referee emits a `signal` green/red, the guard emits a `block`, the
post-commit hook emits a `commit`, and roles hand-emit `delegate`/`handoff`/`need`/`verdict`
via `tic.sh`. The reader (`tics-view.cjs`) folds it into inbox / board / conductor / review /
gate views.

A Cursor or Claude-Desktop agent has **none of that**. It cannot read its inbox, see the
fleet board, or emit an honest handoff onto the shared bus — not because it shouldn't
participate, but because it has no access path. The CC hooks are CC-specific (PostToolUse /
PreToolUse / Stop / git hooks); they do not exist in an MCP host. So today a Cursor session
working in a sibling worktree is **invisible to the bus and blind to it** — it can't coordinate
with the CC fleet at all.

This ADR closes the **access** gap with an MCP server. It does **NOT** — and cannot — close the
**enforcement** gap, and the ADR states that distinction plainly because it is load-bearing:

> **The phase×layer gate is a Claude-Code PostToolUse/PreToolUse referee. It does not, and
> cannot, fire in Cursor or Claude Desktop.** No MCP server changes that — an MCP host runs no
> CC hooks, so the gate that blocks an out-of-phase edit, runs the suite, and refuses to finish
> on red is structurally absent there. That ceiling is **immovable**. MCP gives a non-CC agent
> a way to **PARTICIPATE** in the bus (read its inbox/board/open-needs, emit honest tics); it
> gives it **NO** way to be **ENFORCED** by the gate.

What keeps that participation safe — what makes "an unenforced agent on the shared bus" honest
rather than a forgery vector — is the **already-shipped honesty layer**, not anything new here
(see Decision §3). MCP rides on top of it.

### Why the honesty layer makes unenforced participation safe (already SHIPPED — referenced, not rebuilt)

The fear is obvious: if a non-CC agent can emit onto the SAME bus the gate trusts, can it
LIE to the gate — forge a green, fake a scope-block, manufacture a commit? The honesty layer
already answers this, and the MCP tool surface is designed to stay strictly inside the safe
region it defines:

- **0009 (E8, the honest gate).** A green `signal` is classified `hook-signed`
  (`from === "run-suite"`, the CC referee) vs `self-reported` (anything hand-emitted). A green
  that did not come from the referee is `self-reported` and the release gate can flag/block it
  (`ATTEST_ENFORCE`). So even if a Cursor agent could emit a `signal` green, it would land
  `self-reported` — visibly unrefereed, not proof.
- **0011 (E10, evidence-gated greens).** A green is HONORED only if a **hook-signed** red
  preceded it on the same scope. A non-CC agent cannot produce a hook-signed red (it is not the
  referee), so it cannot manufacture red-before-green evidence; its greens stay un-honored.
- **0012 (E11, the answerable-asks loop).** `ticsAnswer` is the precedent the MCP write-side
  mirrors: it **requires** `tics-view.cjs` to READ open needs and **shells `tic.sh`** to EMIT
  the answer (require-to-read / shell-to-emit). Every MCP write-tool uses that exact split.

So the safe design is not "trust the Cursor agent"; it is "let the Cursor agent emit only the
kinds it CANNOT use to deceive the gate, and let the shipped attestation classify everything
it does emit." The kind-exclusion in §3 is what enforces that — it is the load-bearing rule of
this ADR.

### Grounded against the CURRENT (post-v0.54.0-slim-down) kit

This ADR is written against the slim-down HEAD, not the reverted prior 0014:

- **Reader exports** (`packages/tics/kit/hooks/tics-view.cjs`, `module.exports` L634):
  `ticsLog ticsInbox ticsConductor ticsClaims ticsSections ticsCycle ticsGate ticsBoard
  ticsReview ticsRoster ticsAnswer claimOwner claimSession` (+ folds: `evidenceFor`,
  `attestationTally`, `openNeeds`, `toolTally`, `fleetModel`). **`ticsSessions` and `ticsTodo`
  were REMOVED in the slim-down** (0015 §"Removed vs kept") — they are NOT wrapped here.
- **Emit** (`packages/tics/kit/hooks/tic.sh` + `tics-lib.sh`). Valid kinds (L15):
  `delegate handoff signal block stuck verdict msg note claim release contract need section
  session commit`. `emit_tic` stamps `from`/`to`/`kind`/`msg`/`ref`/`result` and the ambient
  `phase`/`layer`/`scope`/`session`/`seq`/`ts` from local state; it does NOT itself authenticate
  `from` (that is the whole reason the honesty layer classifies by `from === "run-suite"` rather
  than trusting it).
- **Dispatch.** The CLI dispatches a fixed `KNOWN` list to `TV.*` calls in both
  `packages/tics/bin/tics.js` (L10–11) and `packages/team-tactics/bin/cli.js` (L10, L91–97);
  `tics roster` (0010) and `tics review` (0012) are the precedent for adding a new subcommand.
  `@ttics/tics` is genuinely **zero-dependency** (no `dependencies` key); the meta-package
  depends only on the workspace `@ttics/*`. The MCP server must preserve that.

## Decision

Add **`tics mcp`** — a hand-rolled, **zero-dependency** stdio JSON-RPC 2.0 MCP server — and
**`tics mcp-install`** — a writer that registers it with Cursor and drops an `alwaysApply` rule
nudging the agent to use it. The server **requires `tics-view.cjs` to READ** (same as the CLI
reader) and **shells `tic.sh` to EMIT** (same as `ticsAnswer`). It exposes a **tight** tool
surface: a few read-tools a Cursor agent needs each turn, plus write-tools restricted to the
**agent-emittable** kinds — the kinds excluding `signal`/`block`/`commit`/`session`, which keeps
a non-CC agent from lying to the E8/E10 gate. No new bus field, no crypto, no new dependency.

### 1. Transport — hand-rolled, zero-dependency stdio JSON-RPC 2.0

- **No MCP SDK.** `@modelcontextprotocol/sdk` (latest **1.29.0**, published 2026-03-30, actively
  maintained, `engines.node >=18`) declares **17 direct runtime dependencies** — `express ^5`,
  `hono` + `@hono/node-server`, `ajv` + `ajv-formats`, `jose`, `zod`, `zod-to-json-schema`, `cors`,
  `raw-body`, `eventsource` + `eventsource-parser`, `pkce-challenge`, `express-rate-limit`,
  `cross-spawn`, `content-type`, `json-schema-typed`. It is a full client + server + HTTP + OAuth2.1
  stack; for a local stdio tools-only server that needs only a stdin/stdout JSON-RPC loop, ~99% of
  that is dead weight, and every genuinely heavy 2025-11-25 addition it carries (OAuth2.1,
  Streamable HTTP, tasks, elicitation, sampling) is optional and unused here. Adopting it would
  also break the zero-dep invariant the whole kit holds. The MCP wire protocol over stdio is small
  enough to hand-roll in pure Node CommonJS. **Rejected: `@modelcontextprotocol/sdk` 1.29.0**
  (Alternatives).
- **Stdio, newline-delimited JSON-RPC 2.0.** The server reads JSON-RPC request objects on
  **stdin** (one JSON object per line) and writes response objects on **stdout** (one per line).
  At 2025-11-25 stdio is still exactly this: newline-delimited JSON-RPC 2.0, one UTF-8 message per
  line, each message **MUST NOT** contain embedded newlines, stdout **MUST** carry only MCP frames,
  and stderr is free for logging. The hand-roll surface (`initialize` → `notifications/initialized`
  → `tools/list` → `tools/call`) is stable at the current revision, so the ~150-line pure-Node
  estimate holds. This is the transport Cursor / Claude Desktop launch (`command` + `args` in
  `mcp.json`); it is also trivially **unit-testable** — feed a request line, assert the response
  line — with zero network and zero deps (see the build slices).
- **Handshake.** Respond to `initialize` with `serverInfo`
  (`{ name: "tics", version: <PKG.version> }`) and `capabilities: { tools: {} }` (tools-only; no
  resources/prompts in v1), and honor the `tools/list` and `tools/call` methods. **Protocol
  version + negotiation.** The server's latest supported revision is **`2025-11-25`** (the current
  published MCP revision; lineage 2024-11-05 → 2025-03-26 → 2025-06-18 → **2025-11-25**). Negotiate
  per spec: **echo the client's requested `protocolVersion` when the server supports it; otherwise
  reply with the server's own latest (`2025-11-25`).** This keeps older Cursor / Claude-Desktop
  clients (which may request an earlier revision) handshaking cleanly instead of being rejected.
  (The HTTP `MCP-Protocol-Version` header / 2025-03-26 header-fallback is HTTP-transport-only and
  irrelevant to this stdio server.)
- **stdout is the RPC channel ONLY.** stdout carries JSON-RPC frames and nothing else. **All
  logging goes to stderr.** A stray `console.log` on stdout corrupts the framing — this is a
  hard rule the server must hold (and the slices test for it).
- **Error channel — two distinct kinds (2025-11-25).** *Protocol-level* malformedness — bad JSON,
  an unknown method, an unknown tool, or a malformed params envelope → a well-formed JSON-RPC
  **error object** (`code` + `message`), never a thrown crash and never a non-RPC line on stdout.
  *Tool-level* problems — invalid tool ARGUMENTS (including the `tic_emit` excluded-kind reject in
  §3) and a tool whose underlying read/emit fails → a `tools/call` **result with `isError: true`**
  and a stderr-logged cause, NOT a JSON-RPC error. The spec is explicit that tool-argument
  validation errors are reported in the result (`isError`), not as protocol errors, so the agent
  sees them as a tool outcome it can react to. Both paths are degrade-safe — the same posture the
  reader folds hold.
- **The bus it reads/writes is the SHARED bus (0015).** The server resolves the target dir
  (cwd, the Cursor workspace root) and reads/writes the SAME `TIC_STORE=spool` / `TICS_DIR`
  bus a CC worktree uses — it does not create a parallel store. The Cursor session is just
  another participant on the one shared bus.

### 2. The tight tool surface (the navigator wants this TIGHT)

The surface is the **minimal viable participation loop** for a Cursor agent: each turn it needs
to (a) see what's addressed to it, (b) see the fleet/work state, (c) see what's being asked, and
(d) contribute honestly. Anything not load-bearing for THAT loop is cut. Each tool wraps an
existing reader export or shells `tic.sh`; nothing re-implements bus logic.

**READ-tools (wrap a `tics-view.cjs` export; require-to-read):**

| tool | wraps | why it's in the loop |
|---|---|---|
| `tics_inbox` | `ticsInbox(target, role, scope)` | The agent must see tics addressed to its role or broadcast (`to === role | "*"`). The single most important read each turn — "what do I need to act on?" |
| `tics_board` | `ticsBoard(target, all)` | The fleet at a glance — who's active on which scope, liveness, collisions (0008). The agent's situational awareness across worktrees. |
| `tics_review` | `ticsReview(target, scope, all)` | The open-needs queue (0012). The agent sees what's being ASKED so it can answer (pairs with `tics_answer`). |
| `tics_log` | `ticsLog(target, scope, all, /*witness*/false)` | The raw thread (collapsed run-suite). The fallback read when inbox/board aren't enough — the full coordination history. Witness notes excluded (see Out of scope). |

**WRITE-tools:**

| tool | mechanism | why it's in the loop |
|---|---|---|
| `tic_emit` | shell `tic.sh FROM TO KIND MSG [REF] [RESULT]` | The agent CONTRIBUTES — a handoff, a need, a verdict, a claim, a note. Kind enum is RESTRICTED (see §3). This is the participation verb. |
| `tics_answer` | `ticsAnswer(target, handle, text, fromRole, all)` | Close an open need (0012). The require-to-read / shell-to-emit precedent this whole design mirrors; pairs with `tics_review`. |

**Justification for what is CUT (kept tight on purpose):**

- `tics_conductor`, `tics_claims`, `tics_sections` — orchestrator/architect-grade grouping
  views, not a per-turn read for a Cursor PARTICIPANT. `tics_board` already gives the at-a-glance
  fleet state a participant needs; the deeper conductor/claims/sections views are a CC
  orchestrator concern. Cut from v1; addable later if a Cursor-as-orchestrator use emerges.
- `tics_gate` — the RELEASE gate is an enforcement/CI consumer (the verdict + attestation +
  evidence surfaces). It is not a participation read, and surfacing it risks implying the gate
  is something a Cursor agent can satisfy (it cannot — §the ceiling). Cut.
- `tics_cycle` — reads `.claude/state/phase|layer|scope`, which are **CC-hook state** the
  Cursor session does not drive. Showing a Cursor agent a phase it can't participate in is
  misleading. Cut.
- `tics_roster` (0010) — model-tiering is a CC spawn convention; not a Cursor participation
  read. Cut.
- The witness `toolTally` (0013) — an opt-in CC activity record; out of scope for a Cursor
  agent's surface and noisy. Cut (and `tics_log` passes `showWitness=false`).

That leaves **6 tools** (4 read, 2 write) — the tight set. The navigator can trim further at
review (e.g. drop `tics_log` if `tics_inbox` + `tics_board` cover the loop); the floor that must
remain is `tics_inbox` + `tic_emit` (read your inbox, contribute honestly) plus `tics_review` +
`tics_answer` (the answerable-asks pair). (Cursor users report a practical ~40-enabled-tool cap
across all MCP servers — forum-attested, not in the official docs — so not a hard fact; either
way, a single-purpose 6-tool server sits comfortably within it.)

### 3. The honesty rule (LOAD-BEARING): `tic_emit` excludes `signal` / `block` / `commit` / `session`

`tic_emit`'s `kind` parameter is a **closed enum** that is a STRICT SUBSET of `tic.sh`'s valid
kinds. It permits **only the agent-emittable kinds** and **rejects** the hook-emitted /
unforgeable kinds at the tool boundary (before `tic.sh` is ever shelled):

- **Agent-emittable (the `tic_emit` enum):**
  `delegate handoff stuck verdict msg note claim release contract need section`
- **EXCLUDED — `signal`, `block`, `commit`:** these are **hook-emitted and unforgeable by
  design**, and the honesty layer's attestation rests on that:
  - `signal` is emitted by the **run-suite hook** with `from === "run-suite"` — that exact
    string is what 0009 classifies as `hook-signed` and 0011 reuses as the red-before-green
    evidence. If a Cursor agent could emit a `signal` green/red, it would be forging the
    referee's identity — manufacturing a `hook-signed` green or a hook-signed red that fakes
    red-before-green evidence. **Excluding `signal` is precisely what prevents a non-CC agent
    from lying to the E8/E10 gate.** (A hand-emitted green via `tic_emit` is impossible because
    `signal` is not in the enum; and even the existing hand-emit path lands `self-reported`, not
    `hook-signed` — see 0009 — so the gate is doubly protected.)
  - `block` is emitted by the **guard hook** when it refuses an out-of-phase/out-of-scope edit.
    A forged `block` would fake the referee's verdict. Excluded.
  - `commit` is emitted by the **post-commit hook**. A forged `commit` would fabricate a commit
    record on the bus. Excluded.
- **EXCLUDED — `session`:** the slim-down (0015) removed the session lifecycle (open/close
  beacons, `sessClosed`/`sessLatest`/registry). The `session` *field* survives for attribution,
  but the `session` *kind* now has **no lifecycle consumer** — it is vestigial. Excluding it
  keeps the tool surface honest (no kind that drives nothing) and avoids tempting a Cursor agent
  to emit lifecycle tics that go nowhere. (0015 §Risks noted keeping the `session` kind in the
  tool enum for a paused mcp build; that risk note predates this clean ADR — with the lifecycle
  gone, this ADR's call is to EXCLUDE it. If a future need for non-CC session attribution
  appears, re-add it under its own ADR.)

**Enforcement of the rule.** The enum is validated **in the MCP server**, at the `tic_emit`
tool boundary — an excluded kind is invalid tool ARGUMENT, so it returns a `tools/call` **result
with `isError: true`** (the §1 tool-error channel, NOT a JSON-RPC protocol error) and **never
shells `tic.sh`**. (`tic.sh` itself still accepts all kinds for the hooks' own use; the
restriction lives in the tool, not the script — the tool is the non-CC agent's only door.) This is
the one place a reviewer must scrutinize: the enum IS the safety boundary.

In one line: **a Cursor agent can emit honest coordination tics it CANNOT use to deceive the
gate — because the three hook-signed kinds (`signal`/`block`/`commit`) and the vestigial
`session` are not in the enum, and everything it CAN emit is classified by the shipped
attestation as the unrefereed contribution it is.**

### 4. `tics mcp-install` — register the server + nudge the agent (convention, not a gate)

MCP *surfaces* tools but does not *compel* their use. So `tics mcp-install` writes BOTH the
server registration AND a rule that tells the Cursor agent to actually use it each turn
(mirroring the established mc-cursor install pattern):

1. **`.cursor/mcp.json`** — add a stdio server entry under top-level `mcpServers`, keyed by name
   (`mcpServers.tics`): `{ "command": "<node>", "args": ["<path to the tics mcp launcher>"] }`
   (resolved so it runs `tics mcp` against the workspace). This matches Cursor's canonical local
   `{ command, args, env }` example exactly. (`type: "stdio"` ambiguity: Cursor's field table lists
   `type: "stdio"` as Required, yet every canonical JSON example omits it — Cursor infers the
   transport from `command` vs `url`. Writing `command`/`args` only is safe and matches the
   examples; the installer MAY additionally write `"type": "stdio"` to satisfy the table.)
   **Merge, don't clobber:** if `.cursor/mcp.json` exists, add/update only the `tics` key and
   preserve the rest (same non-invasive posture as the kit's git-hook install — never overwrite a
   foreign file).
   **Inert until enabled + approved — the installer MUST print this.** A freshly written
   `mcp.json` entry does NOT make the tools live: in Cursor the server stays inert until the user
   ENABLES it AND APPROVES tool use in Settings → Tools & MCP (Cmd/Ctrl+Shift+J — Cursor asks for
   approval before using MCP tools by default). A silently-installed-but-disabled server looks
   broken, so `mcp-install` should explicitly tell the user to enable + approve it after install.
2. **`.cursor/rules/tics.mdc`** (an **"Always Apply"** rule — the current Cursor rule-type display
   name; the `alwaysApply: true` frontmatter KEY is unchanged) — a short directive telling the
   agent: at the start of each turn, call `tics_inbox` (your role) and `tics_board`; check
   `tics_review` for open needs you can answer; and emit honestly with `tic_emit`/`tics_answer` as
   you coordinate. The verified Always-Apply shape is `---` / `alwaysApply: true` / `---` / a blank
   line / markdown bullets (`description`/`globs` omitted/ignored for Always). (Do NOT write a root
   `.cursorrules` file — it is legacy, dropped from current Cursor docs and reported as no longer
   auto-injected; use `.cursor/rules/tics.mdc`.) It states the ceiling plainly: *this is
   convention, not a gate — the phase×layer referee does not run in Cursor; emit truthfully because
   the bus is shared with an enforced CC fleet and your contributions are classified as
   unrefereed.*

**The honest ceiling, restated at install.** The `mcp-install` nudge is a CONVENTION (a rule
the agent is asked to follow), NOT a gate (nothing forces it). This is the same honest posture
as the CC every-prompt directive (ADR 0005/0006): we make the right behavior the default,
visible, and asked-for; we do not (and cannot, in an MCP host) compel it. An adopter who wants
enforcement runs the work in Claude Code; Cursor gets honest participation.

### 5. Wiring — a new subcommand in `@ttics/tics`, zero new deps

- `bin/tics.js` and `packages/team-tactics/bin/cli.js`: add `"mcp"` and `"mcp-install"` to the
  `KNOWN` list and dispatch them (the same shape `roster`/`review` were added with). `tics mcp`
  starts the stdio server (blocking, reads stdin); `tics mcp-install [target]` runs the writer
  from §4.
- The server module lives in the kit (`packages/tics/kit/hooks/`, e.g. `tics-mcp.cjs`) so it is
  installed alongside the reader and refreshed on update; `kit/` is authoritative (edit the kit,
  not the installed copy). It `require`s `tics-view.cjs` for reads and `cp.execFileSync`s
  `tic.sh` for emits — the exact two seams the CLI and `ticsAnswer` already use.
- **Zero new dependency, pure Node CommonJS, Node ≥16** — preserved (the whole reason §1 rejects
  the SDK). No bus field added; no `tic.sh`/`emit_tic` change; no crypto.

## Build plan (ordered slices — each red→green where testable; server is unit-testable over stdio)

The server is a pure stdin→stdout function of JSON-RPC frames, so most slices are red→green with
crafted request/response lines (zero network, zero deps). `mcp-install` slices are file-writer
red→green; the final wiring/docs slice is a suite-green-gated additive change.

1. **Server scaffold + `initialize` handshake.** A stdio reader/writer loop (newline-delimited
   JSON-RPC); respond to `initialize` with a negotiated `protocolVersion` (echo the client's when
   supported, else the server's latest `2025-11-25`) + `serverInfo` + `capabilities.tools`.
   stderr-only logging. *Red:* an `initialize` line yields the handshake response on stdout, and a
   request for an older revision is echoed back rather than rejected. (Locks transport §1.)
2. **`tools/list`.** Return the tool descriptors (names, descriptions, JSON-schema input) for
   the §2 surface. *Red:* `tools/list` returns the 6 tool names with schemas.
3. **Read-tools, via `tools/call`.** `tics_inbox`, `tics_board`, `tics_review`, `tics_log` each
   `require` `tics-view.cjs` and return its output as the call result. *Red (one behavior per
   slice):* a `tools/call` for `tics_inbox` against a crafted bus returns the inbox content. (One
   red per tool keeps the 0010/0011 per-behavior trail legible — may be split across slices 3a–3d.)
4. **`tic_emit` + the honesty rule (§3).** `tic_emit` shells `tic.sh` for the agent-emittable
   kinds AND rejects `signal`/`block`/`commit`/`session` with a tool error before shelling.
   *Red (the load-bearing test):* `tic_emit` with `kind=handoff` appends a tic; `tic_emit` with
   `kind=signal` (and `block`/`commit`/`session`) returns `isError` and writes NOTHING. (Locks §3.)
5. **`tics_answer`.** Wrap `ticsAnswer` (require-to-read open needs + shell `tic.sh` to emit the
   answer). *Red:* answering an open handle settles it (an `answered` msg appears).
6. **Error channels (§1).** Malformed JSON, unknown method, unknown tool, bad params → a
   well-formed JSON-RPC error; an underlying read/emit failure → `isError` result. *Red:* a
   garbage line yields an error object, not a crash and not a non-RPC stdout line.
7. **`tics mcp` dispatch wiring.** Add `mcp` to `KNOWN`/dispatch in both bins; `tics mcp` boots
   the server. *Suite-green-gated additive* (dispatch, exercised by the cli tests).
8. **`tics mcp-install` — `.cursor/mcp.json` writer.** Merge-not-clobber the `mcpServers.tics`
   entry. *Red:* install adds the `tics` key; a pre-existing foreign key is preserved.
9. **`tics mcp-install` — the `.cursor/rules` nudge.** Write the `alwaysApply` rule (read
   inbox/board each turn, answer needs, emit honestly, the convention-not-a-gate ceiling).
   *Red:* install writes the rule file with the directive + the ceiling note.

(~9 slices. If the navigator trims the surface in §2, slices 3a–3d shrink accordingly.)

## Consequences

- **The tic bus becomes first-class in Cursor / Claude Desktop.** Any MCP agent can PARTICIPATE
  in the shared coordination bus — read its inbox/board/open-needs, emit honest tics, answer
  needs — without CC hooks. A Cursor session in a sibling worktree is no longer invisible to or
  blind to the CC fleet; both participate in the one shared bus (CC via hooks, Cursor via MCP),
  exactly the 0015 "git isolates, the bus observes" model.
- **Participation, NOT enforcement — stated plainly and permanently.** The phase×layer gate is a
  CC referee; it does not fire in Cursor and no MCP server changes that. MCP closes the ACCESS
  gap; the enforcement ceiling is immovable. The shipped honesty layer (0009/0011) is what makes
  unenforced participation safe: a Cursor agent's greens are `self-reported` and un-honored, and
  it cannot emit the hook-signed kinds at all.
- **The honesty rule is the safety boundary.** `tic_emit` excludes `signal`/`block`/`commit`
  (hook-emitted, unforgeable — the basis of E8/E10 attestation) and `session` (vestigial after
  the slim-down). A non-CC agent emits only kinds it cannot use to deceive the gate.
- **Zero new dependency, zero bus-contract change.** A hand-rolled stdio JSON-RPC server (no MCP
  SDK), pure Node CommonJS, Node ≥16; reuses `tics-view.cjs` (require-to-read) and `tic.sh`
  (shell-to-emit) unchanged; adds no bus field, no crypto. The kit stays zero-dep.
- **A tight, justified tool surface.** 6 tools (4 read: inbox/board/review/log; 2 write:
  emit/answer) — the minimal viable participation loop; conductor/claims/sections/gate/cycle/
  roster/witness explicitly cut. The floor is inbox + emit + the review/answer pair.
- **`tics mcp` + `tics mcp-install` are additive subcommands** in `@ttics/tics`, wired the same
  way `roster`/`review` were; `mcp-install` writes `.cursor/mcp.json` (merge-not-clobber) and an
  "Always Apply" Cursor rule nudging honest per-turn use — convention, not a gate. The installer
  prints that the server stays inert until the user enables it AND approves tool use in Cursor's
  Settings → Tools & MCP, so a freshly installed entry isn't mistaken for broken.
- Invariants upheld: zero runtime deps, pure Node CommonJS, Node ≥16; `node --test` stays green
  (the server is unit-testable over stdio); `selftest` passes; `kit/` authoritative. **Nothing
  in this ADR is built yet — Status: Proposed.**

## Out of scope (explicitly rejected or deferred)

- **The Mission Control server / brain.** Dropped (it stays dropped, per 0011/0015). This MCP
  server is a LOCAL stdio access path onto the existing local shared bus — no server-side brain,
  no ingest API, no multi-tenant.
- **A poller / daemon / push notifications.** v1 is request/response only: the agent reads when
  it calls a read-tool. No background polling, no server-initiated notifications, no liveness
  beacon from the MCP server. (A future `notifications` capability could push inbox changes — its
  own ADR.)
- **ANY enforcement of Cursor.** Structurally impossible — an MCP host runs no CC hooks, so the
  phase×layer gate cannot fire. Stated plainly as the immovable ceiling; do not imply otherwise
  in the tool surface (this is why `tics_gate`/`tics_cycle` are cut from §2).
- **HTTP / network / SSE transport.** stdio only for v1 (the transport Cursor / Claude Desktop
  launch, and the one that is trivially unit-testable with zero deps). A remote transport is a
  later ADR.
- **Wrapping the hook-emitted kinds (`signal`/`block`/`commit`) or the vestigial `session`.**
  Rejected in §3 — wrapping them is exactly the forgery vector the honesty rule closes.
- **Wrapping every reader (conductor/claims/sections/gate/cycle/roster) + the witness.** Cut in
  §2 to keep the surface tight; these are orchestrator/CC-state/enforcement reads, not a Cursor
  participant's per-turn loop. Addable later under their own slice if a need appears.
- **The MCP SDK as a dependency.** Rejected (§1/Alternatives) — `@modelcontextprotocol/sdk` 1.29.0
  carries 17 direct runtime deps (a full express/hono/ajv/jose/OAuth2.1 stack) for a server that
  needs only a stdin/stdout JSON-RPC loop; it breaks the zero-dep invariant and ~99% of it is
  unused. The stdio JSON-RPC protocol is small enough to hand-roll.
- **Cryptographic signing of tics.** Out of scope here as in 0009/0011 — the moat is provenance
  (`from === "run-suite"`) + sequence, not signatures. A Cursor agent's contributions are honest
  because of attestation, not crypto.

## Alternatives considered

- **Use `@modelcontextprotocol/sdk`.** Rejected: the latest SDK (1.29.0, `engines.node >=18`)
  declares 17 direct runtime dependencies — `express ^5`, `hono` + `@hono/node-server`,
  `ajv` + `ajv-formats`, `jose`, `zod` + `zod-to-json-schema`, `cors`, `raw-body`, `eventsource` +
  `eventsource-parser`, `pkce-challenge`, `express-rate-limit`, `cross-spawn`, `content-type`,
  `json-schema-typed` — a full client + server + HTTP + OAuth2.1 stack whose heavy 2025-11-25
  additions (OAuth2.1, Streamable HTTP, tasks, elicitation, sampling) are all optional and unused
  by a local stdio tools-only server. ~99% is dead weight, and it breaks the kit's zero-runtime-dep
  invariant. The stdio JSON-RPC 2.0 wire protocol (initialize + tools/list + tools/call,
  newline-delimited) is small enough to hand-roll in pure Node, and hand-rolling keeps the server
  unit-testable with crafted lines and no SDK harness.
- **Expose the FULL reader surface (every `TV.*`) as MCP tools.** Rejected: the navigator wants
  TIGHT, and conductor/claims/sections/gate/cycle/roster are orchestrator / CC-state /
  enforcement reads, not a Cursor participant's per-turn loop. Surfacing the release gate also
  risks implying Cursor can satisfy a gate it cannot. Ship the 6-tool participation loop; grow
  later under an ADR.
- **Let `tic_emit` accept ALL of `tic.sh`'s kinds (no enum restriction).** Rejected — this is
  the forgery vector. A non-CC agent emitting `signal`/`block`/`commit` would forge the referee's
  identity and could manufacture `hook-signed` greens / fake red-before-green evidence, breaking
  the E8/E10 attestation the whole gate rests on. The restricted enum (§3) is the safety boundary.
- **Restrict `tic.sh` itself instead of the tool.** Rejected: `tic.sh` is the hooks' own emit
  path and must keep all kinds (the run-suite hook emits `signal`, the guard emits `block`, etc.).
  The restriction belongs at the MCP tool boundary — the non-CC agent's ONLY door — not in the
  shared script.
- **Keep the `session` kind in the tool enum (per the paused-build note in 0015 §Risks).**
  Rejected for this clean ADR: the slim-down removed the session lifecycle, so `session` drives
  nothing — a tool kind with no consumer is a misleading affordance. Excluded; re-add under a
  future ADR if non-CC session attribution becomes a real need.
- **Build an in-host enforcement shim for Cursor (replicate the phase×layer gate via MCP).**
  Rejected — impossible and out of scope: MCP tools cannot intercept the host agent's file
  edits, so there is no seam to gate. Enforcement lives in Claude Code; Cursor gets honest,
  attested participation.
</content>
</invoke>
