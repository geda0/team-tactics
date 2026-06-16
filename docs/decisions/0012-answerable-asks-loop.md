# 0012 — The answerable-asks loop (close the loop on a `need`: a directed answer tic settles an open ask, surfaced by a pure local fold)

- Status: **Accepted** (a design panel LOCKED this contract; we build it this session)
- Date: 2026-06-16
- Deciders: navigator (the gap finding — a `need` tic dies unread in the inbox with no way to
  list-then-answer it; Mission Control's reviewBus / answer-the-ask loop as the inspiration,
  brought home as a pure local fold, NOT a server / review API), product-owner (selected E11;
  v1 defaults — `from=navigator` default + `--from`; ref-less needs keep the weak `n<seq>`
  fallback; no `--to` filter, no re-ask/re-open), architect (the answer-tic shape reusing the
  `result` slot, the separate-answered-set rule, `tics answer` as the deliberate single write
  in a read-only surface, the degrade-safe floor)
- Relates to: **0009 (the honest gate)** and **0011 (evidence-gated greens)** — E11 is the
  same family: a PURE READ-SIDE FOLD over the existing `.claude/state/tics.jsonl` bus that
  makes a fact the bus already carries (here: an unanswered `need`) legible and actionable,
  with NO new bus field and NO new tic kind. Like 0005 (operate the full framework) /
  0006 (the honesty is the moat) / 0010 (capability-aware execution), it is a CONVENTION /
  QUEUE that nudges-and-records — **no hook ever blocks on an open need.** Reuses the
  `result`-as-lifecycle precedent the bus already trusts (`section`→done at
  `tics-view.cjs:159/232`, `session`→close at `:186/233`). Builds on 0008's read-side-fold
  pattern in `tics-view.cjs` and 0001's "the gate is a referee inside CC" framing.
  Supersedes nothing. The Mission Control server (E6) stays dropped — E11 keeps only the
  read/answer loop that was always local.

## Context

### The gap: a `need` dies in the inbox

The bus has a `need` tic kind — a directed ask ("I'm blocked; I need a decision/answer from
role X"). It is delivered to the asker's INBOX, but the loop is **open**: there is no way to

1. **list** the open needs (which asks are still unanswered, by whom, on what scope), nor
2. **answer** one such that the answer both REACHES the asker AND SETTLES the need so it stops
   showing as open.

So a `need` is fire-and-forget: it lands in an inbox, and if nobody happens to read that
inbox it silently dies. There is no closed-loop "ask → answer → settled" — the very thing a
blocked role's `need` exists to get.

### The Mission Control inspiration (mined; design the LOCAL form)

Mission Control closes this loop server-side with a reviewBus / answer-the-ask flow: asks are
posted, listed for the answerer, and an answer both notifies the asker and marks the ask
resolved. For team-tactics there is **no server and no new ingest API.** The same loop is a
**pure local fold over `.claude/state/tics.jsonl`** plus one thin write that shells out to the
existing emitter — because everything the loop needs already lives on the bus:

- The `need` tic already carries `from` (asker), `to` (target), `scope`, and the question
  text; it already has a `seq` and an optional correlation `ref`.
- The `msg` tic (the general directed-DM kind) already delivers text to a role's inbox.
- The `result` slot already carries LIFECYCLE for other kinds — `section`→`done`
  (`tics-view.cjs:159,232`), `session`→`close`/`closed` (`:186,233`) — a trusted,
  append-order "latest wins" settlement pattern the reader already honors.

E11 is therefore the same leapfrog as E8/E10: **the loop the bus already affords, that the
consumers just don't surface.** It is a read-side fold (`tics review`) + one thin write
(`tics answer`) that reuses the existing `msg` emitter and the existing `result` slot — no
server, no new tic kind, no new envelope field, no crypto.

## Decision

Close the loop with **a directed answer tic** (a `msg` whose `result` is the sentinel
`"answered"` and whose `ref` is the need's correlation token), a **pure read-side open-need
fold** that lists open needs (`tics review`), and a **single thin write** (`tics answer`) that
shells out the emitter to deliver-and-settle in one append. NO new tic kind, NO new envelope
field, NO server, NO crypto, NO hook gate. Degrade-safe throughout.

### 1. The answer tic — shape + WHY `result="answered"` (the load-bearing definition)

An **answer** is a directed `msg` tic that carries BOTH halves of the loop in slots the bus
already has:

- **`ref` = the need's correlation token** — ties the answer to the specific ask.
- **the existing `result` slot = the sentinel `"answered"`** — marks "this `msg` settles a
  need" (not an ordinary DM).

Emitted by the existing emitter, unchanged:

```
tic.sh <from> <asker> msg '<text>' <need-token> answered
```

That single append does BOTH things: it delivers the text to the asker's inbox (a normal
directed `msg`), AND it settles the need (the fold below counts it as the answer).

**WHY the existing `result` slot is the chosen sentinel — and the false-settle guard.**
`result` already carries lifecycle for `section`/`session` (above), so reusing it for "msg
answers a need" follows a precedent the reader already trusts — **no new envelope field**
(an old bus has no `answered` msgs, so it degrades to "everything still open"; zero
migration, exactly the old-bus discipline of 0009 §5 / 0011 §2). Critically, the settlement
fold keys on **`result === "answered"`, NOT on a bare `ref`.** This is load-bearing: `msg` is
the GENERAL directed-DM kind, and an ordinary `msg` may legitimately reuse a need's token in
its `ref` (e.g. quoting it in conversation). If openness were keyed on "a `msg` exists whose
`ref` matches the need," any such DM would **false-settle** the need — silently closing a
still-blocked ask. Keying on the deliberate `result="answered"` sentinel means **only an
intentional answer settles a need**; a casual DM that happens to share the token can NEVER
false-settle it. This is E11's headline correctness guard, symmetric in spirit to 0009/0011's
"only the referee's signal counts."

### 2. The open-need fold (`ticsReview`) — a clone of `ticsTodo`'s pairing, with a SEPARATE answered-set

The settlement fold is a deliberate **CLONE of `ticsTodo`'s delegate↔handoff pairing**
(`tics-view.cjs:204-212`), with its OWN answered-set — NOT the shared `handedOff` set.

**Pass 1 — build the answered-set:**

```
answered = { x.ref : tics where x.kind === "msg" && x.result === "answered" && x.ref }
```

**Token of a need:** `x.ref` if truthy, else the weak fallback `"n" + x.seq`.

**Open predicate:** a need is OPEN ⟺ `x.kind === "need" && !answered.has(token(x))`.

Two rules are baked into this:

- **The need's OWN `result` is IGNORED for openness.** Openness is decided SOLELY by whether
  a deliberate answer exists. A need can therefore **never self-settle / silently die** — it
  stays open until someone answers it. (Contrast `section`/`session`, which settle via their
  own `result`; a `need` deliberately does not, because the whole point is that the ASKER
  cannot close their own blocked ask — only an answer closes it.)
- **A SEPARATE answered-set — NOT the shared `handedOff` set.** `ticsTodo` uses a `handedOff`
  set (delegate ref → handoff ref) to retire delegates. E11 builds a STRUCTURALLY IDENTICAL
  but DISTINCT set keyed on answer refs, because **the `handedOff` set must stay
  delegate↔handoff only.** Sharing one set across both loops would CROSS-CLOSE them: a
  `handoff` could retire a `need` (or an `answer` could retire a `delegate`) whenever tokens
  collided — corrupting both queues. (This is exactly why the panel REJECTED the
  "reuse-handoff" angle; see Alternatives.) The two folds share a SHAPE, not a SET.

`ticsReview(targetDir)` is the new pure read fold that applies this predicate and lists the
OPEN needs: **handle, asker→target, scope, question.** Ref-less needs (whose token is the
weak `n<seq>` fallback) are grouped under **"unaddressable (no ref)"** so they are visible but
clearly flagged as fragile. Exit **0**. **Degrade-safe** (below): malformed / non-`need` /
empty input → an empty list, never a throw.

### 3. `tics answer <handle> <text>` (`ticsAnswer`) — the ONE write in a read-only surface

`tics answer` resolves `<handle>` to an OPEN need (via the §2 fold) and **shells out the
existing emitter** to append the answer:

```
cp.execFileSync('.claude/hooks/tic.sh', [<from>, <asker>, 'msg', <text>, <need-token>, 'answered'])
```

One emit, BOTH effects: it lands in the asker's inbox AND settles the need (§1). On **no
match** (the handle doesn't resolve to an open need): **exit 2, emit NOTHING** — so a stale or
wrong handle is idempotent (it cannot append a dangling answer), and re-running after the need
is already answered is a no-op.

**`tics answer` is the deliberate FIRST WRITE in the otherwise read-only tics surface.** Every
other `tics` subcommand (`log`, `inbox`, `board`, `roster`, `review`, …) is a pure reader;
`answer` is the lone exception, by design — it is the action half of the loop and there is no
honest way to "answer an ask" without a write. It keeps the read-surface convention honest by
being the SINGLE, NAMED, NARROW exception (it does not write the bus directly — it delegates
to the trusted `tic.sh` emitter, so the bus's append discipline is unchanged). It is
**degrade-safe / best-effort:** the emit is best-effort, a missing/unexecutable emitter path
is CAUGHT (no stack trace, a clear message), and the no-match path exits 2 without emitting.

### 4. Dispatch — mirror `board`/`roster` in BOTH dispatchers

`review` and `answer` are wired into BOTH dispatch paths, exactly mirroring how `board` and
`roster` are wired:

- **`packages/tics/bin/tics.js`** — add both to the `KNOWN` array (currently `tics.js:10`) AND
  the if-chain (the `board`/`roster` lines at `tics.js:27-28`).
- **`tics-view.cjs`** — add both to `main()`'s switch (beside `case "roster"` at `:614`) AND
  to `module.exports` (beside `ticsBoard`/`ticsRoster`).

No new dispatch PATTERN — E11 follows the established two-dispatcher mirror to the letter.

### 5. v1 defaults (decided by the panel — locked)

- **`from=navigator` by default, with a `--from` override.** The navigator is the default
  answerer; any role can override with `--from <role>`.
- **Ref-less needs keep the weak `n<seq>` fallback** (so they are still listable/answerable in
  the common single-worktree case) — but they are surfaced as "unaddressable (no ref)" because
  the fallback is fragile (see §6 / Out of scope).
- **No `--to` filter** in v1 (`review` lists all open needs, not "needs targeted at me").
- **No re-ask / no re-open** in v1 (an answered need stays settled; a still-blocked asker
  raises a NEW `need`).

### 6. The honest framing — a queue, NOT a hook gate

E11 is a **convention / queue that nudges-and-records — no hook EVER blocks on an open or
unanswered need.** This is deliberate and is the same posture as 0005/0006/0010: the value is
making the unanswered ask VISIBLE and ANSWERABLE, not coercing an answer. A blocked role still
proceeds (or waits) by its own judgment; `tics review` surfaces what is owed, `tics answer`
closes it. There is no PostToolUse/Stop gate that fails on an open need, and none is proposed.

**The `n<seq>` fallback is a KNOWN LIMITATION under multi-worktree merge.** A ref-less need's
token is `"n" + x.seq`, and `seq` is per-worktree-monotonic; when two worktrees' tic logs are
merged, `seq` values can collide, so an `n<seq>` token is NOT stable across a merge. A need
with a REAL `ref` (a correlation token) is robust and is the recommended path; the `n<seq>`
fallback exists only so a ref-less need is not wholly invisible, and is flagged
"unaddressable (no ref)" precisely so its fragility is honest. (Making every need carry a real
ref — or a merge-stable id — is a possible future hardening; see Out of scope.)

### 7. Degrade-safety + invariants

- **Pure read-side fold + one thin best-effort write; zero new runtime deps, pure Node
  CommonJS, Node ≥16.** One new pure fold (`ticsReview`) + one thin write command
  (`ticsAnswer`) + two dispatch entries in each of the two dispatchers. Everything else (the
  bus, `tic.sh`, the `msg` kind, the `result` slot, `loadTics`, `ticsTodo`) is reused
  unchanged.
- **`ticsReview` is total and degrade-safe:** non-`need` tics, malformed / `null` entries, an
  empty bus, an old bus with no `answered` msgs → an empty (or all-open) list; it never throws
  and never invents an answer. (An old bus has zero `answered`-sentinel msgs, so every prior
  need reads as open — the correct, no-migration degradation.)
- **`ticsAnswer` is degrade-safe:** no-match → exit 2, no emit; a missing/unexecutable emitter
  path is caught, not thrown; an idempotent re-answer is a no-op.
- **No bus contract change.** No new `tics.jsonl` field and no new tic kind: the answer is a
  `msg` (existing kind) carrying `ref` + `result="answered"` (existing slots). Old buses
  replay with zero migration — they simply have no `answered` msgs, so all their needs read
  open.
- **`kit/` is authoritative.** Edit only `packages/tics/kit/hooks/tics-view.cjs` and
  `packages/tics/bin/tics.js` (the kit reader + dispatcher are authoritative; the installed
  `.claude/hooks/tics` re-derives on the next dogfood install). The stale fossil hook copies
  under `packages/team-tactics/claim-session/.claude/hooks/` etc. are an H1 hygiene gap, NOT
  E11's job — do not edit them.

## Resolved contract risks

- **False-settle by an ordinary `msg` (the headline correctness risk).** Resolved by §1: the
  settlement fold keys on the deliberate sentinel `result === "answered"`, NOT on a bare `ref`.
  A general DM that happens to reuse a need's token can NEVER close the need — only an
  intentional answer does. (Symmetric in spirit to 0009/0011's "only the referee's signal is
  proof.")
- **Cross-close hazard between the answer loop and the delegate/handoff loop.** Resolved by §2:
  E11 uses a SEPARATE answered-set, not the shared `handedOff` set. The two folds share a
  STRUCTURE (the §2 pairing is a clone of `ticsTodo`'s) but not a SET, so a `handoff` can never
  retire a `need` and an `answer` can never retire a `delegate`, regardless of token
  collisions. (This is exactly why the "reuse-handoff" panel angle was rejected.)
- **A write in a read-only surface.** Resolved by §3: `tics answer` is the single, named,
  narrow write exception; it delegates to the trusted `tic.sh` emitter (not a direct bus
  write), is best-effort (a missing emitter path is caught), and exits 2 with no emit on
  no-match — so the read-surface convention stays honest and a stale handle is idempotent.
- **A need silently self-settling / dying.** Resolved by §2: a need's OWN `result` is ignored
  for openness; a need stays OPEN until a deliberate answer exists. The asker cannot close
  their own blocked ask.
- **Old-bus correctness with no migration.** Resolved by §1/§7: the answer reuses the existing
  `msg` kind + the existing `result` slot — no new field, no new kind. An old bus has no
  `answered` msgs, so every prior need reads as open (the correct degradation); zero migration.
- **The folds are total and degrade-safe.** Resolved by §7: `ticsReview` returns an empty/open
  list on malformed / non-`need` / empty input and never throws; `ticsAnswer` exits 2 without
  emitting on no-match and catches a missing emitter path.
- **The `n<seq>` token under multi-worktree merge.** ACKNOWLEDGED as a known limitation (§6,
  Out of scope), not silently passed: `seq` is per-worktree-monotonic and can collide on
  merge, so a ref-less need's `n<seq>` token is not merge-stable. A real `ref` is robust and
  is the recommended path; ref-less needs are flagged "unaddressable (no ref)" so the
  fragility is honest.

## Consequences

- The bus's `need` loop finally CLOSES: `tics review` lists every open ask (handle,
  asker→target, scope, question), and `tics answer <handle> <text>` delivers the answer AND
  settles the need in one append — closing the "a `need` dies unread in the inbox" gap, with a
  pure local fold + one thin write and no server.
- One pure fold (`ticsReview`) + one thin best-effort write (`ticsAnswer`) + two dispatch
  entries in each of the two dispatchers. Everything else (the bus, `tic.sh`, the `msg` kind,
  the `result` slot, `loadTics`, `ticsTodo`) is reused unchanged. The fold is a pure data
  function → fully unit-testable with crafted tics, no clock or I/O.
- **No bus contract change.** No new `tics.jsonl` field and no new tic kind: the answer is a
  `msg` carrying `ref` + `result="answered"` (existing slots). Old buses replay with zero
  migration (no `answered` msgs → all needs read open).
- **`tics answer` is the first WRITE in the tics surface** — a deliberate, narrow exception to
  the read-only-reader convention, kept honest by being single/named and by delegating to the
  trusted emitter.
- **Convention, not a gate.** No hook ever blocks on an open/unanswered need; E11 makes the
  unanswered ask visible and answerable, the same nudge-and-record family as 0005/0006/0010.
- **Default behavior unchanged for existing flows.** Nobody's bus changes shape; a bus with no
  `answered` msgs simply lists its needs as open. No existing command's exit code changes
  (except the new `answer`'s deliberate exit 2 on no-match).
- Invariants upheld: zero runtime deps, pure Node CommonJS, Node ≥16; `node --test` stays
  green; `selftest` passes; `kit/` authoritative (the fossil hook copies are H1, not E11).
  Status: Accepted — we build it this session.

## Out of scope (explicitly rejected or deferred for this ADR)

- **A Mission Control needs-decision flag targeting a SPECIFIC role** (e.g. a server-driven
  "this decision is owed by role X" surface). Server-shaped (E6 / Mission Control stays
  dropped). E11 is a pure local read/answer loop; `--to`-style targeting is out (below).
- **A `--to` filter on `review`** ("show only needs targeted at me"). Deferred to a later v;
  v1 lists all open needs. (Additive on the existing fold when wanted — note plainly: it
  needs no contract change, just a filter on `ticsReview`'s output.)
- **Re-ask / re-open** (un-settling an answered need, or threading a follow-up). Deferred; in
  v1 an answered need stays settled and a still-blocked asker raises a NEW `need`.
- **A server / ingest API / multi-tenant review bus.** Stays server-shaped (E6 dropped). E11
  is a pure local fold + one thin local write.
- **A new tic kind for "answer" or a new `answered` envelope FIELD.** Rejected, same as
  0009/0011 rejected a new field: a new kind/field is absent on every prior bus → breaks
  old-bus degrade-safety and forces a migration; the existing `msg` kind + the existing
  `result` slot already carry both halves of the loop.
- **A hook gate that blocks on an open/unanswered need.** Out of scope by design (§6) — E11 is
  a queue/convention, not a gate; the value is visibility + answerability, not coercion.
- **A merge-stable id for ref-less needs** (hardening the `n<seq>` fallback). The `n<seq>`
  fallback is a KNOWN limitation under multi-worktree merge (§6); making every need carry a
  real `ref` or a merge-stable id is a possible future hardening, not v1. A real `ref` is the
  robust path today.

## Alternatives considered (the three panel angles + why the merge)

- **Angle "new-kind" — add a dedicated `answer` tic kind (and/or an `answered` envelope
  field).** Rejected: a new kind/field is absent on every prior bus, breaking old-bus
  degrade-safety and forcing a migration — for no gain, because the existing `msg` kind + the
  existing `result` slot already carry both the delivery and the settlement. The merged design
  reuses `msg` + `result="answered"` (§1), so old buses degrade cleanly (every prior need
  reads open) with zero migration.
- **Angle "reuse-handoff" — settle needs through `ticsTodo`'s existing `handedOff` set.**
  Rejected: sharing the `handedOff` set across the delegate↔handoff loop AND the need↔answer
  loop CROSS-CLOSES them — a `handoff` could retire a `need` (or an `answer` a `delegate`)
  whenever tokens collide, corrupting both queues. The merged design CLONES `ticsTodo`'s
  pairing SHAPE but with a SEPARATE answered-set (§2), so the two loops share structure, never
  a set.
- **Angle "key-on-ref" — settle a need when ANY `msg` with a matching `ref` exists (key on the
  bare `ref`, not a sentinel).** Rejected: `msg` is the general DM kind, so an ordinary DM that
  reuses a need's token would FALSE-SETTLE the need — silently closing a still-blocked ask. The
  merged design keys settlement on the deliberate `result === "answered"` sentinel (§1), so
  only an intentional answer settles a need; a casual DM that shares the token never does.
- **The merge:** take the read/answer loop from the MC-inspired flow, but realize it as
  `msg` + `result="answered"` (beats "new-kind" — no field, no migration), with its OWN
  answered-set cloned from `ticsTodo`'s shape (beats "reuse-handoff" — no cross-close), keyed
  on the `result="answered"` sentinel (beats "key-on-ref" — no false-settle). One pure fold
  (`ticsReview`) + one thin write (`ticsAnswer`), dispatched in both dispatchers like
  `board`/`roster`. That is the locked v1 contract above.
