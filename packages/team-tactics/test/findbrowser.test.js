'use strict';
// findBrowser discovery — browser-QA smoke verdict (ADR 0021).
// Pure-ish discovery with INJECTED probes (env / platform / onPath / exists) — no real I/O.
// The macOS app-bundle case is the critic's live-verified bug: PATH-only discovery misses
// Chrome on macOS, so OS install paths must be probed.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SUT = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');
// --- test-writer: add exactly ONE failing test for the active slice below this line ---

test('findBrowser resolves in tier order (env > PATH > OS install path incl. macOS bundle), null when none', () => {
  const { findBrowser } = require(SUT);

  // Tier 1: explicit env override wins over everything else.
  assert.strictEqual(
    findBrowser({ env: { TT_BROWSER: '/opt/c' }, platform: 'linux', onPath: () => true, exists: () => true }),
    '/opt/c'
  );

  // Tier 2: a PATH candidate name is used when there is no override.
  assert.strictEqual(
    findBrowser({ env: {}, platform: 'linux', onPath: (n) => n === 'chromium', exists: () => false }),
    'chromium'
  );

  // Tier 3 (macOS): the app-bundle install path is probed when PATH misses (the verified bug).
  assert.strictEqual(
    findBrowser({
      env: {},
      platform: 'darwin',
      onPath: () => false,
      exists: (p) => p === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    }),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  );

  // Tier 3 (linux): a distro install path is probed when PATH misses.
  assert.strictEqual(
    findBrowser({ env: {}, platform: 'linux', onPath: () => false, exists: (p) => p === '/usr/bin/chromium' }),
    '/usr/bin/chromium'
  );

  // No match in any tier: returns null (not a throw).
  assert.strictEqual(
    findBrowser({ env: {}, platform: 'linux', onPath: () => false, exists: () => false }),
    null
  );
});
