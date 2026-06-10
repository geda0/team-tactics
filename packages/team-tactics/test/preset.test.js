"use strict";
// ADR 0005: full-team is the DEFAULT (full power by default). A plain install ships the outer-loop
// roles + method + state and records preset:"full-team"; `--minimal` opts out (sticky). P2-14: the
// preset is sticky across updates.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const has = (d, ...p) => fs.existsSync(path.join(d, ...p));
const manifest = (d) => JSON.parse(fs.readFileSync(path.join(d, ".claude", ".team-tactics", "manifest.json"), "utf8"));
const TEAM = ["product-owner", "architect", "qa-verifier", "project-manager", "dev-ops"];

test("plain install ships the FULL TEAM by default (ADR 0005 — full power by default)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);   // no flag
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " installs by DEFAULT now");
    assert.ok(has(d, ".claude", "agents", "test-writer.md"), "inner agents too");
    assert.ok(has(d, "docs", "tdd", "outer-loop.md"), "outer-loop doc shipped by default");
    assert.strictEqual(manifest(d).preset, "full-team", "default preset recorded as full-team");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// REGRESSION GUARD (navigator 2026-06-10: "ensure new installs HAVE full team by default; future
// installs won't face the same issue"). Pins the WHOLE contract for a fresh, no-flag install end to
// end — delivered (team + preset) AND surfaced every prompt (the UserPromptSubmit directive fires and
// names the outer-loop team). If any future change drops a new install back toward solo — flips the
// default, breaks the directive wiring, or severs the team↔directive coupling — this fails loudly.
test("GUARD: a fresh no-flag install delivers full-team AND surfaces it every prompt (can't silently regress)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);   // exactly what a brand-new adopter runs
    // delivered:
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " present on a default install");
    assert.strictEqual(manifest(d).preset, "full-team", "preset recorded full-team");
    // surfaced: the UserPromptSubmit directive is wired AND fires AND names the outer-loop team
    const settings = JSON.parse(fs.readFileSync(path.join(d, ".claude", "settings.json"), "utf8"));
    const ups = (settings.hooks && settings.hooks.UserPromptSubmit) || [];
    assert.ok(ups.some((g) => (g.hooks || []).some((h) => /prompt-directive\.sh/.test(h.command || ""))), "UserPromptSubmit wired to prompt-directive");
    const dir = cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "prompt-directive.sh")], { encoding: "utf8", input: "" }).stdout;
    assert.match(dir, /FULL framework/i, "the every-prompt directive fires on a default install");
    assert.match(dir, /product-owner|architect|qa-verifier/i, "and surfaces the OUTER-LOOP team (the team↔directive coupling holds)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--preset full-team installs the 5 roles + outer-loop doc + state + records preset", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " installed");
    assert.ok(has(d, "docs", "tdd", "outer-loop.md"), "outer-loop doc");
    assert.ok(has(d, "docs", "tdd", "sectioning.md"), "sectioning doc");
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

test("--minimal opts out of the team (inner pair only) and is sticky across update", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--minimal", d]);
    for (const a of TEAM) assert.ok(!has(d, ".claude", "agents", a + ".md"), a + " absent under --minimal");
    assert.ok(has(d, ".claude", "agents", "test-writer.md"), "inner pair present");
    assert.strictEqual(manifest(d).preset, "minimal", "minimal recorded (sticky opt-out)");
    run(["update", d]);   // plain update must NOT re-add the team
    for (const a of TEAM) assert.ok(!has(d, ".claude", "agents", a + ".md"), a + " stays absent (sticky minimal)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("an unknown preset name errors (exit != 0)", () => {
  const r = run(["--preset", "bogus", os.tmpdir() + "/_never"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /preset/i);
});
