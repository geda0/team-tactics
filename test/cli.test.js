"use strict";
// P2-11 (arg-parse hardening), P2-12 (correct-by-default seeds), + the stale "Next steps" polish.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }

test("P2-11: --help prints help and does NOT install into ./--help", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run(["--help"], d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /teamentic|TDD pairing/i, "prints help");
    assert.ok(!fs.existsSync(path.join(d, "--help")), "no ./--help dir");
    assert.ok(!fs.existsSync(path.join(d, ".claude")), "did not install");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-11: an unknown -flag errors instead of installing into a dir named after it", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run(["--bogus"], d);
    assert.notStrictEqual(r.status, 0, "should error");
    assert.match(r.stdout + r.stderr, /unknown|option|flag/i);
    assert.ok(!fs.existsSync(path.join(d, "--bogus")), "no ./--bogus dir");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-12: seeded tdd-verify.yml has no active 'version:' pin (derives pnpm from packageManager)", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", "kit", "ci", "tdd-verify.yml"), "utf8");
  const active = yml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(active, /version:\s*9/, "no active pnpm version pin (the deploy-staging first-run bug)");
});

test("next-steps: a fresh install no longer tells you to merge sidecars (0.4 creates none)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run([d]);
    assert.doesNotMatch(r.stdout, /sidecar/i, "no stale sidecar-merge instruction");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
