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

test('筛选栏间距：U3 合并单行后由 .filter-row gap 承担（折行不零空隙），单源值保留注入', () => {
  // 1. 数值单源 CONFIG.FILTER_ROW_GAP（保留注入，无害）
  const { ctx } = makeCtx();
  const gap = vm.runInContext('APP_CONSTANTS.CONFIG.FILTER_ROW_GAP', ctx);
  assert.ok(Number.isInteger(gap) && gap >= 8, `FILTER_ROW_GAP 为合理空隙值（当前 ${gap}px）`);
  // 2. index.html applyLg 注入 --filter-row-gap 保留
  const html = readFileSync('./index.html', 'utf8');
  assert.ok(html.includes("set('--filter-row-gap'"), 'index.html 注入 --filter-row-gap');
  assert.ok(html.includes('C.FILTER_ROW_GAP'), '注入值取单源 CONFIG.FILTER_ROW_GAP');
  // 3. U3（v0.25.105）：筛选下拉缩窄后 PC 端 4 组一行——单行间距由 .filter-row gap 承担
  const css = readFileSync('./style.css', 'utf8');
  const rowRule = css.split('.filter-row {')[1] || '';
  assert.ok(rowRule.split('}')[0].includes('gap: 16px'), '.filter-row 行内/折行间距 gap 16px（单行不再需要两排 margin 规则）');
  assert.ok(!css.includes('.filter-row + .filter-row {'), '两排空隙规则已随合并删除（不再有第二排）');
  // 4. 单行 4 组确认（demand-filter-panel 块内单个 .filter-row 含 4 组；其他筛选面板 filter-row 不动）
  const panelMatch = html.match(/id="demand-filter-panel"[\s\S]*?<\/div>\s*<\/div>/);
  const panel = panelMatch ? panelMatch[0] : '';
  assert.equal((panel.match(/class="filter-row"/g) || []).length, 1, 'U3：需求大厅筛选合并为单行（4 组一行）');
  assert.ok((panel.match(/id="demand-filter-/g) || []).length >= 4, '4 个筛选项在位');
  // 5. v0.25.110（U3 漏交付）：教师筛选面板 7 组并入一行（id=teacher-filters 块内单个 .filter-row）
  const teaMatch = html.match(/id="teacher-filters"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/);
  const teaPanel = teaMatch ? teaMatch[0] : '';
  assert.equal((teaPanel.match(/class="filter-row"/g) || []).length, 1, '教师筛选合并为单行（7 组一行）');
  assert.ok((teaPanel.match(/id="filter-(gender|subject|price|rating|method|day|verified)"/g) || []).length === 7, '教师筛选 7 组全部在位');
  // 6. min-width 收窄保证 7 组进 920px 容器：100px（7×100+6×16=796 ≤ 920-padding）
  const grpCss = css.split('.filter-group {')[1] || '';
  assert.ok(grpCss.split('}')[0].includes('min-width: 100px'), 'v0.25.110：.filter-group min-width 收窄到 100px（7 组一行）');
});
