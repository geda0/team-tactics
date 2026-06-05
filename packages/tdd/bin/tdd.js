#!/usr/bin/env node
/* eslint-disable -- generated kit (CommonJS Node) */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const { TV, PKG, installTdd } = require("../index.js");
const argv = process.argv.slice(2);
let scope = null, all = false; const rest = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--scope") scope = argv[++i] || ""; else if (a === "--all") all = true; else rest.push(a); }
const READ = { log: 1, inbox: 1, conductor: 1, claims: 1, sections: 1, cycle: 1, gate: 1, "claim-check": 1 };
const KNOWN = Object.keys(READ).concat(["init", "install", "update", "selftest", "help"]);
const cmd = KNOWN.indexOf(rest[0]) !== -1 ? rest.shift() : "help";
const target = path.resolve((cmd === "inbox" ? rest[1] : (cmd === "claim-check" ? rest[2] : rest[0])) || process.cwd());
if (cmd === "log") process.exit(TV.ticsLog(target, scope, all));
if (cmd === "inbox") process.exit(TV.ticsInbox(target, rest[0], scope));
if (cmd === "conductor") process.exit(TV.ticsConductor(target, all));
if (cmd === "claims") process.exit(TV.ticsClaims(target, all));
if (cmd === "sections") process.exit(TV.ticsSections(target, all));
if (cmd === "cycle") process.exit(TV.ticsCycle(target));
if (cmd === "gate") process.exit(TV.ticsGate(target, all));
if (cmd === "claim-check") process.exit(TV.claimCheckCli(target, rest[0], rest[1] || scope || ""));
if (cmd === "selftest") process.exit(selftest());
if (cmd === "init" || cmd === "install" || cmd === "update") { installTdd(target); console.log("@ttics/tdd " + PKG.version + " installed in " + target); process.exit(0); }
console.log(fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").split("\n").slice(0, 18).join("\n")); process.exit(0);
function selftest() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-self-"));
  try {
    installTdd(d);
    fs.writeFileSync(path.join(d, ".claude", "tdd.config"), 'LAYERS="app"\nALL_TEST_CMD="true"\nTEST_CMD_app="true"\n');
    fs.writeFileSync(path.join(d, ".claude", "state", "layer"), "app\n");
    const fire = (h, p) => cp.spawnSync("bash", [path.join(d, ".claude", "hooks", h)], { input: p || "", cwd: d, encoding: "utf8" });
    const edit = (f) => JSON.stringify({ tool_input: { file_path: f } });
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "red\n");
    let ok = fire("guard-edit-scope.sh", edit("src/x.js")).status === 2 && fire("guard-edit-scope.sh", edit("tests/x.test.js")).status === 0;
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "green\n");
    ok = ok && fire("guard-edit-scope.sh", edit("tests/x.test.js")).status === 2;
    fire("run-suite.sh", "");
    const sig = (() => { try { return fs.readFileSync(path.join(d, ".claude", "state", "tics.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse).filter((x) => x.kind === "signal").length; } catch (e) { return 0; } })();
    ok = ok && sig >= 1;
    console.log(ok ? "@ttics/tdd selftest — ALL PASS (gate enforces phase×layer; run-suite emits a signal)." : "@ttics/tdd selftest — FAILED");
    return ok ? 0 : 1;
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
