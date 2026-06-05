"use strict";
// Rename migration: `team-tactics` (cmd `tics`) `update` on a PRIOR-brand install
// (create-tdd-pairing OR teamentic) must migrate the managed markers + manifest IN PLACE —
// never append a duplicate block or spuriously .bak a file the legacy manifest tracked.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), crypto = require("crypto");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const read = (d, ...p) => fs.readFileSync(path.join(d, ...p), "utf8");
const count = (s, sub) => s.split(sub).length - 1;

// A fresh install, rewritten to look like a prior brand (default tdd-pairing).
function legacyInstall(brand) {
  brand = brand || "tdd-pairing";
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-migrate-"));
  run([d]);
  for (const f of ["CLAUDE.md", "AGENTS.md"])
    fs.writeFileSync(path.join(d, f), read(d, f).split("team-tactics: managed").join(brand + ": managed"));
  fs.writeFileSync(path.join(d, ".gitignore"),
    read(d, ".gitignore").split("team-tactics (managed)").join(brand + " (managed)"));
  fs.mkdirSync(path.join(d, ".claude", "." + brand), { recursive: true });
  fs.renameSync(path.join(d, ".claude", ".team-tactics", "manifest.json"),
                path.join(d, ".claude", "." + brand, "manifest.json"));
  fs.rmdirSync(path.join(d, ".claude", ".team-tactics"));
  return d;
}

for (const brand of ["tdd-pairing", "teamentic"]) {
  test(`migration (${brand} -> team-tactics): entry-doc block replaced in place, overlay kept`, () => {
    const d = legacyInstall(brand);
    try {
      fs.appendFileSync(path.join(d, "CLAUDE.md"), "\n## My overlay\nkeepme\n");
      const r = run(["update", d]);
      assert.strictEqual(r.status, 0, r.stderr);
      const c = read(d, "CLAUDE.md");
      assert.strictEqual(count(c, ">>> team-tactics: managed"), 1, "one team-tactics block");
      assert.strictEqual(count(c, brand + ": managed"), 0, "no legacy marker remains");
      assert.ok(c.includes("keepme"), "overlay preserved");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  test(`migration (${brand} -> team-tactics): .gitignore block migrated, not duplicated`, () => {
    const d = legacyInstall(brand);
    try {
      run(["update", d]);
      const gi = read(d, ".gitignore");
      assert.strictEqual(count(gi, ">>> team-tactics (managed)"), 1, "one team-tactics gitignore block");
      assert.strictEqual(count(gi, brand + " (managed)"), 0, "no legacy gitignore marker");
      assert.ok(fs.existsSync(path.join(d, ".claude", ".team-tactics", "manifest.json")), "new manifest written");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  test(`migration (${brand} -> team-tactics): a .${brand} manifest is honored (no spurious .bak)`, () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-migman-"));
    try {
      const rel = path.join(".claude", "hooks", "run-suite.sh");
      fs.mkdirSync(path.join(d, ".claude", "hooks"), { recursive: true });
      const oldContent = "#!/usr/bin/env bash\n# an older kit run-suite\nexit 0\n";
      fs.writeFileSync(path.join(d, rel), oldContent);
      const sha = crypto.createHash("sha256").update(oldContent).digest("hex");
      fs.mkdirSync(path.join(d, ".claude", "." + brand), { recursive: true });
      fs.writeFileSync(path.join(d, ".claude", "." + brand, "manifest.json"),
        JSON.stringify({ kit: brand, kitVersion: "0.4.0", files: { [rel]: { class: "mechanism", version: "0.4.0", sha256: sha } } }));
      run(["update", d]);
      assert.ok(!fs.existsSync(path.join(d, rel + ".bak")), "legacy-tracked file refreshed without a spurious .bak");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
}
