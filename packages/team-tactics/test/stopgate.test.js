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
  for (const h of ["lib", "require-green-to-stop"])
    fs.copyFileSync(path.join(KIT_HOOKS, h + ".sh"), path.join(sh, h + ".sh"));
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
