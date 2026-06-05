"use strict";
// P0-1: the resolver is MECHANISM (kit-owned, refreshed) and lives in
// kit/claude-config/hooks/lib.sh — NOT in the user-owned tdd.config. These tests pin
// that contract: lib.sh resolves layers from a *data-only* config, tolerates a stale
// config that still inlines its own resolver, and accepts pre-0.4 (BE_/FE_/E2E_) names.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const KIT_LIB = path.join(require("@ttics/tdd").KIT, "hooks", "lib.sh");

// Build a throwaway project (<tmp>/.claude/hooks/lib.sh + <tmp>/.claude/tdd.config),
// source the SHIPPED lib.sh in bash, call resolve_layer, return the resolved vars.
function resolve(configText, layer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-resolver-"));
  try {
    fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
    fs.copyFileSync(KIT_LIB, path.join(dir, ".claude", "hooks", "lib.sh"));
    fs.writeFileSync(path.join(dir, ".claude", "tdd.config"), configText);
    const script =
      `. "${dir}/.claude/hooks/lib.sh"; resolve_layer "${layer}"; ` +
      `printf 'CMD=%s\\nGLOB=%s\\nSRC=%s\\n' "$TEST_CMD" "$TEST_GLOB" "$SRC_GLOB"`;
    const r = cp.spawnSync("bash", ["-c", script], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, "bash failed: " + r.stderr);
    const out = {};
    for (const line of r.stdout.split("\n")) {
      const m = line.match(/^(CMD|GLOB|SRC)=(.*)$/);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("data-only config: resolves a layer's TEST_CMD", () => {
  const cfg = `LAYERS="app"\nALL_TEST_CMD="npm test"\nTEST_CMD_app="npx vitest run"\n`;
  assert.strictEqual(resolve(cfg, "app").CMD, "npx vitest run");
});

test("multi-layer: each layer resolves its own command", () => {
  const cfg =
    `LAYERS="backend frontend"\nALL_TEST_CMD="pnpm verify"\n` +
    `TEST_CMD_backend="pnpm test:backend"\nTEST_CMD_frontend="pnpm test:frontend"\n`;
  assert.strictEqual(resolve(cfg, "backend").CMD, "pnpm test:backend");
  assert.strictEqual(resolve(cfg, "frontend").CMD, "pnpm test:frontend");
});

test("compat: pre-0.4 BE_/FE_/E2E_TEST_CMD names still resolve", () => {
  const cfg =
    `LAYERS="backend frontend e2e"\nALL_TEST_CMD="pnpm verify"\n` +
    `BE_TEST_CMD="pnpm test:backend"\nFE_TEST_CMD="pnpm test:frontend"\nE2E_TEST_CMD="pnpm test:e2e"\n`;
  assert.strictEqual(resolve(cfg, "backend").CMD, "pnpm test:backend");
  assert.strictEqual(resolve(cfg, "frontend").CMD, "pnpm test:frontend");
  assert.strictEqual(resolve(cfg, "e2e").CMD, "pnpm test:e2e");
});

test("a stale inlined resolve_layer in the config does NOT win (lib.sh is authoritative)", () => {
  const cfg =
    `LAYERS="app"\nALL_TEST_CMD="npm test"\nTEST_CMD_app="correct-cmd"\n` +
    `resolve_layer() { TEST_CMD="STALE-WRONG"; }\n`;
  assert.strictEqual(resolve(cfg, "app").CMD, "correct-cmd");
});

test("unknown layer falls back to ALL_TEST_CMD", () => {
  const cfg = `LAYERS="app"\nALL_TEST_CMD="make test"\nTEST_CMD_app="npm test"\n`;
  assert.strictEqual(resolve(cfg, "nope").CMD, "make test");
});

test("missing globs fall back to mechanism defaults", () => {
  const cfg = `LAYERS="app"\nALL_TEST_CMD="npm test"\nTEST_CMD_app="npm test"\n`;
  const r = resolve(cfg, "app");
  assert.ok(r.GLOB.includes("test"), "default TEST_GLOB present: " + r.GLOB);
  assert.ok(r.SRC.includes("src"), "default SRC_GLOB present: " + r.SRC);
});
