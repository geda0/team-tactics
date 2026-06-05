"use strict";
// spool store: TIC_STORE=spool writes one file per tic to .claude/state/tics.d/ (concurrency-safe
// for parallel writers — no shared-file append/seq race); the views merge spool + jsonl.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const KIT_HOOKS = path.join(__dirname, "..", "kit", "claude-config", "hooks");
const CLI = path.join(__dirname, "..", "bin", "cli.js");

function sandbox(store) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-spool-"));
  const sh = path.join(d, ".claude", "hooks"), st = path.join(d, ".claude", "state");
  fs.mkdirSync(sh, { recursive: true }); fs.mkdirSync(st, { recursive: true });
  fs.copyFileSync(path.join(KIT_HOOKS, "lib.sh"), path.join(sh, "lib.sh"));
  fs.copyFileSync(path.join(require("@ttics/tics").KIT, "hooks", "tics-lib.sh"), path.join(sh, "tics-lib.sh"));
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), `LAYERS="app"\nALL_TEST_CMD="true"\nTEST_CMD_app="true"\nTIC_STORE="${store}"\n`);
  fs.writeFileSync(path.join(st, "phase"), "green\n"); fs.writeFileSync(path.join(st, "layer"), "app\n");
  return d;
}
const srcLib = (d, s) => cp.spawnSync("bash", ["-c", `. "${d}/.claude/hooks/lib.sh"; ${s}`], { encoding: "utf8", cwd: d });
const run = (args, d) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: d || os.tmpdir() });

test("TIC_STORE=spool writes one file per tic to tics.d/, not tics.jsonl", () => {
  const d = sandbox("spool");
  try {
    srcLib(d, `emit_tic a b note "one"`);
    srcLib(d, `emit_tic c d note "two"`);
    const sd = path.join(d, ".claude", "state", "tics.d");
    const files = fs.readdirSync(sd).filter((f) => f.endsWith(".json"));
    assert.strictEqual(files.length, 2, "two spool files (concurrency-safe, no shared append)");
    assert.ok(!fs.existsSync(path.join(d, ".claude", "state", "tics.jsonl")), "no jsonl in spool mode");
    const msgs = files.map((f) => JSON.parse(fs.readFileSync(path.join(sd, f), "utf8")).msg).sort();
    assert.deepStrictEqual(msgs, ["one", "two"]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("default store is jsonl (append); no tics.d/", () => {
  const d = sandbox("jsonl");
  try {
    srcLib(d, `emit_tic a b note "x"`);
    assert.ok(fs.existsSync(path.join(d, ".claude", "state", "tics.jsonl")), "jsonl written");
    assert.ok(!fs.existsSync(path.join(d, ".claude", "state", "tics.d")), "no spool dir");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics log` merges spool files + jsonl, chronologically", () => {
  const d = sandbox("spool");
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ ts: "2020-01-01T00:00:00Z", seq: 1, kind: "note", from: "old", to: "*", scope: "*", msg: "from jsonl" }) + "\n");
    srcLib(d, `emit_tic orchestrator x delegate "spooled" S1`);
    const r = run(["log", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /spooled/, "spool tic shown");
    assert.match(r.stdout, /from jsonl/, "jsonl tic shown");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
