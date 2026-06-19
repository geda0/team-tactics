'use strict';
// evaluateMarkers predicate — browser-QA smoke verdict (ADR 0021, slices 1/2/6).
// The pure TDD core: dom string x expected markers -> { present, missing, verdict }.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SUT = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');
// --- test-writer: add exactly ONE failing test for the active slice below this line ---

test('verdict is pass when every expected marker is present in the DOM', () => {
  const { evaluateMarkers } = require(SUT);

  const result = evaluateMarkers('<h1>Live scores</h1>', ['Live scores']);

  assert.deepStrictEqual(result, {
    present: ['Live scores'],
    missing: [],
    verdict: 'pass',
  });
});

test('verdict is block when none of the expected markers are present in the DOM', () => {
  const { evaluateMarkers } = require(SUT);

  const result = evaluateMarkers('<h1>Live scores</h1>', ['Box score']);

  assert.deepStrictEqual(result, {
    present: [],
    missing: ['Box score'],
    verdict: 'block',
  });
});

test('verdict is concerns when some but not all expected markers are present in the DOM', () => {
  const { evaluateMarkers } = require(SUT);

  const result = evaluateMarkers('<h1>Live scores</h1>', ['Live scores', 'Box score']);

  assert.deepStrictEqual(result, {
    present: ['Live scores'],
    missing: ['Box score'],
    verdict: 'concerns',
  });
});
