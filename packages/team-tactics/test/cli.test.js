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

test("GI-1: the managed .gitignore ignores the machine-specific MCP configs (.mcp.json + .cursor/mcp.json)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gi1-"));
  try {
    const r = run(["init", d]);
    assert.strictEqual(r.status, 0, r.stderr);
    const gi = fs.readFileSync(path.join(d, ".gitignore"), "utf8");
    const block = gi.slice(gi.indexOf(">>> team-tactics"), gi.indexOf("<<< team-tactics"));
    assert.match(block, /(^|\/)\.mcp\.json\s*$/m, ".mcp.json is gitignored in the managed block");
    assert.match(block, /\.cursor\/mcp\.json/, ".cursor/mcp.json is gitignored in the managed block");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("CP-1b: update refreshes a stale MANAGED .cursor/rules/tics.mdc, never clobbers a foreign rule, never creates it on update", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cp1b-"));
  const ruleFile = path.join(target, ".cursor", "rules", "tics.mdc");
  try {
    // Fresh install lays the Cursor rule down (mcpInstall fires on first-time init only).
    const init = run(["init", target]);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(ruleFile), "fresh init writes the managed Cursor rule");

    // (1) Refresh a STALE-but-managed rule on update. Keep the managed sentinel, strip the body
    //     (crucially no AGENTS.md / install-hooks). The manifest exists now, so run([target]) is an UPDATE.
    fs.writeFileSync(ruleFile, "<!-- team-tactics: managed -->\nstale old rule\n");
    const upd1 = run([target]);
    assert.strictEqual(upd1.status, 0, upd1.stderr);
    const refreshed = fs.readFileSync(ruleFile, "utf8");
    assert.match(refreshed, /AGENTS\.md/, "update refreshed the stale managed rule back to current kit content");
    assert.match(refreshed, /install-hooks/, "the refreshed rule carries the current install-hooks recommendation");

    // (2) Never clobber a FOREIGN rule (no managed sentinel) — it must survive byte-for-byte.
    const foreign = "my own cursor rule, hands off\n";
    fs.writeFileSync(ruleFile, foreign);
    const upd2 = run([target]);
    assert.strictEqual(upd2.status, 0, upd2.stderr);
    const after = fs.readFileSync(ruleFile, "utf8");
    assert.strictEqual(after, foreign, "a foreign rule is left untouched");
    assert.match(after, /hands off/);
    assert.doesNotMatch(after, /AGENTS\.md/, "the foreign rule was not overwritten with kit content");

    // (3) Never CREATE the rule on update when absent — the Cursor surface stays a fresh-init opt-in.
    fs.rmSync(ruleFile);
    const upd3 = run([target]);
    assert.strictEqual(upd3.status, 0, upd3.stderr);
    assert.ok(!fs.existsSync(ruleFile), "update does not force-install the Cursor rule when it is absent");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("CP-1c: update recognizes the kit's own HISTORICAL rule bodies (pre-0.61, no sentinel) as managed and refreshes them; a genuinely foreign rule still survives byte-for-byte", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "cp1c-"));
  const ruleFile = path.join(target, ".cursor", "rules", "tics.mdc");

  // Historical kit rule bodies — BYTE-EXACT, captured by executing each generation's writeCursorRule
  // (packages/tics/kit/hooks/tics-mcp.cjs) at its commit: v0.55 = a760095, v0.58 = 3f2ac88 (v0.57's 32d205b
  // is identical to v0.58), v0.61 = 4930883 (v0.62-0.67's 5fe9759 differs only by an added crumbs bullet).
  // Pre-0.61 bodies never carried the `team-tactics: managed` sentinel — that gap is this test's point.
  const bodyV055 = "---\nalwaysApply: true\n---\n\n# tics — coordinate on the shared bus (convention, not a gate)\n\nYou participate in a shared team-tactics coordination bus via the tics MCP tools.\nEach turn:\n- Call `tics_inbox` (your role) and `tics_board` to see what is addressed to you and the fleet state.\n- Check `tics_review` for open needs you can answer; settle one with `tics_answer`.\n- Contribute honestly with `tic_emit` (handoff/need/verdict/note/claim/etc.).\n\nThe ceiling, stated plainly: this is a **convention, not a gate**. The phase x layer TDD referee\n**does not run in Cursor** — nothing here forces these calls. Emit truthfully: the bus is shared with an\nenforced Claude Code fleet, and your contributions are classified as **unrefereed** (self-reported), never\nas hook-signed. You cannot emit signal/block/commit (hook-only kinds).\n";

  const bodyV058 = "---\nalwaysApply: true\n---\n\n# tics — coordinate on the shared bus (convention, not a gate)\n\nYou participate in a shared team-tactics coordination bus via the tics MCP tools.\nEach turn:\n- Call `tics_inbox` (your role) and `tics_board` to see what is addressed to you and the fleet state.\n- Check `tics_review` for open needs you can answer; settle one with `tics_answer`.\n- Contribute honestly with `tic_emit` (handoff/need/verdict/note/claim/etc.).\n- If you spawn sub-actors / background jobs (one per role or slice), give EACH a **distinct `session`** and pass it on every `tic_emit` (the optional `session` arg) — otherwise they all merge into one indistinguishable actor on the bus (`session=\"\"`). A self-set `session` is provenance, not authentication, just like `from`.\n\nThe ceiling, stated plainly: this is a **convention, not a gate**. The phase x layer TDD referee\n**does not run in Cursor** — nothing here forces these calls. Emit truthfully: the bus is shared with an\nenforced Claude Code fleet, and your contributions are classified as **unrefereed** (self-reported), never\nas hook-signed. You cannot emit signal/block/commit (hook-only kinds).\n";

  const sentinelLine =
    "<!-- team-tactics: managed rule — refreshed by `ttics update`. Edit the method in AGENTS.md, not here. -->\n";
  const bodyV061WithSentinel = "---\nalwaysApply: true\n---\n<!-- team-tactics: managed rule — refreshed by `ttics update`. Edit the method in AGENTS.md, not here. -->\n\n# tics — coordinate on the shared bus (Cursor)\n\n**The method lives in `AGENTS.md`** (then `docs/tdd/tdd-workflow.md` + `docs/tdd/tool-support.md`) — that is the canonical TDD\nprotocol (red->green->refactor, phase x layer scope, the roles). Read it. This rule only covers the bus and what\nenforcement you do and do not get in Cursor.\n\nEach turn, coordinate on the shared tics bus via the MCP tools:\n- Call `tics_inbox` (your role) and `tics_board` for what is addressed to you + fleet state; check `tics_review` and settle one open need with `tics_answer`.\n- Contribute honestly with `tic_emit` (handoff/need/verdict/note/claim). You cannot emit signal/block/commit (hook-only kinds), and your contributions are classified **unrefereed** (self-reported), never hook-signed.\n- Spawning sub-actors? Give EACH a distinct `session` and pass it on every `tic_emit` — otherwise they merge into one indistinguishable actor (`session=\"\"`). A self-set `session` is provenance, not authentication, just like `from`.\n\n**Enforcement, stated plainly — this is a convention, not a gate here.** The Claude Code referee — the phase x layer edit\ngate, the **security-surface guard** (it blocks auth/secret/CORS edits), green-bar signing, and no-finish-on-red — **does\nNOT run in Cursor**; nothing here forces these calls, so self-enforce per the checklist in `docs/tdd/tool-support.md`. The\none mechanical gate you CAN have: run **`npx tics install-hooks`** once — it installs git hooks (pre-commit green-bar +\npre-push release gate) that fire under any tool.\n";
  // A user who hand-stripped the managed comment but kept the verbatim kit body (0.61+ always shipped WITH
  // the sentinel, so this only arises from editing). Still a kit body carrying the falsified claim.
  const bodyV061NoSentinel = bodyV061WithSentinel.replace(sentinelLine, "");

  // Genuinely foreign: mentions "shared bus" casually but matches NO kit fingerprint and has no sentinel.
  const foreign = "---\nalwaysApply: true\n---\n# my own team conventions\nAlways use tabs. Coordinate on the shared bus at standup.\n";
  // Foreign near-miss on the substring COMMON to both fingerprints ("convention, not a gate"): casual prose
  // that mentions it but matches neither full fingerprint and carries no sentinel. Must survive — a guard
  // that fails loudly if a fingerprint is ever shortened to the bare common phrase.
  const foreignCommonPhrase = "---\nalwaysApply: true\n---\n# house rules\nOur style guide is a convention, not a gate; use tabs.\n";

  try {
    // Fresh install lays the managed Cursor rule down and creates the manifest, so run([target]) is an UPDATE.
    const init = run(["init", target]);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(ruleFile), "fresh init writes the managed Cursor rule");

    // (1) v0.55 pre-0.61 body (no sentinel) -> update -> refreshed to the current host-dependent body.
    fs.writeFileSync(ruleFile, bodyV055);
    assert.strictEqual(run([target]).status, 0);
    let refreshed = fs.readFileSync(ruleFile, "utf8");
    assert.match(refreshed, /host-dependent/, "v0.55 body is recognized as kit-managed and refreshed to the ADR 0024 body");
    assert.doesNotMatch(refreshed, /does not run in Cursor/i, "the falsified pre-ADR-0024 claim is gone after refresh");
    assert.match(refreshed, /team-tactics: managed/, "the refreshed rule now carries the sentinel (future updates take the fast path)");

    // (2) v0.58 pre-0.61 body (the variant with the extra `session` bullet) -> refreshed likewise.
    fs.writeFileSync(ruleFile, bodyV058);
    assert.strictEqual(run([target]).status, 0);
    refreshed = fs.readFileSync(ruleFile, "utf8");
    assert.match(refreshed, /host-dependent/, "v0.58 body is recognized as kit-managed and refreshed");
    assert.doesNotMatch(refreshed, /does not run in Cursor/i);
    assert.match(refreshed, /team-tactics: managed/);

    // (3) 0.61-era body with the managed sentinel LINE hand-stripped (still verbatim-kit prose carrying the
    //     falsified 'does NOT run in Cursor' claim) -> recognized by fingerprint and refreshed likewise.
    fs.writeFileSync(ruleFile, bodyV061NoSentinel);
    assert.strictEqual(run([target]).status, 0);
    refreshed = fs.readFileSync(ruleFile, "utf8");
    assert.match(refreshed, /host-dependent/, "the sentinel-stripped 0.61 kit body is still recognized and refreshed");
    assert.doesNotMatch(refreshed, /does not run in Cursor/i);
    assert.match(refreshed, /team-tactics: managed/);

    // (4) A genuinely foreign rule (no sentinel, matches NO kit fingerprint) is left untouched byte-for-byte.
    fs.writeFileSync(ruleFile, foreign);
    assert.strictEqual(run([target]).status, 0);
    assert.strictEqual(fs.readFileSync(ruleFile, "utf8"), foreign, "a foreign rule is left untouched byte-for-byte");

    // (5) A foreign rule that casually contains the phrase COMMON to both fingerprints ("convention, not a
    //     gate") but matches neither full fingerprint and has no sentinel -> still untouched byte-for-byte.
    fs.writeFileSync(ruleFile, foreignCommonPhrase);
    assert.strictEqual(run([target]).status, 0);
    assert.strictEqual(fs.readFileSync(ruleFile, "utf8"), foreignCommonPhrase, "a 'convention, not a gate' near-miss survives — fingerprints must stay longer than the common phrase");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("MCPN: update nudges to run mcp-install when MCP is unwired, and stays silent when it is wired", () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "mcpn-"));
  try {
    // Fresh install auto-wires MCP (writes .mcp.json + .cursor/mcp.json on first-time init).
    const init = run(["init", target]);
    assert.strictEqual(init.status, 0, init.stderr);
    assert.ok(fs.existsSync(path.join(target, ".mcp.json")), "fresh init auto-wires .mcp.json");

    // Unwired update -> nudge. Simulate a CC-only repo that never had Cursor/MCP wiring.
    fs.rmSync(path.join(target, ".mcp.json"), { force: true });
    fs.rmSync(path.join(target, ".cursor", "mcp.json"), { force: true });
    const r = run([target]);  // manifest exists -> this is an UPDATE
    const out = (r.stdout || "") + (r.stderr || "");
    assert.match(out, /mcp-install/, "an unwired update names the mcp-install command to run");
    assert.match(out, /MCP/i, "the nudge mentions MCP");

    // Wired update -> silent. Re-create the wiring, then update again.
    run(["mcp-install", target]);
    const r2 = run([target]);  // update again, MCP now wired
    const out2 = (r2.stdout || "") + (r2.stderr || "");
    assert.ok(!/not wired/i.test(out2), "no 'not wired' nudge when MCP is already wired");
  } finally { fs.rmSync(target, { recursive: true, force: true }); }
});

test("CTXDOC: install ships docs/tics/context-map.md (the context-map how-to)", () => {
  // AGENTS.md, the Cursor rule, and tic-protocol.md all point at docs/tics/context-map.md,
  // so a fresh install must actually lay the how-to down — not just tic-protocol.md.
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ctxdoc-"));
  try {
    run([d]);
    const doc = path.join(d, "docs", "tics", "context-map.md");
    assert.ok(fs.existsSync(doc), "context-map.md installed");
    const s = fs.readFileSync(doc, "utf8");
    assert.match(s, /landmark/, "explains the landmark crumb");
    assert.match(s, /tics map/, "references the `tics map` view");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
