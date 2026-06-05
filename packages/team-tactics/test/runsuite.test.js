"use strict";
// P2-10: run-suite skips the suite (and telemetry) for an edit that matches no
// layer glob — editing a README/config/doc must not trigger a test run.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const KIT_HOOKS = path.join(__dirname, "..", "kit", "claude-config", "hooks");

function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-runsuite-"));
  const sh = path.join(d, ".claude", "hooks");
  const st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true });
  fs.mkdirSync(st, { recursive: true });
  fs.copyFileSync(path.join(KIT_HOOKS, "lib.sh"), path.join(sh, "lib.sh"));
  fs.copyFileSync(path.join(KIT_HOOKS, "run-suite.sh"), path.join(sh, "run-suite.sh"));
  // A test command that DROPS A SENTINEL so we can detect whether the suite ran.
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"),
    `LAYERS="app"\nALL_TEST_CMD="touch ran.sentinel"\nTEST_CMD_app="$ALL_TEST_CMD"\n`);
  fs.writeFileSync(path.join(st, "layer"), "app\n");
  fs.writeFileSync(path.join(st, "phase"), "green\n");
  return d;
}
function fire(d, stdin) {
  return cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "run-suite.sh")],
    { input: stdin, encoding: "utf8" });
}
const ran = (d) => fs.existsSync(path.join(d, "ran.sentinel"));
const has = (d, f) => fs.existsSync(path.join(d, ".claude", "state", f));
const edit = (p) => JSON.stringify({ tool_input: { file_path: p } });

test("P2-10: a non-matching edit (README) skips the suite + emits no telemetry/status", () => {
  const d = sandbox();
  try {
    const r = fire(d, edit("README.md"));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(!ran(d), "suite must NOT run for README.md");
    assert.ok(!has(d, "telemetry.jsonl"), "no telemetry for a skipped run");
    assert.ok(!has(d, "suite-status"), "no suite-status for a skipped run");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-10: a matching source edit (src/...) runs the suite", () => {
  const d = sandbox();
  try { fire(d, edit("src/app.js")); assert.ok(ran(d), "suite must run for src/app.js"); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-10: a matching test edit (tests/...) runs the suite", () => {
  const d = sandbox();
  try { fire(d, edit("tests/app.test.js")); assert.ok(ran(d), "suite must run for a test file"); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-10: no path on stdin -> suite still runs (backward compatible)", () => {
  const d = sandbox();
  try { fire(d, ""); assert.ok(ran(d), "empty stdin must not suppress the suite"); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});
