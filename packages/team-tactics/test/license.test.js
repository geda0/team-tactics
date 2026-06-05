"use strict";
// The framework ships as readable source (a local Claude Code kit can't hide it), so the
// protection is legal, not technical: every package must declare a PROPRIETARY license and ship
// its LICENSE file so the terms travel with the package. This pins it — no package may regress to
// MIT/permissive or ship unlicensed.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..");        // test -> team-tactics -> packages -> repo root
const PKGS = ["tics", "tdd", "team-tactics"];

test("the repo carries a proprietary LICENSE at its root", () => {
  const f = path.join(ROOT, "LICENSE");
  assert.ok(fs.existsSync(f), "a LICENSE file at the repo root");
  assert.match(fs.readFileSync(f, "utf8"), /PROPRIETARY|All rights reserved/i, "states proprietary terms");
});

test("every package is proprietary-licensed and ships its LICENSE (source is visible, not free)", () => {
  for (const name of PKGS) {
    const dir = path.join(ROOT, "packages", name);
    const pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    assert.match(pj.license || "", /^(SEE LICENSE IN LICENSE|UNLICENSED)$/, name + ": package.json must declare a proprietary license, not MIT/permissive");
    const lic = path.join(dir, "LICENSE");
    assert.ok(fs.existsSync(lic), name + ": must ship a LICENSE file (npm includes it in the tarball; the terms travel with the package)");
    assert.match(fs.readFileSync(lic, "utf8"), /PROPRIETARY|All rights reserved/i, name + ": LICENSE must state proprietary terms");
  }
});
