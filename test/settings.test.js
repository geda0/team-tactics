"use strict";
// P1-7: install/update MERGES the kit's hooks into .claude/settings.json (it's JSON) —
// wiring every shipped hook (incl. new ones like SessionStart) while preserving the user's
// other settings keys and their own non-kit hooks. Idempotent; no sidecar to merge by hand.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }
function install() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-settings-")); run([d]); return d; }
const S = (d) => JSON.parse(fs.readFileSync(path.join(d, ".claude", "settings.json"), "utf8"));

test("install wires all kit hook events; no sidecar", () => {
  const d = install();
  try {
    const s = S(d);
    for (const ev of ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"])
      assert.ok(s.hooks && s.hooks[ev] && s.hooks[ev].length, "event wired: " + ev);
    assert.ok(!fs.existsSync(path.join(d, ".claude", "settings.teamentic.json")), "no sidecar left to merge");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("merge preserves user keys + user hooks, idempotently", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-settings-"));
  try {
    fs.mkdirSync(path.join(d, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(d, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "echo user-hook" }] }] },
    }));
    run([d]); run(["update", d], d);
    const s = S(d);
    assert.deepStrictEqual(s.permissions, { allow: ["Bash(ls:*)"] }, "user key preserved");
    const pre = s.hooks.PreToolUse;
    assert.ok(pre.some((g) => g.hooks.some((h) => h.command === "echo user-hook")), "user hook preserved");
    const kitGroups = pre.filter((g) => g.hooks.some((h) => String(h.command).includes(".claude/hooks/")));
    assert.strictEqual(kitGroups.length, 1, "exactly one kit guard group (idempotent)");
    assert.ok(s.hooks.SessionStart, "kit SessionStart added");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
