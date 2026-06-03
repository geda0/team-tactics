"use strict";
// P0-5: `update` prints the version delta (from -> to) read from the manifest, plus a
// keyed BREAKING/MIGRATIONS block for any version newly crossed — so behavior changes
// (e.g. empty-phase now fails closed) are surfaced, never discovered by surprise.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }
function install() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-version-")); run([d]); return d; }
const MAN = (d) => path.join(d, ".claude", ".teamentic", "manifest.json");

test("update across a version boundary prints from->to + BREAKING notes", () => {
  const d = install();
  try {
    const m = JSON.parse(fs.readFileSync(MAN(d), "utf8")); m.kitVersion = "0.3.0"; fs.writeFileSync(MAN(d), JSON.stringify(m));
    const out = (() => { const r = run(["update", d], d); return r.stdout + r.stderr; })();
    assert.match(out, /0\.3\.0/, "shows the prior version");
    assert.match(out, /BREAKING|MIGRATION/i, "shows a breaking-changes header");
    assert.match(out, /phase|off|lib\.sh|tdd\.config/i, "names a 0.4 breaking change");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("re-running update at the same version prints no BREAKING block", () => {
  const d = install();
  try {
    const r = run(["update", d], d);
    assert.doesNotMatch(r.stdout + r.stderr, /BREAKING/i, "no breaking notes when already current");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
