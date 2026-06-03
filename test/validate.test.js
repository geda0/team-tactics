"use strict";
// P0-4: `validate` sources the REAL installed lib.sh + tdd.config and asserts the
// resolver is available and every declared layer resolves to a command — so a stale
// or broken config is reported at update time, not discovered via a blocked edit.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) {
  return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
}
function freshInstall() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-validate-"));
  run([d]); // default cmd = install
  return d;
}

test("validate passes on a fresh install", () => {
  const d = freshInstall();
  try {
    const r = run(["validate", d], d);
    assert.strictEqual(r.status, 0, "validate should pass:\n" + r.stdout + r.stderr);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("validate FAILS when the resolver mechanism (lib.sh) is missing", () => {
  const d = freshInstall();
  try {
    fs.rmSync(path.join(d, ".claude", "hooks", "lib.sh"));
    const r = run(["validate", d], d);
    assert.notStrictEqual(r.status, 0, "validate should fail when lib.sh is gone");
    assert.match(r.stdout + r.stderr, /resolve_layer|lib\.sh|update/i);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("validate FAILS when tdd.config (LAYERS) is missing", () => {
  const d = freshInstall();
  try {
    fs.rmSync(path.join(d, ".claude", "tdd.config"));
    const r = run(["validate", d], d);
    assert.notStrictEqual(r.status, 0, "validate should fail with no LAYERS");
    assert.match(r.stdout + r.stderr, /LAYERS|layer/i);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
