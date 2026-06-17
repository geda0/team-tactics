# 0017 — Judgment gates made mechanical (but opt-in): real-delegation, release sign-off, sensitive-surface review

- Status: **Accepted** (built through the red→green gate; 140 tests green, tdd-critic PASS. The three
  teeth ship with tests GT-1 / GT-2 / GT-2b / GT-3 in `packages/team-tactics/test/stopgate.test.js`.)
- Date: 2026-06-17
- Deciders: navigator (the three gates must be MECHANICAL but DEFAULT-SAFE — no behavior change for
  `--minimal` or intentionally-solo installs; enforcement is a per-project knob), architect (where each
  gate's seam is, the enforce/suggest framing, the fail-closed lesson behind GT-2b), product-owner
  (the release gate belongs at the tag-push boundary as the outer loop's sign-off), tdd-critic (caught
  the GT-2 fail-OPEN hole that became GT-2b).
- Relates to: hardens **0006 (solo-drift backstop)** — GT-1 fixes the narratable signal it counted —
  and gives **0005 (full-framework-by-default)** a mechanical release sign-off (GT-2). Rests on the
  honest-gate / evidence surfaces (0009 / 0011) without changing them (`tics gate` is their consumer).
  **Supersedes nothing.**

## Context

### The thesis: the hooks ENFORCE the mechanics, but only SUGGEST the judgment

State this first because all three teeth follow from it. team-tactics has two kinds of rule:

- **Mechanical rules** — the test-first phase×layer gate, "no green, no edit," "no finishing on a red
  bar." These are **ENFORCED un-bypassably** by the hooks: a PreToolUse guard blocks an out-of-phase
  edit, run-suite signs the bar, the Stop hook refuses to finish on red. You cannot *narrate* your way
  past them — the referee fires on the actual tool call, not on what you claim.

- **Judgmental practices** — *really* delegating (vs narrating a solo run as if it were a team),
  signing a release off before it ships, reviewing a sensitive surface before editing it. These were
  historically only **SUGGESTED** — by prose in `CLAUDE.md`, by convention, by a `delegate` tic an
  agent is asked to emit. A suggestion is **narratable**: the letter can be satisfied while the spirit
  is not, and the framework couldn't tell the difference.

> The mechanics are enforced; the judgment was merely suggested. A suggestion is narratable — and what
> is narratable will, eventually, be narrated.

### The observed failure: satisfying the letter while working solo

A real adopter session (Claude Code) was observed **emitting `delegate`/`handoff` tics while working
essentially solo** — going through the coordination motions without engaging the team — and the
framework had no way to notice. The solo-drift backstop (0006) was *built to catch exactly this*, yet
it counted `handoff` tics generically; an orchestrator that hand-emits a `handoff` over `tic.sh` looked
identical, on the bus, to one that actually spawned a subagent. The letter was satisfied; the spirit
was absent; nothing surfaced it. This is the 0005/0006 lesson recurring one level up: **BUILT ≠
ACTIVATED** has a sibling, **NARRATABLE ≠ ENFORCED** — a judgment gate that can be talked past is not a
gate.

Root cause: three judgment gates were either narratable or never auto-ran.

1. The solo-drift detector counted a signal an orchestrator could emit by hand.
2. There was **no release sign-off at any mechanical boundary** — accept + PASS lived on the bus, but
   nothing consulted them before a release shipped.
3. There was **no review gate on sensitive surfaces** — auth/secrets/crypto code was edited under the
   same phase gate as everything else, with no "look before you touch this" pass.

### The constraint: mechanical, but default-safe

The navigator's framing is the whole shape of this ADR. Making a judgment gate mechanical must NOT
break the installs where solo *is* the right call. A one-line fix, a spike, a `--minimal` install, an
intentionally-solo session — none of these should suddenly see a block or a false alarm. So each tooth
is **mechanical but OPT-IN**: it becomes a real, un-narratable check, but its **enforcing** form is a
per-project knob that is **OFF by default**. Default behavior is advisory or no-op; enforcement is a
deliberate choice an adopter makes for a surface they care about. Mechanical availability, opt-in teeth.

## Decision

Make each of the three judgment gates **MECHANICAL** (un-narratable, auto-running at a real seam) while
keeping it **default-safe** (advisory or no-op until a project opts into enforcement). Three teeth:

### GT-1 — the drift detector counts REAL delegation

`packages/tdd/kit/hooks/solo-drift-check.sh` now counts only handoffs that are **un-narratable**: a new
`count_real_handoffs` matches `kind=handoff` AND `from=subagent` — the SubagentStop emission from
`subagent-handoff.sh`, which fires *because a subagent actually returned* and which no orchestrator can
forge by hand. An orchestrator that merely narrates `delegate`/`handoff` tics over `tic.sh` no longer
trips the count toward "team engaged," so the solo-drift NOTE fires on it correctly.

This is the precise fix for 0006's narratable signal: 0006 already chose `handoff` over manual
`delegate` *because* `handoff` is auto-emitted — GT-1 finishes the thought by requiring the handoff to
*also* come `from=subagent`, closing the hand-emit path. **Default-safe stance:** unchanged from 0006 —
still a non-blocking advisory Stop NOTE, still gated by `TEAM_ACCOUNTABILITY`, still silent on minimal
installs and below threshold. GT-1 makes the existing advisory *honest*, it does not make it blocking.

### GT-2 + GT-2b — a release gate at the tag-push boundary

`packages/tdd/kit/githooks/pre-push`: on a `v*` tag push it runs `tics gate` (product-owner accept +
tdd-critic PASS on the bus). This is the **mechanical seam** the outer loop (0005) was missing — a real
boundary, the moment a release leaves the machine, where the human sign-off the full framework is
supposed to provide is actually consulted instead of merely assumed.

- **Default (advisory):** gate not satisfied → a NOTE on stderr, `exit 0`. The push proceeds. Solo and
  minimal installs push freely and never false-alarm.
- **`RELEASE_GATE_ENFORCE=1` (opt-in):** gate not satisfied → the `v*` tag push is **BLOCKED**.
- **Satisfied:** never blocks, in either mode.
- Knobs: `RELEASE_GATE` (default 1; `0` skips the gate entirely) and `RELEASE_GATE_ENFORCE` (default
  0 = advisory). Both documented in `tdd.config`.

**GT-2b — the fail-closed lesson (a tdd-critic catch).** The first cut of GT-2 had a fail-OPEN hole:
if the `.claude/hooks/tics` reader was ABSENT and `RELEASE_GATE_ENFORCE=1`, the gate couldn't run, so
it... let the push through. That is the exact bypass GT-2 exists to close — **an enforced gate that
silently no-ops when its enforcer is missing is not a gate.** GT-2b makes that path **FAIL CLOSED**:
reader absent + enforce on → push BLOCKED, with a message pointing at the missing reader. The principle
generalizes and is worth keeping in view for any future gate:

> An enforced gate must never silently no-op when its enforcer is missing. "Can't check" under
> enforcement means BLOCK, not allow — otherwise removing the checker *is* the bypass.

Note that fail-closed only bites under `RELEASE_GATE_ENFORCE=1`. In the default advisory mode a missing
reader is simply a no-op, so the default-safe stance holds: nothing breaks on an install that hasn't
opted in.

### GT-3 — a sensitive-surface review guard

`packages/tdd/kit/hooks/guard-edit-scope.sh` gains `security_guard()`, called from `gate_path()` right
after the control-plane exemption and **before the phase switch**. A path matching `SECURITY_GLOB` (an
ERE in `tdd.config`) is **blocked (exit 2) in EVERY phase — including `off`**, the switch normally used
to disarm the gate for manual work — unless the edit is taken with `SECURITY_REVIEW=1`. Sensitive code
should not be edited on a reflex; this forces a deliberate, reviewed pass.

- **Default (no-op):** `SECURITY_GLOB` empty/unset → the guard returns immediately. Minimal and solo
  installs see no change.
- **Opt-in:** set `SECURITY_GLOB` (e.g. `(^|/)(auth|secrets|crypto)/|\.pem$`) and matching paths require
  a review pass.
- The control plane (`.claude/state/`) stays exempt; **Bash-redirect write targets are gated
  identically**, so a redirect can't smuggle an edit past the guard.

**Why it runs in `off` too — and why `SECURITY_REVIEW` is env-only.** `off` is the disarm switch for
non-TDD work; a sensitive-surface guard that `off` could disarm would be trivially bypassed by setting
phase to `off`. So GT-3 deliberately ignores phase. And `SECURITY_REVIEW=1` is documented as a
**PER-INVOCATION ENV OVERRIDE** (set in the editing turn / on the command line), **NEVER a line in
`tdd.config`** — because a sourced config value would *override the env* and **permanently disarm the
guard**, defeating the per-edit-review intent. A reviewed edit is a single deliberate act, not a
standing permission. The config docs (this ADR's Deliverable A) call this out explicitly.

### All three are OPT-IN / advisory by default — on purpose

The unifying decision: **none of these three changes the behavior of a `--minimal` or intentionally-solo
install.** GT-1 stays a non-blocking advisory (and only when `TEAM_ACCOUNTABILITY` is on, full-team
installed, over threshold). GT-2 is advisory until `RELEASE_GATE_ENFORCE=1`. GT-3 is a complete no-op
until `SECURITY_GLOB` is set. Mechanical availability is shipped to everyone; the enforcing teeth are a
deliberate per-project knob. This is the same opt-in discipline 0005's amendment landed on for the
every-prompt directive (default-OFF, because default-ON proactive enforcement is too invasive for shared
branches): give the capability to all, let the project decide where to bite.

## Consequences

- **The narratable judgment gates are now mechanical.** A solo session that emits `delegate`/`handoff`
  tics no longer fools the drift NOTE (GT-1); a release can be required to carry product-owner accept +
  tdd-critic PASS at the tag-push seam (GT-2); a sensitive surface can be made un-editable without a
  reviewed pass (GT-3). The letter can no longer be satisfied apart from the spirit.
- **Zero behavior change for minimal/solo-by-design.** GT-3 is a no-op without a glob, GT-2 is advisory
  without the enforce knob, GT-1 keeps 0006's silence rules. Adopters who *want* a teeth flip one knob.
- **A reusable fail-closed principle (GT-2b).** "Can't check under enforcement → block, not allow" now
  has a worked example in the kit and a place in this ADR; future gates inherit the rule.
- **The enforce/suggest line is now explicit.** This ADR names the distinction the framework had only
  lived implicitly: mechanics are enforced un-bypassably; judgment is enforced *only where a project opts
  in*, and never narratably anywhere.
- **Cost, accepted.** Three more knobs on the `tdd.config` surface (two release-gate, one security pair),
  documented in the existing comment-doc style; one new guard branch and one new count function; GT-1/
  GT-2/GT-2b/GT-3 added to the stop-gate suite. No change to the phase×layer gate, run-suite, or the
  honest-gate/evidence surfaces — `tics gate` is consulted, not modified.

## Out of scope (explicitly rejected or deferred)

- **Making any of the three blocking by default.** Rejected by the navigator's framing — solo is often
  the right call, and a default block punishes legitimate solo/minimal work and breeds work-arounds
  (the same reason 0006 chose a NOTE over a block, and 0005's amendment moved the directive to opt-in).
- **`SECURITY_REVIEW` as a config value.** Explicitly rejected: a sourced config override would
  permanently disarm the guard. It is an env override per reviewed edit, by design.
- **A fail-open release gate when the reader is missing under enforcement.** Rejected as GT-2b — that
  *is* the bypass. Enforcement that can't run fails closed.
- **Auditing the *quality* of delegation / review (did you delegate the right things, was the review
  real).** Out of scope, same as 0006: these teeth measure *engagement at the seam* (a real subagent
  handoff, accept+PASS present, a deliberate review pass), not the judgment behind it. Richer analysis
  belongs to `tics report`, not a hook.

## Alternatives considered

- **(a) Count manual `delegate` tics for "team engaged."** Rejected — that is the narratable signal GT-1
  exists to defeat. Only the `from=subagent` SubagentStop handoff is un-forgeable.
- **(b) Put the release gate on commit instead of tag-push.** Rejected — commit is too frequent and too
  early; the tag push is the actual release boundary, and it's where product-owner accept + tdd-critic
  PASS are meaningfully *final*. The pre-push hook already gates `v*` tags (version-drift), so the seam
  is established.
- **(c) Gate sensitive surfaces only in TDD phases (skip `off`).** Rejected — `off` is the disarm
  switch; a guard `off` could turn off is no guard. GT-3 ignores phase on purpose.
- **(d) Ship the teeth enforcing-by-default and let adopters opt OUT.** Rejected on the 0005-amendment
  lesson: a "remember to disable it" step is itself the anti-pattern, and proactive enforcement on a
  shared/prod branch is too invasive to default-on. Opt-IN to teeth; advisory/no-op by default.
