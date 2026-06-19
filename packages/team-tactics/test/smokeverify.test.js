'use strict';
// smokeVerify compose + CLI — browser-QA smoke verdict (ADR 0021, slices 19/20/22).
// Composes the renderDom seam with the evaluateMarkers predicate, reconciles the
// verdict against the render rung (never a false pass), and (CLI) emits a verdict tic.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SUT = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');
// --- test-writer: add exactly ONE failing test for the active slice below this line ---

test('returns the composed pass result carrying the browser renderer label when the rendered DOM contains all markers', () => {
  const { smokeVerify } = require(SUT);

  const result = smokeVerify('http://127.0.0.1:3000', ['Live scores'], {
    renderer: () => ({ dom: '<h1>Live scores</h1>', renderer: 'browser' }),
  });

  assert.deepStrictEqual(result, {
    present: ['Live scores'],
    missing: [],
    verdict: 'pass',
    renderer: 'browser',
  });
});

test('downgrades to concerns (never block) when the render rung is unobserved, preserving the renderer label', () => {
  const { smokeVerify } = require(SUT);

  const result = smokeVerify('http://127.0.0.1:3000', ['X'], {
    renderer: () => ({ dom: '', renderer: 'none' }),
  });

  assert.deepStrictEqual(result, {
    present: [],
    missing: ['X'],
    verdict: 'concerns',
    renderer: 'none',
  });
});

// slice 22 (ADR 0021): the CLI is the seam to the bus. Run as `node smoke-verify.cjs <url> <marker...>`,
// it formats a one-line headline and emits a `verdict` tic via the install's tic.sh, so the verdict
// shows in `tics log`. TT_SMOKE_FAKE_DOM swaps in a fake DOM (rung "browser") to avoid needing a real browser.
test('CLI emits a verdict tic that appears in `tics log` when the fake DOM contains the marker', () => {
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
  const HELPER = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');

  // Arrange: scaffold a temp install so .claude/hooks/{tic.sh,tics} exist; ALL_TEST_CMD keeps any
  // install-time suite quiet & green. Env-guarded: if the bus reader isn't there, skip (don't fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-smoke-cli-'));
  try {
    cp.spawnSync('node', [CLI, tmp], { encoding: 'utf8', env: { ...process.env, ALL_TEST_CMD: 'true' } });
    if (!fs.existsSync(path.join(tmp, '.claude', 'hooks', 'tics'))) return; // scaffold absent → skip

    // Act: run the helper CLI against a fake DOM (rung "browser") containing the marker.
    cp.spawnSync('node', [HELPER, 'http://127.0.0.1:3000', 'Live scores'], {
      cwd: tmp,
      env: { ...process.env, TT_SMOKE_FAKE_DOM: '<h1>Live scores</h1>' },
      encoding: 'utf8',
    });

    // Assert: a verdict tic with the renderer/marker headline landed on the bus.
    const log = cp.spawnSync(path.join(tmp, '.claude', 'hooks', 'tics'), ['log'], { cwd: tmp, encoding: 'utf8' });
    const out = (log.stdout || '') + (log.stderr || '');
    assert.match(out, /verdict/i, 'the CLI emitted a verdict tic onto the bus');
    assert.match(out, /renderer=|Live scores|markers/i, 'the verdict carries the renderer/marker headline');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
