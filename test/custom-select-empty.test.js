/**
 * v0.25.94 下拉栏空态塌陷治理（直接 import core/ui）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { initCustomSelects } from '../src/client/core/ui.js';
import { STYLE_CSS } from './_css.js';

test('唯一 disabled 提示选项：触发器文字回落显示提示', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  const modal = dom.window.document.createElement('div');
  modal.innerHTML = `<select class="form-select" id="s"><option value="" disabled>暂无开放的需求可签约，请先发布需求</option></select>`;
  dom.window.document.body.appendChild(modal);
  initCustomSelects(dom.window.document.body);
  const sel = dom.window.document.getElementById('s');
  const wrap = sel.closest('.custom-select');
  assert.ok(wrap, 'select 被 custom-select 包装');
  const text = wrap.querySelector('.custom-select-text');
  assert.equal(text.textContent, '暂无开放的需求可签约，请先发布需求');
  assert.ok(text.classList.contains('custom-select-empty'));
  delete globalThis.document;
  delete globalThis.MutationObserver;
});

test('触发器默认空纵向高度（min-height）防塌陷', () => {
  const css = STYLE_CSS;
  const block = (css.split('.custom-select-trigger {')[1] || '').split('}')[0];
  assert.ok(block.includes('min-height: calc(40px * var(--ui-scale, 1))'));
});

test('起草弹窗已无需求下拉（S5 合同独立不绑需求）', () => {
  // v1 app-contracts.js 已删；S5 合同独立不绑需求：起草弹窗已无需求下拉。
  // v2 签约弹窗入口已随 S5 下线（发起签约按钮移除，OBS-1 修复），无任何需求下拉空态提示残留。
  const c = readFileSync('./src/client/features/contract/actions-draft.js', 'utf8');
  assert.ok(!c.includes('SIGNING_NO_DEMAND_HINT'), 'SIGNING_NO_DEMAND_HINT 已随签约弹窗移除');
  assert.ok(!c.includes('CONTRACT_DEMANDS_EMPTY'), 'CONTRACT_DEMANDS_EMPTY 已随 S5 起草无绑定删除');
});
