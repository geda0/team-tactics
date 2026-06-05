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
  } finally { try { fs.rmSync(out); } catch (e) {} }
});
