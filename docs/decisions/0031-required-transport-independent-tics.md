# 0031 — Tics are required evidence and independent of transport

- **Status:** **Proposed.** No code in this ADR. The navigator approved starting it and owns the final decision;
  §10 lists what only the navigator can settle.
- **Date:** 2026-10-31
- **Deciders:** navigator (owner; the principles below), architect (the event contract, the transport seam, the gate
  reconciliation).
- **Relates to:**
  - **0014 (MCP server)**: the emission action this ADR promotes from a Cursor access path to the path for every role.
  - **0020 (discipline is a directive)** and **0017 (judgment gates mechanical)**: the line §6 must stay behind.
  - **0024 (enforcement is host-dependent; the QA seam is the verdict tic)**: E-1's "explicit, never inferred" becomes
    a gate rule; identity capture is host-dependent (§5).
  - **0026 (git transport)**: becomes one driver behind §3's seam. **Amends** its §3 "no new bus field" going forward,
    its identity rule, and the push-inside-emit step for MCP emits.
  - **0029 (tic integrity, PR geda0/team-tactics#3, open)**: prerequisite; §8 lists the contact points.
  - **0030 (fleet lane strategy, unmerged)**: `tics gate --sha` is extended here, not duplicated.
- **Supersedes:** nothing. No shipped ADR is edited.

## Context

**The navigator's principles.** Tics keep a trace and enable communication. A tic need not be a push or a file change;
that is only the current design.

**Field evidence (adopter runs, as reported to the architect; the buses themselves were not re-read for this ADR).**

| # | Observation |
|---|---|
| F1 | 178 anonymous hook-written `subagent ->` handoffs |
| F2 | most roles had no verdict on the current commit |
| F3 | verdicts lacked a commit or a result |
| F4 | `tics gate` ignored scope |
| F5 | sign-offs went stale silently |
| F6 | auto mode denied `tic.sh` as an external write for a read-only auditor |
| F7 | a role with no Bash used MCP, so emission paths differ by role |
| F8 | a tic put protected test code on an append-only bus |
| F9 | tics landed under the wrong scope when emitted from another folder |

**What the code does today (`origin/main` at 25067f9 unless noted).**

- `subagent-handoff.sh` never reads hook stdin; it emits `from=subagent` with an empty `ref`. That is F1. Whether each
  host's `SubagentStop` payload names the agent is **unknown** here; the kit has never read it.
- `ticsGate` takes the latest verdict per `from`, ignoring commit and scope (F2, F4, F5), and `verdictOutcome` falls
  back to matching words in `msg`, which contradicts 0024 E-1 (F3).
- `tics gate --sha` (branch `adr-0030-fleet-lane-strategy`) binds evidence to `ref` equal to the sha, for roles named
  in `STAGES`, but it has no scope filter, and with `STAGES` empty it exits 2.
- `emit_tic` selects the store inline, and under `TIC_STORE=git` an agent's emit runs `_tic_git_publish` in the
  caller's process. `tic.sh` needs shell permission and write access to `.claude/state`, and in git mode network access
  (consistent with F6; the exact auto-mode rule that fired is **unknown**).
- Kit frontmatter: `tdd-critic`, `test-writer`, `planner` have `mcp__tics__tic_emit` and no Bash. `implementer`,
  `qa-verifier`, `product-owner`, `architect`, `project-manager`, `dev-ops` have Bash and no MCP tool. That is F7.
- `tic_emit` has `session` but **no `scope` parameter**. The MCP target is `TICS_TARGET` or the server's cwd; `tic.sh`
  takes `ROOT` from its own location. Scope is whatever that root's state file says, falling back to the layer (F9).
- `_tic_esc` strips newlines and escapes quotes. There is **no size or content check** on `msg` (F8).

## Decision

### 1. Three separated things

A **tic** is an event that was accepted by the emission action. Being durable, published and visible to another host
are transport properties, not part of what a tic is. So:

- the **event contract** (§2) is what every role, reader and gate depends on;
- the **transport** (§3) only moves events;
- **evidence** (§6) is a rule over events, independent of how they travelled.

### 2. The event contract (v1)

Additive to today's record. Existing fields keep their meaning.

| field | set by | meaning |
|---|---|---|
| `v` | emitter | `1`. Absent means a legacy tic |
| `id` | emitter | globally unique, generated once at acceptance, stable across retries; **the identity** |
| `ts`, `kind`, `from`, `to`, `msg`, `ref`, `result`, `session`, `phase`, `layer` | as today | `seq` stays advisory |
| `scope` | explicit, or ambient as today | see `scope_src` |
| `scope_src` | emitter | `explicit` or `ambient` |
| `commit` | caller | full sha of the thing judged. **Never filled from ambient HEAD**: F9 shows ambient context is the wrong context, and a reviewer must state what it reviewed |
| `project` | emitter | `TICS_PROJECT` from `tdd.config`; empty if unset |
| `prov` | emitter | `hook`, `captured` or `self` (§5) |
| `actor` | hook only | host-captured agent identity, when the host supplies one |

Identity is `id`, else the 0026 rule for legacy tics. Readers dedupe on it, which makes delivery safely at-least-once.

A **required-evidence verdict** is `kind=verdict` with an explicit `scope`, a `commit`, and a `result` from
`pass|accept|concerns|block` (0022 draft results stay valid verdicts but never count as sign-off). An emit lacking any
of these is **still recorded** (0026 never-drop), the action returns a warning, and the gate lists it as `invalid`, not
as evidence. Rejecting it would turn F3 into a lost verdict.

### 3. The transport seam

```
put(event) -> ok | deferred      // may not block the caller beyond the bound
list(sinceCursor?) -> events     // read-only, may be stale
flush() -> {sent, pending}       // idempotent
status() -> {asOf, pending, lastError}
```

`jsonl`, `spool` and `git` become drivers; `TIC_STORE` keeps its name and values. A new driver (HTTP, a host's message
API) must pass one shared conformance suite and needs no change to reader, gate or emission. **No new driver ships
here**: the seam is the decision, and a second remote driver waits for a real need.

**Local queue.** An accepted event is written once to `.claude/state/tics.outbox/<id>.json` by exclusive create, then
`put`. It is removed only after the driver acknowledges. Readers union the outbox with `list`, deduped by `id`, so a
role sees its own tics offline. `pending` appears next to "bus as of" on `log` and `board`, and `tics sync` becomes
`flush`.

Why this does not repeat 0026's rejected detached push: the flusher is the MCP server, a process the host already owns
for the session's lifetime, and it uses the existing checkout lock. Nothing outlives the session; leftovers wait for
the next flush. `jsonl` and `spool` keep their synchronous local write, with no outbox directory needed in practice.

### 4. One emission action

**`tic_emit` is the one action for every agent role, in every host with MCP.** Add `tic_emit`, `tics_inbox` to the
frontmatter of all kit roles. It gains `scope` and `commit` parameters. The `mcp__tics__*` name is safe under 0024
§3.2: `tics` is the kit's own server key, not an adopter's.

Why MCP and not `tic.sh`: the server process does the write, so the agent needs no shell and no write permission of its
own, and read-only roles stay read-only in their own tools. Whether a given host's auto mode allows the tool is
**unknown** until probed (P10), so the kit does not claim it.

`tic.sh` stays as the same contract's thin client: hooks, git hooks and hosts without MCP. Its six positionals stay
(0029 I1); `scope` and `commit` pass as `TICS_SCOPE` and `TICS_COMMIT`.

**The zero-tool fallback.** If no action is available, a role ends its final message with one line:
`TIC {"kind":"verdict","scope":...,"commit":...,"result":...,"msg":...}`. The `SubagentStop` hook, where the host
supplies the text, parses it and records it with `prov=captured`. That is a tic with no agent push or agent file
change. Its availability is host-dependent and must be probed (P11).

### 5. Identity: what the harness captures, what the agent adds

| Tier | Example | Who vouches | Host dependence |
|---|---|---|---|
| `hook` | `signal`, `block`, handoff with `actor` | the hook | Fires where the host runs hooks (0024). Local forgery by a shell-writing agent remains (0029) |
| `captured` | final-message verdict | the hook recorded it, the agent wrote it | Needs final text in the hook payload |
| `self` | `tic_emit`, `tic.sh` | the agent's own claim | Works everywhere |

The harness captures **that a role ran and returned**. Only the agent can add **what it concluded**. So:

- `subagent-handoff.sh` reads stdin and adds `actor` when the host supplies one, plus `ref` to the open brief when it can
  be matched (0030's dogfood follow-up). `from` stays `subagent`, because solo-drift counts it and 0026/0027 reserve it.
  With no `actor` the tic is unchanged, never guessed.
- A verdict's `from` stays self-asserted. 0024 E-3 still forbids identity laundering by directive.
- `prov` is written by the emitter, so **on a shared bus it is a claim, not attestation**. Hook identities stay local
  (0026 P7) and the git-bus read refuses them (0029 rule 3). The gate therefore never needs a hook tic to count a
  verdict, and it prints a per-`prov` count rather than ranking by it.

### 6. Validity and the gate

**Rule.** A role's sign-off is valid for commit C and scope S iff its latest verdict matching C and S, by event order,
has `commit == C`, explicit `scope` equal to S or an ancestor of S (`ranking` covers `ranking/S2`; `*` covers
nothing), a matching `project` when configured, and result `pass` or `accept`. Prose is never read.

**Enforcement extends `tics gate --sha`:**

- `tics gate --sha <C> --scope <S>`. `REQUIRED_ROLES` in `tdd.config` defaults to `product-owner tdd-critic`, today's
  pair. `qa-verifier` remains conditional unless an adopter declares it.
- Exit 0 clear, 1 blocked, 2 usage. `--sha` with an empty `STAGES` now means "required roles only", and exits 2 only
  if both are empty. This changes 0030's F1 exit code for that case; 0030 is unmerged, so apply it there.
- Each blocked role reads `missing`, `stale (passed at <sha>, <n> commits behind)`, `wrong-scope`, `invalid` or the
  non-passing result. Staleness stops being silent because the gate names it (F5).
- Bare `tics gate` keeps today's behavior until `VERDICT_ENFORCE=1`. Before that it prints the same findings as
  warnings. With it set, bare `gate` needs `--sha` and `--scope`, else exit 2.

**Reconciling with 0020, 0017 and 0024.**

- 0020 rejected a hook because it mechanized a *judgment lapse*, ran in one host, and fired after the harm. Here the
  check is a *presence predicate over recorded events*, in a CLI that any host, git hook or CI can run, before release.
  **No new hook forces an agent to emit, and no Stop rung is added.** Emitting stays a directive in `AGENTS.md`; the
  gate only refuses to treat absence as approval.
- 0017's line holds: which roles are required is a human declaration. The gate never decides what a verdict means or
  whether a bullet is experience-level. 0024 E-4 remains unmechanized.
- 0024 §4 said `ticsGate` "stays exactly as it is" in the context of the QA requirement. This ADR leaves QA conditional,
  but it does change the gate, so that sentence is **narrowed** by the opt-in path above. The navigator should accept
  that explicitly.
- Dropping prose inference enforces 0024 E-1 where it was already normative.

### 7. Payload guard

Runs in the emission action, **before the outbox**, because nothing can be recalled from an append-only bus.

1. `msg` over `TICS_MSG_MAX` (provisional 500 bytes) or `ref` over 200 bytes: refused, with a pointer to the artifact
   path instead. Not truncated.
2. `TICS_SENSITIVE_GLOBS` declares protected paths (hidden tests, briefs). A `msg` containing any line of 20 or more
   characters from those files is refused.
3. `TICS_PAYLOAD_DENY` is an optional adopter regex list.

Refusal returns an error and records nothing except a local `note` naming the rule, not the content. This is the one
deliberate exception to never-drop: an event refused on content was never accepted. Tics carry pointers, not artifacts.

### 8. Migration and compatibility

**Order.** 0029 lands first, then 0030, then these slices. Merging 0028 is independent, though its `assign` kind should
be counted by the same contract.

**ADR 0029 contact points.**

- The new top-level names join rule 2's fixed-field list, so `EXTRA` can never supply `commit`, `prov`, `actor` or `id`.
  The hook emits these through named parameters.
- `actor` and `project` use rule 1b's identity grammar; `scope` needs its own allowlist (it holds `/`, `:`, `*`).
- `TICS_COMMIT` must match `^[0-9a-f]{40,64}$`; otherwise the tic is recorded without `commit` and flagged invalid.
- The hook-identity bus filter and duplicate-key refusal apply unchanged. The MCP server keeps the same checks by
  shelling through the one validator.

**Compatibility.** Old readers ignore unknown fields, so a mixed fleet reads v1 tics. Old writers produce legacy tics,
which are displayed normally and are never evidence under `VERDICT_ENFORCE=1`. A 0030 `gate:<stage>` verdict with the
sha in `ref` keeps counting for stage evidence only.

**Migration.** Three releases: (1) the fields and warnings, default off; (2) adopters fix what warnings show, then set
`VERDICT_ENFORCE=1`; (3) a separate decision on flipping the default. In-flight releases re-issue sign-offs at the
current commit. No bus rewrite. `AGENTS.md` line 27's flat "other agents don't run these hooks" already conflicts with
0024 and is filed as drift `D-0031-agents-tool-support`.

### 9. Rejected alternatives

- **A Stop hook that blocks until the verdict exists.** Rejected under 0020; it would also fail silently where Stop does
  not fire, and Stop leaves no bus evidence (0024 W9).
- **Ambient HEAD for `commit`.** Rejected; it makes F9 a false sign-off.
- **Signing or MAC now.** Rejected here; 0029 records it as a follow-up, and it does not fix F1 to F9.
- **Rejecting a malformed verdict at emit.** Rejected; see §2.
- **A separate gate verb.** Rejected; `tics gate` has enough modes already.

## Assertable predicates

- **P1 (contract):** every kit-emitted tic has `v=1` and a unique `id`; legacy lines still load.
- **P2 (conformance):** one suite passes on `jsonl`, `spool`, `git` and an in-memory test driver, with no reader change.
- **P3 (offline):** with a dead remote, `tic_emit` returns ok within `TICS_NET_TIMEOUT`; the local reader shows the tic;
  `pending` is 1; after recovery `flush` publishes once, and a re-run publishes nothing.
- **P4 (at-least-once):** a crash between `put` and outbox removal yields one displayed tic after retry.
- **P5 (validity):** with passing verdicts at C1, `gate --sha C2 --scope S` exits 1 reading `stale`; a pass at C2 exits 0;
  a later `block` at C2 exits 1.
- **P6 (scope):** a pass in scope A does not clear B; an ancestor clears its child; `*` clears nothing; ambient scope
  does not count.
- **P7 (explicit result):** a verdict with `msg="pass"` and empty `result` is `invalid`, not evidence, and is recorded.
- **P8 (no ambient commit):** emitting without `commit` never stores HEAD.
- **P9 (one action):** every kit role's frontmatter lists `mcp__tics__tic_emit`; `tic_emit` with `scope` and `commit`
  stores them.
- **P10 (host probe):** a recorded manual check per host: a no-Bash read-only role in auto mode emits and the tic lands,
  or the docs state it does not. Never asserted from reasoning alone.
- **P11 (capture):** given a hook payload holding final text with a `TIC` line, one `prov=captured` tic is recorded; with
  no text, malformed JSON or a hook identity in `from`, none is, and the handoff still lands.
- **P12 (actor):** a payload naming the agent yields `actor`; a payload without it leaves the tic as today.
- **P13 (payload):** an oversized `msg`, or one quoting a sensitive file's line, exits non-zero, adds nothing to the
  outbox or any store, and leaves a content-free `note`.
- **P14 (default-safe):** with no new config, bare `tics gate` exit codes match today's on the existing fixtures.
- **P15 (0029 holds):** `EXTRA` carrying `commit`, `id`, `prov` or `actor` is dropped; I1 to I7 stay green.
- **P16 (directive only):** `settings.json` gains no hook entry for this ADR.

## Slices (red→green, one behavior each)

| Slice | Delivers | Predicates |
|---|---|---|
| 0 | Prerequisite: 0029 and 0030 merged | none |
| 1 | `id`, `v`; dedupe by `id` | P1, P15 |
| 2 | `scope`, `commit` on `tic_emit`; `TICS_COMMIT`; `scope_src` | P8, P9 (second half) |
| 3 | Validity fold, read-only, with reason strings | P5, P6, P7 |
| 4 | `gate --sha --scope`, `REQUIRED_ROLES`, warnings, `VERDICT_ENFORCE` | P14, P16 |
| 5 | Transport seam around today's stores; conformance suite | P2 |
| 6 | Outbox, `flush`, `pending` line | P3, P4 |
| 7 | Payload guard | P13 |
| 8 | Frontmatter and docs for one action, then host probe | P9, P10 |
| 9 | Handoff reads stdin, `actor` | P12 |
| 10 | `TIC` capture | P11 |

Slices 1 to 4 fix F2 to F5 and F9 alone, so the ADR can be cut there if the transport work does not earn its cost.

## Consequences and honest limits

- **Good:** "signed off" gains one checkable meaning, a stale or misfiled sign-off is named, and read-only roles need no
  write path of their own.
- **Cost:** new fields, a queue with its own failure modes, and re-verdicts on every commit change, which may be loud
  with a code-only exact match.
- **Not proof of work.** A role can emit `pass` at C without reading C. Gates prove a claim exists, not that it is true.
- **Identity is still mostly self-asserted**, and any agent with shell write can forge local lines (0029).
- **The gate binds only if it runs.** It is unhooked by design here; nothing stops a release that skips it, short of the
  adopter's `RELEASE_GATE_ENFORCE` or CI.
- **The payload guard is not a boundary.** Paraphrase or short fragments pass, and a lower-version host skips it. 500
  bytes can still hold an assertion. The default cap has not been measured against real buses.
- **F8's tic stays on that bus.** This ADR prevents new leaks and does not redact old ones.
- **Unknown:** host payload contents (P10 to P12), the auto-mode rule behind F6, and whether MCP is approved in a given
  session. `.mcp.json` entries need user approval in Claude Code, so one unapproved server removes the primary path.

## 10. Open questions for the navigator

- **Q1 (bigger cut):** ship slices 1 to 4 first and treat transport as a second ADR? The architect's recommendation is
  yes for sequencing, keeping the §3 contract here.
- **Q2 (carry-over):** must a docs-only commit void sign-offs? This ADR says yes, exact sha. The alternative is carrying
  a verdict across commits that touch nothing in `SRC_GLOB`, which is quieter but adds a rule to reason about.
- **Q3 (default):** should `VERDICT_ENFORCE=1` ever become the default? It is the 0005 posture, but it is also a breaking
  change.
- **Q4 (0024 wording):** do you accept narrowing "`ticsGate` stays exactly as it is"?
- **Q5 (redaction):** what happens to a leak already on a bus? Rewriting the bus branch breaks the append-only argument;
  leaving it keeps the leak. That is a policy call.
- **Q6 (capture fallback):** is the final-message `TIC` line welcome, or does it put too much protocol in prose?
