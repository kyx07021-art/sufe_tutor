/**
 * 需求一（2026-08-08）·侧边栏卡片缩放适配 —— 指示块随 ui-scale 重对齐
 *
 * 根因：`.sidebar-pill` 的 top/height 由 app-anim syncPillOnce 用 JS 测 active 项的
 * offsetTop/offsetHeight（px）写入；而 setUiScale 只改 --ui-scale（rem 字号随之缩放 →
 * 卡片高度变化），原实现不触发重对齐，滑块一拉指示块就停在旧几何（「卡片跟不上变化」）。
 *
 * 修法（v0.25.25，分层）：app-state setUiScale 发 `sufe:ui-scale` 事件 → app-anim 监听
 * 同 resize 口径 syncPillOnce 重对齐（含沟通页 syncChatPill）。本测试验证事件链路：
 * 桩 active 项几何 → setUiScale → 断言指示块 top/height 已按新几何重写。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = [
  'constants.js', 'region-data.js', 'app-display.js', 'app-state.js', 'app-api.js',
  'app-datahub.js', 'app-anim.js', 'app-ui.js', 'app-style.js', 'app-onboard.js', 'app-region.js',
  'app-posts.js', 'app-chat.js', 'app-contracts.js', 'app-chart.js', 'app-admin.js',
  'app-demands.js', 'app-teachers.js', 'app-pages.js', 'app-shell.js', 'app-auth.js',
];

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

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
    console,
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
  for (const f of FILES) vm.runInContext(readFileSync('./' + f, 'utf8'), ctx, { filename: f });
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

async function renderSidebar(ctx, user) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30);
  vm.runInContext(`state.user = ${JSON.stringify(user)}; state.page = 'my-demands'; renderSidebar();`, ctx);
}

// v0.25.87 重构（R2）：pill 几何改 CSS 变量驱动（--pill-top/--pill-height），断言随之切换
const pillTop = ctx => vm.runInContext(`document.getElementById('sidebar-pill').style.getPropertyValue('--pill-top')`, ctx);
const pillH = ctx => vm.runInContext(`document.getElementById('sidebar-pill').style.getPropertyValue('--pill-height')`, ctx);

test('setUiScale 发 sufe:ui-scale 事件 → 侧边栏指示块按新几何重对齐（v0.25.25）', async () => {
  const { ctx } = makeCtx();
  await renderSidebar(ctx, { role: 'student', id: 1, username: 's', avatar: '' });
  assert.ok(vm.runInContext(`!!document.querySelector('#sidebar-nav .sidebar-item.active')`, ctx), '有 active 导航卡');

  // 桩 active 项几何为 (40,60)，syncPillOnce 写入
  vm.runInContext(`
    const a = document.querySelector('#sidebar-nav .sidebar-item.active');
    Object.defineProperty(a, 'offsetTop', { get: () => 40, configurable: true });
    Object.defineProperty(a, 'offsetHeight', { get: () => 60, configurable: true });
    syncPillOnce(document.getElementById('sidebar-pill'), document.getElementById('sidebar-nav'), '.sidebar-item');
  `, ctx);
  assert.equal(pillTop(ctx), '40px');
  assert.equal(pillH(ctx), '60px');

  // 模拟滑块拉大：卡片长高 → 几何变 (120,90)；setUiScale 后指示块必须追上新几何。
  // v0.25.87（R2）：sufe:ui-scale 处理改 rAF 渲染帧测量 → 须等一帧再断言
  vm.runInContext(`
    const a2 = document.querySelector('#sidebar-nav .sidebar-item.active');
    Object.defineProperty(a2, 'offsetTop', { get: () => 120, configurable: true });
    Object.defineProperty(a2, 'offsetHeight', { get: () => 90, configurable: true });
    setUiScale(115);
  `, ctx);
  await tick(40); // 等 rAF 帧执行 syncPillOnce
  assert.equal(pillTop(ctx), '120px', 'ui-scale 变化后指示块 top 追上新几何');
  assert.equal(pillH(ctx), '90px', 'ui-scale 变化后指示块 height 追上新几何');

  // 无 active 项 → pill 隐退（防孤儿指示块）
  vm.runInContext(`state.page = 'bogus-page'; renderSidebar();`, ctx);
  assert.equal(vm.runInContext(`document.getElementById('sidebar-pill').style.opacity`, ctx), '0', '无 active 项时指示块隐退');
});

test('setUiScale 仍写 localStorage + 应用 --ui-scale（事件不影响原语义）', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`setUiScale(120)`, ctx);
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_ui_scale')`, ctx), '120', 'localStorage 现值');
  assert.equal(vm.runInContext(`document.documentElement.style.getPropertyValue('--ui-scale')`, ctx), '1.200', '--ui-scale 应用');
});
