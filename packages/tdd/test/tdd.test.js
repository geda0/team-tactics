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
test("run-suite records status + emits a signal tic (composed with tics)", () => {
  const d = inst();
  try {
    ph(d, "green"); fire(d, "run-suite.sh", "");
    assert.strictEqual(fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim(), "green");
    const sig = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((x) => x.kind === "signal");
    assert.ok(sig.length >= 1, "signal tic emitted");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
