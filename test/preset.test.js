"use strict";
// P2-14: `--preset full-team` installs the outer-loop roles + method + state and
// records the preset in the manifest (sticky across updates). A plain install does not.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const has = (d, ...p) => fs.existsSync(path.join(d, ...p));
const manifest = (d) => JSON.parse(fs.readFileSync(path.join(d, ".claude", ".tdd-pairing", "manifest.json"), "utf8"));
const TEAM = ["product-owner", "architect", "qa-verifier", "project-manager", "dev-ops"];

test("plain install ships only the inner-loop agents (no team)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);
    for (const a of TEAM) assert.ok(!has(d, ".claude", "agents", a + ".md"), a + " must NOT install by default");
    assert.ok(has(d, ".claude", "agents", "test-writer.md"), "inner agents still installed");
    assert.strictEqual(manifest(d).preset || null, null, "no preset recorded");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--preset full-team installs the 5 roles + outer-loop doc + state + records preset", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " installed");
    assert.ok(has(d, "docs", "tdd", "outer-loop.md"), "outer-loop doc");
    assert.ok(has(d, ".claude", "state", "backlog.md"), "backlog seeded");
    assert.ok(has(d, ".claude", "state", "releases.md"), "releases seeded");
    assert.strictEqual(manifest(d).preset, "full-team", "preset recorded in manifest");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("preset is sticky: a plain update on a full-team install keeps refreshing the team", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    fs.rmSync(path.join(d, ".claude", "agents", "dev-ops.md")); // simulate drift
    run(["update", d]);                                          // no flag
    assert.ok(has(d, ".claude", "agents", "dev-ops.md"), "sticky preset re-refreshed the role");
    assert.strictEqual(manifest(d).preset, "full-team");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--preset none clears stickiness", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    run(["--preset", "none", "update", d]);
    assert.strictEqual(manifest(d).preset || null, null, "preset cleared");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("an unknown preset name errors (exit != 0)", () => {
  const r = run(["--preset", "bogus", os.tmpdir() + "/_never"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /preset/i);
});
