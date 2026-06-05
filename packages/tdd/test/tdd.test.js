"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const { installTdd } = require("..");
const inst = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-t-")); installTdd(d); fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nALL_TEST_CMD="true"\nTEST_CMD_app="true"\n'); fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n"); return d; };
const fire = (d, h, p) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", h)], { input: p || "", cwd: d, encoding: "utf8" });
const edit = (f) => JSON.stringify({ tool_input: { file_path: f } });
const ph = (d, v) => fs.writeFileSync(path.join(d, ".claude", "state", "phase"), v + "\n");

test("installTdd composes the tics protocol + lays the gate, roles, docs", () => {
  const d = inst();
  try {
    for (const f of ["lib.sh", "tics-lib.sh", "guard-edit-scope.sh", "run-suite.sh", "require-green-to-stop.sh"]) assert.ok(fs.existsSync(path.join(d, ".claude", "hooks", f)), f);
    for (const a of ["test-writer", "implementer", "tdd-critic", "planner"]) assert.ok(fs.existsSync(path.join(d, ".claude", "agents", a + ".md")), a);
    assert.ok(fs.existsSync(path.join(d, "docs", "tdd", "tdd-workflow.md")));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("the gate enforces phase×layer", () => {
  const d = inst();
  try {
    ph(d, "red");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 2);
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("tests/x.test.js")).status, 0);
    ph(d, "green");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("tests/x.test.js")).status, 2);
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("B1: the guard gates Bash write-redirections into guarded paths, but NEVER blocks reads", () => {
  const d = inst();
  const bash = (cmd) => JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd } });
  const g = (payload) => fire(d, "guard-edit-scope.sh", payload).status;
  try {
    ph(d, "red");
    // BLOCK — writing source via a Bash redirect (the observed live bypass):
    assert.strictEqual(g(bash("cat > src/x.ts <<'EOF'\nhi\nEOF")), 2, "red: heredoc redirect into src is blocked");
    assert.strictEqual(g(bash("echo x >> src/x.ts")), 2, "red: append redirect into src is blocked");
    // ALLOW — reads must NEVER be blocked (allow-by-default for Bash):
    assert.strictEqual(g(bash("git status")), 0, "read-only Bash allowed");
    assert.strictEqual(g(bash("grep foo src/x.ts")), 0, "grep (no redirect) allowed");
    assert.strictEqual(g(bash("cat src/x.ts")), 0, "bare cat (no redirect) allowed");
    assert.strictEqual(g(bash("pnpm test 2>&1 | tail")), 0, "fd-dup 2>&1 is not a write target");
    assert.strictEqual(g(bash('echo x > "$OUT"')), 0, "unresolved $var target -> allow (false-negative bias)");
    assert.strictEqual(g(bash("echo note > docs/x.md")), 0, "redirect into a doc allowed in any phase");
    // symmetric in green: a Bash-written TEST is blocked; a Bash-written source is fine
    ph(d, "green");
    assert.strictEqual(g(bash("cat > x.test.js <<'EOF'\nt\nEOF")), 2, "green: writing a TEST via Bash is blocked (tests frozen)");
    assert.strictEqual(g(bash("tee src/y.ts")), 0, "green: writing SOURCE via Bash is allowed");
    // off disarms
    ph(d, "off");
    assert.strictEqual(g(bash("cat > src/x.ts")), 0, "off: Bash write allowed");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MS2: under MULTI_SESSION=1 the guard refuses an UNSCOPED edit (forces a scope so claims coordinate)", () => {
  const d = inst();
  try {
    ph(d, "green");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "");                 // no scope
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 0, "single-session (default): unscoped edit allowed");
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nMULTI_SESSION=1\n");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 2, "multi-session: an UNSCOPED edit is BLOCKED");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "sessA/feature\n");   // scope it
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 0, "multi-session + scoped: allowed (claims now engage)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("the gate lets docs/ADRs be edited in red (they have no failing test to write first)", () => {
  const d = inst();
  try {
    ph(d, "red");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("docs/decisions/0005-foo.md")).status, 0, "an ADR is editable in red");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("README.md")).status, 0, "a markdown doc is editable in red");
    assert.strictEqual(fire(d, "guard-edit-scope.sh", edit("src/x.js")).status, 2, "real source is still gated in red");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("solo coupling: creating an ADR auto-emits a contract tic (no scope/parallelism needed), once", () => {
  const d = inst();
  const adr = "docs/decisions/0001-foo.md";
  const contracts = () => {
    const f = path.join(d, ".claude", "state", "tics.jsonl");
    if (!fs.existsSync(f)) return [];
    return fs.readFileSync(f, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } }).filter((x) => x.kind === "contract" && x.ref === adr);
  };
  try {
    ph(d, "green");
    fire(d, "guard-edit-scope.sh", edit(adr));                 // ADR does NOT exist yet => creation
    assert.strictEqual(contracts().length, 1, "creating an ADR publishes a contract");
    fs.mkdirSync(path.join(d, "docs", "decisions"), { recursive: true });
    fs.writeFileSync(path.join(d, adr), "# decision");          // now it exists
    fire(d, "guard-edit-scope.sh", edit(adr));                 // a later edit must NOT re-contract
    assert.strictEqual(contracts().length, 1, "editing an existing ADR does not re-publish");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("honest green: run-suite auto-detects the project's typecheck; a tsc-red fails a tests-green signal", () => {
  const d = inst();   // tdd.config has a passing suite (TEST_CMD_app="true") and NO TYPECHECK_CMD
  try {
    // a project that declares its own typecheck script — controllable via TC_FAIL
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "x", scripts: { typecheck: "sh -c 'exit ${TC_FAIL:-0}'" } }));
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "green\n");
    const runEnv = (env) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "run-suite.sh")], { input: "", cwd: d, encoding: "utf8", env: { ...process.env, ...env } });
    runEnv({ TC_FAIL: "0" });
    assert.strictEqual(fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim(), "green", "tests + typecheck both pass -> green");
    runEnv({ TC_FAIL: "1" });
    assert.strictEqual(fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim(), "red", "tests pass but typecheck fails -> honest RED (auto-detected, no TYPECHECK_CMD set)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("red-storm breaker: run-suite counts consecutive reds and emits a `stuck` tic at the limit (resets on green)", () => {
  const d = inst();
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nRED_STREAK_LIMIT=3\nALL_TEST_CMD="sh -c \'exit ${SUITE_FAIL:-0}\'"\nTEST_CMD_app="sh -c \'exit ${SUITE_FAIL:-0}\'"\n');
  const busOf = () => { const f = path.join(d, ".claude", "state", "tics.jsonl"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } }) : []; };
  const stucks = () => busOf().filter((x) => x.kind === "stuck");
  const streak = () => { const f = path.join(d, ".claude", "state", "red-streak"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "0"; };
  const run = (env) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "run-suite.sh")], { input: "", cwd: d, encoding: "utf8", env: { ...process.env, ...env } });
  try {
    ph(d, "green");
    run({ SUITE_FAIL: "1" }); run({ SUITE_FAIL: "1" });        // 2 reds — under the limit
    assert.strictEqual(stucks().length, 0, "no stuck warning under the limit");
    assert.strictEqual(streak(), "2", "streak counts consecutive reds");
    run({ SUITE_FAIL: "1" });                                  // 3rd red — hits RED_STREAK_LIMIT
    assert.strictEqual(stucks().length, 1, "a stuck tic is emitted at the limit");
    run({ SUITE_FAIL: "0" });                                  // a green run
    assert.strictEqual(streak(), "0", "green clears the red streak");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("red-storm breaker: the Stop hook escalates to 'suspected contradictory test' when the streak is high", () => {
  const d = inst();
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nRED_STREAK_LIMIT=3\nALL_TEST_CMD="false"\nTEST_CMD_app="false"\n');
  try {
    ph(d, "green");
    fs.writeFileSync(path.join(d, ".claude", "state", "suite-status"), "red\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "red-streak"), "5\n");      // a long red run
    const r = fire(d, "require-green-to-stop.sh", "");
    assert.strictEqual(r.status, 2, "still blocks on a red bar");
    assert.match(r.stderr, /over-constrained|contradictory/i, "escalates: the test itself may be the problem, don't grind");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
test("run-suite records status + emits a signal tic (composed with tics)", () => {
  const d = inst();
  try {
    ph(d, "green"); fire(d, "run-suite.sh", "");
    assert.strictEqual(fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim(), "green");
    const sig = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((x) => x.kind === "signal");
    assert.ok(sig.length >= 1, "signal tic emitted");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
