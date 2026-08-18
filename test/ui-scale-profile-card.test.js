/**
 * 需求六·UI 大小滑块 + 资料卡（B4：直接 import state/settings ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { CONFIG } from '../src/shared/config.js';
import { state, uiScaleClamp, getUiScale, setUiScale, uiScaleFillPct, setUiScaleLive, commitUiScale } from '../src/client/core/state.js';
import { enterAccountSettings, setUiScaleFromSlider, commitUiScaleFromSlider } from '../src/client/features/settings/actions.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

function makeDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="account-settings-content"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
  globalThis.requestAnimationFrame = cb => setTimeout(cb, 16);
  globalThis.cancelAnimationFrame = () => {};
  return dom;
}
function teardown() {
  delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; delete globalThis.MutationObserver; delete globalThis.setInterval; delete globalThis.clearInterval; delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame;
}

test('uiScaleClamp：按 CONFIG 上下限钳制、非数/超界回默认（v0.25.12 上限 120）', () => {
  const dom = makeDom();
  assert.equal(uiScaleClamp(90), 90);
  assert.equal(uiScaleClamp(CONFIG.UI_SCALE_MIN - 10), CONFIG.UI_SCALE_MIN);
  assert.equal(uiScaleClamp(CONFIG.UI_SCALE_MAX + 10), CONFIG.UI_SCALE_MAX);
  assert.equal(uiScaleClamp(CONFIG.UI_SCALE_MAX), CONFIG.UI_SCALE_MAX);
  assert.equal(uiScaleClamp('abc'), CONFIG.UI_SCALE_DEFAULT);
  assert.equal(uiScaleClamp(85.6), 86);
  teardown();
});

test('getUiScale：localStorage 现值；无值回默认；非法值钳制', () => {
  const dom = makeDom();
  assert.equal(getUiScale(), CONFIG.UI_SCALE_DEFAULT);
  globalThis.localStorage.setItem(CONFIG.UI_SCALE_KEY, '85');
  assert.equal(getUiScale(), 85);
  globalThis.localStorage.setItem(CONFIG.UI_SCALE_KEY, '999');
  assert.equal(getUiScale(), CONFIG.UI_SCALE_MAX);
  teardown();
});

test('setUiScale：写 localStorage + 应用 --ui-scale 系数，返回钳制值', () => {
  const dom = makeDom();
  const ret = setUiScale(CONFIG.UI_SCALE_MIN);
  assert.equal(ret, CONFIG.UI_SCALE_MIN);
  assert.equal(globalThis.localStorage.getItem(CONFIG.UI_SCALE_KEY), String(CONFIG.UI_SCALE_MIN));
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (CONFIG.UI_SCALE_MIN / 100).toFixed(3));
  const ret2 = setUiScale(CONFIG.UI_SCALE_MAX + 5);
  assert.equal(ret2, CONFIG.UI_SCALE_MAX);
  assert.equal(dom.window.document.documentElement.style.getPropertyValue('--ui-scale'), (CONFIG.UI_SCALE_MAX / 100).toFixed(3));
  teardown();
});

test('uiScaleFillPct：min→0%、max→100%、中点→50%', () => {
  const dom = makeDom();
  const mid = Math.round((CONFIG.UI_SCALE_MIN + CONFIG.UI_SCALE_MAX) / 2);
  assert.equal(uiScaleFillPct(CONFIG.UI_SCALE_MIN), '0.0');
  assert.equal(uiScaleFillPct(CONFIG.UI_SCALE_MAX), '100.0');
  assert.equal(uiScaleFillPct(mid), '50.0');
  teardown();
});

test('B1 滑块响应滚轮：sufe:ui-scale 事件同步滑块值/数值标签/轨道', async () => {
  const dom = makeDom();
  state.user = { id: 1, role: 'student', username: 's', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  const doc = dom.window.document;
  const slider = doc.getElementById('ui-scale-slider');
  const val = doc.getElementById('ui-scale-val');
  assert.ok(slider && val, '设置页滑块已渲染');
  setUiScale(110);
  assert.equal(slider.value, '110', '滑块值同步到滚轮改后的值');
  assert.equal(val.textContent, '110%', '数值标签同步');
  assert.ok(slider.style.getPropertyValue('--ui-fill').endsWith('%'), '轨道填充随值更新');
  setUiScale(115);
  assert.equal(slider.value, '115');
  assert.equal(val.textContent, '115%');
  delete globalThis.fetch;
  teardown();
});

test('设置页滑块：渲染 min/max/现值；拖动实时更新 --ui-scale、数值标签与 localStorage', async () => {
  const dom = makeDom();
  state.user = { id: 1, username: 'u', role: 'teacher', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  const doc = dom.window.document;
  const slider = doc.getElementById('ui-scale-slider');
  assert.equal(slider.min, String(CONFIG.UI_SCALE_MIN));
  assert.equal(slider.max, String(CONFIG.UI_SCALE_MAX));
  assert.equal(slider.step, String(CONFIG.UI_SCALE_STEP));
  assert.equal(slider.value, String(CONFIG.UI_SCALE_DEFAULT));
  const htmlEl = doc.documentElement;
  setUiScaleFromSlider(slider);
  slider.value = String(CONFIG.UI_SCALE_MAX);
  setUiScaleFromSlider(slider);
  await tick(30);
  assert.equal(htmlEl.style.getPropertyValue('--ui-preview-scale'), (CONFIG.UI_SCALE_MAX / 100).toFixed(3), 'rAF 帧后 --ui-preview-scale 应用');
  assert.equal(htmlEl.dataset.uiPreviewing, '1', '拖动中 html[data-ui-previewing] 门控已挂');
  assert.equal(htmlEl.style.getPropertyValue('--ui-scale'), '', '预览期 --ui-scale 不动');
  slider.value = '85';
  commitUiScaleFromSlider(slider);
  assert.equal(htmlEl.style.getPropertyValue('--ui-preview-scale'), '');
  assert.equal(htmlEl.dataset.uiPreviewing, undefined);
  assert.equal(htmlEl.style.getPropertyValue('--ui-scale'), '0.850');
  assert.equal(doc.getElementById('ui-scale-val').textContent, '85%');
  assert.equal(globalThis.localStorage.getItem(CONFIG.UI_SCALE_KEY), '85');
  assert.equal(getUiScale(), 85);
  delete globalThis.fetch;
  teardown();
});

test('B1 滑块：HTML 不再绑 oninput/onchange（拖动路径不依赖浏览器原生解析）', () => {
  const dom = makeDom();
  state.user = { id: 1, username: 'u', role: 'teacher', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  const slider = dom.window.document.getElementById('ui-scale-slider');
  assert.equal(slider.getAttribute('oninput'), null);
  assert.equal(slider.getAttribute('onchange'), null);
  assert.equal(slider.id, 'ui-scale-slider');
  delete globalThis.fetch;
  teardown();
});

test('B1 滑块：pointer 差分拖动——value 按固定初始几何差分，缩放后同位置稳定（无正反馈）', async () => {
  const dom = makeDom();
  state.user = { id: 1, username: 'u', role: 'teacher', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  const doc = dom.window.document;
  const slider = doc.getElementById('ui-scale-slider');
  Object.defineProperty(slider, 'clientWidth', { value: 200, configurable: true });
  const span = CONFIG.UI_SCALE_MAX - CONFIG.UI_SCALE_MIN;
  const fire = (type, x) => {
    const Ctor = typeof dom.window.PointerEvent !== 'undefined' ? dom.window.PointerEvent : dom.window.MouseEvent;
    const ev = new Ctor(type, { clientX: x, pointerId: 1, bubbles: true, cancelable: true, button: 0 });
    slider.dispatchEvent(ev);
  };
  slider.value = String(CONFIG.UI_SCALE_DEFAULT);
  fire('pointerdown', 100);
  fire('pointermove', 150);
  const expect150 = CONFIG.UI_SCALE_DEFAULT + Math.round(50 / 200 * span);
  assert.equal(slider.value, String(expect150), `差分 50px → ${expect150}`);
  await tick(30);
  assert.equal(doc.documentElement.style.transform, '');
  assert.equal(doc.documentElement.dataset.uiPreviewing, '1');
  const before = slider.value;
  fire('pointermove', 150);
  assert.equal(slider.value, before, '缩放后同位置 move → value 稳定（无正反馈漂移）');
  fire('pointermove', 155);
  const expect155 = CONFIG.UI_SCALE_DEFAULT + Math.round(55 / 200 * span);
  assert.equal(slider.value, String(expect155));
  fire('pointerup', 155);
  const finalVal = slider.value;
  assert.equal(doc.getElementById('ui-scale-val').textContent, finalVal + '%');
  assert.equal(doc.documentElement.style.getPropertyValue('--ui-preview-scale'), '');
  assert.equal(doc.documentElement.dataset.uiPreviewing, undefined);
  assert.equal(doc.documentElement.style.getPropertyValue('--ui-scale'), (Number(finalVal) / 100).toFixed(3));
  assert.equal(globalThis.localStorage.getItem(CONFIG.UI_SCALE_KEY), finalVal);
  delete globalThis.fetch;
  teardown();
});

test('B1 滑块：input/change 事件兜底仍走预览/落盘（键盘与无障碍路径）', async () => {
  const dom = makeDom();
  state.user = { id: 1, username: 'u', role: 'teacher', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  enterAccountSettings();
  const doc = dom.window.document;
  const slider = doc.getElementById('ui-scale-slider');
  const htmlEl = doc.documentElement;
  slider.value = String(CONFIG.UI_SCALE_MAX);
  slider.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await tick(30);
  assert.equal(htmlEl.style.getPropertyValue('--ui-preview-scale'), (CONFIG.UI_SCALE_MAX / 100).toFixed(3));
  assert.equal(htmlEl.dataset.uiPreviewing, '1');
  assert.equal(htmlEl.style.getPropertyValue('--ui-scale'), '');
  slider.value = '85';
  slider.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(htmlEl.dataset.uiPreviewing, undefined);
  assert.equal(htmlEl.style.getPropertyValue('--ui-scale'), '0.850');
  assert.equal(globalThis.localStorage.getItem(CONFIG.UI_SCALE_KEY), '85');
  delete globalThis.fetch;
  teardown();
});
