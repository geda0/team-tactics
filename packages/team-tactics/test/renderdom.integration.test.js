'use strict';
// Live browser-QA integration — ADR 0021. OPT-IN: runs only when TT_SMOKE_INTEGRATION=1
// AND a real system browser is discovered; otherwise SKIPS (keeps the normal suite fast and
// CI green without a browser). Pins the real --dump-dom + --virtual-time-budget contract.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('path');
const SUT = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');
// --- test-writer: add the opt-in live integration test below this line ---

const { renderDom, findBrowser } = require(SUT);
// GATE: opt-in only — needs TT_SMOKE_INTEGRATION=1 AND a real, discoverable browser.
// Otherwise SKIP, so the normal suite stays fast and CI stays green without Chrome.
const enabled = process.env.TT_SMOKE_INTEGRATION === '1' && !!findBrowser();

test('live: real browser dump-dom captures a deferred-JS marker via --virtual-time-budget', { skip: !enabled, timeout: 60000 }, () => {
  // Arrange: a page with an IMMEDIATE marker and a LATE marker that a setTimeout (~300ms)
  // injects after first paint. We serve it from a file:// URL written to a temp file — the OS
  // serves it (no event loop needed), which is essential because renderDom uses synchronous
  // spawnSync that would block any in-process HTTP server. The late marker only lands in the
  // dump if --virtual-time-budget waits for it.
  const html = '<!doctype html><html><body><h1>Immediate Marker</h1>'
    + '<script>setTimeout(function(){var d=document.createElement(\'div\');d.textContent=\'Late JS Marker\';document.body.appendChild(d);},300);</script>'
    + '</body></html>';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-fix-'));
  const file = path.join(dir, 'fixture.html');
  fs.writeFileSync(file, html);

  try {
    // Act: drive the REAL browser rung over file://. allowRemote lets the loopback guard pass
    // the file:// URL (no loopback host) — no injected findBrowser/spawnRender seams.
    const result = renderDom('file://' + file, { allowRemote: true });

    // Assert: rendered via the real browser, with both the immediate and the deferred-JS marker.
    assert.strictEqual(result.renderer, 'browser', 'rendered via the real browser rung');
    assert.match(result.dom, /Immediate Marker/, 'immediate content present');
    assert.match(result.dom, /Late JS Marker/, 'deferred-JS marker captured — proves --virtual-time-budget');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
