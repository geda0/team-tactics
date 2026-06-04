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
