# 0019 — The context layer ("learned crumbs"): a NEW PROJECTION over the existing bus, kept fresh by RE-EMISSION

- Status: **Accepted** (built through the red→green gate; suites green: team-tactics 148, tics 70, tdd 12.
  The shipped pieces — the `landmark` emittable kind, the `ticsLandmarks`/`ticsWhere`/`ticsHow` projection
  exposed as `tics map`/`where`/`how`, the `↻ verify` git backstop, the `contract`→`Decisions` retro-fold,
  the read-only `tics_map` MCP tool, and the opt-in `CONTEXT_MAP=1` edit-time hint — are covered by tests in
  the team-tactics and tics suites.)
- Date: 2026-06-18
- Deciders: architect (a crumb is a `landmark` tic and the index is a projection — NOT a new subsystem; the
  reuse of the `thread → newest-per-ref map` fold the `claims`/`sections` projections already prove; the
  escalation ladder transient→crumb→ADR), navigator (the freshness model — re-emission, not flagging; the
  reader is strictly newest-per-ref so the search always returns the latest crumb and the git check is a SOFT
  backstop that nudges re-emission, never suppresses), product-owner (the two discovery paths — a portable
  PULL surface and a CC-only PUSH hint — and the honest framing that crumbs are self-reported/unrefereed).
- Relates to: a direct application of the **claims/sections projection** model — **0004** (claims as a
  newest-per-ref fold) and **0015** (sections on the spool bus; "git isolates, the bus observes") — to a new
  ref keyspace; `landmarkMap` (`tics-view.cjs` L650) is a clone of the `sections` fold. Rides the
  **0014 (tics MCP server)** surface for the portable pull (`tics_map` is an additive read-only tool, the
  `landmark` kind joins `EMITTABLE_KINDS`) and the shared spool bus it reads. Inherits **0018 (Cursor parity,
  three tiers)** — pull is portable (a method/bus read), push is CC-only (a PreToolUse seam Cursor lacks).
  Builds on **0009 (the honest gate)** — a crumb is `self-reported`, never hook-signed; it is the cheap
  unrefereed tier that FEEDS the durable `contract`/ADR tier. **Supersedes nothing.**

## Context

### The leak: what one agent learns dies in the chat thread

Agents re-explore the same code every session. What an agent learns on the way to a change — **what's
where** ("the green-bar signer is the run-suite hook"), **how to do a thing** ("to add a tic kind, touch
`tic.sh` *and* `EMITTABLE_KINDS`"), **what to watch out for** ("`SECURITY_REVIEW` must stay env-only or it
disarms the guard") — is real, hard-won knowledge. And it dies in the chat thread the moment the session
ends. The next agent (or the next session of the same agent) starts cold and re-derives it. The bus already
carries transient coordination (handoffs, needs, stucks), but those are *addressed messages* that scroll
past; nothing on the bus is a **standing, recallable note keyed to a place in the code**.

### The key observation: the bus is ALREADY a ref-keyed store, so this is a PROJECTION, not a subsystem

The temptation is to build a "knowledge base" — a new store, a new file format, a new query language. That
is the wrong shape, and the bus already proves it. team-tactics has **two shipped projections** that fold the
append-only thread into a `ref → newest-tic` map:

- **`tics claims`** (0004): folds `claim`/`release` tics newest-per-`ref`, so the live owner of a scope is
  the most recent claim on that ref.
- **`tics sections`** (0015): folds `section` tics newest-per-`ref` into the partition map.

Both are the same move: walk the thread, key by `ref`, last-write-wins, a `release`/close tombstones the ref.
A context layer is **exactly that move on a new ref keyspace** — the path or area an agent learned something
about. It needs **no new store** (the spool bus is the store), **no new keyspace mechanics** (ref-keying is
the mechanics), **no new reader infrastructure** (a fold is ~30 lines, a clone of the sections fold). The
context layer is a **NEW PROJECTION over the existing bus**, and stating that up front is load-bearing: every
decision below is "which existing primitive does this reuse," not "what new machinery does this add."

## Decision

Add a **context layer** — learned crumbs — as a new projection over the shared tic bus. A crumb is a new
emittable tic kind; the index is a newest-per-ref fold; freshness is maintained by **re-emission**, not
flagging; cold-start is solved by retro-folding ADRs; discovery has a portable PULL surface and a CC-only
PUSH hint; and the whole thing sits one rung below ADRs on an escalation ladder.

### 1. A crumb is a `landmark` tic (a new emittable kind)

`landmark` joins the valid kinds in `tic.sh` (L16) and `EMITTABLE_KINDS` in `tics-mcp.cjs` (L73). A crumb
reuses the existing tic fields exactly — no new bus field:

- **`ref`** = the path or area key the crumb is about — the **same keyspace** `claim`/`section` use.
- **`result`** = the crumb TYPE: a bare `landmark` ("X lives in Y"), `route` ("to do Z, touch A, B, C"), or
  `caveat` ("watch out for W"). `result=retract` **tombstones** the ref (the same release/close move 0004's
  claims and 0015's sections already use).
- **`msg`** = the recall sentence — what the next agent reads.
- **`from`** = the role that left it. This is **SELF-REPORTED**, never hook-signed — a crumb is an
  agent's unrefereed observation, classified by content exactly as 0009/0018 classify any role's `from`. A
  crumb is NOT one of the four reserved hook identities (0018 §4); it is an honest, attributable note.

One emit line leaves a crumb:
`tic.sh <role> '*' landmark '<recall sentence>' <path-or-area> <landmark|route|caveat>`.

### 2. The index is a projection — `tics map` / `tics where` / `tics how` (+ a read-only `tics_map` MCP tool)

`landmarkMap` (`tics-view.cjs` L650) folds crumbs **newest-per-ref** — a clone of the sections fold: walk the
thread, key by `ref`, last-write-wins, `result=retract` deletes the ref (L654–656). Three reader surfaces
consume it (wired into both bins' command list, `cli.js` L67/L98–100):

- **`tics map`** (`ticsLandmarks`, L684) — the whole index, grouped **Landmarks / Routes / Caveats /
  Decisions** (L690–712).
- **`tics where <path>`** (`ticsWhere`, L660) — crumbs whose `ref` overlaps a path (substring either
  direction, L665), so editing `tics-view.cjs` surfaces crumbs keyed to it.
- **`tics how <task>`** (`ticsHow`, L672) — `route` crumbs whose `ref`+`msg` match a term (L678), the
  "how do I do X" recipe lookup.

A read-only **`tics_map` MCP tool** (`tics-mcp.cjs` L128) makes the PULL portable to Cursor: optional `path`
→ `where`, optional `task` → `how`, neither → the whole map. It is a read; it adds no write capability and no
new forgeable kind (the emit side rides the existing `tic_emit` allow-list, which `landmark` is now a member
of).

### 3. Freshness by RE-EMISSION, not flagging — the navigator's model (prominent, load-bearing)

This is the heart of the design and it must not be misread as "stale-crumb detection." **There are no stale
crumbs winning in the reader.** The fold is strictly **newest-per-ref**, so a `tics where`/`map`/`how`
**always returns the latest crumb for a ref**; the moment someone re-emits, the old crumb is **superseded**
— it stays on the append-only bus for history but is **never surfaced**. The reader cannot show bad data that
a fresh crumb has replaced, because last-write-wins is the whole fold.

So freshness is not a flag on the data; it is a **discipline on the agents**, framed as a navigator's rule:

> **When you change a thing you have a crumb about, leave a fresh crumb.**

Re-emission *is* the freshness mechanism. A new crumb on the same ref supersedes the old one — that is the
only thing that keeps the map true.

The **git-commit-time check is a SOFT BACKSTOP that SERVES this model, never competes with it.** `verifyMark`
(`tics-view.cjs` L639) runs one `git log -1 --format=%cI -- <ref>` per path-keyed crumb at render time; if
the path was committed **after** the crumb's timestamp and nobody re-emitted (L646), it appends a
`↻ verify (code changed since)` nudge to that line. The nudge's entire job is to **prompt the re-emission**
the discipline asks for — "the code under this crumb moved, go check and leave a fresh crumb." It is critical
what it does **not** do: it **never suppresses, hides, downgrades, or invalidates the crumb** — the crumb is
still shown, in full, as the newest-per-ref answer. Only path-like refs are git-checkable; `area:`/`topic`
keys and bare tokens skip the check (L642) and fail safe (an untracked path / non-repo → no nudge, L647). The
backstop points at the re-emission model; it is not a second, competing notion of "stale."

### 4. Cold-start solved — `contract` tics (ADRs) retro-fold as a `Decisions` group

A map that is empty until someone hand-leaves a crumb is a map nobody opens. So `landmarkMap` folds
`contract` tics **alongside** `landmark` tics (L654), and `ticsLandmarks` groups them as **Decisions**
(L692, L709–711) — every ADR already on the bus as a `contract` tic becomes a context-map entry for free.
The map is **non-empty before any hand crumb exists**: an agent's first `tics map` shows the architectural
decisions of record, and hand crumbs accrete on top. The durable tier seeds the cheap tier.

### 5. Two discovery paths — PULL (portable) and PUSH (CC-only)

- **PULL** — `tics map` / `tics where` / `tics how` and the `tics_map` MCP tool. The agent asks. This is
  **portable to Cursor** (0018 tier-1/2): it is a bus read, available wherever the reader or the MCP server
  runs.
- **PUSH** — an opt-in **`CONTEXT_MAP=1`** edit-time hint. The PreToolUse guard's `landmark_hint`
  (`guard-edit-scope.sh` L47, called L153) runs `tics where <path>` on the edited path and surfaces its
  crumbs as a `NOTE (context map)` on stderr (L52). It is **ADVISORY — it never blocks** (returns 0
  unconditionally, L48/L52) and is a **no-op unless `CONTEXT_MAP=1`** (L48). It is **CC-only**: it lives in
  the PreToolUse seam, which Cursor does not have (the 0014/0018 ceiling — no MCP/`.cursor/` hook intercepts
  a tool call). This is the same portable-pull / CC-only-push split 0018 records as tier structure: the
  knowledge is portable, the edit-time *interception* is not.

### 6. The escalation ladder — transient tic → crumb → ADR

The context layer slots a missing rung into an existing ladder of durability:

- **A transient tic** (`handoff`, `stuck`, `need`) — addressed, in-the-moment coordination that **dies in the
  thread**. Right for "I'm handing you this slice now."
- **A `landmark` crumb** — **indexed** (newest-per-ref), **freshness-tracked** (re-emission + the `↻ verify`
  nudge), **self-reported / unrefereed**. The cheap, standing, recallable tier. Right for "here's what this
  place is / how to work it / what bites."
- **An ADR** — a `contract` tic, **durable and architect-promoted**, the decision of record. Right for "this
  is a seam decision with context and consequences."

A crumb is the **cheap unrefereed tier that FEEDS the durable tier**: a caveat that recurs, a route that
hardens into a contract, becomes ADR material. **Promotion is a judgment act, never automatic** — the
architect lifts a crumb to an ADR; nothing on the bus does it mechanically (and the `contract`→Decisions
retro-fold means a promoted crumb's ADR lands right back in the same map).

## Consequences

- **Re-derivation across sessions is replaced by recall.** An agent opens `tics map` (or gets a
  `CONTEXT_MAP=1` push when it edits a known path) and reads what earlier agents learned, keyed to the place
  it is working — instead of re-exploring. The bus's transient coordination now has a standing-knowledge
  companion on the same store.

- **Crumbs are self-reported and UNREFEREED — trust them accordingly.** This is the honest cost. A crumb is
  one agent's observation, `from`-attributed but not hook-signed (0009); **a wrong crumb misleads**. The
  defenses are exactly two and they are stated plainly: (1) the **re-emission discipline** — change the thing,
  leave a fresh crumb — and (2) the **`↻ verify` nudge** that prompts that re-emission when the code moved.
  Neither is enforcement; a crumb is the cheap unrefereed rung by design, and a reader should weigh it as an
  agent's note, not as a refereed fact. The path to durable, scrutinized knowledge is promotion to an ADR.

- **Bloat is capped by ref-keying.** Because the reader is newest-per-ref, there is **one live crumb per
  ref** no matter how many times it is re-emitted; superseded crumbs stay on the append-only bus for history
  but never crowd the map. The context layer does not grow without bound with churn — it grows with the
  number of distinct places worth a note.

- **The git check's cost is bounded and opt-out-able.** `verifyMark` is **one `git log` per path-keyed crumb
  at render time** — fine for a human-invoked `tics map`/`where`, never on a hot path. It only runs for
  path-like refs; an agent that keys crumbs to `area:`/`topic` keys **implicitly opts out** of the git check
  (those refs skip it, L642). The backstop is cheap where it fires and absent where it shouldn't.

- **Portable PULL, CC-only PUSH — consistent with 0018's three-tier model.** The knowledge is portable: a
  Cursor agent reads the map over the `tics_map` MCP tool, the same way it participates in the bus at all
  (0014). The edit-time PUSH hint is CC-only because it lives in the PreToolUse seam Cursor lacks — exactly
  the tier-3 boundary 0018 documents honestly rather than faking. Cursor gets the recall; it does not get the
  edit-time interception.

- **Cost, accepted.** One new emittable kind (`landmark`) on `tic.sh` + `EMITTABLE_KINDS`; one new projection
  (`landmarkMap`) and three reader surfaces (`ticsLandmarks`/`ticsWhere`/`ticsHow`) cloned from the sections
  fold; the `↻ verify` git backstop (`verifyMark`); the `contract` retro-fold (one extra kind in the same
  fold); one read-only MCP tool (`tics_map`); one opt-in guard hint (`landmark_hint`, `CONTEXT_MAP=1`). No new
  bus field, no new store, no crypto, no change to the phase×layer gate, run-suite, or the honest-gate/
  attestation surfaces — the context layer is a projection over what was already there.

## Out of scope (explicitly rejected or deferred)

- **A "stale crumb" flag / TTL / auto-expiry on the data.** Rejected — there are no stale crumbs in the
  reader (it is strictly newest-per-ref), so flagging the data is the wrong model. Freshness is a discipline
  (re-emission) the `↻ verify` nudge *prompts*; the framework does not expire or suppress a crumb on a timer.

- **The git check suppressing / hiding / downgrading a crumb.** Rejected — `verifyMark` only ever *appends a
  nudge*; the crumb is always shown as the newest-per-ref answer. A backstop that hides data would compete
  with the re-emission model instead of serving it.

- **Automatic promotion of a crumb to an ADR.** Rejected — promotion is a judgment act the architect makes
  (a recurring caveat, a hardened route becomes contract material). Nothing on the bus lifts a crumb to a
  `contract` mechanically; the ladder's top rung is deliberately human-owned.

- **Making a crumb hook-signed / refereed.** Rejected — a crumb is the cheap, unrefereed tier by design
  (0009). Inventing attestation for an agent's observation would defeat the point (cheap to leave) and the
  identity boundary (0018's reserved hook `from` is for the referee, not for notes). Durable scrutiny is what
  the ADR rung is for.

- **An edit-time PUSH hint in Cursor.** Rejected as structurally impossible — there is no PreToolUse seam in
  Cursor to intercept the edit (0014/0018 ceiling). Cursor gets the portable PULL (`tics_map`); the CC-only
  push is documented as such, not faked.

- **A new store / file format / query language for crumbs.** Rejected — the whole thesis is that the bus is
  already a ref-keyed store and the context layer is a projection over it. A separate knowledge base would
  duplicate the keyspace, the fold, and the worktree-sharing the spool bus already provides (0015).

## Alternatives considered

- **(a) Build a standalone knowledge base (new store + format + query).** Rejected — the bus is already a
  ref-keyed append-only store, and `claims`/`sections` already prove the newest-per-ref fold. A second store
  re-implements all of that and splits coordination from knowledge across two substrates. The context layer
  is a ~30-line projection, not a subsystem.

- **(b) Flag crumbs "stale" when the code changes (data-side freshness).** Rejected — it misframes the model.
  The reader already returns only the latest crumb; the old one is superseded, not "stale data winning." The
  right lever is to prompt the human/agent to *re-emit* (the `↻ verify` nudge), keeping freshness a discipline
  the search result already enforces by being newest-per-ref.

- **(c) Let the git check suppress a crumb whose path moved after it.** Rejected — that would let a stale
  *path-mtime* heuristic hide a crumb that is still correct (a comment-only commit, a rename, an unrelated
  hunk). The check is a coarse signal; it nudges, it never decides. Suppression would make the backstop
  compete with the newest-per-ref reader instead of serving the re-emission discipline.

- **(d) Start the map empty (no `contract` retro-fold).** Rejected as the cold-start trap — an empty map is a
  map nobody opens, and the discipline never bootstraps. Folding ADRs in as Decisions makes the map useful on
  day one, before any hand crumb exists, so agents form the open-the-map habit immediately.

- **(e) Auto-promote a frequently-re-emitted crumb to an ADR.** Rejected — promotion is judgment, not a
  counter. Re-emission frequency tracks churn, not architectural significance; a noisy caveat is not an ADR.
  The architect promotes; the bus does not.

- **(f) Ship the PUSH hint on by default.** Rejected on the 0017/0018 opt-in lesson — an unsolicited
  `NOTE (context map)` on every edit is noise on installs that don't want it. `CONTEXT_MAP=1` makes it a
  deliberate per-project choice; the PULL surface is always available and asked-for, never imposed.
