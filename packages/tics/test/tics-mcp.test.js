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

test("S2: tools/list returns exactly the 7 tools (inbox/board/review/log/map + emit/answer) each with name+description+inputSchema; tic_emit.kind.enum excludes signal/block/commit/session", () => {
  const resp = dispatch({ jsonrpc:"2.0", id:1, method:"tools/list", params:{} }, {});
  assert.strictEqual(resp.id, 1);
  const tools = resp.result.tools;
  assert.ok(Array.isArray(tools));
  assert.deepStrictEqual(tools.map(t=>t.name).sort(),
    ["tic_emit","tics_answer","tics_board","tics_inbox","tics_log","tics_map","tics_review"].sort());
  for (const t of tools) {
    assert.ok(typeof t.name === "string" && t.name);
    assert.ok(typeof t.description === "string" && t.description);
    assert.ok(t.inputSchema && t.inputSchema.type === "object");
  }
  const emit = tools.find(t=>t.name==="tic_emit");
  assert.deepStrictEqual(emit.inputSchema.properties.kind.enum,
    ["delegate","handoff","stuck","verdict","msg","note","claim","release","contract","need","section","landmark"]);
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

test("IDENT-1: tic_emit threads an optional session onto the bus (concurrent sub-actors become distinguishable); omitted session stays empty (back-compat)", () => {
  const d = inst();
  try {
    dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"test-writer", to:"orchestrator", kind:"handoff", msg:"red confirmed", result:"red", session:"job-A" } } }, { target:d });
    dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"implementer", to:"orchestrator", kind:"handoff", msg:"green", result:"green", session:"job-B" } } }, { target:d });
    dispatch({ jsonrpc:"2.0", id:3, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"orchestrator", to:"*", kind:"note", msg:"no session here" } } }, { target:d });
    const t = ticsOf(d);
    assert.strictEqual(t.length, 3);
    assert.strictEqual(t[0].session, "job-A");
    assert.strictEqual(t[1].session, "job-B");
    assert.notStrictEqual(t[0].session, t[1].session);          // two sub-actors are distinguishable
    assert.strictEqual(t[2].session, "", "omitted session stays empty (back-compat)");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("IDENT-3: the session arg is a LABEL, not an enforcement lever — it cannot smuggle a forbidden kind, and never alters from/kind", () => {
  const d = inst();
  try {
    const before = fs.existsSync(path.join(d,".claude","state","tics.jsonl")) ? ticsOf(d).length : 0;
    for (const bad of ["signal","commit","session","block"]) {
      const r = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
        params:{ name:"tic_emit", arguments:{ from:"x", to:"*", kind:bad, msg:"forge", session:"job-X" } } }, { target:d });
      assert.strictEqual(r.result.isError, true, bad + " + a session arg must STILL be rejected");
    }
    const after = fs.existsSync(path.join(d,".claude","state","tics.jsonl")) ? ticsOf(d).length : 0;
    assert.strictEqual(after, before, "a session arg cannot smuggle a forbidden kind onto the bus");
    // a valid emit carrying a session keeps from/kind EXACTLY (session is inert wrt identity/kind)
    dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"test-writer", to:"orchestrator", kind:"handoff", msg:"ok", session:"job-X" } } }, { target:d });
    const t = ticsOf(d).filter((x) => x.session === "job-X" && x.kind === "handoff");
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].from, "test-writer");
    assert.strictEqual(t[0].kind, "handoff");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("CP-2: agents cannot self-assert a hook-only from identity (subagent/run-suite/guard/witness) — tic_emit + tic.sh reject it, write nothing; real roles still emit", () => {
  const d = inst();
  const tic = (...a) => cp.spawnSync(path.join(d,".claude","hooks","tic.sh"), a, { cwd:d, encoding:"utf8" });
  const count = () => (fs.existsSync(path.join(d,".claude","state","tics.jsonl")) ? ticsOf(d).length : 0);
  try {
    // 1. MCP path — a hook-only `from` is REFUSED even with a perfectly emittable kind (handoff).
    //    This is the GT-1 forgery: from=subagent kind=handoff is exactly the SubagentStop hook's signature.
    const before = count(); // 0
    for (const forged of ["subagent","run-suite","guard","witness"]) {
      const r = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
        params:{ name:"tic_emit", arguments:{ from:forged, to:"orchestrator", kind:"handoff", msg:"forged" } } }, { target:d });
      assert.strictEqual(r.result.isError, true, "from='" + forged + "' is a hook-only identity an agent must not self-assert");
      assert.ok(!r.error, "from='" + forged + "' is a TOOL error, never a JSON-RPC error object");
    }
    assert.strictEqual(count(), before, "a forged hook-only from shells tic.sh NEVER — bus unchanged");

    // 2. tic.sh path — the shell emit door is closed too (no MCP-only escape hatch).
    assert.notStrictEqual(tic("subagent","orchestrator","handoff","forged").status, 0,
      "tic.sh rejects from=subagent (a hook-only identity) — non-zero exit");
    assert.strictEqual(count(), before, "tic.sh wrote nothing for the forged hook-only from");

    // 3. Control — a REAL role name still emits cleanly (the reservation must not break legitimate roles).
    const ok = dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"test-writer", to:"orchestrator", kind:"handoff", msg:"real" } } }, { target:d });
    assert.ok(!ok.result.isError, callText(ok));
    const appended = ticsOf(d);
    assert.strictEqual(appended.length, before + 1, "a real role appends exactly one tic");
    assert.deepStrictEqual([appended[0].from, appended[0].kind], ["test-writer","handoff"]);
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("CP-2b: the HOOK path (emit_tic) can still emit a reserved from=subagent handoff — the reservation is on the agent doors only, not the mechanism", () => {
  // CP-2 proved the AGENT doors (tic_emit/tic.sh) reject from=subagent. But GT-1 solo-drift
  // depends on the SubagentStop hook (subagent-handoff.sh) STILL emitting from=subagent via
  // emit_tic. The reservation must live on the front doors, NOT on the mechanism — else a
  // future refactor could move RESERVED_FROM into emit_tic and silently break GT-1. Pin it.
  const d = inst();
  const libsh = path.join(d, ".claude", "hooks", "tics-lib.sh");
  const bus = path.join(d, ".claude", "state", "tics.jsonl");
  const lines = () => (fs.existsSync(bus) ? ticsOf(d) : []);
  try {
    // The hook's own door: source tics-lib.sh and call emit_tic EXACTLY as subagent-handoff.sh does.
    const r = cp.spawnSync("bash", ["-c",
      '. "' + libsh + '"; emit_tic subagent orchestrator handoff "subagent returned" ref green'],
      { cwd: d, encoding: "utf8" });
    assert.strictEqual(r.status, 0, "emit_tic exits 0 — the mechanism has no from-filter: " + r.stderr);
    const raw = fs.readFileSync(bus, "utf8");
    assert.match(raw, /"kind":"handoff"/, "the hook path appended a handoff line");
    assert.match(raw, /"from":"subagent"/, "emit_tic is NOT subject to RESERVED_FROM — from=subagent reached the bus");
    const hooked = lines().find((t) => t.kind === "handoff" && t.from === "subagent");
    assert.ok(hooked, "the appended line carries BOTH kind=handoff AND from=subagent (GT-1's countable signature)");

    // Asymmetry, documented in one place: the AGENT door still rejects the very same emission.
    const before = lines().length;
    const door = cp.spawnSync(path.join(d, ".claude", "hooks", "tic.sh"),
      ["subagent", "orchestrator", "handoff", "x"], { cwd: d, encoding: "utf8" });
    assert.notStrictEqual(door.status, 0, "tic.sh (agent door) still rejects from=subagent — non-zero exit");
    assert.strictEqual(lines().length, before, "the rejected agent-door emission appended nothing");
  } finally { fs.rmSync(d, {recursive:true,force:true}); }
});

test("CP-3a: the MCP server-entry shape is pinned exactly (.mcp.json + .cursor/mcp.json — type=stdio, server path, target arg)", () => {
  // realpath so the dir we pass equals what writeMcpServerEntry stamps into args[1] verbatim
  // (macOS /var -> /private/var symlink would otherwise diverge).
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "tics-mcp-entry-")));
  try {
    M.writeProjectMcp(tmp);
    M.writeCursorMcp(tmp);
    const surfaces = {
      ".mcp.json": path.join(tmp, ".mcp.json"),
      ".cursor/mcp.json": path.join(tmp, ".cursor", "mcp.json"),
    };
    for (const [label, file] of Object.entries(surfaces)) {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      const entry = json.mcpServers.tics;
      assert.strictEqual(entry.type, "stdio", label + ": launches over stdio");
      assert.ok(typeof entry.command === "string" && entry.command.length > 0,
        label + ": command is a non-empty string");
      assert.ok(Array.isArray(entry.args), label + ": args is an array");
      assert.ok(entry.args[0].endsWith(path.join(".claude", "hooks", "tics-mcp.cjs")),
        label + ": args[0] points at the kit-installed tics-mcp.cjs");
      assert.strictEqual(entry.args[1], tmp, label + ": args[1] is the resolved target dir");
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("CTX-1: landmark is an agent-emittable kind — tic.sh and MCP tic_emit both append a landmark crumb", () => {
  // A `landmark` crumb is the recall breadcrumb for a new context layer:
  //   kind=landmark, ref=<path/area>, result=<crumb type: landmark|route|caveat>, msg=<recall sentence>.
  // Both emit doors must accept it — the MCP tic_emit and the Bash tic.sh.
  const d = inst();
  const tic = (...a) => cp.spawnSync(path.join(d, ".claude", "hooks", "tic.sh"), a, { cwd: d, encoding: "utf8" });
  const count = () => (fs.existsSync(path.join(d, ".claude", "state", "tics.jsonl")) ? ticsOf(d).length : 0);
  try {
    // 1. MCP door — a navigator drops a landmark crumb; not an isError, appends exactly one tic
    //    carrying kind/ref/result/msg verbatim (modeled on the CP-2 real-role control + S4b ref/result).
    const before = count(); // 0
    const ok = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"*", kind:"landmark",
        msg:"rankFeed() is the entry point", ref:"backend/src/feed/rank.ts", result:"landmark" } } }, { target:d });
    assert.ok(!ok.result.isError, callText(ok));
    const appended = ticsOf(d);
    assert.strictEqual(appended.length, before + 1, "the MCP door appends exactly one landmark crumb");
    assert.deepStrictEqual(
      [appended[0].kind, appended[0].ref, appended[0].result, appended[0].msg],
      ["landmark", "backend/src/feed/rank.ts", "landmark", "rankFeed() is the entry point"]);

    // 2. Bash door — tic.sh accepts landmark too (no MCP-only escape hatch); exits 0, appends one
    //    crumb with kind=landmark result=caveat (the recall sentence + crumb type land on the tic).
    const r = tic("navigator", "*", "landmark", "rank.ts mutates its input — clone first", "backend/src/feed/rank.ts", "caveat");
    assert.strictEqual(r.status, 0, "tic.sh accepts landmark — exit 0 (stderr: " + r.stderr + ")");
    assert.strictEqual(count(), before + 2, "the Bash door appends a second landmark crumb");
    const crumb = ticsOf(d).pop();
    assert.deepStrictEqual([crumb.kind, crumb.result], ["landmark", "caveat"]);

    // 3. Sanity — landmark is in the exported allow-list (the source of truth both doors honor).
    assert.notStrictEqual(M.EMITTABLE_KINDS.indexOf("landmark"), -1,
      "landmark is a first-class agent-emittable kind");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CTX-7: tics_map MCP tool returns the context map (and where/how by arg) — read-only, portable pull", () => {
  // Cursor agents (any MCP client) must be able to PULL the learned context map over MCP, the same
  // way `tics map`/`tics where`/`tics how` pull it from the shell. tics_map is a read-only reader
  // tool (like tics_board/tics_log): no path/task -> the whole map (ticsLandmarks); path -> where;
  // task -> how. Returns the reader text as tool content, never isError.
  const d = inst();
  try {
    // Seed the bus with two landmark crumbs via the emit door (kind=landmark is agent-emittable, CTX-1):
    //   a landmark on a concrete path, and a route keyed area:auth.
    dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"*", kind:"landmark",
        msg:"rankFeed is the entry point", ref:"backend/src/feed/rank.ts", result:"landmark" } } }, { target:d });
    dispatch({ jsonrpc:"2.0", id:2, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"navigator", to:"*", kind:"landmark",
        msg:"rotate the auth secret via scripts/rotate", ref:"area:auth", result:"route" } } }, { target:d });

    // 1. No args -> the whole map (ticsLandmarks). Not isError; carries the landmark crumb.
    const whole = dispatch({ jsonrpc:"2.0", id:3, method:"tools/call",
      params:{ name:"tics_map", arguments:{} } }, { target:d });
    assert.ok(!whole.result.isError, callText(whole));
    assert.match(callText(whole), /rankFeed is the entry point/);

    // 2. path arg -> where-filtered to the path (ticsWhere). The path-keyed landmark shows; the
    //    area:auth route does NOT overlap this path, so it is excluded.
    const where = dispatch({ jsonrpc:"2.0", id:4, method:"tools/call",
      params:{ name:"tics_map", arguments:{ path:"backend/src/feed/rank.ts" } } }, { target:d });
    assert.ok(!where.result.isError, callText(where));
    assert.match(callText(where), /rankFeed is the entry point/);
    assert.doesNotMatch(callText(where), /rotate the auth secret/);

    // 3. task arg -> how-filtered to result=route crumbs matching the task term (ticsHow).
    const how = dispatch({ jsonrpc:"2.0", id:5, method:"tools/call",
      params:{ name:"tics_map", arguments:{ task:"auth" } } }, { target:d });
    assert.ok(!how.result.isError, callText(how));
    assert.match(callText(how), /rotate the auth secret/);

    // 4. The descriptor is registered — tics_map appears in tools/list.
    const list = dispatch({ jsonrpc:"2.0", id:6, method:"tools/list", params:{} }, { target:d });
    assert.ok(Array.isArray(list.result.tools));
    assert.ok(list.result.tools.map((t) => t.name).indexOf("tics_map") !== -1,
      "tics_map is a registered read-only tool");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CP-3b: cross-surface honesty guard — the Cursor rule's hook-only-kind + from=subagent claims still match the code", () => {
  // (a) The rule tells Cursor agents they cannot emit signal/block/commit. If one became
  //     agent-emittable, that claim would silently lie — pin it against the real allow-list.
  for (const hookOnly of ["signal", "block", "commit"]) {
    assert.strictEqual(M.EMITTABLE_KINDS.indexOf(hookOnly), -1,
      "'" + hookOnly + "' must stay hook-only — not agent-emittable");
  }
  // (b) GT-1's solo-drift signal stays unforgeable: from=subagent is reserved. RESERVED_FROM is
  //     not exported, so assert via behavior (the CP-2 pattern): tic_emit rejects it, writes nothing.
  const d = inst();
  try {
    const before = fs.existsSync(path.join(d, ".claude", "state", "tics.jsonl")) ? ticsOf(d).length : 0;
    const r = dispatch({ jsonrpc:"2.0", id:1, method:"tools/call",
      params:{ name:"tic_emit", arguments:{ from:"subagent", to:"orchestrator", kind:"handoff", msg:"forged" } } }, { target:d });
    assert.strictEqual(r.result.isError, true, "from=subagent is a hook-only identity an agent must not self-assert");
    const after = fs.existsSync(path.join(d, ".claude", "state", "tics.jsonl")) ? ticsOf(d).length : 0;
    assert.strictEqual(after, before, "a forged from=subagent never reaches the bus");
    // (c) The generated rule body carries the ADR 0024 host-dependent contract (W1/W2/W4/W10),
    //     NOT the falsified 'referee does not run in Cursor' absolute.
    const ruleFile = M.writeCursorRule(d);
    const rule = fs.readFileSync(ruleFile, "utf8");
    // W1 — no host-absolute, in either direction (the false 'does NOT run in Cursor' is gone).
    assert.doesNotMatch(rule, /does NOT run in Cursor|not run in Cursor|does not run Claude Code's|do not run Claude Code's|the phase referee is gone|irreducibly Claude-Code-only|irreducibly CC-only|CC-only/i,
      "W1: no host-absolute survives in the rule body");
    // W1 (positive clause) — must not flip to the OPPOSITE false absolute either (the ADR's "same mistake at
    // a different sign"). Any claim the hooks DO run in Cursor must be hedged; unhedged positives forbidden.
    assert.doesNotMatch(rule, /Cursor runs the hooks|the referee runs in Cursor|hooks (do |)run in Cursor|Cursor (always|never) runs|always unrefereed/i,
      "W1: no UNHEDGED positive absolute about Cursor");
    // W2 — the enforcement boundary is stated as host-dependent.
    assert.match(rule, /host-dependent/, "W2: the rule states host-dependence");
    // W4 — the mechanical probe: a hook-signed run-suite/guard tic vs a self-reported one.
    assert.match(rule, /run-suite|guard/, "W4: the probe cites the reserved hook identity");
    assert.match(rule, /hook-signed/, "W4: the rule names the hook-signed classification");
    assert.match(rule, /unrefereed|self-reported/i, "the unrefereed/self-reported honesty claim survives");
    // W10 — single-source: point to tool-support.md for the enforcement detail, don't restate it.
    assert.match(rule, /tool-support\.md/, "W10: the rule points to docs/tdd/tool-support.md");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
