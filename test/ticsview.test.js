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
