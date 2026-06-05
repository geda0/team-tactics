#!/usr/bin/env node
"use strict";
// Build a self-contained, sendable tarball of the kit for PRIVATE peer testing.
// The kit has zero external dependencies, so the recipient needs no registry and no
// `npm install` — they extract and run. Send the .tgz over any channel you control.
//
//   node scripts/pack-tarball.js [output.tgz]   (or: npm run pack:tarball)
const fs = require("fs"), cp = require("child_process"), path = require("path");
const root = path.join(__dirname, "..");
const version = require(path.join(root, "package.json")).version;
const out = path.resolve(process.argv[2] || path.join(root, "ttics-" + version + ".tgz"));

// Prefer the released tag v<version> (reproducible, matches a tested release); else HEAD.
let ref = "HEAD";
try {
  cp.execFileSync("git", ["-C", root, "rev-parse", "--verify", "--quiet", "v" + version], { stdio: "ignore" });
  ref = "v" + version;
} catch (e) { /* tag not cut yet — archive the current commit */ }

cp.execFileSync("git", ["-C", root, "archive", "--format=tar.gz", "-o", out, ref]);
const kb = Math.round(fs.statSync(out).size / 1024);
console.log("Built " + out + " (" + kb + " KB) from " + ref + ".");
console.log("");
console.log("Send it to your tester over any private channel. They run, in their project:");
console.log("  tar -xzf " + path.basename(out) + " -C ~/ttics-kit");
console.log("  node ~/ttics-kit/packages/team-tactics/bin/cli.js init .");
console.log("FOR-TESTERS.md (included in the tarball) is the full guide.");
