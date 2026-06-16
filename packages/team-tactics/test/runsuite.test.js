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
