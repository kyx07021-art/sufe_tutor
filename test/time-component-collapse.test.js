/**
 * 需求七·第143条 + 需求四十四 · 时间组件布局（B4：直接 import contract actions-draft）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { openContractDraftModal } from '../src/client/features/contract/actions-draft.js';

test('.time-hms 不再 min-width:0（时/分输入组有内容下限，永不塌零叠字）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.time-hms {')[1] || '').split('}')[0];
  assert.ok(!ruleBody.includes('min-width: 0'), 'hms 不显式 min-width:0（默认 min-width:auto 内容下限）');
});

test('时间栏内整点下拉覆盖通用 min-height 撑高（通用撑高不泄漏进时间组件）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.time-field .time-picker .custom-select-trigger {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('min-height: 0'), '时间栏内 trigger 显式 min-height:0（覆盖通用 40px 撑高，防叠加）');
});

test('需求四十四：签约/起草 schedule 提示行已删（无抢宽同排元素），死接口 .form-group-note 已拔', () => {
  const contracts = readFileSync('./src/client/features/contract/actions-draft.js', 'utf8') + readFileSync('./src/client/features/contract/actions-sign.js', 'utf8');
  const css = readFileSync('./style.css', 'utf8');
  const constants = readFileSync('./src/client/constants/text.js', 'utf8') + readFileSync('./src/shared/config.js', 'utf8');
  assert.ok(!contracts.includes('SIGNING_TIME_HINT'), '签约浮窗不再渲染 schedule 提示行');
  assert.ok(!contracts.includes('CONTRACT_TIME_HINT'), '起草浮窗不再渲染 schedule 提示行');
  assert.ok(!contracts.includes('form-group-note'), 'JS 不再引用 form-group-note');
  assert.ok(!constants.includes('SIGNING_TIME_HINT:'), 'SIGNING_TIME_HINT 常量已删');
  assert.ok(!constants.includes('CONTRACT_TIME_HINT:'), 'CONTRACT_TIME_HINT 常量已删');
  assert.ok(!css.includes('.form-group-note'), 'CSS 无残留 form-group-note 选择器');
});

test('渲染验证：签约/起草 schedule form-group 里时间控件为最后一项，无尾部提示行', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 1, expected_time: '', teaching_method: 'online', budget_min: 100, budget_max: 120 }] }) });
  await openContractDraftModal(7);
  const ts = dom.window.document.getElementById('contract-time-slots');
  const fg = ts.closest('.form-group');
  const children = [...fg.children];
  assert.equal(children[children.length - 1], ts, '时间控件是 schedule form-group 最后一项（无尾部提示抢宽）');
  assert.equal(children.some(el => el.tagName === 'P'), false, 'schedule form-group 内无任何 <p> 提示行');
  assert.equal(children.length, 2, '仅 label + 时间控件两项');
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.MutationObserver;
});
