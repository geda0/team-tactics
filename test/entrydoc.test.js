"use strict";
// P1-8: entry docs (CLAUDE/AGENTS/KICKOFF) become a marker-delimited MANAGED block
// (kit-owned, refreshed; points to docs/tdd/* for the method) + a user OVERLAY section
// outside the markers (preserved). Replaces seedOrSidecar — no perpetual sidecar-merge.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
const MARK = ">>> teamentic"; // plain string — no stateful /g regex shared across tests
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }
function install() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-entry-")); run([d]); return d; }
const claude = (d) => fs.readFileSync(path.join(d, "CLAUDE.md"), "utf8");
const blocks = (s) => s.split(MARK).length - 1;

test("install: thin CLAUDE.md = managed block pointing to the method; carries phase convention; no sidecar", () => {
  const d = install();
  try {
    const c = claude(d);
    assert.ok(c.includes(MARK), "managed block present");
    assert.match(c, /docs\/tdd/, "points to the single-source method");
    assert.match(c, /never leave phase empty/, "carries the phase=off convention so it propagates on refresh");
    assert.ok(!fs.existsSync(path.join(d, "CLAUDE.teamentic.md")), "no sidecar");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("migration: a pre-existing monolithic entry doc is preserved as overlay", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-entry-"));
  try {
    fs.writeFileSync(path.join(d, "CLAUDE.md"), "# My custom orchestrator\nlots of project-specific stuff\n");
    run([d]);
    const c = claude(d);
    assert.ok(c.includes(MARK), "managed block added on top");
    assert.match(c, /My custom orchestrator/, "existing content preserved as overlay");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("update refreshes the managed block, preserves the user overlay, idempotent", () => {
  const d = install();
  try {
    const c = claude(d).replace("never leave phase empty", "MANGLED") + "\n## My overlay\nproject note\n";
    fs.writeFileSync(path.join(d, "CLAUDE.md"), c);
    run(["update", d], d);
    const c2 = claude(d);
    assert.match(c2, /never leave phase empty/, "managed block refreshed (mangle reverted)");
    assert.match(c2, /My overlay/, "user overlay preserved");
    assert.strictEqual(blocks(c2), 1, "exactly one managed block");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
