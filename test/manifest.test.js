"use strict";
// P0-3: install/update writes a manifest of kit-owned files (path -> {class, version, sha256}),
// and `update` NEVER silently clobbers a locally-modified mechanism file — it backs it up to .bak.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
const KITHOOK = path.join(__dirname, "..", "kit", "claude-config", "hooks", "run-suite.sh");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }
function install() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-manifest-")); run([d]); return d; }
const MAN = (d) => path.join(d, ".claude", ".teamentic", "manifest.json");
const HOOK = (d) => path.join(d, ".claude", "hooks", "run-suite.sh");

test("install writes a manifest with hashed, classified entries", () => {
  const d = install();
  try {
    assert.ok(fs.existsSync(MAN(d)), "manifest exists");
    const m = JSON.parse(fs.readFileSync(MAN(d), "utf8"));
    assert.ok(m.kitVersion, "has kitVersion");
    const e = m.files && m.files[".claude/hooks/run-suite.sh"];
    assert.ok(e && e.sha256 && e.class === "mechanism", "run-suite recorded mechanism+sha: " + JSON.stringify(e));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("update backs up a locally-modified mechanism file before refreshing", () => {
  const d = install();
  try {
    fs.appendFileSync(HOOK(d), "\n# LOCAL EDIT\n");
    const before = fs.readFileSync(HOOK(d), "utf8");
    const r = run(["update", d], d);
    assert.match(r.stdout + r.stderr, /backup|\.bak/i, "announces a backup");
    assert.ok(fs.existsSync(HOOK(d) + ".bak"), ".bak created");
    assert.strictEqual(fs.readFileSync(HOOK(d) + ".bak", "utf8"), before, ".bak holds the local version");
    assert.strictEqual(fs.readFileSync(HOOK(d), "utf8"), fs.readFileSync(KITHOOK, "utf8"), "refreshed to kit version");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("update does NOT back up a pristine mechanism file", () => {
  const d = install();
  try {
    run(["update", d], d);
    assert.ok(!fs.existsSync(HOOK(d) + ".bak"), "no .bak for a pristine file");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
