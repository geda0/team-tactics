"use strict";
// @ttics/tics — the protocol package: emit (tics-lib.sh) + the reader (tics-view.cjs via the bin).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const BIN = path.join(__dirname, "..", "bin", "tics.js");
const ENV = (() => { const e = { ...process.env }; ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_COMMON_DIR"].forEach((k) => delete e[k]); return e; })();

function inst(store) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tics-t-"));
  cp.spawnSync("node", [BIN, "init", d], { encoding: "utf8" });
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'TIC_STORE="' + (store || "jsonl") + '"\n');
  fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "off\n");
  fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
  return d;
}
const read = (d, ...a) => cp.spawnSync(path.join(d, ".claude", "hooks", "tics"), a, { cwd: d, encoding: "utf8" });
const node = (...a) => cp.spawnSync("node", [BIN, ...a], { encoding: "utf8" });
const git = (d, ...a) => cp.spawnSync("git", ["-C", d, "-c", "user.email=a@b.c", "-c", "user.name=x", ...a], { encoding: "utf8", env: ENV });
const ticsOf = (d) => fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const srcLib = (d, s) => cp.spawnSync("bash", ["-c", '. "' + path.join(d, ".claude", "hooks", "tics-lib.sh") + '"; ' + s], { encoding: "utf8", cwd: d });

test("emit_tic appends a valid, auto-filled tic; seq increments", () => {
  const d = inst();
  try {
    srcLib(d, "emit_tic orchestrator test-writer delegate 'slice S2' S2");
    const t = ticsOf(d);
    assert.strictEqual(t.length, 1);
    assert.deepStrictEqual([t[0].kind, t[0].from, t[0].to, t[0].phase, t[0].layer], ["delegate", "orchestrator", "test-writer", "off", "app"]);
    srcLib(d, "emit_tic a b note second");
    assert.strictEqual(ticsOf(d)[1].seq, 2);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("TICS_SCOPE overrides scope per call (fan-out)", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "frontend\n");
    srcLib(d, "export TICS_SCOPE='explore/ranking'; emit_tic x '*' note hi");
    assert.strictEqual(ticsOf(d).pop().scope, "explore/ranking");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("TIC_STORE=spool + TICS_DIR writes one file per tic to a shared bus", () => {
  const d = inst("spool"); const bus = fs.mkdtempSync(path.join(os.tmpdir(), "tics-bus-"));
  try {
    srcLib(d, "export TICS_DIR='" + bus + "'; emit_tic a b note one");
    srcLib(d, "export TICS_DIR='" + bus + "'; emit_tic c d note two");
    assert.strictEqual(fs.readdirSync(bus).filter((f) => f.endsWith(".json")).length, 2);
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(bus, { recursive: true, force: true }); }
});

test("tics log renders + --scope filters hierarchically; sections summarizes", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SCOPE='ranking/S2'; emit_tic o tw delegate rank r");
    srcLib(d, "export TICS_SCOPE='narrate/S1'; emit_tic o impl delegate line l");
    assert.match(read(d, "log").stdout, /rank/);
    const rk = read(d, "log", "--scope", "ranking");
    assert.match(rk.stdout, /rank/); assert.doesNotMatch(rk.stdout, /line/);
    const sec = read(d, "sections").stdout;
    assert.match(sec, /ranking/); assert.match(sec, /narrate/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("coupling views: conductor, claims, claim-check, gate, cycle", () => {
  const d = inst();
  try {
    srcLib(d, "emit_tic inv '*' contract StockLevel StockLevel");
    srcLib(d, "export TICS_SCOPE='inv/S1'; emit_tic inv '*' claim kernel.ts kernel.ts");
    assert.match(read(d, "conductor").stdout, /contract/);
    assert.match(read(d, "claims").stdout, /kernel.ts/);
    assert.strictEqual(node("claim-check", "kernel.ts", "ord/S2", d).status, 3);
    assert.strictEqual(node("claim-check", "kernel.ts", "inv/S1", d).status, 0);
    assert.notStrictEqual(read(d, "gate").status, 0);             // no PO/critic verdict
    assert.match(read(d, "cycle").stdout, /phase=off/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics claim-owner <file>: reports the owning scope, empty when unclaimed (feeds auto-claim)", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SCOPE='inv/S1'; emit_tic inv '*' claim kernel.ts kernel.ts");
    const owned = read(d, "claim-owner", "kernel.ts");
    assert.strictEqual(owned.status, 0, "lookup succeeds");
    assert.match(owned.stdout, /inv\/S1/, "names the owning scope");
    const free = read(d, "claim-owner", "free.ts");
    assert.strictEqual(free.status, 0, "unclaimed lookup still succeeds");
    assert.strictEqual(free.stdout.trim(), "", "unclaimed file has no owner");
    srcLib(d, "export TICS_SCOPE='inv/S1'; emit_tic inv '*' release kernel.ts kernel.ts");
    assert.strictEqual(read(d, "claim-owner", "kernel.ts").stdout.trim(), "", "released file has no owner");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics log --all merges sibling worktree buses", () => {
  const d = inst(); const wt = d + "-wt";
  try {
    git(d, "init", "-q"); git(d, "add", "-A"); git(d, "commit", "-qm", "init");
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:00Z", seq: 1, kind: "note", from: "m", to: "*", msg: "in MAIN", scope: "*" }) + "\n");
    git(d, "worktree", "add", "-q", wt, "-b", "side");
    fs.mkdirSync(path.join(wt, ".claude", "state"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:05Z", seq: 1, kind: "note", from: "s", to: "*", msg: "in SIDE", scope: "*" }) + "\n");
    assert.doesNotMatch(node("log", d).stdout, /in SIDE/);
    assert.match(node("log", "--all", d).stdout, /in SIDE/);
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

test("selftest passes (emit + read round-trip)", () => {
  assert.strictEqual(node("selftest").status, 0);
});
