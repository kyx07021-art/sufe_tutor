/**
 * 需求四十六 · 试课薪资「其他」输入框错位（B4：直接 import contract actions-draft）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { openContractDraftModal, contractToggleOther } from '../src/client/features/contract/actions-draft.js';

test('CSS：.form-group > .form-other-wrap 独占整行（flex-basis:100%）且为 flex 容器（输入撑满）', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.form-group > .form-other-wrap {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('flex-basis: 100%'), '独占整行排下拉下方');
  assert.ok(ruleBody.includes('display: flex'), 'flex 容器（输入框撑满整行）');
  assert.ok(css.includes('.form-group > .form-other-wrap'), '选择器含 .form-group 前缀（特异性压制）');
});

test('v0.25.94 输入框左对齐字段列：右推 calc(116px+22px)（label 列宽+列间距），不戳进 title 区', () => {
  const css = readFileSync('./style.css', 'utf8');
  const ruleBody = (css.split('.form-other-wrap .form-input {')[1] || '').split('}')[0];
  assert.ok(ruleBody.includes('margin-left: calc(116px + 22px)'), '输入框右推 label 列宽+列间距（对齐 select 字段列）');
  assert.ok(ruleBody.includes('flex: 1') && ruleBody.includes('min-width: 0'), '输入框仍撑满剩余字段列');
});

test('渲染验证：薪资结算 + 试课薪资两处「其他」展开输入行，toggle 显隐正确', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="modal-container"></div></body></html>', { url: 'http://localhost/' });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.MutationObserver = class { observe() {} disconnect() {} takeRecords() { return []; } };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ demands: [{ id: 1, expected_time: '', teaching_method: 'online', budget_min: 100, budget_max: 120 }] }) });
  await openContractDraftModal(7);
  const payWrap = dom.window.document.getElementById('contract-pay-method-other-wrap');
  const trialWrap = dom.window.document.getElementById('contract-trial-pay-other-wrap');
  assert.ok(payWrap.classList.contains('hidden') && trialWrap.classList.contains('hidden'), '默认（非 other）两处输入行均隐藏');
  const trialSel = dom.window.document.getElementById('contract-trial-pay');
  trialSel.value = 'other';
  contractToggleOther('contract-trial-pay', 'contract-trial-pay-other-wrap');
  assert.ok(!trialWrap.classList.contains('hidden') && payWrap.classList.contains('hidden'), '选「其他」后试课薪资输入行展开、薪资结算行仍隐藏');
  assert.ok(trialWrap.querySelector('#contract-trial-pay-other'), '输入框在 wrap 内');
  assert.equal(trialWrap.closest('.form-group'), trialSel.closest('.form-group'), 'wrap 与下拉同属一个 form-group');
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.MutationObserver;
});
