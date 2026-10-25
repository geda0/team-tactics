"use strict";
// ADR 0030 — the fleet lane strategy: stage gates, predicates, quarantine, acks, leases + registry, referee
// liveness, the delegation fold, triage precision and auto-advance. Every verb is a read-side fold, so each test
// writes a bus by hand (fixed timestamps) and pins the clock with TICS_NOW.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const BIN = path.join(__dirname, "..", "bin", "tics.js");
const ENV = (() => { const e = { ...process.env }; ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_COMMON_DIR", "TICS_FILE", "TICS_DIR", "TICS_SESSION", "TICS_SCOPE", "TIC_STORE"].forEach((k) => delete e[k]); return e; })();

function inst(cfg) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tics-fleet-"));
  cp.spawnSync("node", [BIN, "init", d], { encoding: "utf8", env: ENV });
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'TIC_STORE="jsonl"\n' + (cfg || ""));
  fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "off\n");
  fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
  return d;
}
// T(m) = 2026-10-24 12:00Z + m minutes.
const T = (m) => new Date(Date.UTC(2026, 9, 24, 12, 0) + m * 60000).toISOString().replace(/\.\d{3}Z$/, "Z");
let SEQ = 0;
function put(d, list) {
  const f = path.join(d, ".claude", "state", "tics.jsonl");
  const lines = list.map((x) => JSON.stringify(Object.assign({ ts: T(0), seq: ++SEQ, kind: "note", from: "x", to: "*", phase: "off", layer: "app", scope: "*", session: "", msg: "", ref: "", result: "" }, x)));
  fs.appendFileSync(f, lines.join("\n") + "\n");
}
const run = (d, now, ...a) => cp.spawnSync(path.join(d, ".claude", "hooks", "tics"), a, { cwd: d, encoding: "utf8", env: Object.assign({}, ENV, { TICS_NOW: now || T(0) }) });
const out = (r) => r.stdout + r.stderr;
const ticsOf = (d) => fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const V = (from, stage, sha, result, m) => ({ ts: T(m || 0), kind: "verdict", from, to: "*", msg: "gate:" + stage + " checked", ref: sha, result });
const STAGES = 'STAGES="preflight:dev-ops pilot:auditor fairness:auditor,tdd-critic"\n';

// ---------- F1 stage gate (N6) ----------
test("F1a: tics gate --sha exits 2 when STAGES is not declared", () => {
  const d = inst();
  try { const r = run(d, null, "gate", "--sha", "abc123"); assert.strictEqual(r.status, 2, out(r)); assert.match(out(r), /STAGES/); } finally { rm(d); }
});

test("F1b: tics gate --sha exits 1 naming each missing stage/role, 0 once every declared stage passes at that sha", () => {
  const d = inst(STAGES);
  try {
    put(d, [V("dev-ops", "preflight", "abc123", "pass", 1), V("auditor", "pilot", "abc123", "pass", 2), V("auditor", "fairness", "abc123", "pass", 3)]);
    let r = run(d, null, "gate", "--sha", "abc123");
    assert.strictEqual(r.status, 1, out(r));
    assert.match(out(r), /fairness/); assert.match(out(r), /tdd-critic/);
    assert.doesNotMatch(out(r), /missing[^\n]*preflight/);
    put(d, [V("tdd-critic", "fairness", "abc123", "pass", 4)]);
    r = run(d, null, "gate", "--sha", "abc123");
    assert.strictEqual(r.status, 0, out(r));
    assert.match(out(r), /CLEAR/);
  } finally { rm(d); }
});

test("F1c: evidence is per sha — passes at another sha do not count; the latest verdict per stage+role wins", () => {
  const d = inst('STAGES="preflight:dev-ops"\n');
  try {
    put(d, [V("dev-ops", "preflight", "old111", "pass", 1)]);
    assert.strictEqual(run(d, null, "gate", "--sha", "new222").status, 1, "a pass at old111 must not clear new222");
    put(d, [V("dev-ops", "preflight", "new222", "pass", 2), V("dev-ops", "preflight", "new222", "fail", 3)]);
    const r = run(d, null, "gate", "--sha", "new222");
    assert.strictEqual(r.status, 1, "the later fail supersedes the earlier pass: " + out(r));
    assert.match(out(r), /preflight[^\n]*fail/);
    put(d, [V("dev-ops", "preflight", "new222", "pass", 4)]);
    assert.strictEqual(run(d, null, "gate", "--sha", "new222").status, 0);
  } finally { rm(d); }
});

test("F1d: a STAGES that names triage as a role is malformed (exit 2) — triage never gates (0023 coverage-monotonicity)", () => {
  const d = inst('STAGES="preflight:dev-ops review:triage"\n');
  try {
    put(d, [V("dev-ops", "preflight", "abc123", "pass", 1), V("triage", "review", "abc123", "pass", 2)]);
    const r = run(d, null, "gate", "--sha", "abc123");
    assert.strictEqual(r.status, 2, out(r)); assert.match(out(r), /triage/);
  } finally { rm(d); }
});

test("F1e: plain tics gate (the release gate) is unchanged by STAGES", () => {
  const d = inst(STAGES);
  try {
    put(d, [{ kind: "verdict", from: "product-owner", result: "pass" }, { kind: "verdict", from: "tdd-critic", result: "pass" }]);
    const r = run(d, null, "gate");
    assert.strictEqual(r.status, 0, out(r)); assert.match(out(r), /Release gate: CLEAR/);
  } finally { rm(d); }
});

// ---------- F2 declared predicates (N7) ----------
const PRED = STAGES + 'PREDICATES="requires:pilot:before:fairness kill:pilot>=0.96"\n';
test("F2a: requires A before B fires when B has a verdict at a sha with no earlier passing A at that sha", () => {
  const d = inst(PRED);
  try {
    put(d, [V("auditor", "fairness", "s1", "pass", 1), V("auditor", "pilot", "s1", "0.5", 2)]);
    const r = run(d, null, "predicates");
    assert.strictEqual(r.status, 1, out(r));
    assert.match(out(r), /requires:pilot:before:fairness/); assert.match(out(r), /s1/);
  } finally { rm(d); }
});

test("F2b: requires A before B is quiet when a passing A came first; kill fires on a numeric result crossing the line", () => {
  const d = inst(PRED);
  try {
    put(d, [V("auditor", "pilot", "s2", "pass", 1), V("auditor", "fairness", "s2", "pass", 2)]);
    let r = run(d, null, "predicates");
    assert.strictEqual(r.status, 0, out(r));
    put(d, [V("auditor", "pilot", "s3", "0.97", 3)]);
    r = run(d, null, "predicates");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /kill:pilot>=0.96/); assert.match(out(r), /s3/);
  } finally { rm(d); }
});

test("F2c (P4): predicates --emit writes exactly one block per firing, citing the tripping verdict, and never a second", () => {
  const d = inst(PRED);
  try {
    put(d, [V("auditor", "pilot", "s3", "0.97", 1)]);
    const trip = ticsOf(d).pop();
    run(d, null, "predicates", "--emit", "auditor");
    run(d, null, "predicates", "--emit", "auditor");
    const blocks = ticsOf(d).filter((x) => x.kind === "block");
    assert.strictEqual(blocks.length, 1, JSON.stringify(blocks));
    assert.strictEqual(blocks[0].ref, "pred:kill:pilot>=0.96:s3");
    assert.strictEqual(blocks[0].from, "auditor");
    assert.match(blocks[0].msg, new RegExp("#" + trip.seq + "\\b"));
  } finally { rm(d); }
});

// ---------- F3 honest quarantine (N8) ----------
const Q = (ref, msg, m) => ({ ts: T(m || 0), kind: "note", from: "dev-ops", msg, ref, result: "quarantine" });
test("F3a: tics quarantine lists active quarantines and exits 0 while none has expired", () => {
  const d = inst();
  try {
    put(d, [Q("test/flaky.test.js", "owner=dev-ops until=2026-11-01 timing flake")]);
    const r = run(d, T(60), "quarantine");
    assert.strictEqual(r.status, 0, out(r)); assert.match(out(r), /flaky\.test\.js/); assert.match(out(r), /dev-ops/); assert.match(out(r), /2026-11-01/);
  } finally { rm(d); }
});

test("F3b (P5): a quarantine past its until date is EXPIRED, exits 1, and tics gate --sha refuses", () => {
  const d = inst('STAGES="preflight:dev-ops"\n');
  try {
    put(d, [Q("test/flaky.test.js", "owner=dev-ops until=2026-10-20 timing flake"), V("dev-ops", "preflight", "abc", "pass", 1)]);
    let r = run(d, T(60), "quarantine");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /EXPIRED/);
    r = run(d, T(60), "gate", "--sha", "abc");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /quarantine/i);
  } finally { rm(d); }
});

test("F3c: a quarantine with no owner or no valid date is invalid and counts as expired; unquarantine lifts one", () => {
  const d = inst();
  try {
    put(d, [Q("test/a.test.js", "until=2026-12-01 no owner"), Q("test/b.test.js", "owner=dev-ops until=someday")]);
    let r = run(d, T(60), "quarantine");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /INVALID[^\n]*a\.test\.js|a\.test\.js[^\n]*INVALID/); assert.match(out(r), /b\.test\.js[^\n]*INVALID|INVALID[^\n]*b\.test\.js/);
    put(d, [{ kind: "note", from: "dev-ops", ref: "test/a.test.js", result: "unquarantine" }, { kind: "note", from: "dev-ops", ref: "test/b.test.js", result: "unquarantine" }]);
    r = run(d, T(60), "quarantine");
    assert.strictEqual(r.status, 0, out(r)); assert.doesNotMatch(out(r), /a\.test\.js/);
  } finally { rm(d); }
});

// ---------- F4 acknowledged handoffs (N11) ----------
const D = (from, to, ref, m, kind) => ({ ts: T(m), kind: kind || "delegate", from, to, msg: "do " + ref, ref });
test("F4a (P7): a directed dispatch with no citing tic from its addressee is unacknowledged past ACK_MINUTES; exit 1", () => {
  const d = inst();
  try {
    put(d, [D("leader", "lane-3", "Q10", 0)]);
    let r = run(d, T(5), "acks");
    assert.strictEqual(r.status, 0, "5 min < default 10: open, not yet flagged: " + out(r)); assert.match(out(r), /Q10/);
    r = run(d, T(11), "acks");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /UNACKNOWLEDGED[^\n]*Q10|Q10[^\n]*UNACKNOWLEDGED/);
  } finally { rm(d); }
});

test("F4b: the addressee citing the ref with ANY kind acks it; another role citing it does not (keys on ref + to, never kind)", () => {
  const d = inst();
  try {
    put(d, [D("leader", "lane-3", "Q10", 0), { ts: T(1), kind: "note", from: "lane-7", ref: "Q10", msg: "saw it" }]);
    assert.strictEqual(run(d, T(30), "acks").status, 1, "lane-7 citing Q10 is not lane-3's ack");
    put(d, [{ ts: T(2), kind: "claim", from: "lane-3", ref: "Q10", msg: "on it" }]);
    const r = run(d, T(30), "acks");
    assert.strictEqual(r.status, 0, out(r)); assert.doesNotMatch(out(r), /UNACKNOWLEDGED/);
  } finally { rm(d); }
});

test("F4c: broadcast dispatches (to * / fleet) are listed as undirected and cannot be acknowledged; handoff and assign count as dispatches", () => {
  const d = inst();
  try {
    put(d, [D("leader", "fleet", "Q11", 0), D("leader", "lane-1", "Q12", 0, "handoff"), D("leader", "lane-2", "Q13", 0, "assign")]);
    const r = run(d, T(30), "acks");
    assert.match(out(r), /undirected[^]*Q11/i);
    assert.match(out(r), /Q12/); assert.match(out(r), /Q13/);
    assert.strictEqual(r.status, 1);
  } finally { rm(d); }
});

test("F4d: ACK_MINUTES tunes the threshold; tics board shows an acks line when a dispatch is unacknowledged", () => {
  const d = inst("ACK_MINUTES=60\n");
  try {
    put(d, [D("leader", "lane-3", "Q10", 0)]);
    assert.strictEqual(run(d, T(30), "acks").status, 0);
    assert.strictEqual(run(d, T(61), "acks").status, 1);
    assert.match(out(run(d, T(61), "board")), /unacknowledged/i);
  } finally { rm(d); }
});

// ---------- F5 leases + registry + fault domains (N4) ----------
test("F5a: with CLAIMS_LEASE_SEC, a holder that only heartbeats loses its lease; progress renews it; off by default", () => {
  const d = inst("CLAIMS_LEASE_SEC=600\n");
  try {
    put(d, [
      { ts: T(0), kind: "claim", from: "lane-3", session: "s-3", scope: "bundles/q10", ref: "q10/grader.py", msg: "q10/grader.py" },
      { ts: T(15), kind: "session", from: "lane-3", session: "s-3", msg: "alive" },
      { ts: T(0), kind: "claim", from: "lane-4", session: "s-4", scope: "bundles/q11", ref: "q11/grader.py", msg: "q11/grader.py" },
      { ts: T(15), kind: "signal", from: "lane-4", session: "s-4", scope: "bundles/q11", result: "green" },
    ]);
    const r = run(d, T(20), "fleet");
    assert.match(out(r), /s-3[^\n]*LAPSED/); assert.doesNotMatch(out(r), /s-4[^\n]*LAPSED/);
    const cc = run(d, T(20), "claim-check", "q10/grader.py", "bundles/other");
    assert.strictEqual(cc.status, 0, "a lapsed claim must not block another lane: " + out(cc));
    const cc4 = run(d, T(20), "claim-check", "q11/grader.py", "bundles/other");
    assert.notStrictEqual(cc4.status, 0, "a live lease still blocks");
  } finally { rm(d); }
  const d2 = inst();
  try {
    put(d2, [{ ts: T(0), kind: "claim", from: "lane-3", session: "s-3", scope: "bundles/q10", ref: "q10/grader.py", msg: "q10/grader.py" }]);
    assert.notStrictEqual(run(d2, T(600), "claim-check", "q10/grader.py", "bundles/other").status, 0, "no lease configured: claims never lapse");
  } finally { rm(d2); }
});

test("F5b: tics fleet shows each member's role, domain, caps and current job from session declarations and dispatches", () => {
  const d = inst();
  try {
    put(d, [
      { ts: T(0), kind: "session", from: "lane-3", session: "s-3", msg: "caps=node,docker domain=acct-B" },
      { ts: T(1), kind: "delegate", from: "leader", session: "s-L", to: "lane-3", ref: "Q10", msg: "build Q10" },
    ]);
    const r = run(d, T(2), "fleet");
    assert.strictEqual(r.status, 0, out(r));
    const row = out(r).split("\n").find((l) => /s-3/.test(l)) || "";
    assert.match(row, /lane-3/); assert.match(row, /acct-B/); assert.match(row, /node,docker/); assert.match(row, /Q10/);
  } finally { rm(d); }
});

test("F5c: FLEET_LEAD and FLEET_FAILOVER in the same declared fault domain is flagged (exit 1); different domains pass", () => {
  const cfg = 'FLEET_LEAD="leader"\nFLEET_FAILOVER="coordinator"\n';
  const d = inst(cfg);
  try {
    put(d, [{ kind: "session", from: "leader", session: "s-L", msg: "domain=acct-A" }, { kind: "session", from: "coordinator", session: "s-C", msg: "caps=node domain=acct-A" }]);
    let r = run(d, T(1), "fleet");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /SAME FAULT DOMAIN/);
    put(d, [{ ts: T(2), kind: "session", from: "coordinator", session: "s-C", msg: "caps=node domain=acct-B" }]);
    r = run(d, T(3), "fleet");
    assert.strictEqual(r.status, 0, out(r)); assert.doesNotMatch(out(r), /SAME FAULT DOMAIN/);
  } finally { rm(d); }
});

// ---------- F6 referee liveness (N13) ----------
function kitManifest(d, v) { fs.mkdirSync(path.join(d, ".claude", ".team-tactics"), { recursive: true }); fs.writeFileSync(path.join(d, ".claude", ".team-tactics", "manifest.json"), JSON.stringify({ kitVersion: v })); }
test("F6a (P9): no hook-identity tic since session-started → tics cycle says the referee is UNARMED", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "session-started"), T(10) + "\n");
    put(d, [{ ts: T(5), kind: "signal", from: "run-suite", result: "green", kit: "1.0.0" }, { ts: T(12), kind: "signal", from: "implementer", result: "green" }]);
    const r = run(d, T(20), "cycle");
    assert.match(out(r), /referee: UNARMED/); assert.match(out(r), /self-reported/);
  } finally { rm(d); }
});

test("F6b: a hook tic since session start arms it with its kit; a kit differing from the installed one says restart", () => {
  const d = inst();
  try {
    kitManifest(d, "1.1.0");
    fs.writeFileSync(path.join(d, ".claude", "state", "session-started"), T(10) + "\n");
    put(d, [{ ts: T(12), kind: "signal", from: "run-suite", result: "green", kit: "1.1.0" }]);
    let r = run(d, T(20), "cycle");
    assert.match(out(r), /referee: armed \(kit 1\.1\.0\)/); assert.doesNotMatch(out(r), /restart/);
    put(d, [{ ts: T(13), kind: "signal", from: "run-suite", result: "green", kit: "1.0.0" }]);
    r = run(d, T(20), "cycle");
    assert.match(out(r), /referee: armed \(kit 1\.0\.0, installed 1\.1\.0/); assert.match(out(r), /restart/);
  } finally { rm(d); }
});

// ---------- F7 delegation fold (N10) ----------
test("F7a (P6): silent with no FLEET_LEAD — a solo install gets nothing", () => {
  const d = inst();
  try {
    put(d, [{ kind: "note", from: "orchestrator", msg: "solo work" }]);
    const r = run(d, null, "delegation");
    assert.strictEqual(r.status, 0); assert.strictEqual(r.stdout.trim(), "");
  } finally { rm(d); }
});

test("F7b (P6): a lead that only notes and verdicts has ratio 0 and is flagged; one dispatch changes the ratio", () => {
  const d = inst('FLEET_LEAD="leader"\n');
  try {
    put(d, [{ kind: "note", from: "leader", msg: "a" }, { kind: "verdict", from: "leader", result: "pass" }]);
    let r = run(d, null, "delegation");
    assert.match(out(r), /leader[^\n]*0\/2/); assert.match(out(r), /NO DELEGATION/);
    put(d, [{ kind: "delegate", from: "leader", to: "lane-1", ref: "Q1", msg: "x" }]);
    r = run(d, null, "delegation");
    assert.match(out(r), /leader[^\n]*1\/2/); assert.doesNotMatch(out(r), /NO DELEGATION/);
  } finally { rm(d); }
});

test("F7c (P6): a lead's claim on work dispatched to another role is self-work, unless it states failover; an idle owner is named to staff", () => {
  const d = inst('FLEET_LEAD="leader"\n');
  try {
    put(d, [{ kind: "delegate", from: "leader", to: "qa-verifier", ref: "Q5", msg: "verify Q5" }, { kind: "claim", from: "leader", ref: "Q5", msg: "doing it myself" }]);
    let r = run(d, null, "delegation");
    assert.match(out(r), /leader[^\n]*1\/1/); assert.match(out(r), /staff[^\n]*qa-verifier/);
    put(d, [{ kind: "delegate", from: "leader", to: "lane-2", ref: "Q6", msg: "build Q6" }, { kind: "note", from: "lane-2", msg: "here" }, { kind: "claim", from: "leader", ref: "Q6", msg: "failover: lane-2 at usage limit" }]);
    r = run(d, null, "delegation");
    assert.match(out(r), /leader[^\n]*2\/1/, "the failover claim is not self-work: " + out(r));
  } finally { rm(d); }
});

// ---------- F8 triage precision (Lane A) ----------
test("F8a: tics triage reports confirmed / dismissed / pending and precision = c/(c+d)", () => {
  const d = inst();
  try {
    put(d, [
      { kind: "verdict", from: "triage", ref: "s1", result: "concerns", msg: "weakened assert" },
      { kind: "verdict", from: "triage", ref: "s2", result: "concerns", msg: "hardcoded return" },
      { kind: "verdict", from: "triage", ref: "s3", result: "concerns", msg: "scope creep" },
      { kind: "verdict", from: "triage", ref: "s4", result: "pass" },
      { kind: "verdict", from: "tdd-critic", ref: "s1", result: "confirm" },
      { kind: "verdict", from: "auditor", ref: "s2", result: "dismiss" },
    ]);
    const r = run(d, null, "triage");
    assert.strictEqual(r.status, 0, out(r));
    assert.match(out(r), /confirmed 1/); assert.match(out(r), /dismissed 1/); assert.match(out(r), /pending 1/); assert.match(out(r), /precision 0\.50/);
    assert.match(out(r), /s3/);
  } finally { rm(d); }
});

test("F8b: triage verdicts never clear or block either gate", () => {
  const d = inst('STAGES="preflight:dev-ops"\n');
  try {
    put(d, [{ kind: "verdict", from: "triage", ref: "abc", result: "pass", msg: "gate:preflight ok" }]);
    assert.strictEqual(run(d, null, "gate", "--sha", "abc").status, 1, "a triage pass is not the dev-ops preflight");
    put(d, [V("dev-ops", "preflight", "abc", "pass", 1), { kind: "verdict", from: "triage", ref: "abc", result: "concerns", msg: "gate:preflight smells" }]);
    assert.strictEqual(run(d, null, "gate", "--sha", "abc").status, 0, "a triage concern does not block the stage gate");
  } finally { rm(d); }
});

// ---------- F9 auto-advance (mechanical stages only) ----------
const ADV = 'STAGES="preflight:dev-ops similarity:dev-ops fairness:auditor"\nAUTO_STAGES="preflight similarity"\nPREDICATES="kill:preflight>=0.96"\n';
test("F9a: first-try green on every auto stage → AUTO-ADVANCE (exit 0), and the judgment stage is still required by gate --sha", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "a1", "pass", 1), V("dev-ops", "similarity", "a1", "pass", 2)]);
    const r = run(d, null, "advance", "a1");
    assert.strictEqual(r.status, 0, out(r)); assert.match(out(r), /AUTO-ADVANCE/);
    assert.strictEqual(run(d, null, "gate", "--sha", "a1").status, 1, "fairness (judgment) still missing");
  } finally { rm(d); }
});

test("F9b: a fail-then-pass on an auto stage at the same sha is not first-try green → REVIEW (exit 1) with the reason", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "a2", "fail", 1), V("dev-ops", "preflight", "a2", "pass", 2), V("dev-ops", "similarity", "a2", "pass", 3)]);
    const r = run(d, null, "advance", "a2");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /REVIEW/); assert.match(out(r), /preflight[^\n]*first/i);
  } finally { rm(d); }
});

test("F9c: a missing auto stage, a firing predicate, a pending triage concern, or an expired quarantine each force REVIEW", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "a3", "pass", 1)]);
    assert.match(out(run(d, null, "advance", "a3")), /REVIEW[^]*similarity/);
    put(d, [V("dev-ops", "preflight", "a4", "pass", 1), V("dev-ops", "similarity", "a4", "pass", 2), { kind: "verdict", from: "triage", ref: "a4", result: "concerns", msg: "smell" }]);
    let r = run(d, null, "advance", "a4");
    assert.strictEqual(r.status, 1); assert.match(out(r), /triage/);
    put(d, [{ kind: "verdict", from: "tdd-critic", ref: "a4", result: "dismiss" }]);
    assert.strictEqual(run(d, null, "advance", "a4").status, 0, "a dismissed concern no longer holds it");
    put(d, [V("dev-ops", "preflight", "a5", "0.99", 1), V("dev-ops", "similarity", "a5", "pass", 2)]);
    r = run(d, null, "advance", "a5");
    assert.strictEqual(r.status, 1); assert.match(out(r), /kill:preflight/);
    put(d, [{ kind: "note", from: "dev-ops", ref: "t/x.test.js", result: "quarantine", msg: "owner=dev-ops until=2026-01-01 old" }]);
    r = run(d, null, "advance", "a4");
    assert.strictEqual(r.status, 1); assert.match(out(r), /quarantine/i);
  } finally { rm(d); }
});

test("F9d: AUTO_STAGES naming a stage absent from STAGES is a config error (exit 2)", () => {
  const d = inst('STAGES="preflight:dev-ops"\nAUTO_STAGES="preflight pilot"\n');
  try { const r = run(d, null, "advance", "a1"); assert.strictEqual(r.status, 2, out(r)); assert.match(out(r), /pilot/); } finally { rm(d); }
});

test("F9e: advance --stats reports the auto-advance fraction and the block rate on auto-advanced shas", () => {
  const d = inst(ADV);
  try {
    put(d, [
      V("dev-ops", "preflight", "b1", "pass", 1), V("dev-ops", "similarity", "b1", "pass", 2),
      V("dev-ops", "preflight", "b2", "pass", 3), V("dev-ops", "similarity", "b2", "pass", 4),
      V("dev-ops", "preflight", "b3", "fail", 5), V("dev-ops", "preflight", "b3", "pass", 6), V("dev-ops", "similarity", "b3", "pass", 7),
      V("dev-ops", "preflight", "b4", "pass", 8),
      { ts: T(9), kind: "block", from: "auditor", ref: "b2", msg: "grader leaks the answer" },
    ]);
    const r = run(d, null, "advance", "--stats");
    assert.strictEqual(r.status, 0, out(r));
    assert.match(out(r), /auto-advance 2\/4/); assert.match(out(r), /blocked after auto-advance 1\/2/);
  } finally { rm(d); }
});

// ---------- review findings (draft review: edit) ----------
test("F9f: advance with no AUTO_STAGES declared is a config error (exit 2), never a vacuous AUTO-ADVANCE", () => {
  const d = inst('STAGES="preflight:dev-ops"\n');
  try { put(d, [V("dev-ops", "preflight", "a1", "pass", 1)]); const r = run(d, null, "advance", "a1"); assert.strictEqual(r.status, 2, out(r)); assert.match(out(r), /AUTO_STAGES/); } finally { rm(d); }
});

test("F9g: a pass then a later fail on an auto stage at the same sha → REVIEW (the latest verdict must pass)", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "a6", "pass", 1), V("dev-ops", "similarity", "a6", "pass", 2), V("dev-ops", "similarity", "a6", "fail", 3)]);
    const r = run(d, null, "advance", "a6");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /similarity/);
  } finally { rm(d); }
});

test("F9h / F1f: advance with no sha, and gate --sha with an empty value, are usage errors (exit 2)", () => {
  const d = inst(ADV);
  try {
    put(d, [{ kind: "verdict", from: "dev-ops", msg: "gate:preflight", ref: "", result: "pass" }]);
    assert.strictEqual(run(d, null, "advance").status, 2);
    assert.strictEqual(run(d, null, "gate", "--sha", "").status, 2);
  } finally { rm(d); }
});

test("F2d: predicates --emit refuses a hook identity (exit 2, nothing written) — agents cannot forge the referee", () => {
  const d = inst(PRED);
  try {
    put(d, [V("auditor", "pilot", "s3", "0.97", 1)]);
    for (const who of ["run-suite", "guard", "witness", "subagent", "-x", ""]) {
      const r = run(d, null, "predicates", "--emit", who);
      assert.strictEqual(r.status, 2, who + ": " + out(r));
    }
    assert.strictEqual(ticsOf(d).filter((x) => x.kind === "block").length, 0);
  } finally { rm(d); }
});

test("F10: the package CLI (bin/tics.js) runs the ADR 0030 verbs, not the help text", () => {
  const d = inst('STAGES="preflight:dev-ops"\n');
  try {
    put(d, [D("leader", "lane-3", "Q10", 0)]);
    const r = cp.spawnSync("node", [BIN, "acks", d], { encoding: "utf8", env: Object.assign({}, ENV, { TICS_NOW: T(30) }) });
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /UNACKNOWLEDGED/);
    const g = cp.spawnSync("node", [BIN, "gate", "--sha", "abc", d], { encoding: "utf8", env: ENV });
    assert.strictEqual(g.status, 1, out(g)); assert.match(out(g), /Stage gate/);
  } finally { rm(d); }
});

// ---------- dogfood findings (this repo's tics-bus, 2026-10-24) ----------
test("F4e: dispatches older than ACK_WINDOW_MIN (default 1440) collapse to one count line and do not fail the check", () => {
  const d = inst();
  try {
    put(d, [D("leader", "lane-3", "OLD1", 0), D("leader", "lane-4", "OLD2", 1), D("leader", "lane-5", "NEW1", 1500)]);
    let r = run(d, T(1515), "acks");
    assert.strictEqual(r.status, 1, out(r));
    assert.match(out(r), /UNACKNOWLEDGED[^\n]*NEW1/); assert.doesNotMatch(out(r), /UNACKNOWLEDGED[^\n]*OLD/);
    assert.match(out(r), /2 older dispatch/);
    r = run(d, T(1505), "acks");
    assert.strictEqual(r.status, 0, "only old ones are unacked and the new one is young: " + out(r));
  } finally { rm(d); }
});

test("F5d: tics fleet keeps columns apart for long session ids", () => {
  const d = inst();
  try {
    put(d, [{ kind: "session", from: "lane-3", session: "local_navigator-delegation-123456", msg: "caps=node domain=acct-B" }]);
    const row = out(run(d, T(1), "fleet")).split("\n").find((l) => /local_navigator/.test(l)) || "";
    assert.match(row, /local_navigator-delegation-123456\s+acct-B\s+node\s/);
  } finally { rm(d); }
});

// ---------- tdd-critic findings (CONCERNS, 2026-10-24) ----------
test("C1: advance and predicates take stage evidence only from the roles STAGES declares — a lane cannot self-report its mechanical green", () => {
  const d = inst(ADV.replace(/PREDICATES=.*\n/, "") + 'PREDICATES="requires:preflight:before:fairness kill:preflight>=0.96"\n');
  try {
    put(d, [V("implementer", "preflight", "x1", "pass", 1), V("implementer", "similarity", "x1", "pass", 2)]);
    let r = run(d, null, "advance", "x1");
    assert.strictEqual(r.status, 1, out(r)); assert.match(out(r), /preflight/);
    put(d, [V("implementer", "preflight", "x2", "pass", 1), V("auditor", "fairness", "x2", "pass", 2)]);
    assert.match(out(run(d, null, "predicates")), /requires:preflight:before:fairness[^\n]*x2/, "an undeclared role's pass does not satisfy A");
    put(d, [V("implementer", "preflight", "x3", "0.99", 1)]);
    assert.doesNotMatch(out(run(d, null, "predicates")), /kill[^\n]*x3/, "an undeclared role's number does not trip a kill");
  } finally { rm(d); }
});

test("C1b: a triage concern is confirmed or dismissed only by TRIAGE_REVIEWERS (default tdd-critic, auditor)", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "a4", "pass", 1), V("dev-ops", "similarity", "a4", "pass", 2), { kind: "verdict", from: "triage", ref: "a4", result: "concerns", msg: "smell" }, { kind: "verdict", from: "implementer", ref: "a4", result: "dismiss" }]);
    assert.strictEqual(run(d, null, "advance", "a4").status, 1, "the implementer cannot dismiss a concern on its own work");
    assert.match(out(run(d, null, "triage")), /pending 1/);
    put(d, [{ kind: "verdict", from: "auditor", ref: "a4", result: "dismiss" }]);
    assert.strictEqual(run(d, null, "advance", "a4").status, 0);
    put(d, [{ kind: "verdict", from: "triage", ref: "a4", result: "concerns", msg: "new smell" }]);
    assert.strictEqual(run(d, null, "advance", "a4").status, 1, "a fresh concern after a dismiss is pending again");
  } finally { rm(d); }
});

test("C2: with no ACK_MINUTES declared, tics board adds nothing; tics acks still answers when asked", () => {
  const d = inst();
  try {
    put(d, [D("orchestrator", "test-writer", "S1", 0)]);
    assert.doesNotMatch(out(run(d, T(60), "board")), /unacknowledged/i);
    assert.match(out(run(d, T(60), "acks")), /UNACKNOWLEDGED[^\n]*S1/);
  } finally { rm(d); }
});

test("C3: advance --stats stays fast on a large bus (2,000 shas, 8,000 verdicts)", { timeout: 60000 }, () => {
  const d = inst(ADV.replace(/PREDICATES=.*\n/, "") + 'PREDICATES="requires:preflight:before:fairness kill:preflight>=0.96"\n');
  try {
    const list = [];
    for (let i = 0; i < 2000; i++) { const s = "h" + i; list.push(V("dev-ops", "preflight", s, "pass", i), V("dev-ops", "similarity", s, "pass", i), V("auditor", "fairness", s, "pass", i), { ts: T(i), kind: "verdict", from: "triage", ref: s, result: i % 10 ? "pass" : "concerns" }); }
    put(d, list);
    const t0 = Date.now(), r = run(d, T(3000), "advance", "--stats");
    assert.strictEqual(r.status, 0, out(r)); assert.match(out(r), /auto-advance 1800\/2000/);
    assert.ok(Date.now() - t0 < 10000, "took " + (Date.now() - t0) + " ms");
  } finally { rm(d); }
});

test("C4: an addressee tic citing the ref within ACK_SKEW_SEC before the dispatch acks it (clock skew); a dispatch with no ts is reported invalid", () => {
  const d = inst();
  try {
    put(d, [{ ts: "2026-10-24T11:59:30Z", kind: "claim", from: "lane-3", ref: "Q10", msg: "on it" }, D("leader", "lane-3", "Q10", 0)]);
    assert.strictEqual(run(d, T(30), "acks").status, 0, out(run(d, T(30), "acks")));
    put(d, [{ ts: "2026-10-24T10:00:00Z", kind: "claim", from: "lane-4", ref: "Q11", msg: "old" }, D("leader", "lane-4", "Q11", 1)]);
    assert.match(out(run(d, T(30), "acks")), /UNACKNOWLEDGED[^\n]*Q11/, "a citation 2 h before the dispatch is not an ack");
    put(d, [{ ts: "", kind: "delegate", from: "leader", to: "lane-5", ref: "Q12", msg: "x" }]);
    const r = run(d, T(30), "acks");
    assert.match(out(r), /invalid[^\n]*Q12/i); assert.strictEqual(r.status, 1);
  } finally { rm(d); }
});

test("C5: boundaries — quarantine on its until day is active; kill fires at exact equality; acks flag strictly after ACK_MINUTES; every broadcast form is undirected", () => {
  const d = inst(PRED);
  try {
    put(d, [Q("t/edge.test.js", "owner=dev-ops until=2026-10-24 last day")]);
    assert.strictEqual(run(d, T(60), "quarantine").status, 0, "until=today is still active");
    put(d, [V("auditor", "pilot", "e1", "0.96", 1), V("auditor", "pilot", "e2", "0.95", 1), V("auditor", "pilot", "e3", "n/a", 1)]);
    const p = out(run(d, null, "predicates"));
    assert.match(p, /kill:pilot>=0.96[^\n]*e1/); assert.doesNotMatch(p, /e2|e3/);
    put(d, [D("leader", "lane-3", "B1", 0), D("leader", "*", "B2", 0), D("leader", "all", "B3", 0), D("leader", "", "B4", 0)]);
    let r = run(d, T(10), "acks");
    assert.strictEqual(r.status, 0, "exactly 10 min is not yet past: " + out(r));
    for (const b of ["B2", "B3", "B4"]) assert.match(out(r), new RegExp("undirected[^]*" + b));
    assert.strictEqual(run(d, T(11), "acks").status, 1);
  } finally { rm(d); }
});

test("C5b: --stats counts a block only when it cites the sha itself or a predicate on it, not any ref ending in it", () => {
  const d = inst(ADV);
  try {
    put(d, [V("dev-ops", "preflight", "abc", "pass", 1), V("dev-ops", "similarity", "abc", "pass", 2), { kind: "block", from: "auditor", ref: "foo:abc", msg: "unrelated" }]);
    assert.match(out(run(d, null, "advance", "--stats")), /blocked after auto-advance 0\/1/);
    put(d, [{ kind: "block", from: "auditor", ref: "pred:requires:x:before:y:abc", msg: "pred" }]);
    assert.match(out(run(d, null, "advance", "--stats")), /blocked after auto-advance 1\/1/);
  } finally { rm(d); }
});

test("C6: the package CLI routes on the verb, not on a flag's value; the referee reads the latest hook tic's kit", () => {
  const d = inst();
  try {
    put(d, [{ kind: "note", from: "a", scope: "fleet", msg: "hello-fleet" }]);
    const r = cp.spawnSync("node", [BIN, "--scope", "fleet", "log", d], { encoding: "utf8", env: ENV });
    assert.match(out(r), /hello-fleet/); assert.doesNotMatch(out(r), /Fleet registry/);
    fs.writeFileSync(path.join(d, ".claude", "state", "session-started"), T(10) + "\n");
    kitManifest(d, "2.0.0");
    put(d, [{ ts: T(11), kind: "signal", from: "run-suite", result: "green", kit: "1.0.0" }, { ts: T(12), kind: "signal", from: "run-suite", result: "green" }]);
    assert.match(out(run(d, T(20), "cycle")), /referee: armed$/m, "the newest hook tic has no kit stamp: no stale version claimed");
  } finally { rm(d); }
});

test("C7 (re-review): only a directed dispatch to another role is delegation — a self-addressed one is self-work, a broadcast is listed apart", () => {
  const d = inst('FLEET_LEAD="leader"\n');
  try {
    put(d, [{ kind: "delegate", from: "leader", to: "leader", ref: "Q9", msg: "note to self" }, { kind: "delegate", from: "leader", to: "fleet", ref: "Q8", msg: "anyone" }]);
    const r = out(run(d, null, "delegation"));
    assert.match(r, /leader[^\n]*0\/1[^\n]*NO DELEGATION/); assert.match(r, /1 broadcast/);
  } finally { rm(d); }
});

test("F6d (dogfood): a kit install whose hooks never ran (manifest, no session-started) says UNARMED; a tics-only install stays silent", () => {
  const d = inst();
  try {
    assert.doesNotMatch(out(run(d, T(1), "cycle")), /referee/, "tics-only install: no referee to report");
    kitManifest(d, "1.0.0");
    put(d, [{ ts: T(0), kind: "signal", from: "implementer", result: "green" }]);
    const r = out(run(d, T(1), "cycle"));
    assert.match(r, /referee: UNARMED/); assert.match(r, /never ran|no session-started/);
  } finally { rm(d); }
});
