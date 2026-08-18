/**
 * 需求八·item3 背景光球外观三档（B4：直接 import appearance/settings ESM）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { applyOrbs } from '../src/client/core/appearance.js';
import { getOrbPref, setOrbPref as storeOrbPref } from '../src/client/core/state.js';
import { setOrbPref, enterAccountSettings } from '../src/client/features/settings/actions.js';
import { state } from '../src/client/core/state.js';

function makeDom() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="account-settings-content"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.localStorage = dom.window.localStorage;
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {} });
  return dom;
}
function teardown() { delete globalThis.document; delete globalThis.window; delete globalThis.localStorage; }

function orbSnapshot(dom) {
  // 零内联样式契约：动态参数在 <style id="lg-orb-style"> 规则里，DOM 元素零 style 属性
  const orbs = [...dom.window.document.querySelectorAll('.lg-orb')];
  const styleEl = dom.window.document.getElementById('lg-orb-style');
  const rules = styleEl ? styleEl.textContent : '';
  // 每条 orb 规则取第一个 rgba（外圈透明度）；末尾渐变终点的 ,0) 不计入
  const op = rules.split('}').map(rule => (rule.match(/rgba\(var\(--lg-orb-[a-i]\),([0-9.]+)/) || [])[1]).filter(v => v != null).map(parseFloat);
  const sizes = (rules.match(/width:([0-9.]+)vmax/g) || []).map(s => parseFloat(s.slice(6)));
  const glow = dom.window.document.querySelector('.lg-mouseglow');
  return {
    count: orbs.length,
    inlineStyles: orbs.filter(o => o.getAttribute('style')).length,
    opMin: op.length ? Math.min(...op) : null,
    opMax: op.length ? Math.max(...op) : null,
    sizeMin: sizes.length ? Math.min(...sizes) : null,
    sizeMax: sizes.length ? Math.max(...sizes) : null,
    glowDisplay: glow ? glow.style.display : null,
  };
}

test('背景光球默认鲜艳：桌面 36 个、透明度 0.52~0.73、尺寸 10~28vmax', () => {
  const dom = makeDom();
  applyOrbs();
  const s = orbSnapshot(dom);
  assert.equal(s.count, 36, '桌面 36 光球（matchMedia coarse=false）');
  assert.equal(s.inlineStyles, 0, '零内联样式（视觉全在 CSS 层）');
  assert.ok(s.opMin >= 0.50 && s.opMin <= 0.54, `vivid 透明度下界 ~0.52，实际 ${s.opMin}`);
  assert.ok(s.opMax >= 0.71 && s.opMax <= 0.75, `vivid 透明度上界 ~0.73，实际 ${s.opMax}`);
  assert.ok(s.sizeMin >= 9 && s.sizeMin <= 11, `vivid 尺寸下界 ~10vmax，实际 ${s.sizeMin}`);
  assert.ok(s.sizeMax >= 26 && s.sizeMax <= 30, `vivid 尺寸上界 ~28vmax，实际 ${s.sizeMax}`);
  teardown();
});

test('applyOrbs 可重入切档：hidden 零光球+鼠标光隐藏；elegant 24 个柔化', () => {
  const dom = makeDom();
  globalThis.localStorage.setItem('sufe_orb', 'hidden');
  applyOrbs();
  let s = orbSnapshot(dom);
  assert.equal(s.count, 0, '隐藏档零光球（连球都不生成）');
  assert.equal(s.glowDisplay, 'none', '隐藏档鼠标光一并隐藏');
  globalThis.localStorage.setItem('sufe_orb', 'elegant');
  applyOrbs();
  s = orbSnapshot(dom);
  assert.equal(s.count, 24, '淡雅桌面 24 光球');
  assert.ok(s.opMin >= 0.11 && s.opMin <= 0.15, `淡雅透明度下界 ~0.13，实际 ${s.opMin}`);
  assert.ok(s.opMax >= 0.24 && s.opMax <= 0.28, `淡雅透明度上界 ~0.26，实际 ${s.opMax}`);
  assert.ok(s.sizeMin >= 7 && s.sizeMin <= 9, `淡雅尺寸下界 ~8vmax，实际 ${s.sizeMin}`);
  assert.ok(s.sizeMax >= 16 && s.sizeMax <= 20, `淡雅尺寸上界 ~18vmax，实际 ${s.sizeMax}`);
  teardown();
});

test('getOrbPref：缺省鲜艳 / 非法值回落鲜艳', () => {
  const dom = makeDom();
  assert.equal(getOrbPref(), 'vivid', '无偏好缺省鲜艳');
  globalThis.localStorage.setItem('sufe_orb', 'bogus');
  assert.equal(getOrbPref(), 'vivid', '非法值回落鲜艳');
  globalThis.localStorage.setItem('sufe_orb', 'elegant');
  assert.equal(getOrbPref(), 'elegant', '淡雅可读');
  teardown();
});

test('设置页渲染光球三档；setOrbPref 写偏好+重生成背景+切选中态，主题选中独立', async () => {
  const dom = makeDom();
  state.user = { id: 1, role: 'student', username: 's', avatar: '' };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
  globalThis.setInterval = () => 1; globalThis.clearInterval = () => {};
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  enterAccountSettings();
  const doc = dom.window.document;
  const opts = [...doc.querySelectorAll('.orb-opt')];
  assert.equal(opts.length, 3, '光球三档渲染');
  assert.deepEqual(opts.map(o => o.textContent), ['鲜艳', '淡雅', '隐藏'], '三档文案');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'vivid', '默认鲜艳选中');
  assert.equal(doc.querySelectorAll('.theme-opt--on').length, 1, '主题选中态在位');
  setOrbPref('hidden');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'hidden', '选中态切到隐藏');
  assert.equal(globalThis.localStorage.getItem('sufe_orb'), 'hidden', '偏好持久化');
  assert.equal(doc.querySelectorAll('.lg-orb').length, 0, '隐藏档立即生效');
  assert.equal(doc.querySelectorAll('.theme-opt--on').length, 1, '主题选中态不受光球切换影响');
  setOrbPref('elegant');
  assert.equal(doc.querySelector('.orb-opt--on').dataset.pref, 'elegant', '选中态切到淡雅');
  assert.equal(doc.querySelectorAll('.lg-orb').length, 24, '淡雅档立即生效');
  delete globalThis.setInterval; delete globalThis.clearInterval; delete globalThis.MutationObserver;
  teardown();
});
