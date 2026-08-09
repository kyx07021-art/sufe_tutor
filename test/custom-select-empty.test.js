/**
 * v0.25.94（用户反馈）·下拉栏空态塌陷治理
 *
 * 缺陷：select 只有唯一 disabled 选项（空态灰字提示，如签约/起草弹窗「暂无开放的需求」）时，
 * selectedIndex=-1 → syncCustomSelectText 读 options[-1] 得 undefined → 触发器文字为空，
 * 下拉塌成无字细条（签约选需求/起草选需求两处同病）。
 *
 * 修复：
 *   - syncCustomSelectText 回落 options[0]——空态提示文案仍显示（灰字）；
 *   - .custom-select-trigger 加 min-height（默认空纵向高度），空态不塌成细条。
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
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval,
    Request: globalThis.Request, AbortController: globalThis.AbortController,
    performance: globalThis.performance,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  const FILES = ['constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
    'app-datahub.js', 'app-anim.js', 'app-ui.js'];
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

test('v0.25.94 唯一 disabled 提示选项：触发器文字回落显示提示（不塌成无字细条）', () => {
  const { ctx, dom } = makeCtx();
  const doc = dom.window.document;
  const modal = doc.createElement('div');
  modal.innerHTML = `<select class="form-select" id="s"><option value="" disabled>暂无开放的需求可签约，请先发布需求</option></select>`;
  doc.body.appendChild(modal);
  vm.runInContext(`initCustomSelects(document.querySelector('.modal') || document.body)`, ctx);
  const sel = doc.getElementById('s');
  const wrap = sel.closest('.custom-select');
  assert.ok(wrap, 'select 被 custom-select 包装');
  const text = wrap.querySelector('.custom-select-text');
  assert.equal(text.textContent, '暂无开放的需求可签约，请先发布需求', '唯一 disabled 选项回落首项显示提示文案');
  assert.ok(text.classList.contains('custom-select-empty'), '空态文字走灰字类（custom-select-empty）');
});

test('v0.25.94 触发器默认空纵向高度（min-height）防塌陷', () => {
  const css = readFileSync('./style.css', 'utf8');
  const block = (css.split('.custom-select-trigger {')[1] || '').split('}')[0];
  assert.ok(block.includes('min-height: calc(40px * var(--ui-scale, 1))'), '触发器 min-height 默认空高度');
});

test('v0.25.94 签约/起草弹窗空态仍渲染灰字提示 option（选中即回落）', () => {
  const c = readFileSync('./app-contracts.js', 'utf8');
  assert.ok(c.includes('SIGNING_NO_DEMAND_HINT'), '发起签约空态提示 option 存在');
  assert.ok(c.includes('CONTRACT_DEMANDS_EMPTY'), '起草合同空态提示 option 存在');
});
