/**
 * 需求一（2026-08-08）·侧边栏选中高亮 —— 普通组件化（v0.25.94 重构）
 *
 * 历史根因：`.sidebar-pill` 绝对定位覆盖层的 top/height 由 app-anim syncPillOnce/glidePill
 * 用 JS 量 active 项 offsetTop/offsetHeight（px）逐帧写 --pill-top/--pill-height；setUiScale
 * 只改 --ui-scale（rem 字号随之缩放 → 卡片高度变化），原实现不触发重对齐，滑块一拉指示块
 * 就停在旧几何（「灰色块乱窜」）。且覆盖层是特殊通路，缩放/重排天然不同步。
 *
 * 修法（v0.25.94，普通组件化）：删整个绝对定位 pill 覆盖层特例栈（syncPillOnce/glidePill/
 * --pill-top/--pill-height/.sidebar-pill/.conv-pill）——选中高亮改由条目自身
 * .sidebar-item.active / .conv-item.active 的 background 承载（流内标准组件）：
 *   ① 条目即自身背景，缩放/拖动/重排天然同帧，零 JS 几何同步；
 *   ② resize 无覆盖层可错位，不再需要重对齐监听；
 *   ③ 切换项时条目 padding/背景 transition 由 CSS 呈现层负责（原 glidePill 的滑动改淡入）。
 *
 * 本测试验证：
 *   1. 渲染后不存在 #sidebar-pill 覆盖层元素；
 *   2. active 高亮随条目自身：.sidebar-item.active 携带背景（CSS 层），换页 active 类跟随；
 *   3. 全栈已无 pill 特例符号残留（syncPillOnce/glidePill/--pill-top/--pill-height 等）；
 *   4. setUiScale 语义不回归（localStorage + --ui-scale 应用）。
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

const srcOf = f => readFileSync('./' + f, 'utf8');

test('渲染后不存在 #sidebar-pill 覆盖层；active 高亮由条目自身承载（v0.25.94 普通组件化）', async () => {
  const { ctx } = makeCtx();
  await renderSidebar(ctx, { role: 'student', id: 1, username: 's', avatar: '' });

  // 1) 覆盖层元素彻底不存在
  assert.equal(vm.runInContext(`document.getElementById('sidebar-pill')`, ctx), null, '无 #sidebar-pill 覆盖层元素');

  // 2) 当前页条目带 active 类（高亮随条目自身）
  assert.equal(
    vm.runInContext(`document.querySelector('#sidebar-nav .sidebar-item[data-page="my-demands"]').classList.contains('active')`, ctx),
    true, '当前页条目带 active 类');

  // 3) CSS 层：.sidebar-item.active 自身携带背景（无需任何 JS 几何写入）
  const styleCss = srcOf('style.css');
  const activeRule = styleCss.match(/\.sidebar-item\.active\s*\{[^}]*\}/);
  assert.ok(activeRule, '.sidebar-item.active 规则存在');
  assert.match(activeRule[0], /background:\s*var\(--g-fill-strong\)/, 'active 背景由条目自身 CSS 承载');
  assert.doesNotMatch(styleCss, /\.sidebar-pill\s*\{/, 'style.css 已无 .sidebar-pill 规则');

  // 4) 换页 → active 类跟随（高亮移动即条目切换，非覆盖层追逐）
  vm.runInContext(`state.page = 'my-chats'; renderSidebar();`, ctx);
  assert.equal(
    vm.runInContext(`document.querySelector('#sidebar-nav .sidebar-item[data-page="my-chats"]').classList.contains('active')`, ctx),
    true, '换页后新页条目 active');
  assert.equal(
    vm.runInContext(`document.querySelector('#sidebar-nav .sidebar-item[data-page="my-demands"]').classList.contains('active')`, ctx),
    false, '旧页条目 active 移除');
});

test('全栈已无 pill 特例残留（CSS 规则/JS 调用/几何变量连根删；历史决策注释允许保留）', () => {
  // CSS 规则定义（含选择器 + {）：任何文件出现即残留（删除说明性注释是 prose 无 {，允许保留）
  const css = ['style.css', 'style-chat.css', 'glass.css'].map(srcOf).join('\n');
  assert.doesNotMatch(css, /\.sidebar-pill\s*\{|\.conv-pill\s*\{/,
    '无 .sidebar-pill / .conv-pill CSS 规则定义');
  // CSS 几何变量：只用于覆盖层 JS 写样式，属特例栈本体，须零残留
  assert.doesNotMatch(css, /--pill-top|--pill-height/, '无 --pill-top / --pill-height 残留');
  // JS 活代码：函数定义或调用（括号形式）任何文件零残留
  const code = ['app-shell.js', 'app-anim.js', 'app-chat.js', 'app-ui.js',
    'app-state.js', 'app-pages.js', 'constants.js'].map(srcOf).join('\n');
  assert.doesNotMatch(code, /syncPillOnce\s*\(|glidePill\s*\(|syncChatPill\s*\(|function\s+syncPillOnce|function\s+glidePill/,
    '无 syncPillOnce/glidePill/syncChatPill 定义或调用残留');
  // GLIDE_MS / SIDEBAR_GLIDE_MS 常量已随覆盖层栈删除（曾只供 glidePill 使用）
  assert.doesNotMatch(code, /GLIDE_MS/, '无 GLIDE_MS / SIDEBAR_GLIDE_MS 常量残留');
});

test('setUiScale 语义不回归（localStorage + --ui-scale 应用）', async () => {
  const { ctx } = makeCtx();
  vm.runInContext(`setUiScale(120)`, ctx);
  assert.equal(vm.runInContext(`localStorage.getItem('sufe_ui_scale')`, ctx), '120', 'localStorage 现值');
  assert.equal(vm.runInContext(`document.documentElement.style.getPropertyValue('--ui-scale')`, ctx), '1.200', '--ui-scale 应用');
});
