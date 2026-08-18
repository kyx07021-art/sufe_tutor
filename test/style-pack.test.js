/**
 * 需求八·item4 外观包（B4：直接 import settings/appearance ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { THEME, STYLE_PACKS, LG } from '../src/client/constants/theme.js';
import { getStylePref, setStylePref, setThemePref, setOrbPref, enterAccountSettings } from '../src/client/features/settings/actions.js';
import { state } from '../src/client/core/state.js';

function makeDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="account-settings-content"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  return dom;
}
function teardown() {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;
}

test('getStylePref：缺省液态 / 非法值回落 / flat 可读', () => {
  const dom = makeDom();
  assert.equal(getStylePref(), 'liquid', '缺省液态玻璃');
  globalThis.localStorage.setItem('sufe_style', 'bogus');
  assert.equal(getStylePref(), 'liquid', '非法值回落液态');
  globalThis.localStorage.setItem('sufe_style', 'flat');
  assert.equal(getStylePref(), 'flat', 'flat 可读');
  teardown();
});

test('setStylePref(flat)：data-style + token 注入 + 光球定档 hidden', () => {
  const dom = makeDom();
  setStylePref('flat');
  const root = dom.window.document.documentElement;
  assert.equal(root.dataset.style, 'flat', 'data-style=flat');
  const val = k => root.style.getPropertyValue(k);
  assert.equal(val('--g-f-card'), 'none', '磨砂→none');
  assert.equal(val('--g-f-modal'), 'none', '浮窗磨砂→none');
  assert.equal(val('--lg-bg-blur'), '0px', '底板虚化→0');
  assert.equal(val('--g-paper'), 'var(--paper)', '浮窗纸面→不透明主题纸');
  assert.equal(val('--g-card-fill'), 'var(--paper)', '卡族→不透明纸面');
  assert.equal(val('--glass-lift'), '0 0 0 0 transparent', '投影→透明占位');
  assert.equal(val('--g-liquid'), '0 0 0 0 transparent', '液体边缘→透明占位');
  assert.equal(val('--g-plate'), 'var(--g-bg)', '底板渐变→纯底色');
  assert.equal(dom.window.document.querySelectorAll('.lg-orb').length, 0, '平面简约强制光球隐藏');
  teardown();
});

test('setStylePref(liquid)：data-style=liquid + 包 token 全清（防残留）+ 光球交还用户偏好', () => {
  const dom = makeDom();
  setStylePref('flat');
  assert.equal(dom.window.document.querySelectorAll('.lg-orb').length, 0);
  setStylePref('liquid');
  const root = dom.window.document.documentElement;
  assert.equal(root.dataset.style, 'liquid', 'data-style=liquid');
  const lightPaper = THEME.light['--g-paper'];
  const lightLift = THEME.light['--glass-lift'];
  assert.equal(root.style.getPropertyValue('--g-paper'), lightPaper, 'flat→liquid 恢复主题 --g-paper 内联值（审计 #1）');
  assert.equal(root.style.getPropertyValue('--glass-lift'), lightLift, 'flat→liquid 恢复主题 --glass-lift 内联值');
  assert.equal(root.style.getPropertyValue('--g-f-card'), LG.frosts.card, 'flat 磨砂覆盖已清（liquid 恢复 LG 基础几何）');
  assert.equal(dom.window.document.querySelectorAll('.lg-orb').length, 36, '液态玻璃交还用户光球偏好（默认鲜艳 36）');
  teardown();
});

test('主题↔外观包互不冲掉（审计 #1）：flat 下切主题 token 仍在；flat→liquid 恢复当前主题内联值', () => {
  const dom = makeDom();
  globalThis.localStorage.setItem('sufe_theme', 'dark');
  setThemePref('dark');
  const root = dom.window.document.documentElement;
  assert.equal(root.dataset.theme, 'dark', 'dark 主题生效');
  assert.equal(root.style.getPropertyValue('--g-paper'), THEME.dark['--g-paper'], 'dark --g-paper 已注入');
  setStylePref('flat');
  assert.equal(root.style.getPropertyValue('--g-f-card'), 'none');
  assert.equal(root.style.getPropertyValue('--g-paper'), 'var(--paper)');
  globalThis.localStorage.setItem('sufe_theme', 'light');
  setThemePref('light');
  assert.equal(root.style.getPropertyValue('--g-f-card'), 'none');
  assert.equal(root.style.getPropertyValue('--g-paper'), 'var(--paper)');
  setStylePref('liquid');
  assert.equal(root.style.getPropertyValue('--g-paper'), THEME.light['--g-paper']);
  assert.equal(root.dataset.theme, 'light', '主题仍为 light');
  teardown();
});

test('平面简约期间 setOrbPref 保存偏好但光球保持隐藏；切回液态恢复', () => {
  const dom = makeDom();
  setStylePref('flat');
  setOrbPref('vivid');
  assert.equal(dom.window.document.querySelectorAll('.lg-orb').length, 0, 'flat 下改光球偏好仍隐藏');
  assert.equal(globalThis.localStorage.getItem('sufe_orb'), 'vivid', '偏好已保存');
  setStylePref('liquid');
  assert.equal(dom.window.document.querySelectorAll('.lg-orb').length, 36, '切回液态恢复鲜艳光球');
  teardown();
});

test('设置页渲染页面风格二档；setStylePref 切选中态，不影响主题/光球选中态', async () => {
  const dom = makeDom();
  state.user = { id: 1, role: 'student', username: 's', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  enterAccountSettings();
  const doc = dom.window.document;
  const opts = [...doc.querySelectorAll('.style-opt')];
  assert.equal(opts.length, 2, '页面风格二档渲染');
  assert.deepEqual(opts.map(o => o.textContent), ['液态玻璃', '平面简约'], '二档文案');
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'liquid', '默认液态选中');
  assert.equal(doc.querySelector('.theme-opt--on').dataset.pref, 'system', '主题选中态在位');
  setStylePref('flat');
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'flat', '选中态切到平面简约');
  assert.equal(doc.querySelector('.theme-opt--on').dataset.pref, 'system', '主题选中态不受风格切换影响');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'vivid', '光球选中态不受风格切换影响');
  setStylePref('liquid');
  assert.equal(doc.querySelector('.style-opt--on').dataset.pref, 'liquid', '切回液态选中态同步');
  delete globalThis.setInterval; delete globalThis.clearInterval; delete globalThis.MutationObserver;
  teardown();
});

test('平面简约白色系：#164 flat 基底覆盖 + 主题提供 --flat-*（浅白深暗）', () => {
  const light = THEME.light;
  const dark = THEME.dark;
  const flatTokens = STYLE_PACKS.flat.tokens;
  assert.notEqual(light['--flat-bg'], '#FFFFFF', '页面底不是纯白（微灰白系，防全白无层级）');
  assert.equal(light['--flat-paper'], '#FFFFFF', '浅色 flat 卡片纯白');
  assert.ok(light['--flat-paper-2'] && light['--flat-paper-3'], '浅色 flat 灰阶纸面在位');
  assert.ok(dark['--flat-bg'].startsWith('#') && dark['--flat-bg'] !== '#FFFFFF', '深色 flat 底保持暗色');
  assert.equal(flatTokens['--g-bg'], 'var(--flat-bg)', 'flat 包覆盖页面底');
  assert.equal(flatTokens['--paper'], 'var(--flat-paper)', 'flat 包覆盖纸面');
  assert.equal(flatTokens['--line'], 'var(--flat-line)', 'flat 包覆盖线条');
  assert.equal(flatTokens['--g-plate'], 'var(--g-bg)', '底板引用 g-bg（现为纯白）');
  const liquidTokens = STYLE_PACKS.liquid.tokens;
  assert.equal(liquidTokens['--g-bg'], undefined, '液态包不动 --g-bg');
});

test('flat 亮色分层：--flat-bg ≠ --flat-paper（页面底微灰、卡片纯白），嵌套面逐级加深', () => {
  const light = THEME.light;
  assert.notEqual(light['--flat-bg'], light['--flat-paper'], '页面底与卡面不同色（此前全白无层级）');
  assert.equal(light['--flat-paper'], '#FFFFFF', '卡片仍纯白');
  const shade = hex => {
    const v = parseInt(hex.slice(1), 16);
    return (v >> 16) + ((v >> 8) & 0xff) + (v & 0xff);
  };
  const sBg = shade(light['--flat-bg']), sP = shade(light['--flat-paper']), sP2 = shade(light['--flat-paper-2']), sP3 = shade(light['--flat-paper-3']);
  assert.ok(sBg < sP, '页面底比卡片暗一档（白卡浮起）');
  assert.ok(sP2 < sP, '嵌套面（卡内控件）比卡片暗');
  assert.ok(sP3 < sP2, '最深嵌套面再暗一档');
});
