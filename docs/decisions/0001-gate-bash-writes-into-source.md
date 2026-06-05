# 0001 — Gate Bash writes into source (close the referee bypass)

- Status: Accepted
- Date: 2026-06-05
- Feature: B1 (see `.claude/state/design-notes.md`)
- Deciders: architect (seam), product-owner (scope)
- Scope: `@ttics/tdd` kit (`guard-edit-scope.sh`), `team-tactics` installer
  (`settings.json` merge + `selftest`).

## Context

The product's core promise is "the hooks are the referee — scope edits by
phase×layer." The PreToolUse guard `guard-edit-scope.sh` enforces it. But the
matcher in `packages/tdd/kit/settings.json` is `Edit|Write|MultiEdit` **only**,
and the guard reads the target from `.tool_input.file_path // .tool_input.path`.

An agent can therefore write source straight through the **Bash** tool —
`cat > src/x.ts <<EOF`, `echo … >> src/x.ts`, `tee src/x.ts` — and the guard is
never invoked. This was observed live (an agent wrote source via a heredoc in a
phase where source edits should have been blocked). It is the single largest
remaining hole in the core guarantee.

Part of the residual is irreducible: Claude Code surfaces the Bash *command
string*, not its effects, so any **indirect** write — `sed -i`, `python -c '…'`,
a helper script that writes, a redirect hidden inside a subshell or `eval` we
cannot read statically — is invisible to a PreToolUse hook. But the **common,
deliberate** bypass — a redirect or `tee` into a guarded path — is right there in
the command string and *is* detectable. B1 catches that and documents the rest
honestly.

### Two facts about the existing guard that shape this decision

1. **The file_path branch is allowlist / block-by-default.** In `red`, the rule
   is *"if it is not a test and not a doc, BLOCK"* (it does **not** test
   `SRC_GLOB`); in `green`, *"if it is a test, BLOCK."* That default-deny posture
   is safe for `Edit|Write` because every such call is unambiguously a write to
   exactly one named path.

2. **A Bash command is not a write.** The overwhelming majority of Bash calls are
   reads/builds/tests (`ls`, `git status`, `grep foo src/x.ts`, `cat src/x.ts`,
   `pnpm test`). Carrying the file_path branch's default-deny posture over to Bash
   would block all of those and make the agent unusable.

The Bash branch therefore **inverts the default**: allow unless we positively
detect a write-redirection into a gated path. The bias is **prefer
false-NEGATIVE** — never block a legitimate read/build/test; an exotic missed
write is an accepted, documented boundary.

## Decision

### 1. Guard input contract — one script, dual payload (the seam)

`guard-edit-scope.sh` stays the single entry point and branches on `.tool_name`.
The PreToolUse payload carries `tool_name` plus a `tool_input` whose shape is
tool-specific:

- `Edit | Write | MultiEdit` → `tool_input.file_path` (or `.path`) — **one path**.
- `Bash` → `tool_input.command` — **a shell command string**.

Contract:

```
PreToolUse payload
├─ tool_name : "Edit" | "Write" | "MultiEdit" | "Bash" | …
└─ tool_input
   ├─ file_path | path   (Edit/Write/MultiEdit)   → existing branch, UNCHANGED
   └─ command            (Bash)                    → new branch, ADDITIVE
```

**The existing file_path branch is byte-identical in behavior.** Today the guard
extracts `P` and, if `P` is empty, `exit 0`. We keep that exactly:

- When `tool_name` is empty/unknown but `file_path`/`path` is present (the current
  behavior, and what every existing test fires), the file_path branch runs as it
  does now. The `is_test` / `is_doc` / `is_adr` / phase `case` / `claim_guard`
  logic is untouched.
- The Bash branch is reached **only** when no `file_path`/`path` was extracted
  **and** `tool_name == "Bash"` **and** a write target is detected in the command.
  If a Bash command writes nothing detectable, the guard falls through to the
  existing `[ -z "$P" ] && exit 0` and allows it. **Reads are never blocked.**

This is purely additive: existing tests (which send `{tool_input:{file_path}}`
with no `tool_name`) take the identical path and identical exit codes.

### 2. Write-detection heuristic + the explicit bias

Over the Bash command string, detect the three common write constructs and
extract their target path token(s):

| Construct        | Example                          | Target token         |
|------------------|----------------------------------|----------------------|
| truncate redirect | `cat foo > src/x.ts`            | `src/x.ts`           |
| append redirect   | `echo x >> src/x.ts`            | `src/x.ts`           |
| `tee`             | `… | tee src/x.ts`, `tee -a a b`| each non-flag arg    |

Extraction (heuristic, intentionally conservative):

- For `>` / `>>`: take the **first whitespace-delimited token after the operator**,
  for every occurrence (a command may have several). Tolerate fd-qualified and
  no-space forms (`>file`, `1>file`, `2>&1` must NOT be treated as a path —
  `&`-targets and pure-numeric fd dups are ignored).
- For `tee`: take the **non-flag word arguments** to `tee` (skip `-a`, `--append`,
  other `-…` flags); `tee` writes each of them.
- Strip surrounding quotes from a token. A token containing an unexpanded `$`
  variable or glob metacharacter we cannot resolve is treated as **non-matching**
  (we do not guess — that preserves the false-negative bias).

Then, **for each extracted target, apply the SAME logic the Write path applies to
that path**: run it through `is_doc`/`is_adr`, then the phase `case` against
`is_test` (which uses `TEST_GLOB`). Concretely, a Bash write to `T` is treated as
if it were a `Write` with `file_path = T`:

- `red`  + `T` is a non-doc, non-test path → **BLOCK (exit 2)** — same verdict a
  `Write` to `T` gets in red.
- `green` + `T` matches `TEST_GLOB` → **BLOCK (exit 2)** — the symmetric bypass
  (writing tests via Bash while source-only).
- `off` → **ALLOW** (gate disarmed).
- `T` is a doc (`*.md`/`*.mdx`/`docs/**`) → **ALLOW** in any phase (same exemption
  as the Write path; claims still apply).
- If **any** detected target warrants a block, the command is blocked (a single
  command must not smuggle a guarded write past the gate by bundling it with a
  benign one).

**Bias — prefer false-NEGATIVE (load-bearing):**

- A command with no detected write target is **always allowed**. This explicitly
  covers `ls`, `git status`, `grep foo src/x.ts`, `cat src/x.ts` (no redirect),
  `pnpm test`, `node -e '…'` with no redirect, etc.
- A target we cannot statically resolve (variable/glob/computed path) is treated as
  non-matching → allowed. We never block on a guess.
- This intentionally **misses** indirect writes (see Boundary). That is the
  accepted cost of never blocking a legitimate read/build/test command. "A blocked
  `git status` is not acceptable; a missed `sed -i` is."

### 3. Matcher placement (installer)

Add a **second** `PreToolUse` entry to `packages/tdd/kit/settings.json` with
matcher `"Bash"`, wired to the same `guard-edit-scope.sh`:

```json
"PreToolUse": [
  { "matcher": "Edit|Write|MultiEdit",
    "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-edit-scope.sh" } ] },
  { "matcher": "Bash",
    "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/guard-edit-scope.sh" } ] }
]
```

A separate entry (rather than folding Bash into the existing matcher regex) keeps
the two intents legible and lets the run-suite/PostToolUse matcher stay
`Edit|Write|MultiEdit` (we do **not** want to run the suite after every `ls`).

The installer's `mergeSettings` (cli.js ~200) is already idempotent and
matcher-agnostic: it replaces every kit group (`isKit` = a group whose hook
command contains `.claude/hooks/`) per event and re-concatenates the kit's groups,
preserving non-kit (user) groups and all non-`hooks` top-level keys. Adding a
second kit group under `PreToolUse` flows through unchanged — on re-install the old
kit `PreToolUse` groups are dropped and both fresh ones re-added; user groups and
keys survive. **No installer logic change is required; an installer test must lock
the invariant** (both kit matchers present after merge; a user-added PreToolUse
group and a user top-level key both preserved; a second install is a no-op
diff).

### 4. jq-optional

The Bash branch must degrade without `jq`, exactly as the file_path branch does
(cli.js selftest and real adopters run both with and without jq).

- **With jq:** `command -v jq` →
  `tool_name = .tool_name // empty`,
  `cmd = .tool_input.command // empty`.
- **Without jq:** extract the command string with the same grep/sed style already
  used for `file_path`. `.tool_input.command` is a JSON string, so a single-line
  payload yields it via a `"command"\s*:\s*"…"` match; the value must then be
  **JSON-unescaped minimally** (`\"` → `"`, `\\` → `\`, `\n`/`\t` are rare in a
  redirect target and may remain literal — they only risk a false-negative, which
  the bias permits). `tool_name` extracts the same way
  (`"tool_name"\s*:\s*"([^"]+)"`).

The detection regexes over the command string are pure grep/sed and need no jq.
Heredoc bodies can contain arbitrary text; matching `>`/`>>`/`tee` over the whole
string can in principle pick a token out of heredoc content — that risks at most a
false-POSITIVE on a contrived heredoc, which the implementer should guard against
where cheap (e.g. matching the redirect target as a path-shaped token) but which
is bounded by the "operator-then-token" shape and is a documented residual, not a
correctness bug.

### 5. The documented boundary (state it honestly)

The guard catches **direct, statically-visible write redirections** (`>`, `>>`,
`tee`) into a guarded path. It does **NOT** catch writes that are invisible in the
command string:

- in-place editors: `sed -i …`, `perl -i`, `ex`/`ed` scripts;
- interpreter writes: `python -c 'open(...).write(...)'`, `node -e 'fs.writeFile…'`;
- a helper **script** that writes (`./gen.sh`, `make`), or `xargs`/`find -exec`;
- a redirect hidden inside `eval`, command substitution, or a subshell whose body
  we cannot statically resolve;
- a target computed from a variable/glob.

This is a **Claude Code / static-analysis limitation**: a PreToolUse hook sees the
command, not its effects. The boundary is recorded in a guard comment and in the
tdd-workflow doc so adopters are never told the gate is airtight. The honest claim
is: *"the gate makes the common deliberate bypass fail closed; it is a referee, not
a sandbox."* The Stop/PostToolUse green-gate remains the backstop that catches the
*result* of an indirect write that breaks the suite.

## Consequences

- **Positive.** The common, deliberate bypass (heredoc/redirect/`tee` into source
  or — in green — into tests) now fails closed, with the same verdict and `block`
  tic as a `Write`. One script, one heuristic; no new dependency; jq-optional
  preserved. The installer change is one additive matcher; merge stays idempotent.
  Adopters can confirm it in their own environment via two new `selftest` checks.
- **Negative / accepted.** Indirect writes are still possible (documented). The
  heuristic carries a small false-POSITIVE surface (redirect-like tokens inside
  heredoc bodies / unusual quoting) — mitigated by the operator-then-path-token
  shape and bounded by the deliberate false-negative bias. The guard now parses an
  arbitrary command string, a larger attack surface for odd inputs than a single
  `file_path`; it must fail **open** (allow) on any parse it cannot make sense of,
  never crash the tool.
- **Selftest.** `team-tactics`/`@ttics/tdd` selftest gains: (a) phase=red, a Bash
  redirect into `src/…` → exit 2; (b) a read-only Bash (`grep …`/`cat src/…` with
  no redirect) → exit 0. These extend the existing synthetic-payload harness; the
  `edit()` helper gains a `bash(cmd)` sibling: `{tool_name:"Bash",tool_input:{command:cmd}}`.

## Alternatives considered

- **Block Bash by default in red/green (default-deny, like file_path).** Rejected:
  it blocks `ls`/`git status`/test runs — the agent becomes unusable. The whole
  point of the bias is that Bash is read-dominated.
- **Fold `Bash` into the existing `Edit|Write|MultiEdit` matcher regex.** Rejected:
  it couples two different intents and would also drag the PostToolUse run-suite
  matcher toward firing on reads if mirrored. A second, explicit entry is clearer.
- **A separate `guard-bash-scope.sh` script.** Rejected: the phase×layer +
  is_test/is_doc/is_adr/claim logic must stay identical to the Write verdict;
  duplicating it invites drift. Reuse the one script, share the verdict logic.
- **Full shell parsing (a real tokenizer / `bash -n` AST).** Rejected: no
  dependency budget, and it still cannot see *effects* (`sed -i`, scripts), so it
  would not change the boundary — only add fragility.
- **Sandbox / FS-level enforcement (PostToolUse diff, write-protect the tree).**
  Out of scope for B1 and a different mechanism; the PostToolUse green-gate already
  catches the *consequences* of an undetected write. Note as possible future work.
