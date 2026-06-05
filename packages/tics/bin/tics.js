#!/usr/bin/env node
/* eslint-disable -- generated kit reader (CommonJS Node) */
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process");
const KIT = path.join(__dirname, "..", "kit");
const TV = require(path.join(KIT, "hooks", "tics-view.cjs"));
const PKG = require("../package.json");

const argv = process.argv.slice(2);
let scope = null, all = false; const rest = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === "--scope") scope = argv[++i] || ""; else if (a === "--all") all = true; else rest.push(a); }
const KNOWN = ["log", "inbox", "conductor", "claims", "sections", "cycle", "gate", "claim-check", "init", "install", "update", "selftest", "help"];
const cmd = KNOWN.indexOf(rest[0]) !== -1 ? rest.shift() : "help";
const role = cmd === "inbox" ? rest.shift() : null;
const cfFile = cmd === "claim-check" ? rest.shift() : null;
const cfScope = cmd === "claim-check" ? (rest.shift() || scope || "") : null;
const target = path.resolve(rest[0] || process.cwd());

if (cmd === "log") process.exit(TV.ticsLog(target, scope, all));
if (cmd === "inbox") process.exit(TV.ticsInbox(target, role, scope));
if (cmd === "conductor") process.exit(TV.ticsConductor(target, all));
if (cmd === "claims") process.exit(TV.ticsClaims(target, all));
if (cmd === "sections") process.exit(TV.ticsSections(target, all));
if (cmd === "cycle") process.exit(TV.ticsCycle(target));
if (cmd === "gate") process.exit(TV.ticsGate(target, all));
if (cmd === "claim-check") process.exit(TV.claimCheckCli(target, cfFile, cfScope));
if (cmd === "selftest") process.exit(selftest(target));
if (cmd === "init" || cmd === "install" || cmd === "update") { installTics(target); console.log("@ttics/tics " + PKG.version + " installed in " + target); process.exit(0); }
console.log(fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8").split("\n").slice(0, 24).join("\n"));
process.exit(0);

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function copy(src, dest) { ensureDir(path.dirname(dest)); fs.copyFileSync(src, dest); }
function ensureGitignore(target) {
  const gi = path.join(target, ".gitignore");
  const START = "# >>> @ttics/tics (managed) >>>", END = "# <<< @ttics/tics (managed) <<<";
  const block = START + "\n.claude/state/suite-status\n.claude/state/telemetry.jsonl\n.claude/state/tics.jsonl\n.claude/state/tics.d/\n" + END + "\n";
  let cur = ""; try { cur = fs.readFileSync(gi, "utf8"); } catch (e) {}
  if (cur.indexOf(START) !== -1) return;
  fs.writeFileSync(gi, cur + (cur && !cur.endsWith("\n") ? "\n" : "") + block);
}
// Compose-friendly: lays the tic protocol into target/.claude; records into `manifest` if given.
function installTics(target, manifest) {
  const H = path.join(target, ".claude", "hooks");
  ensureDir(H); ensureDir(path.join(target, ".claude", "state"));
  const laid = [];
  for (const f of ["tics-lib.sh", "tic.sh", "tics", "tics-view.cjs"]) { copy(path.join(KIT, "hooks", f), path.join(H, f)); laid.push(path.join(".claude", "hooks", f)); }
  for (const f of ["tics-lib.sh", "tic.sh", "tics"]) { try { fs.chmodSync(path.join(H, f), 0o755); } catch (e) {} }
  copy(path.join(KIT, "docs", "tic-protocol.md"), path.join(target, "docs", "tics", "tic-protocol.md")); laid.push(path.join("docs", "tics", "tic-protocol.md"));
  ensureGitignore(target);
  if (manifest) for (const rel of laid) manifest[rel] = { class: "mechanism", pkg: "@ttics/tics", version: PKG.version };
  return laid;
}
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
module.exports = { installTics };
