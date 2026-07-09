"use strict";
// ADR 0005: full-team is the DEFAULT (full power by default). A plain install ships the outer-loop
// roles + method + state and records preset:"full-team"; `--minimal` opts out (sticky). P2-14: the
// preset is sticky across updates.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const CLI = path.join(__dirname, "..", "bin", "cli.js");
const run = (args, cwd) => cp.spawnSync("node", [CLI, ...args], { encoding: "utf8", cwd: cwd || os.tmpdir() });
const has = (d, ...p) => fs.existsSync(path.join(d, ...p));
const manifest = (d) => JSON.parse(fs.readFileSync(path.join(d, ".claude", ".team-tactics", "manifest.json"), "utf8"));
const TEAM = ["product-owner", "architect", "qa-verifier", "project-manager", "dev-ops"];
const kitFile = (...p) => fs.readFileSync(path.join(__dirname, "..", "kit", "presets", "full-team", ...p), "utf8");

test("plain install ships the FULL TEAM by default (ADR 0005 — full power by default)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);   // no flag
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " installs by DEFAULT now");
    assert.ok(has(d, ".claude", "agents", "test-writer.md"), "inner agents too");
    assert.ok(has(d, "docs", "tdd", "outer-loop.md"), "outer-loop doc shipped by default");
    assert.strictEqual(manifest(d).preset, "full-team", "default preset recorded as full-team");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// REGRESSION GUARD (navigator 2026-06-10: "ensure new installs HAVE full team by default; future
// installs won't face the same issue"). Pins the WHOLE contract for a fresh, no-flag install end to
// end — delivered (team + preset) AND kept honest by the AUTOMATIC accountability backstop (ADR 0006):
// the Stop hook wires solo-drift-check.sh, which surfaces substantial solo-drift at session end with
// zero config. The proactive every-prompt directive is still WIRED but opt-in (ADR 0005 amended). If
// any future change drops a new install back toward solo — flips the default, drops the
// solo-drift backstop wiring, or unwires the (opt-in) directive — this fails loudly.
test("GUARD: a fresh no-flag install delivers full-team + wires the AUTOMATIC accountability backstop (proactive directive available, opt-in)", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);   // exactly what a brand-new adopter runs
    // delivered:
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " present on a default install");
    assert.strictEqual(manifest(d).preset, "full-team", "preset recorded full-team");
    const settings = JSON.parse(fs.readFileSync(path.join(d, ".claude", "settings.json"), "utf8"));
    // the proactive directive is still AVAILABLE (opt-in): UserPromptSubmit stays wired to it.
    const ups = (settings.hooks && settings.hooks.UserPromptSubmit) || [];
    assert.ok(ups.some((g) => (g.hooks || []).some((h) => /prompt-directive\.sh/.test(h.command || ""))), "UserPromptSubmit wired to prompt-directive (opt-in)");
    // the AUTOMATIC accountability backstop is the default: Stop wires solo-drift-check.sh AND it ships on disk.
    const stop = (settings.hooks && settings.hooks.Stop) || [];
    assert.ok(stop.some((g) => (g.hooks || []).some((h) => /solo-drift-check\.sh/.test(h.command || ""))), "Stop wires solo-drift-check.sh — the AUTOMATIC accountability backstop is the default (ADR 0006)");
    assert.ok(has(d, ".claude", "hooks", "solo-drift-check.sh"), "the backstop hook ships on disk");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--preset full-team installs the 5 roles + outer-loop doc + state + records preset", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    for (const a of TEAM) assert.ok(has(d, ".claude", "agents", a + ".md"), a + " installed");
    assert.ok(has(d, "docs", "tdd", "outer-loop.md"), "outer-loop doc");
    assert.ok(has(d, "docs", "tdd", "sectioning.md"), "sectioning doc");
    assert.ok(has(d, ".claude", "state", "backlog.md"), "backlog seeded");
    assert.ok(has(d, ".claude", "state", "releases.md"), "releases seeded");
    assert.strictEqual(manifest(d).preset, "full-team", "preset recorded in manifest");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("preset is sticky: a plain update on a full-team install keeps refreshing the team", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--preset", "full-team", d]);
    fs.rmSync(path.join(d, ".claude", "agents", "dev-ops.md")); // simulate drift
    run(["update", d]);                                          // no flag
    assert.ok(has(d, ".claude", "agents", "dev-ops.md"), "sticky preset re-refreshed the role");
    assert.strictEqual(manifest(d).preset, "full-team");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--minimal opts out of the team (inner pair only) and is sticky across update", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run(["--minimal", d]);
    for (const a of TEAM) assert.ok(!has(d, ".claude", "agents", a + ".md"), a + " absent under --minimal");
    assert.ok(has(d, ".claude", "agents", "test-writer.md"), "inner pair present");
    assert.strictEqual(manifest(d).preset, "minimal", "minimal recorded (sticky opt-out)");
    run(["update", d]);   // plain update must NOT re-add the team
    for (const a of TEAM) assert.ok(!has(d, ".claude", "agents", a + ".md"), a + " stays absent (sticky minimal)");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("an unknown preset name errors (exit != 0)", () => {
  const r = run(["--preset", "bogus", os.tmpdir() + "/_never"]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /preset/i);
});

// N8 (ADR 0007): an agent the adopter has customized GRADUATES to user-owned — a plain `update`
// must NOT clobber it. Today refresh() overwrites a modified mechanism file and parks the OLD copy
// at .bak; for an agent that destroys the customization (the exact Based friction). After N8 the
// adopter's bytes survive and the KIT version is parked beside as <role>.md.kit-<version> (not .bak),
// to diff/adopt; agents nobody touched still refresh so the kit keeps flowing.
// H1b (design-notes § H1): minimize the install footprint in the adopter's repo. CI becomes OPT-IN —
// a plain install writes NOTHING under .github/ (the adopter's CI surface is untouched); `--ci` opts
// into the seedable tdd-verify.yml. And the one-time KICKOFF bootstrap moves under .claude/ (it is not
// root-pinned the way AGENTS.md/CLAUDE.md are). Today the installer seedOnce-writes .github/workflows/
// tdd-verify.yml on EVERY install and merges KICKOFF.md at the repo root — so this is RED.
test("H1b: a default install writes NO CI workflow + KICKOFF lives under .claude; --ci opts into CI", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-h1b-"));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-h1b-ci-"));
  try {
    run([d]);   // default install, no --ci
    assert.ok(!has(d, ".github", "workflows", "tdd-verify.yml"), "no CI workflow written by default");
    assert.ok(has(d, ".claude", "KICKOFF.md"), "KICKOFF moved under .claude");
    assert.ok(!has(d, "KICKOFF.md"), "KICKOFF no longer written to the repo root");

    run(["--ci", d2]);   // opt in
    assert.ok(has(d2, ".github", "workflows", "tdd-verify.yml"), "--ci writes the CI workflow");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
  }
});

test("N8: a locally-modified agent is PRESERVED on update + the kit version parked beside it; unmodified agents refresh normally", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-preset-"));
  try {
    run([d]);   // default full-team install — product-owner.md present; manifest records its sha
    const po = path.join(d, ".claude", "agents", "product-owner.md");
    const custom = fs.readFileSync(po, "utf8") + "\n# MY CUSTOM SEAM NOTES\n";
    fs.writeFileSync(po, custom);                       // adopter customizes the agent

    const upd = run(["update", d]);                     // plain update (no --force)
    const ver = manifest(d).kitVersion;                 // dynamic — the stamp the installer recorded

    assert.strictEqual(fs.readFileSync(po, "utf8"), custom, "modified agent preserved byte-for-byte");
    assert.ok(fs.existsSync(po + ".kit-" + ver), "kit version parked as <role>.md.kit-<version>");
    assert.ok(!fs.existsSync(path.join(d, ".claude", "agents", "architect.md.kit-" + ver)), "an unmodified agent gets no sidecar (kit keeps flowing)");
    assert.match(upd.stdout + upd.stderr, /product-owner|preserv/i, "the run names the preserved agent");
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ADR 0021 (slice 23): the browser-QA helper smoke-verify.cjs is part of the full-team preset — the
// qa-verifier role invokes it. A full-team install must ship it at .claude/scripts/smoke-verify.cjs;
// a --minimal install (no qa-verifier role) must NOT install it. The installer does not copy it yet,
// so the full-team assertion is RED.
// ADR 0024 Ruling 2 (§4 E-1…E-6, §5 predicates Q1…Q7): the QA seam is the `verdict` TIC, not the
// qa-verifier AGENT — whoever holds the instrument observes and emits under its own `from`. This
// doctrine must land in the two shipped full-team docs. Today outer-loop.md's ACCEPT step still says
// only "qa-verifier drives the running app" (agent-as-seam) and never names the instrument vocabulary,
// smoke's range limit, the identity-laundering ban, or the PO's cite-the-experience-verdict rule; so
// this is RED (tolerant, case-insensitive regexes pin the load-bearing words, not whole sentences).
test("outer-loop doc states the QA seam is the verdict tic not the agent (ADR 0024 Ruling 2 Q1-Q5)", () => {
  const doc = kitFile("docs", "outer-loop.md");
  // Q1 — the seam is the verdict TIC, not the AGENT; whoever observed emits it.
  assert.match(doc, /verdict tic/i, "Q1: names the verdict tic as the seam");
  assert.match(doc, /not the\b[\s\S]{0,20}agent/i, "Q1: the seam is not the agent");
  assert.match(doc, /whoever observed/i, "Q1: whoever observed emits the verdict");
  // Q2 — the closed instrument vocabulary + the none-can-never-pass rule.
  assert.match(doc, /\bsmoke\b/i, "Q2: instrument token smoke");
  assert.match(doc, /browser-mcp/i, "Q2: instrument token browser-mcp");
  assert.match(doc, /\bhuman\b/i, "Q2: instrument token human");
  assert.match(doc, /instrument\s*=?\s*none/i, "Q2: instrument token none");
  assert.match(doc, /none\b[\s\S]{0,80}concerns/i, "Q2: instrument=none => concerns");
  assert.match(doc, /never\b[\s\S]{0,20}pass/i, "Q2: none is never a pass");
  // Q3 — smoke's range stated as a limit; appearance needs browser-mcp or human.
  assert.match(doc, /text marker/i, "Q3: smoke sees text markers");
  assert.match(doc, /can(?:not|'t)\s+see/i, "Q3: smoke cannot see");
  assert.match(doc, /appearance/i, "Q3: appearance is out of smoke's range");
  // Q4 — orchestrator may observe when it holds the instrument, but must not launder identity.
  assert.match(doc, /orchestrator[\s\S]{0,160}qa-verifier|qa-verifier[\s\S]{0,160}orchestrator/i, "Q4: orchestrator named alongside qa-verifier");
  assert.match(doc, /own\b[\s\S]{0,12}from/i, "Q4: emit under its own from");
  assert.match(doc, /launder/i, "Q4: forbids identity laundering");
  // Q5 — the PO's accept on an experience milestone must cite the experience verdict, else concerns.
  assert.match(doc, /product-owner[\s\S]{0,200}experience/i, "Q5: PO accept ties to experience");
  assert.match(doc, /cite/i, "Q5: must cite the experience verdict");
});

// ADR 0024 Ruling 2 (§4 E-3/E-5/E-6, §5 Q3/Q6/Q7): the qa-verifier agent doc must state smoke's range
// limit (Q3), document the mcp__<server>__<tool> browser tools as an ADOPTER-LOCAL opt-in while the kit
// frontmatter stays `Read, Bash, Grep, Glob` (Q6, ADR 0007), and warn that the MODULE API emits nothing
// so a require(...) caller must emit its own verdict tic (Q7). Today the agent names "text markers" but
// never states smoke cannot judge appearance, never mentions mcp__/adopter opt-in, and never warns the
// module-API caller — so this is RED.
test("qa-verifier agent documents smoke's range, the adopter-local browser-mcp opt-in, and the module-API trap (ADR 0024 Ruling 2 Q3/Q6/Q7)", () => {
  const doc = kitFile("agents", "qa-verifier.md");
  // Q3 — smoke only answers "is this text marker in the rendered DOM"; cannot judge appearance.
  assert.match(doc, /text marker/i, "Q3: smoke answers text-marker presence");
  assert.match(doc, /rendered dom/i, "Q3: in the rendered DOM");
  assert.match(doc, /appearance/i, "Q3: cannot judge appearance");
  // Q6 — the browser MCP tools are an adopter-local opt-in; kit frontmatter unchanged.
  assert.match(doc, /mcp__/, "Q6: documents the mcp__<server>__<tool> pattern");
  assert.match(doc, /adopter/i, "Q6: <server> is the adopter's own config key");
  assert.match(doc, /Read, Bash, Grep, Glob/, "Q6: kit frontmatter stays Read, Bash, Grep, Glob");
  // Q7 — only the CLI with TT_QA_EMIT=1 emits; a module/require caller must emit its own verdict tic.
  assert.match(doc, /TT_QA_EMIT/, "Q7: names the CLI emit flag");
  assert.match(doc, /module|require/i, "Q7: names the module-API caller");
  assert.match(doc, /emit[\s\S]{0,24}own/i, "Q7: caller must emit its own verdict tic");
});

test("full-team ships the browser-QA helper .claude/scripts/smoke-verify.cjs; --minimal does not", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-smoke-"));
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "tdd-smoke-min-"));
  try {
    run([d]);   // full-team is the default
    assert.ok(has(d, ".claude", "scripts", "smoke-verify.cjs"), "browser-QA helper ships with the team");

    run(["--minimal", d2]);
    assert.ok(!has(d2, ".claude", "scripts", "smoke-verify.cjs"), "absent under minimal");
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(d2, { recursive: true, force: true });
  }
});
