"use strict";
// P2-10: run-suite skips the suite (and telemetry) for an edit that matches no
// layer glob — editing a README/config/doc must not trigger a test run.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const KIT_HOOKS = path.join(require("@ttics/tdd").KIT, "hooks");

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

// E12-3 (ADR 0013): a self-contained install for the opt-in PostToolUse witness hook.
// Copies lib.sh + tool-witness.sh from the tdd kit and tic.sh + tics-lib.sh from the tics
// kit so emit_tic can write the bus (the run-suite sandbox above never needs emit_tic).
function witnessSandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-witness-"));
  const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
  for (const h of ["lib.sh", "tool-witness.sh"]) {
    const src = path.join(KIT_HOOKS, h);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(sh, h)); fs.chmodSync(path.join(sh, h), 0o755); }
  }
  const TICS_HOOKS = path.join(require("@ttics/tics").KIT, "hooks");
  for (const h of ["tic.sh", "tics-lib.sh"]) fs.copyFileSync(path.join(TICS_HOOKS, h), path.join(sh, h));
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), `LAYERS="app"\nALL_TEST_CMD="true"\nTEST_CMD_app="$ALL_TEST_CMD"\n`);
  fs.writeFileSync(path.join(st, "phase"), "green\n");
  fs.writeFileSync(path.join(st, "layer"), "app\n");
  return d;
}
const fireWitness = (d, tool) =>
  cp.spawnSync(path.join(d, ".claude", "hooks", "tool-witness.sh"), [],
    { input: JSON.stringify({ tool_name: tool }), encoding: "utf8", cwd: d });
const witnessNotes = (d) => {
  const f = path.join(d, ".claude", "state", "tics.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    .filter((t) => t.kind === "note" && t.from === "witness");
};

// RS-2: a hardened red-storm breaker. The old breaker emitted ONE `stuck` bus tic at exactly
// the limit (an agent grinding 32 reds never saw it — a bus tic isn't the hook's output). The fix
// surfaces an ESCALATING directive to the agent's OWN OUTPUT (stdout) every red AT/past the limit:
// at the limit it routes to fixing the test; at 2x it escalates to STOP. A green run resets the
// streak. We make the suite RESULT env-controllable (RSFAIL) so we can drive reds then a green,
// and pass env through to `fire`. The state/red-streak file persists across fires in one sandbox,
// so repeated fires build the streak.
function rsSandbox() {
  const d = sandbox();
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"),
    'LAYERS="app"\nALL_TEST_CMD="sh -c \'exit ${RSFAIL:-1}\'"\nTEST_CMD_app="$ALL_TEST_CMD"\n');
  return d;
}
function fireEnv(d, stdin, envObj) {
  return cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "run-suite.sh")],
    { input: stdin, encoding: "utf8", env: Object.assign({}, process.env, envObj) });
}
const ROUTE = /test-writer|reconsider|over-constrained/i;

test("RS-2: run-suite surfaces an escalating red-storm directive to the agent (limit -> route-to-test-writer, 2x -> STOP); green resets", () => {
  // Arrange: a single sandbox; red-streak persists across fires so reds accumulate.
  const d = rsSandbox();
  try {
    // Act: fire a RED run (RSFAIL=1) up to the limit (5).
    let fifth;
    for (let i = 0; i < 5; i++) fifth = fireEnv(d, edit("src/app.js"), { RSFAIL: "1" });
    // Assert (1): the 5th red surfaces a route-to-test-writer directive TO THE AGENT'S STDOUT.
    assert.match(fifth.stdout, ROUTE,
      "at the red-streak limit the hook's stdout must surface a directive routing to the test (test-writer/reconsider/over-constrained)");

    // Act: continue firing RED to 10 total (2x the limit).
    let tenth;
    for (let i = 0; i < 5; i++) tenth = fireEnv(d, edit("src/app.js"), { RSFAIL: "1" });
    // Assert (2): at 2x the limit the directive ESCALATES to STOP.
    assert.match(tenth.stdout, /STOP/,
      "at 2x the red-streak limit the hook's stdout must escalate to STOP");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // Green-reset: a fresh sandbox — 5 reds (directive appears), ONE green (resets streak to 0),
  // then 4 reds. The 4th post-green red is below the limit, so NO route directive yet.
  const g = rsSandbox();
  try {
    let atLimit;
    for (let i = 0; i < 5; i++) atLimit = fireEnv(g, edit("src/app.js"), { RSFAIL: "1" });
    assert.match(atLimit.stdout, ROUTE, "directive appears at the limit before the green reset");

    fireEnv(g, edit("src/app.js"), { RSFAIL: "0" }); // GREEN -> streak resets to 0

    let postGreen;
    for (let i = 0; i < 4; i++) postGreen = fireEnv(g, edit("src/app.js"), { RSFAIL: "1" });
    // Assert (3): only 4 reds since the green reset (< limit) -> no route directive.
    assert.doesNotMatch(postGreen.stdout, ROUTE,
      "a green run resets the streak — 4 reds after green is below the limit, so no directive");
  } finally { fs.rmSync(g, { recursive: true, force: true }); }
});

test("E12-3: tool-witness PostToolUse hook emits one note from=witness when TOOL_WITNESS=1; no-op when off (default)", () => {
  // ON: knob set -> exactly one witness note carrying the payload's tool_name.
  const on = witnessSandbox();
  fs.appendFileSync(path.join(on, ".claude", "tdd.config"), "\nTOOL_WITNESS=1\n");
  try {
    fireWitness(on, "Read");
    const notes = witnessNotes(on);
    assert.strictEqual(notes.length, 1, "exactly one witness note when TOOL_WITNESS=1");
    assert.strictEqual(notes[0].msg, "used Read");
  } finally { fs.rmSync(on, { recursive: true, force: true }); }

  // OFF (default, knob absent): a fast no-op — zero witness notes, exit 0.
  const off = witnessSandbox();
  try {
    const r = fireWitness(off, "Edit");
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(witnessNotes(off).length, 0, "no witness note when the knob is off (default)");
  } finally { fs.rmSync(off, { recursive: true, force: true }); }
});
