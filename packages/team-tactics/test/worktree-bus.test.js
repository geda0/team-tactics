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
    assert.match(out, /correlate/i, "frames it accurately — claims/views already correlate across worktrees (pt2)");
    assert.match(out, /TICS_DIR|spool/, "names the optional shared-bus optimization");
    assert.doesNotMatch(out, /can.?t correlate|cannot correlate/i, "no longer falsely claims correlation is broken");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

test("SessionStart does NOT nudge about the bus when TIC_STORE=spool", () => {
  const d = gitInstall(); const wt = d + "-wt2";
  try {
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nTIC_STORE=spool\n");
    git(d, "worktree", "add", "-q", wt, "-b", "side2");
    const r = sgc(d);
    assert.doesNotMatch(r.stdout + r.stderr, /correlate/i, "no nudge when already sharing one spool bus");
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

test("N5: update REFRESHES an already-installed (stale) team-tactics git hook; never installs/clobbers", () => {
  const d = gitInstall();
  try {
    assert.strictEqual(node("install-hooks", d).status, 0);
    const pc = path.join(commonHooks(d), "pre-commit");
    fs.writeFileSync(pc, "#!/bin/sh\n# team-tactics pre-commit (STALE 0.27)\nexit 0\n");   // drift, keeps the sentinel
    node("update", d);                                                                      // plain update
    const after = fs.readFileSync(pc, "utf8");
    assert.doesNotMatch(after, /STALE/, "the stale ttics pre-commit was refreshed by update (no silent rot)");
    assert.match(after, /green-bar referee|PRECOMMIT_GATE/, "refreshed to the current kit hook");
    // foreign hook is left untouched by update
    const post = path.join(commonHooks(d), "post-commit");
    fs.writeFileSync(post, "#!/bin/sh\n# my own post-commit\nexit 0\n");
    node("update", d);
    assert.match(fs.readFileSync(post, "utf8"), /my own post-commit/, "foreign hook preserved across update");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("N5: update does NOT install git hooks where none exist (install-hooks stays opt-in)", () => {
  const d = gitInstall();
  try {
    node("update", d);
    assert.ok(!fs.existsSync(path.join(commonHooks(d), "pre-commit")), "no git hook auto-installed on update");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics log merges every worktree's bus BY DEFAULT (whole picture); --here restricts to local", () => {
  const d = gitInstall(); const wt = d + "-wtall";
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:00Z", seq: 1, kind: "note", from: "main-wt", to: "*", msg: "tic in MAIN", scope: "*" }) + "\n");
    git(d, "worktree", "add", "-q", wt, "-b", "sidewt");
    fs.mkdirSync(path.join(wt, ".claude", "state"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:05Z", seq: 1, kind: "note", from: "side-wt", to: "*", msg: "tic in SIDE", scope: "*" }) + "\n");
    const here = node("log", "--here", d);
    assert.match(here.stdout, /tic in MAIN/); assert.doesNotMatch(here.stdout, /tic in SIDE/, "--here = this worktree only");
    const all = node("log", d);   // the DEFAULT now merges — whole picture, no flag
    assert.match(all.stdout, /tic in MAIN/); assert.match(all.stdout, /tic in SIDE/, "default merges sibling worktree buses");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

// emitAs: emit a tic as a given session/scope (used by the cross-worktree claim-visibility test).
const emitAs = (d, sid, scope, args) => cp.spawnSync("bash", ["-c", `. "${d}/.claude/hooks/tics-lib.sh"; export TICS_SESSION='${sid}' TICS_SCOPE='${scope}'; emit_tic ${args}`], { cwd: d, env: ENV });

test("N1 pt2: a claim in one worktree is VISIBLE + BLOCKS across worktrees (cross-worktree enforcement)", () => {
  const d = gitInstall(); const wt = d + "-pt2";
  // the REAL enforcement path: the installed reader (.claude/hooks/tics), used by the guard + pre-commit
  const tics = (dir, ...a) => cp.spawnSync(path.join(dir, ".claude", "hooks", "tics"), a, { cwd: dir, encoding: "utf8", env: ENV });
  try {
    git(d, "worktree", "add", "-q", wt, "-b", "pt2branch");
    emitAs(wt, "wtSess", "ui/S2", "wtSess '*' claim app.js app.js");   // worktree wt's session claims app.js
    // from the MAIN worktree, enforcement must SEE the sibling's claim (was local-only → blind)
    assert.match(tics(d, "claim-session", "app.js").stdout, /wtSess/, "claim-session sees the sibling worktree's claim");
    assert.match(tics(d, "claim-owner", "app.js").stdout, /ui\/S2/, "claim-owner reports the holding scope cross-worktree");
    assert.notStrictEqual(tics(d, "claim-check", "app.js", "other/S9").status, 0, "claim-check blocks a rival scope cross-worktree");
    assert.strictEqual(tics(d, "claim-check", "app.js", "ui/S2").status, 0, "the owning scope is not blocked");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

test("N6: install-hooks installs a pre-push that BLOCKS a tag whose version drifts from root package.json, ALLOWS a matching tag, ignores branch pushes", () => {
  const d = gitInstall(); const remote = d + "-remote";
  try {
    // known root version
    fs.writeFileSync(path.join(d, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    git(d, "add", "-A"); git(d, "commit", "-qm", "pkg");
    // bare remote + seed the main branch (a branch push is NOT gated)
    cp.spawnSync("git", ["init", "--bare", remote], { encoding: "utf8", env: ENV });
    git(d, "remote", "add", "origin", remote);
    assert.strictEqual(git(d, "push", "origin", "HEAD:refs/heads/main").status, 0, "branch push unaffected");
    // install the gate
    assert.strictEqual(node("install-hooks", d).status, 0);
    // MISMATCH: tag v2.0.0 while package.json is 1.0.0 → must be blocked, and name the drift
    git(d, "tag", "v2.0.0");
    const blocked = git(d, "push", "origin", "v2.0.0");
    assert.notStrictEqual(blocked.status, 0, "drifted tag push blocked");
    assert.match(blocked.stdout + blocked.stderr, /1\.0\.0|2\.0\.0|version|mismatch/i, "names the drift");
    // MATCH: tag v1.0.0 equals package.json → pushes fine
    git(d, "tag", "v1.0.0");
    assert.strictEqual(git(d, "push", "origin", "v1.0.0").status, 0, "matching tag pushes fine");
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(remote, { recursive: true, force: true }); }
});

test("F4: pre-push validates a tag against its OWN commit's package.json (a stacked tag matching its commit pushes even after HEAD moved on; a tag mismatching its commit still blocks)", () => {
  const d = gitInstall(); const remote = d + "-remote";
  try {
    // C1: package.json at 1.0.0
    fs.writeFileSync(path.join(d, "package.json"), '{"name":"x","version":"1.0.0"}\n');
    git(d, "add", "-A"); git(d, "commit", "-qm", "v1");
    // bare remote + seed main (C1 on remote)
    cp.spawnSync("git", ["init", "--bare", remote], { encoding: "utf8", env: ENV });
    git(d, "remote", "add", "origin", remote);
    git(d, "push", "origin", "HEAD:refs/heads/main");
    // install the gate
    assert.strictEqual(node("install-hooks", d).status, 0);
    // tag v1.0.0 AT C1 — its own commit's package.json is 1.0.0
    git(d, "tag", "v1.0.0");
    // C2: HEAD moves on to 2.0.0
    fs.writeFileSync(path.join(d, "package.json"), '{"name":"x","version":"2.0.0"}\n');
    git(d, "add", "-A"); git(d, "commit", "-qm", "v2");
    // a stacked/historical tag that matches ITS OWN commit must still push, even though HEAD is now 2.0.0
    assert.strictEqual(git(d, "push", "origin", "v1.0.0").status, 0, "a stacked tag matching its OWN commit pushes even after HEAD moved on");
    // protective behavior intact: a tag mismatching its own commit (v5.0.0 at C2 whose package.json is 2.0.0) still blocks
    git(d, "tag", "v5.0.0");
    const drift = git(d, "push", "origin", "v5.0.0");
    assert.notStrictEqual(drift.status, 0, "a tag mismatching its own commit still blocks");
    assert.match(drift.stdout + drift.stderr, /2\.0\.0|5\.0\.0|version|mismatch/i, "names the drift");
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(remote, { recursive: true, force: true }); }
});
