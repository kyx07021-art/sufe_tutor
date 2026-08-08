/**
 * tag-pick 多选 pill 前端回归（R2-3 性格关键词 / R2-4 非学科项目共用）
 *
 * 复用勾选框语义但不显示勾选框：点击切换 .selected（选中态紫色），超出上限拒绝并 toast，
 * max<=0 = 不设上限。在真实 index.html DOM + 全脚本 vm 沙箱中验证（同 time-slots-ui.test.js）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-style.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

function makeCtx() {
  const html = readFileSync('./index.html', 'utf8')
    .replace(/<script src="\/app-[a-z-]+\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'dangerously',
  });
  const w = dom.window;
  const ctx = vm.createContext({
    window: w, document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    localStorage: w.localStorage, sessionStorage: w.sessionStorage,
    console, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval, Request: globalThis.Request,
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class { set src(v) { this._s = v; } },
    requestAnimationFrame: (cb) => setTimeout(cb, 16), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
  });
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  // 拦截 showToast：记录文案断言超限提示，不真实创建 toast 节点（__toasts 在沙箱 globalThis，经 ctx 读取）
  vm.runInContext(`globalThis.__toasts = []; showToast = (msg) => __toasts.push(msg);`, ctx);
  const fns = vm.runInContext(`({ toggleTagPick, DISP })`, ctx);
  const toasts = () => vm.runInContext('globalThis.__toasts', ctx);
  return { dom, fns, toasts };
}

function mount(doc, ids, containerId) {
  const container = doc.createElement('div');
  container.id = containerId;
  doc.body.appendChild(container);
  ids.forEach(id => {
    const btn = doc.createElement('button');
    btn.className = 'tag-pick';
    btn.dataset.id = id;
    btn.textContent = id;
    container.appendChild(btn);
  });
  return container;
}

test('tag-pick：上限内可选、超限拒绝并 toast、取消后释放名额', () => {
  const { dom, fns, toasts } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc, ['a', 'b', 'c', 'd'], 'tags');
  const buttons = [...container.querySelectorAll('.tag-pick')];

  // 前 3 个选中成功，无 toast
  buttons.slice(0, 3).forEach(b => fns.toggleTagPick(b, 'tags', 3));
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3);
  assert.equal(toasts().length, 0, '上限内无 toast');

  // 第 4 个被拒：不选中 + toast 提示「最多选 3 个」
  fns.toggleTagPick(buttons[3], 'tags', 3);
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3, '超限后仍为 3');
  assert.ok(!buttons[3].classList.contains('selected'), '超限项不选中');
  assert.equal(toasts().length, 1);
  assert.equal(toasts()[0], '最多选 3 个');

  // 取消一个 → 释放名额，可再选第 4 个
  fns.toggleTagPick(buttons[0], 'tags', 3);
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 2);
  fns.toggleTagPick(buttons[3], 'tags', 3);
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 3, '取消后第 4 个可入选');
  assert.ok(buttons[3].classList.contains('selected'));
});

test('tag-pick：max<=0 不设上限（非学科项目）', () => {
  const { dom, fns, toasts } = makeCtx();
  const doc = dom.window.document;
  const container = mount(doc, ['a', 'b', 'c', 'd', 'e'], 'projects');
  container.querySelectorAll('.tag-pick').forEach(b => fns.toggleTagPick(b, 'projects', 0));
  assert.equal(container.querySelectorAll('.tag-pick.selected').length, 5, '无上限全部可选');
  assert.equal(toasts().length, 0, '无上限不提示');
});

test('display 纯函数：priceRangeText 报价区间文案（R2-5）', () => {
  const { fns } = makeCtx();
  const U = '元/h';
  assert.equal(fns.DISP.priceRangeText(100, 150, U), '100~150元/h', '双值 → min~max元/h');
  assert.equal(fns.DISP.priceRangeText(100, null, U), '100元/h起', '只有 min → min元/h起');
  assert.equal(fns.DISP.priceRangeText(null, 150, U), '至150元/h', '只有 max → 至max元/h');
  assert.equal(fns.DISP.priceRangeText(null, null, U), '', '都没值 → 空串');
  assert.equal(fns.DISP.priceRangeText(150, 150, U), '150元/h', '固定报价（min==max）折叠单值');
  assert.equal(fns.DISP.priceRangeText(0, 0, U), '0元/h', '0 是合法报价：折叠为单值 0，而非空串、也非 0~0');
});
