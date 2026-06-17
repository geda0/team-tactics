"use strict";
// P2-11 (arg-parse hardening), P2-12 (correct-by-default seeds), + the stale "Next steps" polish.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
function run(args, cwd) { return cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() }); }

test("npx layout: the bin resolves @ttics/* siblings WITHOUT workspace symlinks (adopter install)", () => {
  // Real `npx github:geda0/team-tactics` installs the monorepo into node_modules/ttics, where the
  // @ttics/* workspaces are NOT symlinked. So the bin's require("@ttics/tics") must fall back to the
  // sibling package on disk. Reproduce that exact layout: copy packages/ with NO node_modules.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "npx-layout-"));
  try {
    fs.cpSync(path.join(__dirname, "..", ".."), path.join(tmp, "packages"),
      { recursive: true, filter: (s) => !s.includes("node_modules") });
    const bin = path.join(tmp, "packages", "team-tactics", "bin", "cli.js");
    const target = path.join(tmp, "target"); fs.mkdirSync(target);
    const r = cp.spawnSync("node", [bin, "init", target], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, "bin must resolve siblings in the npx layout (no symlinks): " + r.stderr);
    assert.ok(fs.existsSync(path.join(target, ".claude", "hooks", "tics-lib.sh")), "the kit was laid down");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("cli dispatches claim-session/claim-owner (parity with claim-check) — no silent-init on a reader subcommand", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "cli-claim-"));
  try {
    run(["init", d]);
    cp.spawnSync("bash", ["-c", '. "' + path.join(d, ".claude", "hooks", "tics-lib.sh") + '"; export TICS_SESSION=s1 TICS_SCOPE=ui/S2; emit_tic s1 "*" claim app.js app.js'], { cwd: d });
    const sess = run(["claim-session", "app.js", d]);
    assert.doesNotMatch(sess.stdout, /Installing team-tactics/, "claim-session is a recognized command, not a silent init target");
    assert.match(sess.stdout, /s1/, "claim-session reports the holding session");
    assert.match(run(["claim-owner", "app.js", d]).stdout, /ui\/S2/, "claim-owner reports the holding scope");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-11: --help prints help and does NOT install into ./--help", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run(["--help"], d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /team-tactics|TDD pairing/i, "prints help");
    assert.ok(!fs.existsSync(path.join(d, "--help")), "no ./--help dir");
    assert.ok(!fs.existsSync(path.join(d, ".claude")), "did not install");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-11: an unknown -flag errors instead of installing into a dir named after it", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run(["--bogus"], d);
    assert.notStrictEqual(r.status, 0, "should error");
    assert.match(r.stdout + r.stderr, /unknown|option|flag/i);
    assert.ok(!fs.existsSync(path.join(d, "--bogus")), "no ./--bogus dir");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("P2-12: seeded tdd-verify.yml has no active 'version:' pin (derives pnpm from packageManager)", () => {
  const yml = fs.readFileSync(path.join(require("@ttics/tdd").KIT, "ci", "tdd-verify.yml"), "utf8");
  const active = yml.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  assert.doesNotMatch(active, /version:\s*9/, "no active pnpm version pin (the deploy-staging first-run bug)");
});

test("next-steps: a fresh install no longer tells you to merge sidecars (0.4 creates none)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    const r = run([d]);
    assert.doesNotMatch(r.stdout, /sidecar/i, "no stale sidecar-merge instruction");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("0.6: README documents the AGENT quick-start — one-shot (install+bootstrap) AND the 2-step path", () => {
  const r = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
  assert.match(r, /one[- ]shot/i, "has a one-shot agent path");
  assert.match(r, /npx github:geda0\/team-tactics \./, "the one-shot tells the agent to run the (working) install itself");
  assert.match(r, /bootstrap/i, "the one-shot bootstraps, not just installs");
  assert.match(r, /two[- ]step|terminal/i, "still offers the manual/terminal 2-step path");
});

test("0.6: KICKOFF.md covers both greenfield and existing-repo adoption", () => {
  const k = fs.readFileSync(path.join(__dirname, "..", "kit", "KICKOFF.md"), "utf8");
  assert.match(k, /adopt|existing/i, "has an existing-repo adoption path");
  assert.match(k, /one[- ]shot/i, "references the one-shot");
});

test("0.8: install ships the divide-and-conquer doctrine", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const doc = path.join(d, "docs", "tdd", "divide-and-conquer.md");
    assert.ok(fs.existsSync(doc), "divide-and-conquer.md installed");
    const s = fs.readFileSync(doc, "utf8");
    assert.match(s, /divide and conquer/i); assert.match(s, /read-only|read-side/i); assert.match(s, /scope/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("0.9: install ships the tool-support (cross-tool) doc + AGENTS discloses it", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const doc = path.join(d, "docs", "tdd", "tool-support.md");
    assert.ok(fs.existsSync(doc), "tool-support.md installed");
    const s = fs.readFileSync(doc, "utf8");
    assert.match(s, /Claude Code/); assert.match(s, /Cursor/i); assert.match(s, /self-enforce|manual/i);
    assert.match(fs.readFileSync(path.join(d, "AGENTS.md"), "utf8"), /Tool support/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("0.7: install ships the tic-protocol spec + an executable tic.sh", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-cli-"));
  try {
    run([d]);
    const spec = path.join(d, "docs", "tics", "tic-protocol.md");
    assert.ok(fs.existsSync(spec), "tic-protocol.md installed");
    const s = fs.readFileSync(spec, "utf8");
    assert.match(s, /tic/i); assert.match(s, /signal/); assert.match(s, /inbox/);
    const ticsh = path.join(d, ".claude", "hooks", "tic.sh");
    assert.ok(fs.existsSync(ticsh), "tic.sh installed");
    assert.ok((fs.statSync(ticsh).mode & 0o111) !== 0, "tic.sh executable");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("S10: team-tactics meta-bin supports the tics MCP server — init installs tics-mcp.cjs (I5), and mcp-install merges .cursor/mcp.json + writes the rule WITHOUT running the full installer", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcp-"));
  try {
    const init = run(["init", d]);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(d, ".claude", "hooks", "tics-mcp.cjs")), "init installs the MCP server hook (I5)");
    const r = run(["mcp-install", d], d);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /Installing team-tactics|Next steps/i, "mcp-install must NOT fall through to the full installer");
    const cfg = JSON.parse(fs.readFileSync(path.join(d, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cfg.mcpServers && cfg.mcpServers.tics && Array.isArray(cfg.mcpServers.tics.args), "mcpServers.tics written");
    assert.ok(fs.existsSync(path.join(d, ".cursor", "rules", "tics.mdc")), "always-apply rule written");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("first-time init auto-installs the tics MCP server for Cursor (invasive default) — fresh ttics init writes .cursor/mcp.json (mcpServers.tics) + .cursor/rules/tics.mdc + surfaces the enable notice", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tt-init-mcp-"));
  try {
    const r = run(["init", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    const cfg = JSON.parse(fs.readFileSync(path.join(d, ".cursor", "mcp.json"), "utf8"));
    assert.ok(cfg.mcpServers && cfg.mcpServers.tics, "fresh init writes mcpServers.tics");
    assert.ok(Array.isArray(cfg.mcpServers.tics.args) && cfg.mcpServers.tics.args.length, "tics entry has args");
    assert.ok(fs.existsSync(path.join(d, ".cursor", "rules", "tics.mdc")), "fresh init writes the always-apply rule");
    assert.match(r.stdout, /enable|Tools & MCP|INERT|mcp/i, "init surfaces the MCP enable notice");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("MCC-2: a fresh install grants the Bash-less inner-pair agents narrow tics MCP tools (a bus voice without Bash)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mcc2-"));
  try {
    const init = run(["init", d]);
    assert.strictEqual(init.status, 0, init.stderr);
    for (const role of ["test-writer", "tdd-critic", "planner"]) {
      const md = fs.readFileSync(path.join(d, ".claude", "agents", role + ".md"), "utf8");
      const tools = (md.match(/^tools:.*$/m) || [""])[0];
      assert.match(tools, /mcp__tics__tic_emit/, role + " can emit on the bus");
      assert.match(tools, /mcp__tics__tics_inbox/, role + " can read its inbox");
      assert.match(tools, /mcp__tics__tics_review/, role + " can see open needs");
      assert.doesNotMatch(tools, /\bBash\b/, role + " stays Bash-less (narrow MCP grant, not arbitrary shell)");
    }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
