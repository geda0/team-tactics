"use strict";
// R2: SessionStart nudges when parallel git worktrees exist but the tic bus isn't shared.
// R3: `tics install-hooks` installs a portable pre-commit green-bar gate.
// NOTE: git exports GIT_DIR/GIT_INDEX_FILE into hooks; this suite spawns git, so it sanitizes
// the env (ENV) to stay correct when run *inside* a pre-commit hook (e.g. our own gate).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const ENV = (() => { const e = { ...process.env }; ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_NAMESPACE", "GIT_EXEC_PATH"].forEach((k) => delete e[k]); return e; })();
const git = (d, ...a) => cp.spawnSync("git", ["-C", d, "-c", "user.email=a@b.c", "-c", "user.name=x", ...a], { encoding: "utf8", env: ENV });
const node = (...a) => cp.spawnSync("node", [CLI, ...a], { encoding: "utf8", env: ENV });
const sgc = (d) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "session-green-check.sh")], { encoding: "utf8", cwd: d, env: ENV });
const commonHooks = (d) => { const c = git(d, "rev-parse", "--git-common-dir").stdout.trim(); return path.isAbsolute(c) ? path.join(c, "hooks") : path.join(d, c, "hooks"); };

function gitInstall() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-wt-"));
  node(d);
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), '\nALL_TEST_CMD="true"\n');  // green baseline, quiet
  git(d, "init", "-q"); git(d, "add", "-A"); git(d, "commit", "-qm", "init");
  return d;
}

test("SessionStart nudges when git worktrees exist but the tic bus is not shared", () => {
  const d = gitInstall(); const wt = d + "-wt";
  try {
    git(d, "worktree", "add", "-q", wt, "-b", "side");
    const out = (() => { const r = sgc(d); return r.stdout + r.stderr; })();
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

test("install-hooks installs a portable pre-commit gate (passes green, blocks red)", () => {
  const d = gitInstall();
  try {
    assert.strictEqual(node("install-hooks", d).status, 0);
    const pc = path.join(commonHooks(d), "pre-commit");
    assert.ok(fs.existsSync(pc), "pre-commit written");
    assert.ok((fs.statSync(pc).mode & 0o111) !== 0, "executable");
    fs.writeFileSync(path.join(d, "x.txt"), "1"); git(d, "add", "-A");
    assert.strictEqual(git(d, "commit", "-m", "green").status, 0, "commit allowed on green");
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), '\nALL_TEST_CMD="false"\n');
    fs.writeFileSync(path.join(d, "y.txt"), "1"); git(d, "add", "-A");
    const red = git(d, "commit", "-m", "red");
    assert.notStrictEqual(red.status, 0, "commit blocked on red");
    assert.match(red.stdout + red.stderr, /BLOCKED|RED/i);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("install-hooks does not clobber a foreign pre-commit", () => {
  const d = gitInstall();
  try {
    const hooksDir = commonHooks(d); fs.mkdirSync(hooksDir, { recursive: true });
    const pc = path.join(hooksDir, "pre-commit");
    fs.writeFileSync(pc, "#!/bin/sh\n# my own hook\nexit 0\n");
    assert.notStrictEqual(node("install-hooks", d).status, 0, "refuses to clobber a foreign hook");
    assert.match(fs.readFileSync(pc, "utf8"), /my own hook/, "foreign hook preserved");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("install-hooks installs a post-commit that emits a commit tic (cross-tool bus visibility)", () => {
  const d = gitInstall();
  try {
    assert.strictEqual(node("install-hooks", d).status, 0);
    const pc = path.join(commonHooks(d), "post-commit");
    assert.ok(fs.existsSync(pc), "post-commit installed");
    assert.ok((fs.statSync(pc).mode & 0o111) !== 0, "executable");
    fs.writeFileSync(path.join(d, "z.txt"), "1"); git(d, "add", "-A");
    assert.strictEqual(git(d, "commit", "-m", "land a thing").status, 0, "commit ok (pre-commit green)");
    const log = cp.spawnSync(path.join(d, ".claude", "hooks", "tics"), ["log"], { encoding: "utf8", cwd: d, env: ENV });
    assert.match(log.stdout, /commit/, "a commit tic landed on the bus");
    assert.match(log.stdout, /land a thing/, "with the commit subject");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics log --all merges every worktree's bus (whole picture across fragmented buses)", () => {
  const d = gitInstall(); const wt = d + "-wtall";
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:00Z", seq: 1, kind: "note", from: "main-wt", to: "*", msg: "tic in MAIN", scope: "*" }) + "\n");
    git(d, "worktree", "add", "-q", wt, "-b", "sidewt");
    fs.mkdirSync(path.join(wt, ".claude", "state"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:05Z", seq: 1, kind: "note", from: "side-wt", to: "*", msg: "tic in SIDE", scope: "*" }) + "\n");
    const one = node("log", d);
    assert.match(one.stdout, /tic in MAIN/); assert.doesNotMatch(one.stdout, /tic in SIDE/, "default = this worktree only");
    const all = node("log", "--all", d);
    assert.match(all.stdout, /tic in MAIN/); assert.match(all.stdout, /tic in SIDE/, "--all merges sibling worktree buses");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});
