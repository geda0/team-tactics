"use strict";
// R2: SessionStart nudges when there are parallel git worktrees but the tic bus is not shared
// (fragmented .claude/state per worktree -> claims/needs can't correlate). Set TIC_STORE=spool
// + TICS_DIR to share one bus across all worktrees.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const git = (d, ...a) => cp.spawnSync("git", ["-C", d, "-c", "user.email=a@b.c", "-c", "user.name=x", ...a], { encoding: "utf8" });
const sgc = (d) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "session-green-check.sh")], { encoding: "utf8", cwd: d });

function gitInstall() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-wt-"));
  cp.spawnSync("node", [CLI, d], { encoding: "utf8" });
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), '\nALL_TEST_CMD="true"\n');  // green baseline, quiet
  git(d, "init", "-q"); git(d, "add", "-A"); git(d, "commit", "-qm", "init");
  return d;
}

test("SessionStart nudges when git worktrees exist but the tic bus is not shared", () => {
  const d = gitInstall(); const wt = d + "-wt";
  try {
    git(d, "worktree", "add", "-q", wt, "-b", "side");
    const r = sgc(d); const out = r.stdout + r.stderr;
    assert.match(out, /worktree/i, "mentions worktrees");
    assert.match(out, /not shared|share one bus/i, "flags the unshared bus");
    assert.match(out, /TICS_DIR|spool/, "names the fix");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

test("SessionStart does NOT nudge about the bus when TIC_STORE=spool", () => {
  const d = gitInstall(); const wt = d + "-wt2";
  try {
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nTIC_STORE=spool\n");
    git(d, "worktree", "add", "-q", wt, "-b", "side2");
    const r = sgc(d);
    assert.doesNotMatch(r.stdout + r.stderr, /bus is not shared/i, "no nudge when already sharing");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});
