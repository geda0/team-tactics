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
