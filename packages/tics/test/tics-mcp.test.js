"use strict";
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const BIN = path.join(__dirname, "..", "bin", "tics.js");
const M = require(path.join(__dirname, "..", "kit", "hooks", "tics-mcp.cjs"));
const { dispatch } = M;

// Fresh installed workspace in a temp dir (verbatim from tics.test.js): a real `.claude/`
// with hooks + state, so dispatch() reads/writes a genuine bus. TIC_STORE=jsonl so ticsOf reads tics.jsonl.
function inst(store) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tics-t-"));
  cp.spawnSync("node", [BIN, "init", d], { encoding: "utf8" });
  fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'TIC_STORE="' + (store || "jsonl") + '"\n');
  fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "off\n");
  fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
  return d;
}
const ticsOf = (d) => fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const callText = (resp) => (resp.result && resp.result.content && resp.result.content[0] && resp.result.content[0].text) || "";
const TS = "2026-06-16T00:00:00Z";

// ── behavioral tests are appended below, ONE per red slice (test-writer) ──

test("S1: initialize negotiates protocolVersion (echoes a supported revision; falls back to latest for unknown/absent) + serverInfo + capabilities.tools", () => {
  // A: supported latest -> echoed
  const a = dispatch({ jsonrpc:"2.0", id:1, method:"initialize",
    params:{ protocolVersion:"2025-11-25", capabilities:{}, clientInfo:{name:"cursor",version:"x"} } }, {});
  assert.strictEqual(a.jsonrpc, "2.0"); assert.strictEqual(a.id, 1);
  assert.strictEqual(a.result.protocolVersion, "2025-11-25");
  assert.strictEqual(a.result.serverInfo.name, "tics");
  assert.ok(a.result.serverInfo.version);                       // package version, truthy
  assert.deepStrictEqual(a.result.capabilities.tools, {});      // tools-only, empty object
  // B: supported-older -> echoed (handshakes cleanly, NOT rejected)
  const b = dispatch({ jsonrpc:"2.0", id:2, method:"initialize", params:{ protocolVersion:"2025-06-18" } }, {});
  assert.strictEqual(b.id, 2); assert.strictEqual(b.result.protocolVersion, "2025-06-18"); assert.ok(!b.error);
  // C: unknown/future -> latest, NOT echoed
  const c = dispatch({ jsonrpc:"2.0", id:3, method:"initialize", params:{ protocolVersion:"2099-01-01" } }, {});
  assert.strictEqual(c.result.protocolVersion, "2025-11-25");
  // D: absent protocolVersion -> latest, no crash
  const e = dispatch({ jsonrpc:"2.0", id:4, method:"initialize", params:{} }, {});
  assert.strictEqual(e.result.protocolVersion, "2025-11-25");
});

test("S2: tools/list returns exactly the 6 tools (inbox/board/review/log + emit/answer) each with name+description+inputSchema; tic_emit.kind.enum excludes signal/block/commit/session", () => {
  const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/list", params:{} }, {});
  assert.strictEqual(resp.id, 1);
  const tools = resp.result.tools;
  assert.ok(Array.isArray(tools));
  assert.deepStrictEqual(tools.map(t=>t.name).sort(),
    ["tic_emit","tics_answer","tics_board","tics_inbox","tics_log","tics_review"].sort());
  for (const t of tools) {
    assert.ok(typeof t.name === "string" && t.name);
    assert.ok(typeof t.description === "string" && t.description);
    assert.ok(t.inputSchema && t.inputSchema.type === "object");
  }
  const emit = tools.find(t=>t.name==="tic_emit");
  assert.deepStrictEqual(emit.inputSchema.properties.kind.enum,
    ["delegate","handoff","stuck","verdict","msg","note","claim","release","contract","need","section"]);
});

test("S4: tic_emit shells tic.sh for an agent-emittable kind (handoff appends ONE tic) BUT rejects signal/block/commit/session with isError and writes NOTHING (honesty boundary, ADR §3)", () => {
  const d = inst();
  try {
    // Positive: handoff shells tic.sh, appends exactly one tic with given from/to/kind.
    const ok = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"architect", kind:"handoff", msg:"ready for review", ref:"S2" } } }, { target:d });
    assert.ok(!ok.result.isError, callText(ok));
    const appended = ticsOf(d);
    assert.strictEqual(appended.length, 1);
    assert.deepStrictEqual([appended[0].kind, appended[0].from, appended[0].to], ["handoff","navigator","architect"]);
    // Negative (the boundary): each excluded kind -> isError RESULT, NOT a protocol error, bus UNCHANGED.
    const before = ticsOf(d).length; // 1
    for (const bad of ["signal","block","commit","session"]) {
      const r = dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
        params:{ name:"tic_emit", arguments:{ from:"navigator", to:"*", kind:bad, msg:"forge attempt" } } }, { target:d });
      assert.strictEqual(r.result.isError, true, bad + " must be an isError result");
      assert.ok(!r.error, bad + " is a TOOL error, never a JSON-RPC error object");
      assert.match(callText(r), new RegExp(bad+"|hook|excluded|not allowed|forbidden|emittable", "i"));
    }
    assert.strictEqual(ticsOf(d).length, before, "excluded kinds shell tic.sh NEVER — bus unchanged");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("I7: tic_emit passes msg verbatim to tic.sh (args-array execFileSync — no shell interpretation of redirects, semicolons, command-substitution, or pipes)", () => {
  const d = inst();
  try {
    const evil = "a > b = c -> d; $(touch PWNED) | tee /tmp/x";
    const r = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"architect", kind:"note", msg:evil } } }, { target:d });
    assert.ok(!r.result.isError, callText(r));
    const t = ticsOf(d);
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].msg, evil);                       // verbatim — no shell touched it
    assert.ok(!fs.existsSync(path.join(d, "PWNED")), "command-substitution must NOT have executed");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S3a: tools/call tics_inbox captures the reader's inbox for the role (tics addressed to it or broadcast); excludes tics for other roles", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d,".claude","state","tics.jsonl"),
      JSON.stringify({kind:"delegate",from:"orchestrator",to:"architect",msg:"slice S2",ref:"S2",scope:"*",seq:1,ts:TS})+"\n"+
      JSON.stringify({kind:"note",from:"x",to:"someone-else",msg:"not yours",scope:"*",seq:2,ts:TS})+"\n");
    const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tics_inbox", arguments:{ role:"architect" } } }, { target:d });
    const text = callText(resp);
    assert.ok(!resp.result.isError);
    assert.match(text, /Inbox for architect/);
    assert.match(text, /slice S2/);
    assert.doesNotMatch(text, /not yours/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S3b: tools/call tics_board captures the fleet board; the scope holder is grouped under its held scope", () => {
  const d = inst();
  try {
    const srcLib = (s) => cp.spawnSync("bash", ["-c", '. "'+path.join(d,".claude","hooks","tics-lib.sh")+'"; '+s], {encoding:"utf8", cwd:d});
    srcLib("export TICS_SESSION='sessA'; export TICS_SCOPE='auth/S1'; emit_tic a '*' claim login.ts login.ts");
    const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tics_board", arguments:{} } }, { target:d });
    const text = callText(resp);
    assert.ok(!resp.result.isError);
    assert.match(text, /Fleet board/);
    assert.match(text, /auth\/S1/);
    assert.match(text, /sessA/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S3c: tools/call tics_review captures the open-needs queue; lists the open need by its ref handle and the question text", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d,".claude","state","tics.jsonl"),
      JSON.stringify({kind:"need",from:"guard",to:"*",scope:"auth/S1",ref:"app/login.ts",msg:"claim conflict on app/login.ts",seq:1,ts:TS})+"\n");
    const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tics_review", arguments:{} } }, { target:d });
    const text = callText(resp);
    assert.ok(!resp.result.isError);
    assert.match(text, /Open needs/);
    assert.match(text, /app\/login\.ts/);
    assert.match(text, /claim conflict/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S3d: tools/call tics_log captures the thread and passes showWitness=false — from=witness notes are excluded (ADR §2)", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d,".claude","state","tics.jsonl"),
      JSON.stringify({kind:"note",from:"witness",to:"*",msg:"used Read",scope:"*",seq:1,ts:TS})+"\n"+
      JSON.stringify({kind:"delegate",from:"orchestrator",to:"test-writer",msg:"slice S2",ref:"S2",scope:"*",seq:2,ts:TS})+"\n");
    const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tics_log", arguments:{} } }, { target:d });
    const text = callText(resp);
    assert.ok(!resp.result.isError);
    assert.match(text, /slice S2/);
    assert.doesNotMatch(text, /used Read/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S5: tics_answer wraps ticsAnswer — answering an open handle emits a msg+answered to the asker, settles the need (leaves the open queue)", () => {
  const d = inst();
  try {
    fs.writeFileSync(path.join(d,".claude","state","tics.jsonl"),
      JSON.stringify({kind:"need",from:"test-writer",to:"architect",scope:"auth/S1",ref:"app/login.ts",msg:"which error contract?",seq:1,ts:TS})+"\n");
    const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tics_answer", arguments:{ handle:"app/login.ts", text:"use the AuthError contract", from:"navigator" } } }, { target:d });
    assert.ok(!resp.result.isError, callText(resp));
    const settled = ticsOf(d).filter(x => x.kind==="msg" && x.result==="answered");
    assert.strictEqual(settled.length, 1);
    assert.strictEqual(settled[0].to, "test-writer");
    assert.strictEqual(settled[0].ref, "app/login.ts");
    assert.match(settled[0].msg, /use the AuthError contract/);
    const review = dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
      params:{ name:"tics_review", arguments:{} } }, { target:d });
    assert.doesNotMatch(callText(review), /app\/login\.ts/);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S6: error channels — unknown method/unknown tool/missing jsonrpc -> JSON-RPC error object (never a crash); an underlying tool failure -> isError result; notification -> null; a garbage line -> handleLine returns a -32700 error frame", () => {
  const d = inst();
  try {
    // Protocol: unknown method -> error object, no result.
    const m = dispatch({ jsonrpc:"2.0", id:1, method:"no/such/method", params:{} }, { target:d });
    assert.ok(m.error && typeof m.error.code === "number" && m.error.message);
    assert.ok(!m.result);
    // Protocol: unknown TOOL name -> error object.
    const u = dispatch({ jsonrpc:"2.0", id:2, method:"tools/call", params:{ name:"tics_nonexistent", arguments:{} } }, { target:d });
    assert.ok(u.error && typeof u.error.code === "number");
    // Protocol: missing jsonrpc -> error object (-32600).
    const j = dispatch({ method:"tools/list", id:3, params:{} }, { target:d });
    assert.ok(j.error && j.error.code === -32600);
    // Tool-level: a known tool whose required arg is missing -> isError RESULT (not a protocol error).
    const t = dispatch({ jsonrpc:"2.0", id:4, method:"tools/call", params:{ name:"tics_inbox", arguments:{} } }, { target:d });
    assert.ok(!t.error);
    assert.strictEqual(t.result.isError, true);
    // Notification (no id) -> null.
    assert.strictEqual(dispatch({ jsonrpc:"2.0", method:"notifications/initialized" }, { target:d }), null);
    // Malformed JSON line via the exported line handler -> a -32700 error frame object, never a throw.
    const p = M.handleLine("{not json", M.makeCtx({ target:d }));
    assert.ok(p && p.error && p.error.code === -32700);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("I1: zero runtime deps — @ttics/tics declares no dependencies and tics-mcp.cjs imports no third-party package", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, "no runtime dependencies key");
  const src = fs.readFileSync(path.join(__dirname, "..", "kit", "hooks", "tics-mcp.cjs"), "utf8");
  assert.doesNotMatch(src, /@modelcontextprotocol|require\(\s*['"](zod|ajv|express|hono|jose|cors)['"]/, "no MCP SDK / third-party deps");
  const lits = src.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || [];
  for (const l of lits) {
    const name = l.replace(/.*['"]([^'"]+)['"].*/, "$1");
    assert.ok(["fs","path","child_process"].indexOf(name) !== -1, "non-builtin static require: " + name);
  }
});

test("I4: tic_emit introduces NO new bus field — MCP wire fields do not leak into the emitted tic; core fields present", () => {
  const d = inst();
  try {
    dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"architect", kind:"handoff", msg:"m", ref:"R" } } }, { target:d });
    const t = ticsOf(d)[0];
    for (const leak of ["arguments","name","jsonrpc","id","method","params"]) assert.ok(!(leak in t), "MCP field leaked into bus: " + leak);
    for (const f of ["from","to","kind","msg","seq","ts"]) assert.ok(f in t, "missing core field: " + f);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("I3b: tic_emit's enum is a closed ALLOW-list — an arbitrary unknown kind is rejected, not just the four hook kinds", () => {
  const d = inst();
  try {
    const before = fs.existsSync(path.join(d,".claude","state","tics.jsonl")) ? ticsOf(d).length : 0;
    for (const bad of ["frobnicate", "SIGNAL", "signal ", "deploy"]) {
      const r = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
        params:{ name:"tic_emit", arguments:{ from:"a", to:"*", kind:bad, msg:"x" } } }, { target:d });
      assert.strictEqual(r.result.isError, true, bad + " must be rejected by the allow-list");
      assert.ok(!r.error, bad + " is a tool error, not a protocol error");
    }
    const after = fs.existsSync(path.join(d,".claude","state","tics.jsonl")) ? ticsOf(d).length : 0;
    assert.strictEqual(after, before, "no tic written for any rejected kind");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("S4b: tic_emit forwards ref and result positionally to tic.sh — both land on the emitted tic", () => {
  const d = inst();
  try {
    dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"architect", kind:"verdict", msg:"looks good", ref:"S5", result:"pass" } } }, { target:d });
    const t = ticsOf(d).filter((x) => x.kind === "verdict");
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].ref, "S5");
    assert.strictEqual(t[0].result, "pass");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});
