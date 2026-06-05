"use strict";
// tic protocol: emit_tic + tic.sh (emit); run-suite -> signal tic; guard -> block tic.
// Sandbox style of resolver.test.js / runsuite.test.js.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const KIT_HOOKS = path.join(require("@ttics/tdd").KIT, "hooks");

function sandbox(testCmd) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-tic-"));
  const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
  for (const h of ["lib.sh", "run-suite.sh", "guard-edit-scope.sh", "subagent-handoff.sh"]) {
    const src = path.join(KIT_HOOKS, h);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(sh, h));
  }
  const TICS_HOOKS = path.join(require("@ttics/tics").KIT, "hooks");
  for (const h of ["tic.sh", "tics-lib.sh"]) fs.copyFileSync(path.join(TICS_HOOKS, h), path.join(sh, h));
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

test("run-suite folds TYPECHECK_CMD into the signal (tests green + typecheck red => red)", () => {
  const d = sandbox("true");                                  // tests pass
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), '\nTYPECHECK_CMD="false"\n');  // typecheck fails
  try {
    fire(d, "run-suite.sh", edit("src/x.js"));
    const sig = ticsOf(d).filter((x) => x.kind === "signal").pop();
    assert.strictEqual(sig.result, "red", "typecheck failure makes a vitest-green cycle red");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("run-suite stays green when tests AND TYPECHECK_CMD both pass", () => {
  const d = sandbox("true");
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), '\nTYPECHECK_CMD="true"\n');
  try {
    fire(d, "run-suite.sh", edit("src/x.js"));
    const sig = ticsOf(d).filter((x) => x.kind === "signal").pop();
    assert.strictEqual(sig.result, "green");
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

test("emit_tic auto-fills scope from .claude/state/scope (default '*')", () => {
  const d = sandbox();
  try {
    srcLib(d, `emit_tic a b note "no scope set"`);
    assert.strictEqual(ticsOf(d)[0].scope, "app"); // no scope file -> defaults to the layer
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "pair:S2\n");
    srcLib(d, `emit_tic a b note "scoped"`);
    assert.strictEqual(ticsOf(d).pop().scope, "pair:S2");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("subagent-handoff (SubagentStop) auto-emits a handoff tic with the suite result", () => {
  const d = sandbox();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "suite-status"), "green\n");
    const r = fire(d, "subagent-handoff.sh", "");
    assert.strictEqual(r.status, 0, r.stderr);
    const t = ticsOf(d).pop();
    assert.strictEqual(t.kind, "handoff");
    assert.strictEqual(t.from, "subagent");
    assert.strictEqual(t.to, "orchestrator");
    assert.strictEqual(t.result, "green");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("emit_tic scope: falls back to '*' only when neither scope nor layer is set", () => {
  const d = sandbox();
  try {
    fs.rmSync(path.join(d, ".claude", "state", "layer"));
    srcLib(d, `emit_tic a b note "no layer, no scope"`);
    assert.strictEqual(ticsOf(d)[0].scope, "*");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("emit_tic honors TICS_SCOPE — per-call scope override for fan-out branches", () => {
  const d = sandbox();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "frontend\n");
    srcLib(d, "export TICS_SCOPE='explore/ranking'; emit_tic explorer '*' note 'mapped ranking' ranking");
    assert.strictEqual(ticsOf(d).pop().scope, "explore/ranking", "TICS_SCOPE overrides the scope file");
    srcLib(d, "emit_tic explorer '*' note 'again' ranking");
    assert.strictEqual(ticsOf(d).pop().scope, "frontend", "falls back to the scope file when TICS_SCOPE is unset");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tic.sh passes TICS_SCOPE through to the recorded tic (the fan-out idiom)", () => {
  const d = sandbox();
  try {
    const r = cp.spawnSync("bash", ["-c", "TICS_SCOPE='explore/ui' '" + d + "/.claude/hooks/tic.sh' explorer '*' note 'mapped ui' ui"], { encoding: "utf8", cwd: d });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(ticsOf(d).pop().scope, "explore/ui");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("emit_tic honors TICS_DIR — a shared spool bus across roots (worktree sections)", () => {
  const d = sandbox();
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "tt-bus-"));
  try {
    const r = srcLib(d, "export TIC_STORE=spool; export TICS_DIR='" + shared + "'; emit_tic inv-pair '*' contract 'StockLevel' StockLevel");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readdirSync(shared).filter((f) => f.endsWith(".json")).length, 1, "tic written to the shared bus");
    assert.ok(!fs.existsSync(path.join(d, ".claude", "state", "tics.d")), "nothing in the per-root spool");
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(shared, { recursive: true, force: true }); }
});

test("tic.sh accepts the commit kind (a VCS landing event)", () => {
  const d = sandbox();
  try {
    const r = cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "tic.sh"), "git", "*", "commit", "landed abc on main", "abc"], { encoding: "utf8", cwd: d });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(ticsOf(d).pop().kind, "commit");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tic.sh rejects an unknown kind — no noise in the log, lists the valid set", () => {
  const d = sandbox();
  try {
    const r = cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "tic.sh"), "a", "b", "frontend:green", "oops"], { encoding: "utf8", cwd: d });
    assert.notStrictEqual(r.status, 0, "non-zero exit on a bad kind");
    assert.match(r.stderr, /delegate handoff signal/i, "lists the valid kinds");
    let t = [];
    try { t = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) {}
    assert.ok(!t.some((x) => x.kind === "frontend:green"), "bogus kind not recorded");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tic.sh refuses a read-shaped call (no garbage emit; points to the reader)", () => {
  const d = sandbox();
  try {
    const r = cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "tic.sh"), "implementer", "inbox", "--scope", "frontend"], { encoding: "utf8", cwd: d });
    assert.notStrictEqual(r.status, 0, "non-zero exit on a read-shaped call");
    assert.match(r.stderr, /\.claude\/hooks\/tics|to read/i, "points to the reader");
    assert.doesNotMatch(r.stderr, /tics --scope/, "doesn't echo the bad arg as the example");
    let t = [];
    try { t = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); } catch (e) {}
    assert.ok(!t.some((x) => x.kind === "inbox" || x.kind === "--scope"), "no read-shaped garbage recorded");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
