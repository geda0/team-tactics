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

test("N1: solo (no multi-session, main tree) is unchanged — session stays empty (conservative)", () => {
  const d = inst();
  try {
    srcLib(d, "emit_tic alice '*' note hi");   // default install: not multi-session
    assert.strictEqual(ticsOf(d).pop().session, "", "solo ergonomics unchanged: no auto id, no surprise");
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

test("E12-2: tics log hides from=witness notes by default; --witness (and --all) reveals them; coordination tics unaffected", () => {
  const d = inst();
  try {
    // Arrange — a bus with one witness note (the per-tool activity record, from=witness) and one
    // real coordination tic. Direct-write deterministic seqs/ts (the log fold is seq/ts-ordered).
    const ts = "2026-06-16T00:00:00Z";
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ kind: "note", from: "witness", to: "*", msg: "used Read", scope: "*", seq: 1, ts }) + "\n" +
      JSON.stringify({ kind: "delegate", from: "orchestrator", to: "test-writer", msg: "slice S2", ref: "S2", scope: "*", seq: 2, ts }) + "\n");

    // Act + Assert — default view HIDES the witness note; the real coordination tic still shows.
    const def = read(d, "log");
    assert.strictEqual(def.status, 0, "tics log exits 0 on a witnessed bus: " + def.stderr);
    assert.match(def.stdout, /slice S2/, "the real coordination tic is shown by default");
    assert.doesNotMatch(def.stdout, /used Read/, "a from=witness note is HIDDEN by default — the coordination thread stays readable");
    assert.doesNotMatch(def.stdout, /witness/, "the witness identity does not surface in the default thread");

    // Act + Assert — --witness reveals the witness note AND keeps the real coordination tic.
    const w = read(d, "log", "--witness");
    assert.strictEqual(w.status, 0, "tics log --witness exits 0: " + w.stderr);
    assert.match(w.stdout, /used Read/, "--witness reveals the hidden witness note (the raw activity trace)");
    assert.match(w.stdout, /slice S2/, "--witness still shows the real coordination tic");
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

test("tics cycle surfaces the red-streak and flags a suspected red-storm", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "red-streak"), "6\n");
    const c = read(d, "cycle").stdout;
    assert.match(c, /red-streak.*6|6 reds/i, "shows the current streak");
    assert.match(c, /over-constrained|contradictory|reconsider|red-storm/i, "flags a high streak as a suspected red-storm");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics fan-out <spec> plans a disjoint partition: one scope per section, safe to fan out", () => {
  const d = inst();
  try {
    const spec = path.join(d, "partition.txt");
    fs.writeFileSync(spec, "# my partition\nranking ranker.ts types.ts\nnarrate host.ts line.ts\n");
    const r = read(d, "fan-out", spec);
    assert.strictEqual(r.status, 0, "a disjoint partition is safe: " + r.stderr);
    assert.match(r.stdout, /ranking.*ranking\/S1/, "assigns a scope per section");
    assert.match(r.stdout, /narrate.*narrate\/S2/);
    assert.match(r.stdout, /disjoint|safe/i, "reports it's safe to fan out");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics fan-out flags overlapping files: names the file + sections, not safe to fan out", () => {
  const d = inst();
  try {
    const spec = path.join(d, "partition.txt");
    fs.writeFileSync(spec, "ranking ranker.ts kernel.ts\npayments charge.ts kernel.ts\n");
    const r = read(d, "fan-out", spec);
    assert.notStrictEqual(r.status, 0, "overlap is NOT safe to fan out");
    assert.match(r.stdout, /kernel\.ts/, "names the overlapping file");
    assert.match(r.stdout, /ranking/);
    assert.match(r.stdout, /payments/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics conductor shows a per-scope summary: section status + active claims + freed-on-done", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SCOPE='ranking/S1'; emit_tic lead '*' section open ranking open");
    srcLib(d, "export TICS_SCOPE='ranking/S1'; emit_tic p '*' claim ranker.ts ranker.ts");
    srcLib(d, "export TICS_SCOPE='ranking/S1'; emit_tic p '*' claim types.ts types.ts");
    srcLib(d, "export TICS_SCOPE='narrate/S2'; emit_tic p '*' claim line.ts line.ts");
    srcLib(d, "export TICS_SCOPE='narrate/S2'; emit_tic lead '*' section done narrate done");
    const c = read(d, "conductor").stdout;
    const line = (s) => c.split("\n").find((l) => l.includes(s)) || "";
    assert.match(line("ranking/S1"), /\[open\]/, "open section's status shows");
    assert.match(line("ranking/S1"), /ranker\.ts.*types\.ts/, "lists its active claims");
    assert.match(line("narrate/S2"), /\[done\]/, "done section shows done");
    assert.match(line("narrate/S2"), /freed/, "a done section's claims read freed");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a done section auto-releases its claims (release-on-done): claims/owner/check all free up", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic o '*' claim cart.ts cart.ts");
    assert.match(read(d, "claims").stdout, /cart\.ts/, "claimed while the section is open");
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic lead '*' section shipped orders done");
    assert.doesNotMatch(read(d, "claims").stdout, /cart\.ts/, "the claim frees up when the section is done");
    assert.strictEqual(read(d, "claim-owner", "cart.ts").stdout.trim(), "", "owner clears on done");
    assert.strictEqual(node("claim-check", "cart.ts", "rival/S9", d).status, 0, "a rival may now take it");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics section-status <name>: reports the latest status, empty when unopened (feeds auto-section)", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic lead '*' section open orders open");
    assert.match(read(d, "section-status", "orders").stdout, /open/, "reports an opened section");
    assert.strictEqual(read(d, "section-status", "ghost").stdout.trim(), "", "unopened section has no status");
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic lead '*' section done orders done");
    assert.match(read(d, "section-status", "orders").stdout, /done/, "latest status wins");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics sections shows per-section lifecycle status (active vs done) from section tics", () => {
  const d = inst();
  try {
    // 'orders' opened + worked (still active); 'payments' opened, worked, then closed
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic lead '*' section 'kick off' orders open");
    srcLib(d, "export TICS_SCOPE='orders/S2'; emit_tic o tw delegate slice s");
    srcLib(d, "export TICS_SCOPE='payments/S3'; emit_tic lead '*' section 'kick off' payments open");
    srcLib(d, "export TICS_SCOPE='payments/S3'; emit_tic lead '*' section shipped payments done");
    const s = read(d, "sections").stdout;
    const line = (name) => s.split("\n").find((l) => l.includes(name)) || "";
    assert.match(line("payments"), /done/i, "a closed section reads done");
    assert.match(line("orders"), /active|open/i, "an open/worked section is not done");
    assert.doesNotMatch(line("orders"), /done/i, "orders is not done");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics log merges every worktree's bus BY DEFAULT (whole picture); --here restricts to local", () => {
  const d = inst(); const wt = d + "-wt";
  try {
    git(d, "init", "-q"); git(d, "add", "-A"); git(d, "commit", "-qm", "init");
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:00Z", seq: 1, kind: "note", from: "m", to: "*", msg: "in MAIN", scope: "*" }) + "\n");
    git(d, "worktree", "add", "-q", wt, "-b", "side");
    fs.mkdirSync(path.join(wt, ".claude", "state"), { recursive: true });
    fs.writeFileSync(path.join(wt, ".claude", "state", "tics.jsonl"), JSON.stringify({ ts: "2026-06-04T01:00:05Z", seq: 1, kind: "note", from: "s", to: "*", msg: "in SIDE", scope: "*" }) + "\n");
    assert.match(node("log", d).stdout, /in SIDE/, "default view merges sibling worktree buses — no flag needed");
    assert.doesNotMatch(node("log", "--here", d).stdout, /in SIDE/, "--here restricts to the local bus");
    assert.match(node("log", "--all", d).stdout, /in SIDE/, "--all is the explicit form of the default");
  } finally { try { git(d, "worktree", "remove", "--force", wt); } catch (e) {} fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(wt, { recursive: true, force: true }); }
});

test("tic.sh rejects malformed args (flag in FROM/TO, garbled kind) — records nothing", () => {
  const d = inst();
  const bus = () => { try { return fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8"); } catch (e) { return ""; } };
  const tic = (...a) => cp.spawnSync(path.join(d, ".claude", "hooks", "tic.sh"), a, { cwd: d, encoding: "utf8" });
  try {
    assert.notStrictEqual(tic("--scope", "frontend", "note", "hi").status, 0, "a flag in the FROM slot is rejected");
    assert.notStrictEqual(tic("impl", "-x", "note", "hi").status, 0, "a flag in the TO slot is rejected");
    assert.notStrictEqual(tic("impl", "inbox", "frontend:green", "x").status, 0, "a garbled <layer>:<result> kind is rejected");
    assert.doesNotMatch(bus(), /frontend:green|"from":"--scope"|"to":"-x"/, "no malformed tic reached the bus");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MS1: emit_tic stamps a `session` field (TICS_SESSION / state/session) — every tic is attributable", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SESSION='sessA'; emit_tic o '*' note hi");
    assert.strictEqual(ticsOf(d).pop().session, "sessA", "TICS_SESSION stamps the session field");
    fs.writeFileSync(path.join(d, ".claude", "state", "session"), "sessB\n");
    srcLib(d, "emit_tic o '*' note hi2");
    assert.strictEqual(ticsOf(d).pop().session, "sessB", "state/session stamps it when no env override");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MS3: tics claim-session <file> reports the SESSION holding an active claim (empty if free)", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SESSION='sessA'; export TICS_SCOPE='auth/S1'; emit_tic a '*' claim login.ts login.ts");
    assert.match(read(d, "claim-session", "login.ts").stdout, /sessA/, "names the holding session");
    assert.strictEqual(read(d, "claim-session", "free.ts").stdout.trim(), "", "unclaimed -> empty");
    assert.strictEqual(read(d, "claim-session", "RELEASE").stdout.trim(), "", "RELEASE lock free -> empty");
    srcLib(d, "export TICS_SESSION='sessA'; emit_tic a '*' release login.ts login.ts");
    assert.strictEqual(read(d, "claim-session", "login.ts").stdout.trim(), "", "released -> empty");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E7-1: livenessTier classifies last-tic age into live/idle/stale, aliver-wins at boundaries, unknown when unparseable", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 5, 16, 0, 0, 0);
  const idleSec = 300, staleSec = 900;
  const tsAge = (ageSec) => new Date(now - ageSec * 1000).toISOString();
  // recent -> live; older than idle but within stale -> idle; older than stale -> stale
  assert.strictEqual(TV.livenessTier(tsAge(10), now, idleSec, staleSec), "live");
  assert.strictEqual(TV.livenessTier(tsAge(600), now, idleSec, staleSec), "idle");
  assert.strictEqual(TV.livenessTier(tsAge(1200), now, idleSec, staleSec), "stale");
  // boundary inclusive on the aliver side
  assert.strictEqual(TV.livenessTier(tsAge(idleSec), now, idleSec, staleSec), "live");
  assert.strictEqual(TV.livenessTier(tsAge(staleSec), now, idleSec, staleSec), "idle");
  // degrade-safe: missing / unparseable -> unknown, never throws
  assert.strictEqual(TV.livenessTier(undefined, now, idleSec, staleSec), "unknown");
  assert.strictEqual(TV.livenessTier("not-a-date", now, idleSec, staleSec), "unknown");
});

test("E7-2: tics board groups members by scope (unscoped bucket) with a liveness tier; empty bus exits 0 friendly", () => {
  const d = inst();
  const e = inst();
  try {
    // A populated bus: sessA holds scope auth/S1 (active claim); sessB holds no scope -> unscoped.
    srcLib(d, "export TICS_SESSION='sessA'; export TICS_SCOPE='auth/S1'; emit_tic a '*' claim login.ts login.ts");
    srcLib(d, "export TICS_SESSION='sessB'; emit_tic b '*' note hello");
    const b = read(d, "board");
    assert.strictEqual(b.status, 0, "board renders a populated bus: " + b.stderr);
    const line = (s) => b.stdout.split("\n").find((l) => l.includes(s)) || "";
    assert.match(b.stdout, /auth\/S1/, "groups under the held scope heading");
    assert.match(line("sessA"), /auth\/S1|live/i, "sessA appears with its scope/liveness");
    assert.match(b.stdout, /sessA/, "the scope holder is shown");
    assert.match(b.stdout, /live/i, "a liveness tier word is shown (fresh tics read live)");
    assert.match(b.stdout, /unscoped/i, "members holding no scope group under unscoped");
    assert.match(line("sessB"), /sessB/, "the no-scope member is listed");

    // Empty bus: friendly indicator, still exits 0 (degrade-safe).
    const eb = read(e, "board");
    assert.strictEqual(eb.status, 0, "an empty bus still exits 0: " + eb.stderr);
    assert.match(eb.stdout, /no .*(fleet|activity|sessions)/i, "prints a friendly empty indicator");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("V1r (ADR 0027): tics board renders a no-session role as \"<from> (no session)\", its long id never running into the tier", () => {
  const d = inst();
  try {
    fs.rmSync(path.join(d, ".claude", "state", "session"), { force: true });   // no fallback session id either
    srcLib(d, "export TICS_SESSION=''; emit_tic contract-auditor '*' note hi");
    assert.strictEqual(ticsOf(d).pop().session, "", "precondition: the tic carries no session");
    const b = read(d, "board");
    assert.strictEqual(b.status, 0, "board renders: " + b.stderr);
    assert.match(b.stdout, /contract-auditor \(no session\)\s+live\b/, "the role row reads '<from> (no session)' then at least one space, then its tier");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E7-3: tics board flags STUCK only for a held scope that is stale — never idle/live/unknown or unscoped", () => {
  const d = inst();
  try {
    // Deterministic timestamps: liveness is computed from real Date.now(), and `stale` means older
    // than LIVENESS_STALE_SEC (default 900s). So build the bus directly (NOT emit_tic, which stamps
    // "now"). Claims never auto-expire (release-on-section-done only, ADR 0015) so a stale holder still HOLDS its claim.
    const now = Date.now();
    const stale = new Date(now - 3600 * 1000).toISOString();   // 1h ago -> stale
    const live = new Date(now - 5 * 1000).toISOString();        // 5s ago -> live
    const idle = new Date(now - 600 * 1000).toISOString();      // 600s ago -> between idle(300) and stale(900) -> idle
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ ts: stale, seq: 1, kind: "claim", from: "a", to: "*", scope: "pay/S1", session: "sessStuck", ref: "api.ts", msg: "api.ts" }) + "\n" +
      JSON.stringify({ ts: live, seq: 2, kind: "claim", from: "b", to: "*", scope: "ui/S2", session: "sessLive", ref: "web.ts", msg: "web.ts" }) + "\n" +
      JSON.stringify({ ts: stale, seq: 3, kind: "note", from: "c", to: "*", session: "sessGhostNoScope", msg: "ghost" }) + "\n" +
      JSON.stringify({ ts: idle, seq: 4, kind: "claim", from: "e", to: "*", scope: "idle/S3", session: "sessIdleHeld", ref: "idle.ts", msg: "idle.ts" }) + "\n" +
      JSON.stringify({ ts: "not-a-date", seq: 5, kind: "claim", from: "f", to: "*", scope: "unk/S4", session: "sessUnknownHeld", ref: "unk.ts", msg: "unk.ts" }) + "\n");
    const b = read(d, "board");
    assert.strictEqual(b.status, 0, "board renders the populated bus: " + b.stderr);
    assert.match(b.stdout, /STUCK/, "a STUCK call-out token is shown");
    const stuckText = b.stdout.split("\n").filter((l) => /STUCK/i.test(l)).join("\n");
    assert.match(stuckText, /sessStuck|pay\/S1/, "STUCK names the held-and-stale member (sessStuck / pay/S1)");
    // No false alarms: assert each non-(held+stale) member's OWN board row carries no STUCK marker
    // (stronger than scanning the joined STUCK blob — pins the detector's per-member output directly).
    const rowOf = (name) => b.stdout.split("\n").find((l) => l.includes(name)) || "";
    assert.doesNotMatch(rowOf("sessLive"), /STUCK/, "a live holder is never STUCK (no false alarm)");
    assert.doesNotMatch(rowOf("sessGhostNoScope"), /STUCK/, "a stale member holding no scope is never STUCK (no false alarm)");
    assert.doesNotMatch(rowOf("sessIdleHeld"), /STUCK/, "an idle holder is never STUCK (no false alarm)");
    assert.doesNotMatch(rowOf("sessUnknownHeld"), /STUCK/, "an unknown-liveness holder is never STUCK (no false alarm)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E7-5: tics board flags a scope touched by >=2 distinct sessions as a collision — one session (even many tics) is not", () => {
  const d = inst();
  try {
    // shared/S1 is touched by two DISTINCT sessions -> a collision.
    srcLib(d, "export TICS_SESSION='sessX'; export TICS_SCOPE='shared/S1'; emit_tic x '*' note working");
    srcLib(d, "export TICS_SESSION='sessY'; export TICS_SCOPE='shared/S1'; emit_tic y '*' note working");
    // solo/S2 is touched by ONE session twice -> NOT a collision (no self-collision).
    srcLib(d, "export TICS_SESSION='sessZ'; export TICS_SCOPE='solo/S2'; emit_tic z '*' note one");
    srcLib(d, "export TICS_SESSION='sessZ'; export TICS_SCOPE='solo/S2'; emit_tic z '*' note two");

    const b = read(d, "board");
    assert.strictEqual(b.status, 0, "board renders the populated bus: " + b.stderr);
    assert.match(b.stdout, /collision/i, "a collision call-out token is shown");
    const collisionText = b.stdout.split("\n").filter((l) => /collision/i.test(l)).join("\n");
    assert.match(collisionText, /shared\/S1/, "collision names the contested scope");
    assert.match(collisionText, /sessX/, "collision names the first colliding session");
    assert.match(collisionText, /sessY/, "collision names the second colliding session");
    assert.doesNotMatch(collisionText, /solo\/S2/, "one session's many tics never self-collide (no false alarm)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E7-6: tics cycle prints a fleet-health line (stuck/collision counts + liveness tally); quiet bus shows zeros, exits 0", () => {
  const d = inst();
  const e = inst();
  try {
    // Quiet/empty bus: fleet-health line reports zeros and cycle still exits 0.
    const ec = read(e, "cycle");
    assert.strictEqual(ec.status, 0, "cycle exits 0 on a quiet bus: " + ec.stderr);
    const eFleet = ec.stdout.split("\n").find((l) => /fleet/i.test(l)) || "";
    assert.match(eFleet, /fleet/i, "a fleet-health line is printed on a quiet bus");
    assert.match(eFleet, /stuck[^0-9]*0/i, "quiet bus reports zero stuck");
    assert.match(eFleet, /colli\w*[^0-9]*0/i, "quiet bus reports zero collisions");

    // Populated bus: two distinct sessions on hot/S1 -> one collision; fresh tics -> live members.
    srcLib(d, "export TICS_SESSION='sA'; export TICS_SCOPE='hot/S1'; emit_tic a '*' note x");
    srcLib(d, "export TICS_SESSION='sB'; export TICS_SCOPE='hot/S1'; emit_tic b '*' note y");
    const c = read(d, "cycle");
    assert.strictEqual(c.status, 0, "cycle exits 0 on a populated bus: " + c.stderr);
    const fleet = c.stdout.split("\n").find((l) => /fleet/i.test(l)) || "";
    assert.match(fleet, /colli\w*[^0-9]*[1-9]/i, "fleet-health line shows at least one collision");
    assert.match(fleet, /live[^0-9]*[1-9]/i, "fleet-health line reflects the live members in its liveness tally");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("F1b: a commented RED_STREAK_LIMIT is inactive (tics cycle uses the default limit) — no false red-storm", () => {
  const d = inst();
  try {
    // A COMMENTED knob must be ignored; the default limit (5) applies.
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\n#   RED_STREAK_LIMIT=2    # example (commented)\n");
    fs.writeFileSync(path.join(d, ".claude", "state", "red-streak"), "3\n");   // above commented "2", below default 5
    const c = read(d, "cycle").stdout;
    assert.match(c, /red-streak.*3|3 reds/i, "shows the current streak");
    assert.doesNotMatch(c, /over-constrained|contradictory|red-storm|reconsider/i, "a COMMENTED RED_STREAK_LIMIT must be inactive — default limit (5) applies, so streak 3 is not a red-storm");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("G1: fleetModel collision ignores the '*' wildcard session (no false collision) but still flags 2 real sessions", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 5, 16, 0, 0, 0);
  const ts = new Date(now - 5000).toISOString();
  // hot/S1: one REAL session + a wildcard-session tic (session "*") on the SAME scope.
  // dup/S2: two REAL distinct sessions (positive control).
  const tics = [
    { seq: 1, kind: "note", from: "a", to: "*", session: "sessReal", scope: "hot/S1", ts },
    { seq: 2, kind: "note", from: "b", to: "*", session: "*", scope: "hot/S1", ts },
    { seq: 3, kind: "note", from: "c", to: "*", session: "sessX", scope: "dup/S2", ts },
    { seq: 4, kind: "note", from: "d", to: "*", session: "sessY", scope: "dup/S2", ts },
  ];
  const { collisions } = TV.fleetModel("/tmp/nonexistent-g1", tics, { nowMs: now });
  // hot/S1 has only ONE real distinct session — the "*" wildcard is the reserved `to` token, not a session.
  const hot = collisions.find((c) => c.scope === "hot/S1");
  assert.strictEqual(hot, undefined, 'hot/S1 must NOT be a collision: the "*" wildcard is not a real session');
  assert.ok(!collisions.some((c) => c.sessions.includes("*")), 'no collision may list the "*" wildcard as a session');
  // Positive control: dup/S2 has two REAL distinct sessions — it IS a collision.
  const dup = collisions.find((c) => c.scope === "dup/S2");
  assert.deepStrictEqual(dup && dup.sessions, ["sessX", "sessY"], "two real distinct sessions on a scope is a genuine collision");
});

test("V1w (ADR 0027): a tic with the '*' wildcard session counts toward its role (\"<from> (no session)\"), never a member named '*'", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const ts = new Date(now - 5000).toISOString();
  const tics = [{ seq: 1, kind: "note", from: "b", to: "*", session: "*", scope: "hot/S1", ts }];
  const names = TV.fleetModel("/tmp/nonexistent-v1w", tics, { nowMs: now }).members.map((x) => x.session);
  assert.deepStrictEqual(names, ["b (no session)"], 'the "*" wildcard is not a session: the tic counts toward its role, and no member is "*"');
});

test("V1+V2 (ADR 0027): fleetModel lists a role with no session id as a member, but hook telemetry creates none", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const ts = new Date(now - 5000).toISOString();
  // the fleet shape: the leader never sets a session id; the auditor does; hook telemetry has none
  const tics = [
    { seq: 1, kind: "note", from: "leader", to: "fleet", session: "", ts },
    { seq: 2, kind: "verdict", from: "auditor", to: "fleet", session: "sessAud", ts },
    { seq: 3, kind: "signal", from: "run-suite", to: "*", session: "", result: "red", ts },
    { seq: 4, kind: "block", from: "guard", to: "orchestrator", session: "", ts },
  ];
  const m = TV.fleetModel("/tmp/nonexistent-v1", tics, { nowMs: now });
  const names = m.members.map((x) => x.session).sort();
  assert.deepStrictEqual(names, ["leader (no session)", "sessAud"], "the no-session leader is a member; hook telemetry (signal/block) is not");
  const leader = m.members.find((x) => x.session === "leader (no session)");
  assert.strictEqual(leader.liveness, "live", "the role member carries liveness from its last tic");
  assert.strictEqual(leader.lastTs, ts, "and its last ts");
});

test("V3 (ADR 0027): a stale no-session role holding a claim reads STUCK; two no-session roles on one scope are not a collision", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const stale = new Date(now - 3600 * 1000).toISOString(), live = new Date(now - 5000).toISOString();
  const tics = [
    { seq: 1, kind: "claim", from: "leader", to: "fleet", session: "", scope: "q11", ref: "Q11", ts: stale },
    { seq: 2, kind: "note", from: "macm12", to: "fleet", session: "", scope: "q16", ts: live },
    { seq: 3, kind: "note", from: "coordinator", to: "fleet", session: "", scope: "q16", ts: live },
  ];
  const m = TV.fleetModel("/tmp/nonexistent-v3", tics, { nowMs: now });
  const leader = m.members.find((x) => x.session === "leader (no session)");
  assert.ok(leader, "the no-session leader is a member");
  assert.strictEqual(leader.scope, "q11", "its no-session claim gives it a held scope");
  assert.strictEqual(leader.stuck, true, "stale + holding a claim = STUCK, as for a session");
  assert.deepStrictEqual(m.collisions, [], "two no-session roles on one scope are not two live sessions (no false collision)");
});

test("V4 (ADR 0027): a signal-only role is a member; every hook identity tic.sh reserves (subagent, witness too) creates none", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const now = Date.UTC(2026, 9, 23, 0, 0, 0);
  const ts = new Date(now - 5000).toISOString();
  // the real fleet: dev-ops only ever emits signals; SubagentStop and witness telemetry carry no session
  const tics = [
    { seq: 1, kind: "signal", from: "dev-ops", to: "fleet", session: "", ts },
    { seq: 2, kind: "handoff", from: "subagent", to: "orchestrator", session: "", ts },
    { seq: 3, kind: "note", from: "witness", to: "fleet", session: "", ts },
  ];
  const ticSh = fs.readFileSync(path.join(__dirname, "..", "kit", "hooks", "tic.sh"), "utf8");
  const reservedCase = ticSh.match(/case "\$\{1:-\}" in ([a-z-]+(?:\|[a-z-]+)+)\)/);   // any order of the reserved names
  assert.ok(reservedCase, "tic.sh must still carry its hook-only FROM guard: case \"${1:-}\" in a|b|...)");
  const reserved = reservedCase[1].split("|").sort();
  const m = TV.fleetModel("/tmp/nonexistent-v4", tics, { nowMs: now });
  const names = m.members.map((x) => x.session).sort();
  assert.deepStrictEqual(names, ["dev-ops (no session)"], "the signal-only role is a member; subagent/witness hook telemetry is not");
  assert.deepStrictEqual([...(TV.HOOK_IDENTITIES || [])].sort(), reserved, "the view's hook identities match the ones tic.sh reserves");
  // the third copy (ADR 0026 P7): tics-lib.sh keeps hook telemetry local by the same list
  const libSh = fs.readFileSync(path.join(__dirname, "..", "kit", "hooks", "tics-lib.sh"), "utf8");
  const libCase = libSh.match(/case "\$1" in ([a-z-]+(?:\|[a-z-]+)+)\) \[ "\$_ts" = "git" \]/);
  assert.ok(libCase, "tics-lib.sh must still carry its hook-local store downgrade: case \"$1\" in a|b|...) [ \"$_ts\" = \"git\" ]");
  assert.deepStrictEqual(libCase[1].split("|").sort(), reserved, "tics-lib.sh's hook-local list matches the identities tic.sh reserves");
});

test("E8-1: greenAttestation classifies a green signal as hook-signed (from=run-suite) vs self-reported (role), null otherwise; never throws", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  // a green signal from the suite-runner hook is real proof
  assert.strictEqual(TV.greenAttestation({ kind: "signal", result: "green", from: "run-suite" }), "hook-signed");
  // a green signal hand-emitted by a role is only self-reported
  assert.strictEqual(TV.greenAttestation({ kind: "signal", result: "green", from: "implementer" }), "self-reported");
  assert.strictEqual(TV.greenAttestation({ kind: "signal", result: "green", from: "orchestrator" }), "self-reported");
  // a red signal is never proof, regardless of from
  assert.strictEqual(TV.greenAttestation({ kind: "signal", result: "red", from: "run-suite" }), null);
  // a non-signal kind is never an attestation
  assert.strictEqual(TV.greenAttestation({ kind: "note", from: "run-suite" }), null);
  // degrade-safe: missing/empty from, malformed/empty object, null -> null, never throws
  assert.strictEqual(TV.greenAttestation({ kind: "signal", result: "green" }), null);
  assert.strictEqual(TV.greenAttestation({}), null);
  assert.strictEqual(TV.greenAttestation(null), null);
});

test("E8-1b: attestationTally folds signals into {hookSigned,selfReported,greens} (reconciling), skipping non-greens; empty->zeros", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const tics = [
    { kind: "signal", result: "green", from: "run-suite", seq: 1 },   // hook-signed
    { kind: "signal", result: "green", from: "run-suite", seq: 2 },   // hook-signed
    { kind: "signal", result: "green", from: "implementer", seq: 3 }, // self-reported
    { kind: "signal", result: "red", from: "run-suite", seq: 4 },     // red -> not counted
    { kind: "note", from: "run-suite", seq: 5 },                       // non-signal -> not counted
  ];
  const r = TV.attestationTally(tics);
  assert.deepStrictEqual(r, { hookSigned: 2, selfReported: 1, greens: 3 });
  // reconciliation invariant: every green is exactly one of hook-signed / self-reported
  assert.strictEqual(r.hookSigned + r.selfReported, r.greens);
  // degrade-safe: empty list -> zeros, never throws
  assert.deepStrictEqual(TV.attestationTally([]), { hookSigned: 0, selfReported: 0, greens: 0 });
  // degrade-safe: a non-array (undefined / null) -> zeros, never throws
  assert.deepStrictEqual(TV.attestationTally(undefined), { hookSigned: 0, selfReported: 0, greens: 0 });
  assert.deepStrictEqual(TV.attestationTally(null), { hookSigned: 0, selfReported: 0, greens: 0 });
});

test("E8-3a: tics gate surfaces a no-hook-signed-green warning (flag-only, still exit 0) when all greens are self-reported; silent when a hook-signed green exists", () => {
  // Passing PO + critic verdicts keep the gate CLEAR (exit 0). The attestation SURFACE is flag-only:
  // it warns but must NOT change the exit code (the hard-block under ATTEST_ENFORCE is a later slice).
  const verdicts =
    JSON.stringify({ kind: "verdict", from: "product-owner", to: "*", result: "accept", msg: "E8 accept", seq: 1 }) + "\n" +
    JSON.stringify({ kind: "verdict", from: "tdd-critic", to: "*", result: "pass", msg: "E8 pass", seq: 2 }) + "\n";

  // Case A: greens exist but NONE is hook-signed (a self-reported green only) -> the warning surfaces.
  const d = inst();
  // Case B: a hook-signed green (from=run-suite) exists -> no false alarm, the warning stays silent.
  const e = inst();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "implementer", to: "*", result: "green", msg: "[app] suite green", seq: 3 }) + "\n");
    const a = read(d, "gate");
    const aOut = a.stdout + a.stderr;
    assert.strictEqual(a.status, 0, "flag-only: the verdict gate stays CLEAR (exit 0) by default — the attestation surface must NOT block: " + aOut);
    assert.match(aOut, /no hook-signed|unrefereed|self-reported/i, "warns that the release has only self-reported (unrefereed) green evidence");

    fs.writeFileSync(path.join(e, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green", seq: 3 }) + "\n");
    const b = read(e, "gate");
    const bOut = b.stdout + b.stderr;
    assert.strictEqual(b.status, 0, "a hook-signed green keeps the gate CLEAR (exit 0): " + bOut);
    assert.doesNotMatch(bOut, /no hook-signed|unrefereed|self-reported/i, "no false alarm: a hook-signed green means no attestation warning surfaces");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("E8-3b: tics gate hard-blocks under ATTEST_ENFORCE when all greens are self-reported; never false-blocks (hook-signed green / zero greens / default off)", () => {
  // Passing PO + critic verdicts keep the VERDICT gate CLEAR, isolating the attestation effect.
  const verdicts =
    JSON.stringify({ kind: "verdict", from: "product-owner", to: "*", result: "accept", msg: "E8 accept", seq: 1 }) + "\n" +
    JSON.stringify({ kind: "verdict", from: "tdd-critic", to: "*", result: "pass", msg: "E8 pass", seq: 2 }) + "\n";
  const selfGreen = JSON.stringify({ kind: "signal", from: "implementer", to: "*", result: "green", msg: "[app] suite green", seq: 3 }) + "\n";
  const hookGreen = JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green", seq: 3 }) + "\n";

  // Case 1 BLOCK: enforce on + only self-reported green -> hard block (non-zero exit).
  const block = inst();
  // Case 2 no-false-block: enforce on + a hook-signed green exists -> CLEAR (a refereed green).
  const hooked = inst();
  // Case 3 no-false-block: enforce on + zero greens (verdict-only bus) -> nothing to attest, CLEAR.
  const empty = inst();
  // Case 4 default off: no ATTEST_ENFORCE + only self-reported green -> S4 flag-only, no block.
  const def = inst();
  try {
    // Arrange — turn the enforce knob on in three installs.
    [block, hooked, empty].forEach((x) => fs.appendFileSync(path.join(x, ".claude", "tdd.config"), "\nATTEST_ENFORCE=1\n"));

    fs.writeFileSync(path.join(block, ".claude", "state", "tics.jsonl"), verdicts + selfGreen);
    fs.writeFileSync(path.join(hooked, ".claude", "state", "tics.jsonl"), verdicts + hookGreen);
    fs.writeFileSync(path.join(empty, ".claude", "state", "tics.jsonl"), verdicts);
    fs.writeFileSync(path.join(def, ".claude", "state", "tics.jsonl"), verdicts + selfGreen);

    // Act
    const r1 = read(block, "gate"), o1 = r1.stdout + r1.stderr;
    const r2 = read(hooked, "gate"), o2 = r2.stdout + r2.stderr;
    const r3 = read(empty, "gate"), o3 = r3.stdout + r3.stderr;
    const r4 = read(def, "gate"), o4 = r4.stdout + r4.stderr;

    // Assert
    assert.notStrictEqual(r1.status, 0, "ATTEST_ENFORCE=1 + only self-reported green -> hard block (non-zero exit): " + o1);
    assert.match(o1, /hook-signed|unrefereed|self-reported|ATTEST_ENFORCE/i, "the block names the attestation reason: " + o1);
    assert.strictEqual(r2.status, 0, "no false block: a hook-signed green means a refereed green exists -> CLEAR: " + o2);
    assert.strictEqual(r3.status, 0, "no false block: zero greens means nothing to attest -> CLEAR: " + o3);
    assert.strictEqual(r4.status, 0, "default off: self-reported-only green stays flag-only (S4) -> CLEAR: " + o4);
  } finally {
    [block, hooked, empty, def].forEach((x) => fs.rmSync(x, { recursive: true, force: true }));
  }
});

test("E9-1: cfgStr reads an uncommented string config value (quotes stripped), ignores commented/missing keys, degrade-safe default", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const d = inst();
  try {
    // Arrange — model-tiering lines: uncommented (plain + double-quoted), and two commented variants
    // (leading-whitespace-then-`#`, and `#`-with-leading-spaces) that must NOT match (the F1 line-anchor lesson).
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"),
      "\nMODEL_IMPLEMENTER=fast-model\nMODEL_ARCHITECT=\"claude-capable\"\n#   MODEL_TDD_CRITIC=should-be-ignored\n   #MODEL_PRODUCT_OWNER=also-ignored\n");
    // Act + Assert
    assert.strictEqual(TV.cfgStr(d, "MODEL_IMPLEMENTER", "DEF"), "fast-model", "an uncommented KEY=value returns the trimmed value");
    assert.strictEqual(TV.cfgStr(d, "MODEL_ARCHITECT", "DEF"), "claude-capable", "surrounding double-quotes are stripped");
    assert.strictEqual(TV.cfgStr(d, "MODEL_TDD_CRITIC", "DEF"), "DEF", "a `#`-commented line (leading spaces) is ignored — line-anchored, not read");
    assert.strictEqual(TV.cfgStr(d, "MODEL_PRODUCT_OWNER", "DEF"), "DEF", "leading-whitespace-then-`#` is also ignored");
    assert.strictEqual(TV.cfgStr(d, "MODEL_MISSING", "DEF"), "DEF", "an absent key returns the default");
    // degrade-safe: a missing dir/file returns the default, never throws.
    assert.strictEqual(TV.cfgStr("/tmp/nonexistent-e9-" + Date.now(), "MODEL_IMPLEMENTER", "DEF"), "DEF", "missing dir/file -> default, never throws");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E9-1: tics roster lists each standard role with its configured MODEL_<ROLE> (or (default) when unset); degrade-safe", () => {
  const d = inst();
  const e = inst();
  try {
    // Arrange — configure two roles; the role->key mapping uppercases + hyphen->underscore
    // (implementer -> MODEL_IMPLEMENTER, test-writer -> MODEL_TEST_WRITER). architect is left unset.
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nMODEL_IMPLEMENTER=fast-model\nMODEL_TEST_WRITER=capable-model\n");

    // Act + Assert — configured roster shows each role beside its model.
    const r = read(d, "roster");
    assert.strictEqual(r.status, 0, "roster exits 0 on a configured install: " + r.stderr);
    const rowOf = (name) => r.stdout.split("\n").find((l) => l.includes(name)) || "";
    assert.match(rowOf("implementer"), /fast-model/, "implementer shows its configured MODEL_IMPLEMENTER");
    assert.match(rowOf("test-writer"), /capable-model/, "test-writer shows its configured MODEL_TEST_WRITER (hyphen->underscore key)");
    assert.match(rowOf("architect"), /\(default\)/i, "an unset role (no MODEL_ARCHITECT) shows the (default) marker");

    // Degrade-safe — a fresh empty install: every role unset -> (default), still exits 0, never crashes.
    const er = read(e, "roster");
    assert.strictEqual(er.status, 0, "roster exits 0 on a fresh empty install (degrade-safe): " + er.stderr);
    assert.match(er.stdout, /\(default\)/, "with no MODEL_* set, every role shows (default)");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("SD-1: tics roster folds per-role draft-review verdicts into a `drafts a/e/r` tally; a role with none shows no nonzero drafts", () => {
  const d = inst();
  try {
    // Arrange — the orchestrator's draft-review verdicts addressed TO implementer (ADR 0022):
    // two accepts, one edit, one reject. Plus a NON-draft broadcast reviewer verdict that must NOT be folded in.
    srcLib(d, "emit_tic orchestrator implementer verdict 'draft review: rank slice' s1 accept");
    srcLib(d, "emit_tic orchestrator implementer verdict 'draft review: feed slice' s2 accept");
    srcLib(d, "emit_tic orchestrator implementer verdict 'draft review: cache slice' s3 edit");
    srcLib(d, "emit_tic orchestrator implementer verdict 'draft review: auth slice' s4 reject");
    srcLib(d, "emit_tic tdd-critic '*' verdict 'audit PASS' '' pass");

    // Act
    const r = read(d, "roster");
    assert.strictEqual(r.status, 0, "roster exits 0 on a bus with draft-review verdicts: " + r.stderr);

    // Assert — implementer's row carries the accept/edit/reject fold; test-writer (no draft verdicts) shows no nonzero tally.
    const out = r.stdout;
    assert.match(out, /implementer.*drafts 2\/1\/1/, "implementer's row shows drafts 2/1/1 (2 accept, 1 edit, 1 reject) — the draft-review acceptance fold");
    assert.ok(!/test-writer.*drafts [1-9]/.test(out), "a role with no draft-review verdicts shows no nonzero drafts tally (no spurious count)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// MUTATION GUARD (green on current code): the fold addresses drafts by `x.to === role`, which already
// excludes the '*' broadcast — so this pins that behavior. It kills the surviving mutant that widens the
// address match to `x.to === role || x.to === "*"`, which would count a broadcast toward EVERY role
// (SD-1's negative case can't catch it: its broadcast is a `pass`, rejected by the RESULT filter before
// addressing is ever consulted). Per tdd-critic: locks existing behavior, does not spec new behavior.
test("SD-2: a BROADCAST draft-review-shaped verdict is folded into NO role's drafts tally — only verdicts addressed to a specific role count", () => {
  const d = inst();
  try {
    // Arrange — one draft review addressed TO implementer, plus a broadcast ('*') draft-review-SHAPED verdict
    // (result `accept`, same shape) that must not leak into any role's tally.
    srcLib(d, "emit_tic orchestrator implementer verdict 'draft review: real' s1 accept");
    srcLib(d, "emit_tic orchestrator '*' verdict 'draft review: broadcast' s5 accept");

    // Act
    const r = read(d, "roster");
    assert.strictEqual(r.status, 0, "roster exits 0 on a bus with a broadcast draft-review-shaped verdict: " + r.stderr);

    // Assert — implementer counts only its one directed review; the broadcast did NOT bump it to 2/0/0.
    const out = r.stdout;
    assert.match(out, /implementer.*drafts 1\/0\/0/, "implementer's row shows drafts 1/0/0 — the '*' broadcast is not folded in");
    // And no OTHER role picked up the broadcast (with the mutant, every role would show a drafts tally).
    assert.ok(!/test-writer.*drafts/.test(out), "the broadcast does not count toward test-writer");
    assert.ok(!/architect.*drafts/.test(out), "the broadcast does not count toward architect");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E10-1a: isHookSignedRed is true only for a red signal from run-suite (self-reported red / green / non-signal / malformed -> false; never throws)", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  // a red signal from the suite-runner hook is hook-signed evidence
  assert.strictEqual(TV.isHookSignedRed({ kind: "signal", result: "red", from: "run-suite" }), true);
  // a red signal hand-emitted by a role is only self-reported -> not evidence
  assert.strictEqual(TV.isHookSignedRed({ kind: "signal", result: "red", from: "implementer" }), false);
  // a green signal is never a red, regardless of from
  assert.strictEqual(TV.isHookSignedRed({ kind: "signal", result: "green", from: "run-suite" }), false);
  // a non-signal kind is never a hook-signed red
  assert.strictEqual(TV.isHookSignedRed({ kind: "note", from: "run-suite" }), false);
  // degrade-safe: malformed/empty object, null -> false, never throws
  assert.strictEqual(TV.isHookSignedRed({}), false);
  assert.strictEqual(TV.isHookSignedRed(null), false);
});

test("E10-1b: evidenceFor folds per-scope red-before-green (honored vs not-test-first); self-reported red & red-after-green not evidence; no-scope un-replayable; degrade-safe", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const S = (m, name) => m.scopes.find((s) => s.scope === name) || {};
  // Arrange — one fixture covering the four scope cases (explicit ascending seq).
  const fixture = [
    // test-first: a hook-signed red precedes the latest hook-signed green -> honored.
    { seq: 1, kind: "signal", result: "red", from: "run-suite", scope: "feat/S1" },
    { seq: 2, kind: "signal", result: "green", from: "run-suite", scope: "feat/S1" },
    // not-test-first: a hook-signed green with no preceding red.
    { seq: 3, kind: "signal", result: "green", from: "run-suite", scope: "bare/S2" },
    // self-reported red ignored: the role-emitted red is not evidence -> not test-first.
    { seq: 4, kind: "signal", result: "red", from: "implementer", scope: "fake/S3" },
    { seq: 5, kind: "signal", result: "green", from: "run-suite", scope: "fake/S3" },
    // red-after-green does not honor: the red follows the green by seq -> not test-first.
    { seq: 6, kind: "signal", result: "green", from: "run-suite", scope: "late/S4" },
    { seq: 7, kind: "signal", result: "red", from: "run-suite", scope: "late/S4" },
    // cross-scope: a hook-signed green on xscope/S5 with a hook-signed red on a DIFFERENT scope.
    // The sibling red must NOT honor xscope/S5 (exact-scope floor; no false-honor across scopes).
    { seq: 8, kind: "signal", result: "green", from: "run-suite", scope: "xscope/S5" },
    { seq: 9, kind: "signal", result: "red", from: "run-suite", scope: "sibling/S9" },
  ];
  // Act
  const m = TV.evidenceFor("/tmp/nonexistent-e10", fixture);
  // Assert — top-level rollups.
  assert.strictEqual(m.anyGreen, true, "a hook-signed green exists somewhere");
  assert.strictEqual(m.anyNotTestFirst, true, "at least one scoped green lacks a preceding hook-signed red");
  // test-first scope -> honored, red-before-green.
  assert.strictEqual(S(m, "feat/S1").honored, true, "feat/S1 had a hook-signed red before its green -> honored");
  assert.strictEqual(S(m, "feat/S1").redBeforeGreen, true, "feat/S1 red precedes its latest green");
  // not-test-first scope -> hasGreen but no preceding red.
  assert.strictEqual(S(m, "bare/S2").hasGreen, true, "bare/S2 has a hook-signed green");
  assert.strictEqual(S(m, "bare/S2").redBeforeGreen, false, "bare/S2 has no preceding hook-signed red");
  assert.strictEqual(S(m, "bare/S2").honored, false, "bare/S2 is not honored (no test-first red)");
  // self-reported red is not evidence.
  assert.strictEqual(S(m, "fake/S3").redBeforeGreen, false, "a role-emitted (self-reported) red does not honor the green");
  // a red after the green does not honor it.
  assert.strictEqual(S(m, "late/S4").redBeforeGreen, false, "a red AFTER the green (higher seq) does not honor it");
  // cross-scope: a red on a DIFFERENT scope (sibling/S9) does NOT honor xscope/S5's green.
  assert.strictEqual(S(m, "xscope/S5").hasGreen, true, "xscope/S5 has a hook-signed green");
  assert.strictEqual(S(m, "xscope/S5").redBeforeGreen, false, "a red on a different scope (sibling/S9) does not count for xscope/S5");
  assert.strictEqual(S(m, "xscope/S5").honored, false, "xscope/S5 is not honored (no test-first red on its own scope)");
  // No-scope degrade: a `*`-only green is un-replayable, never a violation.
  const star = TV.evidenceFor("/tmp/x", [{ seq: 1, kind: "signal", result: "green", from: "run-suite", scope: "*" }]);
  assert.strictEqual(star.anyGreen, true, "a `*` green still counts toward anyGreen");
  assert.strictEqual(star.anyNotTestFirst, false, "a `*`-only green is un-replayable -> NOT a not-test-first violation");
  // absent scope behaves the same (un-replayable).
  const noScope = TV.evidenceFor("/tmp/x", [{ seq: 1, kind: "signal", result: "green", from: "run-suite" }]);
  assert.strictEqual(noScope.anyGreen, true, "a scopeless green still counts toward anyGreen");
  assert.strictEqual(noScope.anyNotTestFirst, false, "a scopeless green is un-replayable -> NOT a violation");
  // Degrade-safe: empty list / null -> the zero shape, never throws.
  assert.deepStrictEqual(TV.evidenceFor("/tmp/x", []), { scopes: [], anyGreen: false, anyNotTestFirst: false });
  assert.deepStrictEqual(TV.evidenceFor("/tmp/x", null), { scopes: [], anyGreen: false, anyNotTestFirst: false });
});

test("E11-1: openNeeds folds needs open until a msg+result=answered references the token; a bare-ref msg never settles; n<seq> fallback; degrade-safe", () => {
  const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
  const handles = (r) => r.map((n) => n.handle);
  // Arrange — two open needs: one guard-style WITH ref, one ref-less manual need (n<seq> fallback).
  const needWithRef = { kind: "need", from: "guard", to: "*", scope: "auth/S1", ref: "app/login.ts", msg: "claim conflict on app/login.ts", seq: 1 };
  const needNoRef = { kind: "need", from: "peer", to: "architect", msg: "need the StockLevel contract", seq: 2 };
  const open = [needWithRef, needNoRef];
  // Act + Assert — both needs are open; the ref-need resolves its ref as handle, the ref-less one falls back to n<seq>.
  assert.deepStrictEqual(handles(TV.openNeeds(open)).sort(), ["app/login.ts", "n2"], "both needs open; handle = ref when present, else n<seq>");
  assert.ok(TV.openNeeds(open).some((n) => n.handle === "app/login.ts"), "the guard-style need resolves handle to its ref");
  assert.ok(TV.openNeeds(open).some((n) => n.handle === "n2"), "the ref-less need falls back to n<seq>");

  // Arrange — append a real ANSWER (msg + result=answered) referencing the first need's token.
  const answered = open.concat([
    { kind: "msg", from: "navigator", to: "guard", ref: "app/login.ts", result: "answered", msg: "use scope auth/S1", seq: 3 },
  ]);
  // Act + Assert — the answered need is settled (gone); the other need is still open.
  assert.ok(!TV.openNeeds(answered).some((n) => n.handle === "app/login.ts"), "a msg with result=answered referencing the token settles the need (removed)");
  assert.ok(TV.openNeeds(answered).some((n) => n.handle === "n2"), "the unanswered need stays open");

  // Arrange — the sentinel: an ORDINARY msg reusing the second need's token but NO result=answered.
  const bareRef = answered.concat([
    { kind: "msg", from: "x", to: "peer", ref: "n2", msg: "chatter", seq: 4 },
  ]);
  // Act + Assert — the load-bearing guard: a bare-ref msg does NOT settle the need (answered-set keys on result=answered).
  assert.ok(TV.openNeeds(bareRef).some((n) => n.handle === "n2"), "a bare-ref msg (no result=answered) must NOT settle the need — answered-set keys on result=answered, not bare ref");
  assert.ok(!TV.openNeeds(bareRef).some((n) => n.handle === "app/login.ts"), "the genuinely-answered need stays settled");

  // Arrange — contract guard #1 (no self-settle): a need that carries its OWN result=answered.
  // The answered-set admits ONLY kind=msg tics, so a need can't answer itself.
  const selfResult = bareRef.concat([
    { kind: "need", from: "x", to: "*", ref: "selfX", msg: "self-result need", result: "answered", seq: 5 },
  ]);
  // Act + Assert — the need stays OPEN: a need carrying result=answered must NOT settle itself.
  assert.ok(TV.openNeeds(selfResult).some((n) => n.handle === "selfX"), "a need carrying its own result=answered must NOT self-settle — answered-set admits only kind=msg tics");

  // Arrange — contract guard #2 (no cross-close): a need plus a handoff reusing its token.
  // A handoff pairs with delegates (a SEPARATE concern) — it must not reach the needs answered-set.
  const crossClose = selfResult.concat([
    { kind: "need", from: "y", to: "*", ref: "crossY", msg: "cross-close need", seq: 6 },
    { kind: "handoff", from: "impl", to: "*", ref: "crossY", result: "green", seq: 7 },
  ]);
  // Act + Assert — the crossY need stays OPEN: a handoff (even result=green on the token) does not close a need.
  assert.ok(TV.openNeeds(crossClose).some((n) => n.handle === "crossY"), "a handoff sharing the need's token must NOT settle the need — answered-set keys on kind=msg && result=answered");

  // Degrade-safe — empty / non-array inputs return [], never throw.
  assert.deepStrictEqual(TV.openNeeds([]), [], "empty list -> [] (no throw)");
  assert.deepStrictEqual(TV.openNeeds(undefined), [], "non-array (undefined) -> [] (guard, no throw)");
});

test("E11-2: tics review lists open needs (handle/asker/scope/question), groups ref-less as unaddressable, hides settled needs; empty bus exits 0", () => {
  const d = inst();
  const e = inst();
  try {
    // Arrange — a populated bus: a guard-style need WITH a ref (handle=ref) and a ref-less manual
    // need (handle=n<seq>). Direct-write deterministic seqs/ts (the openNeeds fold is seq-keyed).
    const ts = "2026-06-16T00:00:00Z";
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ kind: "need", from: "guard", to: "*", scope: "auth/S1", ref: "app/login.ts", msg: "claim conflict on app/login.ts", seq: 1, ts }) + "\n" +
      JSON.stringify({ kind: "need", from: "peer", to: "architect", msg: "need the StockLevel contract", seq: 2, ts }) + "\n");

    // Act + Assert — review renders the open needs.
    const r = read(d, "review");
    assert.strictEqual(r.status, 0, "review renders a populated bus: " + r.stderr);
    // the keyed need shows its handle, asker, scope, and question text.
    const keyed = r.stdout.split("\n").find((l) => l.includes("app/login.ts")) || "";
    assert.match(keyed, /app\/login\.ts/, "the keyed need shows its handle (the ref)");
    assert.match(keyed, /guard/, "the keyed need names the asker (from)");
    assert.match(keyed, /auth\/S1/, "the keyed need shows its scope");
    assert.match(r.stdout, /claim conflict/, "the keyed need shows the question text");
    // the ref-less need is grouped under an unaddressable (no ref) note with its n<seq> handle.
    assert.match(r.stdout, /unaddressable|no ref/i, "ref-less needs are grouped under an unaddressable (no ref) note");
    assert.match(r.stdout, /peer/, "the ref-less need names its asker (peer)");
    assert.match(r.stdout, /StockLevel/, "the ref-less need shows its question text");
    assert.match(r.stdout, /n2/, "the ref-less need shows its n<seq> handle");

    // Arrange — append a SETTLING answer (msg + result=answered) referencing the first need's token.
    fs.appendFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ kind: "msg", from: "navigator", to: "guard", ref: "app/login.ts", result: "answered", msg: "use auth/S1", seq: 3, ts }) + "\n");

    // Act + Assert — the answered need is gone; the unanswered ref-less need still appears.
    const r2 = read(d, "review");
    assert.strictEqual(r2.status, 0, "review still exits 0 after a settle: " + r2.stderr);
    assert.doesNotMatch(r2.stdout, /app\/login\.ts/, "a settled (result=answered) need no longer appears");
    assert.match(r2.stdout, /n2/, "the still-open ref-less need stays listed");

    // Empty bus: friendly indicator, still exits 0 (degrade-safe).
    const eb = read(e, "review");
    assert.strictEqual(eb.status, 0, "an empty bus still exits 0: " + eb.stderr);
    assert.match(eb.stdout, /no .*open .*need/i, "prints a friendly no-open-needs line");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("E11-3: tics answer emits a msg+answered to the asker (settles the need + lands in inbox); unknown/closed handle exits 2 and emits nothing", () => {
  const d = inst();
  try {
    // Arrange — one open guard-style need WITH a ref (handle = ref). asker = its `from`.
    const ts = "2026-06-16T00:00:00Z";
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ kind: "need", from: "test-writer", to: "architect", scope: "auth/S1", ref: "app/login.ts", msg: "which error contract for expired tokens?", seq: 1, ts }) + "\n");

    // Act — answer the need by its handle (the ref).
    const r = read(d, "answer", "app/login.ts", "use the AuthError contract");

    // Assert — answer succeeds and emits exactly ONE settling msg directed at the asker.
    assert.strictEqual(r.status, 0, "answer exits 0 on a matched open need: " + r.stderr);
    const settled = ticsOf(d).filter((x) => x.kind === "msg" && x.result === "answered");
    assert.strictEqual(settled.length, 1, "exactly one msg+answered tic was appended");
    assert.strictEqual(settled[0].to, "test-writer", "the answer is directed at the asker (the need's from)");
    assert.strictEqual(settled[0].ref, "app/login.ts", "the answer references the resolved token (the need's handle)");
    assert.strictEqual(settled[0].result, "answered", "the answer carries result=answered (settles the need)");
    assert.match(settled[0].msg, /use the AuthError contract/, "the answer carries the answer text");

    // Assert — it lands in the asker's inbox.
    assert.match(read(d, "inbox", "test-writer").stdout, /use the AuthError contract/, "the answer lands in the asker's inbox");

    // Assert — the need is now settled (gone from the open review queue).
    assert.doesNotMatch(read(d, "review").stdout, /app\/login\.ts/, "the answered need is removed from the open queue");

    // Act + Assert — a no-match handle is idempotent: exit 2, emits NOTHING.
    const before = ticsOf(d).length;
    const bad = read(d, "answer", "n999", "nope");
    assert.notStrictEqual(bad.status, 0, "answering an unknown/closed handle exits non-zero (2)");
    assert.strictEqual(ticsOf(d).length, before, "a no-match answer emits no tic (can't double-answer or answer a nonexistent need)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("tics inbox excludes broadcast signal telemetry but keeps actionable broadcast tics", () => {
  const d = inst();
  try {
    // Arrange — a bus with one actionable broadcast (delegate to *) and one run-suite signal (green
    // telemetry, broadcast to *). Direct-write deterministic seqs (the inbox fold is seq-ordered).
    const ts = "2026-06-16T00:00:00Z";
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ kind: "delegate", from: "orchestrator", to: "*", msg: "rank by score", ref: "S2", scope: "*", seq: 1, ts }) + "\n" +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", msg: "[app] suite green", scope: "*", seq: 2, ts }) + "\n");

    // Act
    const r = read(d, "inbox", "test-writer");

    // Assert — the actionable broadcast shows; the signal telemetry is excluded (belongs in log/report).
    assert.strictEqual(r.status, 0, "inbox exits 0 on a populated bus: " + r.stderr);
    assert.match(r.stdout, /rank by score/, "an actionable broadcast (delegate to *) shows in the inbox");
    assert.doesNotMatch(r.stdout, /suite green/, "a run-suite signal (green telemetry) is excluded from the inbox");
    assert.doesNotMatch(r.stdout, /\[signal\]/, "no signal-kind line surfaces in the inbox");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("WIN-1: per-tic readers (inbox/log) window to the last 40 by default with a --full footer; --full shows all (no overflow on a long-lived bus)", () => {
  const d = inst();
  try {
    // Arrange — a LARGE bus: 45 actionable broadcast tics (> the N=40 window). MARK001 is the
    // oldest (seq 1), MARK045 the newest (seq 45). Broadcasts (to=*) land in any role's inbox;
    // address the inbox to orchestrator (not a reserved hook identity) so all 45 are matched.
    const lines = [];
    for (let i = 1; i <= 45; i++) {
      const mark = "MARK" + String(i).padStart(3, "0");
      lines.push(JSON.stringify({ seq: i, ts: "2026-06-19T00:00:" + String(i % 60).padStart(2, "0"), from: "orchestrator", to: "*", kind: "delegate", msg: mark, layer: "app", phase: "red", scope: "" }));
    }
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"), lines.join("\n") + "\n");

    // Act + Assert — inbox default WINDOWS to the last 40: newest kept, oldest dropped, footer names --full.
    const ib = read(d, "inbox", "orchestrator");
    assert.strictEqual(ib.status, 0, "inbox exits 0 on a large bus: " + ib.stderr);
    assert.match(ib.stdout, /MARK045/, "inbox keeps the NEWEST tic (within the last-40 window)");
    assert.doesNotMatch(ib.stdout, /MARK001/, "inbox DROPS the oldest tic (beyond the last-40 window)");
    assert.match(ib.stdout, /showing last 40 of 45/, "inbox shows a truncation footer with the windowed/total counts");
    assert.match(ib.stdout, /--full/, "the footer names the --full escape hatch");

    // Act + Assert — inbox --full shows EVERYTHING (no window, no footer).
    const ibFull = read(d, "inbox", "orchestrator", "--full");
    assert.strictEqual(ibFull.status, 0, "inbox --full exits 0: " + ibFull.stderr);
    assert.match(ibFull.stdout, /MARK001/, "--full shows the oldest tic (no window)");
    assert.match(ibFull.stdout, /MARK045/, "--full shows the newest tic");
    assert.doesNotMatch(ibFull.stdout, /showing last 40 of 45/, "--full shows no truncation footer (nothing was truncated)");

    // Act + Assert — log default WINDOWS to the last 40 the same way.
    const lg = read(d, "log");
    assert.strictEqual(lg.status, 0, "log exits 0 on a large bus: " + lg.stderr);
    assert.match(lg.stdout, /MARK045/, "log keeps the NEWEST tic (within the last-40 window)");
    assert.doesNotMatch(lg.stdout, /MARK001/, "log DROPS the oldest tic (beyond the last-40 window)");
    assert.match(lg.stdout, /showing last 40 of 45/, "log shows a truncation footer with the windowed/total counts");
    assert.match(lg.stdout, /--full/, "the log footer names the --full escape hatch");

    // Act + Assert — log --full shows EVERYTHING.
    const lgFull = read(d, "log", "--full");
    assert.strictEqual(lgFull.status, 0, "log --full exits 0: " + lgFull.stderr);
    assert.match(lgFull.stdout, /MARK001/, "log --full shows the oldest tic (no window)");
    assert.match(lgFull.stdout, /MARK045/, "log --full shows the newest tic");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("E10-2: tics gate surfaces a no-red-before-green warning (flag-only, still exit 0) for a not-test-first green; silent when the green is evidenced", () => {
  // Passing PO + critic verdicts keep the VERDICT gate CLEAR (exit 0), isolating the EVIDENCE effect.
  // The evidence SURFACE is flag-only by default: it warns but must NOT change the exit code
  // (the hard-block under EVIDENCE_ENFORCE is the next slice; default config has no EVIDENCE_ENFORCE).
  const verdicts =
    JSON.stringify({ kind: "verdict", from: "product-owner", to: "*", result: "accept", msg: "E10 accept", seq: 1 }) + "\n" +
    JSON.stringify({ kind: "verdict", from: "tdd-critic", to: "*", result: "pass", msg: "E10 pass", seq: 2 }) + "\n";

  // Case A (surface): a hook-signed green on feat/S1 with NO preceding hook-signed red -> not test-first -> warns.
  const d = inst();
  // Case B (no false alarm): the same green PRECEDED by a hook-signed red on feat/S1 -> evidenced -> silent.
  const e = inst();
  try {
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "feat/S1", msg: "[app] suite green", seq: 3 }) + "\n");
    const a = read(d, "gate");
    const aOut = a.stdout + a.stderr;
    assert.strictEqual(a.status, 0, "flag-only: the verdict gate stays CLEAR (exit 0) by default — the evidence surface must NOT block: " + aOut);
    assert.match(aOut, /red-before-green|not.?test.?first|no .*evidence/i, "warns that a scoped green has no red-before-green (not test-first) evidence: " + aOut);
    assert.match(aOut, /feat\/S1/, "names the offending scope feat/S1: " + aOut);

    fs.writeFileSync(path.join(e, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "red", scope: "feat/S1", msg: "[app] suite red", seq: 3 }) + "\n" +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "feat/S1", msg: "[app] suite green", seq: 4 }) + "\n");
    const b = read(e, "gate");
    const bOut = b.stdout + b.stderr;
    assert.strictEqual(b.status, 0, "an evidenced (test-first) green keeps the gate CLEAR (exit 0): " + bOut);
    assert.doesNotMatch(bOut, /red-before-green|not.?test.?first|no .*evidence/i, "no false alarm: a hook-signed red before the green means no evidence warning surfaces: " + bOut);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(e, { recursive: true, force: true });
  }
});

test("E10-3: tics gate hard-blocks under EVIDENCE_ENFORCE for a not-test-first green; never false-blocks (evidenced / no greens / default off)", () => {
  // Passing PO + critic verdicts keep the VERDICT gate CLEAR, isolating the EVIDENCE effect.
  // All greens/reds are hook-signed (from=run-suite) so this is purely about SEQUENCE (red-before-green),
  // not provenance — keeping E8's ATTEST_ENFORCE dial entirely out of it.
  const verdicts =
    JSON.stringify({ kind: "verdict", from: "product-owner", to: "*", result: "accept", msg: "E10 accept", seq: 1 }) + "\n" +
    JSON.stringify({ kind: "verdict", from: "tdd-critic", to: "*", result: "pass", msg: "E10 pass", seq: 2 }) + "\n";

  // Case 1 BLOCK: enforce on + a not-test-first green (no preceding red on the scope) -> hard block.
  const block = inst();
  // Case 2 no-false-block: enforce on + a red-before-green on the scope -> evidenced -> CLEAR.
  const evidenced = inst();
  // Case 3 no-false-block: enforce on + NO greens (verdict-only bus) -> nothing to evidence -> CLEAR.
  const empty = inst();
  // Case 4 default off: no EVIDENCE_ENFORCE + a not-test-first green -> E10-2 flag-only, no block.
  const def = inst();
  // Case 5 no-false-block: enforce on + a `*`-scope-only green (no preceding red) -> un-replayable -> CLEAR
  // (ADR 0011 §3 case 3: the solo/zero-config floor — `*`-only greens can't be replayed, so not a not-test-first violation).
  const wildcard = inst();
  try {
    // Arrange — turn the enforce knob on in four installs (mirror the E8-3b ATTEST_ENFORCE pattern).
    [block, evidenced, empty, wildcard].forEach((x) => fs.appendFileSync(path.join(x, ".claude", "tdd.config"), "\nEVIDENCE_ENFORCE=1\n"));

    fs.writeFileSync(path.join(block, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "feat/S1", msg: "[app] suite green", seq: 3 }) + "\n");
    fs.writeFileSync(path.join(evidenced, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "red", scope: "feat/S1", msg: "[app] suite red", seq: 3 }) + "\n" +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "feat/S1", msg: "[app] suite green", seq: 4 }) + "\n");
    fs.writeFileSync(path.join(empty, ".claude", "state", "tics.jsonl"), verdicts);
    fs.writeFileSync(path.join(def, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "feat/S1", msg: "[app] suite green", seq: 3 }) + "\n");
    fs.writeFileSync(path.join(wildcard, ".claude", "state", "tics.jsonl"),
      verdicts +
      JSON.stringify({ kind: "signal", from: "run-suite", to: "*", result: "green", scope: "*", seq: 3 }) + "\n");

    // Act
    const r1 = read(block, "gate"), o1 = r1.stdout + r1.stderr;
    const r2 = read(evidenced, "gate"), o2 = r2.stdout + r2.stderr;
    const r3 = read(empty, "gate"), o3 = r3.stdout + r3.stderr;
    const r4 = read(def, "gate"), o4 = r4.stdout + r4.stderr;
    const r5 = read(wildcard, "gate"), o5 = r5.stdout + r5.stderr;

    // Assert
    assert.notStrictEqual(r1.status, 0, "EVIDENCE_ENFORCE=1 + a not-test-first green -> hard block (non-zero exit): " + o1);
    assert.match(o1, /red-before-green|not.?test.?first|evidence|EVIDENCE_ENFORCE/i, "the block names the evidence reason: " + o1);
    assert.strictEqual(r2.status, 0, "no false block: a red-before-green on the scope means the green is test-first -> CLEAR: " + o2);
    assert.strictEqual(r3.status, 0, "no false block: zero greens means nothing to evidence -> CLEAR: " + o3);
    assert.strictEqual(r4.status, 0, "default off: a not-test-first green stays flag-only (E10-2) -> CLEAR: " + o4);
    assert.strictEqual(r5.status, 0, "no false block: a `*`-only green is un-replayable -> not a not-test-first violation -> CLEAR even with enforce on: " + o5);
    assert.doesNotMatch(o5, /red-before-green|not.?test.?first/i, "no false-alarm line for an un-replayable `*`-only green: " + o5);
  } finally {
    [block, evidenced, empty, def, wildcard].forEach((x) => fs.rmSync(x, { recursive: true, force: true }));
  }
});

test("selftest passes (emit + read round-trip)", () => {
  assert.strictEqual(node("selftest").status, 0);
});

test("S7: tics mcp boots the stdio server (dispatch, not help) — every stdout line is a JSON-RPC frame (I2 stdout purity)", () => {
  const d = inst();
  try {
    const reqs = [
      JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2025-11-25", capabilities:{} } }),
      JSON.stringify({ jsonrpc:"2.0", id:2, method:"tools/list", params:{} }),
    ].join("\n") + "\n";
    const r = cp.spawnSync("node", [BIN, "mcp"], { input: reqs, encoding:"utf8", timeout:8000, cwd:d });
    assert.doesNotMatch(r.stdout, /TDD pairing|usage: tics|Unknown command|README/i, "dispatched to the server, not the help banner");
    const lines = r.stdout.split("\n").filter((s) => s.trim() !== "");
    assert.ok(lines.length >= 2, "one JSON-RPC response frame per request");
    let init = null, list = null;
    for (const ln of lines) {
      const obj = JSON.parse(ln);              // every stdout line MUST parse — I2 purity (no presenter/log text on fd1)
      assert.strictEqual(obj.jsonrpc, "2.0");
      if (obj.id === 1) init = obj;
      if (obj.id === 2) list = obj;
    }
    assert.ok(init && init.result && init.result.protocolVersion === "2025-11-25", "handshake frame present");
    assert.ok(list && list.result && Array.isArray(list.result.tools) && list.result.tools.length === 7, "tools/list frame present");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S8: tics mcp-install writes mcpServers.tics into .cursor/mcp.json and PRESERVES a pre-existing foreign server key + a foreign top-level key (merge, not clobber)", () => {
  const d = inst();
  try {
    fs.mkdirSync(path.join(d,".cursor"), {recursive:true});
    fs.writeFileSync(path.join(d,".cursor","mcp.json"),
      JSON.stringify({ mcpServers:{ other:{ command:"node", args:["other.js"] } }, someTopKey:1 }, null, 2));
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding:"utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(d,".cursor","mcp.json"),"utf8"));
    assert.ok(cfg.mcpServers.tics);
    assert.ok(typeof cfg.mcpServers.tics.command === "string" && cfg.mcpServers.tics.command);
    assert.ok(Array.isArray(cfg.mcpServers.tics.args) && cfg.mcpServers.tics.args.length);
    assert.ok(cfg.mcpServers.other, "foreign server key preserved");
    assert.strictEqual(cfg.mcpServers.other.args[0], "other.js");
    assert.strictEqual(cfg.someTopKey, 1, "foreign top-level key preserved");
    assert.doesNotMatch(r.stdout, /Installing team-tactics/i, "mcp-install does NOT run the full installer");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S9: tics mcp-install writes .cursor/rules/tics.mdc as an alwaysApply rule carrying the per-turn directive AND the convention-not-a-gate ceiling note (and no legacy .cursorrules)", () => {
  const d = inst();
  try {
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding:"utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const rule = fs.readFileSync(path.join(d,".cursor","rules","tics.mdc"), "utf8");
    assert.match(rule, /alwaysApply:\s*true/);
    assert.match(rule, /tics_inbox/);
    assert.match(rule, /tics_board/);
    assert.match(rule, /tics_review|answer|need/i);
    assert.match(rule, /tic_emit|emit/i);
    assert.match(rule, /convention|not a gate|not enforced|unrefereed|does not run in Cursor/i);
    assert.ok(!fs.existsSync(path.join(d,".cursorrules")), "no legacy root .cursorrules");
    assert.match(r.stdout, /INERT|enable|Tools & MCP/i, "prints the inert-until-enabled note");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("I2: tics mcp stdout stays pure across a read tools/call + a tic_emit — every fd1 line is a JSON-RPC frame, no presenter text leaks", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d,".claude","state","tics.jsonl"),
      JSON.stringify({kind:"delegate",from:"orchestrator",to:"architect",msg:"hi arch",ref:"X",scope:"*",seq:1,ts:"2026-06-16T00:00:00Z"})+"\n");
    const reqs = [
      JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{ protocolVersion:"2025-11-25", capabilities:{} } }),
      JSON.stringify({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"tics_inbox", arguments:{ role:"architect" } } }),
      JSON.stringify({ jsonrpc:"2.0", id:3, method:"tools/call", params:{ name:"tic_emit", arguments:{ from:"navigator", to:"architect", kind:"handoff", msg:"done" } } }),
    ].join("\n") + "\n";
    const r = cp.spawnSync("node", [BIN, "mcp"], { input: reqs, encoding:"utf8", timeout:8000, cwd:d });
    const lines = r.stdout.split("\n").filter((s) => s.trim() !== "");
    assert.ok(lines.length >= 3, "a JSON-RPC frame per request");
    for (const ln of lines) { const o = JSON.parse(ln); assert.strictEqual(o.jsonrpc, "2.0"); }
    assert.doesNotMatch(r.stdout, /^Inbox for/m, "presenter text never starts a raw stdout line");
    assert.doesNotMatch(r.stdout, /^Fleet board/m, "presenter text never starts a raw stdout line");
    const inbox = lines.map((l) => JSON.parse(l)).find((o) => o.id === 2);
    assert.match(inbox.result.content[0].text, /Inbox for architect/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S8b: mcp-install on a MALFORMED .cursor/mcp.json backs it up to .bak and re-inits (never silently clobbers)", () => {
  const d = inst();
  try {
    fs.mkdirSync(path.join(d,".cursor"), {recursive:true});
    fs.writeFileSync(path.join(d,".cursor","mcp.json"), "{ this is : not json ]");
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding:"utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(d,".cursor","mcp.json.bak")), "malformed original backed up to .bak");
    const cfg = JSON.parse(fs.readFileSync(path.join(d,".cursor","mcp.json"),"utf8"));
    assert.ok(cfg.mcpServers && cfg.mcpServers.tics, "re-initialized with the tics entry");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("IDENT-2: the always-apply rule tells each spawned sub-actor to stamp its own distinct session on tic_emit (so the bus distinguishes concurrent sub-actors)", () => {
  const d = inst();
  try {
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding:"utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const rule = fs.readFileSync(path.join(d,".cursor","rules","tics.mdc"), "utf8");
    assert.match(rule, /session/i);
    assert.match(rule, /distinct|distinguish|sub-?actor|background job|each (agent|actor|job|role)/i);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("CP-1a: writeCursorRule body carries the managed sentinel + method pointer (AGENTS.md) + install-hooks recommendation + GT-3 security honesty (v0.61 Cursor-parity), keeping session/convention-not-a-gate", () => {
  const d = inst();
  try {
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const rule = fs.readFileSync(path.join(d, ".cursor", "rules", "tics.mdc"), "utf8");
    // (1) frontmatter unchanged
    assert.match(rule, /alwaysApply:\s*true/);
    // (2) managed-by-kit sentinel so the updater recognizes a kit-owned rule
    assert.match(rule, /team-tactics: managed/);
    // (3) pointer to the canonical method (don't teach the TDD method inline)
    assert.match(rule, /AGENTS\.md/);
    // (4) portable-referee recommendation — Cursor users CAN get the git-hook gate
    assert.match(rule, /install-hooks/);
    // (5) ADR 0024 (W1/W2/W4/W10) — the enforcement boundary is host-dependent, not the falsified absolute
    assert.match(rule, /security/i);
    // W1 — the false host-absolute is gone (neither direction).
    assert.doesNotMatch(rule, /does NOT run in Cursor|not run in Cursor|does not run Claude Code's|do not run Claude Code's|the phase referee is gone|irreducibly Claude-Code-only|irreducibly CC-only|CC-only/i);
    // W1 (positive clause) — nor the OPPOSITE unhedged absolute (hooks DO run in Cursor).
    assert.doesNotMatch(rule, /Cursor runs the hooks|the referee runs in Cursor|hooks (do |)run in Cursor|Cursor (always|never) runs|always unrefereed/i);
    // W2 — host-dependence is stated positively.
    assert.match(rule, /host-dependent/);
    // W4 — the probe cites a reserved hook identity and the hook-signed classification.
    assert.match(rule, /run-suite|guard/);
    assert.match(rule, /hook-signed/);
    // W10 — single-source pointer to the enforcement detail.
    assert.match(rule, /tool-support\.md/);
    // (6) the distinct-session guidance survives
    assert.match(rule, /session/);
    // (7) the honesty boundary survives
    assert.match(rule, /unrefereed|self-reported|convention, not a gate/i);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MCC-1: tics mcp-install also writes a project .mcp.json (Claude Code) with mcpServers.tics, merge-not-clobber preserving foreign keys", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "node", args: ["other.js"] } }, topKey: 1 }, null, 2));
    const r = cp.spawnSync("node", [BIN, "mcp-install", d], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(d, ".mcp.json"), "utf8"));
    assert.ok(cfg.mcpServers && cfg.mcpServers.tics, ".mcp.json gains mcpServers.tics");
    assert.ok(Array.isArray(cfg.mcpServers.tics.args) && cfg.mcpServers.tics.args.length, "tics entry has args");
    assert.ok(cfg.mcpServers.other, "foreign server key preserved");
    assert.strictEqual(cfg.mcpServers.other.args[0], "other.js");
    assert.strictEqual(cfg.topKey, 1, "foreign top-level key preserved");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P1 (ADR 0026): TIC_STORE=git — two concurrent emitters against one bare remote lose nothing", { timeout: 60000 }, async () => {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-"));
  const hostA = inst("git"), hostB = inst("git"), check = fs.mkdtempSync(path.join(os.tmpdir(), "tics-check-"));
  const K = 8;
  // each "host" emits K tics in a tight loop; both loops run at the same time against the same remote
  const burst = (d, who) => new Promise((resolve) => {
    const lib = path.join(d, ".claude", "hooks", "tics-lib.sh");
    const script = 'export TICS_REMOTE="' + remote + '" TICS_SESSION="' + who + '"; . "' + lib + '"; ' +
      'for i in $(seq 1 ' + K + '); do emit_tic ' + who + ' "*" note "' + who + '-$i"; done';
    const ch = cp.spawn("bash", ["-c", script], { cwd: d, env: ENV, stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; ch.stderr.on("data", (b) => { err += b; });
    ch.on("close", (code) => { stderrs[who] = { code, err }; resolve(); });
  });
  const stderrs = {};
  // Diagnostics only (never changes what P1 asserts): classify each missing msg as on-remote,
  // local-committed-unpushed, worktree-only, or GONE, with each host's bus state.
  const diagnose = (got, want) => {
    const missing = want.filter((m) => !got.includes(m));
    const out = ["missing: " + JSON.stringify(missing), "extra/dup: " + JSON.stringify(got.filter((m, i) => !want.includes(m) || got.indexOf(m) !== i))];
    const remoteMsgs = new Set(got);
    for (const [h, d] of [["hostA", hostA], ["hostB", hostB]]) {
      const bus = path.join(d, ".claude", "state", "tics.git");
      const msgsOf = (txt) => txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).msg; } catch (e) { return "?unparsable"; } });
      const hasTrack = git(bus, "rev-parse", "-q", "--verify", "origin/tics-bus").status === 0;
      const range = hasTrack ? "origin/tics-bus..HEAD" : "HEAD";
      const unpushedLog = git(bus, "log", "--format=%s", range).stdout.trim().split("\n").filter(Boolean);
      const headFiles = git(bus, "ls-tree", "-r", "--name-only", "HEAD", "--", "tics.d").stdout.trim().split("\n").filter(Boolean);
      const committed = new Set(headFiles.flatMap((f) => msgsOf(git(bus, "show", "HEAD:" + f).stdout)));
      const unpushedMsgs = [...committed].filter((m) => !remoteMsgs.has(m));
      const dir = path.join(bus, "tics.d");
      const wt = new Set(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => msgsOf(fs.readFileSync(path.join(dir, f), "utf8"))) : []);
      const porcelain = git(bus, "--no-optional-locks", "status", "--porcelain").stdout.trim();
      const gd = path.join(bus, ".git");
      const netFailed = fs.existsSync(path.join(gd, "tics-net-failed")) ? "yes (" + fs.readFileSync(path.join(gd, "tics-net-failed"), "utf8").trim() + ")" : "no";
      const errs = fs.existsSync(gd) ? fs.readdirSync(gd).filter((f) => /^tics-net\..*\.err$/.test(f)).map((f) => f + ": " + fs.readFileSync(path.join(gd, f), "utf8").trim()) : [];
      const locks = fs.existsSync(gd) ? fs.readdirSync(gd).filter((f) => f.startsWith("tics-emit.lock")) : [];
      const rebasing = ["rebase-merge", "rebase-apply"].filter((f) => fs.existsSync(path.join(gd, f)));
      out.push("[" + h + "] exit=" + (stderrs[h] && stderrs[h].code) + " track=" + hasTrack +
        "\n  unpushed commits (" + range + "): " + unpushedLog.length + " " + JSON.stringify(unpushedLog) +
        "\n  unpushed tic msgs: " + JSON.stringify(unpushedMsgs) +
        "\n  status --porcelain: " + JSON.stringify(porcelain) +
        "\n  tics-net-failed: " + netFailed + "  lock: " + JSON.stringify(locks) + "  rebase: " + JSON.stringify(rebasing) +
        "\n  net .err: " + JSON.stringify(errs) +
        "\n  stderr: " + JSON.stringify(((stderrs[h] && stderrs[h].err) || "").slice(-2000)));
      for (const m of missing.filter((m) => m.startsWith(h + "-"))) {
        const cls = remoteMsgs.has(m) ? "on-remote" : committed.has(m) ? "local-committed-unpushed" : wt.has(m) ? "worktree-only" : "GONE";
        out.push("  CLASS " + m + ": " + cls);
      }
    }
    return out.join("\n");
  };
  try {
    git(remote, "init", "-q", "--bare");
    await Promise.all([burst(hostA, "hostA"), burst(hostB, "hostB")]);
    const cl = git(check, "clone", "-q", "--branch", "tics-bus", remote, "bus");
    assert.strictEqual(cl.status, 0, "the remote has a tics-bus branch: " + cl.stderr);
    const dir = path.join(check, "bus", "tics.d");
    const want = [];
    for (const h of ["hostA", "hostB"]) for (let i = 1; i <= K; i++) want.push(h + "-" + i);
    const msgs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => {
      const txt = fs.readFileSync(path.join(dir, f), "utf8");
      try { return JSON.parse(txt).msg; } catch (e) {
        // diagnostics only: a spool file that is not ONE tic still fails P1, now with its name, content and history
        const all = fs.readdirSync(dir).filter((g) => g.endsWith(".json")).sort();
        const hist = git(path.join(check, "bus"), "log", "--format=%h %s", "--", "tics.d/" + f).stdout.trim();
        const lines = txt.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l).msg; } catch (e2) { return "?"; } });
        e.message += "\nP1-DIAG unparsable remote file " + f + " (" + lines.length + " lines, msgs " + JSON.stringify(lines) + ")\n" + txt +
          "\n  history: " + JSON.stringify(hist) + "\n  remote files: " + JSON.stringify(all) + "\n" +
          diagnose(fs.readdirSync(dir).filter((g) => g.endsWith(".json") && g !== f).map((g) => JSON.parse(fs.readFileSync(path.join(dir, g), "utf8")).msg).concat(lines), want.slice().sort());
        throw e;
      }
    }).sort();
    want.sort();
    const same = JSON.stringify(msgs) === JSON.stringify(want);
    assert.deepStrictEqual(msgs, want, "every emitted tic reached the remote exactly once" + (same ? "" : "\nP1-DIAG\n" + diagnose(msgs, want)));
  } finally {
    for (const p of [remote, hostA, hostB, check]) fs.rmSync(p, { recursive: true, force: true });
  }
});

test("P5 (ADR 0026): TIC_STORE=git — emits leave the project's own git tree untouched (status and HEAD)", { timeout: 60000 }, () => {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-")), d = inst("git");
  try {
    git(remote, "init", "-q", "--bare");
    // the install is itself a git repo with a committed file; the default TICS_GIT_DIR sits inside its tree
    git(d, "init", "-q");
    fs.writeFileSync(path.join(d, "app.txt"), "x\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "base");
    const before = git(d, "status", "--porcelain").stdout, head = git(d, "rev-parse", "HEAD").stdout;
    const r = srcLib(d, 'export TICS_REMOTE="' + remote + '"; emit_tic a b note one; emit_tic a b note two');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(d, ".claude", "state", "tics.git", ".git")), "the bus checkout exists at the default TICS_GIT_DIR");
    assert.strictEqual(git(d, "status", "--porcelain").stdout, before, "the project's git status is unchanged by emits");
    assert.strictEqual(git(d, "rev-parse", "HEAD").stdout, head, "the project's HEAD did not move");
  } finally {
    for (const p of [remote, d]) fs.rmSync(p, { recursive: true, force: true });
  }
});

// P6 (ADR 0026) shared setup: two "hosts" whose tdd.config names one bare remote, so emit and read both see it
// with no env plumbing. busOf(d) is the default TICS_GIT_DIR checkout.
function p6Hosts(extraA) {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-")), gone = remote + "-gone";
  const hostA = inst("git"), hostB = inst("git");
  for (const d of [hostA, hostB]) fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="' + remote + '"\n');
  if (extraA) fs.appendFileSync(path.join(hostA, ".claude", "tdd.config"), extraA);
  git(remote, "init", "-q", "--bare");
  const cleanup = () => { for (const p of [remote, gone, hostA, hostB]) fs.rmSync(p, { recursive: true, force: true }); };
  return { remote, gone, hostA, hostB, cleanup };
}
const busOf = (d) => path.join(d, ".claude", "state", "tics.git");

test("P6a (ADR 0026): TIC_STORE=git — host A's tics log lists host B's tic and A's claim-check sees B's claim", { timeout: 60000 }, () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(srcLib(h.hostB, "emit_tic b '*' note from-B").status, 0);
    assert.strictEqual(srcLib(h.hostB, "export TICS_SCOPE='auth/S1'; emit_tic b '*' claim f.ts f.ts").status, 0);
    const log = read(h.hostA, "log");
    assert.strictEqual(log.status, 0, log.stderr);
    assert.match(log.stdout, /from-A/, "the local tic is listed: " + log.stdout);
    assert.strictEqual((log.stdout.match(/from-A/g) || []).length, 1, "A's own tic (in the working tree AND on origin/tics-bus) is listed exactly once: " + log.stdout);
    const here = read(h.hostA, "log", "--here");                  // the bus union alone, without the cross-worktree merge
    assert.strictEqual((here.stdout.match(/from-A/g) || []).length, 1, "the union read lists A's own tic exactly once: " + here.stdout);
    assert.match(log.stdout, /from-B/, "the other host's tic is fetched on read: " + log.stdout);
    const cc = read(h.hostA, "claim-check", "f.ts", "ord/S2");
    assert.strictEqual(cc.status, 3, "A (scope ord/S2) is blocked by B's claim on f.ts in auth/S1: " + cc.stdout + cc.stderr);
    assert.match(cc.stdout, /auth\/S1/, "the conflict names B's scope");
  } finally { h.cleanup(); }
});

test("P6b (ADR 0026): TIC_STORE=git — with the remote unreachable, A's local tics (unpushed included) are listed and the read exits 0", { timeout: 60000 }, () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(srcLib(h.hostB, "emit_tic b '*' note from-B").status, 0);
    read(h.hostA, "log");                                          // online read: fetches B's tic
    fs.renameSync(h.remote, h.gone);                               // the remote goes away
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note offline-A").status, 0);
    const offline = read(h.hostA, "log");
    assert.strictEqual(offline.status, 0, "an offline read still exits 0: " + offline.stderr);
    assert.match(offline.stdout, /offline-A/, "a local unpushed tic is never dropped: " + offline.stdout);
    assert.match(offline.stdout, /from-A/, "earlier local tics are still listed offline");
    assert.match(offline.stdout, /from-B/, "already-fetched tics are still listed offline");
  } finally { h.cleanup(); }
});

test("P6c (ADR 0026): TIC_STORE=git — a read that fetches a new remote tic leaves the bus checkout's HEAD, index and working tree unchanged", { timeout: 60000 }, () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(srcLib(h.hostB, "emit_tic b '*' note new-B").status, 0);   // on the remote, not integrated by A
    const bus = busOf(h.hostA), idx = path.join(bus, ".git", "index");
    // read-only snapshot: --no-optional-locks so `status` never refreshes/rewrites the index itself (racy git)
    const roGit = (...a) => cp.spawnSync("git", ["--no-optional-locks", "-C", bus, ...a], { encoding: "utf8", env: { ...ENV, GIT_OPTIONAL_LOCKS: "0" } });
    const snap = () => ({
      head: roGit("rev-parse", "HEAD").stdout,
      status: roGit("status", "--porcelain").stdout,
      idxMtime: fs.statSync(idx).mtimeMs,
      idxHash: require("crypto").createHash("sha1").update(fs.readFileSync(idx)).digest("hex"),
    });
    const before = snap();
    const log = read(h.hostA, "log");
    assert.strictEqual(log.status, 0, log.stderr);
    assert.match(log.stdout, /new-B/, "the read fetched B's new tic (so a rebasing reader would move HEAD): " + log.stdout);
    assert.deepStrictEqual(snap(), before, "HEAD, index and working tree of the bus checkout are untouched by the read");
  } finally { h.cleanup(); }
});

test("P6d (ADR 0026): TIC_STORE=git — a second read within TICS_FETCH_TTL does not fetch; tics log --fetch forces one", { timeout: 60000 }, () => {
  const h = p6Hosts('TICS_FETCH_TTL="3600"\n');
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(srcLib(h.hostB, "emit_tic b '*' note from-B").status, 0);
    const first = read(h.hostA, "log");
    assert.match(first.stdout, /from-B/, "the first read fetches: " + first.stdout);
    assert.strictEqual(srcLib(h.hostB, "emit_tic b '*' note late-B").status, 0);
    const second = read(h.hostA, "log");
    assert.strictEqual(second.status, 0, second.stderr);
    assert.match(second.stdout, /from-B/, "the second read still lists what was fetched");
    assert.doesNotMatch(second.stdout, /late-B/, "a read inside the TTL does not fetch: " + second.stdout);
    const forced = read(h.hostA, "log", "--fetch");
    assert.strictEqual(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /late-B/, "tics log --fetch forces a fetch: " + forced.stdout);
  } finally { h.cleanup(); }
});

test("P6e (ADR 0026): TIC_STORE=git — tics log prints when the bus was last fetched", { timeout: 60000 }, () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    const log = read(h.hostA, "log");
    assert.strictEqual(log.status, 0, log.stderr);
    assert.match(log.stdout, /bus as of/i, "a freshness line is shown: " + log.stdout);
    const board = read(h.hostA, "board");
    assert.strictEqual(board.status, 0, board.stderr);
    assert.match(board.stdout, /bus as of/i, "tics board shows the freshness line too: " + board.stdout);
  } finally { h.cleanup(); }
});

test("P6f (ADR 0026): TIC_STORE=git — with a remote that hangs, consecutive reads (log, claim-check) each finish in under a second", { timeout: 60000 }, async () => {
  const h = p6Hosts();
  // a TCP server that accepts and never answers, in its own process so the readers' spawnSync can't stall it
  const srv = cp.spawn(process.execPath, ["-e", "const s=require('net').createServer(()=>{});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"], { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const port = await new Promise((res, rej) => { let b = ""; srv.stdout.on("data", (c) => { b += c; if (b.includes("\n")) res(b.split("\n")[0].trim()); }); srv.on("exit", () => rej(new Error("hang server exited"))); });
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(git(busOf(h.hostA), "remote", "set-url", "origin", "http://127.0.0.1:" + port + "/bus.git").status, 0);
    read(h.hostA, "log");                                          // warm-up: may pay the fetch cap once
    const timed = (...a) => { const t0 = Date.now(); const r = read(h.hostA, ...a); return { r, ms: Date.now() - t0 }; };
    const runs = [timed("log"), timed("claim-check", "f.ts", "some/S"), timed("log")];
    for (const { r } of runs) assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(runs.map(({ ms }) => ms < 1000), [true, true, true], "each read after the warm-up is fast, not paying a fetch against the hanging remote (ms): " + runs.map(({ ms }) => ms).join(", "));
  } finally { srv.kill("SIGKILL"); h.cleanup(); }
});

// P6g: the reader's fetch must be bounded even when git's transport helper (here the ssh command) hangs, and must
// not leave that helper running: killing only the direct `git fetch` child is not enough.
test("P6g (ADR 0026): TIC_STORE=git — a read whose fetch hits a hanging ssh helper exits 0 within 8 s, lists local tics and leaves no helper alive", { timeout: 60000 }, async () => {
  const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p6g-"));
  const bare = path.join(tmp, "bare.git"), pids = path.join(tmp, "ssh-pids"), ssh = path.join(tmp, "hang-ssh"), out = path.join(tmp, "log.out");
  const bus = busOf(d);
  fs.writeFileSync(ssh, '#!/bin/sh\necho $$ >> "' + pids + '"\nexec sleep 600\n', { mode: 0o755 });
  git(tmp, "init", "-q", "--bare", bare);
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="' + bare + '"\n');
  const pidList = () => (fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").filter(Boolean).map(Number) : []);
  const alive = (p) => { try { process.kill(p, 0); return true; } catch (_) { return false; } };
  try {
    assert.strictEqual(srcLib(d, "emit_tic a '*' note before-hang").status, 0);
    assert.ok(git(bare, "rev-parse", "--verify", "-q", "refs/heads/tics-bus").stdout.trim(), "the bus is published to the reachable remote");
    assert.strictEqual(git(bus, "remote", "set-url", "origin", "ssh://hang/x.git").status, 0);
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_FETCH_TTL="0"\n');
    fs.rmSync(path.join(bus, ".git", "tics-fetch-attempt"), { force: true });
    const fd = fs.openSync(out, "w");
    const r = await timedRunKeepGroup(path.join(d, ".claude", "hooks", "tics"), ["log"], { cwd: d, env: { ...ENV, GIT_SSH_COMMAND: ssh }, stdio: ["ignore", fd, "ignore"] }, 30000);
    fs.closeSync(fd);
    const listed = fs.readFileSync(out, "utf8");
    assert.deepStrictEqual(
      { status: r.status, fast: r.ms < 8000, listed: /before-hang/.test(listed), sshSpawned: pidList().length > 0, helpersAlive: pidList().filter(alive) },
      { status: 0, fast: true, listed: true, sshSpawned: true, helpersAlive: [] },
      "tics log against a hanging ssh helper (ms " + r.ms + ", ssh pids " + pidList().join(",") + "); output: " + JSON.stringify(listed));
  } finally {
    for (const p of pidList()) { try { process.kill(-p, "SIGKILL"); } catch (_) {} try { process.kill(p, "SIGKILL"); } catch (_) {} }
    for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
  }
});

// P6h–P6k (ADR 0026): read-side contract rules — the success stamp, the freshness line, the offline exit code and
// the once-per-process fetch. A "failed fetch" is a real attempt against a remote renamed away (TICS_FETCH_TTL="0"
// or --fetch); the attempt stamp changing is the evidence that the read did try the network.
const stampOf = (d, f) => { const p = path.join(busOf(d), ".git", f); return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null; };

test("P6h (ADR 0026): TIC_STORE=git — a failed fetch leaves the success stamp untouched (a prior stamp keeps its content, an absent one stays absent)", { timeout: 60000 }, () => {
  const h = p6Hosts('TICS_FETCH_TTL="0"\n');
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    assert.strictEqual(read(h.hostA, "log").status, 0);                     // online read: a successful fetch
    const okStamp = stampOf(h.hostA, "tics-fetch-stamp");
    fs.renameSync(h.remote, h.gone);                                          // the remote goes away
    const att0 = stampOf(h.hostA, "tics-fetch-attempt");
    const r1 = read(h.hostA, "log");                                          // failed fetch over a prior success
    const kept = stampOf(h.hostA, "tics-fetch-stamp"), att1 = stampOf(h.hostA, "tics-fetch-attempt");
    fs.rmSync(path.join(busOf(h.hostA), ".git", "tics-fetch-stamp"));       // as if never fetched successfully
    const r2 = read(h.hostA, "log");                                          // failed fetch with no prior success
    assert.deepStrictEqual(
      { hadStamp: !!okStamp, r1: r1.status, attempted1: att1 !== att0, kept, r2: r2.status, attempted2: stampOf(h.hostA, "tics-fetch-attempt") !== att1, absent: stampOf(h.hostA, "tics-fetch-stamp") },
      { hadStamp: true, r1: 0, attempted1: true, kept: okStamp, r2: 0, attempted2: true, absent: null },
      "the success stamp records successful fetches only");
  } finally { h.cleanup(); }
});

test("P6i (ADR 0026): TIC_STORE=git — tics log's 'bus as of' line carries an ISO-8601 time after a successful fetch and is unchanged by a later failed fetch", { timeout: 60000 }, () => {
  const h = p6Hosts('TICS_FETCH_TTL="0"\n');
  const freshLine = (r) => (r.stdout.match(/^.*bus as of.*$/m) || [null])[0];
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    const online = read(h.hostA, "log");
    fs.renameSync(h.remote, h.gone);
    const att0 = stampOf(h.hostA, "tics-fetch-attempt");
    const offline = read(h.hostA, "log");
    assert.match(String(freshLine(online)), /bus as of \d{4}-\d\d-\d\dT\d\d:\d\d/, "after a successful fetch the line names when: " + online.stdout);
    assert.deepStrictEqual(
      { status: offline.status, attempted: stampOf(h.hostA, "tics-fetch-attempt") !== att0, line: freshLine(offline) },
      { status: 0, attempted: true, line: freshLine(online) },
      "a failed fetch does not move the freshness line: " + offline.stdout);
  } finally { h.cleanup(); }
});

test("P6j (ADR 0026): TIC_STORE=git — a read whose forced fetch really fails (remote gone) exits 0 and lists the local tics", { timeout: 60000 }, () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note from-A").status, 0);
    fs.renameSync(h.remote, h.gone);
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note offline-A").status, 0);
    const att0 = stampOf(h.hostA, "tics-fetch-attempt");
    const r = read(h.hostA, "log", "--fetch");
    assert.deepStrictEqual(
      { status: r.status, attempted: stampOf(h.hostA, "tics-fetch-attempt") !== att0, fromA: /from-A/.test(r.stdout), offlineA: /offline-A/.test(r.stdout) },
      { status: 0, attempted: true, fromA: true, offlineA: true },
      "tics log --fetch against a vanished remote: " + r.stdout + r.stderr);
  } finally { h.cleanup(); }
});

// P6k: the default `tics log` loads the bus more than once (current bus + each worktree's), yet fetches it once.
test("P6k (ADR 0026): TIC_STORE=git — with TICS_FETCH_TTL=0 one tics log against a hanging ssh helper spawns it once and takes one watchdog period, not two", { timeout: 60000 }, async () => {
  const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p6k-"));
  const bare = path.join(tmp, "bare.git"), marker = path.join(tmp, "ssh-spawns"), pids = path.join(tmp, "ssh-pids"), ssh = path.join(tmp, "hang-ssh");
  const bus = busOf(d);
  fs.writeFileSync(ssh, '#!/bin/sh\necho "$*" >> "' + marker + '"\necho $$ >> "' + pids + '"\nexec sleep 600\n', { mode: 0o755 });
  git(tmp, "init", "-q", "--bare", bare);
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="' + bare + '"\n');
  const spawns = () => (fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean).length : 0);
  try {
    assert.strictEqual(srcLib(d, "emit_tic a '*' note before-hang").status, 0);
    assert.strictEqual(git(bus, "remote", "set-url", "origin", "ssh://hang/x.git").status, 0);
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_FETCH_TTL="0"\nTICS_NET_TIMEOUT="3"\n');
    fs.rmSync(path.join(bus, ".git", "tics-fetch-attempt"), { force: true });
    const r = await timedRun(path.join(d, ".claude", "hooks", "tics"), ["log"], { cwd: d, env: { ...ENV, GIT_SSH_COMMAND: ssh } }, 30000);
    assert.deepStrictEqual(
      { status: r.status, sshSpawns: spawns(), onePeriod: r.ms < 5500 },
      { status: 0, sshSpawns: 1, onePeriod: true },
      "one tics log with a 3 s watchdog (ms " + r.ms + ")");
  } finally {
    const left = fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").filter(Boolean) : [];
    for (const p of left) { try { process.kill(-Number(p), "SIGKILL"); } catch (_) {} try { process.kill(Number(p), "SIGKILL"); } catch (_) {} }
    for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
  }
});

// Times an emit in its own process group, hard-capped so a hanging emit fails the test instead of the runner;
// the whole group (bash + git children) is killed on the cap. timedRun is the same for any command.
function timedRun(cmd, args, opts, capMs) {
  return new Promise((res) => {
    const t0 = Date.now();
    const c = cp.spawn(cmd, args, Object.assign({ detached: true, stdio: "ignore" }, opts));
    const cap = setTimeout(() => { try { process.kill(-c.pid, "SIGKILL"); } catch (_) {} }, capMs);
    c.on("exit", (status) => { clearTimeout(cap); try { process.kill(-c.pid, "SIGKILL"); } catch (_) {} res({ status, ms: Date.now() - t0 }); });
  });
}
// Like timedRun, but on a normal exit it does NOT kill the process group, so a test can observe what the command
// itself left running (stray children); only the hard cap kills the group. The caller reaps the rest.
function timedRunKeepGroup(cmd, args, opts, capMs) {
  return new Promise((res) => {
    const t0 = Date.now();
    const c = cp.spawn(cmd, args, Object.assign({ detached: true, stdio: "ignore" }, opts));
    const cap = setTimeout(() => { try { process.kill(-c.pid, "SIGKILL"); } catch (_) {} }, capMs);
    c.on("exit", (status) => { clearTimeout(cap); res({ status, ms: Date.now() - t0 }); });
  });
}
function timedEmit(d, s, capMs, env) {
  return timedRun("bash", ["-c", '. "' + path.join(d, ".claude", "hooks", "tics-lib.sh") + '"; ' + s], { cwd: d, env: env || ENV }, capMs);
}

// P3 (ADR 0026): the write side never hangs or loses a tic. No real network: the remote is ssh://hang/x.git and
// GIT_SSH_COMMAND is a script that logs each spawn to a marker file (and its pid, for cleanup), then sleeps 600 s.
test("P3 (ADR 0026): TIC_STORE=git — the write side never hangs or loses a tic", { timeout: 120000 }, async (t) => {
  const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p3-"));
  const marker = path.join(tmp, "ssh-spawns"), pids = path.join(tmp, "ssh-pids"), ssh = path.join(tmp, "hang-ssh");
  const bare = path.join(tmp, "bare.git"), bus = busOf(d);
  fs.writeFileSync(ssh, '#!/bin/sh\necho "$*" >> "' + marker + '"\necho $$ >> "' + pids + '"\nexec sleep 600\n', { mode: 0o755 });
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="ssh://hang/x.git"\n');
  const HANG = { ...ENV, GIT_SSH_COMMAND: ssh };
  const spawns = () => (fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean).length : 0);
  const ticFile = (msg) => { const dir = path.join(bus, "tics.d"); return (fs.existsSync(dir) ? fs.readdirSync(dir) : []).find((f) => fs.readFileSync(path.join(dir, f), "utf8").includes(msg)); };
  const syncA = () => timedRun("node", [BIN, "sync", d], { env: ENV }, 30000);
  try {
    await t.test("P3a (ADR 0026): a fresh install with a hanging remote — the first emit exits 0 within 10 s with the tic committed locally", { timeout: 60000 }, async () => {
      const first = await timedEmit(d, "emit_tic a '*' note hung-1", 30000, HANG);
      const f = ticFile("hung-1");
      const logged = git(bus, "log", "--name-only", "--format=").stdout;
      const tracked = f ? git(bus, "ls-files", "--error-unmatch", "tics.d/" + f).status : null;
      assert.deepStrictEqual(
        { status: first.status, fast: first.ms < 10000, file: !!f, inLog: !!f && logged.includes("tics.d/" + f), tracked },
        { status: 0, fast: true, file: true, inLog: true, tracked: 0 },
        "first emit against ssh://hang (ms " + first.ms + ", ssh spawns " + spawns() + "); bus log: " + JSON.stringify(logged));
    });
    await t.test("P3b (ADR 0026): inside the TTL after a failed attempt, an emit and a read skip the network (fast, no ssh spawn)", { timeout: 60000 }, async () => {
      const before = spawns();
      const second = await timedEmit(d, "emit_tic a '*' note hung-2", 30000, HANG);
      const afterEmit = spawns();
      const r = await timedRun(path.join(d, ".claude", "hooks", "tics"), ["log"], { cwd: d, env: HANG }, 30000);
      assert.deepStrictEqual(
        { status: second.status, fast: second.ms < 1000, emitSpawns: afterEmit - before, readStatus: r.status, readSpawns: spawns() - afterEmit },
        { status: 0, fast: true, emitSpawns: 0, readStatus: 0, readSpawns: 0 },
        "second emit (ms " + second.ms + ") and read (ms " + r.ms + ") inside the TTL; ssh spawns before/after emit/after read: " + before + "/" + afterEmit + "/" + spawns());
    });
    await t.test("P3c (ADR 0026): tics sync publishes every unpushed tic; a second sync publishes nothing new and exits 0", { timeout: 60000 }, async () => {
      git(tmp, "init", "-q", "--bare", bare);
      assert.strictEqual(git(bus, "remote", "set-url", "origin", bare).status, 0, "the bus checkout has an origin to repoint");
      const s1 = await syncA();
      const files = git(bare, "ls-tree", "-r", "--name-only", "tics-bus").stdout.trim().split("\n").filter(Boolean);
      const msgs = files.map((p) => { try { return JSON.parse(git(bare, "show", "tics-bus:" + p).stdout).msg; } catch (_) { return null; } }).filter(Boolean).sort();
      const head1 = git(bare, "rev-parse", "--verify", "-q", "refs/heads/tics-bus").stdout.trim();
      const s2 = await syncA();
      const head2 = git(bare, "rev-parse", "--verify", "-q", "refs/heads/tics-bus").stdout.trim();
      assert.deepStrictEqual(
        { s1: s1.status, msgs, s2: s2.status, unchanged: !!head1 && head1 === head2 },
        { s1: 0, msgs: ["hung-1", "hung-2"], s2: 0, unchanged: true },
        "tics sync to a reachable bare remote (ms " + s1.ms + ", then " + s2.ms + "); tics-bus " + (head1 || "(missing)") + " -> " + (head2 || "(missing)"));
    });
  } finally {
    const left = fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").filter(Boolean) : [];
    for (const p of left) { try { process.kill(-Number(p), "SIGKILL"); } catch (_) {} try { process.kill(Number(p), "SIGKILL"); } catch (_) {} }
    for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
  }
});

// P3d–P3g, P1b (ADR 0026 rules 3 and 4, critic re-audit): the shared failed-attempt record, its clearing by a
// successful publish, sync staging uncommitted tics, and per-emit error capture on one shared checkout. hangSsh is
// the P3 hanging-ssh marker script: each spawn is logged to a marker file (pid kept for cleanup), then sleeps 600 s.
function hangSsh(tmp) {
  const marker = path.join(tmp, "ssh-spawns"), pids = path.join(tmp, "ssh-pids"), ssh = path.join(tmp, "hang-ssh");
  fs.writeFileSync(ssh, '#!/bin/sh\necho "$*" >> "' + marker + '"\necho $$ >> "' + pids + '"\nexec sleep 600\n', { mode: 0o755 });
  const spawns = () => (fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").filter(Boolean).length : 0);
  const reap = () => {
    const left = fs.existsSync(pids) ? fs.readFileSync(pids, "utf8").trim().split("\n").filter(Boolean) : [];
    for (const p of left) { try { process.kill(-Number(p), "SIGKILL"); } catch (_) {} try { process.kill(Number(p), "SIGKILL"); } catch (_) {} }
  };
  return { ssh, spawns, reap };
}
const remoteMsgs = (bare) => git(bare, "ls-tree", "-r", "--name-only", "tics-bus").stdout.trim().split("\n").filter(Boolean)
  .map((p) => { try { return JSON.parse(git(bare, "show", "tics-bus:" + p).stdout).msg; } catch (_) { return null; } }).filter(Boolean).sort();

test("P3d (ADR 0026): TIC_STORE=git — a successful tics sync clears the failure record, so the next emit inside the TTL publishes at once", { timeout: 60000 }, async () => {
  const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p3d-")), hs = hangSsh(tmp);
  const bare = path.join(tmp, "bare.git"), bus = busOf(d), HANG = { ...ENV, GIT_SSH_COMMAND: hs.ssh };
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="ssh://hang/x.git"\nTICS_NET_TIMEOUT="3"\n');
  try {
    assert.strictEqual((await timedEmit(d, "emit_tic a '*' note hung-1", 30000, HANG)).status, 0);   // fails: records the failure
    assert.strictEqual((await timedEmit(d, "emit_tic a '*' note hung-2", 30000, HANG)).status, 0);   // inside the TTL: skipped
    git(tmp, "init", "-q", "--bare", bare);
    assert.strictEqual(git(bus, "remote", "set-url", "origin", bare).status, 0);
    const s = await timedRun("node", [BIN, "sync", d], { env: ENV }, 30000);
    const after = await timedEmit(d, "emit_tic a '*' note after-sync", 30000, ENV);
    assert.deepStrictEqual(
      { sync: s.status, emit: after.status, remote: remoteMsgs(bare) },
      { sync: 0, emit: 0, remote: ["after-sync", "hung-1", "hung-2"] },
      "an emit right after a successful sync (still inside the default TTL of the failed attempt) publishes immediately (emit ms " + after.ms + ")");
  } finally {
    hs.reap();
    for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
  }
});

test("P3e (ADR 0026): TIC_STORE=git — a successful push refreshes 'bus as of' to no older than the emit", { timeout: 60000 }, async () => {
  const h = p6Hosts();
  const asOf = (r) => { const m = r.stdout.match(/bus as of (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)/); return m ? Date.parse(m[1]) : null; };
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note first-A").status, 0);
    assert.strictEqual(read(h.hostA, "log").status, 0);                 // an earlier successful fetch: an older stamp
    await new Promise((r) => setTimeout(r, 1500));                        // the stamps have one-second resolution
    const emittedAt = Math.floor(Date.now() / 1000) * 1000;
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note pushed-A").status, 0);
    const published = git(h.remote, "show", "tics-bus:tics.d").stdout;
    fs.renameSync(h.remote, h.gone);                                      // the log below cannot refresh the stamp itself
    const log = read(h.hostA, "log");
    const t = asOf(log);
    assert.deepStrictEqual(
      { published: published.split("\n").filter((l) => l.endsWith(".json")).length, status: log.status, hasTime: t !== null, notOlderThanEmit: t !== null && t >= emittedAt },
      { published: 2, status: 0, hasTime: true, notOlderThanEmit: true },
      "after a published emit at " + new Date(emittedAt).toISOString() + ", tics log shows: " + (log.stdout.match(/^.*bus as of.*$/m) || ["(no line)"])[0]);
  } finally { h.cleanup(); }
});

test("P3f (ADR 0026): TIC_STORE=git — tics sync stages and publishes a tic file left uncommitted in the bus checkout", { timeout: 60000 }, async () => {
  const h = p6Hosts();
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note committed-A").status, 0);
    // an emit killed between writing its file and committing it
    fs.writeFileSync(path.join(busOf(h.hostA), "tics.d", "20260101T000000Z-hostA-1-1.json"),
      '{"ts":"2026-01-01T00:00:00Z","seq":2,"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"hostA","msg":"uncommitted-A","ref":"","result":""}\n');
    const s = await timedRun("node", [BIN, "sync", h.hostA], { env: ENV }, 30000);
    assert.deepStrictEqual(
      { sync: s.status, remote: remoteMsgs(h.remote) },
      { sync: 0, remote: ["committed-A", "uncommitted-A"] },
      "tics sync to a reachable remote publishes the uncommitted tic file");
  } finally { h.cleanup(); }
});

test("P3g (ADR 0026): TIC_STORE=git — after a READ whose fetch fails, an emit inside the TTL skips the network (fast, no ssh spawn)", { timeout: 60000 }, async () => {
  const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p3g-")), hs = hangSsh(tmp);
  const bare = path.join(tmp, "bare.git"), bus = busOf(d), HANG = { ...ENV, GIT_SSH_COMMAND: hs.ssh };
  git(tmp, "init", "-q", "--bare", bare);
  fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="' + bare + '"\nTICS_NET_TIMEOUT="3"\n');
  try {
    assert.strictEqual(srcLib(d, "emit_tic a '*' note before-hang").status, 0);     // published; no failure on record
    assert.strictEqual(git(bus, "remote", "set-url", "origin", "ssh://hang/x.git").status, 0);
    const r = await timedRun(path.join(d, ".claude", "hooks", "tics"), ["log", "--fetch"], { cwd: d, env: HANG }, 30000);
    const afterRead = hs.spawns();
    const e = await timedEmit(d, "emit_tic a '*' note after-failed-read", 30000, HANG);
    assert.deepStrictEqual(
      { read: r.status, readTriedNetwork: afterRead > 0, emit: e.status, fast: e.ms < 1000, emitSpawns: hs.spawns() - afterRead },
      { read: 0, readTriedNetwork: true, emit: 0, fast: true, emitSpawns: 0 },
      "a failed read is on the shared failure record, so the emit skips the network (read ms " + r.ms + ", emit ms " + e.ms + ")");
  } finally {
    hs.reap();
    for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
  }
});

// P7 (ADR 0026, "Hook telemetry stays local", architect contract adr-0026-hook-local): under TIC_STORE=git a tic
// from a hook identity (subagent, run-suite, guard, witness) goes to the local jsonl — no bus commit, no network, no
// lock — while agent tics still publish, and the reader's union still counts the hook-signed green.
test("P7 (ADR 0026): TIC_STORE=git — hook telemetry stays local; agent tics still publish", { timeout: 180000 }, async (t) => {
  await t.test("P7d (ADR 0026): the hook-local downgrade is git-only — under TIC_STORE=spool a hook emit still writes one spool file and no jsonl", { timeout: 60000 }, async () => {
    const d = inst("spool"), sp = path.join(d, ".claude", "state", "tics.d"), jsonl = path.join(d, ".claude", "state", "tics.jsonl");
    try {
      const r = srcLib(d, "emit_tic run-suite '*' signal 'p7d green' '' green");
      const files = fs.existsSync(sp) ? fs.readdirSync(sp).filter((f) => f.endsWith(".json")) : [];
      assert.deepStrictEqual({ status: r.status, spoolFiles: files.length, jsonl: fs.existsSync(jsonl) }, { status: 0, spoolFiles: 1, jsonl: false });
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  await t.test("P7a (ADR 0026): a hook-identity emit against a hanging remote returns well under the network watchdog, spawns no ssh, adds no bus commit, and lands in tics.jsonl", { timeout: 60000 }, async () => {
    const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p7a-")), hs = hangSsh(tmp);
    const bus = busOf(d), HANG = { ...ENV, GIT_SSH_COMMAND: hs.ssh };
    const jsonl = path.join(d, ".claude", "state", "tics.jsonl");
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="ssh://hang/x.git"\nTICS_NET_TIMEOUT="10"\n');
    // bound derived from the watchdog: any network or lock wait costs >= 10 s, a local write tens of ms
    const commits = () => (fs.existsSync(bus) ? Number(git(bus, "rev-list", "--count", "HEAD").stdout.trim() || 0) : 0);
    try {
      const before = commits();
      const runSuite = await timedEmit(d, "emit_tic run-suite '*' signal 'suite green' '' green", 30000, HANG);
      const guard = await timedEmit(d, "emit_tic guard '*' note p7-guard", 30000, HANG);
      const subagent = await timedEmit(d, "emit_tic subagent '*' note p7-subagent", 30000, HANG);
      const witness = await timedEmit(d, "emit_tic witness '*' note p7-witness", 30000, HANG);
      const local = fs.existsSync(jsonl) ? ticsOf(d).map((x) => x.from + ":" + x.msg).sort() : [];
      assert.deepStrictEqual(
        { status: [runSuite.status, guard.status, subagent.status, witness.status],
          fast: [runSuite.ms < 5000, guard.ms < 5000, subagent.ms < 5000, witness.ms < 5000],
          sshSpawns: hs.spawns(), newBusCommits: commits() - before, busOpened: fs.existsSync(bus), local },
        { status: [0, 0, 0, 0], fast: [true, true, true, true], sshSpawns: 0, newBusCommits: 0, busOpened: false,
          local: ["guard:p7-guard", "run-suite:suite green", "subagent:p7-subagent", "witness:p7-witness"] },
        "hook emits against ssh://hang (ms run-suite/guard/subagent/witness: " + [runSuite.ms, guard.ms, subagent.ms, witness.ms].join("/") + ")");
    } finally {
      hs.reap();
      for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
    }
  });
  await t.test("P7b (ADR 0026): an agent emit right after a hook-identity emit still publishes; the hook tic does not", { timeout: 60000 }, () => {
    const h = p6Hosts();
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic guard '*' note p7-hook").status, 0);
      assert.strictEqual(srcLib(h.hostA, "emit_tic test-writer '*' note p7-agent").status, 0);
      const remote = remoteMsgs(h.remote);
      assert.deepStrictEqual(
        { agentPublished: remote.includes("p7-agent"), hookPublished: remote.includes("p7-hook") },
        { agentPublished: true, hookPublished: false },
        "the remote's tics-bus holds: " + JSON.stringify(remote));
    } finally { h.cleanup(); }
  });
  await t.test("P7c (ADR 0026): on a git-store install, tics log lists a hook-signed green and tics gate counts it", { timeout: 60000 }, () => {
    const h = p6Hosts();
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic implementer '*' signal p7-self-green '' green").status, 0);
      assert.strictEqual(srcLib(h.hostA, "emit_tic run-suite '*' signal p7-hook-green '' green").status, 0);
      const log = read(h.hostA, "log");
      const gate = read(h.hostA, "gate"), out = gate.stdout + gate.stderr;
      assert.deepStrictEqual(
        { logged: /p7-hook-green/.test(log.stdout), noHookSignedWarning: /no hook-signed green/.test(out) },
        { logged: true, noHookSignedWarning: false },
        "tics log: " + log.stdout + "\ntics gate: " + out);
    } finally { h.cleanup(); }
  });
});

// P8 (ADR 0026, "A moved bus fails loud; tics rebind moves it", architect contract ref trial): the checkout's origin
// is set once, so a later TICS_REMOTE change must not keep publishing to the old remote. On a mismatch an emit commits
// locally but does not push; log/board print the mismatch line; `tics rebind` moves the bus carrying only unpushed tics.
// p8Moved: host A publishes p8-old to OLD, then tdd.config's TICS_REMOTE is rewritten to NEW and A emits p8-after-move.
function p8Moved() {
  const h = p6Hosts(), NEW = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-new-"));
  git(NEW, "init", "-q", "--bare");
  const cfg = path.join(h.hostA, ".claude", "tdd.config");
  const oldEmit = srcLib(h.hostA, "emit_tic test-writer '*' note p8-old");
  fs.writeFileSync(cfg, fs.readFileSync(cfg, "utf8").replace('TICS_REMOTE="' + h.remote + '"', 'TICS_REMOTE="' + NEW + '"'));
  const moved = srcLib(h.hostA, "emit_tic test-writer '*' note p8-after-move");
  const cleanup = () => { h.cleanup(); fs.rmSync(NEW, { recursive: true, force: true }); };
  return { A: h.hostA, B: h.hostB, OLD: h.remote, NEW, cfg, oldEmit, moved, cleanup };
}
const busHeadMsgs = (bus) => git(bus, "ls-tree", "-r", "--name-only", "HEAD", "--", "tics.d").stdout.trim().split("\n").filter(Boolean)
  .map((p) => { try { return JSON.parse(git(bus, "show", "HEAD:" + p).stdout).msg; } catch (_) { return null; } }).filter(Boolean).sort();
// rewrite the TICS_REMOTE line of a tdd.config from one URL to another (a config change, as an operator would make it)
const setCfgRemote = (cfg, from, to) => fs.writeFileSync(cfg, fs.readFileSync(cfg, "utf8").replace('TICS_REMOTE="' + from + '"', 'TICS_REMOTE="' + to + '"'));

test("P8 (ADR 0026): TIC_STORE=git — a moved TICS_REMOTE fails loud and tics rebind moves the bus", { timeout: 600000 }, async (t) => {
  await t.test("P8a (ADR 0026): after TICS_REMOTE changes, an emit exits 0, commits locally, and nothing reaches the old remote", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      const oldRemote = remoteMsgs(s.OLD), newRemote = remoteMsgs(s.NEW);
      assert.deepStrictEqual(
        { oldEmitStatus: s.oldEmit.status, movedEmitStatus: s.moved.status,
          committedLocally: busHeadMsgs(busOf(s.A)).includes("p8-after-move"),
          oldHasOld: oldRemote.includes("p8-old"), oldHasMoved: oldRemote.includes("p8-after-move"),
          newHasMoved: newRemote.includes("p8-after-move") },
        { oldEmitStatus: 0, movedEmitStatus: 0, committedLocally: true, oldHasOld: true, oldHasMoved: false, newHasMoved: false },
        "OLD tics-bus: " + JSON.stringify(oldRemote) + "\nNEW tics-bus: " + JSON.stringify(newRemote) + "\nemit stderr: " + s.moved.stderr);
    } finally { s.cleanup(); }
  });

  await t.test("P8b (ADR 0026): on a remote mismatch, tics log and tics board print the mismatch line naming both URLs and tics rebind", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      const log = read(s.A, "log"), board = read(s.A, "board");
      const logOut = log.stdout + log.stderr, boardOut = board.stdout + board.stderr;
      const shows = (out) => ({ mismatch: out.includes("bus remote mismatch"), oldUrl: out.includes(s.OLD), newUrl: out.includes(s.NEW), rebind: out.includes("tics rebind") });
      assert.deepStrictEqual(
        { log: shows(logOut), board: shows(boardOut) },
        { log: { mismatch: true, oldUrl: true, newUrl: true, rebind: true }, board: { mismatch: true, oldUrl: true, newUrl: true, rebind: true } },
        "tics log:\n" + logOut + "\ntics board:\n" + boardOut);
    } finally { s.cleanup(); }
  });

  await t.test("P8c (ADR 0026): tics rebind publishes exactly the unpushed tics to the new remote, not the old history, and later emits publish there", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      const rb = cp.spawnSync("node", [BIN, "rebind", s.A], { encoding: "utf8", env: ENV });
      const afterRebind = remoteMsgs(s.NEW);
      const next = srcLib(s.A, "emit_tic test-writer '*' note p8-new");
      const afterNext = remoteMsgs(s.NEW);
      const log = read(s.A, "log"), logOut = log.stdout + log.stderr;
      assert.deepStrictEqual(
        { rebindStatus: rb.status, newHasMoved: afterRebind.includes("p8-after-move"), newHasOld: afterRebind.includes("p8-old"),
          nextStatus: next.status, newHasNext: afterNext.includes("p8-new"), mismatchAfter: logOut.includes("bus remote mismatch") },
        { rebindStatus: 0, newHasMoved: true, newHasOld: false, nextStatus: 0, newHasNext: true, mismatchAfter: false },
        "rebind: " + rb.stdout + rb.stderr + "\nNEW tics-bus after rebind: " + JSON.stringify(afterRebind) +
        "\nNEW tics-bus after p8-new: " + JSON.stringify(afterNext) + "\ntics log:\n" + logOut);
    } finally { s.cleanup(); }
  });

  await t.test("P8d (ADR 0026): a per-process env TICS_REMOTE that differs from the record is a mismatch (kept locally, no push), and a hand git remote set-url is not", { timeout: 60000 }, () => {
    const h = p6Hosts(), NEW = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-new-")), OLD2 = h.remote + "-2";
    git(NEW, "init", "-q", "--bare");
    const bus = busOf(h.hostA);
    try {
      const base = srcLib(h.hostA, "emit_tic test-writer '*' note p8d-base");
      const envEmit = srcLib(h.hostA, "export TICS_REMOTE='" + NEW + "'; emit_tic test-writer '*' note p8d-env");
      const envLocal = busHeadMsgs(bus).includes("p8d-env"), oldAfterEnv = remoteMsgs(h.remote), newAfterEnv = remoteMsgs(NEW);
      git(os.tmpdir(), "clone", "-q", "--bare", h.remote, OLD2);
      git(bus, "remote", "set-url", "origin", OLD2);
      const handset = srcLib(h.hostA, "emit_tic test-writer '*' note p8d-handset");
      const old2 = remoteMsgs(OLD2), log = read(h.hostA, "log"), logOut = log.stdout + log.stderr;
      assert.deepStrictEqual(
        { baseStatus: base.status, envStatus: envEmit.status, envLocal, oldHasEnv: oldAfterEnv.includes("p8d-env"), newHasEnv: newAfterEnv.includes("p8d-env"),
          handsetStatus: handset.status, old2HasHandset: old2.includes("p8d-handset"), mismatchAfterHandset: logOut.includes("bus remote mismatch") },
        { baseStatus: 0, envStatus: 0, envLocal: true, oldHasEnv: false, newHasEnv: false,
          handsetStatus: 0, old2HasHandset: true, mismatchAfterHandset: false },
        "OLD tics-bus after env emit: " + JSON.stringify(oldAfterEnv) + "\nNEW tics-bus: " + JSON.stringify(newAfterEnv) +
        "\nenv emit stderr: " + envEmit.stderr + "\nOLD2 tics-bus: " + JSON.stringify(old2) + "\nhandset stderr: " + handset.stderr + "\ntics log:\n" + logOut);
    } finally { h.cleanup(); for (const p of [NEW, OLD2]) fs.rmSync(p, { recursive: true, force: true }); }
  });

  await t.test("P8e (ADR 0026): tics sync on a moved bus prints the mismatch line and pushes nothing to the old remote", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      const sy = cp.spawnSync("node", [BIN, "sync", s.A], { encoding: "utf8", env: ENV });
      const oldRemote = remoteMsgs(s.OLD);
      assert.deepStrictEqual(
        { mismatch: sy.stdout.includes("bus remote mismatch"), oldHasMoved: oldRemote.includes("p8-after-move") },
        { mismatch: true, oldHasMoved: false },
        "tics sync stdout:\n" + sy.stdout + "\nstderr:\n" + sy.stderr + "\nOLD tics-bus: " + JSON.stringify(oldRemote));
    } finally { s.cleanup(); }
  });

  await t.test("P8f (ADR 0026): on a mismatch the reader skips the fetch, so tics log --fetch does not list a tic published to the old remote after the move", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      const late = srcLib(s.B, "emit_tic b '*' note p8-b-late");
      const oldRemote = remoteMsgs(s.OLD);
      const log = read(s.A, "log", "--fetch");
      assert.deepStrictEqual(
        { lateStatus: late.status, oldHasLate: oldRemote.includes("p8-b-late"), logListsLate: log.stdout.includes("p8-b-late") },
        { lateStatus: 0, oldHasLate: true, logListsLate: false },
        "OLD tics-bus: " + JSON.stringify(oldRemote) + "\ntics log --fetch:\n" + log.stdout + log.stderr);
    } finally { s.cleanup(); }
  });

  await t.test("P8g (ADR 0026): a legacy checkout with no record adopts its origin (no mismatch when origin equals config) and is a mismatch when config differs from origin", { timeout: 60000 }, () => {
    const same = p6Hosts(), moved = p6Hosts(), NEW = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-new-"));
    git(NEW, "init", "-q", "--bare");
    const recSame = path.join(busOf(same.hostA), ".git", "tics-remote"), recMoved = path.join(busOf(moved.hostA), ".git", "tics-remote");
    try {
      // case 1: origin == config, record deleted (a legacy checkout)
      const base1 = srcLib(same.hostA, "emit_tic test-writer '*' note p8g-base");
      fs.rmSync(recSame, { force: true });
      const adopt = srcLib(same.hostA, "emit_tic test-writer '*' note p8g-adopt");
      const sameOld = remoteMsgs(same.remote), log1 = read(same.hostA, "log"), log1Out = log1.stdout + log1.stderr;
      const recorded = fs.existsSync(recSame) ? fs.readFileSync(recSame, "utf8").trim() : null;
      // case 2: record deleted, tdd.config moved to NEW while the checkout's origin is still OLD
      const base2 = srcLib(moved.hostA, "emit_tic test-writer '*' note p8g-base2");
      fs.rmSync(recMoved, { force: true });
      setCfgRemote(path.join(moved.hostA, ".claude", "tdd.config"), moved.remote, NEW);
      const kept = srcLib(moved.hostA, "emit_tic test-writer '*' note p8g-kept");
      const movedOld = remoteMsgs(moved.remote), log2 = read(moved.hostA, "log"), log2Out = log2.stdout + log2.stderr;
      assert.deepStrictEqual(
        { base1: base1.status, adopt: adopt.status, oldHasAdopt: sameOld.includes("p8g-adopt"), mismatch1: log1Out.includes("bus remote mismatch"), recorded,
          base2: base2.status, kept: kept.status, oldHasKept: movedOld.includes("p8g-kept"), mismatch2: log2Out.includes("bus remote mismatch") },
        { base1: 0, adopt: 0, oldHasAdopt: true, mismatch1: false, recorded: same.remote,
          base2: 0, kept: 0, oldHasKept: false, mismatch2: true },
        "case 1 OLD tics-bus: " + JSON.stringify(sameOld) + "\ncase 1 tics log:\n" + log1Out +
        "\ncase 2 OLD tics-bus: " + JSON.stringify(movedOld) + "\ncase 2 tics log:\n" + log2Out);
    } finally { same.cleanup(); moved.cleanup(); fs.rmSync(NEW, { recursive: true, force: true }); }
  });

  await t.test("P8h (ADR 0026): tics rebind carries a tic file left uncommitted in the moved checkout to the new remote", { timeout: 60000 }, () => {
    const s = p8Moved();
    try {
      // an emit that wrote its file but never committed it (e.g. the checkout lock was not had in time)
      fs.writeFileSync(path.join(busOf(s.A), "tics.d", "20260101T000000Z-hostA-1-1.json"),
        '{"ts":"2026-01-01T00:00:00Z","seq":2,"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"hostA","msg":"p8h-uncommitted","ref":"","result":""}\n');
      const rb = cp.spawnSync("node", [BIN, "rebind", s.A], { encoding: "utf8", env: ENV });
      const newRemote = remoteMsgs(s.NEW);
      assert.deepStrictEqual(
        { rebindStatus: rb.status, newHasUncommitted: newRemote.includes("p8h-uncommitted") },
        { rebindStatus: 0, newHasUncommitted: true },
        "rebind: " + rb.stdout + rb.stderr + "\nNEW tics-bus: " + JSON.stringify(newRemote));
    } finally { s.cleanup(); }
  });

  await t.test("P8i (ADR 0026): one trailing slash is trimmed before comparing (config <OLD>/ is not a mismatch) and nothing else is (config <OLD>// is)", { timeout: 60000 }, () => {
    const h = p6Hosts(), cfg = path.join(h.hostA, ".claude", "tdd.config");
    try {
      const base = srcLib(h.hostA, "emit_tic test-writer '*' note p8i-base");
      setCfgRemote(cfg, h.remote, h.remote + "/");
      const slash = srcLib(h.hostA, "emit_tic test-writer '*' note p8i-slash");
      const afterSlash = remoteMsgs(h.remote), log1 = read(h.hostA, "log"), log1Out = log1.stdout + log1.stderr;
      setCfgRemote(cfg, h.remote + "/", h.remote + "//");
      const dbl = srcLib(h.hostA, "emit_tic test-writer '*' note p8i-double");
      const afterDbl = remoteMsgs(h.remote), log2 = read(h.hostA, "log"), log2Out = log2.stdout + log2.stderr;
      assert.deepStrictEqual(
        { base: base.status, slash: slash.status, oldHasSlash: afterSlash.includes("p8i-slash"), mismatchSlash: log1Out.includes("bus remote mismatch"),
          dbl: dbl.status, oldHasDouble: afterDbl.includes("p8i-double"), mismatchDouble: log2Out.includes("bus remote mismatch") },
        { base: 0, slash: 0, oldHasSlash: true, mismatchSlash: false,
          dbl: 0, oldHasDouble: false, mismatchDouble: true },
        "OLD after <OLD>/: " + JSON.stringify(afterSlash) + "\ntics log:\n" + log1Out +
        "\nOLD after <OLD>//: " + JSON.stringify(afterDbl) + "\ntics log:\n" + log2Out);
    } finally { h.cleanup(); }
  });

  await t.test("P8j (ADR 0026, P5): tics rebind leaves the project's own git tree clean (the kept old checkout is excluded too)", { timeout: 60000 }, () => {
    const h = p6Hosts(), NEW = fs.mkdtempSync(path.join(os.tmpdir(), "tics-remote-new-")), A = h.hostA, cfg = path.join(A, ".claude", "tdd.config");
    git(NEW, "init", "-q", "--bare");
    try {
      // the install is itself a git repo with a committed file; .claude/state is not ignored by the project
      git(A, "init", "-q");
      fs.writeFileSync(path.join(A, "app.txt"), "x\n");
      git(A, "add", "-A");
      git(A, "commit", "-q", "-m", "base");
      const oldEmit = srcLib(A, "emit_tic test-writer '*' note p8j-old");
      setCfgRemote(cfg, h.remote, NEW);
      git(A, "commit", "-q", "-am", "move the bus");   // the config change is a committed project act
      const moved = srcLib(A, "emit_tic test-writer '*' note p8j-after-move");
      const rb = cp.spawnSync("node", [BIN, "rebind", A], { encoding: "utf8", env: ENV });
      const status = git(A, "--no-optional-locks", "status", "--porcelain").stdout;
      assert.deepStrictEqual(
        { oldEmit: oldEmit.status, moved: moved.status, rebind: rb.status, projectStatus: status },
        { oldEmit: 0, moved: 0, rebind: 0, projectStatus: "" },
        "rebind: " + rb.stdout + rb.stderr + "\nproject state dir: " + JSON.stringify(fs.readdirSync(path.join(A, ".claude", "state"))));
    } finally { h.cleanup(); fs.rmSync(NEW, { recursive: true, force: true }); }
  });
});

test("P1b (ADR 0026): TIC_STORE=git — two emitters sharing ONE bus checkout, racing a third host, lose nothing and record no failure", { timeout: 60000 }, async () => {
  const h = p6Hosts(), K = 6;
  const burst = (d, who) => new Promise((resolve) => {
    const script = 'export TICS_SESSION="' + who + '"; . "' + path.join(d, ".claude", "hooks", "tics-lib.sh") + '"; ' +
      'for i in $(seq 1 ' + K + '); do emit_tic ' + who + ' "*" note "' + who + '-$i"; done';
    cp.spawn("bash", ["-c", script], { cwd: d, env: ENV, stdio: "ignore" }).on("close", resolve);
  });
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note A-open").status, 0);   // the shared checkout exists first
    await Promise.all([burst(h.hostA, "A1"), burst(h.hostA, "A2"), burst(h.hostB, "B")]);
    const want = ["A-open"];
    for (const w of ["A1", "A2", "B"]) for (let i = 1; i <= K; i++) want.push(w + "-" + i);
    assert.deepStrictEqual(
      { remote: remoteMsgs(h.remote), failMarkers: [h.hostA, h.hostB].filter((d) => fs.existsSync(path.join(busOf(d), ".git", "tics-net-failed"))).map(path.basename) },
      { remote: want.sort(), failMarkers: [] },
      "every tic reaches the remote exactly once and no emit misreads a concurrent emit's error as a network failure");
  } finally { h.cleanup(); }
});

// P1d (ADR 0026, never-drop, found by soak): two emits from ONE process in ONE second must land in two files even
// when $RANDOM repeats, and the reader must never hide a valid tic because its file holds more than one line.
// The collision is forced: bash 3.2+ returns the same next $RANDOM after re-seeding with RANDOM=<n>. The pair must
// also share the filename's UTC second, whatever the host speed (a git emit can take over 1 s), so sameSecondPair
// puts a stub `date` first on PATH: `date -u +%Y%m%dT%H%M%SZ` (the filename stamp) prints a FIXED stamp, every
// other call execs the real date, so tic timestamps stay real. perFileMsgs: one entry per tic file, its msgs line
// by line ("<bad>" for a line that is not JSON), sorted, so a merged file shows up as one entry with two msgs.
const perFileMsgs = (contents) => contents.map((c) => c.trim().split("\n").map((l) => { try { return JSON.parse(l).msg; } catch (_) { return "<bad>"; } }))
  .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const spoolFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")) : []);
const remoteFiles = (bare) => git(bare, "ls-tree", "-r", "--name-only", "tics-bus").stdout.trim().split("\n").filter(Boolean).map((p) => git(bare, "show", "tics-bus:" + p).stdout);
// oneShell: both emits in ONE shell (the per-process counter differs between them). twoSubshells: each emit in its
// OWN subshell — same $$, the counter starts from the same value in each, same re-seeded $RANDOM — so the two
// first-try names are identical and only the exclusive create + retry can keep both tics (P1d-5).
const oneShell = (a, b) => 'RANDOM=12345; emit_tic a "*" note ' + a + '; RANDOM=12345; emit_tic a "*" note ' + b;
const twoSubshells = (a, b) => '( RANDOM=12345; emit_tic a "*" note ' + a + ' ); ( RANDOM=12345; emit_tic a "*" note ' + b + ' )';
const FIXED_STAMP = "20260101T000000Z";
async function sameSecondPair(mk, emits) {
  const fx = mk();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), "tics-datestub-"));
  fs.writeFileSync(path.join(stubDir, "date"),
    '#!/bin/sh\n' +
    'if [ "$#" -eq 2 ] && [ "$1" = "-u" ] && [ "$2" = "+%Y%m%dT%H%M%SZ" ]; then echo ' + FIXED_STAMP + '; exit 0; fi\n' +
    'if [ -x /bin/date ]; then exec /bin/date "$@"; fi\n' +
    'exec /usr/bin/date "$@"\n', { mode: 0o755 });
  const r = srcLib(fx.d, 'export PATH="' + stubDir + ':$PATH"; ' + emits);
  fs.rmSync(stubDir, { recursive: true, force: true });
  if (r.status !== 0) { fx.cleanup(); throw new Error("the emit pair failed (status " + r.status + "):\n" + r.stdout + r.stderr); }
  return fx;
}

test("P1d (ADR 0026): never-drop — a repeated $RANDOM within one second never merges two tics, and the reader never hides one", { timeout: 180000 }, async (t) => {
  await t.test("P1d-1 (ADR 0026): two emits from one process in one second with the same $RANDOM land in two files and both are listed (spool and git)", { timeout: 60000 }, async () => {
    const sp = await sameSecondPair(() => { const d = inst("spool"); return { d, cleanup: () => fs.rmSync(d, { recursive: true, force: true }) }; }, oneShell("spool-a", "spool-b"));
    const h = await sameSecondPair(() => { const x = p6Hosts(); return { d: x.hostA, remote: x.remote, cleanup: x.cleanup }; }, oneShell("git-a", "git-b"));
    try {
      const spLog = read(sp.d, "log").stdout, gLog = read(h.d, "log").stdout;
      assert.deepStrictEqual(
        {
          spoolFiles: perFileMsgs(spoolFiles(path.join(sp.d, ".claude", "state", "tics.d"))),
          spoolLog: ["spool-a", "spool-b"].filter((m) => spLog.includes(m)),
          gitLocalFiles: perFileMsgs(spoolFiles(path.join(busOf(h.d), "tics.d"))),
          gitRemoteFiles: perFileMsgs(remoteFiles(h.remote)),
          gitLog: ["git-a", "git-b"].filter((m) => gLog.includes(m)),
        },
        {
          spoolFiles: [["spool-a"], ["spool-b"]],
          spoolLog: ["spool-a", "spool-b"],
          gitLocalFiles: [["git-a"], ["git-b"]],
          gitRemoteFiles: [["git-a"], ["git-b"]],
          gitLog: ["git-a", "git-b"],
        },
        "each emit gets its own file holding exactly one tic, and tics log lists both");
    } finally { sp.cleanup(); h.cleanup(); }
  });

  await t.test("P1d-2 (ADR 0026): the reader lists every valid tic line of a spool file — a file merged by the old naming bug, and a valid line after a garbage one", { timeout: 60000 }, () => {
    const d = inst("spool"), dir = path.join(d, ".claude", "state", "tics.d");
    const tic = (seq, msg) => '{"ts":"2026-01-01T00:00:0' + seq + 'Z","seq":' + seq + ',"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"","msg":"' + msg + '","ref":"","result":""}\n';
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "20260101T000001Z-111-12345.json"), tic(1, "merged-first") + tic(2, "merged-second"));
      fs.writeFileSync(path.join(dir, "20260101T000003Z-222-777.json"), tic(3, "single-file"));
      fs.writeFileSync(path.join(dir, "20260101T000004Z-333-888.json"), '{"ts":"2026-01-01T00:00:04Z","seq":4,"kind":"no\n' + tic(5, "after-garbage"));
      const log = read(d, "log");
      assert.deepStrictEqual(
        { status: log.status, listed: ["merged-first", "merged-second", "single-file", "after-garbage"].filter((m) => log.stdout.includes(m)) },
        { status: 0, listed: ["merged-first", "merged-second", "single-file", "after-garbage"] },
        "tics log lists every valid tic line, whatever else its file holds:\n" + log.stdout);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  await t.test("P1d-4 (ADR 0026): tics log reports the count of skipped unparsable tic lines when it is non-zero; board, inbox and a clean log stay silent", { timeout: 60000 }, () => {
    const d = inst("spool"), dir = path.join(d, ".claude", "state", "tics.d");
    const clean = inst("spool"), cleanDir = path.join(clean, ".claude", "state", "tics.d");
    const tic = (seq, msg) => '{"ts":"2026-01-01T00:00:0' + seq + 'Z","seq":' + seq + ',"kind":"note","from":"a","to":"b","phase":"off","layer":"app","scope":"app","session":"","msg":"' + msg + '","ref":"","result":""}\n';
    const out = (r) => r.stdout + r.stderr;
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.mkdirSync(cleanDir, { recursive: true });
      fs.writeFileSync(path.join(dir, "20260101T000001Z-111-12345.json"), 'not json at all\n' + tic(1, "after-garbage"));
      fs.writeFileSync(path.join(dir, "20260101T000002Z-222-777.json"), tic(2, "clean-file"));
      fs.writeFileSync(path.join(cleanDir, "20260101T000003Z-333-888.json"), tic(3, "only-clean"));
      const log = read(d, "log"), board = read(d, "board"), inbox = read(d, "inbox", "b"), cleanLog = read(clean, "log");
      assert.deepStrictEqual(
        {
          logStatus: log.status,
          logListed: ["after-garbage", "clean-file"].filter((m) => log.stdout.includes(m)),
          logReportsOne: /(^|\n)1 unparsable tic line\(s\) skipped/.test(out(log)),
          boardMentions: /unparsable/.test(out(board)),
          inboxMentions: /unparsable/.test(out(inbox)),
          cleanLogMentions: /unparsable/.test(out(cleanLog)),
        },
        {
          logStatus: 0,
          logListed: ["after-garbage", "clean-file"],
          logReportsOne: true,
          boardMentions: false,
          inboxMentions: false,
          cleanLogMentions: false,
        },
        "only tics log reports skipped unparsable lines, and only when there are some:\n--- log\n" + out(log) + "--- board\n" + out(board) + "--- inbox\n" + out(inbox) + "--- clean log\n" + out(cleanLog));
    } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(clean, { recursive: true, force: true }); }
  });

  await t.test("P1d-5 (ADR 0026): two same-second emits whose first-try names are identical (own subshells, same $$, counter and $RANDOM) still land in two files and both are listed (spool and git)", { timeout: 60000 }, async () => {
    const sp = await sameSecondPair(() => { const d = inst("spool"); return { d, cleanup: () => fs.rmSync(d, { recursive: true, force: true }) }; }, twoSubshells("p1d5-first", "p1d5-second"));
    const h = await sameSecondPair(() => { const x = p6Hosts(); return { d: x.hostA, remote: x.remote, cleanup: x.cleanup }; }, twoSubshells("p1d5-first", "p1d5-second"));
    try {
      const spLog = read(sp.d, "log").stdout, gLog = read(h.d, "log").stdout;
      assert.deepStrictEqual(
        {
          spoolFiles: perFileMsgs(spoolFiles(path.join(sp.d, ".claude", "state", "tics.d"))),
          spoolLog: ["p1d5-first", "p1d5-second"].filter((m) => spLog.includes(m)),
          gitLocalFiles: perFileMsgs(spoolFiles(path.join(busOf(h.d), "tics.d"))),
          gitRemoteFiles: perFileMsgs(remoteFiles(h.remote)),
          gitLog: ["p1d5-first", "p1d5-second"].filter((m) => gLog.includes(m)),
        },
        {
          spoolFiles: [["p1d5-first"], ["p1d5-second"]],
          spoolLog: ["p1d5-first", "p1d5-second"],
          gitLocalFiles: [["p1d5-first"], ["p1d5-second"]],
          gitRemoteFiles: [["p1d5-first"], ["p1d5-second"]],
          gitLog: ["p1d5-first", "p1d5-second"],
        },
        "the exclusive create refuses the taken name and the retry gives the second tic its own file; tics log lists both");
    } finally { sp.cleanup(); h.cleanup(); }
  });
});

// P1c (ADR 0026, the architect's lock contract): the per-checkout mkdir lock covers LOCAL mutations only (add,
// commit, the fetch+rebase after a rejected push), is never held across the push itself, and a stale lock is
// broken when its recorded pid is dead OR its age exceeds 2 x TICS_NET_TIMEOUT; a failed rebase always aborts.
// committedMsgs reads the msgs committed at the bus checkout's HEAD (local commits, pushed or not).
const committedMsgs = (bus) => git(bus, "ls-tree", "-r", "--name-only", "HEAD", "--", "tics.d").stdout.trim().split("\n").filter(Boolean)
  .map((p) => { try { return JSON.parse(git(bus, "show", "HEAD:" + p).stdout).msg; } catch (_) { return null; } }).filter(Boolean).sort();
const lockDirOf = (d) => path.join(busOf(d), ".git", "tics-emit.lock");

test("P1c (ADR 0026): TIC_STORE=git — the per-checkout lock covers local mutations only: stale locks break, rebases abort, pushes run unlocked", { timeout: 180000 }, async (t) => {
  await t.test("P1c-1 (ADR 0026): a crashed holder doesn't block — a dead-pid lock and an alive-pid lock older than 2 x TICS_NET_TIMEOUT are both broken and the tic committed", { timeout: 60000 }, async () => {
    const h = p6Hosts('TICS_NET_TIMEOUT="1"\n');
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);   // the bus checkout exists
      const dead = cp.spawnSync("true").pid;                                           // exited: its pid is dead
      fs.mkdirSync(lockDirOf(h.hostA));
      fs.writeFileSync(path.join(lockDirOf(h.hostA), "pid"), dead + "\n");
      const e1 = await timedEmit(h.hostA, "emit_tic a '*' note after-dead-holder", 30000, ENV);
      const afterDead = committedMsgs(busOf(h.hostA));
      // an alive holder (this test runner) whose lock is far older than 2 x TICS_NET_TIMEOUT (= 2 s)
      fs.rmSync(lockDirOf(h.hostA), { recursive: true, force: true });
      fs.mkdirSync(lockDirOf(h.hostA));
      fs.writeFileSync(path.join(lockDirOf(h.hostA), "pid"), process.pid + "\n");
      const old = new Date(Date.now() - 60000);
      fs.utimesSync(path.join(lockDirOf(h.hostA), "pid"), old, old);
      fs.utimesSync(lockDirOf(h.hostA), old, old);
      const e2 = await timedEmit(h.hostA, "emit_tic a '*' note after-old-holder", 30000, ENV);
      assert.deepStrictEqual(
        { e1: e1.status, e1Fast: e1.ms < 2000, deadCommitted: afterDead.includes("after-dead-holder"),
          e2: e2.status, e2Fast: e2.ms < 2500, oldCommitted: committedMsgs(busOf(h.hostA)).includes("after-old-holder") },
        { e1: 0, e1Fast: true, deadCommitted: true, e2: 0, e2Fast: true, oldCommitted: true },
        "emit over a dead-pid lock (ms " + e1.ms + ") and over a 60 s old alive-pid lock with TICS_NET_TIMEOUT=1 (ms " + e2.ms + ")");
    } finally { h.cleanup(); }
  });

  await t.test("P1c-2 (ADR 0026): after a rejected push whose rebase conflicts, the checkout has no rebase in progress and a further emit still commits", { timeout: 60000 }, async () => {
    const h = p6Hosts(), scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p1c2-"));
    const bus = busOf(h.hostA), name = "tics.d/20260101T000000Z-hostA-1-1.json";
    const ticJson = (msg) => '{"ts":"2026-01-01T00:00:00Z","seq":9,"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"hostA","msg":"' + msg + '","ref":"","result":""}\n';
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note base-A").status, 0);     // published: a shared base
      // a local, unpushed tic at `name` ...
      fs.writeFileSync(path.join(bus, name), ticJson("local-version"));
      assert.strictEqual(git(bus, "add", "--", name).status, 0);
      assert.strictEqual(git(bus, "commit", "-q", "-m", "tic").status, 0);
      // ... and the remote gets a different file at the same path, so A's next push is rejected and its rebase conflicts
      assert.strictEqual(git(scratch, "clone", "-q", "--branch", "tics-bus", h.remote, "c").status, 0);
      const c = path.join(scratch, "c");
      fs.writeFileSync(path.join(c, name), ticJson("remote-version"));
      assert.strictEqual(git(c, "add", "--", name).status, 0);
      assert.strictEqual(git(c, "commit", "-q", "-m", "tic").status, 0);
      assert.strictEqual(git(c, "push", "-q", "origin", "HEAD:refs/heads/tics-bus").status, 0);
      const e1 = await timedEmit(h.hostA, "emit_tic a '*' note conflicting-emit", 30000, ENV);
      const roStatus = cp.spawnSync("git", ["--no-optional-locks", "-C", bus, "status"], { encoding: "utf8", env: { ...ENV, GIT_OPTIONAL_LOCKS: "0" } }).stdout;
      const state = {
        rebaseMerge: fs.existsSync(path.join(bus, ".git", "rebase-merge")),
        rebaseApply: fs.existsSync(path.join(bus, ".git", "rebase-apply")),
        statusSaysRebasing: /rebas/i.test(roStatus),
        onBranch: git(bus, "symbolic-ref", "-q", "HEAD").stdout.trim(),
      };
      const e2 = await timedEmit(h.hostA, "emit_tic a '*' note after-conflict", 30000, ENV);
      assert.deepStrictEqual(
        { e1: e1.status, ...state, e2: e2.status, committed: committedMsgs(bus).includes("after-conflict") },
        { e1: 0, rebaseMerge: false, rebaseApply: false, statusSaysRebasing: false, onBranch: "refs/heads/tics-bus", e2: 0, committed: true },
        "after a conflicting rebase (emit ms " + e1.ms + ", then " + e2.ms + "); git status: " + JSON.stringify(roStatus));
    } finally {
      h.cleanup();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });

  // P1c-3 design: emit A must really be inside its push when B runs, so A is started with TICS_FETCH_TTL=0 (the
  // backoff never skips its push) and we wait for A's ssh spawn (the push in flight, ~4 s hang). B runs with the
  // default TTL while a fresh failure marker is on record, so B itself never touches the network: under the
  // contract B's whole run is lock + add + commit + unlock (fast), while lock-across-push makes B wait for A.
  await t.test("P1c-3 (ADR 0026): the lock is never held across the push — emit B commits and exits in under 1.5 s while emit A's push hangs on the same checkout", { timeout: 60000 }, async () => {
    const d = inst("git"), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p1c3-")), hs = hangSsh(tmp);
    const bus = busOf(d), HANG = { ...ENV, GIT_SSH_COMMAND: hs.ssh };
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), 'TICS_REMOTE="ssh://hang/x.git"\nTICS_NET_TIMEOUT="4"\n');
    try {
      // the checkout exists and its first push failed: a fresh failure marker is on record
      assert.strictEqual((await timedEmit(d, "emit_tic a '*' note setup", 30000, HANG)).status, 0);
      assert.ok(fs.existsSync(path.join(bus, ".git", "tics-net-failed")), "the setup emit recorded the failed push");
      const before = hs.spawns();
      let aDone = false;
      const a = timedEmit(d, "emit_tic a '*' note emit-A", 30000, { ...HANG, TICS_FETCH_TTL: "0" }).then((r) => { aDone = true; return r; });
      const t0 = Date.now();
      while (hs.spawns() === before && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 25));
      const aPushing = hs.spawns() > before && !aDone;
      const b = await timedEmit(d, "emit_tic b '*' note emit-B", 30000, HANG);
      const bCommitted = committedMsgs(bus).includes("emit-B"), aRunningAtBExit = !aDone;
      const ra = await a;
      assert.deepStrictEqual(
        { aPushing, b: b.status, bFast: b.ms < 1500, bCommitted, aRunningAtBExit, a: ra.status, aCommitted: committedMsgs(bus).includes("emit-A") },
        { aPushing: true, b: 0, bFast: true, bCommitted: true, aRunningAtBExit: true, a: 0, aCommitted: true },
        "emit B on the checkout while A's push hangs (B ms " + b.ms + ", A ms " + ra.ms + ", ssh spawns " + before + " -> " + hs.spawns() + ")");
    } finally {
      hs.reap();
      for (const p of [d, tmp]) fs.rmSync(p, { recursive: true, force: true });
    }
  });

  // P1c-4 design: the loss window is INSIDE one `rebase || rebase --abort` line (after the rebase moved HEAD, before
  // the abort resets to ORIG_HEAD), so no timing or pre-made lock can land a second emit there deterministically (a
  // fresh, alive pre-made lock just makes both emits give up uncommitted, and nothing is ever reset). git itself
  // gives the hook point: a rebase runs post-checkout right after it detaches HEAD onto FETCH_HEAD (rebase-merge/
  // already written). That hook, run ONCE, plays the double-hold: it ages emit X's live lock past 2 x TICS_NET_TIMEOUT
  // (the stale-reclaim race) and runs emit Y, which breaks the lock, commits on the rebasing HEAD and backs off the
  // network (a fresh failure marker; X itself ignores it via TICS_FETCH_TTL=0). The rebase then conflicts on the
  // P1c-2 same-path fixture and X's abort runs with Y's commit on HEAD. Afterwards origin points at a clean bare
  // remote (the shared base only) and `tics sync` publishes. If the hook never fired, the test says so.
  await t.test("P1c-4 (ADR 0026): with a forced double-hold racing a rejected push, every emitted msg reaches origin after a tics sync, and no tic file is ever deleted", { timeout: 60000 }, async () => {
    const h = p6Hosts(), scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p1c4-"));
    const bus = busOf(h.hostA), name = "tics.d/20260101T000000Z-hostA-1-1.json";
    const ticJson = (msg) => '{"ts":"2026-01-01T00:00:00Z","seq":9,"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"hostA","msg":"' + msg + '","ref":"","result":""}\n';
    const fired = path.join(scratch, "hook-fired"), seenInHook = path.join(scratch, "seen-in-hook"), clean = path.join(scratch, "clean.git");
    const lsTics = () => fs.readdirSync(path.join(bus, "tics.d"));
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note base-A").status, 0);     // published: a shared base
      const seen = new Set(lsTics());
      assert.strictEqual(git(scratch, "clone", "-q", "--bare", "--branch", "tics-bus", h.remote, clean).status, 0);   // the clean remote: base only
      // P1c-2's fixture: a local unpushed tic at `name`, a different remote file at the same path -> push rejected, rebase conflicts
      fs.writeFileSync(path.join(bus, name), ticJson("local-version"));
      assert.strictEqual(git(bus, "add", "--", name).status, 0);
      assert.strictEqual(git(bus, "commit", "-q", "-m", "tic").status, 0);
      assert.strictEqual(git(scratch, "clone", "-q", "--branch", "tics-bus", h.remote, "c").status, 0);
      const c = path.join(scratch, "c");
      fs.writeFileSync(path.join(c, name), ticJson("remote-version"));
      assert.strictEqual(git(c, "add", "--", name).status, 0);
      assert.strictEqual(git(c, "commit", "-q", "-m", "tic").status, 0);
      assert.strictEqual(git(c, "push", "-q", "origin", "HEAD:refs/heads/tics-bus").status, 0);
      lsTics().forEach((f) => seen.add(f));
      fs.writeFileSync(path.join(bus, ".git", "tics-net-failed"), Math.floor(Date.now() / 1000) + "\n");   // Y backs off
      const hook = path.join(bus, ".git", "hooks", "post-checkout");
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, "#!/bin/sh\n" +
        "[ -e '" + fired + "' ] && exit 0\n: > '" + fired + "'\n" +
        "touch -t 200001010000 '" + lockDirOf(h.hostA) + "' 2>/dev/null\n" +
        "cd '" + h.hostA + "' && env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX -u GIT_COMMON_DIR " +
        "TICS_NET_TIMEOUT=1 TICS_LOCK_WAIT=1 TICS_FETCH_TTL=60 TICS_SESSION=hostAy " +
        "bash -c '. \"" + path.join(h.hostA, ".claude", "hooks", "tics-lib.sh") + "\"; emit_tic y \"*\" note intervening-Y' >/dev/null 2>&1\n" +
        "ls '" + path.join(bus, "tics.d") + "' > '" + seenInHook + "'\nexit 0\n");
      fs.chmodSync(hook, 0o755);
      const x = await timedEmit(h.hostA, "emit_tic a '*' note emit-X", 30000, { ...ENV, TICS_FETCH_TTL: "0" });
      fs.rmSync(hook, { force: true });
      const hookFired = fs.existsSync(fired);
      (hookFired && fs.existsSync(seenInHook) ? fs.readFileSync(seenInHook, "utf8").split("\n").filter(Boolean) : []).forEach((f) => seen.add(f));
      lsTics().forEach((f) => seen.add(f));
      const deletedByX = [...seen].filter((f) => !fs.existsSync(path.join(bus, "tics.d", f))).sort();
      assert.strictEqual(git(bus, "remote", "set-url", "origin", clean).status, 0);
      const s = await timedRun("node", [BIN, "sync", h.hostA], { env: ENV }, 30000);
      const inHead = new Set(git(bus, "ls-tree", "-r", "--name-only", "HEAD", "--", "tics.d").stdout.trim().split("\n").filter(Boolean).map((p) => path.basename(p)));
      const lost = [...seen].filter((f) => !fs.existsSync(path.join(bus, "tics.d", f)) && !inHead.has(f)).sort();
      assert.deepStrictEqual(
        { hookFired, x: x.status, sync: s.status, remote: remoteMsgs(clean).filter((m) => m !== "local-version" && m !== "remote-version"), lost, deletedByX },
        { hookFired: true, x: 0, sync: 0, remote: ["base-A", "emit-X", "intervening-Y"], lost: [], deletedByX: [] },
        "a second emit committing inside emit X's rebase (forced double-hold) must survive X's rebase abort (X ms " + x.ms + ")");
    } finally {
      h.cleanup();
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// P1d-3 (ADR 0026): the reader fix must hold on the git-bus union path too (gitBusTics reads origin/tics-bus files
// that are not in the local worktree), not only on the spool path. The merged file is crafted in a scratch clone.
test("P1d-3 (ADR 0026): TIC_STORE=git — a fetched remote tic file holding two valid lines has both msgs listed by tics log", { timeout: 60000 }, () => {
  const h = p6Hosts(), scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p1d3-"));
  const tic = (seq, msg) => '{"ts":"2026-01-01T00:00:0' + seq + 'Z","seq":' + seq + ',"kind":"note","from":"b","to":"*","phase":"off","layer":"app","scope":"app","session":"hostB","msg":"' + msg + '","ref":"","result":""}\n';
  try {
    assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note base-A").status, 0);     // A's bus checkout exists and is published
    assert.strictEqual(git(scratch, "clone", "-q", "--branch", "tics-bus", h.remote, "c").status, 0);
    const c = path.join(scratch, "c"), name = "tics.d/20260101T000001Z-hostB-111-12345.json";
    fs.writeFileSync(path.join(c, name), tic(1, "remote-merged-first") + tic(2, "remote-merged-second"));
    assert.strictEqual(git(c, "add", "--", name).status, 0);
    assert.strictEqual(git(c, "commit", "-q", "-m", "tic").status, 0);
    assert.strictEqual(git(c, "push", "-q", "origin", "HEAD:refs/heads/tics-bus").status, 0);
    const log = read(h.hostA, "log", "--fetch");
    assert.deepStrictEqual(
      { status: log.status, listed: ["base-A", "remote-merged-first", "remote-merged-second"].filter((m) => log.stdout.includes(m)) },
      { status: 0, listed: ["base-A", "remote-merged-first", "remote-merged-second"] },
      "tics log lists every valid tic line of a merged file fetched from origin/tics-bus:\n" + log.stdout);
  } finally {
    h.cleanup();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

// P1e (ADR 0026, "The per-checkout lock"): characterization of the lock contract clauses the P1c suite left
// unpinned (critic final audit mutants M3a, M3b, M4, M5a, M7). Each fixture builds the bus checkout with one emit,
// then plants lock state under <bus>/.git. libIn(d, s) sources the installed lib with _gd set to that checkout, so
// the lock functions can be driven directly. holdLive() spawns a live process to play a foreign, alive holder.
const libIn = (d, s) => srcLib(d, "_gd='" + busOf(d) + "'; " + s);
const holdLive = () => cp.spawn("sleep", ["60"], { stdio: "ignore" });
const plantLock = (d, pid) => { fs.mkdirSync(lockDirOf(d)); fs.writeFileSync(path.join(lockDirOf(d), "pid"), pid + "\n"); };
const lockPid = (d) => { try { return fs.readFileSync(path.join(lockDirOf(d), "pid"), "utf8").trim(); } catch (_) { return null; } };

test("P1e (ADR 0026): TIC_STORE=git — the per-checkout lock: owner-only unlock, a re-checking reclaim mutex with a 3 s age bound, add -A", { timeout: 180000 }, async (t) => {
  await t.test("P1e-1 (ADR 0026): unlock never removes a lock held by another, live process", { timeout: 60000 }, () => {
    const h = p6Hosts(), holder = holdLive();
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);
      plantLock(h.hostA, holder.pid);
      const r = libIn(h.hostA, "_tic_git_unlock");
      assert.deepStrictEqual(
        { status: r.status, lockExists: fs.existsSync(lockDirOf(h.hostA)), pid: lockPid(h.hostA) },
        { status: 0, lockExists: true, pid: String(holder.pid) },
        "_tic_git_unlock from a process that does not own the lock leaves it in place");
    } finally { holder.kill("SIGKILL"); h.cleanup(); }
  });

  await t.test("P1e-2 (ADR 0026): a stale lock is not broken while another waiter holds a fresh reclaim mutex — the emit gives up and leaves its tic uncommitted", { timeout: 60000 }, async () => {
    const h = p6Hosts();
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);
      const dead = String(cp.spawnSync("true").pid);
      plantLock(h.hostA, dead);
      fs.mkdirSync(lockDirOf(h.hostA) + ".reclaim");                                   // a live reclaimer, mid-reclaim
      const e = await timedEmit(h.hostA, "emit_tic a '*' note while-reclaiming", 30000, { ...ENV, TICS_LOCK_WAIT: "1" });
      assert.deepStrictEqual(
        { e: e.status, pid: lockPid(h.hostA), reclaimHeld: fs.existsSync(lockDirOf(h.hostA) + ".reclaim"), committed: committedMsgs(busOf(h.hostA)).includes("while-reclaiming") },
        { e: 0, pid: dead, reclaimHeld: true, committed: false },
        "an emit facing a stale lock and a fresh reclaim mutex waits (ms " + e.ms + ") and never breaks the lock itself");
    } finally { h.cleanup(); }
  });

  await t.test("P1e-3 (ADR 0026): under the reclaim mutex the lock is re-checked — one that is no longer stale is not broken", { timeout: 60000 }, () => {
    const h = p6Hosts(), holder = holdLive(), scratch = fs.mkdtempSync(path.join(os.tmpdir(), "tics-p1e3-"));
    const n = path.join(scratch, "stale-calls");
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);
      plantLock(h.hostA, holder.pid);
      // the first look says stale; every later look (the re-check under the mutex) says it is held again
      const r = libIn(h.hostA, "_tic_git_lock_stale() { echo x >> '" + n + "'; [ \"$(wc -l < '" + n + "' | tr -d ' ')\" = 1 ]; }; " +
        "TICS_LOCK_WAIT=1 _tic_git_lock; echo \"rc=$?\"");
      assert.deepStrictEqual(
        { rc: (r.stdout.match(/rc=(\d+)/) || [])[1], pid: lockPid(h.hostA), reclaimLeft: fs.existsSync(lockDirOf(h.hostA) + ".reclaim") },
        { rc: "1", pid: String(holder.pid), reclaimLeft: false },
        "a lock that turned fresh between the first look and the re-check stays its holder's: " + r.stdout + r.stderr);
    } finally { holder.kill("SIGKILL"); h.cleanup(); fs.rmSync(scratch, { recursive: true, force: true }); }
  });

  await t.test("P1e-4 (ADR 0026): a reclaim mutex older than 3 s (a crashed reclaimer) is cleared — the emit breaks the stale lock and commits", { timeout: 60000 }, async () => {
    const h = p6Hosts();
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);
      plantLock(h.hostA, String(cp.spawnSync("true").pid));
      const lr = lockDirOf(h.hostA) + ".reclaim", old = new Date(Date.now() - 6000);
      fs.mkdirSync(lr);
      fs.utimesSync(lr, old, old);
      const e = await timedEmit(h.hostA, "emit_tic a '*' note after-crashed-reclaimer", 30000, { ...ENV, TICS_LOCK_WAIT: "2" });
      assert.deepStrictEqual(
        { e: e.status, committed: committedMsgs(busOf(h.hostA)).includes("after-crashed-reclaimer"), lockLeft: fs.existsSync(lockDirOf(h.hostA)), reclaimLeft: fs.existsSync(lr) },
        { e: 0, committed: true, lockLeft: false, reclaimLeft: false },
        "an emit facing a dead-pid lock and a 6 s old reclaim mutex (ms " + e.ms + ")");
    } finally { h.cleanup(); }
  });

  await t.test("P1e-5 (ADR 0026): an emit stages ALL of tics.d — a tic file left uncommitted earlier is committed with it", { timeout: 60000 }, () => {
    const h = p6Hosts();
    const stray = '{"ts":"2026-01-01T00:00:00Z","seq":9,"kind":"note","from":"a","to":"*","phase":"off","layer":"app","scope":"app","session":"hostA","msg":"stray-uncommitted","ref":"","result":""}\n';
    try {
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note open-A").status, 0);
      fs.writeFileSync(path.join(busOf(h.hostA), "tics.d", "20260101T000000Z-hostA-1-1.json"), stray);
      assert.strictEqual(srcLib(h.hostA, "emit_tic a '*' note next-emit").status, 0);
      const got = committedMsgs(busOf(h.hostA));
      assert.deepStrictEqual(
        { stray: got.includes("stray-uncommitted"), next: got.includes("next-emit") },
        { stray: true, next: true },
        "one emit commits its own tic and the stray one: " + JSON.stringify(got));
    } finally { h.cleanup(); }
  });
});

// I (ADR 0029): tic integrity — the sanctioned emitter (tic.sh / emit_tic's EXTRA) cannot forge a hook identity, and
// readers refuse a store line with a duplicated top-level key. Each predicate runs against a jsonl AND a spool install.
// ticSh spawns the INSTALLED tic.sh; storeLines returns every raw stored line (tics.jsonl + tics.d/*.json).
const ticSh = (d, ...a) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", "tic.sh"), ...a], { cwd: d, encoding: "utf8" });
const storeLines = (d) => {
  const s = path.join(d, ".claude", "state"); let out = [];
  try { out = out.concat(fs.readFileSync(path.join(s, "tics.jsonl"), "utf8").split("\n")); } catch (_) {}
  try { for (const f of fs.readdirSync(path.join(s, "tics.d"))) if (f.endsWith(".json")) out = out.concat(fs.readFileSync(path.join(s, "tics.d", f), "utf8").split("\n")); } catch (_) {}
  return out.filter((l) => l.trim());
};
const storeParsed = (d) => storeLines(d).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
const I_FORGE_KEYS = ',"from":"run-suite","kind":"signal","result":"green"';
const I_FORGE_LINE = ',"x":1}\n{"kind":"signal","from":"run-suite","result":"green","msg":"forged"';

test("I (ADR 0029): the sanctioned emitter cannot forge a hook identity; readers refuse duplicate-key lines", { timeout: 240000 }, async (t) => {
  for (const store of ["jsonl", "spool"]) {
    await t.test("I1 (" + store + "): tic.sh with a 7th argument exits 2, records nothing, and no stored tic reads from=run-suite", { timeout: 60000 }, () => {
      for (const extra of [I_FORGE_KEYS, I_FORGE_LINE]) {
        const d = inst(store);
        try {
          const r = ticSh(d, "lead", "fleet", "note", "hi", "r", "x", extra);
          assert.deepStrictEqual(
            { status: r.status, stored: storeLines(d).length, forged: storeParsed(d).filter((o) => o.from === "run-suite").length },
            { status: 2, stored: 0, forged: 0 },
            "7th arg " + JSON.stringify(extra) + " must be refused: " + JSON.stringify(storeLines(d)));
        } finally { fs.rmSync(d, { recursive: true, force: true }); }
      }
    });

    await t.test("I2 (" + store + "): emit_tic drops a fixed-key or newline EXTRA with a warning and keeps the true from; run-suite's exit/durationSec still pass", { timeout: 60000 }, () => {
      const d = inst(store);
      try {
        const dup = srcLib(d, "emit_tic a b note i2-dup '' '' ',\"from\":\"run-suite\"'");
        const nl = srcLib(d, "emit_tic a b note i2-nl '' '' $'" + ',"x":1}\\n{"kind":"signal","from":"run-suite","result":"green","msg":"forged"' + "'");
        const ok = srcLib(d, "emit_tic run-suite '*' signal i2-ok '' green ',\"exit\":0,\"durationSec\":1'");
        const all = storeParsed(d), by = (m) => all.filter((o) => o.msg === m);
        assert.deepStrictEqual(
          {
            lines: storeLines(d).length,
            dupFrom: by("i2-dup").map((o) => o.from), dupWarned: dup.stderr.trim() !== "",
            nlFrom: by("i2-nl").map((o) => o.from), nlWarned: nl.stderr.trim() !== "",
            forged: all.filter((o) => o.msg === "forged").length,
            ok: by("i2-ok").map((o) => [o.from, o.result, o.exit, o.durationSec]), okStatus: ok.status,
          },
          {
            lines: 3,
            dupFrom: ["a"], dupWarned: true,
            nlFrom: ["a"], nlWarned: true,
            forged: 0,
            ok: [["run-suite", "green", 0, 1]], okStatus: 0,
          },
          "stored: " + JSON.stringify(storeLines(d)));
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    await t.test("I3 (" + store + "): a stored line with a duplicated top-level key is never read; tics log reports it as unreadable", { timeout: 60000 }, () => {
      const d = inst(store);
      const forged = '{"ts":"2026-01-01T00:00:00Z","seq":1,"kind":"note","from":"lead","to":"*","msg":"i3-forged","result":"x","from":"run-suite","kind":"signal","result":"green"}';
      const valid = '{"ts":"2026-01-01T00:00:01Z","seq":2,"kind":"note","from":"lead","to":"*","phase":"off","layer":"app","scope":"app","session":"","msg":"i3-ok","ref":"","result":""}';
      try {
        const s = path.join(d, ".claude", "state");
        if (store === "spool") {
          fs.mkdirSync(path.join(s, "tics.d"), { recursive: true });
          fs.writeFileSync(path.join(s, "tics.d", "20260101T000000Z-x-1-0001-1.json"), forged + "\n");
          fs.writeFileSync(path.join(s, "tics.d", "20260101T000001Z-x-1-0002-1.json"), valid + "\n");
        } else {
          fs.writeFileSync(path.join(s, "tics.jsonl"), forged + "\n" + valid + "\n");
        }
        const log = read(d, "log");
        const TV = require(path.join(__dirname, "..", "kit", "hooks", "tics-view.cjs"));
        assert.deepStrictEqual(
          {
            status: log.status,
            forgedListed: log.stdout.includes("i3-forged"), okListed: log.stdout.includes("i3-ok"),
            reportsUnreadable: /unreadable|unparsable|skipped/i.test(log.stdout + log.stderr),
            loadedHook: TV.loadTics(d).filter((o) => o.from === "run-suite").length,
          },
          { status: 0, forgedListed: false, okListed: true, reportsUnreadable: true, loadedHook: 0 },
          "tics log:\n" + log.stdout + log.stderr);
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });
  }
});
