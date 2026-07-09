# 0024 — Enforcement is host-dependent (never an absolute); the QA seam is the verdict tic, not the qa-verifier agent

- **Status:** **Accepted** (a decision + a wording contract; no code in this ADR. The doc/rule edits it
  requires go through the red→green gate afterwards, pinned by the assertable predicates in §5/§7.)
- **Date:** 2026-07-08
- **Deciders:** architect (both rulings: the enforcement-asymmetry argument for failing *safe* toward
  "assume refereed", and the QA seam being the tic rather than the agent), navigator (the trigger — a
  forensic read of the gvp adopter's bus), product-owner (the adopter-facing promise: say exactly what
  was observed, once, dated, and never generalize an unrepeated observation into a guarantee).
- **Relates to:**
  - **0018 (Cursor↔CC parity, three tiers)** — this ADR **corrects** 0018's tier-3 characterization.
    0018 called the phase gate / security guard / solo-drift "irreducibly Claude-Code-only … there's no
    Cursor hook-event seam." That absolute is **falsified** (§2). 0018's *load-bearing* moves survive
    intact and are the reason this ADR can be written at all: reserved hook identities, the single-source
    pointer rule, `refreshCursorRule` on update. **Supersedes 0018 only on the "CC-only" wording**, not on
    its architecture.
  - **0020 (discipline is a directive, not a hook)** — applied twice. Ruling 1 fixes a *doc* that told
    agents to disarm; Ruling 2 fixes a *doctrine*, not the `tools:` frontmatter.
  - **0021 (browser-QA smoke verdict)** — this ADR draws the boundary of `smoke`'s range (text markers in
    a rendered DOM) and lifts 0021's never-false-pass rule out of the helper and into doctrine (§7 E-2).
  - **0010 (capability-aware execution)** — the `model: opus` frontmatter drift is named here and ruled
    **out of scope** (§8).
  - **0017 (judgment gates mechanical)** — invoked as the *limit*: we do **not** extend `tics gate` to
    require a QA verdict, because "is this bullet experience-level?" is a judgment, not a predicate.
  - **0007 (customized agents survive update)** — the sanctioned home for host-specific tool names.

---

## 1. Context

Two independent failures, found by forensics on the **gvp** adopter (`/Users/marwanelgendy/workspace/PP/gvp`,
read-only), share one root cause: **a doc asserted an absolute that the machinery does not support.**

## 2. Ruling 1 — the enforcement boundary is host-dependent, and the docs must be correct under both worlds

### 2.1 What is verified

On **2026-07-07T22:01–22:08Z** a **Cursor** composer agent drove gvp. Its bus
(`/Users/marwanelgendy/workspace/PP/gvp/.claude/state/tics.jsonl`) contains, inside that window:

- Four `guard → orchestrator` **block** tics naming Cursor's exact files at Cursor's self-set phases —
  seq 743/744/745/747 (`22:08:06Z`–`22:08:34Z`), e.g.
  `phase=red layer=app: source edit refused (…/css/styles.css) — write the failing test first`.
- One `subagent → orchestrator` **handoff** tic, seq 715 at `22:03:42Z` — the `SubagentStop` hook fired
  for Cursor's `task_v2`.
- 33 `run-suite → *` **signal** tics stamped `22:0x`, plus `red-storm` **stuck** tics.
- No Claude Code transcript exists anywhere in that window.

Attribution is airtight because `guard` / `run-suite` / `subagent` / `witness` are **reserved `from`
identities**, refused at *both* emit boundaries:

- `.claude/hooks/tic.sh:14` — `case "${1:-}" in subagent|run-suite|guard|witness) … Nothing recorded.`
- `packages/tics/kit/hooks/tics-mcp.cjs:77` — `const RESERVED_FROM = ["subagent","run-suite","guard","witness"];`
  enforced at `:206-208` (`"… is a hook-only identity — agents cannot self-assert it"`).

No agent — in any host, over the script or over MCP — can forge those tics. **Therefore Cursor executed the
kit's `.claude/settings.json` hooks in that configuration.** The `PreToolUse`, `PostToolUse`, and
`SubagentStop` events all fired.

Note the corollary that closes 0018's specific claim: the "security-surface guard" 0018 named as
irreducibly CC-only lives in **the same script that provably fired** — `guard-edit-scope.sh:104`. It is not
a separate hook; it is a branch of the hook Cursor ran.

### 2.2 What is NOT verified — and must not be asserted

- **Any other Cursor version or configuration.** One instance, one window, no config capture; `cursor-agent`
  is not installed on this machine, so we could not re-verify live.
- **The `Stop`-hook rungs.** `require-green-to-stop.sh` and `solo-drift-check.sh` emit **no tic**
  (verified: no `emit_tic` in either). Their firing is *unobservable from the bus*, in any host.
- **The `Bash` PreToolUse guard.** `settings.json` registers `guard-edit-scope.sh` on a `Bash` matcher; no
  block against a Bash write appears in the window. Unobserved ≠ absent.
- **Why Cursor's `edit_file_v2` matched a `matcher: "Edit|Write|MultiEdit"`.** The tool-name mapping is
  host-internal and undocumented, so it is exactly the kind of thing a host version bump can change.

### 2.3 The decision

**Do not invert the absolute.** "The referee does not run in Cursor" is false; "the referee runs in Cursor"
is not established. Both are the same mistake at different signs. The docs must assert **host-dependence**
and hand the agent a **mechanical way to find out which world it is in**.

**The enforcement asymmetry (the load-bearing argument).** The two errors are not symmetric in cost:

| The doc says | Truth: hooks fire | Truth: hooks don't fire |
|---|---|---|
| "you may be refereed — self-enforce anyway" | redundant discipline; **safe** | discipline is the only referee; **safe** |
| "you are unrefereed — self-enforce" | agent disarms: stops honoring phase, reads a block as a bug, flips `phase` to unblock; **unsafe** | (correct, but the agent still had to self-enforce) |

Telling an agent it is unrefereed changes its behavior even when it *is* refereed — the shipped
`.cursor/rules/tics.mdc` said *"nothing here forces these calls"* to an agent whose calls were, in fact,
being forced. The observed gvp behavior is consistent with that: blocked at `phase=red`, the agent ran
`echo green > .claude/state/phase` and re-edited. (Whether a failing test preceded that flip is
**unverified** — the point is that the doc licensed treating `phase` as a permission slip rather than a
declaration.) **So the wording must fail safe toward "assume refereed."**

**The probe (a mechanism we already ship, not a new one).** After an edit to a file matching the layer's
`SRC_GLOB`/`TEST_GLOB`, read the bus. A tic with `from=run-suite` (a `signal`) or `from=guard` (a `block`)
naming your file proves the hooks ran **for your tool**. This is the same distinction `tics gate` already
computes as **hook-signed vs self-reported** (`packages/tics/kit/hooks/tics-view.cjs:227-236`, surfaced at
`:466-468` — *"the referee may not have run for this work"*). Reuse that vocabulary; do not invent one.

**The probe is one-directional — presence confirms, absence never refutes.** `run-suite.sh:24-26` exits
silently when the edited path matches neither glob (a README/config edit emits nothing), and the guard is
silent whenever it *allows* an edit. Hence: **no hook-signed tic ⇒ assume refereed and self-enforce anyway.**

And `npx tics selftest` proves the hooks are **installed**, not that your host **fires** them. That
distinction must survive the rewrite.

---

## 3. Ruling 2 — the QA seam is the `verdict` tic, not the `qa-verifier` agent

### 3.1 What happened

The gvp milestone's acceptance was **experience-level**: *"the stars trail never clears"*, *"the site feels
cheap."* Two hosts, two paths, one identical outcome — **zero QA verdicts on the bus**:

- **Claude Code side.** `smoke-verify.cjs` (ADR 0021) is a marker predicate: *"is this text present in the
  rendered DOM?"* It cannot see a haze. The richer instrument — a host browser MCP (screenshots,
  `preview_eval`, console) — was held by the **orchestrator**, and
  `packages/team-tactics/kit/presets/full-team/agents/qa-verifier.md:4` grants only
  `tools: Read, Bash, Grep, Glob`. So the orchestrator did all QA in-thread. `qa-verifier` was never
  spawned; nothing landed.
- **Cursor side.** It *did* run the smoke rung — but through the module API
  (`require(…).smokeVerify(…)`). Emission lives only in `main()` behind `TT_QA_EMIT === '1'`
  (`smoke-verify.cjs:114`), reached only via `if (require.main === module)` at `:121`. A module-API caller
  emits nothing. Nothing landed.

And the gate did not notice, **by design**: `ticsGate` requires `product-owner` + `tdd-critic`
(`tics-view.cjs:455`) and treats `qa-verifier` as *conditional* — penalized only **if present** and non-pass
(`:461-462`). A **missing** QA verdict is invisible. Gate: CLEAR.

### 3.2 The decision — a directive, with the smallest possible mechanism change (none)

We take **option (b), a doctrine change**, and explicitly **reject (a)**. Per ADR 0020's standing bias:
prefer a tool-agnostic directive over a tool-specific mechanism.

**Why (a) is unsound.** `tools:` is an allowlist of tool *names*. An MCP tool's name is
`mcp__<server>__<tool>`, where `<server>` is **the adopter's own local config key** (`Claude_Preview` here).
The kit cannot know it. Shipping `mcp__Claude_Preview__preview_eval` in a portable kit agent would hardcode
one user's config into every adopter's install, do nothing (or error) for everyone else, and break tier-1's
tool-agnosticism (ADR 0018). **Never ship a host-specific tool name in a kit agent.**

**Why the doctrine is the real fix.** Both failures have the same shape and neither is about `tools:` — an
experience-level ruling was *made* and never *landed*. Fix the landing, and the instrument stops mattering.

---

## 4. The QA seam contract (normative)

**E-1 — the seam is the tic.** The contract at the QA seam is a `verdict` tic, **not** the `qa-verifier`
subagent. `kind=verdict`; `from` = the role that actually observed; `to` = `product-owner` (or `*`);
`result` ∈ `pass|concerns|block` **explicit, never inferred from prose**; and `msg` **MUST name the
instrument**. An experience ruling that is not on the bus does not exist.

**E-2 — the instrument vocabulary (closed set; extend by ADR).**

| instrument | what it is | what it can answer |
|---|---|---|
| `smoke` | `smoke-verify.cjs` CLI (ADR 0021) | *only* "is this text marker in the rendered DOM" |
| `browser-mcp` | a host browser tool (screenshot / eval / console) | pixel- and console-level; host-specific; self-reported |
| `human` | the navigator looked | anything; final authority |
| `none` | no instrument was used | **nothing** |

`instrument=none` ⇒ the only permitted `result` is `concerns`, and `msg` must say *unverified*. **Never a
`pass` without an instrument.** (ADR 0021's never-false-pass rule, lifted from the helper into doctrine.)

**E-3 — who may make a pixel-level observation: whoever holds the instrument.** An appearance-level bullet
("the trail never clears") is **outside `smoke`'s range by construction** and requires `browser-mcp` or
`human`. The holder of that instrument makes the observation — **including the orchestrator** — and emits
the verdict under **its own `from`**. Emitting under `from=qa-verifier` when qa-verifier did not run is
identity laundering; `qa-verifier` is agent-assertable (it is *not* in `RESERVED_FROM`), so nothing
mechanical stops it — which is precisely why the directive must forbid it.

**E-4 — the product-owner's accept must cite the experience evidence.** For a milestone with **any**
experience-level acceptance bullet, the PO's `accept` verdict `msg` must reference the experience verdict(s)
it relies on (seq and/or instrument). No experience verdict on the bus + an experience-level bullet ⇒ the
PO's ruling is `concerns`, not `accept`.
**We do NOT extend `tics gate`.** Deciding whether a bullet is "experience-level" is judgment, not a
predicate — mechanizing it would violate ADR 0017's line. `ticsGate` stays exactly as it is
(`tics-view.cjs:455`, `:461-462`). This rung is a directive, enforced by the PO's own honesty and audited
by `tdd-critic`.

**E-5 — tools frontmatter: portable default, documented opt-in.** The kit's `qa-verifier` keeps
`tools: Read, Bash, Grep, Glob` (portable; `Bash` already reaches `smoke-verify.cjs`). Adopters whose host
has a browser MCP **MAY** add its tool names to their local copy — that is exactly the case ADR 0007
(customized agents survive update) exists to serve. `outer-loop.md` and the agent file document the
`mcp__<server>__<tool>` pattern and state plainly that `<server>` is the adopter's config key, so the kit
cannot ship it.

**E-6 — the sanctioned emission path.** The **CLI with `TT_QA_EMIT=1`** is the only sanctioned automatic QA
emission. A **module-API** caller (`require(…).smokeVerify(…)`) gets a pure predicate and **no bus
emission** — correct by design (ADR 0021 §honesty; v0.66.2 made CLI emission opt-in), and a documented
trap. A module-API caller **MUST** emit its own `verdict` tic per E-1.

---

## 5. The wording contract (what the docs must satisfy — assertable predicates)

Scope: `packages/tdd/kit/docs/tool-support.md` **and** the rule body generated by `writeCursorRule()` in
`packages/tics/kit/hooks/tics-mcp.cjs:398-427` (the single source for `.cursor/rules/tics.mdc`), plus their
dogfooded copies. Each predicate is written so a test can pin it.

- **W1 — no absolute, in either direction.** Neither text contains, case-insensitively, any of:
  `does not run Claude Code's`, `do not run Claude Code's`, `does NOT run in Cursor`,
  `the phase referee is gone`, `irreducibly Claude-Code-only`, `irreducibly CC-only`, `CC-only`.
  Nor an unqualified positive: no sentence asserting `Cursor runs the hooks` / `the referee runs in Cursor`
  without a hedge from W2.
- **W2 — positive host-dependence.** Both texts contain the phrase **`host-dependent`** (and tier 3 is
  named for the *seam*, not the vendor — e.g. "the **hook** referee — wherever your host runs
  `.claude/settings.json` hooks", not "the CLAUDE CODE referee").
- **W3 — the observation, stated once, dated, un-generalized.** `tool-support.md` records that **one
  Cursor configuration was observed running these hooks (2026-07-07)**, and immediately states that this is
  a single observation, not a guarantee for other versions or configurations.
- **W4 — the probe, mechanically.** Both texts give: (a) edit one file inside the layer's
  `SRC_GLOB`/`TEST_GLOB`; (b) read the bus (`.claude/hooks/tics log`); (c) a tic with `from=run-suite`
  (`signal`) or `from=guard` (`block`) naming your file ⇒ **the hooks fired for your tool**; (d) those
  `from` values are **unforgeable** — cite `tic.sh` reserved identities and `RESERVED_FROM` in the MCP
  server. Both texts use the shipped words **`hook-signed`** and **`self-reported`**.
- **W5 — the probe is one-directional.** Both texts state that **presence proves refereed; absence proves
  nothing** (`run-suite` is silent for out-of-glob paths; the guard is silent when it allows), and
  therefore **absence ⇒ assume refereed and self-enforce anyway.**
- **W6 — the self-enforce checklist is unconditional.** Its heading MUST NOT be predicated on the referee's
  absence (the string `Because the phase referee is gone` is forbidden). It carries two lines:
  *"self-enforce regardless — if the hooks fire it costs nothing; if they don't it is the only thing
  standing"*, and *"if a hook blocks you, comply; never flip `phase` merely to unblock an edit —
  `.claude/state/phase` is a declaration of what you are doing, not a permission slip."*
- **W7 — selftest vs the bus.** Both texts keep the distinction: `npx tics selftest` proves the hooks are
  **installed**; only a hook-signed tic proves your host **fires** them.
- **W8 — tier 2 is unchanged.** The git-hook / CI portability claim (`npx tics install-hooks`: pre-commit
  green bar, post-commit `commit` tic, pre-push release gate) stays exactly as written — it was and remains
  true and tool-independent.
- **W9 — coverage precision.** Both texts state that only `PreToolUse` (guard), `PostToolUse` (run-suite)
  and `SubagentStop` (subagent-handoff) leave bus evidence; the `Stop` rungs — `require-green-to-stop` and
  `solo-drift-check` — **emit no tic**, so whether they fire is **unobservable from the bus** in any host.
  Neither text may claim they do or do not fire in Cursor.
- **W10 — single source (ADR 0018).** `.cursor/rules/tics.mdc` MUST NOT restate the enforcement story. It
  carries at most: one `host-dependent` sentence, the one-line probe, and a pointer to
  `docs/tdd/tool-support.md`. This is what stops `writeCursorRule` from drifting again.
- **W11 — the stray artifact.** No shipped `.md` contains the literal bytes `</invoke>` or `</content>`
  (see §9).

For `packages/team-tactics/kit/presets/full-team/docs/outer-loop.md` and
`.../agents/qa-verifier.md`:

- **Q1** — the ACCEPT step states that the seam is the **verdict tic, not the agent**: whoever observed,
  with whatever instrument, emits it (E-1).
- **Q2** — the instrument vocabulary of E-2 appears verbatim (`smoke` / `browser-mcp` / `human` / `none`),
  with `instrument=none ⇒ concerns, never pass`.
- **Q3** — `smoke`'s range is stated as a limit: **text markers in a rendered DOM; it cannot see
  appearance.** An appearance-level bullet requires `browser-mcp` or `human`.
- **Q4** — the orchestrator is explicitly permitted to make the observation when it holds the instrument,
  and explicitly forbidden from emitting under `from=qa-verifier` (E-3).
- **Q5** — the PO's accept on an experience-level milestone must cite the experience verdict, else
  `concerns` (E-4). No `tics gate` change.
- **Q6** — the `mcp__<server>__<tool>` opt-in is documented as an **adopter-local** customization (ADR
  0007); the kit frontmatter stays `Read, Bash, Grep, Glob`.
- **Q7** — the module-API-emits-nothing trap is documented (E-6).

---

## 6. Consequences

- **Cursor agents stop being told to disarm.** The worst outcome — an agent that *is* refereed and believes
  it is not — is removed. The cost is a little redundant discipline in the (unverified) unrefereed world.
- **We ship a claim we can defend.** Every sentence in the new tier-3 text is either verified in §2.1 or
  hedged. Future host versions cannot falsify a host-dependent statement.
- **The probe is discoverable and cheap** — and it is not new machinery: `hook-signed` / `self-reported` is
  already computed by `tics gate`.
- **QA becomes seam-shaped.** The bus, not the roster, is where an experience ruling lives. A milestone with
  a visual bullet and no experience verdict is now a *stated* violation, catchable by `tdd-critic` and by a
  human reading `tics log` — where before it was silently gate-CLEAR.
- **`tics gate` keeps its shape** (PO + critic required; qa conditional). We accept that E-4 is honor-bound,
  not mechanical, because the alternative is mechanizing a judgment (ADR 0017).
- **ADR 0018 must be read alongside this one.** It is not superseded; its tier-3 *wording* is. A migration
  note belongs in the doc rewrite: adopters who read "the phase referee is gone" and turned off their own
  discipline should re-read tier 3 and run the probe.

## 7. Migration note

No contract, tic `kind`, field, or hook changes. Docs and one generated rule body change. Adopters get the
corrected text on `ttics update` via `refreshCursorRule` (ADR 0018) — which is the mechanism that makes this
fix *reach* them at all.

**Addendum (2026-07-09, v0.68.1):** the migration vehicle itself did not reach pre-0.61 installs.
`refreshCursorRule` only recognized a rule carrying the `team-tactics: managed` sentinel, but the kit's own
rule bodies generated in v0.55–v0.58 never carried it — so pre-0.61 adopters were misclassified as "foreign"
and kept the falsified "the phase × layer TDD referee does not run in Cursor" claim forever. Fixed (test-first,
CP-1c): `refreshCursorRule` now recognizes a rule as kit-managed when it carries the sentinel **or** matches a
known historical kit fingerprint (`CURSOR_RULE_FINGERPRINTS`, covering the pre-0.61 and 0.61–0.67 bodies),
shipped v0.68.1. The invariant holds unchanged — a rule with no sentinel **and** no known fingerprint is left
untouched, so we never clobber a user's own rule.

## 8. Explicitly out of scope

`model: opus` is hardcoded in the frontmatter of `qa-verifier.md:5`, `product-owner.md:5`, `architect.md:5`,
`project-manager.md:5`, `dev-ops.md:5`, while `tdd.config:54-56` puts qa-verifier / project-manager / dev-ops
on the **fast** tier. That is a real **ADR 0010 conformance drift** — but it is a roster/config question, not
a seam, and folding it into this ADR would couple an enforcement-wording fix to a cost-tuning change. **Filed
as drift `D-0024-model-frontmatter`** for the loop to fix separately (note the orchestrator's spawn-time
`MODEL_<ROLE>` choice already overrides the frontmatter default, so nothing is broken today — only
misleading).

## 9. Also filed (do not fix in this ADR)

`packages/tdd/kit/docs/tool-support.md` ends with a literal tool-call artifact — the bytes
`</content>\n</invoke>\n` — introduced by commit `4930883` (v0.61.0) and **shipped to every adopter since**.
The same artifact appears in `docs/tdd/tool-support.md`, `docs/decisions/0010-capability-aware-execution.md`,
and `docs/decisions/0014-tics-mcp-server.md` (verified: those four files, repo-wide). Drift
**`D-0024-stray-artifact`**; pinned by predicate **W11**. Since `tool-support.md` is being rewritten anyway,
the loop should take both in one slice — and add the regression assertion, because nothing today would catch
a fifth occurrence.
