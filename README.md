# ttics — the team-tactics monorepo

Three composable packages, each building on the one below (a DAG; `tics` is the shared
foundation both upper layers depend on directly):

- **`packages/tics`** → `@ttics/tics` — the **tic protocol**: the coordination bus, emit,
  reader (`tics log/inbox/conductor/claims/sections/cycle/gate/claim-check`, `--all`). Method-agnostic.
- **`packages/tdd`** → `@ttics/tdd` — **test-driven agent pairing**: the phase×layer gate,
  the pair roles, the inner loop. *Uses `@ttics/tics`.*
- **`packages/team-tactics`** → `team-tactics` — the **full team process**: the outer loop
  (PO/architect/qa/PM/dev-ops), sectioning, the release gate, the composing installer.
  *Uses `@ttics/tdd` + `@ttics/tics`.*

Progressive adoption: `npx tics` (protocol only) → `npx @ttics/tdd` (+ pairing) → `npx team-tactics` (+ outer loop).
