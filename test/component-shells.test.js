/**
 * 前端重构（2026-08-08 审计收编）标准组件壳回归测试
 * 覆盖 app-ui.js 新增壳 + app-anim.js positionFloatCard：
 *   - showToast：全风格 kind 类名 + textContent 转义单源（v0.25.99 取代 alertHtml，提示统一走底部 Toast）
 *   - btnLoading / btnDone：禁用 + spinner 结构 + 还原
 *   - checkboxItemsHtml：label 组结构 / checked 集合 / 转义
 *   - positionFloatCard：left/top 锚定 + 可选 listEl 高度上限（几何值单源 CONFIG）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeCtx() {
  const html = '<!DOCTYPE html><html><body><div id="box"></div><div id="toast-container"></div></body></html>';
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of ['constants.js', 'app-state.js', 'app-api.js', 'app-anim.js', 'app-ui.js']) {
    vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  }
  return { ctx, dom };
}

test('showToast：全风格 kind 类名 + textContent 转义（XSS 单源，v0.25.99 取代 alertHtml）', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`showToast('<img src=x onerror=alert(1)>', 'error')`, ctx);
  const el = dom.window.document.querySelector('#toast-container .toast');
  assert.ok(el, 'toast 挂载到 #toast-container（固定底部容器）');
  assert.ok(el.classList.contains('toast--error'), 'error 态类名');
  assert.equal(el.querySelector('img'), null, 'textContent 禁原样注入 HTML');
  assert.equal(el.textContent, '<img src=x onerror=alert(1)>', '文案以纯文本呈现');
});

test('showToast：success/warn 类 + info 缺省 + 多条堆叠', () => {
  const { ctx, dom } = makeCtx();
  vm.runInContext(`showToast('a', 'success'); showToast('b'); showToast('c', 'warn');`, ctx);
  const els = [...dom.window.document.querySelectorAll('#toast-container .toast')];
  assert.equal(els.length, 3, '三条依次堆叠在容器内');
  assert.ok(els[0].classList.contains('toast--success'), 'success 态');
  assert.ok(els[1].classList.contains('toast--info'), '无 kind → info 缺省态（兼容历史中性调用）');
  assert.ok(els[2].classList.contains('toast--warn'), 'warn 态');
  assert.equal(els[0].textContent, 'a', '文案顺序与调用一致');
});

test('btnLoading/btnDone：禁用+spinner，还原后 textContent 恢复', () => {
  const { ctx, dom } = makeCtx();
  const btn = dom.window.document.createElement('button');
  btn.textContent = '发送';
  dom.window.document.body.appendChild(btn);
  vm.runInContext(`btnLoading(btn, '发送中')`, Object.assign(ctx, { btn }));
  assert.equal(btn.disabled, true, 'loading 禁用');
  assert.ok(btn.querySelector('.spinner'), 'spinner 挂载');
  assert.ok(btn.textContent.includes('发送中'), 'loading 文案');
  vm.runInContext(`btnDone(btn, '发送')`, Object.assign(ctx, { btn }));
  assert.equal(btn.disabled, false, 'done 解禁');
  assert.equal(btn.textContent, '发送', '文案还原');
});

test('checkboxItemsHtml：label 结构 + checked 集合 + 值转义', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`checkboxItemsHtml([{id:'math',name:'数学'},{id:'eng',name:'英语'}], ['eng'])`, ctx);
  assert.ok(html.includes('class="checkbox-item glass glass--solid"'), '勾选 label 结构');
  assert.ok(html.includes('value="math"') && !html.includes('value="math" checked'), '未勾选项无 checked');
  assert.ok(html.includes('value="eng" checked'), '勾选项带 checked');
  assert.ok(html.includes('数学') && html.includes('英语'), '名称保留');
});

test('checkboxItemsHtml：id/name 转义（XSS 单源）', () => {
  const { ctx } = makeCtx();
  const html = vm.runInContext(`checkboxItemsHtml([{id:'a"b',name:'<x>'}])`, ctx);
  assert.ok(!html.includes('<x>'), 'name 转义');
  assert.ok(!html.includes('value="a"b"'), 'id 转义');
});

test('positionFloatCard：锚定 btn 下缘；不再注入 listEl 限高（B4 卡片随内容拉长）', () => {
  const { ctx, dom } = makeCtx();
  const btn = dom.window.document.createElement('button');
  const card = dom.window.document.createElement('div');
  const list = dom.window.document.createElement('div');
  dom.window.document.body.append(btn, card, list);
  // 模拟 getBoundingClientRect；CONFIG 经共享词法环境可取
  vm.runInContext(`
    btn.getBoundingClientRect = () => ({ left: 42, bottom: 100, top: 80, width: 100, height: 20 });
    positionFloatCard(btn, card, list);
  `, Object.assign(ctx, { btn, card, list }));
  const offset = vm.runInContext('CONFIG.MAX_MATCH_DETAIL_OFFSET', ctx);
  assert.equal(card.style.left, '42px', 'left 对齐按钮');
  assert.equal(card.style.top, `${100 + offset}px`, '锚定：bottom + MAX_MATCH_DETAIL_OFFSET');
  assert.equal(list.style.maxHeight, '', '不再注入 listEl 限高（小滚动条根治，卡片随内容拉长）');
});

test('positionFloatCard：右缘钳制——移动端按钮贴右时卡片强制右对齐屏幕边缘（v0.25.26）', () => {
  const { ctx, dom } = makeCtx();
  const btn = dom.window.document.createElement('button');
  const card = dom.window.document.createElement('div');
  dom.window.document.body.append(btn, card);
  // 桩：iPhone 宽 375、卡片宽 300、按钮贴右（left=300）→ 默认左对齐会伸出右缘（300+300>375-8）
  vm.runInContext(`
    btn.getBoundingClientRect = () => ({ left: 300, bottom: 100, top: 80, width: 80, height: 20 });
    Object.defineProperty(card, 'offsetWidth', { get: () => 300, configurable: true });
    Object.defineProperty(document.documentElement, 'clientWidth', { get: () => 375, configurable: true });
    positionFloatCard(btn, card);
  `, Object.assign(ctx, { btn, card }));
  const m = vm.runInContext('CONFIG.MATCH_DETAIL_EDGE_MARGIN', ctx);
  assert.equal(card.style.left, `${375 - 300 - m}px`, '右缘越界 → 钳到右对齐屏幕边缘（vw-w-margin）');
  assert.equal(card.style.top, `${100 + vm.runInContext('CONFIG.MAX_MATCH_DETAIL_OFFSET', ctx)}px`, '锚定逻辑不受钳制影响');

  // 反例：按钮在左半（left=20），右缘不越界 → 保持左对齐
  vm.runInContext(`
    btn.getBoundingClientRect = () => ({ left: 20, bottom: 200 });
    positionFloatCard(btn, card);
  `, Object.assign(ctx, { btn, card }));
  assert.equal(card.style.left, '20px', '右缘未越界 → 保持左对齐');
});
