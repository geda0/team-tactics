/* eslint-disable -- generated kit (CommonJS Node) */
"use strict";
// @ttics/tics — library entrypoint. The tic protocol: the reader (TV) + a composing installer.
const fs = require("fs"), path = require("path");
const KIT = path.join(__dirname, "kit");
const PKG = require("./package.json");
const TV = require(path.join(KIT, "hooks", "tics-view.cjs"));
const MCP = require(path.join(KIT, "hooks", "tics-mcp.cjs"));

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
// Lay the tic protocol into target/.claude (+ docs + gitignore). Records into `manifest` if given.
// Returns the list of relative paths laid (so a composing installer can chmod / record them).
function installTics(target, manifest) {
  const H = path.join(target, ".claude", "hooks");
  ensureDir(H); ensureDir(path.join(target, ".claude", "state"));
  const laid = [];
  for (const f of ["tics-lib.sh", "tic.sh", "tics", "tics-view.cjs", "tics-mcp.cjs"]) { copy(path.join(KIT, "hooks", f), path.join(H, f)); laid.push(path.join(".claude", "hooks", f)); }
  for (const f of ["tics-lib.sh", "tic.sh", "tics"]) { try { fs.chmodSync(path.join(H, f), 0o755); } catch (e) {} }
  copy(path.join(KIT, "docs", "tic-protocol.md"), path.join(target, "docs", "tics", "tic-protocol.md")); laid.push(path.join("docs", "tics", "tic-protocol.md"));
  ensureGitignore(target);
  if (manifest) for (const rel of laid) manifest[rel] = { class: "mechanism", pkg: "@ttics/tics", version: PKG.version };
  return laid;
}
module.exports = { KIT, PKG, TV, installTics, ensureGitignore, postCommitHook: path.join(KIT, "githooks", "post-commit"), serve: MCP.serve, mcpInstall: MCP.mcpInstall, writeCursorRule: MCP.writeCursorRule };
