"use strict";
// Private peer distribution: `npm run pack:tarball` builds a self-contained, sendable tarball
// (no registry / no npm install needed — the kit has zero external deps), and FOR-TESTERS.md
// ships in it to guide a tester through install + what to try, under the proprietary terms.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, "..", "..", "..");        // test -> team-tactics -> packages -> repo root

test("FOR-TESTERS.md guides a peer to install, says what to try, and respects the proprietary terms", () => {
  const f = path.join(ROOT, "FOR-TESTERS.md");
  assert.ok(fs.existsSync(f), "a FOR-TESTERS.md at the repo root");
  const t = fs.readFileSync(f, "utf8");
  assert.match(t, /tar -xzf[\s\S]*bin\/cli\.js init/, "shows the extract-and-run install");
  assert.match(t, /selftest/, "shows how to verify the install");
  assert.match(t, /confidential|proprietary|do not redistribute/i, "reminds testers it's private");
  assert.match(t, /feedback|geda071@gmail\.com/i, "tells them how to send feedback");
});

test("`npm run pack:tarball` builds a self-contained tarball of the released kit", () => {
  assert.ok(require(path.join(ROOT, "package.json")).scripts["pack:tarball"], "root package.json wires pack:tarball");
  const out = path.join(os.tmpdir(), "ttics-pack-test-" + process.pid + ".tgz");
  try {
    const r = cp.spawnSync("node", [path.join(ROOT, "scripts", "pack-tarball.js"), out], { cwd: ROOT, encoding: "utf8" });
    assert.strictEqual(r.status, 0, "pack script runs clean: " + r.stderr);
    assert.ok(fs.existsSync(out), "a tarball is produced at the requested path");
    const buf = fs.readFileSync(out);
    assert.ok(buf.length > 1000, "non-trivial size");
    assert.strictEqual(buf[0], 0x1f, "gzip magic byte 1");
    assert.strictEqual(buf[1], 0x8b, "gzip magic byte 2");
    const list = cp.execFileSync("tar", ["-tzf", out], { encoding: "utf8" });
    for (const f of ["FOR-TESTERS.md", "LICENSE", "packages/team-tactics/bin/cli.js"])
      assert.ok(list.split("\n").includes(f), "tarball ships " + f);
  } finally { try { fs.rmSync(out); } catch (e) {} }
});

test("infra/release-tarball.sh exists and release:tarball is wired", () => {
  const sh = path.join(ROOT, "infra", "release-tarball.sh");
  assert.ok(fs.existsSync(sh), "infra/release-tarball.sh for CI + dev-ops");
  assert.ok(require(path.join(ROOT, "package.json")).scripts["release:tarball"], "npm run release:tarball");
  assert.ok(fs.existsSync(path.join(ROOT, ".github", "workflows", "release-tarball.yml")), "CI workflow on v* tags");
});

// H1a (design-notes § H1): the sendable tarball is built from the committed tree via `git archive`,
// so slimming it = (1) the dev-cruft fossils stop being tracked and (2) a `.gitattributes` declares
// `export-ignore` for the non-shipping areas. Both are SOURCE-LEVEL facts that go green BEFORE commit
// (asserting the archive output would deadlock the pre-commit gate, since the tarball reflects the
// COMMITTED tree). Today: 94 fossil files are tracked and there is no `.gitattributes` — so this is RED.
test("H1a: the release artifact excludes dev cruft — fossils untracked + .gitattributes export-ignore covers them", () => {
  const tracked = cp.execFileSync("git", ["-C", ROOT, "ls-files", "claim-session", "claim-owner"], { encoding: "utf8" }).trim();
  assert.strictEqual(tracked, "", "the fossil dirs claim-session/ + claim-owner/ are no longer tracked");

  const ga = path.join(ROOT, ".gitattributes");
  assert.ok(fs.existsSync(ga), "a .gitattributes exists at the repo root");
  const t = fs.readFileSync(ga, "utf8");
  assert.match(t, /export-ignore/, "declares export-ignore for git archive");
  assert.match(t, /test\b|tests?\/|\*\*\/test/, "excludes test dirs from the artifact");
  assert.match(t, /\.claude/, "excludes the repo's own .claude dogfood tree");
  assert.match(t, /docs\/decisions/, "excludes docs/decisions ADRs");
  assert.match(t, /infra/, "excludes infra/");
  assert.match(t, /claim-session/, "export-ignores the claim-session fossil");
  assert.match(t, /claim-owner/, "export-ignores the claim-owner fossil");
});

test("release-tarball.sh rejects a pushed tag that does not match package.json (clear error)", () => {
  const sh = path.join(ROOT, "infra", "release-tarball.sh");
  const r = cp.spawnSync("bash", [sh], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, REQUIRE_TAG: "1", TAG_NAME: "v9.9.9" },
  });
  assert.notStrictEqual(r.status, 0);
  const out = (r.stdout || "") + (r.stderr || "");
  assert.match(out, /pushed tag v9\.9\.9 but package\.json version is/, "names both sides of the mismatch");
  assert.match(out, /bump all four package\.json/, "tells the operator how to fix it");
});

test("the release git-archive tarball SHIPS the full-team preset helper (a bare scripts/ export-ignore strips it)", () => {
  // The real artifact is `git archive` filtered by .gitattributes. A bare `scripts/ export-ignore`
  // matches the nested preset scripts/ dir and strips the browser-QA helper, crashing the installer
  // (v0.66.0 bug). Assert the ACTUAL archive output. Archive a WORKING-tree-reflecting tree via
  // `git stash create` (|| HEAD) so an in-progress fix is seen and the pre-commit gate never deadlocks.
  const stash = cp.execFileSync("git", ["-C", ROOT, "stash", "create"], { encoding: "utf8" }).trim();
  const tree = stash || "HEAD";
  const out = path.join(os.tmpdir(), "ttics-helper-pack-" + process.pid + ".tgz");
  try {
    cp.execFileSync("git", ["-C", ROOT, "archive", "--format=tar.gz", "-o", out, tree]);
    const list = cp.execFileSync("tar", ["-tzf", out], { encoding: "utf8" }).split("\n");
    assert.ok(
      list.includes("packages/team-tactics/kit/presets/full-team/scripts/smoke-verify.cjs"),
      "the browser-QA helper must ship in the release tarball — root-anchor the dev `scripts/` export-ignore as `/scripts/`"
    );
  } finally { try { fs.rmSync(out); } catch (e) {} }
});
