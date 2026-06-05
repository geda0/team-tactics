#!/usr/bin/env node
/* eslint-disable -- generated kit reader (CommonJS Node) */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const { TV, PKG, installTics } = require("../index.js");

const argv = process.argv.slice(2);
let scope = null, all = true; const rest = [];   // whole-picture by default (merge every worktree's bus); --here restricts to the local bus
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--scope") scope = argv[++i] || ""; else if (a === "--all") all = true; else if (a === "--here") all = false; else rest.push(a); }
const KNOWN = ["log", "inbox", "conductor", "claims", "sections", "sessions", "todo", "cycle", "gate", "claim-check", "init", "install", "update", "selftest", "help"];
const cmd = KNOWN.indexOf(rest[0]) !== -1 ? rest.shift() : "help";
const role = cmd === "inbox" ? rest.shift() : null;
const cfFile = cmd === "claim-check" ? rest.shift() : null;
const cfScope = cmd === "claim-check" ? (rest.shift() || scope || "") : null;
const tdSession = cmd === "todo" ? rest.shift() : null;
const target = path.resolve(rest[0] || process.cwd());

if (cmd === "log") process.exit(TV.ticsLog(target, scope, all));
if (cmd === "inbox") process.exit(TV.ticsInbox(target, role, scope));
if (cmd === "conductor") process.exit(TV.ticsConductor(target, all));
if (cmd === "claims") process.exit(TV.ticsClaims(target, all));
if (cmd === "sections") process.exit(TV.ticsSections(target, all));
if (cmd === "sessions") process.exit(TV.ticsSessions(target, all));
if (cmd === "todo") process.exit(TV.ticsTodo(target, tdSession));
if (cmd === "cycle") process.exit(TV.ticsCycle(target));
if (cmd === "gate") process.exit(TV.ticsGate(target, all));
if (cmd === "claim-check") process.exit(TV.claimCheckCli(target, cfFile, cfScope));
if (cmd === "selftest") process.exit(selftest(target));
if (cmd === "init" || cmd === "install" || cmd === "update") { installTics(target); console.log("@ttics/tics " + PKG.version + " installed in " + target); process.exit(0); }
console.log(fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").split("\n").slice(0, 24).join("\n"));
process.exit(0);

function selftest(target) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tics-self-"));
  try {
    installTics(d);
    fs.writeFileSync(path.join(d, ".claude", "state", "phase"), "off\n");
    const e = cp.spawnSync(path.join(d, ".claude", "hooks", "tic.sh"), ["a", "b", "note", "selftest-hello"], { cwd: d, encoding: "utf8" });
    if (e.status !== 0) { console.error("tics selftest FAILED: emit exit " + e.status + "\n" + e.stderr); return 1; }
    const r = cp.spawnSync(path.join(d, ".claude", "hooks", "tics"), ["log"], { cwd: d, encoding: "utf8" });
    if (!/selftest-hello/.test(r.stdout)) { console.error("tics selftest FAILED: reader didn't show the tic\n" + r.stdout + r.stderr); return 1; }
    console.log("tics selftest — ALL PASS (emit + read round-trip).");
    return 0;
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}
