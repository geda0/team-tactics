"use strict";
// P1-9: lib.sh sources hooks/local.d/*.sh LAST — a refresh-safe extension point where a
// project can override the resolver/defaults or add helpers without editing kit files.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const KIT_LIB = path.join(require("@ttics/tdd").KIT, "hooks", "lib.sh");
const CLI = path.join(__dirname, "..", "bin", "cli.js");

function sandbox(extra) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-ext-"));
  fs.mkdirSync(path.join(d, ".claude", "hooks"), { recursive: true });
  fs.copyFileSync(KIT_LIB, path.join(d, ".claude", "hooks", "lib.sh"));
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nALL_TEST_CMD="npm test"\nTEST_CMD_app="kit-cmd"\n');
  if (extra) extra(d);
  const r = cp.spawnSync("bash", ["-c", `. "${d}/.claude/hooks/lib.sh"; resolve_layer app; printf '%s' "$TEST_CMD"`], { encoding: "utf8" });
  fs.rmSync(d, { recursive: true, force: true });
  return r;
}

test("a hooks/local.d/*.sh override wins (sourced after kit defs)", () => {
  const r = sandbox((d) => {
    fs.mkdirSync(path.join(d, ".claude", "hooks", "local.d"), { recursive: true });
    fs.writeFileSync(path.join(d, ".claude", "hooks", "local.d", "override.sh"), 'resolve_layer() { TEST_CMD="OVERRIDDEN"; }\n');
  });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), "OVERRIDDEN");
});

test("lib.sh is fine when local.d is absent", () => {
  const r = sandbox(null);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), "kit-cmd");
});

test("install creates the hooks/local.d extension dir", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-ext-"));
  try {
    cp.spawnSync("node", [CLI, d], { encoding: "utf8" });
    assert.ok(fs.existsSync(path.join(d, ".claude", "hooks", "local.d")), "local.d created");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
