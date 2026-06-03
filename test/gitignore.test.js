"use strict";
// P1-6: install/update maintains a marker-delimited managed block in .gitignore that
// ignores the TRANSIENT kit artifacts (suite-status, telemetry.jsonl, .bak, sidecars)
// while leaving durable state (plan.md/progress.md/…) tracked. Idempotent; preserves user lines.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");

const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }
const GI = (d) => fs.readFileSync(path.join(d, ".gitignore"), "utf8");
const START = /# >>> tdd-pairing \(managed\) >>>/g;

test("install adds a managed block: transient ignored, durable state NOT", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-gi-"));
  try {
    run([d]);
    const gi = GI(d);
    assert.match(gi, START, "managed block present");
    assert.match(gi, /\.claude\/state\/suite-status/);
    assert.match(gi, /\.claude\/state\/telemetry\.jsonl/);
    assert.doesNotMatch(gi, /state\/progress\.md|state\/plan\.md/, "durable state stays tracked");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("preserves existing user .gitignore lines and is idempotent across update", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-gi-"));
  try {
    fs.writeFileSync(path.join(d, ".gitignore"), "node_modules/\n.env\n");
    run([d]);            // install
    run(["update", d], d); // update again
    const gi = GI(d);
    assert.match(gi, /node_modules\//, "user line preserved");
    assert.match(gi, /\.env/, "user line preserved");
    assert.strictEqual((gi.match(START) || []).length, 1, "exactly one managed block (idempotent)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
