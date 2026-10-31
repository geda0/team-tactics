# 0029 — Tic integrity: the sanctioned emitter cannot forge a hook identity

- **Status:** **Proposed** (security patch, v0.71.1). Built red→green through the phase×layer gate.
- **Date:** 2026-10-23
- **Deciders:** architect (contract `security` on the team-tactics bus, which reproduced the issue on main),
  tdd-critic (found the related newline variant on the ADR 0028 branch), navigator.
- **Relates to:** 0009 / 0011 (hook-signed vs self-reported greens), 0024 (enforcement is host-dependent), 0026 (P7:
  hook telemetry stays off the git bus), 0028 (one tic vocabulary; its own kind gate is hardened by the same rules).
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
1b. **Identities are allowlisted and checked as stored** (amended after the security audit found a second bypass:
   the reserved check ran on the raw FROM while CR/LF were stripped later, so `$'run-suite\n'` was stored as a clean
   `run-suite`). FROM and TO must match `^[A-Za-z0-9][A-Za-z0-9._:@-]{0,63}$` (TO may also be `*`), validated on the
   value exactly as it will be written; anything else (newline, CR, any control byte, a space, a non-ASCII look-alike)
   is malformed, rc 2, nothing recorded. The reserved-identity check runs **after** that, on the validated value. The
   MCP surface applies the same grammar. Every from/to on the existing buses fits (61 distinct ids, max 17 chars).
2. **EXTRA_JSON has an allowlist grammar** (it remains for hooks such as run-suite's `,"exit":N,"durationSec":N`):
   zero or more `,"key":value` pairs, where `key` is an identifier and `value` is a JSON integer (`-?(0|[1-9][0-9]*)`)
   or a string with no
   quote, backslash or control character, and no key equals a fixed field (`ts seq kind from to phase layer scope
   session msg ref result`). On a violation the EXTRA is dropped with a stderr warning; the tic itself is still
   recorded (never-drop).
3. **Readers reject any line with a duplicated top-level key**, counted as unreadable. The bus is shared across kit
   versions, so an older host can still write a forged line; this makes the read side refuse that form everywhere.
   **Readers also refuse a git-bus line whose `from` is a hook identity** (amended after the re-audit: an older host
   can still publish through the CR/LF forge, a clean `from: run-suite` line with no duplicate key to catch). Hook
   telemetry never publishes under `TIC_STORE=git` (ADR 0026 P7), so such a line is forged or came from an old host.
   The two can't be told apart, so a genuine hook line from a v0.69.x host (the git store shipped there, P7 in v0.70.0)
   is refused too. The check is an exact match on the parsed `from`, line by line, on the bus read path only (the
   checkout's `tics.d/` and `origin/<TICS_BRANCH>`). Hook tics in the jsonl and spool stores stay readable; that is
   where hook telemetry lives. A refused line counts among `tics log`'s skipped lines, whose wording says "unparsable"
   though this line parses. The refusal is a read filter: it changes no bus file, so forged lines already there remain
   in the bus history.
4. **The MCP emit path** passes at most the six positionals.

**Honest scope.** This closes the *sanctioned emitter* and the *old-host hole* the re-audit raised: a hook identity an
older host publishes to the bus is refused by a reader with this filter. It stops there. A reader without the filter
still honors such a line, and the line stays in the bus history. Rule 3's "on the bus read path only" has an exception
too: the spool read path is unfiltered, so a reader whose `TICS_DIR` points at the bus checkout's `tics.d` honors such
a line even though it has this filter. That is a misconfiguration: it needs control of local config, and no doc
suggests it (the docs point `TICS_DIR` at `<git-common-dir>/tics-bus`). An agent with shell write access can still
source `tics-lib.sh` and call `emit_tic run-suite …`, or append to a local store (jsonl or spool) directly, and those
lines are read as hook tics. Hook-identity attestation is only as strong as the host's file permissions (ADR 0024).
The kit does not claim "unforgeable". Follow-up need:
tamper-evident hook signals (e.g. a hook-only store the agent's permission rules deny, or a keyed MAC from a
hook-only location).

## Predicates

- **I1:** `tic.sh` with a 7th argument exits 2 and records nothing; no stored tic reads `from === "run-suite"`.
- **I2:** an EXTRA containing a fixed-field key (e.g. `,"from":"run-suite"`) or a newline is dropped with a warning,
  the tic is recorded with its true `from`, and run-suite's own `,"exit":0,"durationSec":1` still passes.
- **I3:** a store line with a duplicated top-level key is never read (not listed, not counted as a hook-signed green),
  and `tics log` counts it as unreadable.
- **I4:** the MCP `tic_emit` cannot pass a 7th positional.
- **I5:** a FROM/TO outside the identity allowlist (newline, CR, `\x01`, trailing space, non-ASCII hyphen) or a control
  character in KIND is rc 2 with nothing recorded, on tic.sh and MCP; real ids (`macM1-lane2`, `session_01KqABC`,
  `navigator-delegation-setup`, TO `*`) are accepted.
- **I6:** a leading-zero integer in EXTRA is dropped with a warning; every stored line parses.
- **I7:** a well-formed git-bus line whose `from` is a hook identity, read from the checkout or from `origin`, is not
  listed, is counted among `tics log`'s skipped lines and is not counted as a hook-signed green; a hook tic in the
  jsonl or spool store is still listed and counted.

## Consequences

- **Good:** the documented emitter and every reader at this version now refuse hook-identity forgery; on a
  mixed-version bus the read side protects each host that has upgraded, not the hosts that haven't.
- **Cost:** EXTRA is narrower (flat integers and plain strings). The kit's own hooks fit it today.
- **Cost:** genuine hook lines from v0.69.x hosts are refused along with forged ones, and refused lines stay in the bus
  history, so `tics log`'s skipped count doesn't clear. This project's bus holds one such line today (seq 104, a P7
  probe). These lines aren't only telemetry: `guard` also emits `claim`, `section` and `need` (`guard-edit-scope.sh`),
  so refusing them drops a v0.69.x peer's auto-claims and claim enforcement fails open against that peer. The exposure
  is limited to mixed fleets, because v0.70+ hosts never publish these lines (P7 first shipped in v0.70.0).
