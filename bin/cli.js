#!/usr/bin/env node
"use strict";

/*
 * teamentic — install/update the teamentic kit in a project.
 *
 *   npx teamentic [target]        install (default command)
 *   npx teamentic init [target]   same as above
 *   npx teamentic update [target] refresh mechanism, keep your files
 *   npx teamentic --force [target] also reset seeded (user-owned) files
 *   npx teamentic --preset full-team [target] also install the outer-loop team
 *   npx teamentic help
 *
 * Non-destructive: mechanism (agents, hooks, method docs) is refreshed; your
 * config/state/invariants are seeded once and never clobbered; existing entry
 * docs get a thin managed block while your content is preserved as an overlay.
 *
 * Pure Node, zero dependencies.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const crypto = require("crypto");

const KIT = path.join(__dirname, "..", "kit");
const CFG = path.join(KIT, "claude-config");

// ---- arg parsing --------------------------------------------------------
const argv = process.argv.slice(2);
let force = false;
const rest = [];
let preset = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--force" || a === "-f") force = true;
  else if (a === "-h" || a === "--help") rest.push("help");
  else if (a === "--preset") preset = argv[++i] || "";
  else if (a.startsWith("--preset=")) preset = a.slice(9);
  else if (a.startsWith("-")) {
    console.error("teamentic: unknown option '" + a + "'. Try `teamentic help`.");
    process.exit(2);
  } else rest.push(a);
}
if (preset !== null && preset !== "full-team" && preset !== "none") {
  console.error("teamentic: unknown preset '" + preset + "'. Known presets: full-team (or 'none' to remove).");
  process.exit(2);
}
let cmd = "init";
if (["init", "update", "help", "selftest", "report", "validate"].includes(rest[0])) cmd = rest.shift();
const target = path.resolve(rest[0] || process.cwd());

if (cmd === "help") {
  console.log(fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").split("\n").slice(0, 40).join("\n"));
  process.exit(0);
}

if (!fs.existsSync(CFG)) {
  console.error("error: kit payload not found (expected at " + KIT + ")");
  process.exit(1);
}

if (cmd === "selftest") { process.exit(selftest(target)); }
if (cmd === "report") { process.exit(report(target)); }
if (cmd === "validate") { process.exit(validateInstall(target)); }

// ---- helpers ------------------------------------------------------------
function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function say(action, file) { console.log("  " + action.padEnd(9) + file); }
function copy(src, dest) { ensureDir(path.dirname(dest)); fs.copyFileSync(src, dest); }

// ---- manifest (P0-3): track kit-owned files so updates never silently clobber ----
const PKG = require("../package.json");
const MANIFEST_REL = path.join(".claude", ".teamentic", "manifest.json");
const OLD_MANIFEST_REL = path.join(".claude", ".tdd-pairing", "manifest.json"); // pre-rename (create-tdd-pairing)
function sha256(p) { try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } catch (e) { return null; } }
const priorManifest = (() => {
  for (const rel of [MANIFEST_REL, OLD_MANIFEST_REL]) {
    try { return JSON.parse(fs.readFileSync(path.join(target, rel), "utf8")); } catch (e) { /* try next */ }
  }
  return { files: {} };
})();
const priorSha = (rel) => (priorManifest.files && priorManifest.files[rel] && priorManifest.files[rel].sha256) || null;

// P2-14: the team preset is sticky — recorded in the manifest so `update` keeps
// refreshing it without re-passing the flag. `--preset none` clears it.
const presetActive = preset === "none" ? null : (preset || priorManifest.preset || null);
const manifestFiles = {};
let backups = 0;
function record(rel, cls) { manifestFiles[rel] = { class: cls, version: PKG.version, sha256: sha256(path.join(target, rel)) }; }

// ---- version + breaking notes (P0-5) ----
function vcmp(a, b) {
  const pa = String(a || "0").split("-")[0].split(".").map(Number);
  const pb = String(b || "0").split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y ? -1 : 1; }
  return 0;
}
const BREAKING = {
  "0.4.0": [
    "tdd.config is now DATA ONLY - the resolver moved to .claude/hooks/lib.sh (refreshed). Your layer values are preserved; pre-0.4 BE_/FE_/E2E_TEST_CMD names still resolve.",
    "Empty .claude/state/phase now FAILS CLOSED (blocks edits). Use 'off' to disarm the gate for manual/non-TDD work - never leave phase empty.",
  ],
};

function refresh(src, destRel) {            // always overwrite (pure mechanism)
  const dest = path.join(target, destRel);
  if (fs.existsSync(dest)) {
    const cur = sha256(dest), rec = priorSha(destRel);
    const modified = rec ? (cur !== rec) : (cur !== sha256(src));
    if (modified) { fs.copyFileSync(dest, dest + ".bak"); say("backup", destRel + ".bak (locally modified - review before discarding)"); backups++; }
  }
  copy(src, dest); say("refresh", destRel); record(destRel, "mechanism");
}
function seedOnce(src, destRel, label) {    // copy only if absent
  const dest = path.join(target, destRel);
  if (fs.existsSync(dest) && !force) { say("keep", destRel + (label ? " (" + label + ")" : "")); }
  else { copy(src, dest); say("seed", destRel); }
  record(destRel, "data");
}

// ---- run ----------------------------------------------------------------
function ensureGitignore(targetDir) {
  const gi = path.join(targetDir, ".gitignore");
  const START = "# >>> teamentic (managed) >>>", END = "# <<< teamentic (managed) <<<";
  const block = START + "\n" +
    "# Transient kit artifacts - never commit (other state files ARE committed for continuity).\n" +
    ".claude/state/suite-status\n" +
    ".claude/state/telemetry.jsonl\n" +
    ".claude/**/*.bak\n" +
    "*.teamentic.*\n" +
    END;
  const OLD_START = "# >>> tdd-pairing (managed) >>>", OLD_END = "# <<< tdd-pairing (managed) <<<";
  let cur = ""; try { cur = fs.readFileSync(gi, "utf8"); } catch (e) {}
  let i = cur.indexOf(START), j = cur.indexOf(END), endLen = END.length;
  if (i === -1) { const oi = cur.indexOf(OLD_START), oj = cur.indexOf(OLD_END); if (oi !== -1 && oj !== -1 && oj > oi) { i = oi; j = oj; endLen = OLD_END.length; } }
  let next;
  if (i !== -1 && j !== -1 && j > i) { next = cur.slice(0, i) + block + cur.slice(j + endLen); }
  else { next = cur + (cur && !cur.endsWith("\n") ? "\n" : "") + (cur ? "\n" : "") + block + "\n"; }
  if (next !== cur) { fs.writeFileSync(gi, next); say("gitignore", ".gitignore (teamentic managed block)"); }
}

function mergeSettings(targetDir) {
  const dest = path.join(targetDir, ".claude", "settings.json");
  const kitSettings = JSON.parse(fs.readFileSync(path.join(CFG, "settings.json"), "utf8"));
  let existing = {};
  if (fs.existsSync(dest)) {
    try { existing = JSON.parse(fs.readFileSync(dest, "utf8")); }
    catch (e) { fs.copyFileSync(dest, dest + ".bak"); say("backup", ".claude/settings.json.bak (was invalid JSON)"); existing = {}; }
  }
  const isKit = (g) => g && Array.isArray(g.hooks) && g.hooks.some((h) => h && typeof h.command === "string" && h.command.indexOf(".claude/hooks/") !== -1);
  const hooks = Object.assign({}, existing.hooks || {});
  const kitHooks = kitSettings.hooks || {};
  for (const ev of new Set(Object.keys(hooks).concat(Object.keys(kitHooks)))) {
    const combined = (hooks[ev] || []).filter((g) => !isKit(g)).concat(kitHooks[ev] || []);
    if (combined.length) hooks[ev] = combined; else delete hooks[ev];
  }
  const merged = Object.assign({}, existing, { hooks: hooks });
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, JSON.stringify(merged, null, 2) + "\n");
  say("settings", ".claude/settings.json (kit hooks merged" + (Object.keys(existing).length ? "; user keys preserved)" : ")"));
  record(".claude/settings.json", "entry");
}

function mergeEntryDoc(srcAbs, destRel) {
  const dest = path.join(target, destRel);
  const START = "<!-- >>> teamentic: managed (refreshed on update; do not edit) >>> -->";
  const END = "<!-- <<< teamentic: managed <<< -->";
  const block = START + "\n" + fs.readFileSync(srcAbs, "utf8").trim() + "\n" + END;
  const OLD_START = "<!-- >>> tdd-pairing: managed (refreshed on update; do not edit) >>> -->";
  const OLD_END = "<!-- <<< tdd-pairing: managed <<< -->";
  let cur = ""; try { cur = fs.readFileSync(dest, "utf8"); } catch (e) {}
  let i = cur.indexOf(START), j = cur.indexOf(END), endLen = END.length;
  if (i === -1) { const oi = cur.indexOf(OLD_START), oj = cur.indexOf(OLD_END); if (oi !== -1 && oj !== -1 && oj > oi) { i = oi; j = oj; endLen = OLD_END.length; } }
  let next, how;
  if (i !== -1 && j !== -1 && j > i) { next = cur.slice(0, i) + block + cur.slice(j + endLen); how = "refresh"; }
  else if (cur.trim() === "") { next = block + "\n\n<!-- Your project overlay below - yours; update never touches it. -->\n## Project notes\n"; how = "install"; }
  else { next = block + "\n\n<!-- Existing content preserved as your project overlay (update never touches below). -->\n\n" + cur; how = "wrap"; }
  if (next !== cur) { ensureDir(path.dirname(dest)); fs.writeFileSync(dest, next); say(how, destRel + " (managed block + overlay)"); }
  else { say("keep", destRel + " (managed block up to date)"); }
  record(destRel, "entry");
}

ensureDir(path.join(target, ".claude", "agents"));
ensureDir(path.join(target, ".claude", "hooks"));
ensureDir(path.join(target, ".claude", "state"));
ensureDir(path.join(target, "docs", "tdd"));

console.log((cmd === "update" ? "Updating" : "Installing") + " teamentic kit -> " + target);
if (cmd === "update") {
  const _from = priorManifest.kitVersion, _to = PKG.version;
  console.log("  " + (_from || "pre-0.4 (no manifest)") + " -> " + _to);
  const _notes = [];
  for (const v of Object.keys(BREAKING)) if (vcmp(_from, v) < 0 && vcmp(v, _to) <= 0) for (const n of BREAKING[v]) _notes.push("  - " + n);
  if (_notes.length) { console.log("\nBREAKING / MIGRATIONS:"); for (const n of _notes) console.log(n); console.log(""); }
}

// 1) Mechanism — refreshed every run.
for (const a of ["test-writer", "implementer", "tdd-critic", "planner"])
  refresh(path.join(CFG, "agents", a + ".md"), path.join(".claude", "agents", a + ".md"));
// Shared hook library (resolver + defaults), sourced by the hooks below.
refresh(path.join(CFG, "hooks", "lib.sh"), path.join(".claude", "hooks", "lib.sh"));
for (const h of ["guard-edit-scope", "run-suite", "require-green-to-stop", "session-green-check"]) {
  const rel = path.join(".claude", "hooks", h + ".sh");
  refresh(path.join(CFG, "hooks", h + ".sh"), rel);
  try { fs.chmodSync(path.join(target, rel), 0o755); } catch (e) { /* windows */ }
}
for (const d of ["tdd-workflow", "testing-philosophy", "conventions"])
  refresh(path.join(KIT, "docs", "tdd", d + ".md"), path.join("docs", "tdd", d + ".md"));

// 1b) Optional team preset (sticky) — outer-loop roles + method doc + state templates.
if (presetActive === "full-team") {
  const PRESET = path.join(KIT, "presets", "full-team");
  for (const a of ["product-owner", "architect", "qa-verifier", "project-manager", "dev-ops"])
    refresh(path.join(PRESET, "agents", a + ".md"), path.join(".claude", "agents", a + ".md"));
  refresh(path.join(PRESET, "docs", "outer-loop.md"), path.join("docs", "tdd", "outer-loop.md"));
  for (const s of ["backlog.md", "releases.md"])
    seedOnce(path.join(PRESET, "state", s), path.join(".claude", "state", s));
}

// 2) Seeded — written once, never clobbered.
seedOnce(path.join(CFG, "tdd.config"), path.join(".claude", "tdd.config"), "yours");
seedOnce(path.join(CFG, "hooks", "local.d", "README.md"), path.join(".claude", "hooks", "local.d", "README.md"));
for (const s of ["design-notes.md", "progress.md", "plan.md", "phase", "layer", ".gitkeep"])
  seedOnce(path.join(CFG, "state", s), path.join(".claude", "state", s));
seedOnce(path.join(KIT, "docs", "tdd", "project-invariants.template.md"),
         path.join("docs", "tdd", "project-invariants.md"), "yours");
seedOnce(path.join(KIT, "ci", "tdd-verify.yml"),
         path.join(".github", "workflows", "tdd-verify.yml"));

// 3) settings.json — content-aware merge (kit hooks added, your keys preserved).
mergeSettings(target);  // P1-7: merge kit hooks into settings.json, preserve user keys

// 4) Entry docs - thin managed block + your overlay (method lives in docs/tdd/; no sidecar).
for (const f of ["AGENTS.md", "CLAUDE.md", "KICKOFF.md"])
  mergeEntryDoc(path.join(KIT, f), f);

// Manifest (P0-3): record kit-owned files + content hashes, for clobber-safe updates.
ensureDir(path.join(target, ".claude", ".teamentic"));
fs.writeFileSync(path.join(target, MANIFEST_REL),
  JSON.stringify({ kit: "teamentic", kitVersion: PKG.version, configSchema: 2, preset: presetActive, updatedAt: new Date().toISOString(), files: manifestFiles }, null, 2) + "\n");
say("manifest", MANIFEST_REL + (backups ? "  (" + backups + " local change(s) backed up to .bak)" : ""));
ensureGitignore(target);
if (presetActive === "full-team")
  console.log("\n[full-team] outer-loop roles installed (product-owner, architect, qa-verifier, project-manager, dev-ops) — see docs/tdd/outer-loop.md.");

console.log("\nDone — teamentic installed. One thing to do, then you're building:\n\n  Open this project in Claude Code, approve the hooks, and paste your first\n  message — the orchestrator configures the harness for you (nothing to hand-edit):\n\n    Read AGENTS.md and CLAUDE.md. Detect this project's stack and set LAYERS + the\n    test command(s) in .claude/tdd.config, and draft docs/tdd/project-invariants.md\n    from the code for me to confirm. Then build the first feature with the\n    red->green loop: <what you want built>.\n\n  KICKOFF.md has this prompt ready to copy (with an acceptance template).\n\nNote: the hooks are bash scripts (use WSL/git-bash on Windows). Hook event names\nand exit-code semantics shift between Claude Code releases — confirm against\ncode.claude.com/docs/en/hooks before relying on the gate.");

// Auto-validate (P0-4): report a stale/broken config NOW, not via a blocked edit.
if (validateInstall(target) !== 0) {
  console.log("\n[!] validate FAILED — the TDD gate may not work. Fix the above, then re-run `npx teamentic validate`.");
}

// ---- validate -----------------------------------------------------------
// Sources the ACTUAL installed lib.sh + tdd.config and asserts the resolver is
// available and every declared layer resolves to a command. Catches a stale or
// broken config AT UPDATE TIME instead of via a blocked edit later.
function validateInstall(targetDir) {
  const lib = path.join(targetDir, ".claude", "hooks", "lib.sh");
  if (!fs.existsSync(lib)) {
    console.error("validate: .claude/hooks/lib.sh is missing — the resolver mechanism is gone. Run `npx teamentic update`.");
    return 1;
  }
  const bashOk = (() => { try { return cp.spawnSync("bash", ["-c", "exit 0"]).status === 0; } catch (e) { return false; } })();
  if (!bashOk) { console.log("validate: bash not found — skipped (hooks need bash; use WSL/git-bash on Windows)."); return 0; }
  const script =
    'set -u\n' +
    'ROOT=' + JSON.stringify(targetDir) + '\n' +
    '. "$ROOT/.claude/hooks/lib.sh" 2>/dev/null || true\n' +
    'if ! type resolve_layer >/dev/null 2>&1; then echo "ERROR: resolve_layer is unavailable (.claude/hooks/lib.sh stale or unsourced). Run: npx teamentic update"; exit 1; fi\n' +
    'if [ -z "${LAYERS:-}" ]; then echo "ERROR: no LAYERS defined in .claude/tdd.config"; exit 1; fi\n' +
    'for L in $LAYERS; do resolve_layer "$L"; if [ -z "$TEST_CMD" ]; then echo "ERROR: layer $L resolves to no test command (set TEST_CMD_$L or ALL_TEST_CMD)"; exit 1; fi; echo "  ok  $L -> $TEST_CMD"; done\n' +
    'echo "validate: OK — resolver present; every layer resolves."\n';
  const r = cp.spawnSync("bash", ["-c", script], { encoding: "utf8" });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.status !== 0 && r.stderr) process.stderr.write(r.stderr);
  return r.status === 0 ? 0 : 1;
}

// ---- selftest -----------------------------------------------------------
// Fires synthetic hook payloads at the INSTALLED hook scripts in a throwaway
// sandbox and asserts exit codes — so you can confirm the gate actually works
// in YOUR environment (bash, jq, this Claude Code version), not just in theory.
function selftest(targetDir) {
  const hooksDir = path.join(targetDir, ".claude", "hooks");
  if (!fs.existsSync(hooksDir)) {
    console.error("selftest: no kit found at " + targetDir + " — run `npx teamentic` first.");
    return 1;
  }
  // Need bash to run the hooks.
  const bashOk = (() => { try { return cp.spawnSync("bash", ["-c", "exit 0"]).status === 0; } catch (e) { return false; } })();
  if (!bashOk) {
    console.log("selftest: bash not found. The hooks require bash (use WSL/git-bash on Windows). Skipped.");
    return 0;
  }

  const S = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-selftest-"));
  const SH = path.join(S, ".claude", "hooks");
  const ST = path.join(S, ".claude", "state");
  fs.mkdirSync(SH, { recursive: true });
  fs.mkdirSync(ST, { recursive: true });
  for (const h of ["lib", "guard-edit-scope", "run-suite", "require-green-to-stop"])
    fs.copyFileSync(path.join(hooksDir, h + ".sh"), path.join(SH, h + ".sh"));

  // Minimal known config with a controllable test command (env TDD_SELFTEST_FAIL).
  fs.writeFileSync(path.join(S, ".claude", "tdd.config"),
`LAYERS="app"
ALL_TEST_CMD="sh -c 'exit \${TDD_SELFTEST_FAIL:-0}'"
DEFAULT_TEST_GLOB='(\\.test\\.|\\.spec\\.|(^|/)tests?/|(^|/)__tests__/)'
DEFAULT_SRC_GLOB='(^|/)src/'
TEST_CMD_app="$ALL_TEST_CMD"
TEST_GLOB_app="$DEFAULT_TEST_GLOB"
SRC_GLOB_app="$DEFAULT_SRC_GLOB"
TAIL_LINES=40
resolve_layer() {
  _l="$1"
  eval "TEST_CMD=\\"\\\${TEST_CMD_\${_l}:-}\\""
  eval "TEST_GLOB=\\"\\\${TEST_GLOB_\${_l}:-}\\""
  eval "SRC_GLOB=\\"\\\${SRC_GLOB_\${_l}:-}\\""
  [ -n "$TEST_CMD" ] || TEST_CMD="$ALL_TEST_CMD"
  [ -n "$TEST_GLOB" ] || TEST_GLOB="$DEFAULT_TEST_GLOB"
  [ -n "$SRC_GLOB" ] || SRC_GLOB="$DEFAULT_SRC_GLOB"
}
`);

  const setState = (k, v) => fs.writeFileSync(path.join(ST, k), v + "\n");
  const run = (hook, { stdin = "", env = {} } = {}) =>
    cp.spawnSync("bash", [path.join(SH, hook + ".sh")],
      { input: stdin, env: Object.assign({}, process.env, env), encoding: "utf8" }).status;
  const edit = (p) => JSON.stringify({ tool_input: { file_path: p } });

  let pass = 0, fail = 0;
  const check = (name, actual, expected) => {
    const ok = actual === expected;
    console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + (ok ? "" : `  (got ${actual}, want ${expected})`));
    ok ? pass++ : fail++;
  };

  console.log("teamentic selftest — firing synthetic payloads at installed hooks\n");

  // guard-edit-scope: phase x scope
  setState("layer", "app");
  setState("phase", "green"); check("green blocks test edit",       run("guard-edit-scope", { stdin: edit("tests/x.test.js") }), 2);
                              check("green allows source edit",      run("guard-edit-scope", { stdin: edit("src/x.js") }), 0);
  setState("phase", "red");   check("red blocks source edit",        run("guard-edit-scope", { stdin: edit("src/x.js") }), 2);
                              check("red allows test edit",          run("guard-edit-scope", { stdin: edit("tests/x.test.js") }), 0);
  setState("phase", "off");   check("off (disarmed) allows any edit", run("guard-edit-scope", { stdin: edit("src/x.js") }), 0);
  setState("phase", "bogus"); check("unknown phase fails CLOSED",    run("guard-edit-scope", { stdin: edit("src/x.js") }), 2);

  // run-suite: records green/red
  setState("layer", "app");
  run("run-suite", { env: { TDD_SELFTEST_FAIL: "0" } });
  check("run-suite records green on pass", fs.readFileSync(path.join(ST, "suite-status"), "utf8").trim() === "green" ? 1 : 0, 1);
  run("run-suite", { env: { TDD_SELFTEST_FAIL: "1" } });
  check("run-suite records red on fail",   fs.readFileSync(path.join(ST, "suite-status"), "utf8").trim() === "red" ? 1 : 0, 1);

  // telemetry: one parseable JSON event per run
  let telemetryOk = 0;
  try {
    const lines = fs.readFileSync(path.join(ST, "telemetry.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    telemetryOk = (lines.length >= 2 && lines.every((e) => e.event === "suite" && "result" in e && "durationSec" in e)) ? 1 : 0;
  } catch (e) { telemetryOk = 0; }
  check("telemetry JSONL emitted per run", telemetryOk, 1);

  // require-green-to-stop: phase-gated, and it RE-VERIFIES a cached red before blocking.
  setState("suite-status", "red"); setState("phase", "green");
  check("stop blocks on red in green (re-verify still red)", run("require-green-to-stop", { env: { TDD_SELFTEST_FAIL: "1" } }), 2);
  setState("suite-status", "red"); setState("phase", "green");
  check("stop allows when cached red is STALE (re-verify green)", run("require-green-to-stop", { env: { TDD_SELFTEST_FAIL: "0" } }), 0);
  setState("suite-status", "red"); setState("phase", "red");
  check("stop allows on red in red phase", run("require-green-to-stop"), 0);
  setState("phase", "off");
  check("stop allows when disarmed", run("require-green-to-stop"), 0);

  try { fs.rmSync(S, { recursive: true, force: true }); } catch (e) {}

  console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} — ${pass} passed, ${fail} failed.`);
  if (fail > 0) console.log("The gate is NOT behaving as expected in this environment. Check bash/jq and the\nClaude Code hooks reference before relying on it.");
  return fail === 0 ? 0 : 1;
}

// ---- report -------------------------------------------------------------
// Summarize the cycle telemetry so you can see how the PROCESS is performing —
// cycles per layer, implementer retries, suite durations, pass rates.
function report(targetDir) {
  const tf = path.join(targetDir, ".claude", "state", "telemetry.jsonl");
  if (!fs.existsSync(tf)) {
    console.log("No telemetry yet at " + tf + ".\nRun some red->green cycles (telemetry is emitted by the run-suite hook), then re-run report.");
    return 0;
  }
  const events = fs.readFileSync(tf, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  if (events.length === 0) { console.log("Telemetry file has no parseable events."); return 0; }

  const layers = {};
  let totalDur = 0, runs = 0;
  for (const e of events) {
    runs++; totalDur += (e.durationSec || 0);
    const L = layers[e.layer] || (layers[e.layer] = { runs: 0, redInRed: 0, retries: 0, cycles: 0, dur: 0 });
    L.runs++; L.dur += (e.durationSec || 0);
    if (e.phase === "red" && e.result === "red") L.redInRed++;          // a failing test was written
    if (e.phase === "green" && e.result === "red") L.retries++;         // implementer attempt that didn't pass
    if (e.phase === "green" && e.result === "green") L.cycles++;        // a cycle reached green
  }

  const fmt = (n) => String(n).padStart(6);
  console.log("TDD process report  (" + runs + " suite runs across " + Object.keys(layers).length + " layer(s))\n");
  console.log("  layer        runs  cycles  retries  testsWritten  avgSec");
  console.log("  ----------------------------------------------------------");
  let totCycles = 0, totRetries = 0;
  for (const name of Object.keys(layers).sort()) {
    const L = layers[name];
    totCycles += L.cycles; totRetries += L.retries;
    const avg = L.runs ? (L.dur / L.runs).toFixed(1) : "0";
    console.log("  " + name.padEnd(11) + fmt(L.runs) + fmt(L.cycles) + fmt(L.retries) + fmt(L.redInRed) + ("   " + avg).padStart(8));
  }
  console.log("  ----------------------------------------------------------");
  const retryRate = totCycles ? (totRetries / totCycles).toFixed(2) : "0";
  console.log("\n  cycles completed : " + totCycles);
  console.log("  retries / cycle  : " + retryRate + (Number(retryRate) >= 2 ? "   (high — test-writer contracts may be underspecified)" : ""));
  console.log("  total suite time : " + totalDur + "s over " + runs + " runs");
  const first = events[0].ts, last = events[events.length - 1].ts;
  console.log("  window           : " + first + "  ->  " + last);
  return 0;
}
