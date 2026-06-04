"use strict";
// tic protocol: emit_tic + tic.sh (emit); run-suite -> signal tic; guard -> block tic.
// Sandbox style of resolver.test.js / runsuite.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const KIT_HOOKS = path.join(__dirname, "..", "kit", "claude-config", "hooks");

function sandbox(testCmd) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-tic-"));
  const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
  for (const h of ["lib.sh", "tic.sh", "run-suite.sh", "guard-edit-scope.sh"])
    fs.copyFileSync(path.join(KIT_HOOKS, h), path.join(sh, h));
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"),
    `LAYERS="app"\nALL_TEST_CMD=${JSON.stringify(testCmd || "true")}\nTEST_CMD_app="$ALL_TEST_CMD"\n`);
  fs.writeFileSync(path.join(st, "phase"), "green\n");
  fs.writeFileSync(path.join(st, "layer"), "app\n");
  return d;
}
const ticsOf = (d) => fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const srcLib = (d, s) => cp.spawnSync("bash", ["-c", `. "${d}/.claude/hooks/lib.sh"; ${s}`], { encoding: "utf8", cwd: d });
const fire = (d, hook, payload) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", hook)], { input: payload || "", encoding: "utf8", cwd: d });
const edit = (p) => JSON.stringify({ tool_input: { file_path: p } });

test("emit_tic appends a valid, auto-filled tic; seq increments", () => {
  const d = sandbox();
  try {
    assert.strictEqual(srcLib(d, `emit_tic implementer orchestrator handoff "made it green" src/x.js green`).status, 0);
    let t = ticsOf(d);
    assert.deepStrictEqual([t[0].seq, t[0].kind, t[0].from, t[0].to, t[0].result, t[0].phase, t[0].layer],
                           [1, "handoff", "implementer", "orchestrator", "green", "green", "app"]);
    assert.match(t[0].ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    srcLib(d, `emit_tic orchestrator test-writer delegate "next slice" S2`);
    t = ticsOf(d);
    assert.strictEqual(t.length, 2); assert.strictEqual(t[1].seq, 2); assert.strictEqual(t[1].kind, "delegate");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("emit_tic escapes quotes in msg (valid JSON)", () => {
  const d = sandbox();
  try { assert.strictEqual(srcLib(d, `emit_tic a b note 'he said "hi" now'`).status, 0);
        assert.match(ticsOf(d)[0].msg, /he said "hi" now/); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tic.sh wrapper appends a slack-like msg tic", () => {
  const d = sandbox();
  try {
    const r = cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "tic.sh"), "navigator", "architect", "msg", "use option B"], { encoding: "utf8", cwd: d });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(ticsOf(d)[0].kind, "msg"); assert.strictEqual(ticsOf(d)[0].to, "architect");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("run-suite emits a signal tic (subsumes telemetry): green carries exit/duration", () => {
  const d = sandbox("true");
  try {
    fire(d, "run-suite.sh", edit("src/x.js"));
    const sig = ticsOf(d).pop();
    assert.strictEqual(sig.kind, "signal"); assert.strictEqual(sig.from, "run-suite");
    assert.strictEqual(sig.result, "green"); assert.strictEqual(sig.exit, 0);
    assert.strictEqual(typeof sig.durationSec, "number");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("run-suite signal tic: red carries a nonzero exit", () => {
  const d = sandbox("false");
  try {
    fire(d, "run-suite.sh", edit("src/x.js"));
    const sig = ticsOf(d).pop();
    assert.strictEqual(sig.kind, "signal"); assert.strictEqual(sig.result, "red"); assert.notStrictEqual(sig.exit, 0);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("guard emits a block tic on exit 2, and nothing on an allowed edit", () => {
  const d = sandbox();
  try {
    const blocked = fire(d, "guard-edit-scope.sh", edit("tests/x.test.js")); // phase=green blocks test edit
    assert.strictEqual(blocked.status, 2);
    let t = ticsOf(d);
    assert.strictEqual(t[t.length - 1].kind, "block");
    assert.strictEqual(t[t.length - 1].from, "guard");
    const n = t.length;
    const allowed = fire(d, "guard-edit-scope.sh", edit("src/x.js"));
    assert.strictEqual(allowed.status, 0);
    assert.strictEqual(ticsOf(d).length, n, "no tic on an allowed edit");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
