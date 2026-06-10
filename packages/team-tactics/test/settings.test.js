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
    for (const ev of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SubagentStop"])
      assert.ok(s.hooks && s.hooks[ev] && s.hooks[ev].length, "event wired: " + ev);
    assert.ok(!fs.existsSync(path.join(d, ".claude", "settings.team-tactics.json")), "no sidecar left to merge");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("every wired kit hook command points to an INSTALLED file (no wired-but-missing hook)", () => {
  const d = install();
  try {
    const cmds = Object.values(S(d).hooks || {}).flat().flatMap((g) => (g.hooks || []).map((h) => h.command || ""));
    const kit = cmds.filter((c) => c.includes(".claude/hooks/"));
    assert.ok(kit.length, "some kit hooks are wired");
    for (const c of kit) {
      const rel = c.replace("$CLAUDE_PROJECT_DIR/", "").trim();
      assert.ok(fs.existsSync(path.join(d, rel)), "wired hook exists on disk: " + rel);
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("PreToolUse gates Bash too (not just Edit/Write) — wired to the guard, separate from run-suite", () => {
  const d = install();
  try {
    const pre = S(d).hooks.PreToolUse;
    const bash = pre.filter((g) => /(^|\|)Bash(\||$)/.test(g.matcher || ""));
    assert.ok(bash.length, "a PreToolUse group matches Bash");
    assert.ok(bash.some((g) => (g.hooks || []).some((h) => /guard-edit-scope\.sh/.test(h.command || ""))),
      "the Bash matcher is wired to guard-edit-scope.sh (closes the cat>src bypass)");
    // must NOT run the suite after a Bash command (e.g. `ls`): run-suite stays Edit|Write only
    const post = S(d).hooks.PostToolUse;
    assert.ok(!post.some((g) => /Bash/.test(g.matcher || "")), "run-suite does NOT fire on Bash");
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
    assert.strictEqual(kitGroups.length, 2, "exactly two kit guard groups — Edit|Write|MultiEdit + Bash — not duplicated on re-run (idempotent)");
    assert.ok(s.hooks.SessionStart, "kit SessionStart added");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("SubagentStop wires the auto-handoff hook + ships it", () => {
  const d = install();
  try {
    const s = S(d);
    const cmds = (s.hooks.SubagentStop || []).flatMap((g) => g.hooks.map((h) => h.command));
    assert.ok(cmds.some((c) => c.includes("subagent-handoff.sh")), "auto-handoff wired on SubagentStop");
    assert.ok(fs.existsSync(path.join(d, ".claude", "hooks", "subagent-handoff.sh")), "hook shipped");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
