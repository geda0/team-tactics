"use strict";
// tic views: `tics log` (the thread), `tics inbox <role>` (to in {role,*}), `tics report` (signal tics + telemetry fallback).
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const T = (o) => Object.assign({ ts: "2026-06-04T01:00:00Z", seq: 1, kind: "note", from: "a", to: "*", phase: "green", layer: "app", scope: "*", msg: "", ref: "", result: "" }, o);
function freshWithTics(lines) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-view-"));
  run([d]);
  fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return d;
}

test("`tics log` renders the thread (from->to, kind, msg, result); skips junk lines", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "delegate", from: "orchestrator", to: "test-writer", msg: "slice S2" }),
    T({ seq: 2, kind: "signal", from: "run-suite", to: "*", result: "red", msg: "[app] suite red" }),
    T({ seq: 3, kind: "handoff", from: "test-writer", to: "orchestrator", result: "red", msg: "added failing test" }),
  ]);
  try {
    fs.appendFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "junk not json\n");
    const r = run(["log", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /orchestrator -> test-writer/);
    for (const k of ["delegate", "signal", "handoff", "slice S2"]) assert.match(r.stdout, new RegExp(k));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics inbox <role>` shows tics to the role or broadcast, excludes others", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "msg", from: "navigator", to: "architect", msg: "use option B" }),
    T({ seq: 2, kind: "msg", from: "orchestrator", to: "*", msg: "standup" }),
    T({ seq: 3, kind: "msg", from: "navigator", to: "implementer", msg: "not for arch" }),
  ]);
  try {
    const r = run(["inbox", "architect", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /use option B/);
    assert.match(r.stdout, /standup/);
    assert.doesNotMatch(r.stdout, /not for arch/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics report` reads signal tics (per-layer metrics)", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "signal", layer: "app", phase: "red", result: "red", durationSec: 3 }),
    T({ seq: 2, kind: "signal", layer: "app", phase: "green", result: "green", durationSec: 5 }),
    T({ seq: 3, kind: "delegate", from: "orchestrator", to: "x" }),
  ]);
  try {
    const r = run(["report", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /app/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E8-2: tics report splits greens into hook-signed vs self-reported and calls out unrefereed greens", () => {
  const mixed = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green" }),
    T({ seq: 2, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green" }),
    T({ seq: 3, kind: "signal", from: "implementer", to: "*", result: "green", msg: "[app] suite green" }),
    T({ seq: 4, kind: "signal", from: "run-suite", to: "*", result: "red", msg: "[app] suite red" }),
  ]);
  try {
    const r = run(["report", mixed]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /hook-signed[^0-9]*2/i, "reports 2 hook-signed greens");
    assert.match(r.stdout, /self-reported[^0-9]*1/i, "reports 1 self-reported green");
    assert.match(r.stdout, /unrefereed|not refereed/i, "LOUD call-out when a self-reported green exists");
  } finally { fs.rmSync(mixed, { recursive: true, force: true }); }

  const allRefereed = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green" }),
    T({ seq: 2, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green" }),
  ]);
  try {
    const r = run(["report", allRefereed]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /unrefereed|not refereed/i, "no call-out when every green is hook-signed");
  } finally { fs.rmSync(allRefereed, { recursive: true, force: true }); }
});

test("`tics report` falls back to legacy telemetry.jsonl when tics.jsonl is absent", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-view-"));
  run([d]);
  try {
    fs.rmSync(path.join(d, ".claude", "state", "tics.jsonl"), { force: true });
    fs.writeFileSync(path.join(d, ".claude", "state", "telemetry.jsonl"),
      JSON.stringify({ ts: "x", event: "suite", layer: "app", phase: "green", result: "green", exit: 0, durationSec: 4 }) + "\n");
    const r = run(["report", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /app/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics log --scope` shows that scope + global (*), hides others", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "signal", scope: "pair:S2", msg: "S2 green", result: "green" }),
    T({ seq: 2, kind: "msg", scope: "*", from: "navigator", msg: "global note" }),
    T({ seq: 3, kind: "signal", scope: "pair:S5", msg: "S5 red", result: "red" }),
  ]);
  try {
    const r = run(["log", "--scope", "pair:S2", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /S2 green/);
    assert.match(r.stdout, /global note/);
    assert.doesNotMatch(r.stdout, /S5 red/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics inbox <role> --scope` filters by addressee AND scope", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "msg", to: "implementer", scope: "pair:S2", msg: "for impl in S2" }),
    T({ seq: 2, kind: "msg", to: "implementer", scope: "pair:S5", msg: "for impl in S5" }),
    T({ seq: 3, kind: "msg", to: "*", scope: "*", msg: "global broadcast" }),
  ]);
  try {
    const r = run(["inbox", "implementer", "--scope", "pair:S2", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /for impl in S2/);
    assert.match(r.stdout, /global broadcast/);
    assert.doesNotMatch(r.stdout, /for impl in S5/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics conductor` shows only coupling kinds (claim/release/contract/need/msg), hides pairing noise", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "contract", from: "architect", to: "*", scope: "contract:RankedFeed", msg: "seam ready" }),
    T({ seq: 2, kind: "claim", from: "pairA", to: "*", scope: "pair:S2", ref: "backend/feed.ts", msg: "own feed" }),
    T({ seq: 3, kind: "signal", from: "run-suite", to: "*", scope: "pair:S2", result: "green", msg: "S2 green" }),
    T({ seq: 4, kind: "delegate", from: "orchestrator", to: "impl", scope: "pair:S2", msg: "do S2" }),
    T({ seq: 5, kind: "need", from: "pairB", to: "architect", msg: "need the feed contract" }),
  ]);
  try {
    const r = run(["conductor", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    for (const m of ["seam ready", "own feed", "need the feed contract"]) assert.match(r.stdout, new RegExp(m));
    assert.doesNotMatch(r.stdout, /S2 green/);   // signal = pairing noise to the conductor
    assert.doesNotMatch(r.stdout, /do S2/);       // delegate = pairing noise
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics claims` lists active claims (claim minus release), by scope", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "claim", scope: "pair:S2", ref: "backend/feed.ts", msg: "own" }),
    T({ seq: 2, kind: "claim", scope: "pair:S5", ref: "frontend/app.tsx", msg: "own" }),
    T({ seq: 3, kind: "release", scope: "pair:S2", ref: "backend/feed.ts", msg: "done" }),
  ]);
  try {
    const r = run(["claims", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /frontend\/app\.tsx/);       // still claimed by S5
    assert.match(r.stdout, /pair:S5/);
    assert.doesNotMatch(r.stdout, /backend\/feed\.ts/); // released by S2
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("installed .claude/hooks/tics is a local reader (inbox/log) — agents read where they are, even in a type:module repo", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rdr-"));
  run([d]); // install ships .claude/hooks/tics (shell wrapper) + tics-view.cjs
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({ name: "host", type: "module" })); // ESM host: reader must still work
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      [JSON.stringify(T({ seq: 1, kind: "msg", to: "implementer", scope: "frontend", msg: "for impl" })),
       JSON.stringify(T({ seq: 2, kind: "signal", to: "*", scope: "frontend", result: "green", msg: "suite green" }))].join("\n") + "\n");
    const reader = path.join(d, ".claude", "hooks", "tics");
    const ib = cp.spawnSync(reader, ["inbox", "implementer"], { encoding: "utf8", cwd: d });
    assert.strictEqual(ib.status, 0, ib.stderr);
    assert.match(ib.stdout, /for impl/);
    const lg = cp.spawnSync(reader, ["log"], { encoding: "utf8", cwd: d });
    assert.match(lg.stdout, /suite green/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("installed JS hooks carry an eslint-disable header (don't break a host's lint)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-lint-"));
  run([d]);
  try {
    assert.match(fs.readFileSync(path.join(d, ".claude", "hooks", "tics-view.cjs"), "utf8"), /eslint-disable/);
    const _w = fs.readFileSync(path.join(d, ".claude", "hooks", "tics"), "utf8");
    assert.match(_w, /^#!\/bin\/sh/); assert.match(_w, /tics-view\.cjs/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics log folds consecutive run-suite signals of the same result (x N); store untouched", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[frontend] suite green" }),
    T({ seq: 2, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[frontend] suite green" }),
    T({ seq: 3, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[frontend] suite green" }),
    T({ seq: 4, kind: "signal", from: "run-suite", to: "*", result: "red", msg: "[frontend] suite red" }),
  ]);
  try {
    const r = run(["log", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /suite green x3/, "the three greens fold into one row");
    assert.strictEqual((r.stdout.match(/suite (green|red)/g) || []).length, 2, "view shows 2 signal rows, not 4");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a non-signal tic between run-suite signals breaks the fold (distinct steps stay distinct)", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "suite green" }),
    T({ seq: 2, kind: "handoff", from: "implementer", to: "orchestrator", result: "green", msg: "did the thing" }),
    T({ seq: 3, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "suite green" }),
  ]);
  try {
    const r = run(["log", d]);
    assert.strictEqual((r.stdout.match(/suite green/g) || []).length, 2, "not folded across the handoff");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("worktree sections share one bus: TICS_DIR in tdd.config unifies emit + reader (conductor correlates across sections)", () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "tt-bus-"));
  const A = fs.mkdtempSync(path.join(os.tmpdir(), "tt-wtA-"));
  const B = fs.mkdtempSync(path.join(os.tmpdir(), "tt-wtB-"));
  run([A]); run([B]);
  for (const d of [A, B]) {
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nTIC_STORE=spool\nTICS_DIR='" + shared + "'\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "off\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
  }
  fs.writeFileSync(path.join(A, ".claude", "state", "scope"), "inventory/S1\n");
  fs.writeFileSync(path.join(B, ".claude", "state", "scope"), "orders/S2\n");
  try {
    cp.spawnSync(path.join(A, ".claude", "hooks", "tic.sh"), ["architect", "orders", "contract", "StockLevel", "StockLevel"], { cwd: A, encoding: "utf8" });
    cp.spawnSync(path.join(B, ".claude", "hooks", "tic.sh"), ["ord-pair", "inventory", "need", "need StockLevel", "StockLevel"], { cwd: B, encoding: "utf8" });
    const la = cp.spawnSync(path.join(A, ".claude", "hooks", "tics"), ["log"], { cwd: A, encoding: "utf8" });
    assert.strictEqual(la.status, 0, la.stderr);
    assert.match(la.stdout, /contract/, "A's reader sees the contract");
    assert.match(la.stdout, /need/, "A's reader also sees orders' need (shared bus)");
    const cd = cp.spawnSync(path.join(B, ".claude", "hooks", "tics"), ["conductor"], { cwd: B, encoding: "utf8" });
    assert.match(cd.stdout, /contract/); assert.match(cd.stdout, /need/);
  } finally { [A, B, shared].forEach((x) => fs.rmSync(x, { recursive: true, force: true })); }
});

test("tics claim-check: blocks a path held by another scope, allows own/released/unscoped (P1)", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "claim", from: "inv-pair", to: "*", scope: "inventory/S1", ref: "kernel/types.ts", msg: "kernel/types.ts" }),
    T({ seq: 2, kind: "claim", from: "ord-pair", to: "*", scope: "orders/S2", ref: "orders/cart.ts", msg: "orders/cart.ts" }),
    T({ seq: 3, kind: "release", from: "ord-pair", to: "*", scope: "orders/S2", ref: "orders/cart.ts" }),
  ]);
  const reader = path.join(d, ".claude", "hooks", "tics");
  try {
    const conflict = cp.spawnSync(reader, ["claim-check", "kernel/types.ts", "orders/S2"], { encoding: "utf8", cwd: d });
    assert.strictEqual(conflict.status, 3, "cross-scope claim is a conflict");
    assert.match(conflict.stdout, /inventory\/S1/, "names the holder");
    const own = cp.spawnSync(reader, ["claim-check", "kernel/types.ts", "inventory/S1"], { encoding: "utf8", cwd: d });
    assert.strictEqual(own.status, 0, "owner may edit its own claim");
    const released = cp.spawnSync(reader, ["claim-check", "orders/cart.ts", "inventory/S1"], { encoding: "utf8", cwd: d });
    assert.strictEqual(released.status, 0, "released claim no longer blocks");
    const unscoped = cp.spawnSync(reader, ["claim-check", "kernel/types.ts", ""], { encoding: "utf8", cwd: d });
    assert.strictEqual(unscoped.status, 0, "unscoped editor bypasses claims");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("guard-edit-scope auto-opens a section on first scoped edit, idempotently (P1)", () => {
  const d = freshWithTics([]);                         // empty bus: section 'orders' not yet opened
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "refactor\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "orders/S2\n");
    const guard = path.join(d, ".claude", "hooks", "guard-edit-scope.sh");
    const reader = path.join(d, ".claude", "hooks", "tics");
    const edit = (f) => cp.spawnSync("bash", [guard], { input: JSON.stringify({ tool_input: { file_path: f } }), encoding: "utf8", cwd: d });
    edit("src/cart.ts");
    assert.match(cp.spawnSync(reader, ["section-status", "orders"], { encoding: "utf8", cwd: d }).stdout, /open/, "the section auto-opened");
    assert.match(cp.spawnSync(reader, ["sections"], { encoding: "utf8", cwd: d }).stdout, /orders/, "the partition map shows it");
    edit("src/other.ts");                              // a second, different file in the same section
    const opens = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n")
      .map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } })
      .filter((x) => x.kind === "section" && x.ref === "orders");
    assert.strictEqual(opens.length, 1, "the section opens once, not on every edit");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("guard-edit-scope auto-claims an unclaimed file on edit when scoped, idempotently (P1)", () => {
  const d = freshWithTics([]);                          // empty bus: src/kernel.ts starts unclaimed
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "refactor\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "orders/S2\n");
    const guard = path.join(d, ".claude", "hooks", "guard-edit-scope.sh");
    const reader = path.join(d, ".claude", "hooks", "tics");
    const payload = JSON.stringify({ tool_input: { file_path: "src/kernel.ts" } });
    const r1 = cp.spawnSync("bash", [guard], { input: payload, encoding: "utf8", cwd: d });
    assert.strictEqual(r1.status, 0, "editing an unclaimed file is allowed");
    const owner = cp.spawnSync(reader, ["claim-owner", "src/kernel.ts"], { encoding: "utf8", cwd: d });
    assert.match(owner.stdout, /orders\/S2/, "the guard auto-claimed the file for the editing scope");
    cp.spawnSync("bash", [guard], { input: payload, encoding: "utf8", cwd: d });   // edit again, same scope
    const claims = fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n")
      .map((l) => { try { return JSON.parse(l); } catch (e) { return {}; } })
      .filter((x) => x.kind === "claim" && x.ref === "src/kernel.ts");
    assert.strictEqual(claims.length, 1, "auto-claim fires once, not on every edit (no telemetry spam)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("guard-edit-scope enforces claims: blocks an edit to a file held by another scope (P1)", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "claim", from: "inv-pair", to: "*", scope: "inventory/S1", ref: "src/kernel.ts", msg: "src/kernel.ts" }),
  ]);
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "refactor\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "orders/S2\n");
    const guard = path.join(d, ".claude", "hooks", "guard-edit-scope.sh");
    const payload = JSON.stringify({ tool_input: { file_path: "src/kernel.ts" } });
    const blocked = cp.spawnSync("bash", [guard], { input: payload, encoding: "utf8", cwd: d });
    assert.strictEqual(blocked.status, 2, "blocked: held by inventory/S1");
    assert.match(blocked.stderr, /claim|held/i);
    const log = cp.spawnSync(path.join(d, ".claude", "hooks", "tics"), ["log"], { encoding: "utf8", cwd: d });
    assert.match(log.stdout, /need/, "a need tic surfaces the conflict");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "inventory/S1\n");
    const ok = cp.spawnSync("bash", [guard], { input: payload, encoding: "utf8", cwd: d });
    assert.strictEqual(ok.status, 0, "owner may edit its own claim");
    fs.writeFileSync(path.join(d, ".claude", "state", "scope"), "orders/S2\n");
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nCLAIMS_ENFORCE=0\n");
    const disarmed = cp.spawnSync("bash", [guard], { input: payload, encoding: "utf8", cwd: d });
    assert.strictEqual(disarmed.status, 0, "CLAIMS_ENFORCE=0 disarms enforcement");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics cycle shows phase/layer and nudges a tdd-critic pass after enough cycles", () => {
  const lines = [T({ seq: 1, kind: "verdict", from: "tdd-critic", to: "orchestrator", result: "pass", msg: "ok" })];
  for (let i = 0; i < 6; i++) lines.push(T({ seq: 2 + i, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "suite green" }));
  const d = freshWithTics(lines);
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "green\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "frontend\n");
    const r = run(["cycle", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /phase=green/); assert.match(r.stdout, /layer=frontend/);
    assert.match(r.stdout, /6/, "counts cycles since the last verdict");
    assert.match(r.stdout, /critic/i, "nudges a critic pass");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics cycle does not nudge the critic right after a verdict", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", result: "green", msg: "g" }),
    T({ seq: 2, kind: "verdict", from: "tdd-critic", to: "orchestrator", result: "pass", msg: "ok" }),
  ]);
  try {
    const r = run(["cycle", d]);
    assert.doesNotMatch(r.stdout, /consider/i, "no nudge when a verdict is recent");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("update migrates the stale tics-view.js reader to .cjs", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mig-"));
  run([d]);
  fs.writeFileSync(path.join(d, ".claude", "hooks", "tics-view.js"), "// stale CJS-as-.js\n");
  try {
    run([d]); // update
    assert.ok(!fs.existsSync(path.join(d, ".claude", "hooks", "tics-view.js")), "stale .js removed");
    assert.ok(fs.existsSync(path.join(d, ".claude", "hooks", "tics-view.cjs")), ".cjs present");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("scope is hierarchical: --scope <section> matches its pairs; --scope <pair> matches its section", () => {
  const d = freshWithTics([
    T({ seq: 1, scope: "ranking", kind: "contract", msg: "section-level" }),
    T({ seq: 2, scope: "ranking/S2", kind: "signal", result: "green", msg: "pair S2" }),
    T({ seq: 3, scope: "ranking/S5", kind: "signal", result: "green", msg: "pair S5 sibling" }),
    T({ seq: 4, scope: "narrate", kind: "signal", result: "green", msg: "other section" }),
    T({ seq: 5, scope: "*", kind: "msg", msg: "global beacon" }),
  ]);
  try {
    const sec = run(["log", "--scope", "ranking", d]);
    for (const m of ["section-level", "pair S2", "pair S5", "global beacon"]) assert.match(sec.stdout, new RegExp(m));
    assert.doesNotMatch(sec.stdout, /other section/);
    const pair = run(["log", "--scope", "ranking/S2", d]);
    for (const m of ["pair S2", "section-level", "global beacon"]) assert.match(pair.stdout, new RegExp(m));
    assert.doesNotMatch(pair.stdout, /pair S5 sibling/);
    assert.doesNotMatch(pair.stdout, /other section/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("`tics sections` summarizes activity per section (top-level scope segment)", () => {
  const d = freshWithTics([
    T({ seq: 1, scope: "ranking/S2", kind: "signal", result: "green", msg: "x" }),
    T({ seq: 2, scope: "ranking", kind: "claim", ref: "backend/feed.ts", msg: "own" }),
    T({ seq: 3, scope: "narrate/S1", kind: "signal", result: "red", msg: "y" }),
    T({ seq: 4, scope: "*", kind: "msg", msg: "global" }),
  ]);
  try {
    const r = run(["sections", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /ranking/);
    assert.match(r.stdout, /narrate/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("full-team preset seeds .claude/state/sections.md (the context map)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sec-"));
  run(["--preset", "full-team", d]);
  try { assert.ok(fs.existsSync(path.join(d, ".claude", "state", "sections.md")), "sections.md seeded"); }
  finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics gate is CLEAR when product-owner + tdd-critic verdicts pass, BLOCKED otherwise", () => {
  const pass = freshWithTics([
    T({ seq: 1, kind: "verdict", from: "tdd-critic", to: "orchestrator", result: "pass", msg: "M4 audit clean" }),
    T({ seq: 2, kind: "verdict", from: "product-owner", to: "orchestrator", result: "pass", msg: "M4 accepted" }),
  ]);
  try {
    const r = run(["gate", pass]);
    assert.strictEqual(r.status, 0, "clear: " + r.stderr);
    assert.match(r.stdout, /CLEAR/i);
  } finally { fs.rmSync(pass, { recursive: true, force: true }); }
  const blocked = freshWithTics([
    T({ seq: 1, kind: "verdict", from: "tdd-critic", to: "orchestrator", result: "concerns", msg: "owes cost-gating proof" }),
  ]);
  try {
    const r = run(["gate", blocked]);
    assert.notStrictEqual(r.status, 0, "blocked");
    assert.match(r.stdout + r.stderr, /BLOCK/i);
    assert.match(r.stdout + r.stderr, /product-owner/, "names the missing PO verdict");
    assert.match(r.stdout + r.stderr, /tdd-critic/, "names the critic concerns");
  } finally { fs.rmSync(blocked, { recursive: true, force: true }); }
});

test("tics gate recognizes product-owner ACCEPT / approved (verdict vocabulary, not just result=pass)", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "verdict", from: "tdd-critic", to: "orchestrator", result: "pass", msg: "audit clean" }),
    T({ seq: 2, kind: "verdict", from: "product-owner", to: "orchestrator", msg: "ACCEPT M4 (all clauses proven)" }),
  ]);
  try {
    const r = run(["gate", d]);
    assert.strictEqual(r.status, 0, "ACCEPT counts as pass: " + (r.stdout + r.stderr));
    assert.match(r.stdout, /CLEAR/i);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E12-1: tics report tallies per-tool usage from witness notes (from=witness only); no witness notes -> no tally", () => {
  // A signal keeps report from short-circuiting; the witness notes drive the tally.
  // The architect's `used Read` note is a NON-witness control: it must NOT be counted.
  const withWitness = freshWithTics([
    T({ seq: 1, kind: "note", from: "witness", to: "*", msg: "used Read" }),
    T({ seq: 2, kind: "note", from: "witness", to: "*", msg: "used Read" }),
    T({ seq: 3, kind: "note", from: "witness", to: "*", msg: "used Read" }),
    T({ seq: 4, kind: "note", from: "witness", to: "*", msg: "used Edit" }),
    T({ seq: 5, kind: "note", from: "architect", to: "*", msg: "used Read" }),
    T({ seq: 6, kind: "signal", from: "run-suite", to: "*", layer: "app", phase: "green", result: "green", durationSec: 2 }),
  ]);
  try {
    const r = run(["report", withWitness]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /tool|witness/i, "a per-tool usage tally heading is shown");
    assert.match(r.stdout, /Read[^0-9]*3/, "Read tallies 3 (witness notes only — the architect's note is excluded)");
    assert.match(r.stdout, /Edit[^0-9]*1/, "Edit tallies 1");
  } finally { fs.rmSync(withWitness, { recursive: true, force: true }); }

  // Degrade-safe: a signal but no witness notes -> the tally heading is absent.
  const noWitness = freshWithTics([
    T({ seq: 1, kind: "signal", from: "run-suite", to: "*", layer: "app", phase: "green", result: "green", durationSec: 2 }),
  ]);
  try {
    const r = run(["report", noWitness]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /tool usage|used Read|used Edit/i, "no witness notes -> no tool-usage tally");
  } finally { fs.rmSync(noWitness, { recursive: true, force: true }); }
});

test("CTX-2: tics map folds landmark crumbs newest-per-ref, grouped by type, with retract tombstoning", () => {
  // The context map (`tics map`) folds kind=landmark crumbs keyed by ref (newest-per-ref wins,
  // append order), grouped by crumb TYPE (result: landmark|route|caveat); result=retract tombstones a ref.
  const d = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "landmark", msg: "rankFeed is the entry point" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "landmark", from: "navigator", to: "*", ref: "area:feed", result: "route", msg: "add a source: register sources.ts then rank.ts" }),
    T({ seq: 3, ts: "2026-06-04T01:00:03Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/dedup.ts", result: "caveat", msg: "rank.ts mutates input — clone first" }),
    T({ seq: 4, ts: "2026-06-04T01:00:04Z", kind: "landmark", from: "navigator", to: "*", ref: "area:legacy", result: "landmark", msg: "OLD note about legacy" }),
    T({ seq: 5, ts: "2026-06-04T01:00:05Z", kind: "landmark", from: "navigator", to: "*", ref: "area:legacy", result: "landmark", msg: "FRESH note supersedes it" }),
    T({ seq: 6, ts: "2026-06-04T01:00:06Z", kind: "landmark", from: "navigator", to: "*", ref: "area:gone", result: "landmark", msg: "temporary" }),
    T({ seq: 7, ts: "2026-06-04T01:00:07Z", kind: "landmark", from: "navigator", to: "*", ref: "area:gone", result: "retract", msg: "" }),
  ]);
  try {
    const r = run(["map", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    // the three live crumb messages appear
    assert.match(r.stdout, /rankFeed is the entry point/);
    assert.match(r.stdout, /add a source: register/);
    assert.match(r.stdout, /rank\.ts mutates input/);
    // grouping headers for the types in play
    assert.match(r.stdout, /landmark/i, "groups landmark crumbs under a landmark header");
    assert.match(r.stdout, /route/i, "groups route crumbs under a route header");
    assert.match(r.stdout, /caveat/i, "groups caveat crumbs under a caveat header");
    // supersession: newest-per-ref wins
    assert.match(r.stdout, /FRESH note supersedes it/, "the newest crumb on area:legacy wins");
    assert.doesNotMatch(r.stdout, /OLD note about legacy/, "the older crumb on the same ref is superseded");
    // tombstone: a retract removes the ref from the map
    assert.doesNotMatch(r.stdout, /area:gone/, "a retracted ref is gone from the map");
    assert.doesNotMatch(r.stdout, /temporary/, "the retracted crumb's message is gone too");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CTX-3: tics where <path> and tics how <task> filter the landmark crumbs by path-overlap and by route-term", () => {
  // `tics where <path>` -> landmark crumbs whose ref OVERLAPS <path> (bidirectional substring,
  // newest-per-ref). `tics how <task>` -> result=route crumbs whose ref OR msg contains <task>
  // (case-insensitive). Both are filtered folds of the same map crumbs.
  const d = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "landmark", msg: "RANK ENTRY rankFeed here" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/dedup.ts", result: "caveat", msg: "DEDUP mutates input" }),
    T({ seq: 3, ts: "2026-06-04T01:00:03Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/auth/login.ts", result: "landmark", msg: "AUTH login handler" }),
    T({ seq: 4, ts: "2026-06-04T01:00:04Z", kind: "landmark", from: "navigator", to: "*", ref: "area:feed", result: "route", msg: "ROUTE add a feed source: sources.ts then rank.ts" }),
    T({ seq: 5, ts: "2026-06-04T01:00:05Z", kind: "landmark", from: "navigator", to: "*", ref: "area:auth", result: "route", msg: "ROUTE rotate auth secret via scripts/rotate" }),
  ]);
  try {
    // `where`: exact ref overlap surfaces the matching crumb; a different path does not.
    const exact = run(["where", "backend/src/feed/rank.ts", d]);
    assert.strictEqual(exact.status, 0, exact.stderr);
    assert.match(exact.stdout, /RANK ENTRY/, "the crumb whose ref overlaps the path is shown");
    assert.doesNotMatch(exact.stdout, /AUTH login handler/, "a crumb on a different path is not shown");
    // bidirectional overlap: a dir path is a substring of both feed refs -> both match.
    const dir = run(["where", "backend/src/feed", d]);
    assert.strictEqual(dir.status, 0, dir.stderr);
    assert.match(dir.stdout, /RANK ENTRY/, "dir path overlaps rank.ts ref");
    assert.match(dir.stdout, /DEDUP mutates/, "dir path overlaps dedup.ts ref (bidirectional substring)");

    // `how`: routes matching the term are shown; a non-matching route and a non-route are not.
    const how = run(["how", "feed", d]);
    assert.strictEqual(how.status, 0, how.stderr);
    assert.match(how.stdout, /add a feed source/, "a route matching 'feed' is shown");
    assert.doesNotMatch(how.stdout, /rotate auth secret/, "a route not matching 'feed' is excluded");
    assert.doesNotMatch(how.stdout, /RANK ENTRY/, "a non-route crumb is excluded even though its path matches 'feed'");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CTX-4: tics map retro-folds contract tics (ADRs) as a Decisions group — non-empty on day one", () => {
  // `tics map` ALSO folds kind=contract tics (an architect auto-emits one per ADR) into a
  // distinct `Decisions` group, keyed by ref newest-per-ref, alongside the landmark crumbs —
  // so the map is non-empty before anyone leaves a hand crumb (the cold-start solve).
  const d = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "contract", from: "architect", to: "*", ref: "docs/decisions/0017-judgment-gates.md", msg: "ADR 0017: judgment gates made mechanical" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "contract", from: "architect", to: "*", ref: "docs/decisions/0018-cursor-parity.md", msg: "ADR 0018: three-tier Cursor parity" }),
    T({ seq: 3, ts: "2026-06-04T01:00:03Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "landmark", msg: "rankFeed is the entry point" }),
  ]);
  try {
    const r = run(["map", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /Decisions/, "contracts fold into a Decisions group header");
    assert.match(r.stdout, /ADR 0017: judgment gates/, "the first ADR's message appears");
    assert.match(r.stdout, /ADR 0018: three-tier/, "the second ADR's message appears");
    assert.match(r.stdout, /rankFeed is the entry point/, "the normal landmark crumb still appears (folding contracts didn't break landmark folding)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // Cold-start: ADRs alone (no landmark crumbs) still make the map non-empty.
  const d2 = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "contract", from: "architect", to: "*", ref: "docs/decisions/0017-judgment-gates.md", msg: "ADR 0017: judgment gates made mechanical" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "contract", from: "architect", to: "*", ref: "docs/decisions/0018-cursor-parity.md", msg: "ADR 0018: three-tier Cursor parity" }),
  ]);
  try {
    const r = run(["map", d2]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /ADR 0017/, "the map is non-empty from ADRs alone (cold-start)");
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test("CTX-5: tics map nudges '↻ verify' on a crumb whose path changed in git after its ts; fresh / non-path / non-repo get no nudge", () => {
  // Freshness backstop: for a landmark crumb whose ref is a real repo PATH, if that path's last
  // git commit time is AFTER the crumb's ts, the map appends a soft `/verify/i` marker (prompting
  // re-emission) WITHOUT suppressing the crumb. A crumb newer than the last commit, a non-path ref
  // (area:), and a non-git dir all get NO marker (the git call fails safe).
  const d = freshWithTics([]);                 // installs .claude/; we overwrite the bus below
  cp.execFileSync("git", ["-C", d, "init", "-q"]);
  cp.execFileSync("git", ["-C", d, "config", "user.email", "t@t"]);
  cp.execFileSync("git", ["-C", d, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(d, "src"), { recursive: true });
  fs.writeFileSync(path.join(d, "src", "rank.ts"), "x");
  fs.writeFileSync(path.join(d, "src", "dedup.ts"), "y");
  cp.execFileSync("git", ["-C", d, "add", "src/rank.ts", "src/dedup.ts"]);
  cp.execFileSync("git", ["-C", d, "commit", "-q", "-m", "seed"]);   // commit time ≈ now
  fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), [
    T({ seq: 1, kind: "landmark", from: "navigator", to: "*", ref: "src/rank.ts", result: "landmark", msg: "RANK old crumb", ts: "2020-01-01T00:00:00Z" }),
    T({ seq: 2, kind: "landmark", from: "navigator", to: "*", ref: "src/dedup.ts", result: "landmark", msg: "DEDUP fresh crumb", ts: "2099-01-01T00:00:00Z" }),
    T({ seq: 3, kind: "landmark", from: "navigator", to: "*", ref: "area:feed", result: "route", msg: "AREA route crumb", ts: "2020-01-01T00:00:00Z" }),
  ].map((l) => JSON.stringify(l)).join("\n") + "\n");
  try {
    const r = run(["map", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.split("\n");
    const lineFor = (m) => lines.find((l) => l.indexOf(m) !== -1);
    const rankLine = lineFor("RANK old crumb");
    assert.ok(rankLine, "the stale crumb still appears (never suppressed)");
    assert.match(rankLine, /verify/i, "ts predates the last commit -> soft verify nudge");
    assert.doesNotMatch(lineFor("DEDUP fresh crumb"), /verify/i, "ts newer than the last commit -> no nudge");
    assert.doesNotMatch(lineFor("AREA route crumb"), /verify/i, "a non-path ref (area:) is never git-checked -> no nudge");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // Fail-safe: a non-git dir -> the git call fails safe, the crumb shows with no nudge, no crash.
  const d2 = freshWithTics([
    T({ seq: 1, kind: "landmark", from: "navigator", to: "*", ref: "src/whatever.ts", result: "landmark", msg: "NOREPO crumb", ts: "2020-01-01T00:00:00Z" }),
  ]);
  try {
    const r = run(["map", d2]);
    assert.strictEqual(r.status, 0, r.stderr);
    const noRepoLine = r.stdout.split("\n").find((l) => l.indexOf("NOREPO crumb") !== -1);
    assert.ok(noRepoLine, "the crumb shows even when the dir is not a git repo");
    assert.doesNotMatch(noRepoLine, /verify/i, "no git repo -> git call fails safe -> no nudge");
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test("CTX-8: a landmark and a caveat on the same path coexist (supersede per ref+type), retract clears the ref", () => {
  // Supersession is per (ref, type), not per ref alone: a landmark and a caveat on the SAME path
  // must BOTH survive in the map (one under Landmarks, one under Caveats). A newer crumb of the
  // SAME type on that ref supersedes only its own type. result=retract still clears the whole ref.
  const d = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "landmark", msg: "LANDMARK rankFeed is the entry point" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "caveat", msg: "CAVEAT rank.ts mutates input" }),
    T({ seq: 3, ts: "2026-06-04T01:00:03Z", kind: "landmark", from: "navigator", to: "*", ref: "backend/src/feed/rank.ts", result: "landmark", msg: "LANDMARK-V2 rankFeed moved to ranker.ts" }),
    T({ seq: 4, ts: "2026-06-04T01:00:04Z", kind: "landmark", from: "navigator", to: "*", ref: "area:gone", result: "landmark", msg: "TEMP gone soon" }),
    T({ seq: 5, ts: "2026-06-04T01:00:05Z", kind: "landmark", from: "navigator", to: "*", ref: "area:gone", result: "retract", msg: "" }),
  ]);
  try {
    const r = run(["map", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    // the core fix: the caveat survives alongside the (re-emitted) landmark on the SAME ref
    assert.match(r.stdout, /CAVEAT rank\.ts mutates input/, "the caveat coexists with the landmark on the same ref (supersede per ref+type)");
    assert.match(r.stdout, /LANDMARK-V2 rankFeed moved/, "the landmark on the same ref also survives");
    // within-type supersession still holds: V2 landmark replaces the V1 landmark on that ref+type
    assert.doesNotMatch(r.stdout, /LANDMARK rankFeed is the entry point/, "the V1 landmark is superseded by V2 (same ref+type)");
    // retract still tombstones the WHOLE ref (preserves CTX-2 behavior)
    assert.doesNotMatch(r.stdout, /TEMP gone soon/, "the retracted crumb's message is gone");
    assert.doesNotMatch(r.stdout, /area:gone/, "the retracted ref is gone from the map");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CTX-9: verify nudge compares real instants (tz-safe); retract spares ADR Decisions", () => {
  // Fix A: verifyMark must compare WALL-CLOCK instants, not ISO strings. git --format=%cI carries a
  // tz offset (e.g. +05:00) while the crumb ts is UTC Z, so a lexical `>` is wrong across offsets.
  // Commit at 09:00 +05:00 (= 04:00 UTC); crumb ts 06:00 UTC. Real instants: commit (04:00 UTC) is
  // BEFORE the crumb (06:00 UTC) -> the crumb is genuinely FRESH -> NO nudge. But the STRINGS disagree:
  // "2026-06-18T09:00:00+05:00" sorts GREATER than "2026-06-18T06:00:00Z" ("09" > "06"), so the buggy
  // string compare wrongly flags the fresh crumb as stale. Assert: no /verify/ nudge, crumb still shown.
  const d = freshWithTics([]);
  cp.execFileSync("git", ["-C", d, "init", "-q"]);
  cp.execFileSync("git", ["-C", d, "config", "user.email", "t@t"]);
  cp.execFileSync("git", ["-C", d, "config", "user.name", "t"]);
  fs.mkdirSync(path.join(d, "src"), { recursive: true });
  fs.writeFileSync(path.join(d, "src", "rank.ts"), "x");
  cp.execFileSync("git", ["-C", d, "add", "src/rank.ts"]);
  const env = Object.assign({}, process.env, { GIT_COMMITTER_DATE: "2026-06-18T09:00:00+05:00", GIT_AUTHOR_DATE: "2026-06-18T09:00:00+05:00" });
  cp.execFileSync("git", ["-C", d, "commit", "-q", "-m", "seed"], { env });
  fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
    JSON.stringify(T({ seq: 1, kind: "landmark", from: "navigator", to: "*", ref: "src/rank.ts", result: "landmark", msg: "FRESH crumb after commit", ts: "2026-06-18T06:00:00Z" })) + "\n");
  try {
    const r = run(["map", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    const freshLine = r.stdout.split("\n").find((l) => l.indexOf("FRESH crumb after commit") !== -1);
    assert.ok(freshLine, "the crumb still appears (never suppressed)");
    assert.doesNotMatch(freshLine, /verify/i, "crumb ts 06:00 UTC is AFTER the commit's real instant 04:00 UTC -> genuinely fresh -> no nudge (string compare wrongly nudges)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }

  // Fix B: a landmark `retract` must tombstone only landmark-family crumbs, NOT a Decision (ADR contract)
  // on the SAME ref. The buggy retract loop deletes EVERY map key prefixed by `ref + " "`, including the
  // `decision` key. Assert the ADR survives the retract.
  const d2 = freshWithTics([
    T({ seq: 1, ts: "2026-06-04T01:00:01Z", kind: "contract", from: "architect", to: "*", ref: "docs/decisions/0019-context-map.md", msg: "ADR 0019: the context map" }),
    T({ seq: 2, ts: "2026-06-04T01:00:02Z", kind: "landmark", from: "navigator", to: "*", ref: "docs/decisions/0019-context-map.md", result: "retract", msg: "" }),
  ]);
  try {
    const r = run(["map", d2]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /ADR 0019: the context map/, "a landmark retract must NOT clear the Decision (ADR) keyed to the same ref");
  } finally { fs.rmSync(d2, { recursive: true, force: true }); }
});

test("E12-2b: team-tactics log --witness parses + reveals witness notes (cli.js surface); default hides them", () => {
  const d = freshWithTics([
    T({ seq: 1, kind: "note", from: "witness", to: "*", msg: "used Read" }),
    T({ seq: 2, kind: "delegate", from: "orchestrator", to: "test-writer", msg: "slice X", ref: "X" }),
  ]);
  try {
    // Default: witness note hidden, non-witness tic shown
    const def = run(["log", d]);
    assert.strictEqual(def.status, 0, def.stderr);
    assert.match(def.stdout, /slice X/);
    assert.doesNotMatch(def.stdout, /used Read/);

    // --witness flag: both notes shown, and must exit 0 (today exits 2 = RED)
    const w = run(["log", "--witness", d]);
    assert.strictEqual(w.status, 0, w.stderr);
    assert.match(w.stdout, /used Read/);
    assert.match(w.stdout, /slice X/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
