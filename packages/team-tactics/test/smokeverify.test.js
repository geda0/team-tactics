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
// it always PRINTS a one-line headline, but it must be OPT-IN about the bus: a demo/test run must NOT
// land a `from=qa-verifier` verdict (a stray demo verdict is read by the release gate and blocks releases
// — it blocked v0.66.0/v0.66.1). Only when TT_QA_EMIT=1 does it emit a `verdict` tic, and then it must pass
// the smoke verdict as an EXPLICIT `result` field so the gate classifies by result, not msg-text.
// TT_SMOKE_FAKE_DOM swaps in a fake DOM (rung "browser") to avoid needing a real browser.
test('CLI is print-only by default and only emits a qa-verifier verdict (with result=pass) under TT_QA_EMIT=1', () => {
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
  const HELPER = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');

  // Arrange: scaffold a temp install so .claude/hooks/{tic.sh,tics} exist; ALL_TEST_CMD keeps any
  // install-time suite quiet & green. Env-guarded: if the bus reader isn't there, skip (don't fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-smoke-cli-'));
  const BUS = path.join(tmp, '.claude', 'state', 'tics.jsonl');
  const smokeVerdicts = () => {
    if (!fs.existsSync(BUS)) return [];
    return fs.readFileSync(BUS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      .filter(t => t.from === 'qa-verifier' && t.kind === 'verdict' && /renderer=/.test(t.msg || ''));
  };
  try {
    cp.spawnSync('node', [CLI, tmp], { encoding: 'utf8', env: { ...process.env, ALL_TEST_CMD: 'true' } });
    if (!fs.existsSync(path.join(tmp, '.claude', 'hooks', 'tics'))) return; // scaffold absent → skip

    // Act 1: DEFAULT run (no TT_QA_EMIT) against a fake DOM (rung "browser") containing the marker.
    const def = cp.spawnSync('node', [HELPER, 'http://127.0.0.1:3000', 'Live scores'], {
      cwd: tmp,
      env: { ...process.env, TT_SMOKE_FAKE_DOM: '<h1>Live scores</h1>' },
      encoding: 'utf8',
    });

    // Assert 1: it still PRINTS the verdict, but lands NO smoke verdict on the bus.
    assert.match(def.stdout || '', /smoke verdict=pass/, 'the default run prints the smoke headline');
    assert.strictEqual(smokeVerdicts().length, 0, 'the default run emits NO qa-verifier smoke verdict onto the bus');

    // Act 2: OPT-IN run (TT_QA_EMIT=1) — same command, emission enabled.
    cp.spawnSync('node', [HELPER, 'http://127.0.0.1:3000', 'Live scores'], {
      cwd: tmp,
      env: { ...process.env, TT_SMOKE_FAKE_DOM: '<h1>Live scores</h1>', TT_QA_EMIT: '1' },
      encoding: 'utf8',
    });

    // Assert 2: now exactly one qa-verifier smoke verdict landed, and it carries result === 'pass'.
    const emitted = smokeVerdicts();
    assert.strictEqual(emitted.length, 1, 'TT_QA_EMIT=1 emits a single qa-verifier verdict carrying the renderer headline');
    assert.strictEqual(emitted[emitted.length - 1].result, 'pass', 'the emitted verdict passes the smoke verdict as an explicit result field');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Triangulation guard (tdd-critic): the opt-in test above only pins result=pass, which a hardcoded
// 'pass' would satisfy. This run exercises the NON-pass path — a partial marker match on an observed
// browser rung is a `concerns` verdict — and proves the emitted `result` field is the LIVE smoke
// verdict (result.verdict verbatim), not a constant. Locks the verdict→result wiring against a regression.
test('CLI emits a qa-verifier verdict with result=concerns when a TT_QA_EMIT=1 run partially matches the markers', () => {
  const fs = require('fs'), os = require('os'), cp = require('child_process');
  const CLI = path.join(__dirname, '..', 'bin', 'cli.js');
  const HELPER = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');

  // Arrange: scaffold a temp install so .claude/hooks/{tic.sh,tics} exist; ALL_TEST_CMD keeps any
  // install-time suite quiet & green. Env-guarded: if the bus reader isn't there, skip (don't fail).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-smoke-cli-'));
  const BUS = path.join(tmp, '.claude', 'state', 'tics.jsonl');
  const smokeVerdicts = () => {
    if (!fs.existsSync(BUS)) return [];
    return fs.readFileSync(BUS, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      .filter(t => t.from === 'qa-verifier' && t.kind === 'verdict' && /renderer=/.test(t.msg || ''));
  };
  try {
    cp.spawnSync('node', [CLI, tmp], { encoding: 'utf8', env: { ...process.env, ALL_TEST_CMD: 'true' } });
    if (!fs.existsSync(path.join(tmp, '.claude', 'hooks', 'tics'))) return; // scaffold absent → skip

    // Act: OPT-IN run against a fake DOM (rung "browser") containing only the FIRST of two markers, so
    // evaluateMarkers gives present=['Dashboard Ready'], missing=['Quarterly Report'] → a `concerns` verdict.
    const run = cp.spawnSync('node', [HELPER, 'http://127.0.0.1:3000', 'Dashboard Ready', 'Quarterly Report'], {
      cwd: tmp,
      env: { ...process.env, TT_QA_EMIT: '1', TT_SMOKE_FAKE_DOM: '<h1>Dashboard Ready</h1>' },
      encoding: 'utf8',
    });

    // Assert (sanity): the printed headline is the partial-match verdict.
    assert.match(run.stdout || '', /smoke verdict=concerns/, 'the partial-match run prints a concerns headline');

    // Assert: the landed qa-verifier verdict carries the LIVE verdict as its result — 'concerns', not 'pass'.
    const emitted = smokeVerdicts();
    assert.strictEqual(emitted[emitted.length - 1].result, 'concerns', 'the emitted result field is the live smoke verdict, not a hardcoded pass');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
