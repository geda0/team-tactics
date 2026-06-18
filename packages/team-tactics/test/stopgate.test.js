"use strict";
// P2-13: require-green-to-stop RE-VERIFIES a cached red before blocking. A stale
// suite-status (a fix landed without re-firing run-suite) must not trap the loop;
// a genuinely red suite must still block.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const KIT_HOOKS = path.join(require("@ttics/tdd").KIT, "hooks");

function sandbox(testCmd) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-stop-"));
  const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
  for (const h of ["lib", "tics-lib", "require-green-to-stop", "solo-drift-check"]) {
    const src = path.join(KIT_HOOKS, h + ".sh");
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sh, h + ".sh"));
  }
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"),
    `LAYERS="app"\nALL_TEST_CMD=${JSON.stringify(testCmd)}\nTEST_CMD_app="$ALL_TEST_CMD"\n`);
  fs.writeFileSync(path.join(st, "layer"), "app\n");
  return d;
}
const set = (d, k, v) => fs.writeFileSync(path.join(d, ".claude", "state", k), v + "\n");
const status = (d) => fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim();
const fire = (d, env) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "require-green-to-stop.sh")],
  { encoding: "utf8", input: "", env: Object.assign({}, process.env, env || {}) });

test("P2-13: cached red but suite now GREEN -> re-verify allows stop + corrects status", () => {
  const d = sandbox("sh -c 'exit ${STOP_FAIL:-0}'");
  try {
    set(d, "phase", "green"); set(d, "suite-status", "red");
    const r = fire(d, { STOP_FAIL: "0" });
    assert.strictEqual(r.status, 0, "a stale red must not trap a green suite:\n" + r.stderr);
    assert.strictEqual(status(d), "green", "suite-status corrected to green");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-13: cached red AND suite still red -> blocks (exit 2)", () => {
  const d = sandbox("sh -c 'exit ${STOP_FAIL:-0}'");
  try {
    set(d, "phase", "green"); set(d, "suite-status", "red");
    const r = fire(d, { STOP_FAIL: "1" });
    assert.strictEqual(r.status, 2, "a genuinely red suite must still block");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-13: re-verify actually RE-RUNS the suite (not just trusting the cache)", () => {
  const d = sandbox("touch reverified.sentinel");
  try {
    set(d, "phase", "refactor"); set(d, "suite-status", "red");
    fire(d, {});
    assert.ok(fs.existsSync(path.join(d, "reverified.sentinel")), "the suite was re-run");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-13: red phase with a red suite still allows stop (no re-verify needed)", () => {
  const d = sandbox("sh -c 'exit 1'");
  try {
    set(d, "phase", "red"); set(d, "suite-status", "red");
    assert.strictEqual(fire(d, {}).status, 0, "a red bar in red phase is correct");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// N10: solo-drift accountability backstop. A Stop hook that, when full-team is installed and the
// orchestrator has logged substantial cycles (>= SOLO_DRIFT_CYCLES signals since session-started)
// with ZERO handoffs (subagents auto-emit those on return), prints a NON-blocking NOTE nudging it
// to delegate. Silent when a handoff exists (engaged), when full-team isn't installed (minimal), or
// when opted out (TEAM_ACCOUNTABILITY=0). Fail-open: no product-owner.md marker -> silent.
const MARKER = "2026-06-10T00:00:00Z";        // session-started; seeded tics are AFTER this
const TIC_TS = "2026-06-10T01:00:00Z";          // every seeded tic's ts (>= marker -> counts)
const tic = (seq, kind, from) =>
  JSON.stringify({ ts: TIC_TS, seq, kind, from, to: "*", msg: kind + " event" }) + "\n";
const appendTic = (d, seq, kind, from) =>
  fs.appendFileSync(path.join(d, ".claude", "state", "tics.jsonl"), tic(seq, kind, from));
const installFullTeam = (d) => {
  const ad = path.join(d, ".claude", "agents");
  fs.mkdirSync(ad, { recursive: true });
  fs.writeFileSync(path.join(ad, "product-owner.md"), "# product-owner\n");
};
const fireSolo = (d, env) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "solo-drift-check.sh")],
  { cwd: d, encoding: "utf8", input: "", env: Object.assign({}, process.env, env || {}) });

test("N10: solo-drift backstop trips on full-team + cycles + 0 handoffs; silent when engaged / minimal / opted-out", () => {
  const NUDGE = /solo|team|delegat/i;

  // (a) TRIP: full-team installed + 3 signal tics after the marker + 0 handoffs -> non-blocking NOTE.
  let d = sandbox("true");
  try {
    set(d, "session-started", MARKER);
    installFullTeam(d);
    appendTic(d, 1, "signal", "run-suite");
    appendTic(d, 2, "signal", "run-suite");
    appendTic(d, 3, "signal", "run-suite");
    const r = fireSolo(d, {});
    const out = r.stdout + r.stderr;
    assert.match(out, NUDGE, "(a) solo + substantial cycles + 0 handoffs must surface a delegate nudge");
    assert.strictEqual(r.status, 0, "(a) the backstop is advisory — it must not block the stop");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // (b) ENGAGED -> silent: identical seeding, but one handoff tic (after marker) proves delegation.
  d = sandbox("true");
  try {
    set(d, "session-started", MARKER);
    installFullTeam(d);
    appendTic(d, 1, "signal", "run-suite");
    appendTic(d, 2, "signal", "run-suite");
    appendTic(d, 3, "signal", "run-suite");
    appendTic(d, 4, "handoff", "subagent");
    const r = fireSolo(d, {});
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, NUDGE, "(b) a handoff means the orchestrator delegated — no nudge");
    assert.strictEqual(r.status, 0, "(b) non-blocking");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // (c) MINIMAL -> silent: no product-owner.md, so full-team isn't installed; same cycles, 0 handoffs.
  d = sandbox("true");
  try {
    set(d, "session-started", MARKER);
    appendTic(d, 1, "signal", "run-suite");
    appendTic(d, 2, "signal", "run-suite");
    appendTic(d, 3, "signal", "run-suite");
    const r = fireSolo(d, {});
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, NUDGE, "(c) solo-by-design (no full team installed) must stay silent");
    assert.strictEqual(r.status, 0, "(c) non-blocking");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // (e) OPT-OUT -> silent: otherwise-tripping seeding, but TEAM_ACCOUNTABILITY=0 in tdd.config.
  d = sandbox("true");
  try {
    set(d, "session-started", MARKER);
    installFullTeam(d);
    appendTic(d, 1, "signal", "run-suite");
    appendTic(d, 2, "signal", "run-suite");
    appendTic(d, 3, "signal", "run-suite");
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "TEAM_ACCOUNTABILITY=0\n");
    const r = fireSolo(d, {});
    const out = r.stdout + r.stderr;
    assert.doesNotMatch(out, NUDGE, "(e) opting out of accountability must silence the backstop");
    assert.strictEqual(r.status, 0, "(e) non-blocking");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("GT-1: solo-drift NOTE fires on NARRATED handoffs — it must count REAL subagent handoffs (from=subagent), not orchestrator-narrated ones", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "drift-"));
  try {
    const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state"), ag = path.join(d, ".claude", "agents");
    fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true }); fs.mkdirSync(ag, { recursive: true });
    for (const h of ["lib", "solo-drift-check"]) fs.copyFileSync(path.join(KIT_HOOKS, h + ".sh"), path.join(sh, h + ".sh")); // solo-drift needs lib.sh; lib sources tics-lib conditionally (absent here = fine)
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nALL_TEST_CMD="true"\nTEST_CMD_app="true"\n');
    fs.writeFileSync(path.join(ag, "product-owner.md"), "x");                 // full team installed
    fs.writeFileSync(path.join(st, "session-started"), "2026-06-17T00:00:00Z");
    const ts = "2026-06-17T01:00:00Z", tics = [];
    for (let i = 0; i < 4; i++) tics.push({ kind: "signal", from: "run-suite", to: "*", result: "green", ts });
    for (let i = 0; i < 3; i++) tics.push({ kind: "handoff", from: (i % 2 ? "test-writer" : "orchestrator"), to: "orchestrator", result: "green", ts }); // NARRATED, zero real subagent handoffs
    fs.writeFileSync(path.join(st, "tics.jsonl"), tics.map((t) => JSON.stringify(t)).join("\n") + "\n");
    const r = cp.spawnSync("bash", [path.join(sh, "solo-drift-check.sh")], { encoding: "utf8", input: "" });
    assert.strictEqual(r.status, 0, "advisory hook always exits 0");
    assert.match(r.stderr, /wasn't engaged/i, "NARRATED handoffs must NOT satisfy the detector — the NOTE must fire");
    fs.appendFileSync(path.join(st, "tics.jsonl"), JSON.stringify({ kind: "handoff", from: "subagent", to: "orchestrator", result: "green", ts }) + "\n");
    const r2 = cp.spawnSync("bash", [path.join(sh, "solo-drift-check.sh")], { encoding: "utf8", input: "" });
    assert.doesNotMatch(r2.stderr, /wasn't engaged/i, "a REAL subagent handoff means the team WAS engaged — no NOTE");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("GT-2: pre-push surfaces the release gate on a v* tag push — RELEASE_GATE_ENFORCE=1 blocks a failing gate; default warns (exit 0); a passing gate never blocks", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-"));
  try {
    const sh = path.join(d, ".claude", "hooks");
    fs.mkdirSync(sh, { recursive: true });
    fs.copyFileSync(path.join(require("@ttics/tdd").KIT, "githooks", "pre-push"), path.join(d, "pre-push"));
    // a fake release-gate CLI: exits with $FAKE_GATE_RC (1 = BLOCKED) regardless of args
    fs.writeFileSync(path.join(sh, "tics"), "#!/bin/sh\nexit ${FAKE_GATE_RC:-0}\n");
    fs.chmodSync(path.join(sh, "tics"), 0o755);
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\n');
    const refline = "refs/tags/v1.0.0 1111111111111111111111111111111111111111 refs/tags/v1.0.0 1111111111111111111111111111111111111111\n";
    const run = (env) => cp.spawnSync("sh", [path.join(d, "pre-push"), "origin", "https://example/repo.git"], { cwd: d, input: refline, encoding: "utf8", env: Object.assign({}, process.env, env) });
    const blocked = run({ FAKE_GATE_RC: "1", RELEASE_GATE_ENFORCE: "1" });
    assert.notStrictEqual(blocked.status, 0, "RELEASE_GATE_ENFORCE=1 + a BLOCKED gate must block the tag push");
    assert.match(blocked.stderr, /release gate/i, "blocked push must explain the release gate");
    const warned = run({ FAKE_GATE_RC: "1" });
    assert.strictEqual(warned.status, 0, "default is advisory — a BLOCKED gate warns but does not block the push");
    assert.match(warned.stderr, /release gate/i, "advisory path must still mention the release gate");
    const ok = run({ FAKE_GATE_RC: "0", RELEASE_GATE_ENFORCE: "1" });
    assert.strictEqual(ok.status, 0, "a satisfied gate never blocks, even with enforce on");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("GT-3: guard-edit-scope blocks edits to SECURITY_GLOB-matching files even in phase=off, unless SECURITY_REVIEW=1", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "secguard-"));
  try {
    const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
    fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
    for (const h of ["lib", "guard-edit-scope"]) fs.copyFileSync(path.join(KIT_HOOKS, h + ".sh"), path.join(sh, h + ".sh"));
    fs.writeFileSync(path.join(sh, "tics-lib.sh"), "emit_tic() { :; }\n"); // stub the bus emitter — GT-3 tests the security glob, not emission
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nTEST_GLOB="\\\\.test\\\\."\nSECURITY_GLOB="(^|/)(auth|secrets)/"\n');
    fs.writeFileSync(path.join(st, "phase"), "off\n");   // gate DISARMED — security must still apply
    fs.writeFileSync(path.join(st, "layer"), "app\n");
    const payload = (file) => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } });
    const run = (file, env) => cp.spawnSync("bash", [path.join(sh, "guard-edit-scope.sh")], { cwd: d, input: payload(file), encoding: "utf8", env: Object.assign({}, process.env, env) });
    const blocked = run("src/auth/login.js", {});
    assert.strictEqual(blocked.status, 2, "a SECURITY_GLOB match must be blocked even in phase=off");
    assert.match(blocked.stderr, /security/i, "the block must name the security surface");
    const reviewed = run("src/auth/login.js", { SECURITY_REVIEW: "1" });
    assert.strictEqual(reviewed.status, 0, "SECURITY_REVIEW=1 permits the sensitive edit");
    const ok = run("src/util/format.js", {});
    assert.strictEqual(ok.status, 0, "non-sensitive paths are untouched by the security guard");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("GT-2b: pre-push fails CLOSED on a v* tag push when RELEASE_GATE_ENFORCE=1 but no .claude/hooks/tics reader is present (no silent fail-open); default stays exit 0", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-noreader-"));
  try {
    fs.mkdirSync(path.join(d, ".claude", "hooks"), { recursive: true });
    fs.copyFileSync(path.join(require("@ttics/tdd").KIT, "githooks", "pre-push"), path.join(d, "pre-push"));
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\n'); // note: NO .claude/hooks/tics installed
    const refline = "refs/tags/v1.0.0 1111111111111111111111111111111111111111 refs/tags/v1.0.0 1111111111111111111111111111111111111111\n";
    const run = (env) => cp.spawnSync("sh", [path.join(d, "pre-push"), "origin", "https://example/repo.git"], { cwd: d, input: refline, encoding: "utf8", env: Object.assign({}, process.env, env) });
    const enforcedNoReader = run({ RELEASE_GATE_ENFORCE: "1" });
    assert.notStrictEqual(enforcedNoReader.status, 0, "RELEASE_GATE_ENFORCE=1 with no release-gate reader must FAIL CLOSED, not silently pass");
    assert.match(enforcedNoReader.stderr, /release gate/i, "the fail-closed block must explain the missing release gate");
    const advisoryNoReader = run({});
    assert.strictEqual(advisoryNoReader.status, 0, "advisory mode (no enforce) must not block a push just because the reader isn't installed");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("GT-2c: RELEASE_GATE=0 set in tdd.config skips the release gate (config-settable, not env-only) — even under RELEASE_GATE_ENFORCE=1 with a BLOCKED gate", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-skip-"));
  try {
    const sh = path.join(d, ".claude", "hooks");
    fs.mkdirSync(sh, { recursive: true });
    fs.copyFileSync(path.join(require("@ttics/tdd").KIT, "githooks", "pre-push"), path.join(d, "pre-push"));
    fs.writeFileSync(path.join(sh, "tics"), "#!/bin/sh\nexit 1\n"); // release gate ALWAYS reports BLOCKED
    fs.chmodSync(path.join(sh, "tics"), 0o755);
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nRELEASE_GATE=0\n'); // skip knob set in CONFIG, not env
    const refline = "refs/tags/v1.0.0 1111111111111111111111111111111111111111 refs/tags/v1.0.0 1111111111111111111111111111111111111111\n";
    const r = cp.spawnSync("sh", [path.join(d, "pre-push"), "origin", "https://example/repo.git"], { cwd: d, input: refline, encoding: "utf8", env: Object.assign({}, process.env, { RELEASE_GATE_ENFORCE: "1" }) });
    assert.strictEqual(r.status, 0, "RELEASE_GATE=0 in tdd.config must skip the gate entirely — the documented config knob must actually work, even under enforce + a BLOCKED gate");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("RS-1: the guard does not treat /dev/null as a write target — 2>/dev/null is allowed in red; a real source redirect is still blocked", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devnull-"));
  try {
    const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
    fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
    for (const h of ["lib", "guard-edit-scope"]) fs.copyFileSync(path.join(KIT_HOOKS, h + ".sh"), path.join(sh, h + ".sh"));
    fs.writeFileSync(path.join(sh, "tics-lib.sh"), "emit_tic() { :; }\n"); // stub the bus emitter — RS-1 tests redirect parsing, not emission
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nTEST_GLOB="\\\\.test\\\\."\n');
    fs.writeFileSync(path.join(st, "phase"), "red\n");   // the loop is in RED — only TEST files may be edited
    fs.writeFileSync(path.join(st, "layer"), "app\n");
    const payload = (cmd) => JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } });
    const run = (cmd) => cp.spawnSync("bash", [path.join(sh, "guard-edit-scope.sh")], { cwd: d, input: payload(cmd), encoding: "utf8", env: Object.assign({}, process.env) });

    // (1) `2>/dev/null` is an fd redirect to a SINK, not a source edit — the paper-cut: this is ALLOWED in red.
    const r1 = run("npm test 2>/dev/null");
    assert.strictEqual(r1.status, 0, "2>/dev/null is a sink, not a write target — running a command with it in red must be allowed:\n" + r1.stderr);

    // (2) an explicit redirect to /dev/null is still a sink — ALLOWED in red.
    const r2 = run("echo hi > /dev/null");
    assert.strictEqual(r2.status, 0, "a redirect to /dev/null discards output — never a source edit, so red must allow it:\n" + r2.stderr);

    // (3) CONTROL: a real source redirect in red is still REFUSED — proves the fix doesn't disable detection.
    const r3 = run("echo x > src/app.js");
    assert.strictEqual(r3.status, 2, "a redirect into source in red must still be blocked — /dev/* leniency must not blind the guard to real writes");
    assert.match(r3.stderr, /BLOCKED|refused/i, "the real-source block must explain itself");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CTX-6: guard surfaces `tics where` crumbs at edit-time when CONTEXT_MAP=1 (advisory, never blocks)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ctxmap-"));
  try {
    const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
    fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
    for (const h of ["lib", "guard-edit-scope"]) fs.copyFileSync(path.join(KIT_HOOKS, h + ".sh"), path.join(sh, h + ".sh"));
    fs.writeFileSync(path.join(sh, "tics-lib.sh"), "emit_tic() { :; }\n"); // stub the bus emitter — CTX-6 tests the hint, not emission
    // FAKE reader: `tics where src/auth.ts` echoes a crumb; any other path echoes nothing. Never the real reader.
    fs.writeFileSync(path.join(sh, "tics"), '#!/bin/sh\nif [ "$1" = "where" ]; then case "$2" in *auth*) echo "  caveat $2 — watch out W (clone first)";; esac; fi\nexit 0\n');
    fs.chmodSync(path.join(sh, "tics"), 0o755);
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nTEST_GLOB="\\\\.test\\\\."\n');
    fs.writeFileSync(path.join(st, "phase"), "off\n");   // gate DISARMED — the edit itself is allowed; we test the hint
    fs.writeFileSync(path.join(st, "layer"), "app\n");
    const payload = (file) => JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file } });
    const run = (file, env) => cp.spawnSync("bash", [path.join(sh, "guard-edit-scope.sh")], { cwd: d, input: payload(file), encoding: "utf8", env: Object.assign({}, process.env, env) });

    // (1) CONTEXT_MAP=1 + a path with a crumb -> the crumb is surfaced on stderr, and the hint never blocks.
    const hinted = run("src/auth.ts", { CONTEXT_MAP: "1" });
    assert.match(hinted.stderr, /watch out W/, "CONTEXT_MAP=1 must surface the `tics where` crumb for the edited path on stderr");
    assert.strictEqual(hinted.status, 0, "the context hint is advisory — it must NEVER block the edit (exit 0)");

    // (2) CONTEXT_MAP=1 + a path with NO crumb -> silent (the reader returns nothing).
    const noCrumb = run("src/other.ts", { CONTEXT_MAP: "1" });
    assert.doesNotMatch(noCrumb.stderr, /watch out W/, "a path with no crumb must stay silent");
    assert.strictEqual(noCrumb.status, 0, "no crumb, no block");

    // (3) CONTEXT_MAP unset -> gated off, silent even for a path that HAS a crumb.
    const off = run("src/auth.ts", {});
    assert.doesNotMatch(off.stderr, /watch out W/, "CONTEXT_MAP unset must gate the hint off entirely");
    assert.strictEqual(off.status, 0, "the gated-off path never blocks");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// PD-1 (ADR 0005, amended): the every-prompt full-framework directive flips to DEFAULT-ON (opt-out),
// reversing the prior default-OFF. Real-adopter evidence drove it — a session obeyed the once-read
// SessionStart directive 0/2 and had to be corrected by hand. So the UserPromptSubmit hook now injects
// the directive EVERY prompt UNLESS opted out (PROMPT_DIRECTIVE=0, via env or tdd.config), while keeping
// the CI auto-silence (no every-prompt noise in automated/non-interactive runs). The hook reads no stdin;
// it sources <ROOT>/.claude/tdd.config and prints the directive to STDOUT. RED today: line 11 is
// `[ "${PROMPT_DIRECTIVE:-0}" = "1" ] || exit 0` — unset PROMPT_DIRECTIVE exits silently, so stdout is empty.
function pdSandbox(extraConfig) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-pd-"));
  fs.mkdirSync(path.join(d, ".claude", "hooks"), { recursive: true });
  fs.copyFileSync(path.join(KIT_HOOKS, "prompt-directive.sh"), path.join(d, ".claude", "hooks", "prompt-directive.sh"));
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\n' + (extraConfig || ""));
  return d;
}
// CI:"" clears any ambient CI var so the test isn't auto-silenced by the CI guard.
const firePD = (d, env) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "prompt-directive.sh")],
  { encoding: "utf8", input: "", env: Object.assign({}, process.env, { CI: "" }, env || {}) });

test("PD-1: the every-prompt full-framework directive is DEFAULT-ON (opt-out); silent only on PROMPT_DIRECTIVE=0 or CI", () => {
  const DIR = /full framework/i;
  const dirs = [];
  const mk = (extraConfig) => { const d = pdSandbox(extraConfig); dirs.push(d); return d; };
  try {
    // (1) DEFAULT ON: a sandbox with NO PROMPT_DIRECTIVE set, CI cleared -> the directive is injected.
    const onByDefault = firePD(mk());
    assert.match(onByDefault.stdout, DIR, "with PROMPT_DIRECTIVE unset, the directive must inject by DEFAULT");
    assert.strictEqual(onByDefault.status, 0, "the directive hook is advisory — it exits 0:\n" + onByDefault.stderr);

    // (2) OPT-OUT via env: PROMPT_DIRECTIVE=0 silences the injection.
    const optOutEnv = firePD(mk(), { PROMPT_DIRECTIVE: "0" });
    assert.doesNotMatch(optOutEnv.stdout, DIR, "PROMPT_DIRECTIVE=0 (env) must opt out — no directive");

    // (3) OPT-OUT via config: PROMPT_DIRECTIVE=0 in tdd.config is honored the same way.
    const optOutCfg = firePD(mk("PROMPT_DIRECTIVE=0\n"));
    assert.doesNotMatch(optOutCfg.stdout, DIR, "PROMPT_DIRECTIVE=0 in tdd.config must opt out — no directive");

    // (4) CI auto-silence: even default-on, an automated/non-interactive run injects nothing.
    const inCI = firePD(mk(), { CI: "1" });
    assert.doesNotMatch(inCI.stdout, DIR, "CI must auto-silence the every-prompt directive even when default-on");
  } finally { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); }
});
