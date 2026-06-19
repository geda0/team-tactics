# 0021 — A zero-dependency browser-QA smoke verdict for `qa-verifier`: a PURE marker predicate over a SYSTEM-BROWSER render, with an honest no-browser path

- **Status:** **Accepted** — shipped in v0.66.0, built test-first through the phase×layer gate (suite green;
  tdd-critic PASS; live-proven against a real running app). **SHIPPED rungs:** `browser` / `none` / `timeout` /
  `render-error` / `refused-nonloopback` (every unobserved rung downgrades to `concerns`; never a false pass).
  **DEFERRED to a follow-up (NOT in v0.66.0):** the **`curl` SSR fallback rung (`renderer=curl-ssr`)** of §2
  below — the design records it, but it was deferred with the rest of the hardening (slices 4, 5, 16, 21);
  where this ADR describes `curl-ssr` it describes intended design, not shipped behavior. Also added during the
  build (not in the original §2): `--disable-background-networking` + companions and a "use the captured stdout
  even past the deadline" rule in `spawnRender`, both found by driving the helper at a live app. Build queue:
  `.claude/state/plan.md`.
- **Date:** 2026-06-18
- **Deciders:** architect (the load-bearing move — the **0020 visual-work split applied to QA**: a pure
  `evaluateMarkers(dom, expected)` predicate as the TDD-able core, and a thin irreducible render side-effect
  behind a fake-able seam; rendering "shells out exactly like the framework already shells out to
  git/node/bash," so it is *not* a new dependency class), navigator (the honesty model — a smoke verdict
  answers ONE question, "did it boot and render the acceptance markers," and the no-render branch must emit
  `concerns`, **never a false `pass`**; the verdict is read newest-per-feature in `tics log`/`cycle` exactly
  as any reviewer verdict), product-owner (the scope discipline — markers come from the feature's
  `design-notes.md` acceptance bullets; this closes the one real CAPABILITY gap without buying gstack's
  interaction-automation SCOPE, and the verdict stays self-reported, surfaced in ACCEPT, gate-able by
  judgment but never auto-promoted to a hook-signed signal), tdd-critic (**SOUND WITH CHANGES** — three
  findings, all **verified live on this machine**, are folded into the decision below: the SPA timing trap,
  the macOS discovery miss, and side-effect/security hardening).
- **Relates to:** a direct application of **0020** (TDD discipline is a directive; the visual-work
  predicate/pixel split) — the predicate is the `snowsToday(date)` of QA, the browser launch is the
  irreducible pixel side-effect. Inherits **0009** (the honest gate) — a `verdict` is self-reported /
  unrefereed, classified by `from`, never a hook-signed gate signal. Sits beside **0019** (context-map
  learned crumbs) on the same escalation ladder — the cheap unrefereed tier that FEEDS, never replaces, the
  durable hook-signed suite result; **reuses** the existing `verdict` kind, **adds no new tic kind**. Honors
  **0018** (Cursor parity, three tiers) — the helper is a portable Bash-callable script + bus emit
  (tier-1/2), not a CC-only PreToolUse hook. Honors **0010** (capability-aware execution) — `qa-verifier` is
  an opus "judgment" role; the *render* it invokes is "mechanics," isolated behind a seam.
  **Supersedes nothing.**

## Context

**The gap: GREEN suite, unrendered app — a verdict with no eyes.** `qa-verifier`
(`packages/team-tactics/kit/presets/full-team/agents/qa-verifier.md`, tools `Read, Bash, Grep, Glob`, model
`opus`) is a read-only outer-loop role that emits a `verdict` tic (`pass`/`concerns`/`block`) against the
feature's acceptance bullets in the ACCEPT step. But it has **no concrete browser mechanism**: with only
`Bash`/`curl` it fetches bytes, not a JS-rendered DOM. For a client-rendered app the markup `curl` returns is
an empty shell — the acceptance content is painted by JavaScript `curl` never runs. So today the role
hand-waves or quietly leans on the green suite. That is exactly how a visual **"always-on"** bug shipped:
every unit test green, the suite signed off, and a one-line predicate over the rendered DOM would have caught
it on sight. This is the project's **single real capability gap**; the gstack comparison showed everything
else gstack "wins" is deliberately-traded SCOPE.

**The constraint that shapes the design: zero-dep is the identity, not a preference.** team-tactics is a
zero-runtime-dependency Node+bash framework. gstack pays for browser QA with Playwright, a 58 MB Bun binary,
and a daemon. The instant team-tactics adds an npm dep, a bundled binary, or a daemon, it stops being the
auditable zero-dep thing and becomes a worse gstack — **disqualified before evaluation, on identity**. The
framework already shells out to `git`/`node`/`bash` as ambient tools it doesn't own; rendering a DOM via a
headless browser **the user already has** is the same move at the same trust level.

**The shape this implies: split the pure predicate from the pixels (0020), reuse the verdict (0019).** QA is
visual work, so the verdict decomposes into a pure `dom × expected-markers → result` predicate (unit-tested
core) and a thin "launch a browser, dump the DOM" seam (irreducible effect). The output rides the **existing
`verdict` kind**. Every decision below is "which existing primitive does this reuse," not "what new subsystem
does this add."

## Decision

Ship a **browser-QA smoke verdict** for `qa-verifier`: a pure marker predicate run over a DOM obtained from a
**system browser the user already has** (with a labelled `curl` SSR fallback and an honest no-render→`concerns`
path), emitting the **existing `verdict` tic**. The role's tool list is unchanged; the helper ships in the
full-team preset; the verdict stays self-reported and unrefereed.

### 1. Scope is a SMOKE VERDICT, not interaction automation
The capability answers exactly one question: *did the app boot and render the acceptance-critical markers?* —
open the URL, get the rendered DOM, check the expected markers are present. It is **not** click-flows, form
fills, multi-step journeys, or stateful interaction (gstack's Playwright bet, out of scope **by design**). It
is the highest-value, lowest-cost rung: it would have caught the "always-on" regression at no dependency cost.

### 2. Rendering: SYSTEM browser → `curl` SSR fallback → honest `concerns` (zero new deps)
The seam obtains a DOM by the first available rung, shelling out only to ambient tools:

1. **System headless browser.** Discover a browser via a **tiered probe** — *(verified live: PATH-only
   discovery found nothing on this macOS box despite Chrome 149 installed; macOS binaries are essentially
   never on PATH)*:
   - (a) explicit override `$TT_BROWSER` / config;
   - (b) PATH names: `google-chrome chromium chromium-browser chrome google-chrome-stable msedge`;
   - (c) standard per-OS install paths — macOS `/Applications/*.app/Contents/MacOS/*` (incl. `Google Chrome`,
     `Chromium`, `Microsoft Edge`), Linux distro paths (`/usr/bin/google-chrome`, `/usr/bin/chromium`,
     `/snap/bin/chromium`, …), Windows `Program Files\...\chrome.exe` / Edge. Edge (Chromium) supports the
     same flags and is the realistic Windows fallback.

   Render with `<browser> --headless=new --disable-gpu --dump-dom <url>` **plus
   `--virtual-time-budget=<ms>` (default 2000)** — *(verified live: plain `--dump-dom` captures the DOM
   BEFORE deferred JS runs; a marker injected after a 300 ms `setTimeout` was ABSENT without the budget and
   PRESENT with `--virtual-time-budget=2000`. The naked command would false-FAIL essentially every
   React/Vue/Svelte SPA — the inverse of the bug it exists to prevent)*.
   `--run-all-compositor-stages-before-draw` is harmless to add. This is a `spawn` of an ambient binary,
   identical in kind to the existing `git`/`node`/`bash` shell-outs.
   - **`--dump-dom` is not a stable public CLI contract** (it changed once in the old→`new` headless
     migration). Zero-dep means owning that risk: pin behavior with the env-guarded self-test (slice 24), and
     treat a malformed/empty dump as `concerns`, never `pass`.
   - *(verified live)* **Read stdout ONLY** — stderr is ERROR-spammy and non-fatal on macOS
     (`CVDisplayLinkCreateWithCGDisplay failed`). **Never wrap with `timeout`/`gtimeout`** (absent on macOS);
     enforce the deadline with a **node-side `child_process` kill timer**.
2. **`curl` SSR fallback.** When no browser is discoverable and the app is server-rendered, `curl -fsSL <url>`
   yields a DOM. `curl` is **NOT a graceful degrade for a JS app — it is a different measurement** (source
   HTML, no JS). It is the **labelled** SSR fallback only, never the primary path; the headline carries
   `renderer=curl-ssr` so an SSR pass is never mistaken for a JS-rendered pass.
3. **Honest no-render path.** When neither a browser nor a usable `curl` render is available, emit
   **`concerns`**, never `pass`, with the headline: *"no headless browser available; markers unverified —
   install Chrome/Chromium or run SSR to enable the smoke check."* **A false `pass` is the one outcome the
   design forbids.**

Every verdict headline names which rung produced the DOM (`renderer=browser` / `renderer=curl-ssr` /
`renderer=none`).

### 3. The pure predicate + its seam — `evaluateMarkers`, unit-tested without a real browser
```
evaluateMarkers(dom, expectedMarkers) -> { present[], missing[], verdict }
```
- `dom` is a string; `expectedMarkers` is the list derived from the acceptance bullets. Matching is plain
  **visible-text substring — case-insensitive, whitespace-normalized, tag-tolerant — NO CSS selectors and NO
  DOM parser in v1** (selectors tempt a parser = dependency; cut to a v2 maybe). Decision table: **all
  present → `pass`; none present → `block` (didn't boot); some present → `concerns`; empty marker list →
  `concerns`.**
- *(verified live)* **"Markers missing" is `concerns`, NOT `block`** when the app rendered something — a smoke
  test cannot distinguish "genuinely broken" from "rendered too slow" past the timing budget, so it must not
  emit the strongest negative ruling. **`block` is reserved for "app did not boot at all"** (empty/whitespace
  DOM, non-2xx, connection refused) — the unambiguous case.
- No launch, no fetch, no clock, no filesystem — its own `evaluatemarkers.test.js`, red→green.

**The render is the seam.** `renderDom(url, opts)` performs the §2 ladder and is the only part touching the
outside world. Wiring is `renderDom` (effect) → `evaluateMarkers` (pure) → emit (effect); the pure core is
tested by injecting a fake renderer. **Discovery (`findBrowser`) is LOGIC, not I/O** — make it a pure-ish
function with injected probes (`onPath`, `exists`) and unit-test it, because discovery is where the real bugs
live (the macOS miss). The real `renderDom`/`spawnRender` (kill timer, stdout-only, `mktemp -d` profile) is
thin enough to leave un-unit-tested, exercised only by ONE env-guarded integration self-test.

### 4. Reuse the `verdict` tic — NO new kind
Output is the existing `verdict` kind (`pass`/`concerns`/`block`), emitted via
`.claude/hooks/tic.sh qa-verifier '*' verdict "<headline>"`. It flows into `tics log`/`tics cycle` and the
ACCEPT step exactly as any verdict does — no schema change, no projection/reader change, no new keyspace.
The headline self-describes confidence: `renderer=<browser|curl-ssr|none>`, marker tally `markers n/m`, and
(for a browser run) `budget=<ms>` — so a curl-fallback or timing-limited run is never read as a gate-grade
browser `pass`.

### 5. Markers come from the feature's `design-notes.md` acceptance bullets
`expectedMarkers` are the feature's own acceptance-critical visible text, taken from the acceptance bullets and
passed to the helper by `qa-verifier`. The predicate stays generic ("is this string present in this DOM"); the
verdict stays honest to the current spec. Markers should be **distinctive acceptance phrases, not single
common words** — substring matching can collide (`"Live"` in `"Olive oil"` or a loading skeleton);
word-boundary-ish matching mitigates but text-contains is not exact, and the design says so rather than
pretending.

### 6. Where the helper lives, how it ships, and that the tool list is UNCHANGED
Ships in the full-team preset (`packages/team-tactics/kit/presets/full-team/scripts/smoke-verify.cjs` —
mirrors the `.cjs` precedent of `tics-view.cjs`), a Bash-callable script exporting the pure `evaluateMarkers`
+ `findBrowser` + the thin `renderDom` seam, runnable as `node smoke-verify.cjs <url> <marker…>`. Delivered by
the same preset-copy as `agents/ docs/ state/` (a `scripts/` dir is added to the copy set), so present
wherever full-team is installed and absent on `--minimal` (no `qa-verifier`). The role already has `Bash`; it
gets a short **recipe**, not a new tool/kind/permission. **Portability (0018):** Bash-callable script + bus
emit, not a CC-only hook → works for Cursor too.

### 7. The verdict is SELF-REPORTED / unrefereed (0009)
A smoke verdict is `qa-verifier`'s observation, `from`-attributed but not hook-signed. It does not become a
gate signal; only the run-suite hook signs the trusted green-bar. It is read and weighed in ACCEPT (a
human/orchestrator may act on a `block`), but is never auto-promoted and a smoke `pass` never substitutes for
the suite. **Security hardening (verified concern):** force an **ephemeral throwaway profile**
`--user-data-dir=$(mktemp -d)` so the role never touches the user's real cookies/sessions/extensions, and
**restrict the target to loopback** (`localhost`/`127.0.0.1`/`::1`) by default — a QA smoke test has no
business fetching `http://evil.example` in a real browser (otherwise an attacker influencing `design-notes.md`
markers or the runbook URL gets SSRF-with-JS-execution via the QA role). Non-loopback only behind an explicit
opt-in flag. `--no-sandbox` is added **only** when a root/CI env is detected (sandboxed Chrome refuses to
start as root), never hardcoded on a dev laptop.

## Consequences

- **The GREEN-suite-unrendered-app gap closes with zero dependencies** — the "always-on" class of bug is now
  catchable by a one-call smoke check using a browser the user already has.
- **Identity preserved — a shell-out, not a dependency.** No npm package, no bundled binary, no daemon. The
  render is a `spawn` of an ambient binary, same trust as the existing `git`/`node`/`bash` shell-outs; the
  helper is a few-hundred-line readable script.
- **The judgment is TDD-covered; the pixels are thin (0020 dogfooded).** `evaluateMarkers` and `findBrowser`
  land red→green with injected fakes; the suite never depends on a real browser. Discovery is explicitly
  pulled OUT of the "thin side-effect" bucket and tested, because that is where the verified bug lived.
- **No new tic kind, no reader/projection change.** Rides the existing `verdict` kind and surfaces. Cost: one
  preset helper + one test family + one recipe — a projection-over-what-exists.
- **Honesty is structural.** The no-render branch *cannot* emit a false `pass`; every verdict names its render
  rung and marker tally; `curl-ssr` is labelled non-JS. "Markers missing on a booted app" is demoted to
  `concerns` so a timing-limited render does not false-`block`.
- **Portable to Cursor (0018)** — Bash-callable script + bus emit, no CC-only boundary.
- **Cost, honestly stated.** The ongoing cost is **owning the `--dump-dom`/flag-stability risk** and the
  discovery matrix across macOS/Linux/Windows — real maintenance, not zero. Render coverage is best-effort: it
  depends on a system browser being present (else honest `concerns`), on a marker not slower than the timing
  budget, and on well-chosen distinctive markers — all surfaced honestly rather than hidden.

## Out of scope (explicitly rejected or deferred)

- **Click-flows / interaction automation / multi-step journeys** — gstack's Playwright bet; out of scope by
  design.
- **Playwright / Puppeteer / any npm or browser-automation dependency** — disqualified on identity, a line not
  to cross.
- **A bundled browser binary (gstack's 58 MB Bun)** — rejected; use the user's browser or honestly say we
  cannot verify.
- **A long-lived render daemon / browser-server** — rejected; each check is a one-shot `--dump-dom` spawn that
  exits, like a `git log` call.
- **Making the smoke verdict a HARD gate / hook-signed signal** — rejected (0009); read and weighed in
  ACCEPT, never auto-promoted, a smoke `pass` never substitutes for the suite, a smoke `block` never
  mechanically halts the loop.
- **Screenshots / visual-diff / pixel comparison** — deferred (binary artifacts, baselines, thresholds =
  heavier mechanism); the DOM-marker smoke verdict is the high-value first rung, and the predicate/seam split
  leaves room for a later ADR.
- **A markup parser / DOM library dependency** — rejected; `evaluateMarkers` works over the DOM **string**, no
  parser, no dep.
- **CSS-selector matching** — cut from v1 (selectors tempt a parser/`querySelector` = dependency);
  **text-substring markers only**. A v2 maybe.

## Alternatives considered

- **(a) Bundle Playwright/Puppeteer** — rejected; npm dep (+ downloaded browsers), disqualified on identity,
  buys unwanted interaction-automation.
- **(b) Long-lived render daemon** — rejected; stateful background process contradicts the stateless shell-out
  model.
- **(c) `curl`-only / no-JS rendering** — rejected as primary; it is the status quo that left the gap (no JS =
  empty shell for SPAs). Kept as the labelled SSR fallback only.
- **(d) CC-only PreToolUse render hook** — rejected on portability (CC-only, no Cursor equivalent) and fit (QA
  is an ACCEPT-step invoked check, not an edit-time interception).
- **(e) Hosted / remote headless-browser service** — rejected; network dep, credentials, egress, third-party
  trust, fails offline and on private apps.
- **(f) Make a `qa` green a Stop-gate** — rejected (0009); promoting an unrefereed observation to a hook-signed
  gate lets a smoke `pass` masquerade as the suite.
- **(g) Hard-code per-app markers in the helper/role** — rejected; couples a generic helper to specific
  features and rots when criteria change. Markers come from each feature's `design-notes.md` (§5).
