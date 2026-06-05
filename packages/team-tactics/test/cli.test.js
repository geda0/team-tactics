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
    assert.match(r.stdout, /team-tactics|TDD pairing/i, "prints help");
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

test("0.6: README documents the AGENT quick-start — one-shot (install+bootstrap) AND the 2-step path", () => {
  const r = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(r, /one[- ]shot/i, "has a one-shot agent path");
  assert.match(r, /npx tics \./, "the one-shot tells the agent to run the install itself");
  assert.match(r, /bootstrap/i, "the one-shot bootstraps, not just installs");
  assert.match(r, /two[- ]step|terminal/i, "still offers the manual/terminal 2-step path");
});

test("0.6: KICKOFF.md covers both greenfield and existing-repo adoption", () => {
  const k = fs.readFileSync(path.join(__dirname, "..", "kit", "KICKOFF.md"), "utf8");
  assert.match(k, /adopt|existing/i, "has an existing-repo adoption path");
  assert.match(k, /one[- ]shot/i, "references the one-shot");
});

test("0.8: install ships the divide-and-conquer doctrine", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const doc = path.join(d, "docs", "tdd", "divide-and-conquer.md");
    assert.ok(fs.existsSync(doc), "divide-and-conquer.md installed");
    const s = fs.readFileSync(doc, "utf8");
    assert.match(s, /divide and conquer/i); assert.match(s, /read-only|read-side/i); assert.match(s, /scope/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("0.9: install ships the tool-support (cross-tool) doc + AGENTS discloses it", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const doc = path.join(d, "docs", "tdd", "tool-support.md");
    assert.ok(fs.existsSync(doc), "tool-support.md installed");
    const s = fs.readFileSync(doc, "utf8");
    assert.match(s, /Claude Code/); assert.match(s, /Cursor/i); assert.match(s, /self-enforce|manual/i);
    assert.match(fs.readFileSync(path.join(d, "AGENTS.md"), "utf8"), /Tool support/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("0.7: install ships the tic-protocol spec + an executable tic.sh", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const spec = path.join(d, "docs", "tics", "tic-protocol.md");
    assert.ok(fs.existsSync(spec), "tic-protocol.md installed");
    const s = fs.readFileSync(spec, "utf8");
    assert.match(s, /tic/i); assert.match(s, /signal/); assert.match(s, /inbox/);
    const ticsh = path.join(d, ".claude", "hooks", "tic.sh");
    assert.ok(fs.existsSync(ticsh), "tic.sh installed");
    assert.ok((fs.statSync(ticsh).mode & 0o111) !== 0, "tic.sh executable");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
