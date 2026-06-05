/* eslint-disable -- generated kit (CommonJS Node) */
"use strict";
// @ttics/tdd — test-driven agent pairing. Composes @ttics/tics (the protocol) + lays the gate.
const fs = require("fs"), path = require("path");
const tics = require("@ttics/tics");
const KIT = path.join(__dirname, "kit");
const PKG = require("./package.json");

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }
function copy(src, dest) { ensureDir(path.dirname(dest)); fs.copyFileSync(src, dest); }
function seedOnce(src, dest) { if (!fs.existsSync(dest)) copy(src, dest); }
function rec(m, rel, cls) { if (m) m[rel] = { class: cls, pkg: "@ttics/tdd", version: PKG.version }; }

// Compose-friendly: lays the pairing gate (after the tic protocol) into target. Simple installer
// for standalone adoption; team-tactics' installer sources from KIT via its non-destructive refresh.
function installTdd(target, manifest) {
  tics.installTics(target, manifest);                                   // 1) the protocol foundation
  const C = path.join(target, ".claude");
  for (const h of ["lib.sh", "guard-edit-scope.sh", "run-suite.sh", "require-green-to-stop.sh", "session-green-check.sh", "subagent-handoff.sh"]) {
    copy(path.join(KIT, "hooks", h), path.join(C, "hooks", h));
    try { fs.chmodSync(path.join(C, "hooks", h), 0o755); } catch (e) {}
    rec(manifest, path.join(".claude", "hooks", h), "mechanism");
  }
  seedOnce(path.join(KIT, "hooks", "local.d", "README.md"), path.join(C, "hooks", "local.d", "README.md"));
  for (const a of ["test-writer", "implementer", "tdd-critic", "planner"]) { copy(path.join(KIT, "agents", a + ".md"), path.join(C, "agents", a + ".md")); rec(manifest, path.join(".claude", "agents", a + ".md"), "mechanism"); }
  for (const d of ["tdd-workflow", "testing-philosophy", "conventions", "divide-and-conquer", "tool-support"]) { copy(path.join(KIT, "docs", d + ".md"), path.join(target, "docs", "tdd", d + ".md")); rec(manifest, path.join("docs", "tdd", d + ".md"), "mechanism"); }
  copy(path.join(KIT, "settings.json"), path.join(C, "settings.json"));
  for (const f of ["AGENTS.md", "CLAUDE.md"]) copy(path.join(KIT, f), path.join(target, f));
  seedOnce(path.join(KIT, "tdd.config"), path.join(C, "tdd.config"));
  for (const s of ["phase", "layer", "design-notes.md", "progress.md", "plan.md", ".gitkeep"]) seedOnce(path.join(KIT, "state", s), path.join(C, "state", s));
  seedOnce(path.join(KIT, "docs", "project-invariants.template.md"), path.join(target, "docs", "tdd", "project-invariants.md"));
  seedOnce(path.join(KIT, "ci", "tdd-verify.yml"), path.join(target, ".github", "workflows", "tdd-verify.yml"));
  return manifest;
}
module.exports = { KIT, PKG, TV: tics.TV, installTdd, installTics: tics.installTics, preCommitHook: path.join(KIT, "githooks", "pre-commit"), postCommitHook: tics.postCommitHook };
