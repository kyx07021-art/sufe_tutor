/**
 * ZL: default style/theme single source + regression lock.
 *
 * STYLE_DEFAULT / THEME_DEFAULT live in src/shared/config.js and are consumed by
 * core/appearance.js (getStylePref / setStylePref / applyTheme / setThemePref /
 * initAppearance matchMedia handler) and core/state.js (getThemePref).
 *
 * web/theme-init.js is a classic IIFE (loaded via <script src> without type=module,
 * CSP script-src 'self') and cannot import config.js — it mirrors the two defaults as
 * literals; the parity test below keeps them in sync.
 *
 * G2 mutation reasoning (each behavior assertion is mutation-backed):
 *  - config constant value assertion       -> changing the value turns it red.
 *  - getStylePref no-storage fallback      -> reverting the fallback to 'flat' turns it red.
 *  - themeIsDark('system') matchMedia both states -> breaking the follow-matchMedia
 *    branch turns one of the two assertions red.
 *  - theme-init.js parity                  -> reverting a literal in web/theme-init.js
 *    turns it red.
 *
 * Note: reverting a consumer to the SAME literal (e.g. STYLE_DEFAULT -> 'liquid') is
 * behaviorally indistinguishable, so the source-level wiring test below is the honest
 * lock for "the consumer references the constant, not a hard-coded literal".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONFIG, STYLE_DEFAULT, THEME_DEFAULT } from '../src/shared/config.js';
import { getStylePref, themeIsDark } from '../src/client/core/appearance.js';
import { getThemePref } from '../src/client/core/state.js';

function storageMock() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

function setWindowMatchMedia(dark) {
  globalThis.window = { matchMedia: () => ({ matches: dark }) };
}

test('config single-source constants: STYLE_DEFAULT=liquid / THEME_DEFAULT=system', () => {
  assert.equal(STYLE_DEFAULT, 'liquid');
  assert.equal(THEME_DEFAULT, 'system');
});

test('getStylePref with no localStorage falls back to STYLE_DEFAULT', () => {
  delete globalThis.localStorage;
  delete globalThis.window;
  assert.equal(getStylePref(), STYLE_DEFAULT);
});

test('getStylePref whitelist: flat readable / liquid readable / invalid falls back to STYLE_DEFAULT', () => {
  globalThis.localStorage = storageMock();
  globalThis.localStorage.setItem(CONFIG.STYLE_KEY, 'flat');
  assert.equal(getStylePref(), 'flat');
  globalThis.localStorage.setItem(CONFIG.STYLE_KEY, 'liquid');
  assert.equal(getStylePref(), 'liquid');
  globalThis.localStorage.setItem(CONFIG.STYLE_KEY, 'bogus');
  assert.equal(getStylePref(), STYLE_DEFAULT);
  delete globalThis.localStorage;
  delete globalThis.window;
});

test('getThemePref with no localStorage falls back to THEME_DEFAULT', () => {
  delete globalThis.localStorage;
  delete globalThis.window;
  assert.equal(getThemePref(), THEME_DEFAULT);
});

test('getThemePref stored value readable / missing key falls back to THEME_DEFAULT', () => {
  globalThis.localStorage = storageMock();
  globalThis.localStorage.setItem(CONFIG.THEME_KEY, 'dark');
  assert.equal(getThemePref(), 'dark');
  globalThis.localStorage.removeItem(CONFIG.THEME_KEY);
  assert.equal(getThemePref(), THEME_DEFAULT);
  delete globalThis.localStorage;
  delete globalThis.window;
});

test('themeIsDark(system) follows matchMedia in both light and dark states', () => {
  setWindowMatchMedia(true);
  assert.equal(themeIsDark(THEME_DEFAULT), true);
  delete globalThis.window;
  setWindowMatchMedia(false);
  assert.equal(themeIsDark(THEME_DEFAULT), false);
  delete globalThis.window;
});

test('theme-init.js default literals are in parity with config constants', () => {
  const src = readFileSync(new URL('../web/theme-init.js', import.meta.url), 'utf8');
  const styleMatch = src.match(/read\('sufe_style',\s*'([^']*)'\)/);
  const themeMatch = src.match(/read\('sufe_theme',\s*'([^']*)'\)/);
  assert.ok(styleMatch, 'theme-init.js should contain a sufe_style default literal');
  assert.ok(themeMatch, 'theme-init.js should contain a sufe_theme default literal');
  assert.equal(styleMatch[1], STYLE_DEFAULT);
  assert.equal(themeMatch[1], THEME_DEFAULT);
});

test('single-source wiring: appearance.js/state.js reference the constants, not literals', () => {
  const appSrc = readFileSync(new URL('../src/client/core/appearance.js', import.meta.url), 'utf8');
  assert.match(appSrc, /STYLE_DEFAULT/, 'appearance.js should reference STYLE_DEFAULT');
  assert.match(appSrc, /THEME_DEFAULT/, 'appearance.js should reference THEME_DEFAULT');
  assert.doesNotMatch(appSrc, /:\s*'liquid'/, 'appearance.js should not hard-code the liquid style default');
  assert.doesNotMatch(appSrc, /\|\| 'system'/, 'appearance.js should not hard-code the system theme default');
  const stateSrc = readFileSync(new URL('../src/client/core/state.js', import.meta.url), 'utf8');
  assert.match(stateSrc, /THEME_DEFAULT/, 'state.js should reference THEME_DEFAULT');
  assert.doesNotMatch(stateSrc, /\|\| 'system'/, 'state.js should not hard-code the system theme default');
});
