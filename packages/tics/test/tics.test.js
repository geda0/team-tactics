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

test("C2/C3: `tics todo <session>` shows your OPEN assignments + the joint-forces pool", () => {
  const d = inst();
  try {
    srcLib(d, "emit_tic lead sessW delegate 'build the ranker' task1");          // assigned to me, open
    srcLib(d, "emit_tic lead sessW delegate 'wire the app' task2");              // assigned to me...
    srcLib(d, "emit_tic sessW lead handoff 'app wired' task2 green");             // ...but handed off (done)
    srcLib(d, "emit_tic lead '*' delegate 'docs pass' task3");                    // offered to the pool
    srcLib(d, "emit_tic peer architect need 'need the StockLevel contract'");     // help wanted
    const out = read(d, "todo", "sessW").stdout;
    assert.match(out, /build the ranker|task1/, "shows my open assignment");
    assert.doesNotMatch(out, /wire the app/, "hides a handed-off (done) assignment");
    assert.match(out, /docs pass|task3/, "shows pooled work to grab");
    assert.match(out, /StockLevel|need/i, "shows open help requests");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MS1: `tics sessions` lists live sessions + their scopes + claims (who's active, where)", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SESSION='sessA'; export TICS_SCOPE='auth/S1'; emit_tic a '*' claim login.ts login.ts");
    srcLib(d, "export TICS_SESSION='sessA'; emit_tic a '*' session open started");
    srcLib(d, "export TICS_SESSION='sessB'; export TICS_SCOPE='ui/S2'; emit_tic b '*' note hi");
    const s = read(d, "sessions").stdout;
    const line = (id) => s.split("\n").find((l) => l.includes(id)) || "";
    assert.match(line("sessA"), /auth\/S1/, "sessA shows its scope");
    assert.match(line("sessA"), /open|active/i, "sessA shows a live status");
    assert.match(line("sessB"), /ui\/S2/, "sessB shows its scope");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MS5: a STALE session's claim expires (no tic within CLAIMS_TTL) — a dead session's lane frees", () => {
  const d = inst();
  try {
    fs.appendFileSync(path.join(d, ".claude", "tdd.config"), "\nCLAIMS_TTL=60\n");   // 60s liveness window
    const now = Date.now();
    const stale = new Date(now - 3600 * 1000).toISOString();   // 1h ago -> dead
    const live = new Date(now - 5 * 1000).toISOString();        // 5s ago -> alive
    fs.writeFileSync(path.join(d, ".claude", "state", "tics.jsonl"),
      JSON.stringify({ ts: stale, seq: 1, kind: "claim", from: "a", to: "*", scope: "dead/S1", session: "sessDead", ref: "old.ts", msg: "old.ts" }) + "\n" +
      JSON.stringify({ ts: live, seq: 2, kind: "claim", from: "b", to: "*", scope: "live/S2", session: "sessLive", ref: "new.ts", msg: "new.ts" }) + "\n");
    const claims = read(d, "claims").stdout;
    assert.doesNotMatch(claims, /old\.ts/, "a stale (dead) session's claim is released");
    assert.match(claims, /new\.ts/, "a live session's claim is kept");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("C1: a `session close` auto-releases that session's claims (a leaving worker frees its lane)", () => {
  const d = inst();
  try {
    srcLib(d, "export TICS_SESSION='sessA' TICS_SCOPE='auth/S1'; emit_tic a '*' claim login.ts login.ts");
    assert.match(read(d, "claims").stdout, /login\.ts/, "claimed while the session is live");
    srcLib(d, "export TICS_SESSION='sessA'; emit_tic a '*' session leaving '' close");
    assert.doesNotMatch(read(d, "claims").stdout, /login\.ts/, "the session close frees its claim");
    assert.strictEqual(read(d, "claim-session", "login.ts").stdout.trim(), "", "claim-session clears -> a peer may take the lane");
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

test("selftest passes (emit + read round-trip)", () => {
  assert.strictEqual(node("selftest").status, 0);
});
