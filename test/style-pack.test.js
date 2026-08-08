/**
 * 需求八·item4 外观包模块 + 页面风格设置（液态玻璃 / 平面简约）
 *
 * 真实 index.html DOM（内联页面风格 IIFE + 光球 IIFE 首绘运行）+ 全脚本 vm 沙箱：
 *   - getStylePref 缺省 liquid / 非法值回落 liquid / flat 可读；
 *   - setStylePref('flat')：data-style=flat + flat token 全部注入（磨砂→none、纸面→var(--paper)、
 *     投影/液体边→透明占位）+ 光球定档 hidden（orbMode 读 data-style）；
 *   - setStylePref('liquid')：data-style=liquid + 外观包 key 全清（防残留）+ 光球交还用户偏好；
 *   - 设置页渲染页面风格二档（液态玻璃/平面简约），选中态切换，不影响主题/光球选中态；
 *   - 平面简约期间 setOrbPref 保存偏好但光球保持隐藏，切回液态后恢复。
 *
 * 沙箱细节：constants.js 在 vm 沙箱挂 globalThis.APP_CONSTANTS，而内联 IIFE 读 jsdom window 的
 * APP_CONSTANTS（两 realm）——测试先桥接 window.APP_CONSTANTS = globalThis.APP_CONSTANTS。
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
  // 桥接：内联 IIFE 读 jsdom window.APP_CONSTANTS（vm 沙箱与 jsdom window 两个 realm）
  vm.runInContext('window.APP_CONSTANTS = globalThis.APP_CONSTANTS;', ctx);
  return { dom, ctx };
}

async function setup(ctx, user) {
  vm.runInContext(`try { localStorage.setItem('sufe_returning', '1'); } catch (e) {}`, ctx);
  await tick(30);
  vm.runInContext(`state.user = ${JSON.stringify(user)}; renderSidebar(); showView('client');`, ctx);
}

function rootVar(ctx, name) {
  return vm.runInContext(`document.documentElement.style.getPropertyValue(${JSON.stringify(name)})`, ctx);
}
function orbCount(ctx) {
  return vm.runInContext(`document.querySelectorAll('.lg-orb').length`, ctx);
}

test('getStylePref：缺省液态 / 非法值回落 / flat 可读', () => {
  const { ctx } = makeCtx();
  assert.equal(vm.runInContext('getStylePref()', ctx), 'liquid', '缺省液态玻璃');
  vm.runInContext(`try { localStorage.setItem('sufe_style', 'bogus'); } catch (e) {}`, ctx);
  assert.equal(vm.runInContext('getStylePref()', ctx), 'liquid', '非法值回落液态');
  vm.runInContext(`try { localStorage.setItem('sufe_style', 'flat'); } catch (e) {}`, ctx);
  assert.equal(vm.runInContext('getStylePref()', ctx), 'flat', 'flat 可读');
});

test('setStylePref(flat)：data-style + token 注入 + 光球定档 hidden', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`setStylePref('flat')`, ctx);
  assert.equal(vm.runInContext(`document.documentElement.dataset.style`, ctx), 'flat', 'data-style=flat');
  assert.equal(rootVar(ctx, '--g-f-card'), 'none', '磨砂→none');
  assert.equal(rootVar(ctx, '--g-f-modal'), 'none', '浮窗磨砂→none');
  assert.equal(rootVar(ctx, '--lg-bg-blur'), '0px', '底板虚化→0');
  assert.equal(rootVar(ctx, '--g-paper'), 'var(--paper)', '浮窗纸面→不透明主题纸');
  assert.equal(rootVar(ctx, '--g-card-fill'), 'var(--paper)', '卡族→不透明纸面');
  assert.equal(rootVar(ctx, '--glass-lift'), '0 0 0 0 transparent', '投影→透明占位');
  assert.equal(rootVar(ctx, '--g-liquid'), '0 0 0 0 transparent', '液体边缘→透明占位');
  assert.equal(rootVar(ctx, '--g-plate'), 'var(--g-bg)', '底板渐变→纯底色');
  assert.equal(orbCount(ctx), 0, '平面简约强制光球隐藏');
});

test('setStylePref(liquid)：data-style=liquid + 包 token 全清（防残留）+ 光球交还用户偏好', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`setStylePref('flat')`, ctx);
  assert.equal(orbCount(ctx), 0, 'flat 下光球隐藏');
  vm.runInContext(`setStylePref('liquid')`, ctx);
  assert.equal(vm.runInContext(`document.documentElement.dataset.style`, ctx), 'liquid', 'data-style=liquid');
  /* v0.25.23 审计修复：清包 key 后重跑 __applyTheme/__applyLg 恢复主题内联值——
     故 liquid 下 --g-paper/--glass-lift 应等于 THEME.light 现值，而非空 */
  const lightPaper = vm.runInContext(`window.APP_CONSTANTS.THEME.light['--g-paper']`, ctx);
  const lightLift = vm.runInContext(`window.APP_CONSTANTS.THEME.light['--glass-lift']`, ctx);
  assert.equal(rootVar(ctx, '--g-paper'), lightPaper, 'flat→liquid 恢复主题 --g-paper 内联值（审计 #1）');
  assert.equal(rootVar(ctx, '--glass-lift'), lightLift, 'flat→liquid 恢复主题 --glass-lift 内联值');
  assert.equal(rootVar(ctx, '--g-f-card'), '', 'flat 磨砂覆盖已清（jsdom LG fallback frosts 空，生产回落 LG.frosts 值）');
  assert.equal(orbCount(ctx), 36, '液态玻璃交还用户光球偏好（默认鲜艳 36）');
});

test('主题↔外观包互不冲掉（审计 #1）：flat 下切主题 token 仍在；flat→liquid 恢复当前主题内联值', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`try { localStorage.setItem('sufe_theme', 'dark'); } catch (e) {} setThemePref('dark')`, ctx);
  assert.equal(vm.runInContext(`document.documentElement.dataset.theme`, ctx), 'dark', 'dark 主题生效');
  const darkPaper = vm.runInContext(`window.APP_CONSTANTS.THEME.dark['--g-paper']`, ctx);
  assert.equal(rootVar(ctx, '--g-paper'), darkPaper, 'dark --g-paper 已注入');

  vm.runInContext(`setStylePref('flat')`, ctx);
  assert.equal(rootVar(ctx, '--g-f-card'), 'none', 'flat 磨砂 none');
  assert.equal(rootVar(ctx, '--g-paper'), 'var(--paper)', 'flat 纸面覆盖在 dark 之上');

  vm.runInContext(`try { localStorage.setItem('sufe_theme', 'light'); } catch (e) {} setThemePref('light')`, ctx);
  assert.equal(rootVar(ctx, '--g-f-card'), 'none', '切主题后 flat 磨砂仍 none（不被主题冲掉）');
  assert.equal(rootVar(ctx, '--g-paper'), 'var(--paper)', '切主题后 flat 纸面仍覆盖');

  vm.runInContext(`setStylePref('liquid')`, ctx);
  const lightPaper = vm.runInContext(`window.APP_CONSTANTS.THEME.light['--g-paper']`, ctx);
  assert.equal(rootVar(ctx, '--g-paper'), lightPaper, 'flat→liquid 恢复当前（light）主题内联值，不回落样式表');
  assert.equal(vm.runInContext(`document.documentElement.dataset.theme`, ctx), 'light', '主题仍为 light');
});

test('平面简约期间 setOrbPref 保存偏好但光球保持隐藏；切回液态恢复', () => {
  const { ctx } = makeCtx();
  vm.runInContext(`setStylePref('flat'); setOrbPref('vivid')`, ctx);
  assert.equal(orbCount(ctx), 0, 'flat 下改光球偏好仍隐藏');
  assert.equal(vm.runInContext(`(() => { try { return localStorage.getItem('sufe_orb'); } catch (e) { return ''; } })()`, ctx), 'vivid', '偏好已保存');
  vm.runInContext(`setStylePref('liquid')`, ctx);
  assert.equal(orbCount(ctx), 36, '切回液态恢复鲜艳光球');
});

test('设置页渲染页面风格二档；setStylePref 切选中态，不影响主题/光球选中态', async () => {
  const { dom, ctx } = makeCtx();
  const doc = dom.window.document;
  await setup(ctx, { role: 'student', id: 1, username: 's', avatar: '' });
  await vm.runInContext(`state.page = 'account-settings'; enterAccountSettings()`, ctx);
  const opts = [...doc.querySelectorAll('.style-opt')];
  assert.equal(opts.length, 2, '页面风格二档渲染');
  assert.deepEqual(opts.map(o => o.textContent), ['液态玻璃', '平面简约'], '二档文案');
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'liquid', '默认液态选中');
  assert.equal(doc.querySelector('.theme-opt--on').dataset.pref, 'system', '主题选中态在位');

  await vm.runInContext(`setStylePref('flat')`, ctx);
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'flat', '选中态切到平面简约');
  assert.equal(doc.querySelector('.theme-opt--on').dataset.pref, 'system', '主题选中态不受风格切换影响');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'vivid', '光球选中态不受风格切换影响');

  await vm.runInContext(`setStylePref('liquid')`, ctx);
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'liquid', '切回液态选中态同步');
});
