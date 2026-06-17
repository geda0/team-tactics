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
    assert.ok(list && list.result && Array.isArray(list.result.tools) && list.result.tools.length === 6, "tools/list frame present");
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
