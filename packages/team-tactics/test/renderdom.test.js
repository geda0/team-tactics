'use strict';
// renderDom seam — browser-QA smoke verdict (ADR 0021, slices 12/13).
// The thin side-effect: discover a browser, dump the DOM, label the rung.
// Unit-tested with INJECTED fakes (opts.findBrowser / opts.spawnRender) — no real browser.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const SUT = path.join(__dirname, '..', 'kit', 'presets', 'full-team', 'scripts', 'smoke-verify.cjs');
// --- test-writer: add exactly ONE failing test for the active slice below this line ---

test('renders DOM via discovered browser, labelled renderer "browser", with headless + dump-dom flags', () => {
  // Arrange
  const { renderDom } = require(SUT);
  let captured;
  const opts = {
    findBrowser: () => '/x/chrome',
    spawnRender: (cmd, args) => {
      captured = args;
      return '<h1>hi</h1>';
    },
  };

  // Act
  const result = renderDom('http://127.0.0.1:3000', opts);

  // Assert
  assert.strictEqual(result.dom, '<h1>hi</h1>');
  assert.strictEqual(result.renderer, 'browser');
  assert.ok(captured.includes('--headless=new'));
  assert.ok(captured.includes('--dump-dom'));
});

test('passes --virtual-time-budget=2000 by default, --virtual-time-budget=5000 when opts.budgetMs is 5000', () => {
  // Arrange
  const { renderDom } = require(SUT);
  let captureDefault;
  let captureOverride;

  // Act
  renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    spawnRender: (cmd, args) => {
      captureDefault = args;
      return '<h1>hi</h1>';
    },
  });
  renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    budgetMs: 5000,
    spawnRender: (cmd, args) => {
      captureOverride = args;
      return '<h1>hi</h1>';
    },
  });

  // Assert
  assert.ok(captureDefault.includes('--virtual-time-budget=2000'));
  assert.ok(captureOverride.includes('--virtual-time-budget=5000'));
});

test('returns an unobserved render {dom:"", renderer:"none"} when no browser is found, without throwing', () => {
  // Arrange
  const { renderDom } = require(SUT);

  // Act
  const result = renderDom('http://127.0.0.1:3000', { findBrowser: () => null });

  // Assert
  assert.deepStrictEqual(result, { dom: '', renderer: 'none' });
});

test('spawnRender runs the given command and returns its stdout as a string', () => {
  // Arrange
  const { spawnRender } = require(SUT);

  // Act
  const out = spawnRender(process.execPath, ['-e', "process.stdout.write('<h1>spawned</h1>')"]);

  // Assert
  assert.strictEqual(out, '<h1>spawned</h1>');
});

test('always passes an ephemeral --user-data-dir, and adds --no-sandbox exactly when isRoot() is true', () => {
  // Arrange
  const { renderDom } = require(SUT);
  let captureRoot;
  let captureNonRoot;

  // Act
  renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    isRoot: () => true,
    spawnRender: (cmd, args) => {
      captureRoot = args;
      return '<h1>x</h1>';
    },
  });
  renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    isRoot: () => false,
    spawnRender: (cmd, args) => {
      captureNonRoot = args;
      return '<h1>x</h1>';
    },
  });

  // Assert
  assert.ok(captureRoot.some((a) => a.startsWith('--user-data-dir=')));
  assert.ok(captureRoot.includes('--no-sandbox'));
  assert.ok(captureNonRoot.some((a) => a.startsWith('--user-data-dir=')));
  assert.ok(!captureNonRoot.includes('--no-sandbox'));
});

test('refuses a non-loopback target without spawning, unless allowRemote; loopback proceeds (SSRF guard)', () => {
  // Arrange
  const { renderDom } = require(SUT);
  let spawned = false;

  // Act
  const refused = renderDom('http://evil.example/x', {
    findBrowser: () => '/x/chrome',
    spawnRender: () => {
      spawned = true;
      return '<h1>x</h1>';
    },
  });
  const loopback = renderDom('http://127.0.0.1:3000/app', {
    findBrowser: () => '/x/chrome',
    spawnRender: () => '<h1>x</h1>',
  });
  const remoteOptIn = renderDom('http://evil.example/x', {
    allowRemote: true,
    findBrowser: () => '/x/chrome',
    spawnRender: () => '<h1>x</h1>',
  });

  // Assert
  assert.deepStrictEqual(refused, { dom: '', renderer: 'refused-nonloopback' });
  assert.strictEqual(spawned, false);
  assert.strictEqual(loopback.renderer, 'browser');
  assert.strictEqual(remoteOptIn.renderer, 'browser');
});

test('maps a timed-out spawnRender result to the unobserved {dom:"", renderer:"timeout"} rung', () => {
  // Arrange
  const { renderDom } = require(SUT);

  // Act
  const result = renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    spawnRender: () => ({ timedOut: true }),
  });

  // Assert
  assert.deepStrictEqual(result, { dom: '', renderer: 'timeout' });
});

test('returns the unobserved {dom:"", renderer:"render-error"} rung when profile creation throws, without throwing', () => {
  // Arrange
  const { renderDom } = require(SUT);

  // Act
  const result = renderDom('http://127.0.0.1:3000', {
    findBrowser: () => '/x/chrome',
    mkProfile: () => {
      throw new Error('EROFS: read-only file system');
    },
    spawnRender: () => '<h1>x</h1>',
  });

  // Assert
  assert.deepStrictEqual(result, { dom: '', renderer: 'render-error' });
});
