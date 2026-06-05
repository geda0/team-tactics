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
test("run-suite records status + emits a signal tic (composed with tics)", () => {
  const d = inst();
  try {
    ph(d, "green"); fire(d, "run-suite.sh", "");
    assert.strictEqual(fs.readFileSync(path.join(d, ".claude", "state", "suite-status"), "utf8").trim(), "green");
    const sig = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((x) => x.kind === "signal");
    assert.ok(sig.length >= 1, "signal tic emitted");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
