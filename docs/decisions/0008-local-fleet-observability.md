# 0008 — Local fleet observability (the board comes home as a read-side fold)

- Status: Accepted
- Date: 2026-06-15
- Deciders: navigator (bring the board home, no server), product-owner (selected E7;
  Tier-1 STUCK = the one degrade-safe rule, task-overload deferred to E7-d1),
  architect (the read-side fold seam + the liveness contract)
- Relates to: 0003 / 0004 (the session + claim substrate this folds over). Supersedes
  nothing. The Mission Control server idea (E6) is dropped/stashed; this keeps only the
  read-side that was always local.

## Context

We mined four adopter projects built on team-tactics around a **Mission Control**
server/brain (`packages/brain/src/index.ts` `enrichBoard`, ≈L167-219): it ingests our
**tic bus** (`.claude/state/tics.jsonl`) and renders a live fleet "board" — scope
grouping, liveness tiers, STUCK / orphan-claim / collision call-outs.

Two findings drive E7:

1. **Most of the board is a PURE READ-SIDE FOLD over the bus we already have.** It needs
   no server and no new bus fields — the inputs (sessions, claims, timestamps) are all
   already on the bus and already read by `tics-view.cjs`. So it comes home to
   `@ttics/tics` as local `tics` views.
2. **The leapfrog — liveness.** In the brain the liveness *tiers are declared but never
   computed* (deferred to an unshipped "liveness session"). Our reader ALREADY tracks the
   exact input: `activeClaims` builds `sessLatest` (session → latest tic `ts`) and
   `cfgNum` reads numeric `tdd.config` knobs. We can compute liveness LOCALLY, today.

The substrate this folds over is stable: `loadFor`/`loadTicsAll` (the bus, whole-picture
by default), `activeClaims`/`claimsFor` (claim-minus-release with release-on-done /
release-on-session-close / release-on-stale), `ticsSessions` (group-by-session),
`scopeMatch`, and `ticsCycle` (the host for the fleet-health line). The seam is
`packages/tics/kit/hooks/tics-view.cjs` (zero-dep CommonJS), exported through
`packages/tics/index.js` as `TV`, and dispatched by BOTH `packages/tics/bin/tics.js` and
the kit reader's `main()`.

## Decision

Build a **local read-side fold** in `tics-view.cjs`: a pure liveness helper, one board
model the views share, a new `tics board` view, and a fleet-health line in `tics cycle`.
**No server, no new bus fields.** Degrade-safe throughout (missing data → `unknown` →
never STUCK → no false alarms).

### 1. Seam / helper shape (names + dispatch)

- **`livenessTier(lastTs, nowMs, idleSec, staleSec) -> 'live'|'idle'|'stale'|'unknown'`** —
  pure function, the E7-1 foundation. No I/O; takes the already-resolved last-tic
  timestamp, the clock, and the two thresholds. Reused everywhere liveness is shown.
- **`fleetModel(targetDir, tics, opts) -> { members, byScope, orphans, collisions, tally }`** —
  the single pure fold over the bus that the renderers consume. `opts.nowMs` defaults to
  `Date.now()` (injectable for tests, mirroring `activeClaims`/`claimsFor`). Shape:
  - `members`: `[{ session, scope, liveness, lastTs, stuck }]` — one entry per
    (session, held-scope); a member holding no scope has `scope = null`.
  - `byScope`: scope → members (the grouping for rendering; the `unscoped` bucket holds
    members with no active claim).
  - `orphans`: `[{ scope, ref, session, reason }]` (`reason` ∈ `closed` | `stale`).
  - `collisions`: `[{ scope, sessions:[...] }]`.
  - `tally`: `{ live, idle, stale, unknown, stuck, orphans, collisions }` — the counts the
    `tics cycle` one-liner prints.
- **`ticsBoard(targetDir, all)`** — the E7-2 view: renders `fleetModel` (scope-grouped
  rows + the STUCK / orphan / collision call-outs).
- **`ticsCycle`** (E7-6) calls `fleetModel` and prints the one-line fleet-health summary
  from `tally`.

**Dispatch `board` in BOTH entrypoints** (mirror `conductor`/`cycle`): add `"board"` to
the `KNOWN` array + an `if (cmd === "board") process.exit(TV.ticsBoard(target, all));`
handler in `bin/tics.js`; add `case "board": return ticsBoard(target, all);` to `main()`'s
switch; export `ticsBoard` (and `livenessTier`, `fleetModel`) from `module.exports`; update
both usage strings. The installed `.claude/hooks/tics` derives from the kit reader — `kit/`
is authoritative (re-dogfood-install is a release step, not per-slice).

This is the minimum that lets the inner loop build each slice against a stable shape: E7-1
ships `livenessTier`; E7-2 introduces `fleetModel` + `ticsBoard` with members + liveness;
E7-3/4/5 add `stuck`/`orphans`/`collisions` to the same model; E7-6 reads `tally`. The
increment plan is the planner's; the shape and the rules below are the locked contract.

### 2. The liveness contract (precise — this is the load-bearing definition)

- **A session's "last tic"** = the lexicographically-greatest `ts` over all tics whose
  `session` field equals that id — exactly the `sessLatest` map `activeClaims` already
  builds. Tics with an empty `session` do NOT contribute to any session's last-tic and a
  session id of `""` is **not a member** of the fleet at all.
- **Age** = `nowMs - Date.parse(lastTs)`, in milliseconds (thresholds are seconds → ×1000).
- **Tiers**, evaluated TOP-DOWN (first match wins); the *aliver* tier wins on any overlap,
  which is the degrade-safe bias:
  1. `lastTs` missing OR `Date.parse(lastTs)` is `NaN` → **`unknown`**.
  2. `age ≤ idleSec` → **`live`**.
  3. `age ≤ staleSec` → **`idle`**.
  4. else → **`stale`**.
  So the intervals are half-open with the boundary on the aliver side: `live = [0, idle]`,
  `idle = (idle, stale]`, `stale = (stale, ∞)`. A session exactly at a threshold reads the
  *more-alive* tier (at `staleSec` it is `idle`, not `stale`) → never falsely STUCK. A
  misconfigured `staleSec < idleSec` just makes more sessions read `live` (step 2 wins) —
  still degrade-safe.
- **Thresholds** come from `tdd.config` via `cfgNum`, default-safe when absent:
  - `LIVENESS_IDLE_SEC` — **default 300** (5 min): ticked within the last 5 min ⇒ `live`.
  - `LIVENESS_STALE_SEC` — **default 900** (15 min): silent > 15 min ⇒ `stale`. **Amended
    (v0.46.0):** the original ADR aligned the `CLAIMS_TTL` example *with* this window (both
    900) and called the coincidence intentional. That was a footgun (F2) — uncommenting the
    documented `CLAIMS_TTL=900` made claim-expiry fire at the same instant a holder went
    stale, TTL-expiring it into an *orphan* before STUCK could surface. The shipped example
    is now `CLAIMS_TTL=1800` (above the stale window), so STUCK is observable even with
    claim-TTL on. The two knobs stay distinct by design (display vs expiry). See Consequences.
- **`unknown` is never STUCK and never orphan-by-liveness.** The reader never throws on a
  malformed/empty bus and never invents a tier.

### 3. STUCK (E7-3) — the loud call-out

`stuck = heldScope != null && liveness === 'stale'`, where **heldScope** = an *active*
claim (from `claimsFor(targetDir, tics)`, i.e. claim-minus-release with the existing
release-on-done / release-on-session-close / release-on-stale filters and the `CLAIMS_TTL`
TTL applied) whose `session` field == the member. `idle` / `live` / `unknown` are NEVER
stuck; a `stale` member holding NO active claim is NEVER stuck. STUCK reads the *filtered*
`claimsFor` output (the claim must still be considered held).

### 4. Orphan / abandoned claim (E7-4)

An **orphan** = a claim on the **raw** claim-minus-release ledger (before the
done/close/TTL filters) whose holder is **not a live member**, where:

- **live member** = a session id that is non-empty AND not closed (`!sessClosed.has(id)`)
  AND, when `CLAIMS_TTL > 0`, not past that TTL (the same `sessLatest`-vs-`CLAIMS_TTL`
  test `activeClaims` already applies). Equivalently: a claim is orphan iff `activeClaims`
  drops it **because its session died** (`session close` or `CLAIMS_TTL` expiry), with
  `reason` ∈ {`closed`, `stale`}.
- A claim released by **section-done** is a clean release, NOT an orphan (don't surface it).
- A claim with an **empty `session`** is NEVER an orphan (the default solo case has no
  session to be "dead" → no false alarm).
- A live/idle/recent session's claim is NEVER an orphan, even if it never emitted a
  `session open` — **ticking is the evidence of presence; announcement is not required.**

The orphan audit therefore reads the RAW ledger + `sessClosed` + `sessLatest` (the
`activeClaims` internals), NOT the filtered `claimsFor` output (which has already removed
exactly these claims).

### 5. Collision audit, post-hoc (E7-5)

`collision` = a real scope (`scope && scope !== '*'`) touched by **≥2 DISTINCT non-empty
sessions**. "Touched" = any tic carrying that scope and that session. Count the SET of
distinct non-empty `session` ids per scope; flag when `|set| ≥ 2`, naming the scope + the
colliding sessions. A scope touched by ≤1 distinct session is NOT flagged — and a single
session emitting many tics on one scope is **one** distinct session (dedup by id), so it is
never a self-collision. Empty-session tics do not contribute to distinctness (the default
solo bus never collides).

### 6. Fleet health in `tics cycle` (E7-6)

`tics cycle` prints one extra line from `fleetModel(...).tally`: counts of STUCK members,
orphan claims, and collisions, plus a liveness tally (`live`/`idle`/`stale`/`unknown`). On
a quiet/empty bus the line shows zeros and `cycle` still exits 0.

### 7. Empty / degrade-safe surfaces

`tics board` on an empty bus prints a friendly "no fleet activity yet" line and exits 0
(mirrors `tics sessions`/`claims`). Any missing/unparseable timestamp degrades to
`unknown`; the fold never throws.

### 8. Config

Document `LIVENESS_IDLE_SEC` (300) and `LIVENESS_STALE_SEC` (900) in
`packages/tdd/kit/tdd.config` alongside `CLAIMS_TTL`, read via `cfgNum` and default-safe
when absent (the implementer adds the commented example; the values above are the contract).

## Resolved contract risks

- **STUCK vs ORPHAN never double-count the same claim.** STUCK reads `claimsFor`
  (claim still active); a claim is orphan precisely because `activeClaims` DROPPED it for
  session-death, so it is no longer in `claimsFor` → not held → not STUCK. The two sets are
  disjoint by construction. A claim freed by section-done is neither (a clean release).
- **"Session is a board member" (orphan).** Resolved to lifecycle, not display: a member is
  "live" for orphan purposes when it is not closed and not `CLAIMS_TTL`-stale — NOT when its
  liveness tier happens to be `live`. Liveness tiers (`LIVENESS_*`, for display + STUCK) and
  claim-TTL expiry (`CLAIMS_TTL`, for orphan) are distinct knobs by design; with the default
  `CLAIMS_TTL=0`, orphan triggers only on an explicit `session close` (no TTL false-positives).
- **Announcement is not liveness.** A session that claims/works but never emits `session
  open` is still tracked via `sessLatest`; if recent it is live and its claim is not orphan.
  We do not require a presence announcement to count a session as alive (the brain's "never
  announced" phrasing conflated the two; locally we have liveness, so we use it).
- **Collision self-counting.** Distinctness is over `session` ids, deduped — one session's
  many tics on a scope are one toucher; empty sessions and `*` scope are excluded.
- **Threshold boundary.** Inclusive on the aliver side (`age ≤ idle` ⇒ live, `age ≤ stale`
  ⇒ idle), so a borderline session is treated as more alive → never a borderline STUCK.

## Consequences

- The fleet board adopters paid a server for is now a local, offline, zero-dep `tics`
  view, and we ship liveness the brain never computed.
- One pure helper (`livenessTier`) + one pure model (`fleetModel`) + one view (`ticsBoard`)
  + one extra `tics cycle` line; everything else (the bus, claims, sessions, config) is
  reused unchanged. The board model is a pure data structure → fully unit-testable with an
  injected `nowMs` and crafted `ts`, no clock flakiness.
- **No bus contract changes.** The fold reads existing fields only; no new `tics.jsonl`
  field, no emit-side change. The only internal contract growth is exposing
  `activeClaims`'s fold internals (`sessLatest`, `sessClosed`, the raw claim-minus-release
  ledger) to the board model. Keep `activeClaims(tics, opts) -> Map` and
  `claimsFor(targetDir, tics) -> Map` return shapes UNCHANGED (the guard/pre-commit consumers
  depend on them); expose internals additively (an opt flag, a sibling helper, or a small
  dedicated fold in `fleetModel`) — implementer's choice, but the existing returns are fixed.
- Invariants upheld: zero runtime deps, pure Node CommonJS, Node ≥16; `node --test` stays
  green; `selftest` passes; the kit reader (`kit/`) is authoritative (the installed
  `.claude/hooks/tics` re-derives on the next dogfood install — a release step).
- **Behavioral change (v0.46.0), adopter-facing.** Dogfooding E7 exposed a pre-existing
  `cfgNum` parse bug (F1, fixed in v0.45.0): the regex matched the *commented* example
  `#   CLAIMS_TTL=900`, so every full install silently ran `CLAIMS_TTL=900` instead of the
  documented `0 = off`. Fixing the parse (line-anchored regex) flips the **effective**
  default from 900 back to 0 — so a wedged/abandoned multi-session claim that previously
  self-healed after 15 min now persists until an explicit `session close`. Blast radius is
  limited to multi-session/sectioned use (a solo claim carries no `session` field and never
  TTL-expired either way). Adopters who *want* the old auto-expiry should set an explicit
  `CLAIMS_TTL` in `tdd.config` (the shipped example is now `1800`). The config comment carries
  this note so it reaches adopters, who do not receive ADRs.
- **F2 resolved (v0.46.0).** The shipped `CLAIMS_TTL` example was decoupled from
  `LIVENESS_STALE_SEC` (1800 vs 900) so enabling claim-TTL no longer pre-empts STUCK. STUCK
  and orphan remain mechanically disjoint (active vs dropped claim); the example value change
  just keeps the *windows* from coinciding in the common case. A future knob could fully
  separate the STUCK liveness window from `CLAIMS_TTL`; deferred unless the default proves
  insufficient.

## Out of scope (do NOT pull into E7)

- The Mission Control **server**, web **dashboard**, ingest API, multi-tenant, and
  **HostDirectives** — those stay server-shaped.
- Mission Control's planned **`CONTEXT.md` kit-ification** — explicitly excluded.
- The **task-overload STUCK signal** (a member with ≥N open delegated tasks) — deferred to
  **E7-d1**; Tier-1 STUCK stays the single degrade-safe rule `heldScope && stale`.

## Alternatives considered

- **Resurrect the server to render the board.** Rejected — the board is a read of data we
  already hold locally; a server adds an ingest hop, a deployment, and a data-policy surface
  for zero new capability at session scale.
- **Pass liveness through uncomputed (as the brain did).** Rejected — the inputs
  (`sessLatest` + a threshold knob) are already local, so computing it is the cheap leapfrog
  and the whole point of E7-1.
- **Reuse `CLAIMS_TTL` as the liveness threshold.** Rejected — `CLAIMS_TTL` governs claim
  *expiry* (lane freeing, default off); liveness display must be always-on with its own
  defaults. They are kept distinct (and the orphan audit, which IS about claim expiry, reuses
  `CLAIMS_TTL` precisely so STUCK and orphan stay disjoint).
- **Define orphan by liveness tier instead of lifecycle.** Rejected — it would double-count
  a stale holder as both STUCK and orphan and would false-alarm a live-but-unannounced
  session. Lifecycle (closed / TTL-stale) is the crisp, disjoint definition.
