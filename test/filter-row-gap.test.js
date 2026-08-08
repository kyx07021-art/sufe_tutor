/**
 * 需求五（2026-08-08）·教师筛选栏上下两排间距规则（v0.25.45）
 *
 * 缺陷实证：筛选面板内上下两排下拉栏零空隙紧贴（v0.25.29 新增第二排「授课方式/可授课时间/
 * 认证状态」时只追加 .filter-row，未给两排之间留空隙）。
 *
 * 规则化：空隙值单源 CONFIG.FILTER_ROW_GAP → index.html applyLg 注入 --filter-row-gap →
 * style.css `.filter-panel .filter-row + .filter-row` 消费（写进规则，杜绝再次零空隙）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import vm from 'node:vm';

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console: { log() {}, warn() {}, error() {} },
    fetch: async (url) => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  vm.runInContext(readFileSync('./constants.js', 'utf8'), ctx, { filename: 'constants.js' });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('筛选栏两排空隙写进规则：单源值 + 注入 + CSS 消费，非零空隙', () => {
  // 1. 数值单源 CONFIG.FILTER_ROW_GAP
  const { ctx } = makeCtx();
  const gap = vm.runInContext('APP_CONSTANTS.CONFIG.FILTER_ROW_GAP', ctx);
  assert.ok(Number.isInteger(gap) && gap >= 8, `FILTER_ROW_GAP 为合理空隙值（当前 ${gap}px）`);
  // 2. index.html applyLg 注入 --filter-row-gap
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes("set('--filter-row-gap'"), 'index.html 注入 --filter-row-gap');
  assert.ok(html.includes('C.FILTER_ROW_GAP'), '注入值取单源 CONFIG.FILTER_ROW_GAP');
  // 3. style.css 消费：第二排起 margin-top = var(--filter-row-gap)
  const css = readFileSync('./style.css', 'utf8');
  const rule = css.split('.filter-panel .filter-row + .filter-row {')[1] || '';
  assert.ok(rule.split('}')[0].includes('var(--filter-row-gap'), '第二排纵向空隙走注入变量');
  // 4. 两排下拉确认存在于筛选面板（index.html 双 .filter-row）
  assert.ok((html.match(/class="filter-row"/g) || []).length >= 2, '教师筛选面板确有两排下拉栏');
});
