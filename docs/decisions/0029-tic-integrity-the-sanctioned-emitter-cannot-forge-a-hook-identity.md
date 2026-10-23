# 0029 — Tic integrity: the sanctioned emitter cannot forge a hook identity

- **Status:** **Proposed** (security patch, v0.71.1). Built red→green through the phase×layer gate.
- **Date:** 2026-10-23
- **Deciders:** architect (contract `security` on the team-tactics bus, which reproduced the issue on main),
  tdd-critic (found the related newline variant on the ADR 0028 branch), navigator.
- **Relates to:** 0009 / 0011 (hook-signed vs self-reported greens), 0024 (enforcement is host-dependent), 0028 (one
  tic vocabulary; its own kind gate is hardened by the same rules).
- **Supersedes:** nothing.

## Context

`tic.sh FROM TO KIND MSG [REF] [RESULT]` forwarded every further argument to `emit_tic`, whose 7th parameter
(EXTRA_JSON) is inserted into the record raw. Two forgeries followed, both reproduced on main:
- a 7th argument containing a newline appended a whole second, forged tic line;
- a single-line 7th argument such as `,"from":"run-suite","kind":"signal","result":"green"` duplicated fixed keys, and
  `JSON.parse` keeps the last value, so an agent's tic read as a **hook-signed** green.
Role identities (`tdd-critic`, `leader`, ...) are self-asserted by design. The hook identities (`run-suite`, `guard`,
`subagent`, `witness`) are the one boundary the kit tells agents they cannot cross; this let them cross it through
the sanctioned emitter.

## Decision

1. **`tic.sh` takes at most 6 arguments.** A 7th is a malformed call: rc 2, nothing recorded.
2. **EXTRA_JSON has an allowlist grammar** (it remains for hooks such as run-suite's `,"exit":N,"durationSec":N`):
   zero or more `,"key":value` pairs, where `key` is an identifier and `value` is an integer or a string with no
   quote, backslash or control character, and no key equals a fixed field (`ts seq kind from to phase layer scope
   session msg ref result`). On a violation the EXTRA is dropped with a stderr warning; the tic itself is still
   recorded (never-drop).
3. **Readers reject any line with a duplicated top-level key**, counted as unreadable. The bus is shared across kit
   versions, so an older host can still write a forged line; this makes the read side refuse it everywhere.
4. **The MCP emit path** passes at most the six positionals.

**Honest scope.** This closes the *sanctioned emitter* only. An agent with shell write access can still source
`tics-lib.sh` and call `emit_tic run-suite …`, or append to the store file directly. Hook-identity attestation is only
as strong as the host's file permissions (ADR 0024). The kit does not claim "unforgeable". Follow-up need:
tamper-evident hook signals (e.g. a hook-only store the agent's permission rules deny, or a keyed MAC from a
hook-only location).

## Predicates

- **I1:** `tic.sh` with a 7th argument exits 2 and records nothing; no stored tic reads `from === "run-suite"`.
- **I2:** an EXTRA containing a fixed-field key (e.g. `,"from":"run-suite"`) or a newline is dropped with a warning,
  the tic is recorded with its true `from`, and run-suite's own `,"exit":0,"durationSec":1` still passes.
- **I3:** a store line with a duplicated top-level key is never read (not listed, not counted as a hook-signed green),
  and `tics log` counts it as unreadable.
- **I4:** the MCP `tic_emit` cannot pass a 7th positional.

## Consequences

- **Good:** the documented emitter and every reader now refuse hook-identity forgery; mixed-version buses are
  protected by the read side.
- **Cost:** EXTRA is narrower (flat integers and plain strings). The kit's own hooks fit it today.
