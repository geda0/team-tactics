# 0028 — One tic vocabulary, end to end: unknown kinds are never dropped

- **Status:** **Proposed.** Built red→green through the phase×layer gate (layer `app`, package `@ttics/tics`).
- **Date:** 2026-10-23
- **Deciders:** navigator (the pull: the fleet trial), architect (contract `tics-kinds` on the tics-project trial bus),
  product-owner (never-drop is a product promise, not a transport detail).
- **Relates to:**
  - **0025 (field learnings)**: N11, acknowledged handoffs, whose fold keys on `ref` + `to`, never on kind.
  - **0026 (git transport)**: never-drop on the write side; this ADR closes the same promise at the CLI.
  - **0014 §3 (MCP emit surface)**: its kind list governs the MCP server, not `tic.sh`.
- **Supersedes:** nothing.

## Context

In the fleet trial of 0.70 (tics-project, `docs/retro/2026-10-trial-0.70.md`), the brief and ADR 0025 used the
dispatch kind `assign`. `tic.sh` rejected it with rc 2 and recorded nothing. The lead noticed and switched to
`delegate`; the worker's poller kept matching `assign` and saw nothing for 11 m 40 s. Neither side got an error, and
the coordinator first misdiagnosed the stall as an idle session. A lane that ignored the rc lost its tic outright: the
lead's T-table result was dropped this way. `status`, used across the spool history, was rejected the same way.

## Decision

1. **`assign` and `status` are kinds.** They are ADR 0025's vocabulary and appear throughout the fleet's history.
2. **An unknown but well-formed kind is never dropped.** The kind is first **case-folded** (a case slip such as
   `Assign` is intent, not garbling: it is stored as `assign`). Well-formed then means a lowercase identifier,
   `[a-z][a-z0-9_-]*`, of **at most 32 characters**; anything else (e.g. `frontend:green`, the symptom of shifted
   arguments, or a long identifier that is more likely a shifted message) is malformed (rule 3). `tic.sh` records and publishes it as kind `note`, keeping the
   original in a field `orig_kind`, prints a warning on stderr, and exits **0**. Not nonzero: a `set -e` caller must
   not abort, and a caller that ignores the rc must still lose nothing. Coercing to `note` means an unknown kind can
   never be read by a gate or a fold as a verdict, a signal or a block. `tics log` shows `orig_kind`.
3. **Malformed calls stay hard rejects (rc 2, nothing recorded):** a flag-shaped FROM or TO, a kind that isn't a
   lowercase identifier, a reserved hook identity
   as FROM (`subagent`, `run-suite`, `guard`, `witness`), and a reader verb passed as the kind (`log`, `inbox`, ...).
   That is integrity, not loss: an agent must never be able to forge the referee, and a reader command is a usage
   error, not a tic.
4. **Folds key on `ref` + `to`, never on kind** (ADR 0025 N11). A vocabulary mismatch must not be able to hide an
   acknowledgement again. Known gap, carried to the N11 slice: `openNeeds` still closes a need only on a `msg`.
5. **The MCP surface speaks the same vocabulary** (`assign` and `status` included) but keeps rejecting an unknown kind
   with a loud tool error instead of coercing it: its schema enum already tells the caller the valid set, so nothing is
   silently lost.
6. **Only the kind is case-folded.** FROM and TO are stored as given. The reserved hook identities are matched exactly;
   a look-alike such as `Run-Suite` is recorded as an ordinary role, which can't impersonate the referee because every
   reader compares `from` exactly. Readers (`log` and `inbox`) show `orig_kind`.

## Predicates

- **K1:** `tic.sh` with kind `assign` or `status` exits 0 and the tic reaches the store with that kind.
- **K2:** kind `banana` exits 0 with a warning on stderr; the stored tic has kind `note` and `orig_kind: "banana"`; it
  is published under `TIC_STORE=git`; `tics log` shows `banana`.
- **K3:** FROM `run-suite` (or any reserved hook identity) or FROM `-x` exits 2 and records nothing; so does a kind
  that isn't a lowercase identifier (`frontend:green`).
- **K4:** a kind is case-folded first (`Assign` → `assign`, `STATUS` → `status`, `Banana` → note + `orig_kind`
  `banana`); a 32-character identifier is a note, a 33-character one is rc 2.

## Slices

1. **K1 + K2 + K3** (one gate change in `tic.sh`, one field in the record, one reader change for `log`).

## Consequences

- **Good:** the dispatch vocabulary is one word end to end, and the only way a tic disappears is a malformed call
  that is told so loudly.
- **Cost:** an unknown kind is visible only as a note; a typo like `verdcit` doesn't count as a verdict. That is the
  intended trade: a fold must not grant meaning to a word it doesn't know.
