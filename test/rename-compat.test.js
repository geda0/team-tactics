"use strict";
// Rename migration: `teamentic update` on a pre-rename (create-tdd-pairing) install must
// migrate the managed markers + manifest IN PLACE — never append a duplicate block or
// spuriously .bak a file the legacy manifest already tracked.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const read = (d, ...p) => fs.readFileSync(path.join(d, ...p), "utf8");
const count = (s, sub) => s.split(sub).length - 1;

// A fresh install, rewritten to look like the old create-tdd-pairing brand.
function legacyInstall() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-migrate-"));
  run([d]);
  for (const f of ["CLAUDE.md", "AGENTS.md"]) {
    const s = read(d, f).split("teamentic: managed").join("tdd-pairing: managed");
    fs.writeFileSync(path.join(d, f), s);
  }
  fs.writeFileSync(path.join(d, ".gitignore"),
    read(d, ".gitignore").split("teamentic (managed)").join("tdd-pairing (managed)"));
  fs.mkdirSync(path.join(d, ".claude", ".tdd-pairing"), { recursive: true });
  fs.renameSync(path.join(d, ".claude", ".teamentic", "manifest.json"),
                path.join(d, ".claude", ".tdd-pairing", "manifest.json"));
  fs.rmdirSync(path.join(d, ".claude", ".teamentic"));
  return d;
}

test("migration: entry-doc managed block is replaced in place (no duplicate, overlay kept)", () => {
  const d = legacyInstall();
  try {
    fs.appendFileSync(path.join(d, "CLAUDE.md"), "\n## My overlay\nkeepme\n");
    const r = run(["update", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    const c = read(d, "CLAUDE.md");
    assert.strictEqual(count(c, ">>> teamentic: managed"), 1, "exactly one teamentic block");
    assert.strictEqual(count(c, "tdd-pairing: managed"), 0, "no legacy marker remains");
    assert.ok(c.includes("keepme"), "overlay preserved");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("migration: .gitignore legacy block is migrated, not duplicated", () => {
  const d = legacyInstall();
  try {
    run(["update", d]);
    const gi = read(d, ".gitignore");
    assert.strictEqual(count(gi, ">>> teamentic (managed)"), 1, "one teamentic gitignore block");
    assert.strictEqual(count(gi, "tdd-pairing (managed)"), 0, "no legacy gitignore marker");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("migration: a legacy .tdd-pairing manifest is honored (no spurious .bak)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-migman-"));
  try {
    const rel = path.join(".claude", "hooks", "run-suite.sh");
    fs.mkdirSync(path.join(d, ".claude", "hooks"), { recursive: true });
    const oldContent = "#!/usr/bin/env bash\n# an older kit run-suite\nexit 0\n";
    fs.writeFileSync(path.join(d, rel), oldContent);
    const sha = crypto.createHash("sha256").update(oldContent).digest("hex");
    fs.mkdirSync(path.join(d, ".claude", ".tdd-pairing"), { recursive: true });
    fs.writeFileSync(path.join(d, ".claude", ".tdd-pairing", "manifest.json"),
      JSON.stringify({ kit: "create-tdd-pairing", kitVersion: "0.4.0", files: { [rel]: { class: "mechanism", version: "0.4.0", sha256: sha } } }));
    run(["update", d]);
    assert.ok(!fs.existsSync(path.join(d, rel + ".bak")), "legacy-tracked file refreshed without a spurious .bak");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
